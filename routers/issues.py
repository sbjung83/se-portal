from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Issue, Site
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/issues", tags=["issues"])

@router.get("")
def list_issues(eng_id: str, status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Issue).filter(Issue.engineer_id == eng_id)
    if status:
        q = q.filter(Issue.status == status)
    return [_iss_dict(i, db) for i in q.order_by(Issue.created_at.desc()).all()]

class IssueIn(BaseModel):
    site_id:  str
    title:    str
    body:     Optional[str] = ""
    severity: Optional[str] = "보통"
    status:   Optional[str] = "오픈"

@router.post("")
def create_issue(eng_id: str, data: IssueIn, db: Session = Depends(get_db)):
    iss = Issue(id=str(uuid.uuid4()), engineer_id=eng_id,
                created_at=datetime.now().strftime("%Y-%m-%d"), **data.dict())
    db.add(iss); db.commit()
    return _iss_dict(iss, db)

class IssueUpdate(BaseModel):
    title:    Optional[str] = None
    body:     Optional[str] = None
    severity: Optional[str] = None
    status:   Optional[str] = None

@router.patch("/{iss_id}")
def update_issue(eng_id: str, iss_id: str, data: IssueUpdate, db: Session = Depends(get_db)):
    iss = db.query(Issue).filter(Issue.id == iss_id, Issue.engineer_id == eng_id).first()
    if not iss: raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(iss, k, v)
    db.commit()
    return _iss_dict(iss, db)

@router.delete("/{iss_id}")
def delete_issue(eng_id: str, iss_id: str, db: Session = Depends(get_db)):
    iss = db.query(Issue).filter(Issue.id == iss_id, Issue.engineer_id == eng_id).first()
    if not iss: raise HTTPException(404)
    db.delete(iss); db.commit()
    return {"ok": True}

def _iss_dict(i, db):
    site = db.query(Site).filter(Site.id == i.site_id).first()
    return {"id": i.id, "site_id": i.site_id,
            "site_name": site.name if site else "",
            "title": i.title, "body": i.body,
            "severity": i.severity, "status": i.status, "created_at": i.created_at}
