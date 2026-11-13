# CLAUDE.md
Always respond and explain everything in Korean. (모든 대답과 설명은 무조건 한국어로 할 것)
SE Portal — 서버 엔지니어 업무 관리 포탈 (사이트/장비/점검일정/이슈/프로젝트/작업계획/기술노트).
단일 페이지(SPA) 프론트 + FastAPI REST 백엔드 + SQLite. Rocky Linux 9 / systemd + nginx 로 운영.

## 실행 / 운영

```bash
# 개발 실행 (venv 사용)
/opt/se-portal/venv/bin/python app.py                      # 0.0.0.0:8000
/opt/se-portal/venv/bin/python -m uvicorn app:app --reload  # 자동 리로드

# 운영 (systemd, User=appuser)
sudo systemctl restart se-portal
journalctl -u se-portal -f

# 라우트 목록 확인
/opt/se-portal/venv/bin/python query_routes.py
```

- 최초 설치: `cd /opt/se-portal && sudo bash install.sh` (python3.11, nginx, venv, SELinux 설정)
- nginx(80) → uvicorn(127.0.0.1:8000) 리버스 프록시, 업로드 한도 50MB (`se-portal.nginx.conf`)
- 테스트 프레임워크 없음. `test_*.py` 는 로직 확인용 단발 스크립트.

## 디렉토리 구조

```
app.py               FastAPI 진입점: 라우터 등록, /static 마운트, "/" → templates/index.html
database.py          SQLAlchemy 엔진/세션(get_db), 전체 ORM 모델, init_db()
routers/<도메인>.py   도메인별 APIRouter (auth, dashboard, sites, projects, logs,
                     schedules, issues, site_checklist, technotes, development, incidents)
templates/index.html SPA 전체 마크업 (모든 page-* 섹션과 modal-* 오버레이)
static/js/app.js     프론트 로직 전체 (바닐라 JS, 프레임워크 없음)
static/css/style.css 공통 스타일
data/portal.db       SQLite DB (git 제외)
data/portal-development.json  개발 체크리스트 (JSON 파일 저장소, git 추적)
uploads/             사이트 점검 보고서 업로드 파일 (git 제외)
```

## 메뉴 구성 (서비스 지원)
- **기술지원** (`page-work-plan`) = WorkPlan(작업계획서/MOP, 엑셀 다운로드). URL·테이블명은 `workplans` 그대로.
  - 기술지원 화면 등록분은 id `wp-*`. 점검일정 모달이 만드는 작업자/결재자/MOP 보관 레코드는 `id = Schedule.id` 이며
    기술지원 실적(목록·월별 이력·대시보드)에서 제외. `GET /workplans?scope=support(기본)|schedule|all`, 백엔드는 `support_only()` 사용.
- **장애처리** (`page-incidents`) = Incident 모델, `routers/incidents.py`.
- **월별 기술지원 및 장애처리 이력** (`page-service-history`) = 위 둘을 월 단위로 합쳐 보는 화면 (프론트에서 조합).
- 기존 "작업 현황/이력"(WorkLog, `/logs`) 메뉴와 "월간 보고서" 메뉴는 폐지. `/logs` API와 `worklogs` 테이블은 남아 있음.

## 아키텍처 규칙

### 백엔드
- **라우터 1파일 = 1도메인.** 새 라우터는 `routers/`에 만들고 `app.py`의 import 및 `app.include_router()`에 반드시 추가.
  (`routers/engineers.py`는 현재 등록되어 있지 않음.)
- **URL 규칙:** 엔지니어 소유 데이터는 `/api/engineers/{eng_id}/<리소스>` 하위에 둔다.
  모든 조회/수정/삭제 쿼리는 `engineer_id == eng_id` (또는 `_get_valid_site`로 소유 확인) 필터를 건다.
  예외: `/api/auth/*`, `/api/dev/*`.
- **라우터 작성 패턴** (`routers/issues.py`가 표준 예시):
  - `router = APIRouter(prefix=..., tags=[...])`
  - DB 세션은 `db: Session = Depends(get_db)`
  - 입력 스키마: 생성용 `XxxIn`(필수+기본값), 수정용 `XxxUpdate`(전부 Optional)
  - PATCH는 `data.dict(exclude_none=True)` 를 `setattr` 로 반영
  - 응답 직렬화는 모듈 내 `_xxx_dict(obj, ...)` 헬퍼로 dict 반환 (ORM 객체 직접 반환 금지)
  - 삭제/단순 처리 응답은 `{"ok": True}`, 없으면 `HTTPException(404)`
- **ID:** 모든 PK는 `str(uuid.uuid4())` 문자열.
- **날짜:** 대부분 `"YYYY-MM-DD"` 문자열 컬럼 (`created_at` 일부만 DateTime). 월 필터는 `startswith("YYYY-MM")`.
- **상태/구분 값은 한국어 문자열** — 기존 값과 정확히 일치시킬 것:
  - Schedule.status: 예정/완료, sched_type: 월간/분기/특별
  - Issue.severity: 긴급/높음/보통/낮음, status: 오픈/처리중/완료
  - Project.status: 진행 대기/진행 중/보류/완료, ProjectTask.status: 대기/진행중/완료
  - WorkPlan(기술지원).status: 계획중/결재대기/승인완료/작업완료
  - Incident(장애처리).severity: 긴급/높음/보통/낮음, status: 접수/처리중/완료
  - 개발 체크리스트 status: 예정/진행중/완료
- **사용자 메시지/에러 detail은 한국어.**
- **모델 추가/변경:** 모델은 모두 `database.py`에. `init_db()`는 `create_all`만 하므로
  **새 테이블은 자동 생성되지만 기존 테이블의 컬럼 추가/변경은 반영되지 않는다** → 수동 `ALTER TABLE` 필요.
  Site 하위 자식 모델은 `Site`에 `relationship(..., cascade="all, delete")` 추가.
- **인증:** 로그인 시 `SessionToken`을 DB에 저장하고 `session_id` httponly 쿠키 발급. 비밀번호는 SHA-256 (`hash_pw`).
  `get_current_user` 의존성은 현재 `/api/auth/me` 에만 적용됨 — 다른 API는 쿠키 검증 없이 `eng_id` 경로값만 신뢰한다.
- **엑셀 다운로드:** `openpyxl` + `StreamingResponse` (`routers/technotes.py` 작업계획 다운로드). 파일명은 `urllib.parse.quote`.
  `openpyxl`은 requirements.txt가 아닌 install.sh에서 설치됨.

### 프론트엔드 (SPA)
- 빌드 도구/프레임워크 없음. `index.html` 한 장 + `app.js` 전역 함수 방식.
- **화면 추가 절차:**
  1. `index.html` 사이드바에 `<div class="nav-item" data-page="xxx">` 추가
  2. `<div class="page" id="page-xxx">` 섹션 추가
  3. `app.js` NAV 핸들러에 `if(page==='xxx') renderXxx();` 추가
- 모달: `<div class="overlay" id="modal-xxx">` + `openModal(id)` / `closeModal(id)`.
- 헬퍼: `$(id)`, `api.get/post/patch/del`, `toast(msg)`, `renderPagination(...)` (PAGE_SIZE=5).
- 로그인 상태는 전역 `ENG_ID`, `ENG_NAME`; API URL은 `` `/api/engineers/${ENG_ID}/...` `` 형태.
- 함수 네이밍: `renderXxx` (목록 렌더), `openAddXxx`/`openEditXxx` (모달), `saveXxx`, `deleteXxx`.
- 외부 라이브러리는 CDN(cdnjs): marked(마크다운), highlight.js. JS 변경 후 캐시 무효화 필요 시 `app.js?v=N` 증가.

## 주의 사항
- `patch*.py`, `split_frontend.py`, `update_tasks.py`, `query_db*.py` 는 과거 일회성 수정 스크립트(절대경로 하드코딩) — 재실행 금지.
- `*_bk` 파일은 백업본. 수정 대상 아님.
- `data/portal.db`, `uploads/` 는 운영 데이터 — 삭제/덮어쓰기 금지.
- 파일 소유자는 `appuser`. root로 생성한 파일은 서비스가 쓰지 못할 수 있으니 권한 확인.
- 기본 브랜치: `main` (현재 작업 브랜치 `master`).
