"""주간보고서 — 점검/기술지원/장애처리를 취합해 사용자 제공 엑셀 양식(data/report_templates/weekly_report.xlsx)에 채운다.

양식 구조 (시트 1장):
  B1          "YYYY년 MM월 DD일 ~ YYYY년 MM월 DD일 주간보고서"
  3행         머리글
  4~12행      데이터 (사이트+일자 1행). 부족하면 행을 추가하고 아래 블록을 밀어낸다.
  13~14행     B 특이사항 라벨 / C13:H14 특이사항 / I13:O14 확정사항(다음 주 등록 점검·기술지원·장애처리)
  15행        합계 (F~L 열 SUM, O = F~L 합)
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta
from copy import copy
from urllib.parse import quote
import io, os

from database import get_db, Engineer, Site, Schedule, WorkPlan, Incident, Issue, CalendarEvent
from routers.technotes import support_only

router = APIRouter(prefix="/api/engineers/{eng_id}/reports", tags=["reports"])

BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_PATH = os.path.join(BASE_DIR, "data", "report_templates", "weekly_report.xlsx")

DATA_START   = 4       # 데이터 첫 행
PARTS_FONT   = 12      # 교체파트(E) 글자 크기 (양식 기본 15)
TPL_ROWS     = 9       # 양식의 데이터 행 수 (4~12)
COUNT_COLS   = ["F", "G", "H", "I", "J", "K", "L"]
# 집계 열: 정기점검 F / 장애지원 G / 기술지원 요청건 H / 납품 I / 유선원격지원 J / 이전 K / 기타 L
SUPPORT_COL  = {"기술지원": "H", "납품": "I", "유선원격": "J", "이전": "K", "기타": "L"}
WD = "월화수목금토일"


def _week(start: Optional[str]):
    """start(YYYY-MM-DD)가 속한 주의 월요일~일요일. 없으면 이번 주."""
    try:
        d = datetime.strptime(start, "%Y-%m-%d").date() if start else date.today()
    except ValueError:
        raise HTTPException(400, detail="날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    mon = d - timedelta(days=d.weekday())
    return mon, mon + timedelta(days=6)


def _weekend(day: str) -> bool:
    try:
        return date.fromisoformat((day or "")[:10]).weekday() >= 5
    except ValueError:
        return False


def _in(day: str, a: date, b: date):
    return a.isoformat() <= (day or "")[:10] <= b.isoformat()


def _workers(*vals):
    out = []
    for v in vals:
        for w in (v or "").replace("/", ",").split(","):
            w = w.strip()
            if w and w not in out:
                out.append(w)
    return out


def _one_line(text: str, n: int = 60):
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[:n - 1] + "…"


IMPORT_NOTE = "구글 캘린더에서 가져옴"

def _summary(title: str, text: str, from_calendar: bool) -> list:
    """점검의 지원요약 줄 목록. 구글 캘린더에서 가져온 건은 캘린더 설명(점검 메모)을 줄 단위로,
    설명이 없거나 포털에서 직접 등록한 건은 제목을 넣는다."""
    t = (text or "").strip()
    if from_calendar and t and t != IMPORT_NOTE:
        lines = [l.strip().lstrip("-•·").strip() for l in t.splitlines()]
        lines = [l for l in lines if l]
        if lines:
            return lines
    return [title]


def _wrapped_lines(ws, col: str, text, size: float = 15) -> float:
    """셀 글자가 칸 너비에서 몇 줄로 보이는지 어림해 15pt 줄 기준 높이로 돌려준다 (한글·전각 = 2칸, 들여쓰기·여백 감안)."""
    if not text:
        return 0
    width = (ws.column_dimensions[col].width or 10) * 11 / size - 3
    n = 0
    for line in str(text).split("\n"):
        w = sum(2 if ord(ch) > 0x2E7F else 1 for ch in line)
        n += max(1, -(-w // max(width, 1)))
    return n * size / 15


def _part_lines(raw) -> list:
    """장애처리 보고서의 사용 파트 → 교체파트 칸 줄 목록: 파트마다 'PN : 파트넘버' / '[ 파트명 ]' 두 줄 (있는 것만)."""
    from routers.incidents import load_parts
    out = []
    for q in load_parts(raw):
        no, name = str(q.get("part_no") or "").strip(), str(q.get("name") or "").strip()
        if no:
            out.append(f"PN : {no}")
        if name:
            out.append(f"[ {name} ]")
    return out


def build_weekly(eng_id: str, start: Optional[str], db: Session):
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    if not eng:
        raise HTTPException(404, detail="엔지니어 정보를 찾을 수 없습니다")
    mon, sun = _week(start)
    nmon, nsun = mon + timedelta(days=7), sun + timedelta(days=7)
    sites = {s.id: s for s in db.query(Site).filter(Site.engineer_id == eng_id).all()}

    # 구글 캘린더에서 가져온 건(routers/gcal.py) — 지원요약에 캘린더 설명을 쓴다
    from_cal = {e.target_id for e in db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id,
                                                                    CalendarEvent.state == "등록")}
    # 가져온 뒤 아직 내용을 확인(공통 입력 창에서 저장)하지 않은 기술지원·장애처리 — 화면에서 알려 준다
    from routers.gcal import review_ids
    unreviewed, review = review_ids(db, eng_id), []
    def check(r, obj_id, kind, day, site, title):
        if obj_id in unreviewed:
            r["review"] = True
            review.append({"id": obj_id, "kind": kind, "date": day[:10], "site": site, "title": title})

    rows = {}   # (date, site) -> row

    def row(day: str, site: str):
        key = (day[:10], site or "(사이트 미지정)")
        if key not in rows:
            rows[key] = {"date": key[0], "site": key[1], "summary": [], "remarks": [], "workers": [], "parts": [],
                         "counts": {c: 0 for c in COUNT_COLS}, "planned": False, "review": False}
        return rows[key]

    # 정기점검: 이번 주 완료된 점검일정 (작업자는 점검일정 모달의 연동 레코드에서)
    # 토·일 일정은 보고서를 주말 전에 내므로 완료 전이어도 등록되어 있으면 포함한다
    scheds = [s for s in db.query(Schedule).filter(Schedule.engineer_id == eng_id).all()
              if _in(s.sched_date, mon, sun) and (s.status == "완료" or _weekend(s.sched_date))]
    linked = {p.id: p for p in db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id,
                                                          WorkPlan.id.in_([s.id for s in scheds]))} if scheds else {}
    for s in scheds:
        if not _in(s.sched_date, mon, sun):
            continue
        r = row(s.sched_date, sites[s.site_id].name if s.site_id in sites else "")
        r["summary"] += _summary(s.title, s.memo, s.id in from_cal)
        check(r, s.id, "점검", s.sched_date, r["site"], s.title)
        r["planned"] = r["planned"] or s.status != "완료"
        r["counts"]["F"] += 1
        for t in (s.extra_types or "").split(","):          # 점검과 함께 한 지원(체크한 구분마다 1건)
            if t in SUPPORT_COL:
                r["counts"][SUPPORT_COL[t]] += 1
        lp = linked.get(s.id)
        r["workers"] += _workers(lp.worker if lp else "")

    # 기술지원: 이번 주 완료 건, 체크한 지원 구분마다 H~L 열에 1건씩
    for p in support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id)).all():
        if not _in(p.work_date, mon, sun) or not (p.status == "완료" or _weekend(p.work_date)):
            continue
        r = row(p.work_date, p.site)
        r["summary"].append(p.title)                     # 포털에 저장된 제목(캘린더에서 가져온 건은 설명 첫 줄 → 사용자가 확인·수정)
        check(r, p.id, "기술지원", p.work_date, r["site"], p.title)
        r["planned"] = r["planned"] or p.status != "완료"
        cols = [SUPPORT_COL[t] for t in (p.support_type or "").split(",") if t in SUPPORT_COL] or ["H"]
        for c in cols:
            r["counts"][c] += 1
        r["workers"] += _workers(p.worker)

    # 장애지원: 이번 주 발생한 장애 전체
    for i in db.query(Incident).filter(Incident.engineer_id == eng_id).all():
        if not _in(i.occurred_at, mon, sun):
            continue
        r = row(i.occurred_at, i.site)
        r["summary"].append(i.title if "장애" in (i.title or "") else f"{i.title} 장애처리")
        if not (i.entry_id and i.entry_id in unreviewed):   # 일정과 함께 등록한 장애는 그 일정 한 번만
            check(r, i.id, "장애처리", i.occurred_at, r["site"], i.title)
        r["counts"]["G"] += 1
        r["workers"] += _workers(i.worker)
        r["parts"] += _part_lines(i.parts)
        detail = " → ".join(x for x in [_one_line(i.symptom, 40), _one_line(i.action, 50)] if x)
        status = "" if i.status == "완료" else f" [{i.status}]"
        if detail or status:
            r["remarks"].append(f"{i.title}: {detail}{status}" if detail else f"{i.title}{status}")

    # 평일 일정 중 아직 '완료'가 아니라 집계에서 빠진 것 — 화면에서 알려 주고 바로 완료 처리할 수 있게 한다
    pending = []
    today = date.today().isoformat()       # 아직 오지 않은 날의 일정은 '빠진' 것이 아니므로 알리지 않는다
    for s in db.query(Schedule).filter(Schedule.engineer_id == eng_id).all():
        if _in(s.sched_date, mon, sun) and s.status != "완료" and not _weekend(s.sched_date) and s.sched_date[:10] <= today:
            pending.append({"id": s.id, "kind": "점검", "date": s.sched_date[:10], "title": s.title,
                            "site": sites[s.site_id].name if s.site_id in sites else ""})
    for p in support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id)).all():
        if _in(p.work_date, mon, sun) and p.status != "완료" and not _weekend(p.work_date) and p.work_date[:10] <= today:
            pending.append({"id": p.id, "kind": "기술지원", "date": p.work_date[:10], "title": p.title, "site": p.site or ""})
    pending.sort(key=lambda x: (x["date"], x["site"]))
    for x in pending:
        x["weekday"] = WD[date.fromisoformat(x["date"]).weekday()]

    out = []
    for key in sorted(rows):
        r = rows[key]
        r["workers"] = ", ".join(dict.fromkeys(r["workers"])) or eng.name
        r["summary"] = list(dict.fromkeys(r["summary"]))       # 같은 줄에 같은 문장은 한 번만
        out.append(r)

    # 특이사항 기본값: 미해결 이슈 + 진행 중 장애
    notes = []
    for i in db.query(Issue).filter(Issue.engineer_id == eng_id, Issue.status != "완료").order_by(Issue.created_at).all():
        notes.append(f"- {sites[i.site_id].name if i.site_id in sites else ''} : {i.title} ({i.status})")
    for i in db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.status != "완료").order_by(Incident.occurred_at).all():
        notes.append(f"- {i.site} : {i.title} 장애 {i.status}")

    # 확정사항 기본값: 다음 주(월~일)에 등록된 점검 · 기술지원 · 장애처리 (구분은 [점검·장애처리] 처럼 함께 표시)
    # 점검·기술지원과 함께 등록한 장애는 그 일정 줄에 구분만 붙이고, 장애처리만 한 건은 따로 한 줄
    nxt = []      # (날짜, 사이트, 제목, 구분 목록, 일정 id)
    for s in db.query(Schedule).filter(Schedule.engineer_id == eng_id).all():
        if _in(s.sched_date, nmon, nsun):
            nxt.append((s.sched_date[:10], sites[s.site_id].name if s.site_id in sites else "", s.title,
                        ["점검"] + [t for t in (s.extra_types or "").split(",") if t], s.id))
    for p in support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id)).all():
        if _in(p.work_date, nmon, nsun):
            nxt.append((p.work_date[:10], p.site or "", p.title,
                        [t for t in (p.support_type or "").split(",") if t] or ["기술지원"], p.id))
    by_id = {x[4]: x for x in nxt}
    for i in db.query(Incident).filter(Incident.engineer_id == eng_id).all():
        if not _in(i.occurred_at, nmon, nsun):
            continue
        if i.entry_id and i.entry_id in by_id:
            if "장애처리" not in by_id[i.entry_id][3]:
                by_id[i.entry_id][3].append("장애처리")
        else:
            nxt.append((i.occurred_at[:10], i.site or "", i.title, ["장애처리"], i.id))
    nxt.sort(key=lambda x: (x[0], x[1], x[2]))
    confirmed = [f"{n}. [{'·'.join(kinds)}] {site} : {title} ({d[5:7].lstrip('0')}/{d[8:10].lstrip('0')})"
                 for n, (d, site, title, kinds, _id) in enumerate(nxt, 1)]

    totals = {c: sum(r["counts"][c] for r in out) for c in COUNT_COLS}
    return {
        "start": mon.isoformat(), "end": sun.isoformat(),
        "title": f"{mon.year}년 {mon.month:02d}월 {mon.day:02d}일 ~ {sun.year}년 {sun.month:02d}월 {sun.day:02d}일 주간보고서",
        "rows": [{"date": r["date"], "weekday": WD[date.fromisoformat(r["date"]).weekday()], "site": r["site"],
                  "key": f'{r["date"]}|{r["site"]}', "summary": r["summary"],
                  "remark": "\n".join(f"- {t}" for t in r["remarks"]),     # 비고 기본값(장애 건만 자동) — 화면에서 직접 고쳐 쓴다
                  "parts": r["parts"], "workers": r["workers"], "counts": r["counts"], "planned": r["planned"],
                  "review": r["review"]}
                 for r in out],
        "totals": totals, "total": sum(totals.values()),
        "pending": pending,
        "review": sorted(review, key=lambda x: (x["date"], x["site"])),
        "notes": "\n".join(notes), "confirmed": "\n".join(confirmed),
        "template_ok": os.path.exists(TEMPLATE_PATH),
    }


@router.get("/weekly")
def weekly_preview(eng_id: str, start: Optional[str] = None, db: Session = Depends(get_db)):
    return build_weekly(eng_id, start, db)


@router.get("/weekly/weeks")
def weekly_weeks(eng_id: str, month: str, db: Session = Depends(get_db)):
    """그 달의 주차 목록 (월요일 기준: 월요일이 그 달에 있는 주 = 그 달 n주차)과 주별 집계 건수."""
    try:
        first = datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(400, detail="월 형식이 올바르지 않습니다 (YYYY-MM)")
    mon = first + timedelta(days=(7 - first.weekday()) % 7)      # 그 달 첫 월요일
    out = []
    while mon.month == first.month:
        d = build_weekly(eng_id, mon.isoformat(), db)
        out.append({"no": len(out) + 1, "start": d["start"], "end": d["end"], "total": d["total"]})
        mon += timedelta(days=7)
    return out


class WeeklyExportIn(BaseModel):
    start:     Optional[str] = None
    notes:     Optional[str] = None   # None 이면 기본값 사용
    confirmed: Optional[str] = None
    remarks:   Optional[dict] = None  # 행별 비고 {"날짜|고객사": "내용"} — 화면에서 직접 입력한 값


# ── 엑셀 작성 ────────────────────────────────────────
def _copy_row_style(ws, src_row: int, dst_row: int, max_col: int):
    for col in range(1, max_col + 1):
        s, d = ws.cell(src_row, col), ws.cell(dst_row, col)
        if s.has_style:
            d._style = copy(s._style)
    ws.row_dimensions[dst_row].height = ws.row_dimensions[src_row].height


def _insert_data_rows(ws, extra: int):
    """데이터 행(4~12) 아래 블록(13~15행)을 extra 행 만큼 아래로 밀고 새 행에 데이터 행 서식 복사."""
    if extra <= 0:
        return
    first_block = DATA_START + TPL_ROWS          # 13
    max_col = ws.max_column
    block_merges = [m for m in list(ws.merged_cells.ranges) if m.min_row >= first_block]
    heights = {r: ws.row_dimensions[r].height for r in range(first_block, ws.max_row + 1)}
    for m in block_merges:
        ws.unmerge_cells(str(m))
    ws.insert_rows(first_block, extra)
    for m in block_merges:
        ws.merge_cells(start_row=m.min_row + extra, start_column=m.min_col,
                       end_row=m.max_row + extra, end_column=m.max_col)
    for r, h in heights.items():
        ws.row_dimensions[r + extra].height = h
    for r in range(first_block, first_block + extra):
        _copy_row_style(ws, first_block - 1, r, max_col)


def write_weekly_xlsx(data: dict, notes: str, confirmed: str) -> bytes:
    import openpyxl
    if not os.path.exists(TEMPLATE_PATH):
        raise HTTPException(500, detail="주간보고서 양식 파일이 없습니다 (data/report_templates/weekly_report.xlsx)")
    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    ws = wb.worksheets[0]

    rows = data["rows"]
    n_rows = max(len(rows), TPL_ROWS)
    extra = n_rows - TPL_ROWS
    _insert_data_rows(ws, extra)
    last = DATA_START + n_rows - 1
    note_row, total_row = last + 1, last + 3

    ws["B1"] = data["title"]

    # 데이터 영역 비우기 (양식 예시 값 제거)
    for r in range(DATA_START, last + 1):
        for col in "BCDEFGHIJKLMNO":
            ws[f"{col}{r}"].value = None

    for idx, item in enumerate(rows):
        r = DATA_START + idx
        ws[f"B{r}"] = item["site"]
        ws[f"C{r}"] = date.fromisoformat(item["date"])
        ws[f"C{r}"].number_format = "yyyy/mm/dd"
        ws[f"D{r}"] = "\n".join(f"- {t}" for t in item["summary"])
        ws[f"E{r}"] = "\n".join(item.get("parts") or []) or None
        for col in COUNT_COLS:
            ws[f"{col}{r}"] = item["counts"][col] or None
        ws[f"N{r}"] = item["workers"]
        remark = (item.get("remark") or "").strip()
        ws[f"O{r}"] = remark or None
        for col in "DEO":
            c = ws[f"{col}{r}"]
            al = copy(c.alignment); al.wrap_text = True; al.vertical = "center"
            if col == "E":                     # 교체파트는 지원요약처럼 왼쪽 정렬 (양식은 가운데)
                al.horizontal, al.indent = "left", 1
                f = copy(c.font); f.sz = PARTS_FONT; c.font = f   # 파트넘버·파트명은 길어서 조금 작게
            c.alignment = al
        # 칸 너비를 넘어 자동 줄바꿈되는 줄까지 세어 행 높이를 맞춘다
        lines = max([_wrapped_lines(ws, col, ws[f"{col}{r}"].value, PARTS_FONT if col == "E" else 15) for col in "DEO"] + [1])
        ws.row_dimensions[r].height = max(25.05, 21 * lines + 6)
    for r in range(DATA_START + len(rows), last + 1):
        ws.row_dimensions[r].height = 25.05

    ws[f"C{note_row}"] = " 특이사항\n" + (notes or "")
    ws[f"I{note_row}"] = " 확정사항\n" + (confirmed or "")

    for col in COUNT_COLS:
        ws[f"{col}{total_row}"] = f"=SUM({col}{DATA_START}:{col}{last})"
    ws[f"O{total_row}"] = f"=SUM(F{total_row}:L{total_row})"
    if extra:
        ws.print_area = f"A1:P{total_row}"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.post("/weekly/xlsx")
def weekly_export(eng_id: str, body: WeeklyExportIn, db: Session = Depends(get_db)):
    data = build_weekly(eng_id, body.start, db)
    notes = data["notes"] if body.notes is None else body.notes
    confirmed = data["confirmed"] if body.confirmed is None else body.confirmed
    for row in data["rows"]:
        if body.remarks and row["key"] in body.remarks:
            row["remark"] = str(body.remarks[row["key"]] or "")
    content = write_weekly_xlsx(data, notes, confirmed)
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    # 파일명: 서비스지원본부_<이름>_주간보고-<다운로드한 날짜 yymmdd>
    fname = quote(f"서비스지원본부_{eng.name}_주간보고-{date.today():%y%m%d}.xlsx")
    return StreamingResponse(io.BytesIO(content),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"})
