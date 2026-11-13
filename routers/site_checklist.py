from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, SiteChecklist, Site
from pydantic import BaseModel
from typing import Optional
import uuid
import calendar
from datetime import date

# ── 주기 계산 ─────────────────────────────────
# 월간/분기 항목은 완료한 주기(done_period)가 현재 주기와 같을 때만 완료로 본다 → 달/분기가 바뀌면 자동 초기화.
# 일반 항목은 주기 없음(한 번 완료하면 계속 완료).
def period_info(category: str, today: date = None):
    t = today or date.today()
    if category == "월간":
        end = date(t.year, t.month, calendar.monthrange(t.year, t.month)[1])
        return f"{t.year}-{t.month:02d}", f"{t.month}월", end
    if category == "분기":
        q = (t.month - 1) // 3 + 1
        em = q * 3
        end = date(t.year, em, calendar.monthrange(t.year, em)[1])
        return f"{t.year}-Q{q}", f"{q}분기", end
    return "", "", None

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
    if not db.query(Site).filter(Site.id == data.site_id, Site.engineer_id == eng_id).first():
        raise HTTPException(404, detail="사이트를 찾을 수 없습니다")
    if not data.text.strip():
        raise HTTPException(400, detail="내용을 입력해주세요")
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
    upd = data.dict(exclude_none=True)
    was_done = _is_done(item)
    for k, v in upd.items():
        setattr(item, k, v)
    if "done" in upd:
        item.done_period = period_info(item.category)[0] if upd["done"] else ""
    elif "category" in upd and was_done:
        item.done, item.done_period = True, period_info(item.category)[0]   # 분류 변경 시 완료 상태 유지
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
    ).update({"done": False, "done_period": ""})
    db.commit()
    return {"ok": True}

def _is_done(i):
    if not i.done:
        return False
    key = period_info(i.category)[0]
    return not key or (i.done_period or "") == key

def _cl_dict(i):
    key, label, end = period_info(i.category)
    return {"id": i.id, "site_id": i.site_id, "category": i.category,
            "text": i.text, "done": _is_done(i),
            "period": label,                                  # 예: "11월", "4분기" (일반은 "")
            "due": end.isoformat() if end else "",            # 현재 주기 마감일
            "days_left": (end - date.today()).days if end else None}
