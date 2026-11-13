from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, Project, ProjectTask, ProjectFile
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

class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = ""
    template: Optional[str] = ""

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    customer: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None

def _get_valid_project(eng_id: str, proj_id: str, db: Session):
    project = db.query(Project).filter(Project.id == proj_id, Project.engineer_id == eng_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")
    return project

@router.get("")
def list_projects(eng_id: str, db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.engineer_id == eng_id).all()
    res = []
    for p in projects:
        tasks = _sorted_tasks(p)
        total_tasks = len(tasks)
        done_tasks = len([t for t in tasks if t.status == "완료"])
        progress = int((done_tasks / total_tasks * 100)) if total_tasks > 0 else 0
        res.append({
            "id": p.id,
            "name": p.name,
            "customer": p.customer,
            "start_date": p.start_date,
            "end_date": p.end_date,
            "status": p.status,
            "description": p.description,
            "progress": progress,
            "file_count": len(p.files),
            "tasks": [{"id": t.id, "name": t.name, "status": t.status, "start_date": t.start_date, "end_date": t.end_date, "order_idx": t.order_idx} for t in tasks]
        })
    return res

@router.post("")
def create_project(eng_id: str, payload: ProjectCreate, db: Session = Depends(get_db)):
    if not payload.name.strip():
        raise HTTPException(400, detail="프로젝트명을 입력해주세요")
    _check_status(payload.status, PROJ_STATUSES)
    pid = str(uuid.uuid4())
    p = Project(
        id=pid,
        engineer_id=eng_id,
        name=payload.name,
        customer=payload.customer,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
        description=payload.description
    )
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
    p = db.query(Project).filter(Project.id == proj_id, Project.engineer_id == eng_id).first()
    if not p: raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")
    _check_status(payload.status, PROJ_STATUSES)
    if payload.name is not None:
        if not payload.name.strip(): raise HTTPException(400, detail="프로젝트명을 입력해주세요")
        p.name = payload.name
    if payload.customer is not None: p.customer = payload.customer
    if payload.start_date is not None: p.start_date = payload.start_date
    if payload.end_date is not None: p.end_date = payload.end_date
    if payload.status is not None: p.status = payload.status
    if payload.description is not None: p.description = payload.description
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
