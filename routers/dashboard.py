from fastapi import APIRouter, Depends
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Schedule, Issue, WorkPlan, Incident, Project, User, WeeklySubmission
from datetime import datetime, timedelta, date
from routers.technotes import support_only
from routers.sites import check_missing, contract_days, CONTRACT_WARN
from routers.projects import _docs
from routers import gcal, licenses, team
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

    open_inc = [i for i in open_incidents if i.status != "완료"]
    sched_done  = sum(1 for s in schedules_this_month if s.status == "완료")
    sched_total = len(schedules_this_month)

    return {
        "site_count":        len(sites),
        "device_count":      len(all_devices),
        "monthly_support_count":  monthly_support,
        "monthly_incident_count": monthly_incidents,
        "open_incidents": {"total": len(open_inc), "hot": sum(1 for i in open_inc if i.severity in ("긴급", "높음")),
                           "received": sum(1 for i in open_inc if i.status == "접수")},
        "todo": _todo(db, eng_id, sites, today),
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

def _todo(db, eng_id, sites, today):
    """대시보드 맨 위 '확인할 것': 건수가 있는 것만 [{key, label, count, detail, go, arg}]. go = 누르면 갈 화면."""
    out = []
    def add(key, label, count, detail="", go="", arg=""):
        if count:
            out.append({"key": key, "label": label, "count": count, "detail": detail, "go": go, "arg": arg})
    # 1) 날짜가 지났는데 완료하지 않은 점검·기술지원 (장애는 위 요약 칸 '미처리 장애')
    late_s = db.query(Schedule).filter(Schedule.engineer_id == eng_id, Schedule.status != "완료",
                                       Schedule.sched_date != "", Schedule.sched_date < today).all()
    late_w = support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.status != "완료",
                                                    WorkPlan.work_date != "", WorkPlan.work_date < today)).all()
    oldest = lambda rows, col: min(getattr(r, col)[:10] for r in rows)
    add("late_sched", "지연된 점검", len(late_s), f"가장 오래된 일정 {oldest(late_s, 'sched_date')}" if late_s else "", "schedule-mgmt")
    add("late_plan", "지연된 기술지원", len(late_w), f"가장 오래된 일정 {oldest(late_w, 'work_date')}" if late_w else "", "work-plan")
    # 2) 구글 캘린더에서 가져와 내용을 확인하지 않은 기술지원·장애처리 (주간보고서 제목이 됨)
    rv = db.query(gcal.CalendarEvent).filter(gcal.CalendarEvent.engineer_id == eng_id, gcal.CalendarEvent.state == gcal.ST_DONE,
                                             gcal.CalendarEvent.need_review == True).order_by(gcal.CalendarEvent.event_date).all()   # noqa: E712
    if rv:
        n_inc = sum(1 for r in rv if r.target_type == "incident")
        kinds = " · ".join(x for x in [f"기술지원 {len(rv) - n_inc}" if len(rv) - n_inc else "", f"장애처리 {n_inc}" if n_inc else ""] if x)
        first = rv[0]                          # 누르면 가장 이른 건의 입력 창을 바로 연다
        add("review", "캘린더에서 가져온 건 제목 확인", len(rv),
            f"{kinds} — 눌러서 제목 확인 후 저장 ({first.event_date[5:7].lstrip('0')}/{first.event_date[8:10].lstrip('0')} 건부터)",
            "entry", first.target_id)
        out[-1]["tab"] = "report" if first.target_type == "incident" else ""
    # 3) 주간보고서 제출 — 팀 주간보고서를 쓰기 시작한 뒤(누군가 처음 제출한 주부터), 팀장이 있을 때만
    first = db.query(WeeklySubmission.week_start).order_by(WeeklySubmission.week_start).first()
    if first and db.query(User).filter(User.is_lead == True).count():                   # noqa: E712
        t = date.fromisoformat(today)
        mon = t - timedelta(days=t.weekday())
        weeks = [(mon - timedelta(days=7), "지난주")] + ([(mon, "이번 주")] if t.weekday() >= 4 else [])   # 이번 주는 금요일부터
        weeks = [(w.isoformat(), name) for w, name in weeks if w.isoformat() >= first[0]]
        mine = {w for (w,) in db.query(WeeklySubmission.week_start).filter(WeeklySubmission.engineer_id == eng_id)}
        for w, name in weeks:
            if w not in mine:
                add(f"weekly_{w}", f"{name} 주간보고서 미제출", 1, f"{w[5:].replace('-', '/')} 주", "weekly-report", w)
        me = db.query(User).filter(User.engineer_id == eng_id).first()
        if me and me.is_lead:
            members = {m["id"] for m in team._members(db)}
            for w, name in weeks:
                got = {e for (e,) in db.query(WeeklySubmission.engineer_id).filter(WeeklySubmission.week_start == w)} & members
                add(f"team_{w}", f"{name} 팀 주간보고서 미제출", len(members - got),
                    f"{len(got)}/{len(members)}명 제출", "team-report", w)
    # 4) 사이트: 이번 달·분기 점검 일정 없음 / 계약 종료 임박
    miss = [(s.name, check_missing(s, today)) for s in sites]
    miss = [x for x in miss if x[1]]
    add("check_missing", "점검 일정 누락", len(miss), ", ".join(f"{n}({p})" for n, p in miss[:3]) + (" 외" if len(miss) > 3 else ""), "sites", "check_missing")
    due = sorted((contract_days(s), s.name) for s in sites if not s.archived and contract_days(s) is not None and contract_days(s) <= CONTRACT_WARN)
    add("contract_due", "계약 종료·임박", len(due), ", ".join(f"{n} {'D-' + str(d) if d >= 0 else '종료'}" for d, n in due[:3]) + (" 외" if len(due) > 3 else ""), "sites", "contract_due")
    # 5) 프로젝트: 산출물 미제출(완료·지연·작업 100%인데 다 안 냄) / 이번 달 마감
    docs_due, month_due = [], []
    for p in db.query(Project).filter(Project.engineer_id == eng_id).all():
        d = _docs(p)
        tasks = list(p.tasks)
        full = bool(tasks) and all(t.status == "완료" for t in tasks)
        late = bool(p.end_date) and p.status not in ("완료", "보류") and p.end_date < today
        if len(d["done"]) < len(d["required"]) and (p.status == "완료" or late or full):
            docs_due.append(p.name)
        if p.status not in ("완료", "보류") and (p.end_date or "").startswith(today[:7]):
            month_due.append(p.name)
    add("docs_due", "프로젝트 산출물 미제출", len(docs_due), ", ".join(docs_due[:2]) + (" 외" if len(docs_due) > 2 else ""), "projects", "산출물 미제출")
    add("month_due", "이번 달 마감 프로젝트", len(month_due), ", ".join(month_due[:2]) + (" 외" if len(month_due) > 2 else ""), "projects", "이번 달 마감")
    # 6) 라이선스 정책 근거 문서 변경 감지 (누구나 확인 가능)
    lic = licenses.pending_changes(db)
    add("license", "라이선스 근거 문서 변경", len(lic), ", ".join(sorted({n for n, _ in lic})[:2]), "license")
    return out


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
