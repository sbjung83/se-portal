"""팀 주간보고서 — 팀장(users.is_lead)이 엔지니어들이 [제출]한 주간보고서(weekly_submissions)를 모아 본다.

취합 방식(사용자 결정 2026-11-20): 양식이 부서 한 장('서비스지원본부(주간)', 지원엔지니어 칸)이므로 **일자별로 합친다**.
- 같은 날·같은 고객사 줄은 한 줄로 합친다 (함께 간 작업이 엔지니어마다 두 번 나오지 않게).
  지원요약·교체파트·비고는 겹치지 않게 이어 붙이고, 지원엔지니어는 이름을 모으고, 구분별 건수는 큰 값을 쓴다
  (둘이 같은 점검을 같이 갔으면 1건, 한 명만 장애를 처리했으면 그 1건).
- 특이사항은 엔지니어마다 '[이름]' 머리를 붙여 이어 쓰고, 확정사항은 같은 줄을 하나로 합쳐 날짜순으로 다시 번호를 매긴다.
- 제출하지 않은 엔지니어는 목록에 '미제출'로만 나오고 내용은 들어가지 않는다.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date
from urllib.parse import quote
import io, json, re

from database import get_db, User, Engineer, WeeklySubmission
from routers.reports import _week, write_weekly_xlsx, COUNT_COLS, WD, TEMPLATE_PATH
import os

router = APIRouter(prefix="/api/team", tags=["team"])


def _members(db: Session):
    """사용 중인 계정의 엔지니어 (가입 순)."""
    names = {e.id: e.name for e in db.query(Engineer).all()}
    return [{"id": u.engineer_id, "name": names.get(u.engineer_id, u.username), "dept": u.dept or "",
             "position": u.position or ""}
            for u in db.query(User).order_by(User.created_at).all() if u.approved and u.engineer_id in names]


def _confirmed_key(line: str):
    """확정사항 한 줄 → (정렬용 M/D, 번호를 뗀 본문)."""
    body = re.sub(r"^\s*\d+[.)]\s*", "", line).strip()
    m = re.search(r"\((\d{1,2})/(\d{1,2})\)\s*$", body)
    return ((int(m[1]), int(m[2])) if m else (99, 99)), body


def build_team(start: Optional[str], db: Session) -> dict:
    mon, sun = _week(start)
    subs = {s.engineer_id: s for s in db.query(WeeklySubmission).filter(WeeklySubmission.week_start == mon.isoformat())}
    members = _members(db)
    known = {m["id"] for m in members}
    rows, engineers, notes, conf = {}, [], [], {}
    for m in members + [{"id": eid, "name": "(사용 중지된 계정)", "dept": "", "position": ""}
                        for eid in subs if eid not in known]:
        sub = subs.get(m["id"])
        snap = json.loads(sub.data or "{}") if sub else {}
        engineers.append({**m, "submitted": bool(sub), "submitted_at": sub.submitted_at if sub else "",
                          "totals": snap.get("totals") or {c: 0 for c in COUNT_COLS}, "total": snap.get("total", 0),
                          "notes": (sub.notes or "").strip() if sub else "",
                          "confirmed": (sub.confirmed or "").strip() if sub else "",
                          "rows": len(snap.get("rows", []))})
        if not sub:
            continue
        if (sub.notes or "").strip():
            notes.append(f"[{m['name']}]\n{sub.notes.strip()}")
        for line in (sub.confirmed or "").splitlines():
            if line.strip():
                key, body = _confirmed_key(line)
                c = conf.setdefault(body, {"key": key, "who": []})
                if m["name"] not in c["who"]:
                    c["who"].append(m["name"])
        for r in snap.get("rows", []):
            k = (r["date"], r["site"])
            t = rows.get(k)
            if t is None:
                t = rows[k] = {"date": r["date"], "weekday": WD[date.fromisoformat(r["date"]).weekday()], "site": r["site"],
                               "key": f'{r["date"]}|{r["site"]}', "summary": [], "parts": [], "remarks": [], "workers": [],
                               "counts": {c: 0 for c in COUNT_COLS}, "engineers": []}
            t["summary"] += [x for x in r["summary"] if x not in t["summary"]]
            t["parts"] += [x for x in (r.get("parts") or []) if x not in t["parts"]]
            rm = (r.get("remark") or "").strip()
            if rm and rm not in t["remarks"]:
                t["remarks"].append(rm)
            for w in [x.strip() for x in (r.get("workers") or "").split(",")] + [m["name"]]:
                if w and w not in t["workers"]:
                    t["workers"].append(w)
            for c in COUNT_COLS:
                t["counts"][c] = max(t["counts"][c], (r.get("counts") or {}).get(c, 0))
            t["engineers"].append(m["id"])
    out = []
    for k in sorted(rows):
        r = rows[k]
        out.append({**r, "workers": ", ".join(r["workers"]), "remark": "\n".join(r["remarks"])})
    totals = {c: sum(r["counts"][c] for r in out) for c in COUNT_COLS}
    confirmed = [f"{i}. {body}" + (f" — {', '.join(c['who'])}" if c["who"] else "")
                 for i, (body, c) in enumerate(sorted(conf.items(), key=lambda x: (x[1]["key"], x[0])), 1)]
    return {
        "start": mon.isoformat(), "end": sun.isoformat(),
        "title": f"{mon.year}년 {mon.month:02d}월 {mon.day:02d}일 ~ {sun.year}년 {sun.month:02d}월 {sun.day:02d}일 주간보고서",
        "engineers": engineers, "rows": out, "totals": totals, "total": sum(totals.values()),
        "notes": "\n\n".join(notes), "confirmed": "\n".join(confirmed),
        "submitted": sum(1 for e in engineers if e["submitted"]), "template_ok": os.path.exists(TEMPLATE_PATH),
    }


@router.get("/weekly")
def team_weekly(start: Optional[str] = None, db: Session = Depends(get_db)):
    return build_team(start, db)


@router.get("/weekly/xlsx")
def team_weekly_xlsx(start: Optional[str] = None, db: Session = Depends(get_db)):
    data = build_team(start, db)
    if not data["submitted"]:
        raise HTTPException(400, detail="이 주에 제출한 엔지니어가 없습니다")
    content = write_weekly_xlsx(data, data["notes"], data["confirmed"])
    fname = quote(f"서비스지원본부_팀_주간보고-{date.fromisoformat(data['start']):%y%m%d}.xlsx")
    return StreamingResponse(io.BytesIO(content),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"})
