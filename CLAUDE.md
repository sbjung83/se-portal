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
                     schedules, issues, site_checklist, technotes, development, incidents, reports, gcal, entries, lab, remote, leaves, carlog, notify)
eos_match.py         장비 OS 칸(자유 입력) → OS별 EOS 현황 제품·버전 맞추기 (sites·dashboard·notify 가 씀)
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
- **점검 일정·기술지원·장애처리 공통 입력 창** (`modal-add-workplan`, `openEntry`/`saveEntry`) = `routers/entries.py` (`/api/engineers/{eng_id}/entries`).
  구분 체크박스(점검/기술지원/장애처리/납품/유선원격/이전/기타, 여러 개 가능). '점검'이 있으면 Schedule(+함께 한 지원은 `Schedule.extra_types`, 작업자·세부 작업계획은 id가 같은 WorkPlan 연동 레코드),
  없으면 WorkPlan(`wp-*`). 수정 중 '점검' 체크가 바뀌면 다른 표로 옮김. 주간보고서는 체크한 구분마다 해당 열에 1건.
  `GET /workplans`(scope=support)는 `extra_types`가 있는 점검 일정도 `from_schedule: true`로 함께 돌려준다.
  - 구분 **'장애처리'**를 체크하면 창 아래 탭(`세부 작업계획` / `장애처리 보고서`, `entryTab()`)에 보고서 탭이 생기고 Incident 가 함께 저장된다.
    점검/기술지원과 같이 고르면 `Incident.entry_id` = 그 일정 id, 장애처리만 고르면 Incident 1건만(일정 id = 장애 id, `kind: "incident"`).
    `GET /entries/{id}`는 장애 id 를 줘도 연결된 일정을 찾아 준다. 체크를 풀고 저장하면 보고서(Incident)는 삭제. 일정만 지우면 장애 기록은 단독으로 남는다.
    **상태는 하나**: '장애처리'를 체크하면 창의 상태 칸이 접수/처리중/완료가 되고(`inc_status`), 일정 쪽 status 는 완료일 때만 '완료'(그 외 '예정'). 점검 일정·기술지원 목록에서 완료 체크를 바꾸면(`PATCH /schedules|workplans/{id}` status) `incidents.sync_entry_status`가 연결된 장애도 완료 / (완료였으면) 처리중으로 바꾼다.
    장애처리만 체크하면 위의 날짜·시간이 발생 일시(따로 받지 않음). 창 제목은 구분에 따라 '점검 일정 / 기술지원 / 장애 등록·수정'.
  - **세 목록(점검 일정·기술지원·장애처리) 공통 형식** (`app.js` `_svcCols`/`_svcActs`/`_svcDate`/`_svcKind`/`_svcOthers`): 열 = 날짜 / 사이트 / 제목(+아래 작은 글씨 상세) / 구분 / 작업자 / [장애 시간] / 상태 / 관리. 관리 칸은 [Excel][수정][삭제] 자리를 늘 같게(없는 버튼은 숨긴 자리). 요약 카드 클릭 = 조건 필터, 줄 클릭 = 수정 창, 날짜 오름차순, 지연(장애는 '미처리') D+n. 구분 칸에는 함께 등록된 구분도 같은 이름으로 표시(`_svcKind`: 점검=청록 `b-k-check` / 지원 구분=보라 / 장애처리=분홍 `b-k-inc`). 점검·기술지원 쪽 '장애처리'는 `_loadIncLinks`, 장애 쪽은 `GET /incidents` 의 `entry_types`(연결된 일정의 구분). 툴바의 '다른 달 지연/미완료 n건 →'(`_svcOthers`, 점검 일정은 보고 있는 해 안에서만). 툴바의 'YYYY년 M월'은 `label.sv-month` 안의 숨은 `<input type=month id=sm-ym|wp-ym|inc-ym>`(서비스 지원 이력 `svh-month`와 같은 방식, change → `smGo`/`wpGo`/`incGo`, draw 함수가 value 를 맞춤). month 입력을 지원하지 않는 브라우저(Firefox)는 숨기고 ◀ ▶ 로만.
- **장애처리** (`page-incidents`) = Incident 모델, `routers/incidents.py`. `GET /incidents/{id}/report` = 장애처리 보고서 엑셀(`build_incident_workbook`, 양식 파일 없이 코드로 그림: 개요 / 증상·원인·조치 / 사용 파트 / 재발 방지). 보고서의 **사용 파트**는 `incidents.parts`(JSON 목록: 파트명 `name`·Part No. `part_no`·수량 `qty`·제거 S/N `old_sn`·장착 S/N `new_sn`·비고 `note`, 정리는 `clean_parts`/`load_parts`). 공통 입력 창은 `inc_parts`로 보내고, 안 보내면 기존 값 유지. 목록 검색·서비스 지원 이력 검색에 파트명·Part No.·S/N 포함. 등록·수정 창은 따로 없고 공통 입력 창을 쓴다(`openAddIncident`/`openEditIncident` → `openEntry`). 목록·삭제·주간보고서 집계는 `incidents` 표 그대로.
- **서비스 지원 이력** (`page-service-history`) = 점검·기술지원·장애처리를 월 단위로 합쳐 보는 화면 (프론트에서 조합). 검색어를 넣으면 그 해 전체에서 찾는다. 예전 "점검 이력" 화면과 "점검 일정" 메뉴 그룹은 없앴고(`GET /schedules/history` API 는 남아 있음), **점검**(`page-schedule-mgmt`, 메뉴·화면 이름은 '점검', 코드·문서에서는 점검 일정)은 서비스 지원 그룹 맨 위에 있다.
- **주간보고서** (`page-weekly-report`) = `routers/reports.py`. 주(월~일) 단위로 점검(완료)·기술지원(작업완료)·장애(발생)를 사이트+일자 1행으로 묶어 양식에 채움.
  양식 열: F 정기점검 / G 장애지원 / H~L 은 WorkPlan.support_type(기술지원/납품/유선원격/이전/기타).
  화면 제목은 'YYYY년 M월 n주차'(**월요일 기준**: 그 주 월요일이 든 달의 n번째 월요일, `_wrWeekNo`). 누르면 `#wr-pick` 고르기 창(해 ◀ ▶ / 12개월 / 주차 목록) — 주차 목록·건수는 `GET /reports/weekly/weeks?month=YYYY-MM`(주마다 `build_weekly` 의 total), ✎ = 특이·확정사항을 직접 고친 주(localStorage `wrTexts`).
  확정사항 기본값 = 다음 주(월~일)의 점검·기술지원(`wp-*`)·장애처리, 한 줄 `n. [구분·구분] 사이트 : 제목 (M/D)`. 일정과 함께 등록한 장애는 그 일정 줄 구분에 '장애처리'만 붙인다.
- **구글 캘린더 연동** (`page-gcal`) = `routers/gcal.py`. 엔지니어별 iCal 비공개 주소(`calendar_links.url`, 암호화 저장)를 10분마다 읽어(`app.py`의 `_calendar_loop`)
  제목 `[종류] 고객사 - 엔지니어` 중 본인 이름이 든 일정만 점검 일정(Schedule)/기술지원(WorkPlan)으로 등록. `calendar_events`가 구글 일정↔포털 레코드 연결(중복 방지, 변경·삭제 반영, 완료 건은 보존).
  `calendar_links.start_date`(기본: 연동한 날) 이후 ~ 오늘+180일만 다룸. 포털에 같은 날·같은 사이트 건이 이미 있으면 새로 만들지 않고 연결(`adopted`, 구글에서 지워도 포털 건은 유지).
  `[장애처리]` = Incident(접수·보통, 발생일=일정 날짜, 설명→증상, `target_type='incident'`). `[점검/장애처리]`·`[기술지원 및 장애처리]`는 그 일정 + `entry_id`로 연결된 Incident(`classify()` 네 번째 값). 구글에서 지워질 때 `_inc_in_use`(상태가 접수가 아니거나 원인·조치·파트 등 입력)인 장애는 지우지 않고 남긴다(연결 장애는 `entry_id`만 비움). 공통 입력 창에서 구분을 바꾸면 `calendar_events` 연결도 새 레코드(장애 포함)로 옮긴다.
  종류·사이트를 못 정하면 '확인 대기'. 의존 패키지: `httpx`, `icalendar`, `recurring-ical-events`.
- **사내 테스트서버** (`page-lab`, 시스템 메뉴) = `routers/lab.py` (`/api/engineers/{eng_id}/lab`). 서버(`lab_servers`: 분류·이름·OS·주소·메모) 1대에 계정(`lab_accounts`) 여러 개.
  비밀번호는 `secure_store`로 암호화 저장, 목록에는 내려주지 않고 `GET /lab/accounts/{id}/password`로만 돌려준다. 수정(PUT)은 계정 목록 통째로 교체(비밀번호 생략 = 기존 유지). **접속 정보는 DB에만 두고 코드·git에 넣지 말 것.**
- **결재 문서 관리** (`page-docs`, 사이드바 '결재 문서' 그룹 — 서비스 지원 아래) = 한 페이지에 문서 종류마다 탭 1개: 휴가원 / 차량 운행 일지 / 법인차량 점검 품의서 / 개인 경비. **문서 종류가 늘면 메뉴를 늘리지 말고 탭(`doc-tabs` 버튼 + `doc-pane-<키>` + `app.js`의 `DOC_TABS`)을 추가한다.** 탭 위 '2026년'/'2026년 11월' 글자는 `ymPick(el, cur, cb)`(cur 'YYYY'=년도만, 'YYYY-MM'=년도·월; body 에 붙는 `.wr-pick.ym-pop` 창, 브라우저 무관) — 다른 화면에서 년도·월 고르기가 필요하면 이것을 쓴다. **양식 파일은 화면에서 올리지 않고 서버의 `data/doc_templates/`에 직접 둔다** (실명이 들어 있어 git 제외).
  - **법인차량 점검 품의서** = `routers/carrepair.py` (`/api/engineers/{eng_id}/carrepairs`, 연도별 `?year=`). 저장 1건 = 정비 이력 1건(`car_repairs`, 품목은 `items` JSON: 품명·단가(부가세 별도)·수량). `GET /{id}/document`가 `data/doc_templates/car_repair.xlsx`에 채워 내려준다(칸 위치는 모듈 docstring, 대금지급조건·입고(예정)일은 기입하지 않음, 품목 16~21행 6줄, 특기사항 25~33행, 금액·소계·계·매입금액은 양식 수식). 담당 칸의 부서·직급·성명은 휴가원 내 정보(`leave_profiles`)를 쓴다. `car_repair.xlsx`는 사용자가 올린 `법인차량 점검_품의서.xlsx`에서 입력 칸을 비우고 G16~G21·D10을 수식으로 바꿔 만든 것.
  - **개인 경비** = `routers/expenses.py` (`/api/engineers/{eng_id}/expenses`, 월 단위 `?month=YYYY-MM`). `expense_reports`(그 달 제목·신청자·카드 번호) + `expense_items`(날짜·거래처·지출내용·법인카드/현금 금액·비고, 칸을 고치면 바로 PATCH). 신청자·카드 번호는 저장할 때마다 `expense_profiles`에 남아 새 달의 기본값이 된다(달마다 수정 가능). **카드 번호는 `secure_store`로 암호화 저장**, 양식(`data/doc_templates/expense.xlsx`, 6~38행 33줄)에는 끝 4자리만 `법인카드\n(1234)`로 넣는다. 날짜 칸은 엑셀 날짜 숫자로 써서 양식 서식(mm-dd-yy)을 그대로 쓴다.
  - **휴가원** = `routers/leaves.py` (`/api/engineers/{eng_id}/leaves`). 화면에서 종류·기간·일수·사유·신청일만 받아 `leave_records`에 저장 → 연차 사용 내역 목록 → `GET /{id}/document`가 `data/doc_templates/leave.docx`에 값을 채워 내려준다.
    채우기는 `build_leave_doc()`: 양식에 적힌 글자(부서·직위·성명·사유 칸, "부터"/"까지"/"일간", `종류( )`)로 자리를 찾으므로 **양식을 바꾸면 이 함수도 확인할 것.** `doc_fill.py`가 워드 XML의 글자만 고쳐 서식을 그대로 둔다(`lxml` 필요).
    leave_type: 연차/월차/생리휴가/경조휴가/공가/병가/조퇴/결근/대체휴무/기타 (양식의 번호 순). **연차·월차만 연차에서 뺀다.** `leave_quotas` = 연도별 총 연차(없으면 15일), `leave_profiles` = 휴가원에 넣을 부서·직위·성명(비면 양식 그대로, 성명은 로그인 이름). 연도는 기간 시작일 기준. 일수는 평일 수로 자동 계산(공휴일 모름).
  - **차량 운행 일지** = `routers/carlog.py` (`/api/engineers/{eng_id}/carlog`, 월 단위 `?month=YYYY-MM`). `car_profiles`(기본 정보: 성명·차종·차량번호·기본 출발지·사업자등록번호(양식 E3) — 한 번 넣으면 계속 쓰고 언제든 수정, 성명은 비면 로그인 이름), `car_months`(그 달 첫 출발 km), `car_trips`(운행 1줄: 일자·성명(`driver`, 비면 기본 성명)·출발지·운행목적·**거리 km**). 줄의 출발·도착 km 는 저장하지 않고 첫 출발 km 에서 거리를 이어 붙여 계산한다(지난달 마지막 값이 다음 달 첫 값).
    처음 여는 달은 점검 일정 + 기술지원(`wp-*`, 유선원격만 한 건 제외)을 운행 줄로 자동으로 가져온다(`src`로 중복 방지, `POST /import`로 다시). `POST /distribute {start_km, end_km}`는 그 사이 거리를 거래처별 다른 달 평균 거리 비율로 나눠 채운다(기록이 없으면 균등). `GET /download`는 `data/doc_templates/car_log.xlsx`(운행 줄 11~296행, F35~ 수식은 유지)에 써넣는다.
- **테스트 서버 원격 접속** = `routers/remote.py` + `templates/remote.html`(새 탭 접속 화면, `/remote?c=<conn_id>&k=ssh|rdp`). 접속 대상은 `lab_conns`(kind 웹/SSH/RDP, `account_id`=쓸 계정) — `routers/lab.py`의 서버 저장(PUT/POST `conns`, 계정은 `account_idx`=같이 보낸 accounts 순번)으로 관리.
  - 웹 = 새 탭으로 주소 열기(포털 경유 아님). SSH = `asyncssh` ↔ WebSocket `/api/remote/{conn_id}/ssh` ↔ xterm.js. RDP = guacd(127.0.0.1:4822) ↔ WebSocket `/api/remote/{conn_id}/rdp`(부프로토콜 `guacamole`) ↔ guacamole-common-js.
  - **WebSocket 은 `require_login` 을 못 쓰므로 `remote.router` 는 `_LOGIN` 없이 등록하고 `_prepare()`가 세션 쿠키·Origin·소유를 직접 확인한다.** 비밀번호는 서버에서만 풀어 쓴다. 접속마다 `lab_access_logs` 기록(`GET /lab/logs`).
  - guacd 는 podman quadlet 서비스(`/etc/containers/systemd/guacd.container`, 저장소 사본 `guacd.container`; `systemctl status guacd`). nginx 는 `location /api/remote/` 에 Upgrade 헤더·긴 타임아웃 필요(`se-portal.nginx.conf`).
  - **접속 중 감시**(`remote.py` `_watch`): 1분마다 포털 로그인(세션·승인 상태)을 다시 확인해 무효면 끊고(로그아웃·비밀번호 변경·사용 중지 즉시 반영), 키보드·마우스 입력이 30분(`IDLE_LIMIT`) 없으면 끊는다. RDP 는 `key`/`mouse` 명령만 입력으로 친다(sync 응답 제외).
  - **접속 대상 제한**(`blocked_target`): 루프백·컨테이너 내부망(podman0 10.88.0.0/16 등)·링크 로컬·멀티캐스트는 저장(lab.py)과 접속(remote.py, 이름을 풀어 확인) 모두 거부. 서버 자신의 LAN IP(10.10.10.241)로 SSH 하는 것은 허용.
  - 비밀번호 보기·복사(`GET /lab/accounts/{id}/password`)도 `lab_access_logs`에 kind '비밀번호 보기'로 남는다. 관리자는 `GET /lab/logs/all`(화면의 '모든 엔지니어의 기록 보기')로 전체 기록을 본다.
  - nginx 443 에 `X-Frame-Options SAMEORIGIN`·`X-Content-Type-Options nosniff`·`Referrer-Policy same-origin`. HSTS 는 자체 서명 인증서라 넣지 않는다(인증서 경고를 넘길 수 없게 되어 접속이 막힘).
  - 브라우저 라이브러리는 `static/vendor/`(xterm 5.3.0, xterm-addon-fit 0.8.0, guacamole-common-js 1.5.0 — 끝의 `module.exports` 를 떼어 낸 것)에 직접 보관, CDN 아님.
- **OS별 EOS 현황** (`page-eos`, 지식 창고 그룹) = `routers/eos.py` (`/api/eos` — 엔지니어 공용 데이터라 `eng_id` 없음, 로그인만 필요).
  OS·버전별 일반 지원 종료(`eoas`)·지원 종료(`eol`)·연장 지원 종료(`eoes`)를 `eos_products`/`eos_releases`에 저장. 대상 제품은 모듈의 `PRODUCTS`(분류 Windows/Linux/Unix/가상화/IBM — IBM 탭은 PowerVM(VIOS)·HMC·PowerVC, AIX 는 Unix). 탭은 API 의 `categories` 순서대로 화면에 생긴다.
  자료: endoflife.date v1 API(대부분) / Microsoft 수명 주기 페이지 직접 파싱(Hyper-V Server, 종료 시각이 오전이면 전날) / IBM FLRT JSON(`FLRT`: HMC·PowerVM(VIOS) — 레벨을 릴리스(V R / x.y.z)로 묶어 출시일 = 가장 이른 ga, 지원 종료 = 가장 늦은 EoSPS, 'NA'=미발표) / IBM PowerVC Lifecycle Information 페이지 표 파싱(`_fetch_powervc`: 2.3.x 등 릴리스별 EoSPS→eoas, EOS→eol) / `MANUAL`(HP-UX — HPE 사이트를 서버에서 못 읽어 직접 입력, 자동 갱신 안 됨).
  `app.py`의 `_eos_loop`가 1시간마다 `refresh_due()`(마지막 성공 24시간 전 + 마지막 시도 1시간 전)를 보고 갱신. 실패한 제품은 이전 값 유지·`error` 표시. 날짜가 바뀌면 `changes`에 이전 값(화면 '변경' 30일), 새 버전은 `added_at`('신규').
  날짜 칸 값: "YYYY-MM-DD" / "Y"(종료, 날짜 모름) / "N"(미발표) / ""(해당 없음). '지금 갱신'(`POST /api/eos/refresh`)은 5분 간격 제한.
- **사이트 관리** (`page-sites`, `renderSites`/`drawSites`) = `routers/sites.py`. 목록 칸: 사이트 / 위치 / 담당자 / 연락처 / 장비 / 이번 달 점검(`month_sched` → `_stMonth`) / 확인할 것 / 관리. 상세 창(`modal-site-detail`, `openSiteDetail`)
  탭 = 개요 / 장비 리스트 / 접속 정보 / 점검표 파일 / 특이사항. 탭 이름 옆 건수는 `_siteTabCnt(key, n)`(`tcnt-*`). 장비·접속 정보·점검표 파일·특이사항은 같은 형식: 위 `dev-bar`(검색 칸 + 추가 버튼) + `dev-tbl` 표(`load*`가 받아 `draw*`가 검색 반영해 그림), 줄 클릭 = 수정 창, 관리 칸은 `dev-act`(표 칸 그대로, flex 금지 — 여러 줄 행에서 구분선이 어긋남).
  개요 카드는 `ov-card` + 대시보드 색 변수(`dc-week`/`dc-issue`/`dc-cl`/`dc-proj`/`dc-warr`). '최근 기술지원 · 장애처리'는 `_svcKind`로 구분 이름 표시, 기술지원과 함께 등록된 장애(overview `incidents[].entry_id`)는 그 기술지원 줄에 '장애처리'만 붙이고 따로 줄을 만들지 않는다.
- **장비 OS ↔ EOS** (`eos_match.py`): `match_os(os, load_index(db))` 가 OS 글자에서 제품·버전을 찾아(ESXi `8.0`, AIX `7.2.5`·oslevel `7200-05-..`, HMC `V10 R2`, Windows Server 연도, RHEL/Rocky 주버전, Ubuntu `22.04` 등) `eos_releases` 와 맞추고 상태(end/ext/soon/maint/ok, 화면 `eosStatus()`와 같은 기준)를 준다. 버전을 모르면 None. 표에 없는 옛 AIX TL 은 같은 릴리스의 더 높은 TL 이 모두 종료면 종료로 본다. `device_alert(dev, idx)` = 철수 장비 제외, end/ext/soon 만. 장비 dict 의 `eos`, 사이트 `eos_count`('확인할 것' OS n·요약 칸), overview `eos`, 대시보드 `eos_devices`(`#dash-eos-card`, `renderDashEos`가 사이트 1줄 + 제품·cycle 배지 `eos-chip`(장비 이름은 title), `.dash-body` 는 minmax(0,…) 로 칸 비율 고정, 이름은 `_eosName`). 프론트 배지 `_eosBadge`/`_eosTip`.
- **장비별 이력**: `schedules`·`workplans`·`incidents` 의 `device_ids`(쉼표로 이은 Device.id). 공통 입력 창의 '대상 장비'(`#wp-dev-row`, `_entryLoadDevs`/`_entryDevSel`, 사이트의 장비만 저장, 보내지 않으면 기존 값 유지, 장애 장비 칸이 비면 장비 이름으로 채움). `GET /sites/{id}/devices/{dev}/history` = device_ids 로 고른 기록 + 예전 장애(장애 장비 칸에 이름·S/N, 파트 S/N 일치 → `legacy`). 일정과 함께 등록한 장애는 그 일정 줄에 합침. 화면 `openDeviceHistory`(`modal-dev-history`), 줄 클릭 = `openEntry`.
- **아침 알림** (`routers/notify.py`, 계정 메뉴 '아침 알림 설정' `modal-notify`): `notify_settings`(엔지니어당 1건, 웹훅 `secure_store` 암호화, `send_time`, `weekdays_only`, `last_sent`, `last_result`). `app.py` `_notify_loop` 1분마다 `send_due()` — 시각이 지났고 오늘 안 보냈으면 보냄(실패해도 그날은 다시 안 보냄). 내용 `build_digest`(오늘·내일·지연 일정, 미처리 장애, 워런티 30일, OS EOL 90일, 미해결 이슈·이미 종료 장비 수). 형식은 주소로 고름 `hook_kind`(Slack/Discord/Google Chat/Teams MessageCard/Teams 워크플로 Adaptive Card/그 밖 `{"text"}`). https 만, `remote.blocked_target` 으로 내부 주소 거부. `GET /notify/preview`, `POST /notify/test`. `notify_settings.mention`(`clean_mention`: Slack 멤버 ID `U…`/`W…`, `@channel`, `@here`, Discord 숫자 ID) → `mention_tag`가 메신저별 글자(Slack `<@U…>`/`<!channel>`/`<!here>`, Discord, Google Chat `<users/all>`, Teams 는 없음)로 제목 앞에 붙인다 — 멘션 없는 웹훅 글은 Slack 기본 설정에서 핸드폰 푸시가 안 뜨기 때문.
- **사이트 체크리스트** (`page-checklist`, `drawChecklist`) = 테두리 표(`#page-checklist` 범위 CSS로 사이트 관리와 같은 선 색). 마감 칸은 `_clDue`(D-n)만, 날짜는 title. 체크리스트 없는 사이트는 `<details class="cl-nosite">`(펼침 상태 `_clNoSiteOpen`).
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
  - **관리자:** `users.is_admin`(없으면 `init_db()`의 `_ensure_admin`이 가장 먼저 가입한 계정을 관리자로). `/api/auth/me`·로그인 응답에 `is_admin`. 관리자 전용 API는 `Depends(require_admin)`(현재 `/api/dev/*` 개발 체크리스트), 화면은 `data-admin` 속성이 붙은 메뉴·페이지를 `initApp()`이 숨긴다. 다른 계정을 관리자로 만들려면 DB에서 `UPDATE users SET is_admin=1`.
  - 세션은 마지막 사용 후 30일(`SESSION_DAYS`)에 만료, 사용 중이면 하루 한 번 연장. 만료/미로그인 응답은 401 → 프론트가 로그인 화면으로 전환.
  - 회원 가입(`POST /api/auth/register`)은 아이디·비밀번호·엔지니어 이름에 더해 **부서·직급·이메일**이 필수(`users.dept/position/email`). 부서·직급은 휴가원용 `leave_profiles`에도 같이 넣어 둔다. 가입 후에는 계정 메뉴 '내 정보 수정'(`modal-profile`, `GET/PUT /api/auth/profile`)에서 고친다(아이디·이름은 변경 불가).
  - **가입 승인:** 회원가입한 계정은 `users.approved = False`(승인 대기)라 로그인할 수 없고(403), 관리자가 **계정 관리**(`page-users`, `data-admin`; `GET /api/auth/users`, `POST /users/{id}/approve|suspend`, `DELETE /users/{id}`)에서 승인해야 한다. 상태는 `approved`+`approved_at`으로 구분: 승인 대기(False, 빈 값) / 사용 중(True) / 사용 중지(False, 값 있음 — 세션도 끊김, 데이터 유지). 삭제는 승인 대기만 가능. 계정이 하나도 없을 때의 첫 가입자는 바로 승인 + 관리자.
  - 비밀번호는 PBKDF2-SHA256(`hash_pw`/`verify_pw`). 예전 SHA-256 저장분은 로그인 성공 시 자동 교체. 최소 8자.
  - 로그인 5회 연속 실패 시 5분 잠금(메모리 보관, 재시작 시 초기화). 비밀번호 변경은 `POST /api/auth/password`(다른 세션 모두 종료).
  - `init_db()`의 `_ensure_column`이 `sessions.expires_at` 열을 자동 추가한다(`incidents.entry_id` 등 나중에 붙인 열도 같은 방식).
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
- **색은 `style.css` 맨 위 `:root` 변수로 쓴다** (팔레트 `--slate-*`/`--blue-*`/`--red-*` 등, 용도 `--page-bg`/`--card-bg`/`--text`/`--accent`/`--line*`, 사이드바 `--sb-*`). 새 스타일에 hex 를 직접 쓰지 말 것. 회색은 slate 계열만(누런 회색 `#d4d4d0` 등은 없앴음), 파랑은 `--accent`(#2563eb) 하나(`--brand` 도 같은 값). 남색은 `--navy`(#2f3d56, 사이드바와 같은 채도 낮은 회청색 — 표 강조 칸·대시보드 막대에 씀)/`--navy-50`. 대시보드 카드 제목 띠(`dc-*`, 사이트 상세 개요 카드도 같이 씀)는 일정·체크리스트·프로젝트 = 남색, 이슈 = `--red-600`, 워런티 = `--amber-600` 만 색을 둔다(새 카드도 기본 남색, 주의가 필요한 것만 색). 표 제목 줄(`th`)·박스 머리(`wr-box-head` 등)는 `--head-bg`(#e2e8f0, 바탕 `--page-bg` 보다 한 단계 진하게)·`--head-text` 하나로 통일(style.css 맨 아래 묶음 규칙) — 새 표도 이 변수를 쓴다. 상태 배지 색은 아직 개별 hex.
- 외부 라이브러리는 CDN(cdnjs): marked(마크다운), highlight.js. JS 변경 후 캐시 무효화 필요 시 `app.js?v=N` 증가.

## 문서 갱신 규칙
- **기능을 추가·변경·삭제하면 같은 커밋에서 `README.md`도 고친다**: 1부(사용 안내)의 해당 메뉴 항목, 운영에 영향이 있으면 2부(설치·백업·문제 해결), 맨 아래 **변경 이력** 표 맨 위에 한 줄. 개발용 상세(API·테이블·규칙)는 이 `CLAUDE.md`에 쓴다.
- README 는 GitHub 에 공개되므로 실명·내부 IP·계정·고객사 이름을 넣지 않는다.

## 주의 사항
- `patch*.py`, `split_frontend.py`, `update_tasks.py`, `query_db*.py` 는 과거 일회성 수정 스크립트(절대경로 하드코딩) — 재실행 금지.
- `*_bk` 파일은 백업본. 수정 대상 아님.
- `data/portal.db`, `data/secret.key`, `uploads/` 는 운영 데이터 — 삭제/덮어쓰기 금지.
- 파일 소유자는 `appuser`. root로 생성한 파일은 서비스가 쓰지 못할 수 있으니 권한 확인.
- 기본 브랜치: `main` (현재 작업 브랜치 `master`).
