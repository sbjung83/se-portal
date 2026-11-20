from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, Project, ProjectTask, ProjectFile, ProjectDevice, ProjectLog, Site, Device
import os
import shutil
import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(prefix="/api/engineers/{eng_id}/projects", tags=["projects"])

class TaskCreate(BaseModel):
    name: str
    status: Optional[str] = "대기"
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    order_idx: Optional[int] = None   # 생략하면 맨 뒤에 추가

class TaskReorder(BaseModel):
    ids: List[str]                    # 화면에 보이는 순서대로의 태스크 id

PROJ_STATUSES = ("진행 대기", "진행 중", "보류", "완료")
PROJ_KINDS = ("구축", "증설", "이전", "교체", "구매", "기타")
LOG_KINDS = ("회의", "협의", "이슈", "결정", "작업", "메모")
DEV_TYPES = ("서버", "스토리지", "SAN Switch", "네트워크", "기타")
TASK_STATUSES = ("대기", "진행중", "완료")

def _check_status(value, allowed):
    if value is not None and value not in allowed:
        raise HTTPException(400, detail=f"상태 값이 올바르지 않습니다 ({' / '.join(allowed)})")

# ── 제출자료(첨부 파일) ─────────────────────────
UPLOAD_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads"))
FILE_CATEGORIES = ("완료보고서", "검수확인서", "구성도", "회의록", "기타")
MAX_FILE_BYTES = 50 * 1024 * 1024   # nginx 업로드 한도(50MB)와 동일

def _proj_dir(eng_id: str, proj_id: str) -> str:
    """프로젝트 첨부 폴더. uploads 밖을 가리키면 거부한다."""
    path = os.path.realpath(os.path.join(UPLOAD_DIR, eng_id, "projects", proj_id))
    if not path.startswith(UPLOAD_DIR + os.sep):
        raise HTTPException(400, detail="잘못된 경로입니다")
    return path

def _file_dict(f):
    return {"id": f.id, "project_id": f.project_id, "category": f.category or "기타",
            "filename": f.filename, "size": f.size or 0, "note": f.note or "",
            "uploaded_at": f.uploaded_at or ""}

def _sorted_tasks(p):
    return sorted(p.tasks, key=lambda x: (x.order_idx or 0, x.start_date or ""))

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    order_idx: Optional[int] = None

_PROJ_FIELDS = ("name", "customer", "start_date", "end_date", "status", "description", "site_id", "kind",
                "delivery_date", "accept_date", "pm", "sales", "cust_contact", "cust_phone", "req_docs")

class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = ""
    template: Optional[str] = ""
    site_id: Optional[str] = ""
    kind: Optional[str] = "구축"
    delivery_date: Optional[str] = ""
    accept_date: Optional[str] = ""
    pm: Optional[str] = ""
    sales: Optional[str] = ""
    cust_contact: Optional[str] = ""
    cust_phone: Optional[str] = ""
    req_docs: Optional[List[str]] = None      # None = 기본(완료보고서·검수확인서)

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    customer: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    site_id: Optional[str] = None
    kind: Optional[str] = None
    delivery_date: Optional[str] = None
    accept_date: Optional[str] = None
    pm: Optional[str] = None
    sales: Optional[str] = None
    cust_contact: Optional[str] = None
    cust_phone: Optional[str] = None
    req_docs: Optional[List[str]] = None

def _apply(p: Project, data: dict, eng_id: str, db: Session):
    """입력 값 검사 후 반영. 사이트를 고르면 고객사 이름은 사이트 이름으로 맞춘다."""
    _check_status(data.get("status"), PROJ_STATUSES)
    if data.get("kind") is not None and data["kind"] not in PROJ_KINDS:
        raise HTTPException(400, detail=f"종류 값이 올바르지 않습니다 ({' / '.join(PROJ_KINDS)})")
    if "name" in data and data["name"] is not None and not data["name"].strip():
        raise HTTPException(400, detail="프로젝트명을 입력해주세요")
    if data.get("req_docs") is not None:
        bad = [d for d in data["req_docs"] if d not in FILE_CATEGORIES]
        if bad:
            raise HTTPException(400, detail=f"산출물 구분이 올바르지 않습니다: {', '.join(bad)}")
        data["req_docs"] = ",".join(dict.fromkeys(data["req_docs"]))
    for k in _PROJ_FIELDS:
        v = data.get(k)
        if v is not None:
            setattr(p, k, v.strip() if isinstance(v, str) and k not in ("description",) else v)
    s, e = p.start_date or "", p.end_date or ""
    if s and e and e < s:
        raise HTTPException(400, detail="종료일이 시작일보다 빠릅니다")
    if p.site_id:
        site = db.query(Site).filter(Site.id == p.site_id, Site.engineer_id == eng_id).first()
        if not site:
            raise HTTPException(400, detail="사이트를 찾을 수 없습니다")
        p.customer = site.name

def _norm(t):
    return "".join((t or "").lower().split())

def _match_sites(eng_id: str, projects: list, db: Session):
    """예전 프로젝트(사이트 연결 없음)는 고객사 이름이 사이트 이름과 같으면(띄어쓰기 무시) 자동 연결."""
    todo = [p for p in projects if not p.site_id and (p.customer or "").strip()]
    if not todo:
        return
    sites = {_norm(s.name): s.id for s in db.query(Site).filter(Site.engineer_id == eng_id).all()}
    changed = False
    for p in todo:
        sid = sites.get(_norm(p.customer))
        if sid:
            p.site_id, changed = sid, True
    if changed:
        db.commit()

def _docs(p: Project):
    req = [d for d in (p.req_docs or "").split(",") if d]
    have = {f.category for f in p.files}
    return {"required": req, "done": [d for d in req if d in have]}

def _next_task(tasks):
    t = next((t for t in tasks if t.status != "완료"), None)
    return {"id": t.id, "name": t.name, "status": t.status, "end_date": t.end_date or ""} if t else None

def _proj_dict(p: Project, site_names: dict):
    tasks = _sorted_tasks(p)
    done = len([t for t in tasks if t.status == "완료"])
    return {
        "id": p.id, "name": p.name, "customer": p.customer or "", "start_date": p.start_date or "",
        "end_date": p.end_date or "", "status": p.status, "description": p.description or "",
        "site_id": p.site_id or "", "site_name": site_names.get(p.site_id or "", ""), "kind": p.kind or "구축",
        "delivery_date": p.delivery_date or "", "accept_date": p.accept_date or "", "pm": p.pm or "",
        "sales": p.sales or "", "cust_contact": p.cust_contact or "", "cust_phone": p.cust_phone or "",
        "progress": int(done / len(tasks) * 100) if tasks else 0,
        "file_count": len(p.files), "device_count": len(p.devices),
        "device_unreg": sum(1 for d in p.devices if not d.device_id), "log_count": len(p.logs),
        "docs": _docs(p), "next_task": _next_task(tasks),
        "tasks": [{"id": t.id, "name": t.name, "status": t.status, "start_date": t.start_date, "end_date": t.end_date, "order_idx": t.order_idx} for t in tasks],
    }

def _get_valid_project(eng_id: str, proj_id: str, db: Session):
    project = db.query(Project).filter(Project.id == proj_id, Project.engineer_id == eng_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")
    return project

@router.get("")
def list_projects(eng_id: str, db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.engineer_id == eng_id).all()
    _match_sites(eng_id, projects, db)
    names = {s.id: s.name for s in db.query(Site).filter(Site.engineer_id == eng_id).all()}
    return [_proj_dict(p, names) for p in projects]

@router.post("")
def create_project(eng_id: str, payload: ProjectCreate, db: Session = Depends(get_db)):
    if not payload.name.strip():
        raise HTTPException(400, detail="프로젝트명을 입력해주세요")
    pid = str(uuid.uuid4())
    p = Project(id=pid, engineer_id=eng_id, req_docs="완료보고서,검수확인서")
    data = payload.dict()
    data.pop("template", None)
    if data.get("req_docs") is None:
        data.pop("req_docs", None)
    _apply(p, data, eng_id, db)
    db.add(p)
    
    if payload.template and payload.start_date:
        from datetime import timedelta
        try:
            start_dt = datetime.strptime(payload.start_date, "%Y-%m-%d")
            templates = {
                "storage": [
                    "스토리지 납품",
                    "스토리지 설치 및 구성",
                    "데이터 복제 구성 (GAD 등)",
                    "호스트 연결 및 절체 테스트",
                    "안정화 및 산출물 제출"
                ],
                "server": [
                    "서버 납품",
                    "OS 설치 및 기본 구성",
                    "네트워크 및 스토리지 연동",
                    "애플리케이션 설치 지원",
                    "안정화 및 산출물 제출"
                ],
                "virt": [
                    "서버·스토리지 납품 및 랙 설치",
                    "하이퍼바이저 설치 및 클러스터 구성",
                    "스토리지·네트워크 연동, HA 테스트",
                    "VM 생성·이관 지원",
                    "안정화 및 산출물 제출"
                ],
                "migration": [
                    "현황 조사 및 이전 계획 수립",
                    "대상 장비 준비 및 사전 구성",
                    "데이터·서비스 이전 작업",
                    "검증 및 산출물 제출"
                ]
            }
            def get_month_week(dt):
                first_day = dt.replace(day=1)
                first_mon_day = 1 + (7 - first_day.weekday()) % 7
                if dt.day < first_mon_day:
                    prev_month_last_day = first_day - timedelta(days=1)
                    return get_month_week(prev_month_last_day)
                week_num = (dt.day - first_mon_day) // 7 + 1
                return f"{dt.month}월 {week_num}주차"
                
            tasks = templates.get(payload.template, [])
            for i, task_name in enumerate(tasks):
                cur_dt = start_dt + timedelta(days=7*i)
                task_start = cur_dt.strftime("%Y-%m-%d")
                task_end = (start_dt + timedelta(days=7*(i+1) - 1)).strftime("%Y-%m-%d")
                t = ProjectTask(
                    id=str(uuid.uuid4()),
                    project_id=pid,
                    name=f"{get_month_week(cur_dt)}: {task_name}",
                    status="대기",
                    start_date=task_start,
                    end_date=task_end,
                    order_idx=i
                )
                db.add(t)
        except Exception as e:
            pass # ignore date parsing errors

    db.commit()
    return {"message": "Project created", "id": pid}

@router.patch("/{proj_id}")
def update_project(eng_id: str, proj_id: str, payload: ProjectUpdate, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    _apply(p, payload.dict(exclude_none=True), eng_id, db)
    db.commit()
    return {"message": "Project updated"}

@router.delete("/{proj_id}")
def delete_project(eng_id: str, proj_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == proj_id, Project.engineer_id == eng_id).first()
    if not p: raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")
    pdir = _proj_dir(eng_id, proj_id)
    db.delete(p)
    db.commit()
    if os.path.isdir(pdir):          # 첨부 파일 폴더도 함께 삭제
        shutil.rmtree(pdir, ignore_errors=True)
    return {"message": "Deleted"}

@router.post("/{proj_id}/tasks")
def add_task(eng_id: str, proj_id: str, payload: TaskCreate, db: Session = Depends(get_db)):
    proj = _get_valid_project(eng_id, proj_id, db)
    if not payload.name.strip():
        raise HTTPException(400, detail="태스크명을 입력해주세요")
    _check_status(payload.status, TASK_STATUSES)
    order = payload.order_idx
    if order is None:
        order = max([t.order_idx or 0 for t in proj.tasks], default=-1) + 1
    tid = str(uuid.uuid4())
    t = ProjectTask(
        id=tid,
        project_id=proj_id,
        name=payload.name,
        status=payload.status,
        start_date=payload.start_date,
        end_date=payload.end_date,
        order_idx=order
    )
    db.add(t)
    db.commit()
    return {"message": "Task added", "id": tid}

@router.post("/{proj_id}/tasks/reorder")
def reorder_tasks(eng_id: str, proj_id: str, payload: TaskReorder, db: Session = Depends(get_db)):
    """화면 순서(ids)대로 order_idx를 0부터 다시 매긴다. 목록에 없는 태스크는 기존 순서로 뒤에 붙인다."""
    proj = _get_valid_project(eng_id, proj_id, db)
    by_id = {t.id: t for t in proj.tasks}
    ordered = [by_id[i] for i in dict.fromkeys(payload.ids) if i in by_id]
    rest = [t for t in _sorted_tasks(proj) if t not in ordered]
    for n, t in enumerate(ordered + rest):
        t.order_idx = n
    db.commit()
    return {"ok": True}

@router.patch("/{proj_id}/tasks/{task_id}")
def update_task(eng_id: str, proj_id: str, task_id: str, payload: TaskUpdate, db: Session = Depends(get_db)):
    _get_valid_project(eng_id, proj_id, db)
    t = db.query(ProjectTask).filter(ProjectTask.id == task_id, ProjectTask.project_id == proj_id).first()
    if not t: raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다")
    _check_status(payload.status, TASK_STATUSES)
    if payload.name is not None:
        if not payload.name.strip(): raise HTTPException(400, detail="태스크명을 입력해주세요")
        t.name = payload.name
    if payload.status is not None: t.status = payload.status
    if payload.start_date is not None: t.start_date = payload.start_date
    if payload.end_date is not None: t.end_date = payload.end_date
    if payload.order_idx is not None: t.order_idx = payload.order_idx
    db.commit()
    return {"message": "Task updated"}

@router.delete("/{proj_id}/tasks/{task_id}")
def delete_task(eng_id: str, proj_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_valid_project(eng_id, proj_id, db)
    t = db.query(ProjectTask).filter(ProjectTask.id == task_id, ProjectTask.project_id == proj_id).first()
    if not t: raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다")
    db.delete(t)
    db.commit()
    return {"message": "Deleted"}

# ── 제출자료(첨부 파일) API ──────────────────────
class FileUpdate(BaseModel):
    category: Optional[str] = None
    note: Optional[str] = None

def _get_file(eng_id: str, proj_id: str, file_id: str, db: Session):
    _get_valid_project(eng_id, proj_id, db)
    f = db.query(ProjectFile).filter(ProjectFile.id == file_id, ProjectFile.project_id == proj_id).first()
    if not f:
        raise HTTPException(404, detail="첨부 파일을 찾을 수 없습니다")
    return f

@router.get("/{proj_id}/files")
def list_files(eng_id: str, proj_id: str, db: Session = Depends(get_db)):
    _get_valid_project(eng_id, proj_id, db)
    files = db.query(ProjectFile).filter(ProjectFile.project_id == proj_id).order_by(ProjectFile.uploaded_at.desc()).all()
    return [_file_dict(f) for f in files]

@router.post("/{proj_id}/files")
def upload_file(eng_id: str, proj_id: str, file: UploadFile = File(...),
                category: str = Form("기타"), note: str = Form(""), db: Session = Depends(get_db)):
    _get_valid_project(eng_id, proj_id, db)
    if category not in FILE_CATEGORIES:
        raise HTTPException(400, detail=f"구분 값이 올바르지 않습니다 ({' / '.join(FILE_CATEGORIES)})")
    name = os.path.basename((file.filename or "").replace("\\", "/")).strip()
    if not name:
        raise HTTPException(400, detail="파일 이름이 없습니다")
    pdir = _proj_dir(eng_id, proj_id)
    os.makedirs(pdir, exist_ok=True)
    stored = f"{uuid.uuid4()}{os.path.splitext(name)[1][:20]}"
    path = os.path.join(pdir, stored)
    size = 0
    try:
        with open(path, "wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, detail="파일이 너무 큽니다 (최대 50MB)")
                out.write(chunk)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    if size == 0:
        os.remove(path)
        raise HTTPException(400, detail="빈 파일은 첨부할 수 없습니다")
    f = ProjectFile(id=str(uuid.uuid4()), project_id=proj_id, category=category, filename=name,
                    stored_name=stored, size=size, note=note.strip(),
                    uploaded_at=datetime.now().strftime("%Y-%m-%d %H:%M"))
    db.add(f); db.commit()
    return _file_dict(f)

@router.get("/{proj_id}/files/{file_id}/download")
def download_file(eng_id: str, proj_id: str, file_id: str, db: Session = Depends(get_db)):
    f = _get_file(eng_id, proj_id, file_id, db)
    path = os.path.join(_proj_dir(eng_id, proj_id), f.stored_name)
    if not os.path.isfile(path):
        raise HTTPException(404, detail="파일이 서버에 없습니다")
    return FileResponse(path, filename=f.filename)

@router.patch("/{proj_id}/files/{file_id}")
def update_file(eng_id: str, proj_id: str, file_id: str, data: FileUpdate, db: Session = Depends(get_db)):
    f = _get_file(eng_id, proj_id, file_id, db)
    if data.category is not None and data.category not in FILE_CATEGORIES:
        raise HTTPException(400, detail=f"구분 값이 올바르지 않습니다 ({' / '.join(FILE_CATEGORIES)})")
    for k, v in data.dict(exclude_none=True).items():
        setattr(f, k, v)
    db.commit()
    return _file_dict(f)

@router.delete("/{proj_id}/files/{file_id}")
def delete_file(eng_id: str, proj_id: str, file_id: str, db: Session = Depends(get_db)):
    f = _get_file(eng_id, proj_id, file_id, db)
    path = os.path.join(_proj_dir(eng_id, proj_id), f.stored_name)
    if os.path.isfile(path):
        os.remove(path)
    db.delete(f); db.commit()
    return {"ok": True}

# ── 프로젝트 장비 (납품·구축 장비 → 사이트 장비 리스트 등록·연결) ──────────
class PDevIn(BaseModel):
    name: str
    dev_type: Optional[str] = "서버"
    model: Optional[str] = ""
    serial_no: Optional[str] = ""
    os: Optional[str] = ""
    warranty: Optional[str] = ""
    memo: Optional[str] = ""
    device_id: Optional[str] = ""          # 사이트의 기존 장비와 연결할 때

class PDevUpdate(BaseModel):
    name: Optional[str] = None
    dev_type: Optional[str] = None
    model: Optional[str] = None
    serial_no: Optional[str] = None
    os: Optional[str] = None
    warranty: Optional[str] = None
    memo: Optional[str] = None
    device_id: Optional[str] = None

def _pdev_dict(d: ProjectDevice, linked: dict):
    dev = linked.get(d.device_id or "")
    return {"id": d.id, "name": d.name, "dev_type": d.dev_type or "서버", "model": d.model or "",
            "serial_no": d.serial_no or "", "os": d.os or "", "warranty": d.warranty or "", "memo": d.memo or "",
            "device_id": dev.id if dev else "", "device_name": dev.name if dev else "",
            "device_site_id": dev.site_id if dev else ""}

def _check_link(p: Project, device_id: str, db: Session):
    """연결할 장비는 이 프로젝트 사이트의 장비여야 한다."""
    if not device_id:
        return
    if not p.site_id:
        raise HTTPException(400, detail="사이트를 먼저 연결해야 기존 장비와 연결할 수 있습니다")
    if not db.query(Device).filter(Device.id == device_id, Device.site_id == p.site_id).first():
        raise HTTPException(400, detail="이 사이트의 장비가 아닙니다")

def _linked(db: Session, devs):
    ids = [d.device_id for d in devs if d.device_id]
    return {x.id: x for x in db.query(Device).filter(Device.id.in_(ids)).all()} if ids else {}

@router.get("/{proj_id}/devices")
def list_pdevs(eng_id: str, proj_id: str, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    devs = sorted(p.devices, key=lambda d: (d.order_idx or 0, d.name))
    linked = _linked(db, devs)
    return [_pdev_dict(d, linked) for d in devs]

@router.post("/{proj_id}/devices")
def add_pdev(eng_id: str, proj_id: str, data: PDevIn, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    if not data.name.strip():
        raise HTTPException(400, detail="장비 이름을 입력해주세요")
    _check_link(p, data.device_id, db)
    d = ProjectDevice(id=str(uuid.uuid4()), project_id=p.id,
                      order_idx=max([x.order_idx or 0 for x in p.devices], default=-1) + 1,
                      **{k: (v or "").strip() if k != "memo" else (v or "") for k, v in data.dict().items()})
    db.add(d); db.commit()
    return {"ok": True, "id": d.id}

@router.patch("/{proj_id}/devices/{pdev_id}")
def update_pdev(eng_id: str, proj_id: str, pdev_id: str, data: PDevUpdate, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    d = next((x for x in p.devices if x.id == pdev_id), None)
    if not d:
        raise HTTPException(404, detail="장비를 찾을 수 없습니다")
    vals = data.dict(exclude_none=True)
    if "name" in vals and not vals["name"].strip():
        raise HTTPException(400, detail="장비 이름을 입력해주세요")
    if "device_id" in vals:
        _check_link(p, vals["device_id"], db)
    for k, v in vals.items():
        setattr(d, k, v.strip() if k != "memo" else v)
    db.commit()
    return {"ok": True}

@router.delete("/{proj_id}/devices/{pdev_id}")
def delete_pdev(eng_id: str, proj_id: str, pdev_id: str, db: Session = Depends(get_db)):
    """프로젝트 목록에서만 뺀다 (사이트 장비 리스트에 등록된 장비는 그대로)."""
    p = _get_valid_project(eng_id, proj_id, db)
    d = next((x for x in p.devices if x.id == pdev_id), None)
    if not d:
        raise HTTPException(404, detail="장비를 찾을 수 없습니다")
    db.delete(d); db.commit()
    return {"ok": True}

@router.post("/{proj_id}/devices/register")
def register_pdevs(eng_id: str, proj_id: str, db: Session = Depends(get_db)):
    """미등록 장비를 사이트 장비 리스트로: 같은 S/N(없으면 같은 이름) 장비가 있으면 연결, 없으면 새로 등록."""
    p = _get_valid_project(eng_id, proj_id, db)
    if not p.site_id:
        raise HTTPException(400, detail="프로젝트에 사이트를 먼저 연결해주세요 (프로젝트 수정 → 사이트)")
    site_devs = db.query(Device).filter(Device.site_id == p.site_id).all()
    by_sn = {_norm(x.serial_no): x for x in site_devs if (x.serial_no or "").strip()}
    by_name = {_norm(x.name): x for x in site_devs}
    created = linked = 0
    for d in p.devices:
        if d.device_id:
            continue
        hit = by_sn.get(_norm(d.serial_no)) if (d.serial_no or "").strip() else None
        hit = hit or by_name.get(_norm(d.name))
        if hit:
            d.device_id = hit.id
            linked += 1
            continue
        memo = (d.memo or "").strip()
        dev = Device(id=str(uuid.uuid4()), site_id=p.site_id, name=d.name, model=d.model or "",
                     serial_no=d.serial_no or "", dev_type=d.dev_type or "서버", os=d.os or "",
                     purchase=p.delivery_date or p.start_date or "", warranty=d.warranty or "", status="운영중",
                     memo=(memo + "\n" if memo else "") + f"[프로젝트] {p.name}")
        db.add(dev)
        d.device_id = dev.id
        by_sn[_norm(dev.serial_no)] = dev
        by_name[_norm(dev.name)] = dev
        created += 1
    db.commit()
    return {"ok": True, "created": created, "linked": linked}

# ── 작업 기록 ─────────────────────────────────────
class PLogIn(BaseModel):
    log_date: str
    kind: Optional[str] = "메모"
    content: str

class PLogUpdate(BaseModel):
    log_date: Optional[str] = None
    kind: Optional[str] = None
    content: Optional[str] = None

def _plog_dict(l: ProjectLog):
    return {"id": l.id, "log_date": l.log_date or "", "kind": l.kind or "메모", "content": l.content or "",
            "created_at": l.created_at or ""}

def _check_log(kind, content):
    if kind is not None and kind not in LOG_KINDS:
        raise HTTPException(400, detail=f"구분 값이 올바르지 않습니다 ({' / '.join(LOG_KINDS)})")
    if content is not None and not content.strip():
        raise HTTPException(400, detail="내용을 입력해주세요")

@router.get("/{proj_id}/logs")
def list_plogs(eng_id: str, proj_id: str, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    return [_plog_dict(l) for l in sorted(p.logs, key=lambda l: (l.log_date or "", l.created_at or ""), reverse=True)]

@router.post("/{proj_id}/logs")
def add_plog(eng_id: str, proj_id: str, data: PLogIn, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    _check_log(data.kind, data.content)
    if not data.log_date:
        raise HTTPException(400, detail="날짜를 입력해주세요")
    l = ProjectLog(id=str(uuid.uuid4()), project_id=p.id, log_date=data.log_date, kind=data.kind or "메모",
                   content=data.content.strip(), created_at=datetime.now().strftime("%Y-%m-%d %H:%M"))
    db.add(l); db.commit()
    return _plog_dict(l)

@router.patch("/{proj_id}/logs/{log_id}")
def update_plog(eng_id: str, proj_id: str, log_id: str, data: PLogUpdate, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    l = next((x for x in p.logs if x.id == log_id), None)
    if not l:
        raise HTTPException(404, detail="기록을 찾을 수 없습니다")
    _check_log(data.kind, data.content)
    for k, v in data.dict(exclude_none=True).items():
        setattr(l, k, v.strip() if k == "content" else v)
    db.commit()
    return _plog_dict(l)

@router.delete("/{proj_id}/logs/{log_id}")
def delete_plog(eng_id: str, proj_id: str, log_id: str, db: Session = Depends(get_db)):
    p = _get_valid_project(eng_id, proj_id, db)
    l = next((x for x in p.logs if x.id == log_id), None)
    if not l:
        raise HTTPException(404, detail="기록을 찾을 수 없습니다")
    db.delete(l); db.commit()
    return {"ok": True}
