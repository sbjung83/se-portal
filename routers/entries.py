"""점검 일정과 기술지원을 같은 입력 창으로 다루기 위한 통합 저장 API.

구분(types)은 여러 개 고를 수 있다: 점검 / 기술지원 / 장애처리 / 납품 / 유선원격 / 이전 / 기타
 - '점검'이 들어 있으면 점검 일정(Schedule)으로 저장하고, 함께 고른 지원 구분은 Schedule.extra_types 에 둔다.
   작업자·결재자·세부 작업계획은 id 가 같은 WorkPlan 레코드(연동 레코드)에 보관한다.
 - '점검'이 없으면 기술지원(WorkPlan, id 'wp-…')으로 저장하고 구분은 support_type 에 쉼표로 이어 둔다.
 - 수정하면서 '점검' 체크가 바뀌면 다른 쪽 표로 옮긴다(구글 캘린더 연결도 따라 옮김).
 - '장애처리'가 들어 있으면 장애처리 보고서(Incident)를 함께 저장한다. 점검/기술지원과 같이 고르면
   Incident.entry_id 에 그 일정의 id 를 두고, 장애처리만 고르면 Incident 1건만 만든다(entry_id 빈 값, 이때 일정 id = 장애 id).
   체크를 풀고 저장하면 보고서(Incident)는 지운다.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db, Site, Schedule, WorkPlan, CalendarEvent, Incident, Device
from routers.incidents import PartIn, clean_parts, load_parts
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/engineers/{eng_id}/entries", tags=["entries"])

CHECK = "점검"
SUPPORT_TYPES = ("기술지원", "납품", "유선원격", "이전", "기타")
INCIDENT = "장애처리"
ALL_TYPES = (CHECK,) + SUPPORT_TYPES + (INCIDENT,)
INC_SEVERITIES = ("긴급", "높음", "보통", "낮음")
INC_STATUSES = ("접수", "처리중", "완료")
INC_TEXT_FIELDS = ("symptom", "cause", "action", "prevention")
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
    # 장애처리 보고서 ('장애처리'를 체크했을 때만 쓴다)
    inc_title: Optional[str] = ""         # 장애명 (비우면 제목과 같게)
    inc_device: Optional[str] = ""
    inc_severity: Optional[str] = "보통"
    inc_status: Optional[str] = "접수"
    inc_occurred_at: Optional[str] = ""   # "YYYY-MM-DDTHH:MM" (비우면 일정의 날짜·시간)
    inc_recovered_at: Optional[str] = ""
    symptom: Optional[str] = ""
    cause: Optional[str] = ""
    action: Optional[str] = ""
    prevention: Optional[str] = ""
    inc_parts: Optional[List[PartIn]] = None   # 사용(교체) 파트
    device_ids: Optional[List[str]] = None     # 대상 장비 (그 사이트의 장비 id). None = 기존 값 유지


def _sites(db, eng_id):
    return db.query(Site).filter(Site.engineer_id == eng_id).all()


def _inc_fields(inc) -> dict:
    d = {"inc_id": inc.id if inc else "", "inc_title": (inc.title if inc else "") or "",
         "inc_device": (inc.device if inc else "") or "", "inc_severity": (inc.severity if inc else "") or "보통",
         "inc_status": (inc.status if inc else "") or "접수", "inc_occurred_at": (inc.occurred_at if inc else "") or "",
         "inc_recovered_at": (inc.recovered_at if inc else "") or "",
         "inc_parts": load_parts(inc.parts) if inc else []}
    for f in INC_TEXT_FIELDS:
        d[f] = (getattr(inc, f) if inc else "") or ""
    return d


def _from_incident(i: Incident, sites):
    """장애처리만 한 건 — 제목·날짜·사이트·작업자를 장애 기록에서 가져온다."""
    site = next((s for s in sites if s.name == (i.site or "")), None)
    occ = i.occurred_at or ""
    d = {"id": i.id, "kind": "incident", "types": [INCIDENT], "title": i.title, "day": occ[:10], "time": occ[11:16],
         "site_id": site.id if site else "", "site_name": i.site or "", "sched_type": "월간", "status": "예정",
         "memo": "", "has_plan": False, "worker": i.worker or ""}
    for f in PLAN_FIELDS:
        d.setdefault(f, "")
    d.update(_inc_fields(i))
    d["device_ids"] = split_ids(i.device_ids)
    return d


def split_ids(v) -> list:
    return [x for x in (v or "").split(",") if x]


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
    """(점검 일정, 기술지원/연동 레코드, 장애 기록). entry_id 는 일정 id 또는 장애 id.
    일정과 함께 등록된 장애의 id 를 주면 그 일정을 찾아 준다."""
    def base(i):
        sch = db.query(Schedule).filter(Schedule.id == i, Schedule.engineer_id == eng_id).first()
        plan = db.query(WorkPlan).filter(WorkPlan.id == i, WorkPlan.engineer_id == eng_id).first()
        if plan is not None and sch is None and not plan.id.startswith("wp-"):
            plan = None                                   # 일정이 지워지고 남은 연동 레코드
        return sch, plan
    sch, plan = base(entry_id)
    if sch or plan:
        inc = db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.entry_id == entry_id) \
                .order_by(Incident.occurred_at).first()
        return sch, plan, inc
    inc = db.query(Incident).filter(Incident.id == entry_id, Incident.engineer_id == eng_id).first()
    if inc is not None and inc.entry_id:
        sch, plan = base(inc.entry_id)                    # 일정이 지워졌으면 장애처리만 한 건으로 본다
    return sch, plan, inc


@router.get("/{entry_id}")
def get_entry(eng_id: str, entry_id: str, db: Session = Depends(get_db)):
    sch, plan, inc = _find(db, eng_id, entry_id)
    sites = _sites(db, eng_id)
    if sch:
        d = _from_schedule(sch, plan, {s.id: s.name for s in sites})
    elif plan:
        d = _from_workplan(plan, sites)
    elif inc:
        return _from_incident(inc, sites)
    else:
        raise HTTPException(404, detail="일정을 찾을 수 없습니다")
    d.update(_inc_fields(inc))
    if inc:
        d["types"].append(INCIDENT)
    d["device_ids"] = split_ids((sch.device_ids if sch else plan.device_ids) or (inc.device_ids if inc else ""))
    return d


def _save(db, eng_id: str, data: EntryIn, entry_id: Optional[str]):
    types = [t for t in ALL_TYPES if t in set(data.types or [])]
    if not types:
        raise HTTPException(400, detail="구분을 하나 이상 골라주세요 (점검 / 기술지원 / 장애처리 / 납품 / 유선원격 / 이전 / 기타)")
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
    has_inc = INCIDENT in types
    supports = [t for t in types if t in SUPPORT_TYPES]
    inc_only = has_inc and not is_check and not supports
    if has_inc:
        # 상태는 하나: 장애 처리 상태(접수/처리중/완료)를 따르고, 일정 쪽은 완료면 '완료' 아니면 '예정'
        status = "완료" if (data.inc_status or "접수") == "완료" else "예정"
        if (data.inc_severity or "보통") not in INC_SEVERITIES:
            raise HTTPException(400, detail="장애 등급이 올바르지 않습니다 (긴급 / 높음 / 보통 / 낮음)")
        if (data.inc_status or "접수") not in INC_STATUSES:
            raise HTTPException(400, detail="장애 처리 상태가 올바르지 않습니다 (접수 / 처리중 / 완료)")
        occurred = (data.inc_occurred_at or "").strip()[:16] or when
        recovered = (data.inc_recovered_at or "").strip()[:16]
        try:
            datetime.fromisoformat(occurred)
            if recovered:
                datetime.fromisoformat(recovered)
        except ValueError:
            raise HTTPException(400, detail="장애 발생/복구 일시 형식이 올바르지 않습니다")
        if recovered and recovered < occurred:
            raise HTTPException(400, detail="복구 일시가 발생 일시보다 빠릅니다")
    if is_check and not site:
        raise HTTPException(400, detail="점검은 사이트를 골라야 합니다")
    site_name = site.name if site else (data.site_name or "").strip()
    plan_vals = {f: getattr(data, f) or "" for f in PLAN_FIELDS}
    has_plan_vals = any(v for f, v in plan_vals.items() if not (f == "impact" and v == "없음"))

    old_sch, old_plan, old_inc = _find(db, eng_id, entry_id) if entry_id else (None, None, None)
    if entry_id and not old_sch and not old_plan and not old_inc:
        raise HTTPException(404, detail="일정을 찾을 수 없습니다")
    base_id = old_sch.id if old_sch else (old_plan.id if old_plan else None)     # 고치기 전 일정 id

    # 대상 장비: 고른 사이트의 장비만. 안 보냈으면(None) 기존 값 유지, 사이트가 없으면 비움
    if data.device_ids is None:
        old = next((o.device_ids for o in (old_sch, old_plan, old_inc) if o is not None and o.device_ids), "")
        dev_ids = [x for x in split_ids(old)]
    else:
        dev_ids = list(dict.fromkeys(x for x in data.device_ids if x))
    devs = db.query(Device).filter(Device.site_id == site.id, Device.id.in_(dev_ids)).all() if (site and dev_ids) else []
    dev_ids = [x for x in dev_ids if any(d.id == x for d in devs)]
    dev_csv = ",".join(dev_ids)

    if is_check:
        sch = old_sch
        if sch is None:
            sch = Schedule(id=str(uuid.uuid4()), engineer_id=eng_id)
            db.add(sch)
        sch.site_id, sch.title, sch.sched_date, sch.sched_type = site.id, title, day, sched_type
        sch.status, sch.memo, sch.extra_types = status, data.memo or "", ",".join(supports)
        sch.device_ids = dev_csv
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
    elif inc_only:                                       # 장애처리만 → 일정 쪽 레코드는 없앤다
        for o in (old_plan, old_sch):
            if o is not None:
                db.delete(o)
        new_id, kind = None, "incident"
    else:
        plan = old_plan if (old_plan and not old_sch) else None
        if plan is None:
            plan = WorkPlan(id=f"wp-{uuid.uuid4().hex[:8]}", engineer_id=eng_id)
            db.add(plan)
        plan.title, plan.work_date, plan.site, plan.status = title, when, site_name, status
        plan.purpose, plan.support_type = data.memo or "", ",".join(supports)
        plan.device_ids = dev_csv
        for f, v in plan_vals.items():
            setattr(plan, f, v)
        if old_sch is not None:                          # 점검 → 기술지원으로 옮김
            if old_plan is not None:
                db.delete(old_plan)
            db.delete(old_sch)
        new_id, kind = plan.id, "workplan"

    inc_id = ""
    if has_inc:                                          # 장애처리 보고서
        inc = old_inc
        if inc is None:
            inc = Incident(id=str(uuid.uuid4()), engineer_id=eng_id, created_at=datetime.now().strftime("%Y-%m-%d"))
            db.add(inc)
        inc.title = title if inc_only else ((data.inc_title or "").strip() or title)
        inc.site, inc.worker, inc.device = site_name, (data.worker or "").strip(), (data.inc_device or "").strip()
        inc.device_ids = dev_csv
        if not inc.device and devs:                      # 장애 장비 칸이 비었으면 고른 장비 이름으로
            inc.device = ", ".join(d.name for d in devs if d.id in dev_ids)
        inc.severity = data.inc_severity or "보통"
        inc.status = "처리중" if recovered and (data.inc_status or "접수") == "접수" else (data.inc_status or "접수")
        inc.occurred_at, inc.recovered_at = occurred, recovered
        for f in INC_TEXT_FIELDS:
            setattr(inc, f, getattr(data, f) or "")
        if data.inc_parts is not None:                   # 안 보냈으면 기존 파트 기록 유지
            inc.parts = clean_parts(data.inc_parts)
        inc.entry_id = "" if inc_only else new_id
        inc_id = inc.id
        if inc_only:
            new_id = inc.id
    elif old_inc is not None:                            # 체크를 풀었으면 보고서를 지운다
        db.delete(old_inc)

    old_target = base_id or (old_inc.id if old_inc is not None else None)   # 구글 캘린더가 가리키던 레코드
    if old_target and new_id != old_target:              # 구글 캘린더 연결도 새 레코드로 옮긴다 (장애처리만 남기면 장애로)
        for ev in db.query(CalendarEvent).filter(CalendarEvent.engineer_id == eng_id, CalendarEvent.target_id == old_target):
            ev.target_id, ev.target_type = new_id, kind
            ev.kind = CHECK if is_check else INCIDENT if inc_only else "기술지원"
            ev.sub_type = sched_type if is_check else "" if inc_only else ",".join(supports)
            ev.site_id = site.id if site else ""
    db.commit()
    return {"ok": True, "id": new_id, "kind": kind, "inc_id": inc_id}


@router.post("")
def create_entry(eng_id: str, data: EntryIn, db: Session = Depends(get_db)):
    return _save(db, eng_id, data, None)


@router.put("/{entry_id}")
def update_entry(eng_id: str, entry_id: str, data: EntryIn, db: Session = Depends(get_db)):
    return _save(db, eng_id, data, entry_id)
