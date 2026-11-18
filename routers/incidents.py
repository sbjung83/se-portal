from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db, Incident
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/incidents", tags=["incidents"])

MAX_PARTS = 50


class PartIn(BaseModel):
    """장애처리에 사용(교체)한 파트 1줄."""
    name:    Optional[str] = ""      # 파트명 (예: 600GB SAS HDD)
    part_no: Optional[str] = ""      # Part No. / FRU
    qty:     Optional[int] = 1
    old_sn:  Optional[str] = ""      # 제거(불량) 파트 S/N
    new_sn:  Optional[str] = ""      # 장착(신규) 파트 S/N
    note:    Optional[str] = ""      # 비고 (장착 위치, RMA 번호 등)


def clean_parts(parts) -> str:
    """입력 목록을 정리해 JSON 문자열로. 파트명·Part No.·S/N 이 모두 빈 줄은 버린다."""
    out = []
    for p in (parts or [])[:MAX_PARTS]:
        d = p.dict() if hasattr(p, "dict") else dict(p)
        row = {k: str(d.get(k) or "").strip()[:200] for k in ("name", "part_no", "old_sn", "new_sn", "note")}
        if not (row["name"] or row["part_no"] or row["old_sn"] or row["new_sn"]):
            continue
        try:
            row["qty"] = max(int(d.get("qty") or 1), 1)
        except (TypeError, ValueError):
            row["qty"] = 1
        out.append(row)
    return json.dumps(out, ensure_ascii=False) if out else ""


def sync_entry_status(db, eng_id: str, entry_id: str, status: str):
    """점검 일정/기술지원의 완료 체크를 함께 등록된 장애 처리 상태에 반영 (상태는 하나로 맞춘다).
    완료 → 장애도 '완료', 완료 취소 → 완료였던 장애는 '처리중'."""
    inc = db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.entry_id == entry_id).first()
    if not inc or not status:
        return
    if status == "완료":
        inc.status = "완료"
    elif inc.status == "완료":
        inc.status = "처리중"


def load_parts(raw) -> list:
    try:
        v = json.loads(raw or "[]")
        return v if isinstance(v, list) else []
    except ValueError:
        return []


@router.get("")
def list_incidents(eng_id: str, month: Optional[str] = None, status: Optional[str] = None,
                   q: Optional[str] = None, db: Session = Depends(get_db)):
    """month: 'YYYY-MM' (발생 일시 기준), status: 접수/처리중/완료, q: 제목·사이트·장비 검색"""
    query = db.query(Incident).filter(Incident.engineer_id == eng_id)
    if month:
        query = query.filter(Incident.occurred_at.startswith(month))
    if status:
        query = query.filter(Incident.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Incident.title.like(like), Incident.site.like(like), Incident.device.like(like)))
    rows = query.order_by(Incident.occurred_at.desc()).all()
    kinds = _entry_kinds(db, eng_id, {i.entry_id for i in rows if i.entry_id})
    return [{**_inc_dict(i), "entry_types": kinds.get(i.entry_id, [])} for i in rows]


def _entry_kinds(db, eng_id: str, ids: set) -> dict:
    """함께 등록된 일정 id → 그 일정의 구분 목록 (점검 일정: ['점검', +함께 한 지원], 기술지원: 지원 구분들)."""
    if not ids:
        return {}
    from database import Schedule, WorkPlan
    out = {}
    for s in db.query(Schedule).filter(Schedule.engineer_id == eng_id, Schedule.id.in_(ids)):
        out[s.id] = ["점검"] + [t for t in (s.extra_types or "").split(",") if t]
    for w in db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.id.in_(ids), WorkPlan.id.startswith("wp-")):
        out[w.id] = [t for t in (w.support_type or "").split(",") if t] or ["기술지원"]
    return out


class IncidentIn(BaseModel):
    title:        str
    site:         Optional[str] = ""
    device:       Optional[str] = ""
    severity:     Optional[str] = "보통"
    status:       Optional[str] = "접수"
    occurred_at:  Optional[str] = ""
    recovered_at: Optional[str] = ""
    worker:       Optional[str] = ""
    symptom:      Optional[str] = ""
    cause:        Optional[str] = ""
    action:       Optional[str] = ""
    prevention:   Optional[str] = ""
    parts:        Optional[List[PartIn]] = None


@router.post("")
def create_incident(eng_id: str, data: IncidentIn, db: Session = Depends(get_db)):
    d = data.dict(exclude={"parts"})
    inc = Incident(id=str(uuid.uuid4()), engineer_id=eng_id,
                   created_at=datetime.now().strftime("%Y-%m-%d"), parts=clean_parts(data.parts), **d)
    db.add(inc); db.commit()
    return _inc_dict(inc)


class IncidentUpdate(BaseModel):
    title:        Optional[str] = None
    site:         Optional[str] = None
    device:       Optional[str] = None
    severity:     Optional[str] = None
    status:       Optional[str] = None
    occurred_at:  Optional[str] = None
    recovered_at: Optional[str] = None
    worker:       Optional[str] = None
    symptom:      Optional[str] = None
    cause:        Optional[str] = None
    action:       Optional[str] = None
    prevention:   Optional[str] = None
    parts:        Optional[List[PartIn]] = None


@router.patch("/{inc_id}")
def update_incident(eng_id: str, inc_id: str, data: IncidentUpdate, db: Session = Depends(get_db)):
    inc = db.query(Incident).filter(Incident.id == inc_id, Incident.engineer_id == eng_id).first()
    if not inc:
        raise HTTPException(404, detail="장애 기록을 찾을 수 없습니다")
    for k, v in data.dict(exclude_none=True, exclude={"parts"}).items():
        setattr(inc, k, v)
    if data.parts is not None:
        inc.parts = clean_parts(data.parts)
    db.commit()
    return _inc_dict(inc)


@router.delete("/{inc_id}")
def delete_incident(eng_id: str, inc_id: str, db: Session = Depends(get_db)):
    inc = db.query(Incident).filter(Incident.id == inc_id, Incident.engineer_id == eng_id).first()
    if not inc:
        raise HTTPException(404, detail="장애 기록을 찾을 수 없습니다")
    db.delete(inc); db.commit()
    return {"ok": True}


def _downtime_min(start: str, end: str):
    """발생~복구 소요 시간(분). 둘 중 하나라도 없거나 형식이 틀리면 None."""
    try:
        s = datetime.fromisoformat(start)
        e = datetime.fromisoformat(end)
        return max(int((e - s).total_seconds() // 60), 0)
    except (TypeError, ValueError):
        return None


def _inc_dict(i):
    return {
        "id": i.id, "title": i.title, "site": i.site, "device": i.device,
        "severity": i.severity, "status": i.status,
        "occurred_at": i.occurred_at, "recovered_at": i.recovered_at,
        "downtime_min": _downtime_min(i.occurred_at, i.recovered_at),
        "worker": i.worker, "symptom": i.symptom, "cause": i.cause,
        "action": i.action, "prevention": i.prevention, "created_at": i.created_at,
        "entry_id": i.entry_id or "",      # 점검 일정/기술지원과 함께 등록된 건이면 그 일정의 id
        "parts": load_parts(i.parts),      # 사용(교체) 파트 목록
    }


# ── 장애처리 보고서 엑셀 ─────────────────────────
# 한 장(A4 세로)짜리 간단한 보고서: 1.장애 개요 / 2.장애 내용(증상·원인·조치) / 3.사용 파트 / 4.재발 방지 대책
_R_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
_R_WIDTHS = {'A': 6, 'B': 16, 'C': 22, 'D': 16, 'E': 7, 'F': 17, 'G': 17}


def _fmt_dt(v: str) -> str:
    return (v or "").replace("T", " ")


def _fmt_min(m) -> str:
    if m is None:
        return "-"
    d, rest = divmod(m, 1440)
    h, mi = divmod(rest, 60)
    out = (f"{d}일 " if d else "") + (f"{h}시간 " if h else "") + (f"{mi}분" if mi or not (d or h) else "")
    return out.strip()


def build_incident_workbook(inc: Incident, engineer_name: str):
    from openpyxl import Workbook
    from openpyxl.styles import Font, Border, Side, Alignment, PatternFill
    from routers.technotes import _line_count

    wb = Workbook()
    ws = wb.active
    ws.title = "장애처리 보고서"
    thin = Side(style="thin", color="808080")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    left_top = Alignment(horizontal="left", vertical="top", wrap_text=True)
    f_title = Font(name="맑은 고딕", size=18, bold=True)
    f_section = Font(name="맑은 고딕", size=11, bold=True, color="FFFFFF")
    f_label = Font(name="맑은 고딕", size=10, bold=True)
    f_body = Font(name="맑은 고딕", size=10)
    fill_section = PatternFill("solid", start_color="9B2C2C", end_color="9B2C2C")
    fill_label = PatternFill("solid", start_color="F2F2F2", end_color="F2F2F2")
    fill_header = PatternFill("solid", start_color="FBE4E4", end_color="FBE4E4")
    for c, w in _R_WIDTHS.items():
        ws.column_dimensions[c].width = w

    def width(c1, c2):
        return sum(_R_WIDTHS[c] for c in _R_COLS[_R_COLS.index(c1):_R_COLS.index(c2) + 1])

    def put(rng, value=None, font=f_body, align=left, fill=None):
        for row_cells in (ws[rng] if ":" in rng else [[ws[rng]]]):
            for cell in row_cells:
                cell.border = border
                if fill:
                    cell.fill = fill
        if ":" in rng:
            ws.merge_cells(rng)
        tl = ws[rng.split(":")[0]]
        tl.value, tl.font, tl.alignment = value, font, align

    def height(r, lines, min_h=22):
        ws.row_dimensions[r].height = min(max(min_h, lines * 15 + 8, ws.row_dimensions[r].height or 0), 409)

    row = 1
    put("A1:E4", "장 애 처 리 보 고 서", font=f_title, align=center)
    put("F1:G1", "결   재", font=f_label, align=center, fill=fill_label)
    put("F2", "담당", font=f_label, align=center, fill=fill_label)
    put("G2", "팀장", font=f_label, align=center, fill=fill_label)
    put("F3:F4", None, align=center)
    put("G3:G4", None, align=center)
    for r, h in ((1, 20), (2, 20), (3, 24), (4, 24)):
        ws.row_dimensions[r].height = h
    row = 6

    def section(title):
        nonlocal row
        put(f"A{row}:G{row}", title, font=f_section, fill=fill_section)
        ws.row_dimensions[row].height = 22
        row += 1

    def full(label, value, empty="-", min_lines=1):
        nonlocal row
        value = (value or "").strip() or empty
        put(f"A{row}:B{row}", label, font=f_label, align=center, fill=fill_label)
        put(f"C{row}:G{row}", value, align=left_top if min_lines > 1 or "\n" in value else left)
        height(row, max(min_lines, _line_count(value, width("C", "G"))))
        row += 1

    def pair(l1, v1, l2, v2):
        nonlocal row
        v1, v2 = (v1 or "").strip() or "-", (v2 or "").strip() or "-"
        put(f"A{row}:B{row}", l1, font=f_label, align=center, fill=fill_label)
        put(f"C{row}:D{row}", v1)
        put(f"E{row}:F{row}", l2, font=f_label, align=center, fill=fill_label)
        put(f"G{row}", v2)
        height(row, max(_line_count(v1, width("C", "D")), _line_count(v2, width("G", "G"))))
        row += 1

    section("1. 장애 개요")
    full("장애명", inc.title)
    pair("사이트", inc.site, "장애 등급", inc.severity)
    pair("장애 장비", inc.device, "처리 상태", inc.status)
    pair("발생 일시", _fmt_dt(inc.occurred_at), "복구 일시", _fmt_dt(inc.recovered_at))
    pair("작업자", inc.worker, "장애 시간", _fmt_min(_downtime_min(inc.occurred_at, inc.recovered_at)))
    pair("작성자", engineer_name, "작성일", datetime.now().strftime("%Y-%m-%d"))
    row += 1

    section("2. 장애 내용")
    full("장애 증상", inc.symptom, min_lines=3)
    full("원인", inc.cause, min_lines=3)
    full("조치 내용", inc.action, min_lines=4)
    row += 1

    section("3. 사용 파트")
    parts = load_parts(inc.parts)
    heads = ["No.", "파트명", "Part No. / FRU", "수량", "제거 S/N (불량)", "장착 S/N (신규)"]
    # 열: A No / B~C 파트명 / D Part No / E 수량 / F 제거 / G 장착 (비고는 파트명 아래 줄에)
    put(f"A{row}", heads[0], font=f_label, align=center, fill=fill_header)
    put(f"B{row}:C{row}", heads[1], font=f_label, align=center, fill=fill_header)
    for col, h in zip("DEFG", heads[2:]):
        put(f"{col}{row}", h, font=f_label, align=center, fill=fill_header)
    ws.row_dimensions[row].height = 22
    row += 1
    if not parts:
        put(f"A{row}:G{row}", "사용한 파트 없음", align=center)
        ws.row_dimensions[row].height = 22
        row += 1
    for n, p in enumerate(parts, 1):
        name = p.get("name") or ""
        if p.get("note"):
            name += f"\n({p['note']})"
        put(f"A{row}", n, align=center)
        put(f"B{row}:C{row}", name)
        put(f"D{row}", p.get("part_no") or "", align=center)
        put(f"E{row}", p.get("qty") or 1, align=center)
        put(f"F{row}", p.get("old_sn") or "", align=center)
        put(f"G{row}", p.get("new_sn") or "", align=center)
        height(row, max(_line_count(name, width("B", "C")), _line_count(p.get("part_no") or "", 16)))
        row += 1
    row += 1

    section("4. 재발 방지 대책")
    full("재발 방지 대책", inc.prevention, empty="해당 없음", min_lines=3)

    ws.sheet_view.showGridLines = False
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.print_options.horizontalCentered = True
    ws.print_area = f"A1:G{row - 1}"
    return wb


@router.get("/{inc_id}/report")
def download_incident_report(eng_id: str, inc_id: str, db: Session = Depends(get_db)):
    import io
    import re
    from urllib.parse import quote
    from fastapi.responses import StreamingResponse
    from database import Engineer
    inc = db.query(Incident).filter(Incident.id == inc_id, Incident.engineer_id == eng_id).first()
    if not inc:
        raise HTTPException(404, detail="장애 기록을 찾을 수 없습니다")
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    stream = io.BytesIO()
    build_incident_workbook(inc, eng.name if eng else "").save(stream)
    stream.seek(0)
    day = re.sub(r"\D", "", (inc.occurred_at or "")[:10]) or "N_A"
    safe = re.sub(r'[\\/*?:"<>|]', "_", inc.title or "")
    name = f"장애처리보고서_{day}_{safe}.xlsx"
    return StreamingResponse(stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})
