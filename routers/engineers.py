from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Engineer, Site, WorkLog
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter(prefix="/api/engineers", tags=["engineers"])

@router.get("")
def list_engineers(db: Session = Depends(get_db)):
    engineers = db.query(Engineer).order_by(Engineer.name).all()
    result = []
    for e in engineers:
        site_count = db.query(Site).filter(Site.engineer_id == e.id).count()
        log_count  = db.query(WorkLog).filter(WorkLog.engineer_id == e.id).count()
        result.append({
            "id": e.id, "name": e.name, "memo": e.memo,
            "site_count": site_count, "log_count": log_count
        })
    return result

class EngineerIn(BaseModel):
    name: str
    memo: Optional[str] = ""

@router.post("")
def create_engineer(data: EngineerIn, db: Session = Depends(get_db)):
    exists = db.query(Engineer).filter(Engineer.name == data.name).first()
    if exists:
        raise HTTPException(400, f"'{data.name}' 엔지니어가 이미 존재합니다")
    eng = Engineer(id=str(uuid.uuid4()), name=data.name, memo=data.memo)
    db.add(eng); db.commit(); db.refresh(eng)
    return {"id": eng.id, "name": eng.name}

@router.delete("/{eng_id}")
def delete_engineer(eng_id: str, db: Session = Depends(get_db)):
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    if not eng:
        raise HTTPException(404)
    db.delete(eng); db.commit()
    return {"ok": True}
