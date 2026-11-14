from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Access, Report, Note, Schedule, Issue, SiteChecklist, WorkPlan, Incident
import secure_store
from routers.auth import get_current_user
from routers.site_checklist import _is_done as _cl_is_done, _cl_dict
from routers.technotes import support_only
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid, os, shutil

router = APIRouter(prefix="/api/engineers/{eng_id}/sites", tags=["sites"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")

# ── Sites ──────────────────────────────────────────────
@router.get("")
def list_sites(eng_id: str, db: Session = Depends(get_db)):
    sites = db.query(Site).filter(Site.engineer_id == eng_id).order_by(Site.name).all()
    today = datetime.now().strftime("%Y-%m-%d")
    ym    = today[:7]
    return [{**_site_dict(s), **_site_status(s, today, ym)} for s in sites]

def _site_status(s, today, ym):
    """사이트 상태 요약 (미해결 이슈, 지연 점검, 이번 달 점검, 남은 체크리스트)"""
    pending = [x for x in s.schedules if x.status != "완료"]
    month = [x for x in s.schedules if (x.sched_date or "").startswith(ym)]
    return {
        "open_issues": sum(1 for i in s.issues if i.status != "완료"),
        "late_sched": sum(1 for x in pending if x.sched_date < today),
        "month_sched": {"done": sum(1 for x in month if x.status == "완료"), "total": len(month)},
        "checklist_todo": sum(1 for c in s.checklists if not _cl_is_done(c)),
    }

def _site_dict(s):
    expiring = sum(1 for d in s.devices
                   if _warranty_days(d.warranty) is not None and _warranty_days(d.warranty) <= 90)
    return {
        "id": s.id, "name": s.name, "location": s.location,
        "manager": s.manager, "contact": s.contact, "memo": s.memo or "",
        "device_count": len(s.devices), "expiring_count": expiring
    }

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

@router.post("")
def create_site(eng_id: str, data: SiteIn, db: Session = Depends(get_db)):
    data.name = data.name.strip()
    if not data.name:
        raise HTTPException(400, detail="사이트명을 입력해주세요")
    if db.query(Site).filter(Site.engineer_id == eng_id, Site.name == data.name).first():
        raise HTTPException(400, detail="같은 이름의 사이트가 이미 있습니다")
    site = Site(id=str(uuid.uuid4()), engineer_id=eng_id, **data.dict())
    db.add(site); db.commit(); db.refresh(site)
    return _site_dict(site)

class SiteUpdate(BaseModel):
    name:     Optional[str] = None
    location: Optional[str] = None
    manager:  Optional[str] = None
    contact:  Optional[str] = None
    memo:     Optional[str] = None

@router.patch("/{site_id}")
def update_site(eng_id: str, site_id: str, data: SiteUpdate, db: Session = Depends(get_db)):
    site = _get_valid_site(eng_id, site_id, db)
    upd = data.dict(exclude_none=True)
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
    warranty = sorted(({"id": d.id, "name": d.name, "warranty": d.warranty, "warranty_days": _warranty_days(d.warranty)}
                       for d in s.devices if _warranty_days(d.warranty) is not None and _warranty_days(d.warranty) <= 90),
                      key=lambda x: x["warranty_days"])
    return {
        "site": _site_dict(s),
        "today": today,
        "counts": {"devices": len(s.devices), "no_warranty": sum(1 for d in s.devices if not d.warranty),
                   "accesses": len(s.accesses), "reports": len(s.reports), "notes": len(s.notes)},
        "schedules_pending": [sch(x) for x in pending[:6]],
        "schedules_done": [sch(x) for x in done[:3]],
        "issues": [{"id": i.id, "title": i.title, "body": i.body or "", "severity": i.severity, "status": i.status,
                    "created_at": i.created_at, "site_id": i.site_id, "site_name": s.name} for i in issues],
        "checklists": [{**_cl_dict(c), "site_name": s.name} for c in s.checklists],
        "workplans": [{"id": p.id, "title": p.title, "work_date": p.work_date, "status": p.status} for p in plans],
        "incidents": [{"id": i.id, "title": i.title, "occurred_at": i.occurred_at, "severity": i.severity,
                       "status": i.status} for i in incs],
        "warranty": warranty,
    }

# ── Devices ────────────────────────────────────────────
@router.get("/{site_id}/devices")
def list_devices(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    return [_dev_dict(d) for d in db.query(Device).filter(Device.site_id == site_id).all()]

class DeviceIn(BaseModel):
    name:      str
    model:     Optional[str] = ""
    serial_no: Optional[str] = ""
    dev_type:  Optional[str] = "서버"
    os:        Optional[str] = ""
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

def _dev_dict(d):
    return {
        "id": d.id, "name": d.name, "model": d.model, "serial_no": d.serial_no,
        "dev_type": d.dev_type, "os": d.os, "purchase": d.purchase,
        "warranty": d.warranty, "status": d.status, "memo": d.memo,
        "warranty_days": _warranty_days(d.warranty)
    }

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
    return [{"id": r.id, "filename": r.filename, "size": r.size, "uploaded_at": r.uploaded_at}
            for r in db.query(Report).filter(Report.site_id == site_id)
                       .order_by(Report.uploaded_at.desc()).all()]

@router.post("/{site_id}/reports")
def upload_report(eng_id: str, site_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
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
                 uploaded_at=datetime.now().strftime("%Y-%m-%d"))
    db.add(rpt); db.commit()
    return {"id": rpt.id, "filename": rpt.filename, "size": size_str}

@router.get("/{site_id}/reports/{report_id}/download")
def download_report(eng_id: str, site_id: str, report_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    rpt = db.query(Report).filter(Report.id == report_id, Report.site_id == site_id).first()
    if not rpt: raise HTTPException(404)
    path = os.path.join(UPLOAD_DIR, eng_id, site_id, rpt.stored_name)
    if not os.path.exists(path): raise HTTPException(404, "파일이 서버에 없습니다")
    return FileResponse(path, filename=rpt.filename)

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
