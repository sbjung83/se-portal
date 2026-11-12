from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db, Incident
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/incidents", tags=["incidents"])


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
    return [_inc_dict(i) for i in query.order_by(Incident.occurred_at.desc()).all()]


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


@router.post("")
def create_incident(eng_id: str, data: IncidentIn, db: Session = Depends(get_db)):
    inc = Incident(id=str(uuid.uuid4()), engineer_id=eng_id,
                   created_at=datetime.now().strftime("%Y-%m-%d"), **data.dict())
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


@router.patch("/{inc_id}")
def update_incident(eng_id: str, inc_id: str, data: IncidentUpdate, db: Session = Depends(get_db)):
    inc = db.query(Incident).filter(Incident.id == inc_id, Incident.engineer_id == eng_id).first()
    if not inc:
        raise HTTPException(404, detail="장애 기록을 찾을 수 없습니다")
    for k, v in data.dict(exclude_none=True).items():
        setattr(inc, k, v)
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
    }
