from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey
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
    is_admin    = Column(Boolean, default=False)   # 관리자: 개발 체크리스트 등 관리 메뉴 사용
    dept        = Column(String, default="")       # 부서 (회원 가입 때 입력)
    position    = Column(String, default="")       # 직급
    email       = Column(String, default="")
    approved    = Column(Boolean, default=True)    # 관리자 승인 여부. 가입 직후는 False(승인 대기) → 로그인 불가
    approved_at = Column(String, default="")       # 승인한 때 "YYYY-MM-DD HH:MM". 비어 있고 approved=False 면 승인 대기, 값이 있으면 사용 중지
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
    device_ids  = Column(String, default="")        # 대상 장비 id (쉼표로 이어 씀) — 장비별 이력
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
    device_ids    = Column(String, default="")           # 대상 장비 id (쉼표로 이어 씀) — 장비별 이력

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
    entry_id     = Column(String, default="")        # 함께 등록한 점검 일정/기술지원의 id (routers/entries.py). 비면 장애처리만 한 건
    parts        = Column(Text, default="")          # 사용(교체) 파트 JSON 목록: [{name, part_no, qty, old_sn, new_sn, note}]
    device_ids   = Column(String, default="")        # 대상 장비 id (쉼표로 이어 씀) — 장비별 이력

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

class LeaveRecord(Base):
    """휴가 사용 기록 = 휴가원 1장. 연차·월차만 연차에서 뺀다."""
    __tablename__ = "leave_records"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, nullable=False, index=True)
    leave_type  = Column(String, default="연차")    # 휴가원 양식의 종류 10가지 (routers/leaves.py LEAVE_TYPES)
    start_date  = Column(String, default="")       # "YYYY-MM-DD" (연도 집계 기준)
    end_date    = Column(String, default="")
    days        = Column(Float, default=1)         # 사용 일수 (반일 0.5)
    reason      = Column(String, default="")
    memo        = Column(Text, default="")
    apply_date  = Column(String, default="")       # 신청일 "YYYY-MM-DD" (휴가원 아래쪽 날짜)
    created_at  = Column(String, default="")       # "YYYY-MM-DD HH:MM"

class LicItem(Base):
    """라이선스 정책 설명 1건 (지식 창고 > 라이선스 정책, routers/licenses.py). 엔지니어 공용 데이터.
    기본 내용은 license_guide.py — 관리자가 화면에서 고치면 edited=True 가 되어 기본 내용으로 덮어쓰지 않는다."""
    __tablename__ = "lic_items"
    key        = Column(String, primary_key=True)
    category   = Column(String, default="")
    sort       = Column(Integer, default=0)
    name       = Column(String, default="")
    vendor     = Column(String, default="")
    summary    = Column(Text, default="")
    body       = Column(Text, default="")          # 마크다운
    sources    = Column(Text, default="[]")        # [{"label","url","watch"}]
    edited     = Column(Boolean, default=False)
    updated_at = Column(String, default="")
    updated_by = Column(String, default="")

class LicWatch(Base):
    """라이선스 근거 페이지 1개 — 하루 한 번 읽어 글자가 바뀌면 변경 감지 (내용을 고치지는 않음)."""
    __tablename__ = "lic_watch"
    id         = Column(String, primary_key=True)
    item_key   = Column(String, index=True)
    url        = Column(String, default="")
    label      = Column(String, default="")
    digest     = Column(String, default="")        # 정리한 글자(또는 PDF 파일)의 sha256
    text       = Column(Text, default="")          # 마지막으로 읽은 정리된 글자 (PDF 는 빈 값)
    prev_text  = Column(Text, default="")          # 바뀌기 전 글자 (바뀐 부분 보기용)
    checked_at = Column(String, default="")        # 마지막 시도 "YYYY-MM-DD HH:MM:SS"
    ok_at      = Column(String, default="")        # 마지막 성공
    changed_at = Column(String, default="")        # 마지막으로 바뀐 것을 감지한 때
    acked      = Column(Boolean, default=True)     # False = 변경 감지 후 아직 아무도 확인 안 함
    acked_by   = Column(String, default="")
    error      = Column(String, default="")        # 마지막 시도 실패 사유

class NotifySetting(Base):
    """아침 알림 (엔지니어당 1건): 메신저 웹훅으로 그날 확인할 것을 보낸다 (routers/notify.py)."""
    __tablename__ = "notify_settings"
    engineer_id   = Column(String, primary_key=True)
    enabled       = Column(Boolean, default=False)
    webhook       = Column(Text, default="")          # 웹훅 주소 (secure_store 로 암호화)
    send_time     = Column(String, default="08:00")   # 보낼 시각 HH:MM
    weekdays_only = Column(Boolean, default=True)     # 평일(월~금)만
    last_sent     = Column(String, default="")        # 마지막으로 보낸 날 YYYY-MM-DD (하루 한 번)
    last_result   = Column(String, default="")        # 마지막 결과 ("YYYY-MM-DD HH:MM 성공" / 오류 내용)
    mention       = Column(String, default="")        # 메시지 맨 앞 멘션 (핸드폰 알림용): Slack 멤버 ID U… / @channel / @here

class LeaveProfile(Base):
    """휴가원에 들어가는 내 정보 (엔지니어당 1건). 비어 있는 값은 양식에 적힌 그대로 둔다."""
    __tablename__ = "leave_profiles"
    engineer_id = Column(String, primary_key=True)
    dept        = Column(String, default="")
    position    = Column(String, default="")
    name        = Column(String, default="")

class CarProfile(Base):
    """차량 운행 일지 기본값 (엔지니어당 1건): 한 번 넣으면 다음부터 그대로 쓴다."""
    __tablename__ = "car_profiles"
    engineer_id = Column(String, primary_key=True)
    car_model   = Column(String, default="")
    car_no      = Column(String, default="")
    start_place = Column(String, default="회사")
    driver_name = Column(String, default="")       # 성명 기본값 (비면 로그인 이름)
    biz_no      = Column(String, default="")       # 사업자등록번호 (양식 E3)

class ExpenseProfile(Base):
    """개인 경비 기본값 (엔지니어당 1건): 마지막으로 저장한 신청자·법인카드 번호 (routers/expenses.py)."""
    __tablename__ = "expense_profiles"
    engineer_id = Column(String, primary_key=True)
    applicant   = Column(String, default="")
    card_no     = Column(String, default="")       # secure_store 로 암호화 (enc:v1:)

class ExpenseReport(Base):
    """개인 경비 정산 내역서 1장 = 엔지니어별 한 달."""
    __tablename__ = "expense_reports"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False, index=True)
    month       = Column(String, nullable=False)   # "YYYY-MM"
    title       = Column(String, default="")
    applicant   = Column(String, default="")
    card_no     = Column(String, default="")       # secure_store 로 암호화

class EosProduct(Base):
    """OS EOS 현황 — 제품 1개 (routers/eos.py 의 PRODUCTS 목록을 갱신 때마다 맞춘다). 엔지니어 공용 데이터."""
    __tablename__ = "eos_products"
    key         = Column(String, primary_key=True)   # endoflife.date 제품 이름 또는 hyperv / hp-ux
    label       = Column(String, default="")
    category    = Column(String, default="")         # Windows / Linux / Unix / 가상화
    source      = Column(String, default="")         # endoflife / microsoft / manual
    policy_link = Column(String, default="")         # 제조사 공식 수명 주기 페이지
    terms       = Column(Text, default="{}")         # 제품별 용어 {"eoas": "Full Support", ...}
    note        = Column(String, default="")
    order_idx   = Column(Integer, default=0)
    checked_at  = Column(String, default="")         # 마지막으로 갱신을 시도한 때 "YYYY-MM-DD HH:MM:SS"
    fetched_at  = Column(String, default="")         # 마지막으로 성공한 때
    error       = Column(String, default="")         # 마지막 시도가 실패했으면 사유

class EosRelease(Base):
    """OS EOS 현황 — 버전 1개. 날짜 칸: "YYYY-MM-DD" / "Y"(종료, 날짜 모름) / "N"(미발표) / ""(해당 없음)."""
    __tablename__ = "eos_releases"
    id           = Column(String, primary_key=True)  # "<제품>:<버전>"
    product      = Column(String, nullable=False, index=True)
    cycle        = Column(String, default="")
    label        = Column(String, default="")
    lts          = Column(Boolean, default=False)
    release_date = Column(String, default="")
    eoas         = Column(String, default="")        # 일반(Active/Full) 지원 종료
    eol          = Column(String, default="")        # 지원 종료 (보안 업데이트 끝)
    eoes         = Column(String, default="")        # 연장 지원 종료 (유료)
    latest       = Column(String, default="")
    link         = Column(String, default="")
    note         = Column(String, default="")
    order_idx    = Column(Integer, default=0)
    changes      = Column(Text, default="{}")        # {"eol": {"old": ..., "new": ..., "at": "YYYY-MM-DD"}}
    added_at     = Column(String, default="")        # 처음 받은 뒤 새로 생긴 버전이면 그 날짜

class ExpenseItem(Base):
    __tablename__ = "expense_items"
    id          = Column(String, primary_key=True)
    report_id   = Column(String, ForeignKey("expense_reports.id"), nullable=False, index=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False, index=True)
    spend_date  = Column(String, default="")       # "YYYY-MM-DD"
    vendor      = Column(String, default="")       # 거래처
    content     = Column(String, default="")       # 지출내용
    card_amount = Column(Integer, default=0)       # 법인카드
    cash_amount = Column(Integer, default=0)       # 현금(개인카드)
    note        = Column(String, default="")       # 비고
    order_idx   = Column(Integer, default=0)

class CarRepair(Base):
    """법인차량 점검 품의서 = 정비 이력 1건 (routers/carrepair.py)."""
    __tablename__ = "car_repairs"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, ForeignKey("engineers.id"), nullable=False, index=True)
    doc_date    = Column(String, default="")       # 작성일 "YYYY-MM-DD"
    car_no      = Column(String, default="")
    title       = Column(String, default="")       # 거래내역
    vendor      = Column(String, default="")       # 정비처
    pay_terms   = Column(String, default="")       # (쓰지 않음) 대금지급조건 — 품의서에 기입하지 않는다
    due_date    = Column(String, default="")       # (쓰지 않음) 입고(예정)일
    odometer    = Column(Integer, nullable=True)   # 정비 때 주행거리 km
    note        = Column(Text, default="")         # 특기사항
    items       = Column(Text, default="[]")       # 품목 JSON [{name, price(부가세 별도 단가), qty}]
    created_at  = Column(String, default="")

class CarMonth(Base):
    """운행 일지 한 달: 그 달 첫 출발 때의 계기판 km. 각 운행의 출발·도착 km 는 여기서부터 거리를 이어 붙여 계산한다."""
    __tablename__ = "car_months"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, nullable=False, index=True)
    ym          = Column(String, nullable=False)   # "YYYY-MM"
    start_km    = Column(Integer, nullable=True)
    imported    = Column(Boolean, default=False)   # 일정을 한 번 자동으로 가져왔는지

class CarTrip(Base):
    """운행 1건 (운행 일지의 한 줄)."""
    __tablename__ = "car_trips"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, nullable=False, index=True)
    trip_date   = Column(String, nullable=False)   # "YYYY-MM-DD"
    start_place = Column(String, default="회사")
    purpose     = Column(String, default="")       # 운행목적(거래처명)
    km          = Column(Integer, default=0)       # 이 운행의 주행 거리
    note        = Column(String, default="")
    driver      = Column(String, default="")       # 이 줄만 다른 성명 (비면 기본 성명)
    src         = Column(String, default="")       # 일정에서 가져온 건: "sched:<id>" / "wp:<id>"
    created_at  = Column(String, default="")       # "YYYY-MM-DD HH:MM:SS" (같은 날 안에서의 순서)

class LeaveQuota(Base):
    """연도별 총 연차 일수 (없으면 15일로 본다)."""
    __tablename__ = "leave_quotas"
    id          = Column(String, primary_key=True)
    engineer_id = Column(String, nullable=False, index=True)
    year        = Column(String, nullable=False)   # "YYYY"
    total_days  = Column(Float, default=15)

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
    _ensure_column("leave_records", "apply_date", "VARCHAR DEFAULT ''")
    _ensure_column("users", "is_admin", "BOOLEAN DEFAULT 0")
    _ensure_column("incidents", "entry_id", "VARCHAR DEFAULT ''")
    _ensure_column("incidents", "parts", "TEXT DEFAULT ''")
    _ensure_column("notify_settings", "mention", "VARCHAR DEFAULT ''")
    for t in ("schedules", "workplans", "incidents"):
        _ensure_column(t, "device_ids", "VARCHAR DEFAULT ''")
    _ensure_column("car_profiles", "driver_name", "VARCHAR DEFAULT ''")
    _ensure_column("car_profiles", "biz_no", "VARCHAR DEFAULT ''")
    _ensure_column("car_trips", "driver", "VARCHAR DEFAULT ''")
    for col in ("dept", "position", "email", "approved_at"):
        _ensure_column("users", col, "VARCHAR DEFAULT ''")
    _ensure_column("users", "approved", "BOOLEAN DEFAULT 1")     # 기존 계정은 승인된 것으로 둔다
    _ensure_admin()
    _unify_workplan_status()
    _encrypt_access_passwords()

def _ensure_admin():
    """관리자가 한 명도 없으면 가장 먼저 가입한 계정을 관리자로 둔다 (여러 번 실행해도 같음)."""
    with engine.begin() as conn:
        if conn.exec_driver_sql("SELECT COUNT(*) FROM users WHERE is_admin = 1").scalar():
            return
        first = conn.exec_driver_sql("SELECT id FROM users ORDER BY created_at LIMIT 1").scalar()
        if first:
            conn.exec_driver_sql("UPDATE users SET is_admin = 1 WHERE id = ?", (first,))

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
