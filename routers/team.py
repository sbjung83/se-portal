"""팀 주간보고서 — 팀장(users.is_lead)이 엔지니어들이 [제출]한 주간보고서(weekly_submissions)를 모아 본다.

취합 방식(사용자 결정 2026-11-20): 양식이 부서 한 장('서비스지원본부(주간)', 지원엔지니어 칸)이므로 **일자별로 합친다**.
- 같은 날·같은 고객사 줄은 한 줄로 합친다 (함께 간 작업이 엔지니어마다 두 번 나오지 않게).
  지원요약·교체파트·비고는 겹치지 않게 이어 붙이고, 지원엔지니어는 이름을 모으고, 구분별 건수는 큰 값을 쓴다
  (둘이 같은 점검을 같이 갔으면 1건, 한 명만 장애를 처리했으면 그 1건).
- 엔지니어 특이사항은 제출 현황 표에만 나오고, 아래 특이사항 칸은 팀장이 직접 쓴다(team_weekly_notes, 기본 빈칸).
  확정사항은 같은 줄을 하나로 합쳐 날짜순으로 다시 번호를 매긴다.
- 제출하지 않은 엔지니어는 목록에 '미제출'로만 나오고 내용은 들어가지 않는다.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date
from urllib.parse import quote
import io, json, re

from database import get_db, User, Engineer, WeeklySubmission, TeamWeeklyNote
from routers.auth import require_lead
from pydantic import BaseModel
from datetime import datetime
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
    rows, engineers, conf = {}, [], {}
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
        "notes": (lambda n: n.text if n else "")(db.get(TeamWeeklyNote, mon.isoformat())),   # 팀장이 직접 쓴 특이사항
        "notes_by": (lambda n: f"{n.updated_by} {n.updated_at}" if n and n.text else "")(db.get(TeamWeeklyNote, mon.isoformat())),
        "confirmed": "\n".join(confirmed),
        "submitted": sum(1 for e in engineers if e["submitted"]), "template_ok": os.path.exists(TEMPLATE_PATH),
    }


STATUS_COLS = [("F", "정기점검"), ("G", "장애지원"), ("H", "기술지원"), ("I", "납품"), ("J", "원격"), ("K", "이전"), ("L", "기타")]

def _est_lines(text: str, width: float, size: float = 10) -> int:
    """칸 너비(엑셀 열 너비 단위)에서 몇 줄로 보이는지 어림.
    맑은 고딕 10pt 기준 한글 1자 ≈ 1.8칸, 영문·숫자 ≈ 0.95칸, 들여쓰기·여백 3칸. 모자라면 잘리므로 살짝 넉넉하게."""
    per = max(width * 10 / size - 3, 4)
    n = 0
    for line in str(text or "").split("\n"):
        w = sum(1.8 if ord(ch) > 0x2E7F else 0.95 for ch in line)
        n += max(1, -(-w // per))
    return int(n)

def _page_sheet(wb, data: dict):
    """팀 주간보고서 화면과 같은 구성의 첫 시트: 요약 → 엔지니어별 제출 현황 → 지원 내역 → 특이사항·확정사항.
    열: B 고객사/엔지니어 · C~E (지원일자·지원요약·교체파트 / 제출 병합) · F~L 구분별 건수(두 표가 같은 열) · M 지원엔지니어/합계 · N 비고/특이사항."""
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    ws = wb.create_sheet("팀 주간보고서", 0)
    wb.active = 0
    F = lambda c: PatternFill("solid", fgColor=c)
    HEAD, BAR, ON, FOOT, NAVY = F("E2E8F0"), F("EEF2F7"), F("EFF6FF"), F("F1F5F9"), F("2F3D56")
    ln = Side(style="thin", color="CBD5E1")
    box = Border(left=ln, right=ln, top=ln, bottom=ln)
    C = Alignment(horizontal="center", vertical="center", wrap_text=True)
    L = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
    LT = Alignment(horizontal="left", vertical="top", wrap_text=True, indent=1)
    R = Alignment(horizontal="right", vertical="center", indent=1)
    widths = {"A": 2, "B": 26, "C": 13, "D": 40, "E": 20, "M": 15, "N": 38}
    for col in "FGHIJKL":
        widths[col] = 8.5
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    cols = "BCDEFGHIJKLMN"

    def put(r, col, v, fill=None, font=None, al=C, border=True):
        c = ws[f"{col}{r}"]
        c.value = v
        if fill: c.fill = fill
        c.font = font or Font(size=10, color="1E293B")
        c.alignment = al
        if border: c.border = box
        return c

    def merge(r, a, b, v, **kw):
        for col in cols[cols.index(a):cols.index(b) + 1]:
            put(r, col, None, **{k: x for k, x in kw.items() if k in ("fill", "border")})
        ws.merge_cells(f"{a}{r}:{b}{r}")
        return put(r, a, v, **kw)

    def bar(r, title, sub=""):           # 구역 머리 (화면 .wr-box-head)
        merge(r, "B", "N", f"{title}    {sub}" if sub else title, fill=BAR, font=Font(size=11, bold=True, color="334155"), al=L)
        ws.row_dimensions[r].height = 24

    def num(r, col, v, on_fill=True, bold=True):
        put(r, col, v or None, fill=ON if (v and on_fill) else None,
            font=Font(size=10, bold=bold, color="1D4ED8" if v else "94A3B8"))

    mon = date.fromisoformat(data["start"]); sun = date.fromisoformat(data["end"])
    wk = f"{mon.year}년 {mon.month}월 {-(-mon.day // 7)}주차"
    md = lambda d: f"{d.month}/{d.day} ({'월화수목금토일'[d.weekday()]})"
    # 제목
    ws.merge_cells("B1:N1")
    put(1, "B", f"팀 주간보고서   {wk}  ·  {md(mon)} ~ {md(sun)}", font=Font(size=16, bold=True, color="0F172A"),
        al=Alignment(horizontal="left", vertical="center"), border=False)
    ws.row_dimensions[1].height = 32
    # 요약 (화면 .wr-sum: 제출 · 구분별 · 합계) — 구분별은 아래 표의 같은 열
    t, total, engs = data["totals"], data["total"], data["engineers"]
    r = 3
    put(r, "B", "제출", fill=HEAD, font=Font(size=9, bold=True, color="475569"))
    merge(r, "C", "E", "기간", fill=HEAD, font=Font(size=9, bold=True, color="475569"))
    for col, name in STATUS_COLS:
        put(r, col, name, fill=HEAD, font=Font(size=9, bold=True, color="475569"))
    merge(r, "M", "N", "합계", fill=NAVY, font=Font(size=9, bold=True, color="DBE6F3"))
    r = 4
    put(r, "B", f"{data['submitted']} / {len(engs)}", font=Font(size=15, bold=True, color="B45309" if data["submitted"] < len(engs) else "0F172A"))
    merge(r, "C", "E", f"{mon.isoformat()} ~ {sun.isoformat()}", font=Font(size=11, bold=True, color="334155"))
    for col, _ in STATUS_COLS:
        v = t.get(col, 0)
        put(r, col, v, font=Font(size=15, bold=True, color=("DC2626" if col == "G" else "0F172A") if v else "CBD5E1"))
    merge(r, "M", "N", f"{total}건", fill=NAVY, font=Font(size=15, bold=True, color="FFFFFF"))
    ws.row_dimensions[4].height = 30

    # 엔지니어별 제출 현황
    r = 6
    n_sub = data["submitted"]
    bar(r, "엔지니어별 제출 현황", f"{n_sub}명 제출 · {len(engs) - n_sub}명 미제출")
    r += 1
    # 칸 배치: B 엔지니어 · C 제출 시각 · D~E 특이사항(넓은 칸) · F~L 구분별 · M~N 합계 (위 요약 줄과 같은 열)
    H = lambda sz=10: Font(size=sz, bold=True, color="334155")
    put(r, "B", "엔지니어", fill=HEAD, font=H(), al=L)
    put(r, "C", "제출", fill=HEAD, font=H())
    merge(r, "D", "E", "특이사항", fill=HEAD, font=H(), al=L)
    for col, name in STATUS_COLS:
        put(r, col, name, fill=HEAD, font=H(9))
    merge(r, "M", "N", "합계", fill=HEAD, font=H())
    ws.row_dimensions[r].height = 22
    for e in engs:
        r += 1
        sub = e["submitted"]
        gray = Font(size=10, color="94A3B8")
        put(r, "B", e["name"] + (f"  {e['position']}" if e["position"] else ""), font=Font(size=10, bold=True, color="0F172A" if sub else "94A3B8"), al=L)
        put(r, "C", e["submitted_at"][5:].replace("-", "/") if sub else "미제출",
            font=Font(size=10, bold=sub, color="15803D" if sub else "94A3B8"))
        merge(r, "D", "E", e["notes"] or ("-" if sub else None), font=Font(size=10, color="334155") if sub else gray, al=L)
        for col, _ in STATUS_COLS:
            num(r, col, e["totals"].get(col, 0) if sub else None)
        merge(r, "M", "N", e["total"] if sub else None, font=Font(size=10, bold=True, color="0F172A"))
        ws.row_dimensions[r].height = max(22, 15 * _est_lines(e["notes"], widths["D"] + widths["E"]) + 7)

    # 지원 내역 (일자별)
    r += 2
    rows = data["rows"]
    bar(r, "지원 내역", f"{len(rows)}줄 · 같은 날 같은 고객사는 한 줄로 합침")
    r += 1
    heads = [("B", "고객사", L), ("C", "지원일자", C), ("D", "지원요약", L), ("E", "교체파트", L)] \
        + [(col, name, C) for col, name in STATUS_COLS] + [("M", "지원엔지니어", C), ("N", "비고", L)]
    for col, name, al in heads:
        put(r, col, name, fill=HEAD, font=Font(size=9 if col in "FGHIJKL" else 10, bold=True, color="334155"), al=al)
    ws.row_dimensions[r].height = 22
    for x in rows:
        r += 1
        d = date.fromisoformat(x["date"])
        summary = "\n".join(f"- {s}" for s in x["summary"])
        parts = "\n".join(x.get("parts") or [])
        put(r, "B", x["site"], font=Font(size=10, bold=True, color="0F172A"), al=L)
        put(r, "C", md(d))
        put(r, "D", summary, al=L)
        put(r, "E", parts or None, font=Font(size=9, color="334155"), al=L)
        for col, _ in STATUS_COLS:
            num(r, col, x["counts"].get(col, 0))
        put(r, "M", x["workers"])
        put(r, "N", x.get("remark") or None, al=L)
        lines = max(_est_lines(x["site"], widths["B"]), _est_lines(summary, widths["D"]), _est_lines(parts, widths["E"], 9),
                    _est_lines(x.get("remark"), widths["N"]), _est_lines(x["workers"], widths["M"]), 1)
        ws.row_dimensions[r].height = max(22, 15 * lines + 7)
    if not rows:
        r += 1
        merge(r, "B", "N", "제출된 지원 내역이 없습니다", font=Font(size=10, color="94A3B8"))
    r += 1
    merge(r, "B", "E", "합계", fill=FOOT, font=Font(size=10, bold=True, color="334155"), al=R)
    for col, _ in STATUS_COLS:
        put(r, col, t.get(col) or None, fill=FOOT, font=Font(size=10, bold=True, color="334155"))
    merge(r, "M", "N", f"총 {total}건", fill=FOOT, font=Font(size=10, bold=True, color="334155"), al=L)
    ws.row_dimensions[r].height = 22

    # 특이사항 · 확정사항 (화면처럼 나란히)
    r += 2
    merge(r, "B", "E", "특이사항", fill=BAR, font=Font(size=11, bold=True, color="334155"), al=L)
    merge(r, "F", "N", "확정사항    같은 일정은 하나로 합침 · 끝에 엔지니어", fill=BAR, font=Font(size=11, bold=True, color="334155"), al=L)
    ws.row_dimensions[r].height = 24
    r += 1
    notes, conf = data["notes"] or "", data["confirmed"] or "제출된 확정사항이 없습니다"
    merge(r, "B", "E", notes, font=Font(size=10, color="1E293B" if data["notes"] else "94A3B8"), al=LT)
    merge(r, "F", "N", conf, font=Font(size=10, color="1E293B" if data["confirmed"] else "94A3B8"), al=LT)
    wl = lambda cs: sum(widths.get(c, 8.5) for c in cs)
    ws.row_dimensions[r].height = max(60, 15 * max(_est_lines(notes, wl("BCDE")), _est_lines(conf, wl("FGHIJKLMN"))) + 12)

    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    # 글꼴 이름을 빠뜨리면 엑셀이 셀마다 다른 기본 글꼴(영문 Calibri 등)로 그려 폭·줄바꿈이 어긋난다 → 모두 맑은 고딕
    from copy import copy
    for row in ws.iter_rows():
        for c in row:
            f = copy(c.font); f.name = "맑은 고딕"; c.font = f


def _team_workbook(data: dict) -> bytes:
    """첫 시트 = 화면과 같은 팀 주간보고서, 두 번째 시트 = 회사 주간보고서 양식(일자별로 합친 내용)."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(write_weekly_xlsx(data, data["notes"], data["confirmed"])))
    for w in wb.worksheets:                 # 양식 시트의 '선택됨'이 남으면 두 시트가 [그룹]으로 열린다
        w.sheet_view.tabSelected = False
    _page_sheet(wb, data)
    wb.worksheets[0].sheet_view.tabSelected = True
    out = io.BytesIO(); wb.save(out)
    return out.getvalue()


@router.get("/weekly")
def team_weekly(start: Optional[str] = None, db: Session = Depends(get_db)):
    return build_team(start, db)


class TeamNoteIn(BaseModel):
    start: str
    text:  str = ""

@router.put("/weekly/notes")
def save_team_notes(body: TeamNoteIn, user: dict = Depends(require_lead), db: Session = Depends(get_db)):
    """팀 특이사항 저장 (비우면 지움)."""
    mon, _ = _week(body.start)
    row = db.get(TeamWeeklyNote, mon.isoformat())
    text = body.text.rstrip()
    if not text:
        if row: db.delete(row)
    else:
        if not row:
            row = TeamWeeklyNote(week_start=mon.isoformat()); db.add(row)
        row.text, row.updated_by, row.updated_at = text, user.get("engineer_name", ""), datetime.now().strftime("%Y-%m-%d %H:%M")
    db.commit()
    return {"ok": True}


@router.get("/weekly/xlsx")
def team_weekly_xlsx(start: Optional[str] = None, db: Session = Depends(get_db)):
    data = build_team(start, db)
    if not data["submitted"]:
        raise HTTPException(400, detail="이 주에 제출한 엔지니어가 없습니다")
    content = _team_workbook(data)
    fname = quote(f"서비스지원본부_팀_주간보고-{date.fromisoformat(data['start']):%y%m%d}.xlsx")
    return StreamingResponse(io.BytesIO(content),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"})
