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
- nginx(80→443 넘김, 443 HTTPS·자체 서명 인증서 `/etc/pki/nginx/se-portal.crt`) → uvicorn(127.0.0.1:8000, 외부 직접 접속 불가). 업로드 한도 50MB (`se-portal.nginx.conf`). `/docs`·`/openapi.json` 은 꺼져 있음.
- 테스트 프레임워크 없음. `test_*.py` 는 로직 확인용 단발 스크립트.

## 디렉토리 구조

```
app.py               FastAPI 진입점: 라우터 등록, /static 마운트, "/" → templates/index.html
database.py          SQLAlchemy 엔진/세션(get_db), 전체 ORM 모델, init_db()
routers/<도메인>.py   도메인별 APIRouter (auth, dashboard, sites, projects, logs,
                     schedules, issues, site_checklist, technotes, development, incidents, reports, gcal, entries, lab, remote)
templates/index.html SPA 전체 마크업 (모든 page-* 섹션과 modal-* 오버레이)
static/js/app.js     프론트 로직 전체 (바닐라 JS, 프레임워크 없음)
static/css/style.css 공통 스타일
data/portal.db       SQLite DB (git 제외)
data/secret.key      접속 비밀번호 암호화 키 (git 제외, 분실 시 복구 불가)
secure_store.py      암호화 도구 (Fernet)
data/portal-development.json  개발 체크리스트 (JSON 파일 저장소, git 추적)
data/report_templates/weekly_report.xlsx  주간보고서 엑셀 양식 (사용자 제공, routers/reports.py가 채움)
uploads/             업로드 파일 (git 제외): 사이트 점검 보고서 `<eng_id>/<site_id>/`, 프로젝트 제출자료 `<eng_id>/projects/<project_id>/`
```

## 메뉴 구성 (서비스 지원)
- **기술지원** (`page-work-plan`) = WorkPlan(작업계획서/MOP, 엑셀 다운로드). URL·테이블명은 `workplans` 그대로.
  - 기술지원 화면 등록분은 id `wp-*`. 점검일정 모달이 만드는 작업자/결재자/MOP 보관 레코드는 `id = Schedule.id` 이며
    기술지원 실적(목록·월별 이력·대시보드)에서 제외. `GET /workplans?scope=support(기본)|schedule|all`, 백엔드는 `support_only()` 사용.
- **점검 일정·기술지원 공통 입력 창** (`modal-add-workplan`, `openEntry`/`saveEntry`) = `routers/entries.py` (`/api/engineers/{eng_id}/entries`).
  구분 체크박스(점검/기술지원/납품/유선원격/이전/기타, 여러 개 가능). '점검'이 있으면 Schedule(+함께 한 지원은 `Schedule.extra_types`, 작업자·세부 작업계획은 id가 같은 WorkPlan 연동 레코드),
  없으면 WorkPlan(`wp-*`). 수정 중 '점검' 체크가 바뀌면 다른 표로 옮김. 주간보고서는 체크한 구분마다 해당 열에 1건.
  `GET /workplans`(scope=support)는 `extra_types`가 있는 점검 일정도 `from_schedule: true`로 함께 돌려준다.
- **장애처리** (`page-incidents`) = Incident 모델, `routers/incidents.py`.
- **월별 기술지원 및 장애처리 이력** (`page-service-history`) = 위 둘을 월 단위로 합쳐 보는 화면 (프론트에서 조합).
- **주간보고서** (`page-weekly-report`) = `routers/reports.py`. 주(월~일) 단위로 점검(완료)·기술지원(작업완료)·장애(발생)를 사이트+일자 1행으로 묶어 양식에 채움.
  양식 열: F 정기점검 / G 장애지원 / H~L 은 WorkPlan.support_type(기술지원/납품/유선원격/이전/기타).
- **구글 캘린더 연동** (`page-gcal`) = `routers/gcal.py`. 엔지니어별 iCal 비공개 주소(`calendar_links.url`, 암호화 저장)를 10분마다 읽어(`app.py`의 `_calendar_loop`)
  제목 `[종류] 고객사 - 엔지니어` 중 본인 이름이 든 일정만 점검 일정(Schedule)/기술지원(WorkPlan)으로 등록. `calendar_events`가 구글 일정↔포털 레코드 연결(중복 방지, 변경·삭제 반영, 완료 건은 보존).
  `calendar_links.start_date`(기본: 연동한 날) 이후 ~ 오늘+180일만 다룸. 포털에 같은 날·같은 사이트 건이 이미 있으면 새로 만들지 않고 연결(`adopted`, 구글에서 지워도 포털 건은 유지).
  종류·사이트를 못 정하면 '확인 대기'. 의존 패키지: `httpx`, `icalendar`, `recurring-ical-events`.
- **테스트서버 접속 정보** (`page-lab`, 시스템 메뉴) = `routers/lab.py` (`/api/engineers/{eng_id}/lab`). 서버(`lab_servers`: 분류·이름·OS·주소·메모) 1대에 계정(`lab_accounts`) 여러 개.
  비밀번호는 `secure_store`로 암호화 저장, 목록에는 내려주지 않고 `GET /lab/accounts/{id}/password`로만 돌려준다. 수정(PUT)은 계정 목록 통째로 교체(비밀번호 생략 = 기존 유지). **접속 정보는 DB에만 두고 코드·git에 넣지 말 것.**
- **테스트 서버 원격 접속** = `routers/remote.py` + `templates/remote.html`(새 탭 접속 화면, `/remote?c=<conn_id>&k=ssh|rdp`). 접속 대상은 `lab_conns`(kind 웹/SSH/RDP, `account_id`=쓸 계정) — `routers/lab.py`의 서버 저장(PUT/POST `conns`, 계정은 `account_idx`=같이 보낸 accounts 순번)으로 관리.
  - 웹 = 새 탭으로 주소 열기(포털 경유 아님). SSH = `asyncssh` ↔ WebSocket `/api/remote/{conn_id}/ssh` ↔ xterm.js. RDP = guacd(127.0.0.1:4822) ↔ WebSocket `/api/remote/{conn_id}/rdp`(부프로토콜 `guacamole`) ↔ guacamole-common-js.
  - **WebSocket 은 `require_login` 을 못 쓰므로 `remote.router` 는 `_LOGIN` 없이 등록하고 `_prepare()`가 세션 쿠키·Origin·소유를 직접 확인한다.** 비밀번호는 서버에서만 풀어 쓴다. 접속마다 `lab_access_logs` 기록(`GET /lab/logs`).
  - guacd 는 podman quadlet 서비스(`/etc/containers/systemd/guacd.container`, 저장소 사본 `guacd.container`; `systemctl status guacd`). nginx 는 `location /api/remote/` 에 Upgrade 헤더·긴 타임아웃 필요(`se-portal.nginx.conf`).
  - 브라우저 라이브러리는 `static/vendor/`(xterm 5.3.0, xterm-addon-fit 0.8.0, guacamole-common-js 1.5.0 — 끝의 `module.exports` 를 떼어 낸 것)에 직접 보관, CDN 아님.
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
  - Schedule.status: 예정/완료, sched_type: 월간/분기/특별 — 서버에서 값 검증. `POST /schedules/bulk`는 이전 달 일정 복사용(여러 건 등록, `copy_plan_from`으로 작업자/MOP 보관 레코드도 복사)
  - Issue.severity: 긴급/높음/보통/낮음, status: 오픈/처리중/완료
  - Project.status: 진행 대기/진행 중/보류/완료, ProjectTask.status: 대기/진행중/완료
  - ProjectFile(프로젝트 제출자료).category: 완료보고서/검수확인서/구성도/회의록/기타 — `routers/projects.py`의 `/{proj_id}/files` (업로드 50MB 제한, 프로젝트 삭제 시 폴더도 삭제)
  - WorkPlan(기술지원).status: 예정/완료 (점검 일정과 같음, 예전 4단계는 `init_db()`가 자동 변환), support_type: 기술지원/납품/유선원격/이전/기타 — 여러 개면 쉼표로 이어 씀
  - Incident(장애처리).severity: 긴급/높음/보통/낮음, status: 접수/처리중/완료
  - 개발 체크리스트 status: 예정/진행중/완료
  - SiteChecklist.category: 일반/월간/분기 — 월간·분기는 `done_period`("YYYY-MM"/"YYYY-Qn")가 현재 주기와 같을 때만 완료로 응답(주기 바뀌면 자동 초기화, `routers/site_checklist.py` `period_info`)
- **사용자 메시지/에러 detail은 한국어.**
- **모델 추가/변경:** 모델은 모두 `database.py`에. `init_db()`는 `create_all`만 하므로
  **새 테이블은 자동 생성되지만 기존 테이블의 컬럼 추가/변경은 반영되지 않는다** → 수동 `ALTER TABLE` 필요.
  Site 하위 자식 모델은 `Site`에 `relationship(..., cascade="all, delete")` 추가.
- **인증:** 로그인 시 `SessionToken`을 DB에 저장하고 `session_id` httponly 쿠키 발급(`routers/auth.py`).
  - `/api/auth/*` 외 모든 라우터는 `app.py`에서 `dependencies=[Depends(require_login)]`로 등록 — 로그인 필수 + 주소의 `eng_id`가 로그인한 본인이어야 함(아니면 403). **새 라우터도 같은 방식으로 등록할 것.**
  - 세션은 마지막 사용 후 30일(`SESSION_DAYS`)에 만료, 사용 중이면 하루 한 번 연장. 만료/미로그인 응답은 401 → 프론트가 로그인 화면으로 전환.
  - 비밀번호는 PBKDF2-SHA256(`hash_pw`/`verify_pw`). 예전 SHA-256 저장분은 로그인 성공 시 자동 교체. 최소 8자.
  - 로그인 5회 연속 실패 시 5분 잠금(메모리 보관, 재시작 시 초기화). 비밀번호 변경은 `POST /api/auth/password`(다른 세션 모두 종료).
  - `init_db()`의 `_ensure_column`이 `sessions.expires_at` 열을 자동 추가한다.
  - 쿠키는 HTTPS 요청이면 `Secure` 로 발급(nginx 의 `X-Forwarded-Proto`).
- **사이트 접속 비밀번호(Access.password)는 암호화 저장** — `secure_store.encrypt/decrypt`(Fernet, `cryptography`), 저장값은 `enc:v1:` 로 시작.
  키 파일은 `data/secret.key`(appuser 600, git 제외). **키를 잃으면 복구 불가 → DB 백업·이전 시 키 파일도 함께.** `init_db()`가 평문 저장분을 자동 암호화.
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
- `data/portal.db`, `data/secret.key`, `uploads/` 는 운영 데이터 — 삭제/덮어쓰기 금지.
- 파일 소유자는 `appuser`. root로 생성한 파일은 서비스가 쓰지 못할 수 있으니 권한 확인.
- 기본 브랜치: `main` (현재 작업 브랜치 `master`).
