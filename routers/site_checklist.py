from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, SiteChecklist, Site
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/site-checklist", tags=["site_checklist"])

@router.get("")
def list_all(eng_id: str, db: Session = Depends(get_db)):
    """엔지니어의 모든 사이트 체크리스트 (사이트별 그룹핑)"""
    sites = db.query(Site).filter(Site.engineer_id == eng_id).all()
    result = []
    for s in sites:
        items = db.query(SiteChecklist).filter(
            SiteChecklist.site_id == s.id,
            SiteChecklist.engineer_id == eng_id
        ).all()
        result.append({
            "site_id": s.id, "site_name": s.name,
            "items": [_cl_dict(i) for i in items]
        })
    return result

@router.get("/{site_id}")
def list_by_site(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    items = db.query(SiteChecklist).filter(
        SiteChecklist.site_id == site_id,
        SiteChecklist.engineer_id == eng_id
    ).all()
    return [_cl_dict(i) for i in items]

class CheckIn(BaseModel):
    site_id:  str
    text:     str
    category: Optional[str] = "일반"

@router.post("")
def create_item(eng_id: str, data: CheckIn, db: Session = Depends(get_db)):
    item = SiteChecklist(id=str(uuid.uuid4()), engineer_id=eng_id, **data.dict())
    db.add(item); db.commit()
    return _cl_dict(item)

class CheckUpdate(BaseModel):
    text:     Optional[str] = None
    category: Optional[str] = None
    done:     Optional[bool] = None

@router.patch("/{item_id}")
def update_item(eng_id: str, item_id: str, data: CheckUpdate, db: Session = Depends(get_db)):
    item = db.query(SiteChecklist).filter(
        SiteChecklist.id == item_id,
        SiteChecklist.engineer_id == eng_id
    ).first()
    if not item: raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    return _cl_dict(item)

@router.delete("/{item_id}")
def delete_item(eng_id: str, item_id: str, db: Session = Depends(get_db)):
    item = db.query(SiteChecklist).filter(
        SiteChecklist.id == item_id,
        SiteChecklist.engineer_id == eng_id
    ).first()
    if not item: raise HTTPException(404)
    db.delete(item); db.commit()
    return {"ok": True}

@router.post("/reset/{site_id}")
def reset_site(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    db.query(SiteChecklist).filter(
        SiteChecklist.site_id == site_id,
        SiteChecklist.engineer_id == eng_id
    ).update({"done": False})
    db.commit()
    return {"ok": True}

def _cl_dict(i):
    return {"id": i.id, "site_id": i.site_id, "category": i.category,
            "text": i.text, "done": i.done}
