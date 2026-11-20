"""아침 알림 — 엔지니어별 메신저 웹훅으로 그날 확인할 것을 하루 한 번 보낸다.

설정은 notify_settings (엔지니어당 1건, 웹훅 주소는 secure_store 로 암호화). app.py 의 _notify_loop 가 1분마다
send_due() 를 불러, 켜져 있고 · 보낼 시각이 지났고 · 오늘 아직 안 보냈고 · (평일만이면) 평일인 엔지니어에게 보낸다.

메시지 내용 (build_digest): 오늘 / 내일 일정(점검·기술지원) · 지연된 일정 · 미처리 장애 · 미해결 이슈 수 ·
워런티 30일 이내 만료 · OS 지원 종료 90일 이내 장비 (eos_match) · 라이선스 정책 변경 감지(licenses).
웹훅 형식은 주소로 고른다: Slack · Discord · Google Chat · Microsoft Teams(Incoming Webhook=MessageCard,
Power Automate 워크플로=Adaptive Card) · 그 밖에는 {"text": ...}.
"""
import re
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import database
import eos_match
import secure_store
from database import get_db, NotifySetting, Engineer, Site, Device, Schedule, WorkPlan, Incident, Issue
from routers.technotes import support_only
from routers.remote import blocked_target

router = APIRouter(prefix="/api/engineers/{eng_id}/notify", tags=["notify"])

WD = "월화수목금토일"


# ── 웹훅 종류와 보낼 본문 ─────────────────────────────
def hook_kind(url: str) -> str:
    h = (urlparse(url).hostname or "").lower()
    if h == "hooks.slack.com":
        return "slack"
    if h.endswith("discord.com") or h.endswith("discordapp.com"):
        return "discord"
    if h == "chat.googleapis.com":
        return "gchat"
    if h.endswith("webhook.office.com") or h.endswith("outlook.office.com"):
        return "teams"
    if h.endswith("logic.azure.com") or "powerplatform" in h or "powerautomate" in h:
        return "teams-flow"
    return "generic"


KIND_NAME = {"slack": "Slack", "discord": "Discord", "gchat": "Google Chat", "teams": "Microsoft Teams",
             "teams-flow": "Microsoft Teams (워크플로)", "generic": "일반 웹훅 ({\"text\": ...})"}


_MENTION_RE = re.compile(r"^(@?here|@?channel|@?everyone|[UW][A-Z0-9]{6,}|\d{15,20})$")


def clean_mention(v: str) -> str:
    """멘션 칸 값 정리: 'U0ABC123' / '@channel' / '@here' (Discord 는 숫자 ID). 틀리면 HTTPException."""
    v = (v or "").strip().strip("<>").lstrip("!")
    if v.startswith("@") and v[1:2].isupper():          # '@U0ABC…' 처럼 붙여 넣은 경우
        v = v[1:]
    if v and not _MENTION_RE.match(v):
        raise HTTPException(400, detail="멘션은 Slack 멤버 ID(U로 시작, 예: U0ABC1234), @channel, @here 중 하나로 넣어 주세요")
    return v


def mention_tag(v: str, kind: str) -> str:
    """메신저별 멘션 글자. 모르는 형식(Teams 등)은 빈 값."""
    v = (v or "").lstrip("@")
    if not v:
        return ""
    if kind in ("slack", "generic"):
        return {"here": "<!here>", "channel": "<!channel>", "everyone": "<!channel>"}.get(v, f"<@{v}>")
    if kind == "discord":
        return {"here": "@here", "channel": "@everyone", "everyone": "@everyone"}.get(v, f"<@{v}>")
    if kind == "gchat":
        return "<users/all>" if v in ("here", "channel", "everyone") else ""
    return ""


def _render(title: str, sections: list, kind: str, mention: str = "") -> dict:
    """sections = [(제목, [줄, ...]), ...] → 웹훅 본문(dict). mention = 맨 앞에 붙일 멘션(핸드폰 알림이 뜨게)"""
    if kind == "slack":
        b = lambda x: f"*{x}*"
    elif kind in ("gchat",):
        b = lambda x: f"*{x}*"
    else:
        b = lambda x: f"**{x}**"
    tag = mention_tag(mention, kind)
    parts = [(tag + " " if tag else "") + b(title)]
    for head, lines in sections:
        parts.append("")
        parts.append(b(head))
        parts.extend(f"• {l}" for l in lines)
    text = "\n".join(parts)
    if kind == "discord":
        return {"content": text[:1990]}
    if kind == "teams":
        return {"@type": "MessageCard", "@context": "https://schema.org/extensions", "summary": title,
                "text": text.replace("\n", "  \n")}
    if kind == "teams-flow":
        body = [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True}]
        for head, lines in sections:
            body.append({"type": "TextBlock", "text": head, "weight": "Bolder", "spacing": "Medium", "wrap": True})
            body.append({"type": "TextBlock", "text": "\n".join(f"- {l}" for l in lines), "wrap": True, "spacing": "Small"})
        return {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive",
                "content": {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard",
                            "version": "1.4", "body": body}}]}
    return {"text": text}


# ── 메시지 내용 ───────────────────────────────────────
def _md(day: str) -> str:
    return f"{int(day[5:7])}/{int(day[8:10])}({WD[datetime.strptime(day[:10], '%Y-%m-%d').weekday()]})"


def build_digest(db: Session, eng_id: str, now: Optional[datetime] = None):
    """(제목, sections) — sections 가 비면 '확인할 것 없음' 한 줄."""
    now = now or datetime.now()
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    all_sites = db.query(Site).filter(Site.engineer_id == eng_id).all()
    site_name = {s.id: s.name for s in all_sites}
    sites = [s for s in all_sites if not s.archived]          # 보관한 사이트는 장비·계약 알림에서 뺀다

    scheds = db.query(Schedule).filter(Schedule.engineer_id == eng_id, Schedule.status != "완료",
                                       Schedule.sched_date != "", Schedule.sched_date <= tomorrow + "T99").all()
    plans = support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.status != "완료",
                                                   WorkPlan.work_date != "", WorkPlan.work_date <= tomorrow + "T99")).all()
    items = [(s.sched_date, "점검", site_name.get(s.site_id, ""), s.title) for s in scheds] \
          + [(p.work_date, (p.support_type or "기술지원").split(",")[0], p.site or "", p.title) for p in plans]
    items.sort()

    def line(d, kind, site, title, with_day=False):
        tm = d[11:16] if len(d) > 11 else ""
        pre = (_md(d) + " " if with_day else "") + (tm + " " if tm else "")
        return f"{pre}[{kind}] {site} : {title}" if site else f"{pre}[{kind}] {title}"

    sections = []
    t = [line(*x) for x in items if x[0][:10] == today]
    if t:
        sections.append((f"오늘 일정 {len(t)}건", t))
    tm = [line(*x) for x in items if x[0][:10] == tomorrow]
    if tm:
        sections.append((f"내일 일정 {len(tm)}건", tm))
    late = [line(*x, with_day=True) for x in items if x[0][:10] < today]
    if late:
        sections.append((f"지연(완료 안 됨) {len(late)}건", late[:10] + ([f"외 {len(late) - 10}건"] if len(late) > 10 else [])))

    incs = db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.status != "완료") \
        .order_by(Incident.occurred_at).all()
    if incs:
        sections.append((f"미처리 장애 {len(incs)}건",
                         [f"{_md(i.occurred_at) + ' ' if i.occurred_at else ''}{i.site + ' : ' if i.site else ''}{i.title} ({i.status}·{i.severity})"
                          for i in incs[:10]]))

    n_iss = db.query(Issue).filter(Issue.engineer_id == eng_id, Issue.status != "완료").count()

    live = [s.id for s in sites]
    devs = db.query(Device).filter(Device.site_id.in_(live)).all() if live else []
    warr = []
    for d in devs:
        try:
            left = (datetime.strptime(d.warranty, "%Y-%m-%d").date() - now.date()).days
        except (TypeError, ValueError):
            continue
        if 0 <= left <= 30:
            warr.append((left, f"{site_name.get(d.site_id, '')} {d.name} — {d.warranty} (D-{left})"))
    if warr:
        sections.append((f"워런티 30일 이내 만료 {len(warr)}대", [x[1] for x in sorted(warr)]))

    idx = eos_match.load_index(db)
    eos_soon, eos_end = [], 0
    for d in devs:
        m = eos_match.device_alert(d, idx)
        if not m:
            continue
        if m["state"] in ("end", "ext"):
            eos_end += 1
        elif m["days"] is not None and m["days"] <= 90:
            eos_soon.append((m["days"], f"{site_name.get(d.site_id, '')} {d.name} — {m['product_label']} {m['label']} EOL {m['eol']} (D-{m['days']})"))
    if eos_soon:
        sections.append((f"OS 지원 종료 90일 이내 {len(eos_soon)}대", [x[1] for x in sorted(eos_soon)]))

    from routers.sites import check_missing, contract_days
    miss = [(s.name, check_missing(s, today)) for s in sites]
    miss = [f"{n} — {lbl} 점검 일정 없음 ({'월간' if lbl.endswith('월') else '분기'} 점검 계약)" for n, lbl in sorted(miss) if lbl]
    if miss:
        sections.append((f"점검 일정 없는 계약 사이트 {len(miss)}곳", miss))
    con = sorted(((contract_days(s), s) for s in sites if contract_days(s) is not None and contract_days(s) <= 30),
                 key=lambda x: x[0])
    if con:
        sections.append((f"유지보수 계약 종료 30일 이내 {len(con)}곳",
                         [f"{s.name} — {s.contract_end} ({'D-' + str(d) if d >= 0 else f'{-d}일 지남'})" for d, s in con]))

    extra = []
    if n_iss:
        extra.append(f"미해결 이슈 {n_iss}건")
    if eos_end:
        extra.append(f"OS 지원이 이미 끝난 장비 {eos_end}대")
    try:
        from routers.licenses import pending_changes
        lic = pending_changes(db)
        if lic:
            names = sorted({n for n, _ in lic})
            extra.append(f"라이선스 정책 근거 페이지 변경 감지 {len(lic)}건 ({', '.join(names[:4])}{' 외' if len(names) > 4 else ''}) — 지식 창고 > 라이선스 정책에서 확인")
    except Exception:
        pass
    if extra:
        sections.append(("그 밖에", extra))

    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    title = f"SE-PORTAL 아침 알림 · {_md(today)}{' · ' + eng.name if eng else ''}"
    if not sections:
        sections = [("오늘 확인할 것", ["없습니다. 좋은 하루 보내세요."])]
    return title, sections


def send(url: str, title: str, sections: list, mention: str = ""):
    """웹훅으로 보낸다. 실패하면 HTTPException(400, 한국어 사유)."""
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        raise HTTPException(400, detail="웹훅 주소는 https:// 로 시작해야 합니다")
    why = blocked_target(u.hostname)
    if why:
        raise HTTPException(400, detail=why)
    try:
        r = httpx.post(url, json=_render(title, sections, hook_kind(url), mention), timeout=15,
                       headers={"User-Agent": "SE-Portal-Notify/1.0"})
    except httpx.HTTPError as e:
        raise HTTPException(400, detail=f"웹훅으로 보내지 못했습니다: {type(e).__name__}")
    if r.status_code >= 300:
        raise HTTPException(400, detail=f"웹훅이 거부했습니다 (HTTP {r.status_code}) {r.text[:150]}")


# ── 설정 API ──────────────────────────────────────────
def _get(db, eng_id) -> NotifySetting:
    s = db.query(NotifySetting).filter(NotifySetting.engineer_id == eng_id).first()
    if not s:
        s = NotifySetting(engineer_id=eng_id)
        db.add(s)
        db.flush()
    return s


def _dict(s: NotifySetting) -> dict:
    url = secure_store.decrypt(s.webhook) if s.webhook else ""
    return {"enabled": bool(s.enabled), "send_time": s.send_time or "08:00", "weekdays_only": bool(s.weekdays_only),
            "has_webhook": bool(url), "webhook_host": urlparse(url).hostname or "" if url else "",
            "kind": KIND_NAME[hook_kind(url)] if url else "", "last_sent": s.last_sent or "", "last_result": s.last_result or "", "mention": s.mention or ""}


@router.get("")
def get_setting(eng_id: str, db: Session = Depends(get_db)):
    s = _get(db, eng_id)
    db.commit()
    return _dict(s)


class NotifyIn(BaseModel):
    enabled:       Optional[bool] = None
    send_time:     Optional[str] = None
    weekdays_only: Optional[bool] = None
    webhook:       Optional[str] = None     # None = 그대로, "" = 지우기
    mention:       Optional[str] = None     # Slack 멤버 ID / @channel / @here ("" = 없음)


@router.put("")
def save_setting(eng_id: str, data: NotifyIn, db: Session = Depends(get_db)):
    s = _get(db, eng_id)
    if data.webhook is not None:
        url = data.webhook.strip()
        if url:
            u = urlparse(url)
            if u.scheme != "https" or not u.hostname:
                raise HTTPException(400, detail="웹훅 주소는 https:// 로 시작해야 합니다")
            why = blocked_target(u.hostname)
            if why:
                raise HTTPException(400, detail=why)
        s.webhook = secure_store.encrypt(url) if url else ""
    if data.send_time is not None:
        try:
            datetime.strptime(data.send_time, "%H:%M")
        except ValueError:
            raise HTTPException(400, detail="보낼 시각은 HH:MM 형식이어야 합니다")
        if data.send_time != (s.send_time or ""):
            s.last_sent = ""                     # 시각을 바꾸면 오늘 다시 보낼 수 있게
        s.send_time = data.send_time
    if data.mention is not None:
        s.mention = clean_mention(data.mention)
    if data.weekdays_only is not None:
        s.weekdays_only = data.weekdays_only
    if data.enabled is not None:
        s.enabled = data.enabled
    if s.enabled and not s.webhook:
        raise HTTPException(400, detail="웹훅 주소를 먼저 넣어 주세요")
    db.commit()
    return _dict(s)


@router.get("/preview")
def preview(eng_id: str, db: Session = Depends(get_db)):
    title, sections = build_digest(db, eng_id)
    return {"title": title, "sections": [{"head": h, "lines": l} for h, l in sections]}


@router.post("/test")
def send_test(eng_id: str, db: Session = Depends(get_db)):
    s = _get(db, eng_id)
    if not s.webhook:
        raise HTTPException(400, detail="웹훅 주소를 먼저 저장해 주세요")
    title, sections = build_digest(db, eng_id)
    send(secure_store.decrypt(s.webhook), "[시험] " + title, sections, s.mention or "")
    s.last_result = f"{datetime.now():%Y-%m-%d %H:%M} 시험 보내기 성공"
    db.commit()
    return {"ok": True}


# ── 정해진 시각에 보내기 (app.py _notify_loop) ─────────
def send_due(now: Optional[datetime] = None) -> int:
    now = now or datetime.now()
    today, hm = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
    db = database.SessionLocal()
    sent = 0
    try:
        for s in db.query(NotifySetting).filter(NotifySetting.enabled == True).all():   # noqa: E712
            if not s.webhook or (s.last_sent or "") == today or hm < (s.send_time or "08:00"):
                continue
            if s.weekdays_only and now.weekday() >= 5:
                continue
            s.last_sent = today                  # 실패해도 그날은 다시 보내지 않는다 (메신저 도배 방지)
            try:
                title, sections = build_digest(db, s.engineer_id, now)
                send(secure_store.decrypt(s.webhook), title, sections, s.mention or "")
                s.last_result = f"{now:%Y-%m-%d %H:%M} 보내기 성공"
                sent += 1
            except HTTPException as e:
                s.last_result = f"{now:%Y-%m-%d %H:%M} 실패: {e.detail}"
            except Exception as e:               # 한 사람 실패가 다른 사람에게 번지지 않게
                s.last_result = f"{now:%Y-%m-%d %H:%M} 실패: {type(e).__name__}"
            db.commit()
    finally:
        db.close()
    return sent
