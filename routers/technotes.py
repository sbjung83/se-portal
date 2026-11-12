from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db, TechNote, WorkPlan, Engineer
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid
import io
import re
from openpyxl import Workbook
from openpyxl.styles import Font, Border, Side, Alignment, PatternFill
from urllib.parse import quote

router = APIRouter()

class TechNoteIn(BaseModel):
    title: str
    category: Optional[str] = "기타"
    tags: Optional[str] = ""
    body: str

class TechNoteUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    body: Optional[str] = None

@router.get("/api/engineers/{eng_id}/technotes")
def get_tech_notes(eng_id: str, db: Session = Depends(get_db)):
    notes = db.query(TechNote).filter(TechNote.engineer_id == eng_id).order_by(TechNote.created_at.desc()).all()
    return [_note_dict(n) for n in notes]

@router.post("/api/engineers/{eng_id}/technotes")
def create_tech_note(eng_id: str, note: TechNoteIn, db: Session = Depends(get_db)):
    new_note = TechNote(
        id=f"tn-{uuid.uuid4().hex[:8]}",
        engineer_id=eng_id,
        title=note.title,
        category=note.category,
        tags=note.tags,
        body=note.body,
        created_at=datetime.utcnow().isoformat()
    )
    db.add(new_note)
    db.commit()
    db.refresh(new_note)
    return _note_dict(new_note)

@router.patch("/api/engineers/{eng_id}/technotes/{note_id}")
def update_tech_note(eng_id: str, note_id: str, note_update: TechNoteUpdate, db: Session = Depends(get_db)):
    note = db.query(TechNote).filter(TechNote.id == note_id, TechNote.engineer_id == eng_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="기술 노트를 찾을 수 없습니다")
    
    for k, v in note_update.dict(exclude_none=True).items():
        setattr(note, k, v)
    db.commit()
    return _note_dict(note)

@router.delete("/api/engineers/{eng_id}/technotes/{note_id}")
def delete_tech_note(eng_id: str, note_id: str, db: Session = Depends(get_db)):
    note = db.query(TechNote).filter(TechNote.id == note_id, TechNote.engineer_id == eng_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="기술 노트를 찾을 수 없습니다")
    
    db.delete(note)
    db.commit()
    return {"detail": "삭제되었습니다"}

def _note_dict(n):
    return {
        "id": n.id,
        "engineer_id": n.engineer_id,
        "title": n.title,
        "category": n.category,
        "tags": n.tags,
        "body": n.body,
        "created_at": n.created_at
    }

class WorkPlanIn(BaseModel):
    id: Optional[str] = None
    title: str
    work_date: Optional[str] = ""
    site: Optional[str] = ""
    worker: Optional[str] = ""
    reviewer: Optional[str] = ""
    status: Optional[str] = "계획중"
    purpose: Optional[str] = ""
    impact: Optional[str] = ""
    prerequisites: Optional[str] = ""
    mop_content: Optional[str] = ""
    verification: Optional[str] = ""
    rollback_plan: Optional[str] = ""

def _wp_dict(p):
    return {
        "id": p.id,
        "title": p.title,
        "work_date": p.work_date,
        "site": p.site,
        "worker": p.worker,
        "reviewer": p.reviewer,
        "status": p.status,
        "purpose": p.purpose,
        "impact": p.impact,
        "prerequisites": p.prerequisites,
        "mop_content": p.mop_content,
        "verification": p.verification,
        "rollback_plan": p.rollback_plan,
    }

@router.get("/api/engineers/{eng_id}/workplans")
def get_work_plans(eng_id: str, db: Session = Depends(get_db)):
    plans = db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id).order_by(WorkPlan.work_date.desc()).all()
    return [_wp_dict(p) for p in plans]

@router.post("/api/engineers/{eng_id}/workplans")
def create_work_plan(eng_id: str, plan: WorkPlanIn, db: Session = Depends(get_db)):
    plan_id = plan.id if plan.id else f"wp-{uuid.uuid4().hex[:8]}"
    existing = db.query(WorkPlan).filter(WorkPlan.id == plan_id).first()
    
    if existing:
        for k, v in plan.dict(exclude={"id"}, exclude_none=True).items():
            setattr(existing, k, v)
        db.commit()
        db.refresh(existing)
        return _wp_dict(existing)
        
    new_plan = WorkPlan(
        id=plan_id,
        engineer_id=eng_id,
        title=plan.title,
        work_date=plan.work_date,
        site=plan.site,
        worker=plan.worker,
        reviewer=plan.reviewer,
        status=plan.status,
        purpose=plan.purpose,
        impact=plan.impact,
        prerequisites=plan.prerequisites,
        mop_content=plan.mop_content,
        verification=plan.verification,
        rollback_plan=plan.rollback_plan
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)
    return _wp_dict(new_plan)

@router.patch("/api/engineers/{eng_id}/workplans/{plan_id}")
def update_work_plan(eng_id: str, plan_id: str, plan_update: WorkPlanIn, db: Session = Depends(get_db)):
    plan = db.query(WorkPlan).filter(WorkPlan.id == plan_id, WorkPlan.engineer_id == eng_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="작업 계획을 찾을 수 없습니다")
    
    for k, v in plan_update.dict(exclude_none=True).items():
        setattr(plan, k, v)
    db.commit()
    return _wp_dict(plan)

@router.delete("/api/engineers/{eng_id}/workplans/{plan_id}")
def delete_work_plan(eng_id: str, plan_id: str, db: Session = Depends(get_db)):
    plan = db.query(WorkPlan).filter(WorkPlan.id == plan_id, WorkPlan.engineer_id == eng_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="작업 계획을 찾을 수 없습니다")
    
    db.delete(plan)
    db.commit()
    return {"detail": "삭제되었습니다"}

# ── 작업계획서 엑셀 생성 ─────────────────────────
# 레이아웃은 작업 계획 작성/수정 모달과 동일한 구성(1.기본 정보 / 2.작업 개요 / 3.MOP / 4.추가 계획)을 따른다.
_XL_COLS = ['A', 'B', 'C', 'D', 'E', 'F']
_XL_WIDTHS = {'A': 6, 'B': 24, 'C': 46, 'D': 12, 'E': 14, 'F': 20}
_LINE_HEIGHT = 15  # 10pt 맑은 고딕 한 줄 높이(pt)


def _text_width(s: str) -> int:
    """엑셀 열 너비 단위 기준 대략적인 표시 폭 (한글/전각 = 2, 그 외 = 1)."""
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in s)


def _line_count(text, width_units: float) -> int:
    """주어진 너비(열 너비 합)에서 줄바꿈 포함 몇 줄로 표시될지 추정."""
    if text is None or text == "":
        return 1
    usable = max(width_units - 2, 4)
    total = 0
    for line in str(text).split('\n'):
        w = _text_width(line)
        total += max(1, -(-w // int(usable)))
    return total


def _span_width(c1: str, c2: str) -> float:
    i1, i2 = _XL_COLS.index(c1), _XL_COLS.index(c2)
    return sum(_XL_WIDTHS[c] for c in _XL_COLS[i1:i2 + 1])


def _parse_mop_line(line: str):
    """'작업 내용 # 작업 상세 # 소요시간 # 작업자 # 비고' → 5개 컬럼.
    CLI 등에 '#'이 더 들어있으면 남는 부분은 비고에 그대로 붙여 내용이 유실되지 않게 한다."""
    parts = [p.strip() for p in line.split('#', 4)]
    parts += [''] * (5 - len(parts))
    return parts


def _build_work_plan_workbook(plan, engineer_name: str) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "작업계획서"

    thin = Side(style='thin', color="808080")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left = Alignment(horizontal='left', vertical='center', wrap_text=True)
    left_top = Alignment(horizontal='left', vertical='top', wrap_text=True)

    f_title = Font(name='맑은 고딕', size=18, bold=True)
    f_section = Font(name='맑은 고딕', size=11, bold=True, color="FFFFFF")
    f_header = Font(name='맑은 고딕', size=10, bold=True)
    f_label = Font(name='맑은 고딕', size=10, bold=True)
    f_body = Font(name='맑은 고딕', size=10)

    fill_section = PatternFill("solid", start_color="2F5597", end_color="2F5597")
    fill_header = PatternFill("solid", start_color="D9E1F2", end_color="D9E1F2")
    fill_label = PatternFill("solid", start_color="F2F2F2", end_color="F2F2F2")

    for col, w in _XL_WIDTHS.items():
        ws.column_dimensions[col].width = w

    def put(rng: str, value=None, font=f_body, align=left, fill=None):
        """범위에 테두리/스타일을 먼저 입힌 뒤 병합하고 값을 기록."""
        for row in ws[rng] if ':' in rng else [[ws[rng]]]:
            for c in row:
                c.border = border
                if fill:
                    c.fill = fill
        if ':' in rng:
            ws.merge_cells(rng)
        tl = ws[rng.split(':')[0]]
        tl.value = value
        tl.font = font
        tl.alignment = align
        return tl

    def set_height(r: int, lines: int, min_h: float = 22):
        h = max(min_h, lines * _LINE_HEIGHT + 8)
        cur = ws.row_dimensions[r].height or 0
        ws.row_dimensions[r].height = min(max(cur, h), 409)

    # --- 제목 + 결재란 (1~4행) ---
    put('A1:D4', "작 업 계 획 서", font=f_title, align=center)
    put('E1:F1', "결   재", font=f_label, align=center, fill=fill_label)
    put('E2', "담당", font=f_label, align=center, fill=fill_label)
    put('F2', "팀장", font=f_label, align=center, fill=fill_label)
    put('E3:E4', None, align=center)
    put('F3:F4', None, align=center)
    for r, h in ((1, 20), (2, 20), (3, 24), (4, 24)):
        ws.row_dimensions[r].height = h

    row = 6

    def section(title: str):
        nonlocal row
        put(f'A{row}:F{row}', title, font=f_section, align=left, fill=fill_section)
        ws.row_dimensions[row].height = 22
        row += 1

    def full_row(label: str, value, empty_text="-", min_lines=1):
        """라벨(A:B) + 값(C:F) 한 줄. 값 길이에 맞춰 행 높이 자동 계산."""
        nonlocal row
        value = (value or "").strip() or empty_text
        put(f'A{row}:B{row}', label, font=f_label, align=center, fill=fill_label)
        put(f'C{row}:F{row}', value, align=left_top if min_lines > 1 or '\n' in value else left)
        lines = max(min_lines, _line_count(value, _span_width('C', 'F')))
        set_height(row, lines)
        row += 1

    def pair_row(l1: str, v1, l2: str, v2):
        """라벨(A:B) + 값(C:D) + 라벨(E) + 값(F)."""
        nonlocal row
        v1 = (v1 or "").strip() or "-"
        v2 = (v2 or "").strip() or "-"
        put(f'A{row}:B{row}', l1, font=f_label, align=center, fill=fill_label)
        put(f'C{row}:D{row}', v1)
        put(f'E{row}', l2, font=f_label, align=center, fill=fill_label)
        put(f'F{row}', v2)
        lines = max(_line_count(v1, _span_width('C', 'D')), _line_count(v2, _XL_WIDTHS['F']))
        set_height(row, lines)
        row += 1

    work_date = (plan.work_date or "").replace('T', ' ')

    # --- 1. 기본 정보 ---
    section("1. 기본 정보")
    full_row("작업명", plan.title)
    pair_row("작업 일시", work_date, "상태", plan.status)
    pair_row("사이트", plan.site, "작성자", engineer_name)
    pair_row("작업자", plan.worker, "결재/공유", plan.reviewer)
    pair_row("문서번호", plan.id, "작성일", datetime.now().strftime("%Y-%m-%d"))
    row += 1

    # --- 2. 작업 개요 ---
    section("2. 작업 개요")
    full_row("작업 목적", plan.purpose, min_lines=2)
    full_row("작업 영향도", plan.impact)
    full_row("사전 준비사항", plan.prerequisites, empty_text="해당 없음")
    row += 1

    # --- 3. 상세 작업 절차 (MOP) ---
    section("3. 상세 작업 절차 (Method of Procedure)")
    headers = ['No.', '작업 내용', '작업 상세 (CLI 및 상세 내용)', '소요시간', '작업자', '비고']
    for i, h in enumerate(headers):
        put(f'{_XL_COLS[i]}{row}', h, font=f_header, align=center, fill=fill_header)
    ws.row_dimensions[row].height = 22
    mop_header_row = row
    row += 1

    mop_lines = [l for l in (plan.mop_content or '').splitlines() if l.strip()]
    if not mop_lines:
        put(f'A{row}:F{row + 2}', "작성된 작업 절차가 없습니다.", align=center)
        row += 3
    else:
        for idx, line in enumerate(mop_lines, 1):
            values = [idx] + _parse_mop_line(line)
            lines = 1
            for i, v in enumerate(values):
                col = _XL_COLS[i]
                put(f'{col}{row}', v, align=center if col in ('A', 'D', 'E') else left)
                lines = max(lines, _line_count(v, _XL_WIDTHS[col]))
            set_height(row, lines)
            row += 1
    row += 1

    # --- 4. 추가 계획 ---
    section("4. 추가 계획")
    full_row("작업 후 확인사항", plan.verification, empty_text="해당 없음", min_lines=2)
    full_row("비상 계획\n(Rollback)", plan.rollback_plan, empty_text="해당 없음", min_lines=2)

    # --- 인쇄/보기 설정: A4 세로, 가로 1페이지 맞춤 ---
    ws.sheet_view.showGridLines = False
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.print_options.horizontalCentered = True
    ws.print_area = f'A1:F{row - 1}'
    ws.print_title_rows = f'{mop_header_row}:{mop_header_row}' if len(mop_lines) > 20 else None
    return wb


@router.get("/api/engineers/{eng_id}/workplans/{plan_id}/download")
def download_work_plan_excel_template(eng_id: str, plan_id: str, db: Session = Depends(get_db)):
    plan = db.query(WorkPlan).filter(WorkPlan.id == plan_id, WorkPlan.engineer_id == eng_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="작업 계획을 찾을 수 없습니다")

    engineer = db.query(Engineer).filter(Engineer.id == eng_id).first()
    wb = _build_work_plan_workbook(plan, engineer.name if engineer else "")

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    safe_title = re.sub(r'[\\/*?:"<>|]', "_", plan.title or "")
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', plan.work_date or "")
    work_date_str = "".join(m.groups()) if m else "N_A"
    filename = f"작업계획서_{work_date_str}_{safe_title}.xlsx"
    filename_encoded = quote(filename)

    return StreamingResponse(stream,
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={'Content-Disposition': f"attachment; filename*=UTF-8''{filename_encoded}"})
