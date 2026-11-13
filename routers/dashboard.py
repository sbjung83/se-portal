from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Schedule, Issue, WorkPlan, Incident
from datetime import datetime
from routers.technotes import support_only

router = APIRouter(prefix="/api/engineers/{eng_id}/dashboard", tags=["dashboard"])

@router.get("")
def get_dashboard(eng_id: str, db: Session = Depends(get_db)):
    today_ym = datetime.now().strftime("%Y-%m")
    sites       = db.query(Site).filter(Site.engineer_id == eng_id).all()
    site_ids    = [s.id for s in sites]
    all_devices = db.query(Device).filter(Device.site_id.in_(site_ids)).all() if site_ids else []
    # 이번 달 서비스 지원 실적 (기술지원 = 작업계획, 장애처리 = Incident)
    monthly_support = support_only(db.query(WorkPlan).filter(
        WorkPlan.engineer_id == eng_id,
        WorkPlan.work_date.startswith(today_ym)
    )).count()
    monthly_incidents = db.query(Incident).filter(
        Incident.engineer_id == eng_id,
        Incident.occurred_at.startswith(today_ym)
    ).count()
    schedules_this_month = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.sched_date.startswith(today_ym)
    ).order_by(Schedule.sched_date).all()
    # 전체 반환 - 페이지네이션은 프론트에서 처리
    open_issues = db.query(Issue).filter(
        Issue.engineer_id == eng_id,
        Issue.status != "완료"
    ).order_by(Issue.created_at.desc()).all()

    expiring = []
    for d in all_devices:
        days = _warranty_days(d.warranty)
        if days is not None and days <= 90:
            site = next((s for s in sites if any(dev.id == d.id for dev in s.devices)), None)
            expiring.append({
                "id": d.id, "name": d.name,
                "warranty": d.warranty, "warranty_days": days,
                "site_name": site.name if site else ""
            })
    expiring.sort(key=lambda x: x["warranty_days"])

    sched_done  = sum(1 for s in schedules_this_month if s.status == "완료")
    sched_total = len(schedules_this_month)

    return {
        "site_count":        len(sites),
        "device_count":      len(all_devices),
        "monthly_support_count":  monthly_support,
        "monthly_incident_count": monthly_incidents,
        "schedule_summary":  {"total": sched_total, "done": sched_done},
        "schedules":  [_sch(s, sites) for s in schedules_this_month],
        "issues":     [_iss(i, sites) for i in open_issues],   # 전체
        "issues_all": [_iss(i, sites) for i in open_issues],   # 명시적 전체 키
        "expiring_warranties": expiring[:5]
    }

def _sch(s, sites):
    site = next((x for x in sites if x.id == s.site_id), None)
    return {"id": s.id, "title": s.title, "sched_date": s.sched_date,
            "sched_type": s.sched_type, "status": s.status, "memo": s.memo or "",
            "site_id": s.site_id, "site_name": site.name if site else ""}

def _iss(i, sites):
    site = next((x for x in sites if x.id == i.site_id), None)
    return {"id": i.id, "title": i.title, "body": i.body or "",
            "severity": i.severity, "status": i.status,
            "created_at": i.created_at, "site_id": i.site_id,
            "site_name": site.name if site else ""}

def _warranty_days(date_str):
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return (d - datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)).days
    except:
        return None
