from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Access, Report, Note, Schedule, Issue, SiteChecklist, WorkPlan, Incident
import secure_store
from routers.auth import get_current_user
from routers.site_checklist import _is_done as _cl_is_done, _cl_dict
from routers.technotes import support_only
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date
from urllib.parse import quote
import uuid, os, shutil, io, re
import eos_match

CYCLES       = ("", "월간", "분기")                     # 점검 주기 (계약)
REPORT_CATS  = ("점검표", "구성도", "기타")              # 사이트 파일 구분
DEV_TYPES    = ("서버", "스토리지", "SAN Switch", "네트워크", "기타")   # app.js DEV_TYPES 와 같게
DEV_STATUS   = ("운영중", "점검중", "교체예정", "철수")
CONTRACT_WARN = 60                                       # 계약 종료 며칠 전부터 '확인할 것'

router = APIRouter(prefix="/api/engineers/{eng_id}/sites", tags=["sites"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")

# ── Sites ──────────────────────────────────────────────
@router.get("")
def list_sites(eng_id: str, db: Session = Depends(get_db)):
    sites = db.query(Site).filter(Site.engineer_id == eng_id).order_by(Site.name).all()
    today = datetime.now().strftime("%Y-%m-%d")
    ym    = today[:7]
    idx = eos_match.load_index(db)
    return [{**_site_dict(s, idx), **_site_status(s, today, ym)} for s in sites]

def contract_active(s, today: str) -> bool:
    """보관하지 않았고 계약 기간 안(비어 있으면 그쪽은 제한 없음)."""
    return not s.archived and (not s.contract_start or s.contract_start <= today) \
        and (not s.contract_end or s.contract_end >= today)

def check_missing(s, today: str) -> str:
    """점검 주기(월간/분기)를 정한 계약 중인 사이트에 이번 달·이번 분기 점검 일정이 하나도 없으면 그 기간 이름("11월"/"4분기"), 아니면 ""."""
    if s.check_cycle not in ("월간", "분기") or not contract_active(s, today):
        return ""
    y, m = int(today[:4]), int(today[5:7])
    if s.check_cycle == "월간":
        months, label = [today[:7]], f"{m}월"
    else:
        q = (m - 1) // 3
        months, label = [f"{y}-{q * 3 + i:02d}" for i in (1, 2, 3)], f"{q + 1}분기"
    return "" if any((x.sched_date or "")[:7] in months for x in s.schedules) else label

def contract_days(s):
    """계약 종료일까지 남은 날 (없으면 None)."""
    try:
        return (date.fromisoformat(s.contract_end) - date.today()).days
    except (TypeError, ValueError):
        return None

def _site_status(s, today, ym):
    """사이트 상태 요약 (미해결 이슈, 지연 점검, 이번 달 점검, 남은 체크리스트, 점검 누락, 계약 만료)"""
    pending = [x for x in s.schedules if x.status != "완료"]
    month = [x for x in s.schedules if (x.sched_date or "").startswith(ym)]
    miss = check_missing(s, today)
    cd = contract_days(s)
    return {
        "check_missing": 1 if miss else 0, "check_missing_label": miss,
        "contract_due": 1 if (cd is not None and cd <= CONTRACT_WARN and not s.archived) else 0,
        "open_issues": sum(1 for i in s.issues if i.status != "완료"),
        "late_sched": sum(1 for x in pending if x.sched_date < today),
        "month_sched": {"done": sum(1 for x in month if x.status == "완료"), "total": len(month)},
        "checklist_todo": sum(1 for c in s.checklists if not _cl_is_done(c)),
    }

def _site_dict(s, idx=None):
    expiring = sum(1 for d in s.devices
                   if _warranty_days(d.warranty) is not None and _warranty_days(d.warranty) <= 90)
    # OS 지원 종료·임박 장비 수 (idx = eos_match.load_index, 없으면 계산하지 않음)
    eos_cnt = sum(1 for d in s.devices if eos_match.device_alert(d, idx))
    return {
        "id": s.id, "name": s.name, "location": s.location,
        "manager": s.manager, "contact": s.contact, "memo": s.memo or "",
        "device_count": len(s.devices), "expiring_count": expiring, "eos_count": eos_cnt,
        "os_missing": sum(1 for d in s.devices if d.status != "철수" and not (d.os or "").strip()),
        "contract_start": s.contract_start or "", "contract_end": s.contract_end or "",
        "check_cycle": s.check_cycle or "", "archived": bool(s.archived), "contract_days": contract_days(s),
    }

def _clean_site(vals: dict) -> dict:
    """계약 칸 검사 (날짜 형식, 주기 값, 시작 ≤ 종료)."""
    for k in ("contract_start", "contract_end"):
        if k in vals:
            vals[k] = (vals[k] or "").strip()
            if vals[k] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", vals[k]):
                raise HTTPException(400, detail="계약 날짜는 YYYY-MM-DD 형식으로 입력해주세요")
    if "check_cycle" in vals and vals["check_cycle"] not in CYCLES:
        raise HTTPException(400, detail="점검 주기는 없음·월간·분기 중 하나입니다")
    return vals

def _get_valid_site(eng_id: str, site_id: str, db: Session):
    site = db.query(Site).filter(Site.id == site_id, Site.engineer_id == eng_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="등록된 사이트가 없습니다")
    return site

class SiteIn(BaseModel):
    name:     str
    location: Optional[str] = ""
    manager:  Optional[str] = ""
    contact:  Optional[str] = ""
    memo:     Optional[str] = ""
    contract_start: Optional[str] = ""
    contract_end:   Optional[str] = ""
    check_cycle:    Optional[str] = ""

@router.post("")
def create_site(eng_id: str, data: SiteIn, db: Session = Depends(get_db)):
    data.name = data.name.strip()
    if not data.name:
        raise HTTPException(400, detail="사이트명을 입력해주세요")
    if db.query(Site).filter(Site.engineer_id == eng_id, Site.name == data.name).first():
        raise HTTPException(400, detail="같은 이름의 사이트가 이미 있습니다")
    site = Site(id=str(uuid.uuid4()), engineer_id=eng_id, archived=False, **_clean_site(data.dict()))
    db.add(site); db.commit(); db.refresh(site)
    return _site_dict(site)

class SiteUpdate(BaseModel):
    name:     Optional[str] = None
    location: Optional[str] = None
    manager:  Optional[str] = None
    contact:  Optional[str] = None
    memo:     Optional[str] = None
    contract_start: Optional[str] = None
    contract_end:   Optional[str] = None
    check_cycle:    Optional[str] = None
    archived:       Optional[bool] = None

@router.patch("/{site_id}")
def update_site(eng_id: str, site_id: str, data: SiteUpdate, db: Session = Depends(get_db)):
    site = _get_valid_site(eng_id, site_id, db)
    upd = _clean_site(data.dict(exclude_none=True))
    if "name" in upd:
        upd["name"] = upd["name"].strip()
        if not upd["name"]:
            raise HTTPException(400, detail="사이트명을 입력해주세요")
        dup = db.query(Site).filter(Site.engineer_id == eng_id, Site.name == upd["name"], Site.id != site_id).first()
        if dup:
            raise HTTPException(400, detail="같은 이름의 사이트가 이미 있습니다")
        old = site.name
        if old != upd["name"]:
            # 기술지원/장애처리는 사이트명을 문자열로 저장 → 이름 변경 시 함께 갱신 (월별 통계 연결 유지)
            db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.site == old).update({"site": upd["name"]})
            db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.site == old).update({"site": upd["name"]})
    for k, v in upd.items():
        setattr(site, k, v)
    db.commit()
    return _site_dict(site)

@router.get("/{site_id}/summary")
def site_delete_summary(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    """삭제 확인용: 함께 삭제되는 데이터 건수"""
    s = _get_valid_site(eng_id, site_id, db)
    return {"name": s.name, "devices": len(s.devices), "accesses": len(s.accesses), "reports": len(s.reports),
            "notes": len(s.notes), "schedules": len(s.schedules), "issues": len(s.issues),
            "checklists": len(s.checklists)}

@router.delete("/{site_id}")
def delete_site(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.id == site_id, Site.engineer_id == eng_id).first()
    if not site: raise HTTPException(404)
    sched_ids = [x.id for x in site.schedules]
    if sched_ids:   # 점검일정 연동 레코드(작업자/MOP 보관) 정리
        db.query(WorkPlan).filter(WorkPlan.id.in_(sched_ids), WorkPlan.engineer_id == eng_id).delete(synchronize_session=False)
    db.delete(site); db.commit()
    # 업로드된 점검표 파일 정리
    site_dir = os.path.realpath(os.path.join(UPLOAD_DIR, eng_id, site_id))
    if site_dir.startswith(os.path.realpath(UPLOAD_DIR) + os.sep) and os.path.isdir(site_dir):
        shutil.rmtree(site_dir, ignore_errors=True)
    return {"ok": True}

# ── 사이트 개요 (상세 모달 '개요' 탭) ───────────────────
@router.get("/{site_id}/overview")
def site_overview(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    s = _get_valid_site(eng_id, site_id, db)
    today = datetime.now().strftime("%Y-%m-%d")
    sch = lambda x: {"id": x.id, "title": x.title, "sched_date": x.sched_date, "sched_type": x.sched_type,
                     "status": x.status, "memo": x.memo or "", "site_id": x.site_id, "site_name": s.name}
    pending = sorted((x for x in s.schedules if x.status != "완료"), key=lambda x: x.sched_date)
    done    = sorted((x for x in s.schedules if x.status == "완료"), key=lambda x: x.sched_date, reverse=True)
    issues  = sorted((i for i in s.issues if i.status != "완료"), key=lambda i: i.created_at or "")
    plans = support_only(db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.site == s.name)) \
        .order_by(WorkPlan.work_date.desc()).limit(5).all()
    incs = db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.site == s.name) \
        .order_by(Incident.occurred_at.desc()).limit(5).all()
    idx = eos_match.load_index(db)
    eos = sorted(({"id": d.id, "name": d.name, "os": d.os, **m} for d in s.devices
                  for m in [eos_match.device_alert(d, idx)] if m),
                 key=lambda x: (x["eol"] if x["eol"][:1].isdigit() else "0"))
    warranty = sorted(({"id": d.id, "name": d.name, "warranty": d.warranty, "warranty_days": _warranty_days(d.warranty)}
                       for d in s.devices if _warranty_days(d.warranty) is not None and _warranty_days(d.warranty) <= 90),
                      key=lambda x: x["warranty_days"])
    return {
        "site": _site_dict(s, idx),
        "today": today,
        "counts": {"devices": len(s.devices), "no_warranty": sum(1 for d in s.devices if not d.warranty),
                   "accesses": len(s.accesses), "reports": len(s.reports), "notes": len(s.notes)},
        "schedules_pending": [sch(x) for x in pending[:6]],
        "schedules_done": [sch(x) for x in done[:3]],
        "issues": [{"id": i.id, "title": i.title, "body": i.body or "", "severity": i.severity, "status": i.status,
                    "created_at": i.created_at, "site_id": i.site_id, "site_name": s.name} for i in issues],
        "checklists": [{**_cl_dict(c), "site_name": s.name} for c in s.checklists],
        "workplans": [{"id": p.id, "title": p.title, "work_date": p.work_date, "status": p.status,
                       "support_type": p.support_type or ""} for p in plans],
        "incidents": [{"id": i.id, "title": i.title, "occurred_at": i.occurred_at, "severity": i.severity,
                       "status": i.status, "entry_id": i.entry_id or ""} for i in incs],
        "warranty": warranty,
        "eos": eos,
    }

# ── Devices ────────────────────────────────────────────
@router.get("/{site_id}/devices")
def list_devices(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    idx = eos_match.load_index(db)
    from database import DeviceConfig
    from sqlalchemy import func
    devs = db.query(Device).filter(Device.site_id == site_id).all()
    cfg = {r[0]: (r[1], r[2]) for r in db.query(DeviceConfig.device_id, func.count(DeviceConfig.id), func.max(DeviceConfig.taken_date))
           .filter(DeviceConfig.device_id.in_([d.id for d in devs])).group_by(DeviceConfig.device_id).all()} if devs else {}
    return [{**_dev_dict(d, idx), "config_count": cfg.get(d.id, (0, ""))[0], "config_date": cfg.get(d.id, (0, ""))[1] or ""}
            for d in devs]

class DeviceIn(BaseModel):
    name:      str
    model:     Optional[str] = ""
    serial_no: Optional[str] = ""
    dev_type:  Optional[str] = "서버"
    os:        Optional[str] = ""
    firmware:  Optional[str] = ""
    purchase:  Optional[str] = ""
    warranty:  Optional[str] = ""
    status:    Optional[str] = "운영중"
    memo:      Optional[str] = ""

@router.post("/{site_id}/devices")
def create_device(eng_id: str, site_id: str, data: DeviceIn, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    dev = Device(id=str(uuid.uuid4()), site_id=site_id, **data.dict())
    db.add(dev); db.commit()
    # 사이트 device_count 반환 (메인 목록 연동용)
    site = db.query(Site).filter(Site.id == site_id).first()
    return {**_dev_dict(dev), "site_device_count": len(site.devices) if site else 0}

class DeviceUpdate(BaseModel):
    name:      Optional[str] = None
    model:     Optional[str] = None
    serial_no: Optional[str] = None
    dev_type:  Optional[str] = None
    os:        Optional[str] = None
    firmware:  Optional[str] = None
    purchase:  Optional[str] = None
    warranty:  Optional[str] = None
    status:    Optional[str] = None
    memo:      Optional[str] = None

@router.patch("/{site_id}/devices/{dev_id}")
def update_device(eng_id: str, site_id: str, dev_id: str, data: DeviceUpdate, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    dev = db.query(Device).filter(Device.id == dev_id, Device.site_id == site_id).first()
    if not dev: raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(dev, k, v)
    db.commit()
    return _dev_dict(dev)

@router.delete("/{site_id}/devices/{dev_id}")
def delete_device(eng_id: str, site_id: str, dev_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    dev = db.query(Device).filter(Device.id == dev_id, Device.site_id == site_id).first()
    if not dev: raise HTTPException(404)
    db.delete(dev); db.commit()
    site = db.query(Site).filter(Site.id == site_id).first()
    return {"ok": True, "site_device_count": len(site.devices) if site else 0}

def _dev_dict(d, idx=None):
    return {
        "id": d.id, "name": d.name, "model": d.model, "serial_no": d.serial_no,
        "dev_type": d.dev_type, "os": d.os, "firmware": d.firmware or "", "purchase": d.purchase,
        "warranty": d.warranty, "status": d.status, "memo": d.memo,
        "warranty_days": _warranty_days(d.warranty),
        "eos": eos_match.match_os(d.os, idx) if idx else None,
    }

@router.get("/{site_id}/devices/{dev_id}/history")
def device_history(eng_id: str, site_id: str, dev_id: str, db: Session = Depends(get_db)):
    """장비 한 대의 이력: 공통 입력 창에서 '대상 장비'로 고른 점검·기술지원·장애처리 +
    (예전 기록) 같은 사이트 장애 중 장애 장비 칸에 장비 이름·S/N 이 있거나 파트의 S/N 이 이 장비 S/N 인 것."""
    from routers.incidents import load_parts
    s = _get_valid_site(eng_id, site_id, db)
    dev = db.query(Device).filter(Device.id == dev_id, Device.site_id == site_id).first()
    if not dev: raise HTTPException(404, detail="장비를 찾을 수 없습니다")
    has = lambda v: dev_id in (v or "").split(",")
    name, sn = (dev.name or "").strip().lower(), (dev.serial_no or "").strip().lower()
    out, linked = [], set()
    for x in db.query(Schedule).filter(Schedule.engineer_id == eng_id, Schedule.site_id == site_id).all():
        if has(x.device_ids):
            linked.add(x.id)
            out.append({"date": x.sched_date or "", "kinds": ["점검"] + [t for t in (x.extra_types or "").split(",") if t],
                        "title": x.title, "status": x.status, "open_id": x.id, "detail": x.memo or "", "parts": []})
    for p in db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.site == s.name,
                                       WorkPlan.id.startswith("wp-")).all():
        if has(p.device_ids):
            linked.add(p.id)
            out.append({"date": p.work_date or "", "kinds": [t for t in (p.support_type or "기술지원").split(",") if t],
                        "title": p.title, "status": p.status, "open_id": p.id, "detail": p.purpose or "", "parts": []})
    for i in db.query(Incident).filter(Incident.engineer_id == eng_id, Incident.site == s.name).all():
        parts = load_parts(i.parts)
        txt = (i.device or "").lower()
        legacy = (name and name in txt) or (sn and (sn in txt or any(sn in (str(q.get("old_sn", "")) + " " + str(q.get("new_sn", ""))).lower() for q in parts)))
        if not (has(i.device_ids) or legacy):
            continue
        row = {"date": i.occurred_at or "", "kinds": ["장애처리"], "title": i.title, "status": i.status,
               "severity": i.severity, "open_id": i.id, "detail": i.action or i.symptom or "",
               "parts": [{k: q.get(k, "") for k in ("name", "part_no", "qty", "old_sn", "new_sn")} for q in parts],
               "legacy": not has(i.device_ids)}
        host = next((r for r in out if r["open_id"] == i.entry_id), None) if i.entry_id else None
        if host:                                   # 일정과 함께 등록한 장애는 그 일정 줄에 합친다
            host["kinds"].append("장애처리"); host["parts"] = row["parts"]; host["severity"] = i.severity
            host["detail"] = host["detail"] or row["detail"]
        else:
            out.append(row)
    from database import Project, ProjectDevice     # 프로젝트로 납품·구축(사이트 장비로 등록·연결)한 기록
    for pd, pj in db.query(ProjectDevice, Project).join(Project, Project.id == ProjectDevice.project_id).filter(
            ProjectDevice.device_id == dev.id, Project.engineer_id == eng_id).all():
        out.append({"date": pj.delivery_date or pj.start_date or "", "kinds": ["프로젝트"], "title": pj.name,
                    "status": pj.status, "open_id": "", "open_project": pj.id,
                    "detail": f"{pj.kind or '구축'} 프로젝트" + (f" · 검수 {pj.accept_date}" if pj.accept_date else ""),
                    "parts": [], "legacy": False})
    out.sort(key=lambda r: r["date"], reverse=True)
    return {"device": _dev_dict(dev, eos_match.load_index(db)), "items": out,
            "parts_total": sum(len(r["parts"]) for r in out)}

# ── 장비 엑셀 내려받기·일괄 등록 ──────────────────────────
# 내려받은 파일이 곧 올리는 양식이다. 1행 = 칸 이름(순서는 바뀌어도 이름으로 찾음), 2행부터 장비 1대씩.
# 관리번호(장비 id)가 있으면 그 장비를 고치고, 없으면 S/N → 장비명 순으로 같은 장비를 찾아 고치거나 새로 만든다.
# 빈 칸은 '기존 값 유지' (지우지 않는다).
DEV_COLS = [("id", "관리번호", 12), ("name", "장비명", 26), ("dev_type", "유형", 12), ("model", "모델", 24),
            ("serial_no", "S/N", 18), ("os", "OS", 24), ("firmware", "펌웨어", 18), ("purchase", "도입일", 13),
            ("warranty", "워런티 만료일", 14), ("status", "상태", 10), ("memo", "메모", 30)]
DATE_FIELDS = ("purchase", "warranty")

def _xl_head(ws, labels_widths, row=1):
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    line = Side(style="thin", color="CBD5E1")
    for i, (label, width) in enumerate(labels_widths, start=1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = Font(bold=True, color="334155"); c.fill = PatternFill("solid", fgColor="E2E8F0")
        c.alignment = Alignment(horizontal="center", vertical="center"); c.border = Border(bottom=line, right=line)
        ws.column_dimensions[c.column_letter].width = width
    ws.freeze_panes = ws.cell(row=row + 1, column=1)

def _xl_response(wb, filename):
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})

def _cell_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()

def _norm_date(v: str):
    """'2026-11-20' / '2026.11.20' / '2026/11/20' / '20261120' → 'YYYY-MM-DD', 못 읽으면 None."""
    m = re.fullmatch(r"(\d{4})[-./ ]?(\d{1,2})[-./ ]?(\d{1,2})\.?", v)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None

@router.get("/{site_id}/devices/export")
def export_devices(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    """사이트 장비 목록 엑셀 (일괄 등록 양식 겸용)."""
    import openpyxl
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.styles import Font
    site = _get_valid_site(eng_id, site_id, db)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "장비"
    _xl_head(ws, [(lbl + (" *" if k == "name" else ""), w) for k, lbl, w in DEV_COLS])
    devs = sorted(site.devices, key=lambda d: (DEV_TYPES.index(d.dev_type) if d.dev_type in DEV_TYPES else 9, d.name or ""))
    for r, d in enumerate(devs, start=2):
        for i, (k, _, _) in enumerate(DEV_COLS, start=1):
            c = ws.cell(row=r, column=i, value=getattr(d, k) or None)
            c.number_format = "@"
    gray = Font(color="94A3B8")
    for r in range(2, max(len(devs) + 2, 3) + 300):
        ws.cell(row=r, column=1).font = gray
        for i in (8, 9):
            ws.cell(row=r, column=i).number_format = "@"
    last = len(devs) + 301
    for col, vals in (("C", DEV_TYPES), ("J", DEV_STATUS)):
        dv = DataValidation(type="list", formula1='"' + ",".join(vals) + '"', allow_blank=True)
        dv.add(f"{col}2:{col}{last}"); ws.add_data_validation(dv)
    info = wb.create_sheet("안내")
    for i, line in enumerate([
        f"{site.name} 장비 목록 — 고쳐서 [사이트 관리 > 장비 리스트 > 엑셀 올리기]로 올리면 한 번에 반영됩니다.",
        "· 새 장비: 맨 아래 빈 줄에 적습니다. 관리번호 칸은 비워 둡니다.",
        "· 고칠 장비: 그 줄의 칸을 고칩니다. 관리번호는 지우거나 바꾸지 마세요 (줄을 복사해 새 장비를 만들 때는 관리번호를 지웁니다).",
        "· 빈 칸은 기존 값을 그대로 둡니다 (칸을 비워도 지워지지 않음). 지우려면 포털 화면에서 고칩니다.",
        "· 관리번호가 없으면 S/N, 그다음 장비명이 같은 장비를 고치고, 없으면 새로 등록합니다.",
        f"· 유형: {' / '.join(DEV_TYPES)}    상태: {' / '.join(DEV_STATUS)}",
        "· 날짜(도입일·워런티 만료일): 2026-11-20 형식 (2026.11.20, 2026/11/20 도 됨).",
        "· 장비를 지우는 것은 엑셀로 할 수 없습니다 (줄을 지워도 포털 장비는 남음).",
    ], start=1):
        info.cell(row=i, column=1, value=line)
    info.column_dimensions["A"].width = 110
    return _xl_response(wb, f"{site.name}_장비_{date.today().isoformat()}.xlsx")

def _import_devices(site, ws, db, apply: bool):
    head = {}
    for i, c in enumerate(next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ()), start=0):
        label = _cell_str(c).replace("*", "").strip()
        key = next((k for k, lbl, _ in DEV_COLS if lbl == label), None)
        if key:
            head[key] = i
    if "name" not in head:
        raise HTTPException(400, detail="1행에 '장비명' 칸이 없습니다. 포털에서 내려받은 엑셀 양식을 써주세요")
    devs = list(site.devices)
    by_id = {d.id: d for d in devs}
    by_sn, by_name = {}, {}
    for d in devs:
        if (d.serial_no or "").strip():
            by_sn.setdefault(d.serial_no.strip().lower(), []).append(d)
        by_name.setdefault((d.name or "").strip().lower(), []).append(d)
    labels = {k: lbl for k, lbl, _ in DEV_COLS}
    rows, errors, used = [], [], set()
    added = updated = same = 0
    for rn, raw in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        v = {k: _cell_str(raw[i]) if i < len(raw) else "" for k, i in head.items()}
        if not any(v.values()):
            continue
        err = []
        if not v.get("name"):
            err.append("장비명이 비어 있습니다")
        for k in DATE_FIELDS:
            if v.get(k):
                nd = _norm_date(v[k])
                if nd is None:
                    err.append(f"{labels[k]} '{v[k]}' 날짜 형식이 아닙니다")
                else:
                    v[k] = nd
        if v.get("dev_type") and v["dev_type"] not in DEV_TYPES:
            err.append(f"유형 '{v['dev_type']}' 은(는) {'/'.join(DEV_TYPES)} 중 하나여야 합니다")
        if v.get("status") and v["status"] not in DEV_STATUS:
            err.append(f"상태 '{v['status']}' 은(는) {'/'.join(DEV_STATUS)} 중 하나여야 합니다")
        dev = None
        if v.get("id"):
            dev = by_id.get(v["id"])
            if dev is None:
                err.append("관리번호가 이 사이트의 장비가 아닙니다 (다른 사이트 파일이거나 지운 장비)")
        elif v.get("serial_no") and len(by_sn.get(v["serial_no"].lower(), [])) == 1:
            dev = by_sn[v["serial_no"].lower()][0]
        elif v.get("name") and len(by_name.get(v["name"].lower(), [])) == 1 and not (
                v.get("serial_no") and (by_name[v["name"].lower()][0].serial_no or "").strip()):
            dev = by_name[v["name"].lower()][0]          # 이름이 같아도 S/N 이 서로 다르면 다른 장비로 본다
        if dev is not None and dev.id in used:
            err.append("같은 장비가 파일에 두 번 있습니다 (관리번호·S/N·장비명 중복)")
        if err:
            errors.append({"row": rn, "name": v.get("name", ""), "msg": " · ".join(err)})
            continue
        fields = [k for k in labels if k != "id"]
        if dev is None:
            vals = {k: v.get(k, "") for k in fields}
            vals["dev_type"] = vals["dev_type"] or "서버"; vals["status"] = vals["status"] or "운영중"
            rows.append({"row": rn, "action": "추가", "name": vals["name"], "changes": []})
            added += 1
            if apply:
                db.add(Device(id=str(uuid.uuid4()), site_id=site.id, **vals))
            continue
        used.add(dev.id)
        ch = [(k, (getattr(dev, k) or "").strip(), v[k]) for k in fields
              if v.get(k) and v[k] != (getattr(dev, k) or "").strip()]      # 앞뒤 빈칸만 다른 것은 같은 값
        if not ch:
            same += 1
            continue
        updated += 1
        rows.append({"row": rn, "action": "수정", "name": dev.name,
                     "changes": [{"field": labels[k], "old": o, "new": n} for k, o, n in ch]})
        if apply:
            for k, _, n in ch:
                setattr(dev, k, n)
    if apply:
        db.commit()
    return {"added": added, "updated": updated, "unchanged": same, "errors": errors, "rows": rows, "applied": apply}

@router.post("/{site_id}/devices/import")
def import_devices(eng_id: str, site_id: str, file: UploadFile = File(...), apply: bool = Form(False),
                   db: Session = Depends(get_db)):
    """장비 엑셀 올리기. apply=false 면 바뀔 내용만 돌려주고(미리 보기), true 면 반영. 오류 줄은 건너뛴다."""
    import openpyxl
    site = _get_valid_site(eng_id, site_id, db)
    data = file.file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, detail="파일이 너무 큽니다 (5MB 까지)")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(400, detail="엑셀(.xlsx) 파일을 읽을 수 없습니다")
    ws = wb["장비"] if "장비" in wb.sheetnames else wb.worksheets[0]
    return _import_devices(site, ws, db, apply)

# ── 사이트 목록 엑셀 (사이트 + 장비·워런티·EOS) ─────────────
@router.get("/export/all")
def export_sites(eng_id: str, archived: bool = False, db: Session = Depends(get_db)):
    import openpyxl
    from openpyxl.styles import Font
    q = db.query(Site).filter(Site.engineer_id == eng_id).order_by(Site.name).all()
    sites = [s for s in q if archived or not s.archived]
    today = datetime.now().strftime("%Y-%m-%d")
    idx = eos_match.load_index(db)
    wb = openpyxl.Workbook()
    ws = wb.active; ws.title = "사이트"
    _xl_head(ws, [("사이트", 28), ("위치", 22), ("담당자", 12), ("연락처", 16), ("계약 시작", 12), ("계약 종료", 12),
                  ("점검 주기", 10), ("장비", 7), ("워런티 90일 이내", 15), ("OS 지원 종료·임박", 16), ("OS 미입력", 10),
                  ("이번 달 점검", 12), ("상태", 9), ("메모", 40)])
    for r, s in enumerate(sites, start=2):
        d = _site_dict(s, idx); st = _site_status(s, today, today[:7])
        ms = st["month_sched"]
        vals = [s.name, s.location, s.manager, s.contact, d["contract_start"], d["contract_end"], d["check_cycle"] or "-",
                d["device_count"], d["expiring_count"] or None, d["eos_count"] or None, d["os_missing"] or None,
                f"{ms['done']}/{ms['total']}" if ms["total"] else ("없음" if st["check_missing"] else "-"),
                "보관" if s.archived else "", s.memo or ""]
        for i, v in enumerate(vals, start=1):
            ws.cell(row=r, column=i, value=v)
    ws2 = wb.create_sheet("장비")
    _xl_head(ws2, [("사이트", 24), ("장비명", 26), ("유형", 11), ("모델", 24), ("S/N", 18), ("OS", 24),
                   ("OS 지원 종료", 13), ("OS 상태", 12), ("펌웨어", 16), ("도입일", 12), ("워런티 만료일", 13),
                   ("워런티 남은 날", 13), ("상태", 9), ("메모", 30)])
    EOS_STATE = {"end": "지원 종료", "ext": "연장 지원 중", "soon": "1년 안에 종료", "maint": "유지 지원", "ok": "지원 중"}
    red = Font(color="DC2626", bold=True)
    r = 2
    for s in sites:
        for d in sorted(s.devices, key=lambda x: (DEV_TYPES.index(x.dev_type) if x.dev_type in DEV_TYPES else 9, x.name or "")):
            m = eos_match.match_os(d.os, idx)
            wd = _warranty_days(d.warranty)
            vals = [s.name, d.name, d.dev_type, d.model, d.serial_no, d.os, (m or {}).get("eol") or None,
                    EOS_STATE.get((m or {}).get("state"), "") if m else ("OS 미입력" if not (d.os or "").strip() else "버전 모름"),
                    d.firmware, d.purchase, d.warranty, wd, d.status, d.memo]
            for i, v in enumerate(vals, start=1):
                ws2.cell(row=r, column=i, value=v if v != "" else None)
            if m and m.get("state") in ("end", "ext"):
                ws2.cell(row=r, column=8).font = red
            if wd is not None and wd <= 90:
                ws2.cell(row=r, column=12).font = red
            r += 1
    ws.auto_filter.ref = ws.dimensions; ws2.auto_filter.ref = ws2.dimensions
    return _xl_response(wb, f"사이트_장비_현황_{today}.xlsx")

# ── Access ─────────────────────────────────────────────
# 접속 정보는 로그인 세션(쿠키)의 엔지니어 본인만 접근 가능. 목록에는 비밀번호를 내려주지 않는다.
def _require_owner(eng_id: str, user: dict = Depends(get_current_user)):
    if user["engineer_id"] != eng_id:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return user

def _acc_dict(a):
    return {"id": a.id, "name": a.name, "ip": a.ip, "port": a.port,
            "protocol": a.protocol, "username": a.username,
            "has_password": bool(a.password), "memo": a.memo or ""}

@router.get("/{site_id}/accesses")
def list_accesses(eng_id: str, site_id: str, db: Session = Depends(get_db), _u: dict = Depends(_require_owner)):
    _get_valid_site(eng_id, site_id, db)
    return [_acc_dict(a) for a in db.query(Access).filter(Access.site_id == site_id).order_by(Access.name).all()]

@router.get("/{site_id}/accesses/{acc_id}/password")
def get_access_password(eng_id: str, site_id: str, acc_id: str, db: Session = Depends(get_db), _u: dict = Depends(_require_owner)):
    _get_valid_site(eng_id, site_id, db)
    acc = db.query(Access).filter(Access.id == acc_id, Access.site_id == site_id).first()
    if not acc: raise HTTPException(404)
    try:
        return {"password": secure_store.decrypt(acc.password)}
    except ValueError:
        raise HTTPException(status_code=500, detail="저장된 비밀번호를 풀 수 없습니다. 암호화 키 파일(data/secret.key)을 확인해주세요")

class AccessUpdate(BaseModel):
    name:     Optional[str] = None
    ip:       Optional[str] = None
    port:     Optional[str] = None
    protocol: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None   # None = 기존 유지
    memo:     Optional[str] = None

@router.patch("/{site_id}/accesses/{acc_id}")
def update_access(eng_id: str, site_id: str, acc_id: str, data: AccessUpdate, db: Session = Depends(get_db), _u: dict = Depends(_require_owner)):
    _get_valid_site(eng_id, site_id, db)
    acc = db.query(Access).filter(Access.id == acc_id, Access.site_id == site_id).first()
    if not acc: raise HTTPException(404)
    upd = data.dict(exclude_none=True)
    if "name" in upd and not upd["name"].strip():
        raise HTTPException(400, detail="구분명을 입력해주세요")
    if "password" in upd:
        upd["password"] = secure_store.encrypt(upd["password"])   # DB에는 암호화해 저장
    for k, v in upd.items():
        setattr(acc, k, v)
    db.commit()
    return _acc_dict(acc)

class AccessIn(BaseModel):
    name:     str
    ip:       Optional[str] = ""
    port:     Optional[str] = ""
    protocol: Optional[str] = "SSH"
    username: Optional[str] = ""
    password: Optional[str] = ""
    memo:     Optional[str] = ""

@router.post("/{site_id}/accesses")
def create_access(eng_id: str, site_id: str, data: AccessIn, db: Session = Depends(get_db), _u: dict = Depends(_require_owner)):
    _get_valid_site(eng_id, site_id, db)
    vals = data.dict()
    vals["password"] = secure_store.encrypt(vals.get("password"))   # DB에는 암호화해 저장
    acc = Access(id=str(uuid.uuid4()), site_id=site_id, **vals)
    db.add(acc); db.commit()
    return {"id": acc.id}

@router.delete("/{site_id}/accesses/{acc_id}")
def delete_access(eng_id: str, site_id: str, acc_id: str, db: Session = Depends(get_db), _u: dict = Depends(_require_owner)):
    _get_valid_site(eng_id, site_id, db)
    acc = db.query(Access).filter(Access.id == acc_id, Access.site_id == site_id).first()
    if not acc: raise HTTPException(404)
    db.delete(acc); db.commit()
    return {"ok": True}

# ── Reports ────────────────────────────────────────────
@router.get("/{site_id}/reports")
def list_reports(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    return [{"id": r.id, "filename": r.filename, "size": r.size, "uploaded_at": r.uploaded_at,
             "category": r.category or "점검표"}
            for r in db.query(Report).filter(Report.site_id == site_id)
                       .order_by(Report.uploaded_at.desc()).all()]

@router.post("/{site_id}/reports")
def upload_report(eng_id: str, site_id: str, file: UploadFile = File(...), category: str = Form("점검표"),
                  db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    if category not in REPORT_CATS:
        raise HTTPException(400, detail="구분은 점검표·구성도·기타 중 하나입니다")
    site_dir = os.path.join(UPLOAD_DIR, eng_id, site_id)
    os.makedirs(site_dir, exist_ok=True)
    ext    = os.path.splitext(file.filename)[1]
    stored = f"{uuid.uuid4()}{ext}"
    path   = os.path.join(site_dir, stored)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    size_bytes = os.path.getsize(path)
    size_str   = (f"{size_bytes}B" if size_bytes < 1024
                  else f"{size_bytes//1024}KB" if size_bytes < 1048576
                  else f"{round(size_bytes/1048576,1)}MB")
    rpt = Report(id=str(uuid.uuid4()), site_id=site_id, filename=file.filename,
                 stored_name=stored, size=size_str,
                 uploaded_at=datetime.now().strftime("%Y-%m-%d"), category=category)
    db.add(rpt); db.commit()
    return {"id": rpt.id, "filename": rpt.filename, "size": size_str}

INLINE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                ".webp": "image/webp", ".pdf": "application/pdf"}   # 브라우저에서 바로 보기 (구성도 등). svg·html 은 넣지 않음

@router.get("/{site_id}/reports/{report_id}/download")
def download_report(eng_id: str, site_id: str, report_id: str, inline: bool = False, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    rpt = db.query(Report).filter(Report.id == report_id, Report.site_id == site_id).first()
    if not rpt: raise HTTPException(404)
    path = os.path.join(UPLOAD_DIR, eng_id, site_id, rpt.stored_name)
    if not os.path.exists(path): raise HTTPException(404, "파일이 서버에 없습니다")
    mt = INLINE_TYPES.get(os.path.splitext(rpt.filename)[1].lower())
    if inline and mt:
        return FileResponse(path, media_type=mt, filename=rpt.filename, content_disposition_type="inline")
    return FileResponse(path, filename=rpt.filename)

class ReportUpdate(BaseModel):
    category: str

@router.patch("/{site_id}/reports/{report_id}")
def update_report(eng_id: str, site_id: str, report_id: str, data: ReportUpdate, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    rpt = db.query(Report).filter(Report.id == report_id, Report.site_id == site_id).first()
    if not rpt: raise HTTPException(404)
    if data.category not in REPORT_CATS:
        raise HTTPException(400, detail="구분은 점검표·구성도·기타 중 하나입니다")
    rpt.category = data.category; db.commit()
    return {"ok": True}

@router.delete("/{site_id}/reports/{report_id}")
def delete_report(eng_id: str, site_id: str, report_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    rpt = db.query(Report).filter(Report.id == report_id, Report.site_id == site_id).first()
    if not rpt: raise HTTPException(404)
    path = os.path.join(UPLOAD_DIR, eng_id, site_id, rpt.stored_name)
    if os.path.exists(path): os.remove(path)
    db.delete(rpt); db.commit()
    return {"ok": True}

# ── Notes ──────────────────────────────────────────────
@router.get("/{site_id}/notes")
def list_notes(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    return [{"id": n.id, "date": n.date, "title": n.title, "body": n.body}
            for n in db.query(Note).filter(Note.site_id == site_id)
                       .order_by(Note.date.desc()).all()]

class NoteIn(BaseModel):
    date:  Optional[str] = ""
    title: Optional[str] = ""
    body:  str

@router.post("/{site_id}/notes")
def create_note(eng_id: str, site_id: str, data: NoteIn, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    note = Note(id=str(uuid.uuid4()), site_id=site_id, **data.dict())
    db.add(note); db.commit()
    return {"id": note.id}

class NoteUpdate(BaseModel):
    date:  Optional[str] = None
    title: Optional[str] = None
    body:  Optional[str] = None

@router.patch("/{site_id}/notes/{note_id}")
def update_note(eng_id: str, site_id: str, note_id: str, data: NoteUpdate, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    note = db.query(Note).filter(Note.id == note_id, Note.site_id == site_id).first()
    if not note: raise HTTPException(404)
    upd = data.dict(exclude_none=True)
    if "body" in upd and not upd["body"].strip():
        raise HTTPException(400, detail="내용을 입력해주세요")
    for k, v in upd.items():
        setattr(note, k, v)
    db.commit()
    return {"id": note.id, "date": note.date, "title": note.title, "body": note.body}

@router.delete("/{site_id}/notes/{note_id}")
def delete_note(eng_id: str, site_id: str, note_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    note = db.query(Note).filter(Note.id == note_id, Note.site_id == site_id).first()
    if not note: raise HTTPException(404)
    db.delete(note); db.commit()
    return {"ok": True}

def _warranty_days(date_str):
    if not date_str: return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return (d - datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)).days
    except: return None
