from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Schedule, Site, WorkPlan
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/schedules", tags=["schedules"])

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
    return [_sch_dict(r, db) for r in rows]

@router.get("/history")
def list_schedule_history(eng_id: str, db: Session = Depends(get_db)):
    """완료된 점검 이력 반환"""
    rows = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.status == "완료"
    ).order_by(Schedule.sched_date.desc()).all()
    return [_sch_dict(r, db) for r in rows]

@router.get("/all")
def list_all_schedules(eng_id: str, year: Optional[int] = None, db: Session = Depends(get_db)):
    """연도 전체 일정 반환 (점검 일정 관리 페이지용)"""
    yr    = str(year or datetime.now().year)
    rows  = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.sched_date.startswith(yr)
    ).order_by(Schedule.sched_date).all()
    return [_sch_dict(r, db) for r in rows]

class ScheduleIn(BaseModel):
    site_id:    str
    title:      str
    sched_date: str
    sched_type: Optional[str] = "월간"
    status:     Optional[str] = "예정"
    memo:       Optional[str] = ""

@router.post("")
def create_schedule(eng_id: str, data: ScheduleIn, db: Session = Depends(get_db)):
    sch = Schedule(id=str(uuid.uuid4()), engineer_id=eng_id, **data.dict())
    db.add(sch); db.commit()
    return _sch_dict(sch, db)

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
    if not sch: raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(sch, k, v)
    db.commit()
    return _sch_dict(sch, db)

@router.delete("/{sch_id}")
def delete_schedule(eng_id: str, sch_id: str, db: Session = Depends(get_db)):
    sch = db.query(Schedule).filter(Schedule.id == sch_id, Schedule.engineer_id == eng_id).first()
    if not sch: raise HTTPException(404)
    # 점검일정 모달에서 만든 작업자/결재자/MOP 보관 레코드(WorkPlan.id == Schedule.id)도 함께 삭제
    db.query(WorkPlan).filter(WorkPlan.id == sch.id, WorkPlan.engineer_id == eng_id).delete()
    db.delete(sch); db.commit()
    return {"ok": True}

def _sch_dict(s, db):
    site = db.query(Site).filter(Site.id == s.site_id).first()
    return {
        "id": s.id, "site_id": s.site_id,
        "site_name": site.name if site else "",
        "title": s.title, "sched_date": s.sched_date,
        "sched_type": s.sched_type, "status": s.status,
        "memo": s.memo or ""
    }
