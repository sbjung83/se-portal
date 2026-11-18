"""구글 캘린더 연동: 비공개 iCal 주소를 주기적으로 읽어 점검 일정 / 기술지원 / 장애처리로 등록한다.

제목 규칙: "[종류] 고객사이름 - 엔지니어이름"  (예: "[점검] A병원 - 홍길동")
 - 엔지니어 이름에 본인이 들어 있는 일정만 가져온다.
 - [점검] → 점검 일정(Schedule), [기술지원]/[납품]/[원격]/[이전]/[기타] → 기술지원(WorkPlan)
 - [점검 및 기술지원] 처럼 함께 적으면 점검 일정 1건으로 만들고 지원 구분을 extra_types 에 체크한다
 - [장애처리] → 장애처리(Incident) 1건 (상태 접수·등급 보통, 발생일 = 일정 날짜, 캘린더 설명 → 장애 증상)
   [점검/장애처리] [기술지원 및 장애처리] 처럼 함께 적으면 그 일정에 연결된 장애(Incident.entry_id)를 함께 만든다
   구글에서 지워져도 보고서 내용(원인·조치·파트 등)을 적었거나 처리를 시작한 장애는 지우지 않고 남긴다.
 - 사이트를 못 찾거나 종류를 알 수 없으면 '확인 대기' 로 두고 사용자가 직접 등록한다.
 - 구글에서 날짜·제목이 바뀌거나 일정이 지워지면 반영하되, 포털에서 완료 처리한 건은 건드리지 않는다.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, SessionLocal, Engineer, Site, Schedule, WorkPlan, Incident, CalendarLink, CalendarEvent
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
import re, uuid, logging, html
import httpx
import secure_store

router = APIRouter(prefix="/api/engineers/{eng_id}/calendar", tags=["calendar"])
log = logging.getLogger("uvicorn.error")

KST = ZoneInfo("Asia/Seoul")
URL_PREFIX = "https://calendar.google.com/calendar/ical/"
FUTURE_DAYS = 180                      # 시작일(연동 설정)부터 오늘 + 이 일수까지의 일정만 다룬다
SYNC_MINUTES = 10                      # 자동으로 읽어 오는 간격

KIND_SCHEDULE, KIND_SUPPORT, KIND_INCIDENT = "점검", "기술지원", "장애처리"
ST_DONE, ST_WAIT, ST_IGNORE, ST_GONE = "등록", "확인 대기", "무시", "포털에서 삭제"
SUPPORT_TAGS = {"기술지원": "기술지원", "지원": "기술지원", "납품": "납품", "원격": "유선원격", "유선": "유선원격",
                "유선원격": "유선원격", "원격지원": "유선원격", "이전": "이전", "기타": "기타"}
SUPPORT_TYPES = ("기술지원", "납품", "유선원격", "이전", "기타")
SCHED_TYPES = ("월간", "분기", "특별")
SCHED_TITLES = {"월간": "PM", "분기": "분기 점검", "특별": "특별 점검"}

_norm = lambda s: re.sub(r"\s+", "", s or "").lower()


# ── 제목 해석 ─────────────────────────────
def parse_title(summary: str):
    """'[종류] 고객사 - 엔지니어' → (tag, customer, [engineers]). 규칙에 맞지 않으면 None."""
    m = re.match(r"^\s*\[([^\]]+)\]\s*(.+?)\s*$", summary or "")
    if not m:
        return None
    tag, rest = m.group(1).strip(), m.group(2)
    parts = re.split(r"\s+[-–—]\s+", rest)          # 고객사 이름 안의 붙은 하이픈은 건드리지 않도록 양쪽 공백 필요
    if len(parts) < 2:
        return None
    customer = " - ".join(parts[:-1]).strip()
    engineers = [p.strip() for p in re.split(r"[,/·、&]|\s+", parts[-1]) if p.strip()]
    if not customer or not engineers:
        return None
    return tag, customer, engineers


def classify(tag: str):
    """태그 → (kind, 세부 구분, 함께 한 지원 구분 목록, 장애처리 여부). 알 수 없으면 ('', '', [], False).
    '[점검 및 기술지원]', '[점검/납품]', '[점검/장애처리]' 처럼 여러 개를 함께 적을 수 있다.
     - 점검이 들어 있으면 kind='점검', 세부 구분=월간/분기/특별, 나머지는 함께 한 지원 구분
     - 점검이 없으면 kind='기술지원', 세부 구분=지원 구분들을 쉼표로 이은 값
     - 장애처리만 있으면 kind='장애처리'. 다른 것과 함께면 그 일정에 장애를 연결한다(네 번째 값 True)"""
    tokens = [t for t in re.split(r"[\s,/+&·]+|및", tag or "") if t]
    check, sched, supports, inc = False, "월간", [], False
    for tok in tokens:
        t = _norm(tok)
        if t == KIND_INCIDENT:
            inc = True
        elif "점검" in t or t == "pm":
            check = True
            sched = "분기" if "분기" in t else "특별" if "특별" in t else sched
        elif t in SUPPORT_TAGS:
            if SUPPORT_TAGS[t] not in supports:
                supports.append(SUPPORT_TAGS[t])
        else:
            return "", "", [], False                   # 모르는 단어가 섞여 있으면 자동 등록하지 않는다
    supports = [t for t in SUPPORT_TYPES if t in supports]
    if check:
        return KIND_SCHEDULE, sched, supports, inc
    if supports:
        return KIND_SUPPORT, ",".join(supports), [], inc
    if inc:
        return KIND_INCIDENT, "", [], True
    return "", "", [], False


def match_site(customer: str, sites):
    """고객사 이름으로 사이트 찾기: 같은 이름 우선, 아니면 한쪽이 다른 쪽을 포함하는 사이트가 하나뿐일 때."""
    c = _norm(customer)
    exact = [s for s in sites if _norm(s.name) == c]
    if len(exact) == 1:
        return exact[0]
    part = [s for s in sites if c and (c in _norm(s.name) or _norm(s.name) in c)]
    return part[0] if len(exact) == 0 and len(part) == 1 else None


# ── 캘린더 읽기 ───────────────────────────
def _parse_day(v):
    try:
        return datetime.strptime((v or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _to_date(v) -> str:
    if isinstance(v, datetime):
        if v.tzinfo is not None:
            v = v.astimezone(KST)
        return v.strftime("%Y-%m-%d")
    return v.strftime("%Y-%m-%d")


def _clean_desc(v) -> str:
    """구글 캘린더 설명(HTML 이 섞여 올 수 있음)을 일반 글로 바꾼다."""
    t = str(v or "")
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(l.rstrip() for l in t.splitlines())).strip()


def fetch_events(url: str, start: str = "", today: date = None):
    """iCal 주소를 읽어 (범위 안의 일정 [{key, summary, date}], 전체 일정 수, (범위 시작, 끝)) 을 돌려준다."""
    r = httpx.get(url, timeout=30, follow_redirects=True)
    if r.status_code != 200:
        raise ValueError(f"캘린더 주소에서 응답을 받지 못했습니다 (HTTP {r.status_code})")
    return parse_ics(r.content, start, today)


def parse_ics(content: bytes, start: str = "", today: date = None):
    import icalendar, recurring_ical_events
    try:
        cal = icalendar.Calendar.from_ical(content)
    except Exception:
        raise ValueError("캘린더 형식(iCal)이 아닙니다. 주소를 다시 확인해주세요")
    today = today or datetime.now(KST).date()
    start = _parse_day(start) or today              # 시작일이 없으면 오늘부터
    end = max(today, start) + timedelta(days=FUTURE_DAYS)
    out, total, repeating = {}, 0, set()
    for comp in cal.walk("VEVENT"):
        total += 1
        if comp.get("RRULE") is not None or comp.get("RDATE") is not None or comp.get("RECURRENCE-ID") is not None:
            repeating.add(str(comp.get("UID", "")).strip())
    for ev in recurring_ical_events.of(cal).between(start, end + timedelta(days=1)):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        uid = str(ev.get("UID", "")).strip()
        if not uid or ev.get("DTSTART") is None:
            continue
        d = _to_date(ev["DTSTART"].dt)
        if not (start.isoformat() <= d <= end.isoformat()):
            continue
        key = uid                                          # 한 번짜리 일정: 날짜를 옮겨도 같은 일정으로 본다
        if uid in repeating:                               # 반복 일정: 회차(원래 날짜)별로 따로 다룬다
            rid = ev.get("RECURRENCE-ID")
            key = f"{uid}|{_to_date(rid.dt) if rid is not None else d}"
        out[key] = {"key": key, "summary": str(ev.get("SUMMARY", "")).strip(), "date": d,
                    "desc": _clean_desc(ev.get("DESCRIPTION"))}
    return list(out.values()), total, (start.isoformat(), end.isoformat())


# ── 포털 레코드 만들기 / 고치기 ───────────────
IMPORT_NOTE = "구글 캘린더에서 가져옴"

def _apply_desc(obj, old_desc: str, new_desc: str, only_empty: bool = False):
    """캘린더 설명을 기술지원의 '작업 목적'(점검 일정은 메모, 장애는 증상)에 넣는다. 포털에서 직접 고친 내용은 덮어쓰지 않는다."""
    field = "memo" if isinstance(obj, Schedule) else "symptom" if isinstance(obj, Incident) else "purpose"
    note = "" if isinstance(obj, Incident) else IMPORT_NOTE      # 장애 보고서에 '가져옴' 문구가 찍히지 않도록
    cur = (getattr(obj, field) or "").strip()
    replaceable = (cur == "") if only_empty else cur in ("", IMPORT_NOTE, (old_desc or "").strip())
    if replaceable and (new_desc or not only_empty) and cur != (new_desc or note):
        setattr(obj, field, new_desc or note)
        return True
    return False


def _used_ids(db, eng):
    return {r.target_id for r in db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng.id, CalendarEvent.target_id != "")}


def _find_incident(db, eng, row: CalendarEvent, site):
    """같은 날·같은 사이트의 장애처리만 한 건(일정과 연결되지 않고, 다른 캘린더 일정과도 연결되지 않은 것)."""
    names = {_norm(row.customer)} | ({_norm(site.name)} if site else set())
    used = _used_ids(db, eng)
    return next((i for i in db.query(Incident).filter(Incident.engineer_id == eng.id).order_by(Incident.created_at).all()
                 if not (i.entry_id or "") and (i.occurred_at or "")[:10] == row.event_date
                 and _norm(i.site) in names and i.id not in used), None)


def _new_incident(db, eng, row: CalendarEvent, site, entry_id: str = ""):
    """캘린더 일정으로 장애처리 1건을 만든다. 같은 날·같은 사이트의 장애처리만 한 건이 있으면 그것을 쓴다."""
    inc = _find_incident(db, eng, row, site)
    if inc is not None:
        inc.entry_id = entry_id
        if not entry_id:
            _apply_desc(inc, "", row.description, only_empty=True)
        return inc, True
    inc = Incident(id=str(uuid.uuid4()), engineer_id=eng.id, title=f"{row.customer} 장애처리",
                   site=site.name if site else row.customer, severity="보통", status="접수",
                   occurred_at=row.event_date, worker=row.workers or eng.name,
                   symptom="" if entry_id else (row.description or ""),
                   created_at=datetime.now(KST).strftime("%Y-%m-%d"), entry_id=entry_id)
    db.add(inc)
    return inc, False


def _inc_in_use(inc: Incident, desc: str) -> bool:
    """사용자가 보고서를 쓰기 시작했거나 처리를 진행한 장애인지 (구글에서 지워져도 남길 것)."""
    if (inc.status or "접수") != "접수" or (inc.recovered_at or "") or (inc.device or "").strip():
        return True
    if any((getattr(inc, f) or "").strip() for f in ("cause", "action", "prevention")):
        return True
    if (inc.parts or "").strip() not in ("", "[]"):
        return True
    return (inc.symptom or "").strip() not in ("", (desc or "").strip())


def _linked_incidents(db, obj):
    return db.query(Incident).filter(Incident.engineer_id == obj.engineer_id, Incident.entry_id == obj.id).all()


def _move_incident(inc: Incident, old_date: str, new_date: str, site_name: str):
    """일정 날짜·사이트가 바뀌면 장애의 발생일·사이트도 따라 바꾼다 (사용자가 따로 고친 발생일은 그대로)."""
    if (inc.occurred_at or "")[:10] == old_date:
        inc.occurred_at = new_date + (inc.occurred_at or "")[10:]
    if site_name:
        inc.site = site_name


def _find_existing(db, eng, row: CalendarEvent, site):
    """포털에 이미 같은 날·같은 사이트로 등록된 건(다른 캘린더 일정과 연결되지 않은 것)을 찾는다."""
    if row.kind == KIND_INCIDENT:
        return _find_incident(db, eng, row, site)
    used = _used_ids(db, eng)
    if row.kind == KIND_SCHEDULE:
        cands = db.query(Schedule).filter(Schedule.engineer_id == eng.id, Schedule.site_id == site.id,
                                          Schedule.sched_date == row.event_date).all()
    else:
        names = {_norm(row.customer)} | ({_norm(site.name)} if site else set())
        cands = [w for w in db.query(WorkPlan).filter(WorkPlan.engineer_id == eng.id, WorkPlan.id.startswith("wp-"),
                                                      WorkPlan.work_date == row.event_date).all() if _norm(w.site) in names]
    return next((c for c in cands if c.id not in used), None)


TARGET_TYPES = {KIND_SCHEDULE: "schedule", KIND_SUPPORT: "workplan", KIND_INCIDENT: "incident"}


def _make_target(db, eng, row: CalendarEvent, site, sub: str, extra=(), inc: bool = False):
    """row 내용으로 점검 일정 / 기술지원 / 장애처리를 만든다. 이미 같은 건이 있으면 새로 만들지 않고 그 건에 연결한다.
    inc=True 면 (점검·기술지원에) 연결된 장애처리도 함께 만든다."""
    old = _find_existing(db, eng, row, site)
    if old is not None:
        row.target_type = TARGET_TYPES[row.kind]
        row.target_id, row.site_id, row.adopted = old.id, (site.id if site else ""), True
        row.sub_type = old.sched_type if row.kind == KIND_SCHEDULE else "" if row.kind == KIND_INCIDENT else old.support_type
        row.state, row.reason = ST_DONE, ""
        _apply_desc(old, "", row.description, only_empty=True)
        if row.kind == KIND_SCHEDULE and extra and not (old.extra_types or ""):
            old.extra_types = ",".join(extra)
        if inc and row.kind != KIND_INCIDENT and not _linked_incidents(db, old):
            _new_incident(db, eng, row, site, entry_id=old.id)
        return
    row.adopted = False
    if row.kind == KIND_INCIDENT:
        obj, _ = _new_incident(db, eng, row, site)
        row.target_type, row.target_id, row.site_id, row.sub_type = "incident", obj.id, (site.id if site else ""), ""
        row.state, row.reason = ST_DONE, ""
        return
    if row.kind == KIND_SCHEDULE:
        sub = sub if sub in SCHED_TYPES else "월간"
        obj = Schedule(id=str(uuid.uuid4()), site_id=site.id, engineer_id=eng.id, title=SCHED_TITLES[sub],
                       sched_date=row.event_date, sched_type=sub, status="예정", memo=row.description or IMPORT_NOTE,
                       extra_types=",".join(extra))
        row.target_type = "schedule"
        if _norm(row.workers) not in ("", _norm(eng.name)):      # 여러 명이 함께 가는 점검: 작업자를 연동 레코드에 남긴다
            db.add(WorkPlan(id=obj.id, engineer_id=eng.id, title=obj.title, work_date=obj.sched_date, site=site.name,
                            worker=row.workers, status="예정", purpose="", support_type="기술지원"))
    else:
        sub = ",".join(t for t in SUPPORT_TYPES if t in (sub or "").split(",")) or "기술지원"
        obj = WorkPlan(id=f"wp-{uuid.uuid4().hex[:8]}", engineer_id=eng.id, title=f"{row.customer} {sub.replace(',', '·')}",
                       work_date=row.event_date, site=(site.name if site else row.customer), worker=row.workers or eng.name,
                       status="예정", support_type=sub, purpose=row.description or IMPORT_NOTE)
        row.target_type = "workplan"
    db.add(obj)
    row.target_id, row.site_id, row.sub_type = obj.id, (site.id if site else ""), sub
    row.state, row.reason = ST_DONE, ""
    if inc:
        _new_incident(db, eng, row, site, entry_id=obj.id)


def _target(db, row: CalendarEvent):
    if row.target_type == "schedule":
        return db.query(Schedule).filter(Schedule.id == row.target_id, Schedule.engineer_id == row.engineer_id).first()
    if row.target_type == "workplan":
        return db.query(WorkPlan).filter(WorkPlan.id == row.target_id, WorkPlan.engineer_id == row.engineer_id).first()
    if row.target_type == "incident":
        return db.query(Incident).filter(Incident.id == row.target_id, Incident.engineer_id == row.engineer_id).first()
    return None


def _is_finished(obj) -> bool:
    return obj.status == "완료"


def _resolve(db, eng, row: CalendarEvent, tag: str, sites):
    """확인 대기 → 종류와 사이트가 정해지면 등록."""
    kind, sub, extra, inc = classify(tag)
    row.kind, row.sub_type = kind, sub
    if not kind:
        row.state, row.reason = ST_WAIT, f"[{tag}] 가 어떤 종류인지 알 수 없음"
        return
    site = match_site(row.customer, sites)
    if kind == KIND_SCHEDULE and not site:
        row.state, row.reason = ST_WAIT, "고객사 이름과 맞는 사이트를 찾지 못함"
        return
    _make_target(db, eng, row, site, sub, extra, inc)


def sync_engineer(db: Session, eng_id: str, events=None) -> dict:
    """한 엔지니어의 캘린더를 읽어 반영하고 결과 요약을 돌려준다. events 를 넘기면 주소를 읽지 않는다(시험용)."""
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    link = db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).first()
    if not eng or not link:
        raise ValueError("캘린더 주소가 등록되어 있지 않습니다")
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    try:
        evs, total, (w_start, w_end) = events if events is not None else fetch_events(secure_store.decrypt(link.url), link.start_date)
    except Exception as e:
        link.last_sync, link.last_result = now, f"실패: {e if isinstance(e, ValueError) else '캘린더 주소에 접속하지 못했습니다'}"
        db.commit()
        raise ValueError(link.last_result)

    sites = db.query(Site).filter(Site.engineer_id == eng_id).all()
    rows = {r.event_key: r for r in db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id).all()}
    me, seen = _norm(eng.name), set()
    n = {"added": 0, "linked": 0, "waiting": 0, "updated": 0, "removed": 0}
    def count(row):
        n["waiting" if row.state != ST_DONE else "linked" if row.adopted else "added"] += 1

    for ev in evs:
        parsed = parse_title(ev["summary"])
        if not parsed:
            continue
        tag, customer, engineers = parsed
        if me not in [_norm(x) for x in engineers]:
            continue                                   # 다른 엔지니어 일정
        seen.add(ev["key"])
        row = rows.get(ev["key"])
        workers = ", ".join(engineers)
        if row is None:
            row = CalendarEvent(id=str(uuid.uuid4()), engineer_id=eng_id, event_key=ev["key"], summary=ev["summary"],
                                event_date=ev["date"], customer=customer, workers=workers, state=ST_WAIT,
                                description=ev.get("desc", ""))
            db.add(row)
            _resolve(db, eng, row, tag, sites)
            db.flush()                                 # 다음 일정이 같은 포털 건에 또 연결되지 않도록
            count(row)
            continue
        changed = (row.summary != ev["summary"] or row.event_date != ev["date"])
        old_date, old_desc, new_desc = row.event_date, row.description or "", ev.get("desc", "")
        row.summary, row.event_date, row.customer, row.workers = ev["summary"], ev["date"], customer, workers
        row.description = new_desc
        if row.state == ST_WAIT:
            _resolve(db, eng, row, tag, sites)
            if row.state == ST_DONE:
                db.flush()
                count(row)
        elif row.state == ST_DONE:
            obj = _target(db, row)
            if obj is None:
                row.state = ST_GONE                    # 포털에서 직접 지운 건은 다시 만들지 않는다
            elif not _is_finished(obj) and old_desc != new_desc and not changed:
                if _apply_desc(obj, old_desc, new_desc, only_empty=bool(row.adopted)):
                    n["updated"] += 1
            elif changed and not _is_finished(obj):
                _apply_desc(obj, old_desc, new_desc, only_empty=bool(row.adopted))
                kind = classify(tag)[0]
                if kind == row.kind:                   # 종류가 바뀐 경우는 건드리지 않음
                    site = match_site(customer, sites)
                    if isinstance(obj, Incident):
                        _move_incident(obj, old_date, ev["date"], site.name if site else customer)
                    else:
                        if isinstance(obj, Schedule):
                            if obj.sched_date == old_date: obj.sched_date = ev["date"]
                            if site: obj.site_id, row.site_id = site.id, site.id
                        else:
                            if obj.work_date == old_date: obj.work_date = ev["date"]
                            obj.site = site.name if site else customer
                        for li in _linked_incidents(db, obj):
                            if not _is_finished(li):
                                _move_incident(li, old_date, ev["date"], site.name if site else ("" if isinstance(obj, Schedule) else customer))
                    n["updated"] += 1

    # 구글에서 지워졌거나(또는 내 이름이 빠진) 일정: 완료 전이면 포털에서도 지운다
    if total > 0:
        for key, row in rows.items():
            if key in seen or row.state not in (ST_DONE, ST_WAIT) or not (w_start <= (row.event_date or "") <= w_end):
                continue
            if row.state == ST_DONE:
                obj = _target(db, row)
                if obj is not None and _is_finished(obj):
                    continue                           # 완료 처리한 건은 그대로 둔다
                if obj is not None and not row.adopted:    # 포털에 원래 있던 건은 연결만 끊는다
                    if isinstance(obj, Incident):
                        if not _inc_in_use(obj, row.description):    # 보고서를 쓰기 시작한 장애는 남긴다
                            db.delete(obj)
                            n["removed"] += 1
                    else:
                        for li in _linked_incidents(db, obj):
                            if _inc_in_use(li, ""):
                                li.entry_id = ""        # 일정은 지우고 장애 기록은 단독으로 남긴다
                            else:
                                db.delete(li)
                        if isinstance(obj, Schedule):
                            db.query(WorkPlan).filter(WorkPlan.id == obj.id, WorkPlan.engineer_id == eng_id).delete()
                        db.delete(obj)
                        n["removed"] += 1
            db.delete(row)

    link.last_sync = now
    link.last_result = f"새로 등록 {n['added']}건 · 기존 일정과 연결 {n['linked']}건 · 확인 대기 {n['waiting']}건 · 변경 반영 {n['updated']}건 · 삭제 반영 {n['removed']}건"
    db.commit()
    return n


def sync_all():
    """등록된 모든 캘린더를 읽는다 (app.py 의 주기 작업에서 호출)."""
    db = SessionLocal()
    try:
        ids = [l.engineer_id for l in db.query(CalendarLink).all()]
    finally:
        db.close()
    for eng_id in ids:
        db = SessionLocal()
        try:
            sync_engineer(db, eng_id)
        except Exception as e:
            db.rollback()
            log.warning("캘린더 가져오기 실패 (%s): %s", eng_id, e)
        finally:
            db.close()


# ── API ───────────────────────────────────
class LinkIn(BaseModel):
    url: str
    start_date: Optional[str] = None    # 이 날짜 이후 일정만 가져온다 (비우면 오늘)

class StartIn(BaseModel):
    start_date: str

class RegisterIn(BaseModel):
    kind: str                           # 점검 / 기술지원 / 장애처리
    sub_type: Optional[str] = None      # 점검: 월간/분기/특별, 기술지원: 기술지원/납품/유선원격/이전/기타
    site_id: Optional[str] = None


def _ev_dict(r: CalendarEvent, site_names: dict, inc_links=frozenset()):
    return {"id": r.id, "summary": r.summary, "event_date": r.event_date, "customer": r.customer, "workers": r.workers,
            "kind": r.kind, "sub_type": r.sub_type, "state": r.state, "reason": r.reason,
            "adopted": bool(r.adopted), "site_id": r.site_id, "site_name": site_names.get(r.site_id, ""), "target_type": r.target_type,
            "with_incident": r.target_type in ("schedule", "workplan") and r.target_id in inc_links}


@router.get("")
def get_calendar(eng_id: str, db: Session = Depends(get_db)):
    link = db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).first()
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    names = {s.id: s.name for s in db.query(Site).filter(Site.engineer_id == eng_id).all()}
    rows = db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id).order_by(CalendarEvent.event_date.desc()).all()
    inc_links = {i.entry_id for i in db.query(Incident.entry_id).filter(Incident.engineer_id == eng_id, Incident.entry_id != "")}
    return {
        "linked": bool(link),
        "last_sync": link.last_sync if link else "",
        "last_result": link.last_result if link else "",
        "start_date": link.start_date if link else "",
        "today": datetime.now(KST).strftime("%Y-%m-%d"),
        "engineer_name": eng.name if eng else "",
        "sync_minutes": SYNC_MINUTES,
        "events": [_ev_dict(r, names, inc_links) for r in rows],
    }


@router.post("/link")
def save_link(eng_id: str, data: LinkIn, db: Session = Depends(get_db)):
    url = (data.url or "").strip()
    if not url.startswith(URL_PREFIX) or not url.endswith(".ics"):
        raise HTTPException(400, detail="구글 캘린더의 'iCal 형식의 비공개 주소'를 넣어주세요 (https://calendar.google.com/calendar/ical/… .ics)")
    if data.start_date and not _parse_day(data.start_date):
        raise HTTPException(400, detail="시작일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    try:
        fetch_events(url)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception:
        raise HTTPException(400, detail="캘린더 주소에 접속하지 못했습니다")
    link = db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).first()
    if not link:
        link = CalendarLink(engineer_id=eng_id)
        db.add(link)
    link.url = secure_store.encrypt(url)
    if data.start_date or not link.start_date:
        link.start_date = data.start_date or datetime.now(KST).strftime("%Y-%m-%d")
    db.commit()
    try:
        sync_engineer(db, eng_id)
    except ValueError as e:
        raise HTTPException(502, detail=str(e))
    return {"ok": True}


@router.post("/start")
def set_start(eng_id: str, data: StartIn, db: Session = Depends(get_db)):
    """가져오기 시작일 변경 후 바로 다시 읽는다. (시작일 이전에 이미 가져온 건은 그대로 둔다)"""
    link = db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).first()
    if not link:
        raise HTTPException(400, detail="캘린더 주소를 먼저 등록해주세요")
    if not _parse_day(data.start_date):
        raise HTTPException(400, detail="시작일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    link.start_date = data.start_date[:10]
    db.commit()
    try:
        return sync_engineer(db, eng_id)
    except ValueError as e:
        raise HTTPException(502, detail=str(e))


@router.delete("/link")
def delete_link(eng_id: str, db: Session = Depends(get_db)):
    """연동 해제. 이미 등록된 점검 일정·기술지원·장애처리는 그대로 둔다."""
    db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).delete()
    db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id).delete()
    db.commit()
    return {"ok": True}


@router.post("/sync")
def sync_now(eng_id: str, db: Session = Depends(get_db)):
    if not db.query(CalendarLink).filter(CalendarLink.engineer_id == eng_id).first():
        raise HTTPException(400, detail="캘린더 주소를 먼저 등록해주세요")
    try:
        return sync_engineer(db, eng_id)
    except ValueError as e:
        raise HTTPException(502, detail=str(e))


def _get_event(db, eng_id, ev_id) -> CalendarEvent:
    row = db.query(CalendarEvent).filter(CalendarEvent.id == ev_id, CalendarEvent.engineer_id == eng_id).first()
    if not row:
        raise HTTPException(404, detail="일정을 찾을 수 없습니다")
    return row


@router.post("/events/{ev_id}/register")
def register_event(eng_id: str, ev_id: str, data: RegisterIn, db: Session = Depends(get_db)):
    """확인 대기 일정을 사용자가 고른 종류·사이트로 등록."""
    row = _get_event(db, eng_id, ev_id)
    if row.state not in (ST_WAIT, ST_IGNORE):
        raise HTTPException(400, detail="이미 처리된 일정입니다")
    if data.kind not in (KIND_SCHEDULE, KIND_SUPPORT, KIND_INCIDENT):
        raise HTTPException(400, detail="종류는 점검 / 기술지원 / 장애처리 중 하나여야 합니다")
    site = None
    if data.site_id:
        site = db.query(Site).filter(Site.id == data.site_id, Site.engineer_id == eng_id).first()
        if not site:
            raise HTTPException(404, detail="사이트를 찾을 수 없습니다")
    if data.kind == KIND_SCHEDULE and not site:
        raise HTTPException(400, detail="점검 일정은 사이트를 골라야 합니다")
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    row.kind = data.kind
    _make_target(db, eng, row, site, data.sub_type or "")
    db.commit()
    return {"ok": True}


@router.post("/events/{ev_id}/ignore")
def ignore_event(eng_id: str, ev_id: str, db: Session = Depends(get_db)):
    row = _get_event(db, eng_id, ev_id)
    if row.state != ST_WAIT:
        raise HTTPException(400, detail="확인 대기 중인 일정만 무시할 수 있습니다")
    row.state = ST_IGNORE
    db.commit()
    return {"ok": True}


@router.post("/events/{ev_id}/reimport")
def reimport_event(eng_id: str, ev_id: str, db: Session = Depends(get_db)):
    """포털에서 지워서 '포털에서 삭제'로 남은 캘린더 일정을 다시 등록한다."""
    row = _get_event(db, eng_id, ev_id)
    if row.state != ST_GONE:
        raise HTTPException(400, detail="포털에서 삭제한 일정만 다시 가져올 수 있습니다")
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    parsed = parse_title(row.summary)
    if not parsed:
        raise HTTPException(400, detail="캘린더 제목이 규칙과 맞지 않습니다")
    row.target_type, row.target_id, row.adopted = "", "", False
    _resolve(db, eng, row, parsed[0], db.query(Site).filter(Site.engineer_id == eng_id).all())
    db.commit()
    return {"ok": True, "state": row.state}


@router.post("/events/{ev_id}/restore")
def restore_event(eng_id: str, ev_id: str, db: Session = Depends(get_db)):
    row = _get_event(db, eng_id, ev_id)
    if row.state != ST_IGNORE:
        raise HTTPException(400, detail="무시한 일정만 되돌릴 수 있습니다")
    row.state = ST_WAIT
    db.commit()
    return {"ok": True}
