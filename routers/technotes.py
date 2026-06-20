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

@router.get("/api/engineers/{eng_id}/workplans/{plan_id}/download")
def download_work_plan_excel_template(eng_id: str, plan_id: str, db: Session = Depends(get_db)):
    plan = db.query(WorkPlan).filter(WorkPlan.id == plan_id, WorkPlan.engineer_id == eng_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="작업 계획을 찾을 수 없습니다")
    
    engineer = db.query(Engineer).filter(Engineer.id == eng_id).first()
    engineer_name = engineer.name if engineer else ""

    wb = Workbook()
    ws = wb.active
    ws.title = "작업계획서"

    # --- Styles ---
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)
    top_left_align = Alignment(horizontal='left', vertical='top', wrap_text=True)
    
    title_font = Font(name='맑은 고딕', size=20, bold=True)
    group_title_font = Font(name='맑은 고딕', size=13, bold=True)
    header_font = Font(name='맑은 고딕', size=10, bold=True, color="FFFFFF")
    label_font = Font(name='맑은 고딕', size=10, bold=True)
    content_font = Font(name='맑은 고딕', size=10)
    
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    label_fill = PatternFill(start_color="DDEBF7", end_color="DDEBF7", fill_type="solid")

    # --- Helper to apply border to merged cells ---
    def apply_border_to_merged_cells(cell_range_str):
        cells = ws[cell_range_str]
        # Handle both single cells and ranges
        if hasattr(cells, '__iter__') and not isinstance(cells, str):
            for row in cells:
                for cell in row:
                    cell.border = thin_border
        else:
            cells.border = thin_border

    # --- Column Widths (6-column layout) ---
    ws.column_dimensions['A'].width = 5   # No.
    ws.column_dimensions['B'].width = 30  # 작업 내용
    ws.column_dimensions['C'].width = 55  # 작업 상세
    ws.column_dimensions['D'].width = 15  # 소요시간(분)
    ws.column_dimensions['E'].width = 15  # 작업자
    ws.column_dimensions['F'].width = 25  # 비고

    # --- Main Title ---
    ws['A1'].value = "작업 계획서 (Work Plan)"
    ws['A1'].font = title_font
    ws['A1'].alignment = center_align
    ws.merge_cells('A1:D2')
    apply_border_to_merged_cells('A1:D2')

    # --- Approval Section ---
    ws['E1'].value = "결   재"
    ws['E1'].font = label_font
    ws['E1'].alignment = center_align
    ws['E1'].fill = label_fill
    ws.merge_cells('E1:F1')
    
    ws['E2'].value = "담당"
    ws['E2'].font = label_font
    ws['E2'].alignment = center_align
    ws['E2'].fill = label_fill
    
    ws['F2'].value = "팀장"
    ws['F2'].font = label_font
    ws['F2'].alignment = center_align
    ws['F2'].fill = label_fill
    
    ws.merge_cells('E3:E4')
    ws.merge_cells('F3:F4')
    for cell_range in ['E1:F1', 'E2', 'F2', 'E3:E4', 'F3:F4']:
        apply_border_to_merged_cells(cell_range if ':' in cell_range else cell_range)

    # --- Section 1: 개요 ---
    current_row = 6
    cell = ws[f'A{current_row}']
    cell.value = "1. 작업 개요"
    cell.font = group_title_font
    cell.fill = label_fill
    cell.alignment = center_align
    ws.merge_cells(f'A{current_row}:F{current_row}')
    apply_border_to_merged_cells(f'A{current_row}:F{current_row}')
    current_row += 1

    overview_data = [
        ("문서번호", plan.id, "작성자", engineer_name),
        ("작성일", datetime.now().strftime("%Y-%m-%d"), "문서상태", plan.status),
        ("작업명", plan.title, None, None),
        ("작업일시", plan.work_date.replace('T', ' ') if plan.work_date else '', "대상 사이트", plan.site),
        ("작업자", plan.worker, "공유/검토", plan.reviewer),
        ("작업 목적", plan.purpose, None, None),
        ("작업 영향도", plan.impact, None, None),
    ]

    for item1, value1, item2, value2 in overview_data:
        cell = ws[f'A{current_row}']
        cell.value = item1
        cell.font = label_font
        cell.fill = label_fill
        cell.alignment = center_align
        ws.merge_cells(f'A{current_row}:B{current_row}')
        apply_border_to_merged_cells(f'A{current_row}:B{current_row}')
        
        if item2 is not None:
            cell = ws[f'C{current_row}']
            cell.value = value1
            cell.font = content_font
            cell.alignment = top_left_align
            ws.merge_cells(f'C{current_row}:D{current_row}')
            apply_border_to_merged_cells(f'C{current_row}:D{current_row}')

            ws[f'E{current_row}'].value = item2
            ws[f'E{current_row}'].font = label_font
            ws[f'E{current_row}'].fill = label_fill
            ws[f'E{current_row}'].alignment = center_align
            ws[f'E{current_row}'].border = thin_border
            
            ws[f'F{current_row}'].value = value2
            ws[f'F{current_row}'].font = content_font
            ws[f'F{current_row}'].alignment = top_left_align
            ws[f'F{current_row}'].border = thin_border
        else:
            cell = ws[f'C{current_row}']
            cell.value = value1
            cell.font = content_font
            cell.alignment = top_left_align
            ws.merge_cells(f'C{current_row}:F{current_row}')
            apply_border_to_merged_cells(f'C{current_row}:F{current_row}')
        current_row += 1
    
    # --- Section 2: 사전 계획 ---
    current_row += 1
    cell = ws[f'A{current_row}']
    cell.value = "2. 사전 준비 및 계획"
    cell.font = group_title_font
    cell.fill = label_fill
    cell.alignment = center_align
    ws.merge_cells(f'A{current_row}:F{current_row}')
    apply_border_to_merged_cells(f'A{current_row}:F{current_row}')
    current_row += 1

    plan_data = [("사전 준비사항", plan.prerequisites), ("비상 계획 (Rollback)", plan.rollback_plan)]
    for label, value in plan_data:
        cell = ws[f'A{current_row}']
        cell.value = label
        cell.font = label_font
        cell.fill = label_fill
        cell.alignment = center_align
        ws.merge_cells(f'A{current_row}:B{current_row}')
        apply_border_to_merged_cells(f'A{current_row}:B{current_row}')
        
        cell = ws[f'C{current_row}']
        cell.value = value or "해당 없음"
        cell.font = content_font
        cell.alignment = top_left_align
        ws.merge_cells(f'C{current_row}:F{current_row+1}')
        apply_border_to_merged_cells(f'C{current_row}:F{current_row+1}')
        ws.row_dimensions[current_row].height = 30
        ws.row_dimensions[current_row+1].height = 30
        current_row += 2

    # --- Section 3: MOP ---
    current_row += 1
    cell = ws[f'A{current_row}']
    cell.value = "3. 상세 작업 절차 (MOP)"
    cell.font = group_title_font
    cell.fill = label_fill
    cell.alignment = center_align
    ws.merge_cells(f'A{current_row}:F{current_row}')
    apply_border_to_merged_cells(f'A{current_row}:F{current_row}')
    current_row += 1
    
    mop_headers = ['No.', '작업 내용', '작업 상세 (cli 및 상세 내용)', '소요시간(분)', '작업자', '비고']
    for i, header in enumerate(mop_headers, 1):
        cell = ws.cell(row=current_row, column=i, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
    current_row += 1
    
    mop_lines = [line for line in (plan.mop_content or '').split('\n') if line.strip()]
    if not mop_lines:
        cell = ws[f'A{current_row}']
        cell.value = "작성된 MOP 내용이 없습니다."
        cell.font = content_font
        cell.alignment = center_align
        ws.merge_cells(f'A{current_row}:F{current_row+4}')
        apply_border_to_merged_cells(f'A{current_row}:F{current_row+4}')
        current_row += 5
    else:
        for index, line in enumerate(mop_lines, 1):
            parts = [p.strip() for p in line.split('#')]
            row_data = [
                index,
                parts[0] if len(parts) > 0 else '',
                parts[1] if len(parts) > 1 else '',
                parts[2] if len(parts) > 2 else '',
                parts[3] if len(parts) > 3 else '',
                parts[4] if len(parts) > 4 else '',
            ]
            for col, value in enumerate(row_data, 1):
                cell = ws.cell(row=current_row, column=col, value=value)
                cell.font = content_font
                cell.border = thin_border
                if col in [1, 4, 5]: 
                    cell.alignment = center_align
                else: 
                    cell.alignment = top_left_align
            ws.row_dimensions[current_row].height = 40
            current_row += 1

    # --- Section 4: 작업 후 확인 ---
    current_row += 1
    cell = ws[f'A{current_row}']
    cell.value = "4. 작업 후 확인사항"
    cell.font = group_title_font
    cell.fill = label_fill
    cell.alignment = center_align
    ws.merge_cells(f'A{current_row}:F{current_row}')
    apply_border_to_merged_cells(f'A{current_row}:F{current_row}')
    current_row += 1
    
    cell = ws[f'A{current_row}']
    cell.value = "확인 절차"
    cell.font = label_font
    cell.fill = label_fill
    cell.alignment = center_align
    ws.merge_cells(f'A{current_row}:B{current_row}')
    apply_border_to_merged_cells(f'A{current_row}:B{current_row}')
    
    cell = ws[f'C{current_row}']
    cell.value = plan.verification or "해당 없음"
    cell.font = content_font
    cell.alignment = top_left_align
    ws.merge_cells(f'C{current_row}:F{current_row+2}')
    apply_border_to_merged_cells(f'C{current_row}:F{current_row+2}')
    ws.row_dimensions[current_row].height = 30
    ws.row_dimensions[current_row+1].height = 30
    ws.row_dimensions[current_row+2].height = 30

    # --- Filename and Stream response ---
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    
    safe_title = re.sub(r'[\\/*?:"<>|]', "_", plan.title)
    work_date_str = (datetime.fromisoformat(plan.work_date.replace('T', ' ')).strftime("%Y%m%d") if plan.work_date else "N_A")
    filename = f"작업계획서_{work_date_str}_{safe_title}.xlsx"
    filename_encoded = quote(filename)

    return StreamingResponse(stream, 
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={'Content-Disposition': f"attachment; filename*=UTF-8''{filename_encoded}"})