from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, Site, Device, Access, Report, Note
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid, os, shutil

router = APIRouter(prefix="/api/engineers/{eng_id}/sites", tags=["sites"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")

# ── Sites ──────────────────────────────────────────────
@router.get("")
def list_sites(eng_id: str, db: Session = Depends(get_db)):
    sites = db.query(Site).filter(Site.engineer_id == eng_id).order_by(Site.created_at).all()
    return [_site_dict(s) for s in sites]

def _site_dict(s):
    expiring = sum(1 for d in s.devices
                   if _warranty_days(d.warranty) is not None and _warranty_days(d.warranty) <= 90)
    return {
        "id": s.id, "name": s.name, "location": s.location,
        "manager": s.manager, "contact": s.contact, "memo": s.memo,
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
    site = Site(id=str(uuid.uuid4()), engineer_id=eng_id, **data.dict())
    db.add(site); db.commit(); db.refresh(site)
    return _site_dict(site)

@router.delete("/{site_id}")
def delete_site(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.id == site_id, Site.engineer_id == eng_id).first()
    if not site: raise HTTPException(404)
    db.delete(site); db.commit()
    return {"ok": True}

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
@router.get("/{site_id}/accesses")
def list_accesses(eng_id: str, site_id: str, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    return [{"id": a.id, "name": a.name, "ip": a.ip, "port": a.port,
             "protocol": a.protocol, "username": a.username,
             "password": a.password, "memo": a.memo}
            for a in db.query(Access).filter(Access.site_id == site_id).all()]

class AccessIn(BaseModel):
    name:     str
    ip:       Optional[str] = ""
    port:     Optional[str] = ""
    protocol: Optional[str] = "SSH"
    username: Optional[str] = ""
    password: Optional[str] = ""
    memo:     Optional[str] = ""

@router.post("/{site_id}/accesses")
def create_access(eng_id: str, site_id: str, data: AccessIn, db: Session = Depends(get_db)):
    _get_valid_site(eng_id, site_id, db)
    acc = Access(id=str(uuid.uuid4()), site_id=site_id, **data.dict())
    db.add(acc); db.commit()
    return {"id": acc.id}

@router.delete("/{site_id}/accesses/{acc_id}")
def delete_access(eng_id: str, site_id: str, acc_id: str, db: Session = Depends(get_db)):
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
