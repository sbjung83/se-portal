from fastapi import FastAPI, Depends
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager
from database import init_db
from routers import auth, sites, logs, dashboard, schedules, issues, site_checklist, projects, technotes, development, incidents, reports, gcal, entries, lab, remote
from routers.auth import require_login, require_admin
import os, asyncio

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.makedirs(os.path.join(BASE_DIR, "data"),    exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "uploads"), exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    remote.close_stale_logs()
    task = asyncio.create_task(_calendar_loop())
    yield
    task.cancel()

async def _calendar_loop():
    """구글 캘린더를 주기적으로 읽어 온다 (routers/gcal.py)."""
    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(gcal.sync_all)
        except Exception:
            pass
        await asyncio.sleep(gcal.SYNC_MINUTES * 60)

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
# 원격 접속(WebSocket)은 require_login 을 쓸 수 없어 라우터 안에서 세션 쿠키를 직접 확인한다
app.include_router(remote.router)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
