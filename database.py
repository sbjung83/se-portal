from sqlalchemy import create_engine, Column, String, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os, hashlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "data", "portal.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

# ── 사용자 ────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id          = Column(String, primary_key=True)
    username    = Column(String, nullable=False, unique=True)
    password    = Column(String, nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=True)  # 1:1 매핑
    created_at  = Column(DateTime, default=datetime.utcnow)
    engineer    = relationship("Engineer")

# ── 엔지니어 ──────────────────────────────────
class Engineer(Base):
    __tablename__ = "engineers"
    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False, unique=True)
    memo       = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    sites = relationship("Site",    back_populates="engineer", cascade="all, delete")
    logs  = relationship("WorkLog", back_populates="engineer", cascade="all, delete")

# ── 사이트 ────────────────────────────────────
class Site(Base):
    __tablename__ = "sites"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    name        = Column(String, nullable=False)
    location    = Column(String, default="")
    manager     = Column(String, default="")
    contact     = Column(String, default="")
    memo        = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)

    engineer   = relationship("Engineer",      back_populates="sites")
    devices    = relationship("Device",        back_populates="site", cascade="all, delete")
    accesses   = relationship("Access",        back_populates="site", cascade="all, delete")
    reports    = relationship("Report",        back_populates="site", cascade="all, delete")
    notes      = relationship("Note",          back_populates="site", cascade="all, delete")
    schedules  = relationship("Schedule",      back_populates="site", cascade="all, delete")
    issues     = relationship("Issue",         back_populates="site", cascade="all, delete")
    checklists = relationship("SiteChecklist", back_populates="site", cascade="all, delete")

class Device(Base):
    __tablename__ = "devices"
    id        = Column(String, primary_key=True)
    site_id   = Column(String, ForeignKey("sites.id"), nullable=False)
    name      = Column(String, nullable=False)
    model     = Column(String, default="")
    serial_no = Column(String, default="")
    dev_type  = Column(String, default="서버")
    os        = Column(String, default="")
    purchase  = Column(String, default="")
    warranty  = Column(String, default="")
    status    = Column(String, default="운영중")
    memo      = Column(Text, default="")
    site      = relationship("Site", back_populates="devices")

class Access(Base):
    __tablename__ = "accesses"
    id       = Column(String, primary_key=True)
    site_id  = Column(String, ForeignKey("sites.id"), nullable=False)
    name     = Column(String, nullable=False)
    ip       = Column(String, default="")
    port     = Column(String, default="")
    protocol = Column(String, default="SSH")
    username = Column(String, default="")
    password = Column(String, default="")
    memo     = Column(Text, default="")
    site     = relationship("Site", back_populates="accesses")

class Report(Base):
    __tablename__ = "reports"
    id          = Column(String, primary_key=True)
    site_id     = Column(String, ForeignKey("sites.id"), nullable=False)
    filename    = Column(String, nullable=False)
    stored_name = Column(String, nullable=False)
    size        = Column(String, default="")
    uploaded_at = Column(String, default="")
    site        = relationship("Site", back_populates="reports")

class Note(Base):
    __tablename__ = "notes"
    id      = Column(String, primary_key=True)
    site_id = Column(String, ForeignKey("sites.id"), nullable=False)
    date    = Column(String, default="")
    title   = Column(String, default="")
    body    = Column(Text, default="")
    site    = relationship("Site", back_populates="notes")

# ── 점검 일정 ─────────────────────────────────
class Schedule(Base):
    __tablename__ = "schedules"
    id          = Column(String, primary_key=True)
    site_id     = Column(String, ForeignKey("sites.id"), nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    title       = Column(String, nullable=False)
    sched_date  = Column(String, nullable=False)
    sched_type  = Column(String, default="월간")   # 월간 / 분기 / 특별
    status      = Column(String, default="예정")   # 예정 / 완료
    memo        = Column(Text, default="")
    site        = relationship("Site", back_populates="schedules")

# ── 사이트 이슈 ───────────────────────────────
class Issue(Base):
    __tablename__ = "issues"
    id          = Column(String, primary_key=True)
    site_id     = Column(String, ForeignKey("sites.id"), nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    title       = Column(String, nullable=False)
    body        = Column(Text, default="")
    severity    = Column(String, default="보통")   # 긴급 / 높음 / 보통 / 낮음
    status      = Column(String, default="오픈")   # 오픈 / 처리중 / 완료
    created_at  = Column(String, default="")
    site        = relationship("Site", back_populates="issues")

# ── 사이트별 체크리스트 ───────────────────────
class SiteChecklist(Base):
    __tablename__ = "site_checklists"
    id          = Column(String, primary_key=True)
    site_id     = Column(String, ForeignKey("sites.id"), nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    category    = Column(String, default="일반")   # 일반 / 월간 / 분기
    text        = Column(String, nullable=False)
    done        = Column(Boolean, default=False)
    done_period = Column(String, default="")      # 완료한 주기: 월간 "YYYY-MM", 분기 "YYYY-Qn" (주기가 바뀌면 미완료로 간주)
    site        = relationship("Site", back_populates="checklists")

# ── 작업 이력 ─────────────────────────────────
class WorkLog(Base):
    __tablename__ = "worklogs"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=True)
    date        = Column(String, default="")
    site        = Column(String, default="")
    log_type    = Column(String, default="기타")
    title       = Column(String, nullable=False)
    body        = Column(Text, default="")
    engineer    = relationship("Engineer", back_populates="logs")

# ── 작업 계획 ─────────────────────────────────
class WorkPlan(Base):
    __tablename__ = "workplans"
    id            = Column(String, primary_key=True)
    engineer_id   = Column(String, ForeignKey("engineers.id"), nullable=True)
    title         = Column(String, nullable=False)
    work_date     = Column(String, default="")
    site          = Column(String, default="")
    worker        = Column(String, default="")
    reviewer      = Column(String, default="")
    purpose       = Column(Text, default="")
    impact        = Column(Text, default="")
    prerequisites = Column(Text, default="")
    mop_content   = Column(Text, default="")
    verification  = Column(Text, default="")
    rollback_plan = Column(Text, default="")
    status        = Column(String, default="계획중")
    support_type  = Column(String, default="기술지원")   # 기술지원/납품/유선원격/이전/기타 (주간보고서 열 구분)

# ── 장애처리 ─────────────────────────────────
class Incident(Base):
    __tablename__ = "incidents"
    id           = Column(String, primary_key=True)
    engineer_id  = Column(String, ForeignKey("engineers.id"), nullable=True)
    title        = Column(String, nullable=False)
    site         = Column(String, default="")        # 사이트명 (WorkPlan과 동일 방식)
    device       = Column(String, default="")        # 장애 장비/시스템
    severity     = Column(String, default="보통")    # 긴급/높음/보통/낮음
    status       = Column(String, default="접수")    # 접수/처리중/완료
    occurred_at  = Column(String, default="")        # 발생 일시 "YYYY-MM-DDTHH:MM"
    recovered_at = Column(String, default="")        # 복구 일시
    worker       = Column(String, default="")        # 처리자
    symptom      = Column(Text, default="")          # 장애 증상
    cause        = Column(Text, default="")          # 원인
    action       = Column(Text, default="")          # 조치 내용
    prevention   = Column(Text, default="")          # 재발 방지 대책
    created_at   = Column(String, default="")

class SessionToken(Base):
    __tablename__ = "sessions"
    id          = Column(String, primary_key=True)
    user_id     = Column(String, ForeignKey("users.id"), nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

# ── 프로젝트 관리 ───────────────────────────────
from sqlalchemy import Integer

class Project(Base):
    __tablename__ = "projects"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    name        = Column(String, nullable=False)
    customer    = Column(String, default="")
    start_date  = Column(String, default="")
    end_date    = Column(String, default="")
    status      = Column(String, default="진행 대기") # 진행 대기, 진행 중, 보류, 완료
    description = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.utcnow)
    
    tasks       = relationship("ProjectTask", back_populates="project", cascade="all, delete")
    files       = relationship("ProjectFile", back_populates="project", cascade="all, delete")

# 프로젝트 제출자료(완료보고서 등) 첨부 파일. 실제 파일은 uploads/<eng_id>/projects/<project_id>/<stored_name>
class ProjectFile(Base):
    __tablename__ = "project_files"
    id          = Column(String, primary_key=True)
    project_id  = Column(String, ForeignKey("projects.id"), nullable=False)
    category    = Column(String, default="기타")   # 완료보고서 / 검수확인서 / 구성도 / 회의록 / 기타
    filename    = Column(String, nullable=False)   # 올린 파일의 원래 이름
    stored_name = Column(String, nullable=False)   # 서버에 저장된 이름 (uuid + 확장자)
    size        = Column(Integer, default=0)       # 바이트
    note        = Column(String, default="")
    uploaded_at = Column(String, default="")       # "YYYY-MM-DD HH:MM"
    project     = relationship("Project", back_populates="files")

class ProjectTask(Base):
    __tablename__ = "project_tasks"
    id          = Column(String, primary_key=True)
    project_id  = Column(String, ForeignKey("projects.id"), nullable=False)
    name        = Column(String, nullable=False)
    status      = Column(String, default="대기") # 대기, 진행중, 완료
    start_date  = Column(String, default="")
    end_date    = Column(String, default="")
    order_idx   = Column(Integer, default=0)
    
    project     = relationship("Project", back_populates="tasks")

# ── 기술 노트 ─────────────────────────────────
class TechNote(Base):
    __tablename__ = "technotes"

    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    title       = Column(String, nullable=False)
    category    = Column(String, default="기타")
    tags        = Column(String, default="")
    body        = Column(Text, default="")
    created_at  = Column(String, default="")

def init_db():
    Base.metadata.create_all(bind=engine)
