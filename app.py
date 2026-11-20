from fastapi import FastAPI, Depends
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager
from database import init_db
from routers import auth, sites, logs, dashboard, schedules, issues, site_checklist, projects, technotes, development, incidents, reports, gcal, entries, lab, remote, leaves, carlog, carrepair, expenses, eos, notify, licenses, sanconfig, team
from routers.auth import require_login, require_admin, require_lead
import os, asyncio

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.makedirs(os.path.join(BASE_DIR, "data"),    exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "uploads"), exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    remote.close_stale_logs()
    task = asyncio.create_task(_calendar_loop())
    eos_task = asyncio.create_task(_eos_loop())
    notify_task = asyncio.create_task(_notify_loop())
    lic_task = asyncio.create_task(_license_loop())
    yield
    task.cancel()
    eos_task.cancel()
    notify_task.cancel()
    lic_task.cancel()

async def _calendar_loop():
    """구글 캘린더를 주기적으로 읽어 온다 (routers/gcal.py)."""
    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(gcal.sync_all)
        except Exception:
            pass
        await asyncio.sleep(gcal.SYNC_MINUTES * 60)

async def _eos_loop():
    """OS EOS 현황을 하루 한 번 갱신한다 (routers/eos.py). 1시간마다 갱신할 때인지 확인."""
    await asyncio.sleep(30)
    while True:
        try:
            if await asyncio.to_thread(eos.refresh_due):
                await asyncio.to_thread(eos.refresh_all)
        except Exception:
            pass
        await asyncio.sleep(3600)

async def _license_loop():
    """라이선스 정책 근거 페이지를 하루 한 번 읽어 바뀐 것을 표시한다 (routers/licenses.py). 1시간마다 때가 됐는지 확인."""
    await asyncio.sleep(90)
    while True:
        try:
            if await asyncio.to_thread(licenses.check_due):
                await asyncio.to_thread(licenses.check_all)
        except Exception:
            pass
        await asyncio.sleep(3600)

async def _notify_loop():
    """아침 알림: 1분마다 보낼 시각이 된 엔지니어에게 웹훅으로 보낸다 (routers/notify.py)."""
    await asyncio.sleep(20)
    while True:
        try:
            await asyncio.to_thread(notify.send_due)
        except Exception:
            pass
        await asyncio.sleep(60)

# API 문서(/docs, /redoc, /openapi.json)는 외부에 노출하지 않는다
app = FastAPI(title="SE Portal", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
templates  = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
static_dir = os.path.join(BASE_DIR, "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

app.include_router(auth.router)
# 인증(auth) 외 모든 API: 로그인 필수 + 주소의 eng_id 가 본인인지 확인
_LOGIN = [Depends(require_login)]
app.include_router(dashboard.router, dependencies=_LOGIN)
app.include_router(sites.router, dependencies=_LOGIN)
app.include_router(sanconfig.router, dependencies=_LOGIN)   # SAN Switch 설정 백업 (장비별)
app.include_router(projects.router, dependencies=_LOGIN)
app.include_router(logs.router, dependencies=_LOGIN)
app.include_router(schedules.router, dependencies=_LOGIN)
app.include_router(issues.router, dependencies=_LOGIN)
app.include_router(site_checklist.router, dependencies=_LOGIN)
app.include_router(technotes.router, dependencies=_LOGIN)
app.include_router(incidents.router, dependencies=_LOGIN)
app.include_router(development.router, dependencies=[Depends(require_admin)])   # 개발 체크리스트는 관리자만
app.include_router(reports.router, dependencies=_LOGIN)
app.include_router(gcal.router, dependencies=_LOGIN)
app.include_router(entries.router, dependencies=_LOGIN)
app.include_router(lab.router, dependencies=_LOGIN)
app.include_router(leaves.router, dependencies=_LOGIN)
app.include_router(carlog.router, dependencies=_LOGIN)
app.include_router(eos.router, dependencies=_LOGIN)        # 엔지니어 공용 데이터 (/api/eos)
app.include_router(licenses.router, dependencies=_LOGIN)   # 엔지니어 공용 데이터 (/api/licenses)
app.include_router(carrepair.router, dependencies=_LOGIN)
app.include_router(expenses.router, dependencies=_LOGIN)
app.include_router(notify.router, dependencies=_LOGIN)
app.include_router(team.router, dependencies=[Depends(require_lead)])   # 팀 주간보고서 (/api/team, 팀장만)
# 원격 접속(WebSocket)은 require_login 을 쓸 수 없어 라우터 안에서 세션 쿠키를 직접 확인한다
app.include_router(remote.router)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
