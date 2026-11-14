"""점검 일정과 기술지원을 같은 입력 창으로 다루기 위한 통합 저장 API.

구분(types)은 여러 개 고를 수 있다: 점검 / 기술지원 / 납품 / 유선원격 / 이전 / 기타
 - '점검'이 들어 있으면 점검 일정(Schedule)으로 저장하고, 함께 고른 지원 구분은 Schedule.extra_types 에 둔다.
   작업자·결재자·세부 작업계획은 id 가 같은 WorkPlan 레코드(연동 레코드)에 보관한다.
 - '점검'이 없으면 기술지원(WorkPlan, id 'wp-…')으로 저장하고 구분은 support_type 에 쉼표로 이어 둔다.
 - 수정하면서 '점검' 체크가 바뀌면 다른 쪽 표로 옮긴다(구글 캘린더 연결도 따라 옮김).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Site, Schedule, WorkPlan, CalendarEvent
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/entries", tags=["entries"])

CHECK = "점검"
SUPPORT_TYPES = ("기술지원", "납품", "유선원격", "이전", "기타")
ALL_TYPES = (CHECK,) + SUPPORT_TYPES
SCHED_TYPES = ("월간", "분기", "특별")
STATUSES = ("예정", "완료")
PLAN_FIELDS = ("worker", "reviewer", "impact", "prerequisites", "mop_content", "verification", "rollback_plan")


def split_types(value) -> list:
    """'기술지원,납품' → ['기술지원', '납품'] (정해진 순서, 모르는 값 제외)"""
    got = {t.strip() for t in str(value or "").split(",")}
    return [t for t in SUPPORT_TYPES if t in got]


class EntryIn(BaseModel):
    types: List[str]
    title: str
    day: str                              # "YYYY-MM-DD"
    time: Optional[str] = ""              # "HH:MM" (선택)
    site_id: Optional[str] = ""
    site_name: Optional[str] = ""         # 사이트로 등록되지 않은 고객사 이름(기술지원만)
    sched_type: Optional[str] = "월간"
    status: Optional[str] = "예정"
    memo: Optional[str] = ""              # 점검: 메모 / 기술지원: 작업 목적
    worker: Optional[str] = ""
    reviewer: Optional[str] = ""
    impact: Optional[str] = ""
    prerequisites: Optional[str] = ""
    mop_content: Optional[str] = ""
    verification: Optional[str] = ""
    rollback_plan: Optional[str] = ""


def _sites(db, eng_id):
    return db.query(Site).filter(Site.engineer_id == eng_id).all()


def _from_schedule(s: Schedule, plan, site_names: dict):
    wd = (plan.work_date if plan else "") or ""
    d = {"id": s.id, "kind": "schedule", "types": [CHECK] + split_types(s.extra_types),
         "title": s.title, "day": (s.sched_date or "")[:10], "time": wd[11:16] if wd[:10] == (s.sched_date or "")[:10] else "",
         "site_id": s.site_id, "site_name": site_names.get(s.site_id, ""), "sched_type": s.sched_type or "월간",
         "status": s.status or "예정", "memo": s.memo or "", "has_plan": bool(plan)}
    for f in PLAN_FIELDS:
        d[f] = (getattr(plan, f) if plan else "") or ""
    return d


def _from_workplan(p: WorkPlan, sites):
    site = next((s for s in sites if s.name == (p.site or "")), None)
    d = {"id": p.id, "kind": "workplan", "types": split_types(p.support_type) or ["기술지원"],
         "title": p.title, "day": (p.work_date or "")[:10], "time": (p.work_date or "")[11:16],
         "site_id": site.id if site else "", "site_name": p.site or "", "sched_type": "월간",
         "status": p.status if p.status in STATUSES else "예정", "memo": p.purpose or "", "has_plan": True}
    for f in PLAN_FIELDS:
        d[f] = getattr(p, f) or ""
    return d


def _find(db, eng_id, entry_id):
    sch = db.query(Schedule).filter(Schedule.id == entry_id, Schedule.engineer_id == eng_id).first()
    plan = db.query(WorkPlan).filter(WorkPlan.id == entry_id, WorkPlan.engineer_id == eng_id).first()
    return sch, plan


@router.get("/{entry_id}")
def get_entry(eng_id: str, entry_id: str, db: Session = Depends(get_db)):
    sch, plan = _find(db, eng_id, entry_id)
    sites = _sites(db, eng_id)
    if sch:
        return _from_schedule(sch, plan, {s.id: s.name for s in sites})
    if plan and plan.id.startswith("wp-"):
        return _from_workplan(plan, sites)
    raise HTTPException(404, detail="일정을 찾을 수 없습니다")


def _save(db, eng_id: str, data: EntryIn, entry_id: Optional[str]):
    types = [t for t in ALL_TYPES if t in set(data.types or [])]
    if not types:
        raise HTTPException(400, detail="구분을 하나 이상 골라주세요 (점검 / 기술지원 / 납품 / 유선원격 / 이전 / 기타)")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(400, detail="제목을 입력해주세요")
    try:
        day = datetime.strptime((data.day or "")[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, detail="날짜를 입력해주세요")
    tm = (data.time or "").strip()[:5]
    if tm:
        try:
            datetime.strptime(tm, "%H:%M")
        except ValueError:
            raise HTTPException(400, detail="시간 형식이 올바르지 않습니다 (HH:MM)")
    when = f"{day}T{tm}" if tm else day
    status = data.status or "예정"
    if status not in STATUSES:
        raise HTTPException(400, detail="상태 값이 올바르지 않습니다 (예정 / 완료)")
    sched_type = data.sched_type or "월간"
    if sched_type not in SCHED_TYPES:
        raise HTTPException(400, detail="점검 유형이 올바르지 않습니다 (월간 / 분기 / 특별)")
    site = None
    if data.site_id:
        site = db.query(Site).filter(Site.id == data.site_id, Site.engineer_id == eng_id).first()
        if not site:
            raise HTTPException(404, detail="사이트를 찾을 수 없습니다")
    is_check = CHECK in types
    supports = [t for t in types if t != CHECK]
    if is_check and not site:
        raise HTTPException(400, detail="점검은 사이트를 골라야 합니다")
    site_name = site.name if site else (data.site_name or "").strip()
    plan_vals = {f: getattr(data, f) or "" for f in PLAN_FIELDS}
    has_plan_vals = any(v for f, v in plan_vals.items() if not (f == "impact" and v == "없음"))

    old_sch, old_plan = _find(db, eng_id, entry_id) if entry_id else (None, None)
    if entry_id and not old_sch and not (old_plan and old_plan.id.startswith("wp-")):
        raise HTTPException(404, detail="일정을 찾을 수 없습니다")

    if is_check:
        sch = old_sch
        if sch is None:
            sch = Schedule(id=str(uuid.uuid4()), engineer_id=eng_id)
            db.add(sch)
        sch.site_id, sch.title, sch.sched_date, sch.sched_type = site.id, title, day, sched_type
        sch.status, sch.memo, sch.extra_types = status, data.memo or "", ",".join(supports)
        plan = old_plan if old_sch else None            # 연동 레코드(id = 일정 id)
        if plan is None and (has_plan_vals or tm):
            plan = WorkPlan(id=sch.id, engineer_id=eng_id, purpose="", support_type="기술지원")
            db.add(plan)
        if plan is not None:
            plan.title, plan.work_date, plan.site, plan.status = title, when, site_name, status
            for f, v in plan_vals.items():
                setattr(plan, f, v)
        if old_plan is not None and not old_sch:         # 기술지원 → 점검으로 옮김
            db.delete(old_plan)
        new_id, kind = sch.id, "schedule"
    else:
        plan = old_plan if (old_plan and not old_sch) else None
        if plan is None:
            plan = WorkPlan(id=f"wp-{uuid.uuid4().hex[:8]}", engineer_id=eng_id)
            db.add(plan)
        plan.title, plan.work_date, plan.site, plan.status = title, when, site_name, status
        plan.purpose, plan.support_type = data.memo or "", ",".join(supports)
        for f, v in plan_vals.items():
            setattr(plan, f, v)
        if old_sch is not None:                          # 점검 → 기술지원으로 옮김
            if old_plan is not None:
                db.delete(old_plan)
            db.delete(old_sch)
        new_id, kind = plan.id, "workplan"

    if entry_id and new_id != entry_id:                  # 구글 캘린더 연결도 새 레코드로 옮긴다
        for ev in db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id, CalendarEvent.target_id == entry_id):
            ev.target_id, ev.target_type = new_id, kind
            ev.kind = CHECK if is_check else "기술지원"
            ev.sub_type = sched_type if is_check else ",".join(supports)
            ev.site_id = site.id if site else ""
    db.commit()
    return {"ok": True, "id": new_id, "kind": kind}


@router.post("")
def create_entry(eng_id: str, data: EntryIn, db: Session = Depends(get_db)):
    return _save(db, eng_id, data, None)


@router.put("/{entry_id}")
def update_entry(eng_id: str, entry_id: str, data: EntryIn, db: Session = Depends(get_db)):
    return _save(db, eng_id, data, entry_id)
