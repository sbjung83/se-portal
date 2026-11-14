from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Schedule, Site, WorkPlan
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/schedules", tags=["schedules"])

SCHED_TYPES = ("월간", "분기", "특별")
SCHED_STATUSES = ("예정", "완료")

def _validate(db: Session, eng_id: str, site_id=None, title=None, sched_date=None, sched_type=None, status=None):
    """넘어온 값만 검사한다 (None은 건너뜀)."""
    if site_id is not None and not db.query(Site).filter(Site.id == site_id, Site.engineer_id == eng_id).first():
        raise HTTPException(404, detail="사이트를 찾을 수 없습니다")
    if title is not None and not title.strip():
        raise HTTPException(400, detail="제목을 입력해주세요")
    if sched_date is not None:
        try:
            datetime.strptime(sched_date[:10], "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, detail="점검일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    if sched_type is not None and sched_type not in SCHED_TYPES:
        raise HTTPException(400, detail=f"점검 유형이 올바르지 않습니다 ({' / '.join(SCHED_TYPES)})")
    if status is not None and status not in SCHED_STATUSES:
        raise HTTPException(400, detail=f"상태 값이 올바르지 않습니다 ({' / '.join(SCHED_STATUSES)})")

def _site_names(db: Session, eng_id: str) -> dict:
    return {s.id: s.name for s in db.query(Site).filter(Site.engineer_id == eng_id).all()}

def _sch_list(rows, db: Session, eng_id: str):
    names = _site_names(db, eng_id)      # 일정마다 사이트를 따로 조회하지 않도록 한 번에 읽음
    return [_sch_dict(r, db, names) for r in rows]

def _quarter(month: int) -> int:
    return (month - 1) // 3 + 1

def _quarter_months(q: int, year: int) -> list:
    start = (q - 1) * 3 + 1
    return [f"{year}-{str(m).zfill(2)}" for m in range(start, start + 3)]

@router.get("")
def list_schedules(
    eng_id: str,
    month:   Optional[str] = None,
    quarter: Optional[int] = None,
    year:    Optional[int] = None,
    db: Session = Depends(get_db)
):
    now   = datetime.now()
    yr    = year or now.year
    query = db.query(Schedule).filter(Schedule.engineer_id == eng_id)

    if quarter:
        months = _quarter_months(quarter, yr)
        query  = query.filter(
            Schedule.sched_date.startswith(months[0]) |
            Schedule.sched_date.startswith(months[1]) |
            Schedule.sched_date.startswith(months[2])
        )
    elif month:
        query = query.filter(Schedule.sched_date.startswith(month))
    else:
        ym    = now.strftime("%Y-%m")
        query = query.filter(Schedule.sched_date.startswith(ym))

    rows = query.order_by(Schedule.sched_date).all()
    return _sch_list(rows, db, eng_id)

@router.get("/history")
def list_schedule_history(eng_id: str, db: Session = Depends(get_db)):
    """완료된 점검 이력 반환"""
    rows = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.status == "완료"
    ).order_by(Schedule.sched_date.desc()).all()
    return _sch_list(rows, db, eng_id)

@router.get("/all")
def list_all_schedules(eng_id: str, year: Optional[int] = None, db: Session = Depends(get_db)):
    """연도 전체 일정 반환 (점검 일정 관리 페이지용)"""
    yr    = str(year or datetime.now().year)
    rows  = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.sched_date.startswith(yr)
    ).order_by(Schedule.sched_date).all()
    return _sch_list(rows, db, eng_id)

class ScheduleIn(BaseModel):
    site_id:    str
    title:      str
    sched_date: str
    sched_type: Optional[str] = "월간"
    status:     Optional[str] = "예정"
    memo:       Optional[str] = ""

@router.post("")
def create_schedule(eng_id: str, data: ScheduleIn, db: Session = Depends(get_db)):
    _validate(db, eng_id, data.site_id, data.title, data.sched_date, data.sched_type, data.status)
    sch = Schedule(id=str(uuid.uuid4()), engineer_id=eng_id, **data.dict())
    db.add(sch); db.commit()
    return _sch_dict(sch, db)

# ── 여러 일정 한 번에 등록 (지난 일정 복사) ─────────
class BulkItem(BaseModel):
    site_id:    str
    title:      str
    sched_date: str
    sched_type: Optional[str] = "월간"
    memo:       Optional[str] = ""
    copy_plan_from: Optional[str] = None   # 원본 일정 id — 그 일정의 작업자/결재자/MOP 보관 레코드를 함께 복사

class BulkIn(BaseModel):
    items: List[BulkItem]

@router.post("/bulk")
def create_schedules_bulk(eng_id: str, data: BulkIn, db: Session = Depends(get_db)):
    if not data.items:
        raise HTTPException(400, detail="등록할 일정이 없습니다")
    if len(data.items) > 200:
        raise HTTPException(400, detail="한 번에 200건까지 등록할 수 있습니다")
    names = _site_names(db, eng_id)
    for it in data.items:            # 하나라도 잘못되면 아무것도 등록하지 않음
        if it.site_id not in names:
            raise HTTPException(404, detail="사이트를 찾을 수 없습니다")
        _validate(db, eng_id, None, it.title, it.sched_date, it.sched_type)
    created = []
    for it in data.items:
        sch = Schedule(id=str(uuid.uuid4()), engineer_id=eng_id, site_id=it.site_id, title=it.title.strip(),
                       sched_date=it.sched_date[:10], sched_type=it.sched_type, status="예정", memo=it.memo or "")
        db.add(sch)
        if it.copy_plan_from:
            src = db.query(WorkPlan).filter(WorkPlan.id == it.copy_plan_from, WorkPlan.engineer_id == eng_id).first()
            if src and (src.worker or src.reviewer or src.mop_content):
                db.add(WorkPlan(id=sch.id, engineer_id=eng_id, title=sch.title, work_date=sch.sched_date,
                                site=names[it.site_id], worker=src.worker, reviewer=src.reviewer,
                                purpose=src.purpose, impact=src.impact, prerequisites=src.prerequisites,
                                mop_content=src.mop_content, verification=src.verification,
                                rollback_plan=src.rollback_plan, status="계획중", support_type=src.support_type))
        created.append(sch)
    db.commit()
    return {"ok": True, "count": len(created), "items": [_sch_dict(s, db, names) for s in created]}

class ScheduleUpdate(BaseModel):
    site_id:    Optional[str] = None
    title:      Optional[str] = None
    sched_date: Optional[str] = None
    sched_type: Optional[str] = None
    status:     Optional[str] = None
    memo:       Optional[str] = None

@router.patch("/{sch_id}")
def update_schedule(eng_id: str, sch_id: str, data: ScheduleUpdate, db: Session = Depends(get_db)):
    sch = db.query(Schedule).filter(Schedule.id == sch_id, Schedule.engineer_id == eng_id).first()
    if not sch: raise HTTPException(404, detail="점검 일정을 찾을 수 없습니다")
    _validate(db, eng_id, data.site_id, data.title, data.sched_date, data.sched_type, data.status)
    for k, v in data.dict(exclude_none=True).items():
        setattr(sch, k, v)
    db.commit()
    return _sch_dict(sch, db)

@router.delete("/{sch_id}")
def delete_schedule(eng_id: str, sch_id: str, db: Session = Depends(get_db)):
    sch = db.query(Schedule).filter(Schedule.id == sch_id, Schedule.engineer_id == eng_id).first()
    if not sch: raise HTTPException(404, detail="점검 일정을 찾을 수 없습니다")
    # 점검일정 모달에서 만든 작업자/결재자/MOP 보관 레코드(WorkPlan.id == Schedule.id)도 함께 삭제
    db.query(WorkPlan).filter(WorkPlan.id == sch.id, WorkPlan.engineer_id == eng_id).delete()
    db.delete(sch); db.commit()
    return {"ok": True}

def _sch_dict(s, db, names: dict = None):
    if names is None:
        site = db.query(Site).filter(Site.id == s.site_id).first()
        name = site.name if site else ""
    else:
        name = names.get(s.site_id, "")
    return {
        "id": s.id, "site_id": s.site_id,
        "site_name": name,
        "title": s.title, "sched_date": s.sched_date,
        "sched_type": s.sched_type, "status": s.status,
        "memo": s.memo or ""
    }
