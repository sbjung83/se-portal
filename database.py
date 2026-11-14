from sqlalchemy import create_engine, Column, String, Integer, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os, hashlib, hmac, secrets

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

# 비밀번호 저장: 솔트 + 반복 해시(PBKDF2-SHA256). 형식 "pbkdf2_sha256$반복수$솔트$해시"
PW_ITERATIONS = 310000

def hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), PW_ITERATIONS)
    return f"pbkdf2_sha256${PW_ITERATIONS}${salt}${dk.hex()}"

def verify_pw(pw: str, stored: str):
    """(일치 여부, 새 방식으로 다시 저장해야 하는지) 반환. 예전 SHA-256 저장분도 확인한다."""
    stored = stored or ""
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, it, salt, hx = stored.split("$")
            dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it))
        except ValueError:
            return False, False
        return hmac.compare_digest(dk.hex(), hx), int(it) != PW_ITERATIONS
    legacy = hashlib.sha256(pw.encode()).hexdigest()
    return hmac.compare_digest(legacy, stored), True

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
    extra_types = Column(String, default="")        # 점검과 함께 한 지원 구분(쉼표로 이어 씀): 기술지원/납품/유선원격/이전/기타
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
    status        = Column(String, default="예정")       # 예정 / 완료 (점검 일정과 같음)
    support_type  = Column(String, default="기술지원")   # 기술지원/납품/유선원격/이전/기타 — 여러 개면 쉼표로 이어 씀 (주간보고서 열 구분)

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

class LabServer(Base):
    """사내 테스트 서버 접속 정보 (routers/lab.py)."""
    __tablename__ = "lab_servers"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False, index=True)
    group_name  = Column(String, default="")       # 분류 (VMware, Proxmox ...)
    name        = Column(String, nullable=False)
    os          = Column(String, default="")       # OS / 버전
    address     = Column(Text, default="")         # IP·포트·주소 (여러 줄 가능)
    memo        = Column(Text, default="")
    order_idx   = Column(Integer, default=0)
    accounts    = relationship("LabAccount", back_populates="server", cascade="all, delete-orphan",
                               order_by="LabAccount.order_idx")
    conns       = relationship("LabConn", back_populates="server", cascade="all, delete-orphan",
                               order_by="LabConn.order_idx")

class LabAccount(Base):
    __tablename__ = "lab_accounts"
    id        = Column(String, primary_key=True)
    server_id = Column(String, ForeignKey("lab_servers.id"), nullable=False, index=True)
    label     = Column(String, default="")         # 용도 (OS, 웹 콘솔 ...)
    username  = Column(String, default="")
    password  = Column(String, default="")         # secure_store 로 암호화 (enc:v1:)
    order_idx = Column(Integer, default=0)
    server    = relationship("LabServer", back_populates="accounts")

class LabConn(Base):
    """테스트 서버 원격 접속 대상 (routers/lab.py 가 관리, routers/remote.py 가 접속)."""
    __tablename__ = "lab_conns"
    id         = Column(String, primary_key=True)
    server_id  = Column(String, ForeignKey("lab_servers.id"), nullable=False, index=True)
    kind       = Column(String, default="SSH")     # 웹 / SSH / RDP
    label      = Column(String, default="")        # 여러 대를 묶은 항목에서 구분용 (ESXi 1 ...)
    host       = Column(String, default="")        # 웹은 전체 주소(https://...), SSH·RDP 는 IP/호스트
    port       = Column(Integer, nullable=True)    # 비우면 기본 포트 (SSH 22, RDP 3389)
    account_id = Column(String, default="")        # 접속에 쓸 LabAccount.id (웹은 사용 안 함)
    order_idx  = Column(Integer, default=0)
    server     = relationship("LabServer", back_populates="conns")

class LabAccessLog(Base):
    """원격 접속 기록 (SSH·RDP)."""
    __tablename__ = "lab_access_logs"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, nullable=False, index=True)
    server_name = Column(String, default="")
    kind        = Column(String, default="")
    target      = Column(String, default="")       # host:port
    username    = Column(String, default="")
    client_ip   = Column(String, default="")
    started_at  = Column(String, default="")       # "YYYY-MM-DD HH:MM:SS" (서버 시각)
    ended_at    = Column(String, default="")
    result      = Column(String, default="")       # 접속 중 / 정상 종료 / 실패: 사유

class CalendarLink(Base):
    """엔지니어별 구글 캘린더 주소 (routers/gcal.py)"""
    __tablename__ = "calendar_links"
    engineer_id = Column(String, ForeignKey("engineers.id"), primary_key=True)
    url         = Column(Text, default="")          # iCal 비공개 주소 — secure_store 로 암호화 저장
    last_sync   = Column(String, default="")        # 마지막으로 읽은 시각 "YYYY-MM-DD HH:MM"
    last_result = Column(Text, default="")
    start_date  = Column(String, default="")        # 이 날짜 이후 일정만 가져온다 "YYYY-MM-DD"

class CalendarEvent(Base):
    """캘린더에서 가져온 일정과 포털 레코드의 연결 (중복 등록 방지, 변경·삭제 반영)"""
    __tablename__ = "calendar_events"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    event_key   = Column(String, nullable=False)    # 구글 일정 번호(반복 일정은 번호|날짜)
    summary     = Column(String, default="")        # 캘린더 제목 원문
    description = Column(Text, default="")          # 캘린더 일정의 설명 → 기술지원 '작업 목적' / 점검 일정 메모
    event_date  = Column(String, default="")        # "YYYY-MM-DD"
    customer    = Column(String, default="")
    workers     = Column(String, default="")
    kind        = Column(String, default="")        # 점검 / 기술지원
    sub_type    = Column(String, default="")        # 월간/분기/특별 또는 기술지원/납품/유선원격/이전/기타
    state       = Column(String, default="확인 대기")  # 등록 / 확인 대기 / 무시 / 포털에서 삭제
    reason      = Column(String, default="")
    site_id     = Column(String, default="")
    target_type = Column(String, default="")        # schedule / workplan
    target_id   = Column(String, default="")
    adopted     = Column(Boolean, default=False)    # 포털에 이미 있던 일정에 연결한 경우(구글에서 지워도 포털 건은 지우지 않음)

class SessionToken(Base):
    __tablename__ = "sessions"
    id          = Column(String, primary_key=True)
    user_id     = Column(String, ForeignKey("users.id"), nullable=False)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    expires_at  = Column(DateTime, nullable=True)   # 만료 시각(UTC). 비어 있으면 created_at 기준으로 계산

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

def _ensure_column(table: str, column: str, ddl: str):
    """기존 테이블에 열이 없으면 추가 (create_all은 열 추가를 하지 않음)."""
    with engine.begin() as conn:
        cols = [r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info({table})")]
        if column not in cols:
            conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_column("sessions", "expires_at", "DATETIME")
    _ensure_column("calendar_links", "start_date", "VARCHAR DEFAULT ''")
    _ensure_column("calendar_events", "adopted", "BOOLEAN DEFAULT 0")
    _ensure_column("calendar_events", "description", "TEXT DEFAULT ''")
    _ensure_column("schedules", "extra_types", "VARCHAR DEFAULT ''")
    _unify_workplan_status()
    _encrypt_access_passwords()

def _unify_workplan_status():
    """기술지원 상태를 점검 일정과 같은 2단계로: 작업완료 → 완료, 계획중/결재대기/승인완료 → 예정 (여러 번 실행해도 같음)."""
    with engine.begin() as conn:
        conn.exec_driver_sql("UPDATE workplans SET status='완료' WHERE status='작업완료'")
        conn.exec_driver_sql("UPDATE workplans SET status='예정' WHERE status IS NULL OR status NOT IN ('예정','완료')")

def _encrypt_access_passwords():
    """평문으로 남아 있는 사이트 접속 비밀번호를 암호화해 다시 저장 (이미 암호화된 행은 건너뜀)."""
    import secure_store
    db = SessionLocal()
    try:
        rows = [a for a in db.query(Access).filter(Access.password != "", Access.password.isnot(None)).all()
                if not secure_store.is_encrypted(a.password)]
        for a in rows:
            a.password = secure_store.encrypt(a.password)
        if rows:
            db.commit()
    finally:
        db.close()
