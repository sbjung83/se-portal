from fastapi import APIRouter, Depends
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Schedule, Issue, WorkPlan, Incident, Project
from datetime import datetime, timedelta
from routers.technotes import support_only
import eos_match

router = APIRouter(prefix="/api/engineers/{eng_id}/dashboard", tags=["dashboard"])

@router.get("")
def get_dashboard(eng_id: str, db: Session = Depends(get_db)):
    today_ym = datetime.now().strftime("%Y-%m")
    sites       = db.query(Site).filter(Site.engineer_id == eng_id).all()
    site_ids    = [s.id for s in sites if not s.archived]     # 보관한 사이트 장비는 워런티·EOS 에서 뺀다
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

    site_by_id = {s.id: s for s in sites}
    expiring = []
    for d in all_devices:
        days = _warranty_days(d.warranty)
        if days is not None and days <= 90:
            site = site_by_id.get(d.site_id)
            expiring.append({
                "id": d.id, "name": d.name,
                "warranty": d.warranty, "warranty_days": days,
                "site_id": d.site_id, "site_name": site.name if site else ""
            })
    expiring.sort(key=lambda x: x["warranty_days"])
    # OS 지원 종료·임박 장비 (OS별 EOS 현황과 장비 OS 칸을 맞춘 결과)
    idx = eos_match.load_index(db)
    eos_devices = []
    for d in all_devices:
        m = eos_match.device_alert(d, idx)
        if m:
            site = site_by_id.get(d.site_id)
            eos_devices.append({"id": d.id, "name": d.name, "os": d.os, "site_id": d.site_id,
                                "site_name": site.name if site else "", **m})
    eos_devices.sort(key=lambda x: (x["eol"] if x["eol"][:1].isdigit() else "0", x["site_name"], x["name"]))

    # ── 이번 주 / 다음 주 할 일 (주는 월~일, 지난 미완료 포함) ──
    now      = datetime.now()
    today    = now.strftime("%Y-%m-%d")
    this_end = (now + timedelta(days=6 - now.weekday())).strftime("%Y-%m-%d")       # 이번 주 일요일
    week_end = (now + timedelta(days=13 - now.weekday())).strftime("%Y-%m-%d")      # 다음 주 일요일
    this_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")         # 이번 주 월요일
    # 미완료는 다음 주 일요일까지 전부(지난 것 포함), 완료는 이번 주(월~일) 것만 함께 보낸다
    # → 대시보드에서 이번 주에 끝낸 일정이 사라지지 않고 흐리게 남는다.
    week_scheds = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id, Schedule.sched_date != "",
        or_(and_(Schedule.status != "완료", Schedule.sched_date <= week_end),
            and_(Schedule.status == "완료", Schedule.sched_date >= this_start, Schedule.sched_date <= this_end + "T99"))
    ).order_by(Schedule.sched_date).all()
    week_plans = support_only(db.query(WorkPlan).filter(
        WorkPlan.engineer_id == eng_id, WorkPlan.work_date != "",
        or_(and_(WorkPlan.status != "완료", WorkPlan.work_date <= week_end + "T99"),
            and_(WorkPlan.status == "완료", WorkPlan.work_date >= this_start, WorkPlan.work_date <= this_end + "T99"))
    )).order_by(WorkPlan.work_date).all()
    in_week = lambda col: and_(col >= this_start, col <= this_end + "T99")
    open_incidents = db.query(Incident).filter(
        Incident.engineer_id == eng_id,
        or_(Incident.status != "완료",
            and_(Incident.status == "완료", or_(in_week(Incident.occurred_at), in_week(Incident.recovered_at))))
    ).order_by(Incident.occurred_at).all()

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
        "expiring_warranties": expiring,
        "eos_devices": eos_devices,
        "projects": _projects(db, eng_id),
        "week": {
            "today": today, "this_start": this_start, "this_end": this_end, "end": week_end,
            "schedules": [_sch(s, sites) for s in week_scheds],
            "workplans": [{"id": p.id, "title": p.title, "work_date": p.work_date, "site": p.site,
                           "status": p.status, "impact": p.impact or "", "purpose": p.purpose or ""} for p in week_plans],
            "incidents": [{"id": i.id, "title": i.title, "occurred_at": i.occurred_at,
                           "recovered_at": i.recovered_at or "", "site": i.site,
                           "severity": i.severity, "status": i.status, "entry_id": i.entry_id or ""} for i in open_incidents],
        },
    }

def _projects(db, eng_id):
    """대시보드 '프로젝트 현황': 완료 전 프로젝트 전부(종료일 빠른 순) + 최근 완료 3건. 진행률은 세부 작업 완료 수 기준."""
    rows = db.query(Project).filter(Project.engineer_id == eng_id).all()
    def d(p):
        tasks = list(p.tasks)
        return {"id": p.id, "name": p.name, "customer": p.customer or "", "status": p.status or "진행 대기",
                "start_date": p.start_date or "", "end_date": p.end_date or "",
                "task_total": len(tasks), "task_done": sum(1 for t in tasks if t.status == "완료")}
    active = sorted((p for p in rows if p.status != "완료"), key=lambda p: (p.end_date or "9999", p.name))
    done = sorted((p for p in rows if p.status == "완료"), key=lambda p: p.end_date or "", reverse=True)[:3]
    return {"active": [d(p) for p in active], "recent_done": [d(p) for p in done]}

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
