from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie
from sqlalchemy.orm import Session
from database import get_db, User, Engineer, hash_pw, verify_pw, SessionToken
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import uuid

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_DAYS   = 30          # 마지막 사용 후 이 기간이 지나면 다시 로그인
PW_MIN_LEN     = 8
LOGIN_MAX_FAIL = 5           # 연속 실패 허용 횟수
LOGIN_LOCK_MIN = 5           # 초과 시 잠금 시간(분)

_COOKIE = "session_id"
_login_fails = {}            # 아이디(소문자) → [연속 실패 횟수, 잠금 해제 시각]. 서비스 재시작 시 초기화


def _set_cookie(response: Response, sid: str, request: Request):
    # HTTPS(nginx 가 X-Forwarded-Proto 로 알려줌)로 들어온 요청이면 쿠키도 HTTPS 전용으로
    response.set_cookie(_COOKIE, sid, httponly=True, samesite="lax", max_age=SESSION_DAYS * 86400,
                        secure=request.url.scheme == "https")


def _expiry(session: SessionToken) -> datetime:
    if session.expires_at:
        return session.expires_at
    return (session.created_at or datetime.utcnow()) + timedelta(days=SESSION_DAYS)   # 만료 도입 전 세션


def get_current_user(
    request: Request,
    response: Response,
    session_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not session_id:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    session = db.query(SessionToken).filter(SessionToken.id == session_id).first()
    if not session:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    now = datetime.utcnow()
    exp = _expiry(session)
    if exp <= now:
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="로그인이 만료되었습니다. 다시 로그인해주세요")
    user = db.query(User).filter(User.id == session.user_id).first()
    eng = db.query(Engineer).filter(Engineer.id == session.engineer_id).first()
    if not user or not eng:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    # 사용 중이면 만료를 늦춘다 (하루에 한 번만 갱신)
    if exp - now < timedelta(days=SESSION_DAYS - 1):
        session.expires_at = now + timedelta(days=SESSION_DAYS)
        db.commit()
        _set_cookie(response, session.id, request)
    return {
        "user_id": user.id,
        "username": user.username,
        "engineer_id": eng.id,
        "engineer_name": eng.name,
        "is_admin": bool(user.is_admin),
        "session_id": session.id,
    }


def require_login(request: Request, user: dict = Depends(get_current_user)):
    """모든 업무 API 공통: 로그인 필수 + 주소의 eng_id 가 로그인한 본인이어야 한다 (app.py 에서 일괄 적용)."""
    eng_id = request.path_params.get("eng_id")
    if eng_id is not None and eng_id != user["engineer_id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return user


def require_admin(user: dict = Depends(get_current_user)):
    """관리자 전용 API (개발 체크리스트 등)."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다")
    return user


def _check_new_password(pw: str):
    if len(pw or "") < PW_MIN_LEN:
        raise HTTPException(400, f"비밀번호는 {PW_MIN_LEN}자 이상이어야 합니다")


class RegisterIn(BaseModel):
    username:      str
    password:      str
    engineer_name: str

@router.post("/register")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    username, name = data.username.strip(), data.engineer_name.strip()
    if not username or not name:
        raise HTTPException(400, "아이디와 엔지니어 이름을 입력해주세요")
    _check_new_password(data.password)
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "이미 사용 중인 아이디입니다")
    if db.query(Engineer).filter(Engineer.name == name).first():
        raise HTTPException(400, "이미 사용 중인 엔지니어 이름입니다")
    eid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    db.add(Engineer(id=eid, name=name))
    db.flush()
    db.add(User(id=uid, username=username, password=hash_pw(data.password), engineer_id=eid))
    db.commit()
    return {"ok": True, "message": f"'{name}' 계정이 생성되었습니다"}

class LoginIn(BaseModel):
    username: str
    password: str

@router.post("/login")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    key = data.username.strip().lower()
    rec = _login_fails.get(key)
    if rec and rec[1] and rec[1] > now:
        left = int((rec[1] - now).total_seconds() // 60) + 1
        raise HTTPException(429, f"로그인 실패가 많아 잠겼습니다. 약 {left}분 뒤 다시 시도해주세요")

    user = db.query(User).filter(User.username == data.username.strip()).first()
    ok, upgrade = verify_pw(data.password, user.password) if user else (False, False)
    if not ok:
        if rec and rec[1] and rec[1] <= now:
            rec = None                                   # 잠금이 풀린 뒤에는 처음부터 다시 센다
        cnt = (rec[0] if rec else 0) + 1
        if cnt >= LOGIN_MAX_FAIL:
            _login_fails[key] = [cnt, now + timedelta(minutes=LOGIN_LOCK_MIN)]
            raise HTTPException(429, f"로그인에 {LOGIN_MAX_FAIL}회 실패해 {LOGIN_LOCK_MIN}분간 잠겼습니다")
        _login_fails[key] = [cnt, None]
        if len(_login_fails) > 5000:
            _login_fails.clear()
        raise HTTPException(401, f"아이디 또는 비밀번호가 틀렸습니다 ({cnt}/{LOGIN_MAX_FAIL})")
    _login_fails.pop(key, None)

    eng = db.query(Engineer).filter(Engineer.id == user.engineer_id).first()
    if not eng:
        raise HTTPException(500, "연결된 엔지니어 정보가 없습니다")
    if upgrade:
        user.password = hash_pw(data.password)           # 예전 방식 저장분을 새 방식으로 교체
    # 만료된 세션 정리
    for s in db.query(SessionToken).all():
        if _expiry(s) <= now:
            db.delete(s)
    sid = str(uuid.uuid4())
    db.add(SessionToken(id=sid, user_id=user.id, engineer_id=eng.id, expires_at=now + timedelta(days=SESSION_DAYS)))
    db.commit()
    _set_cookie(response, sid, request)
    return {"ok": True, "engineer_name": eng.name, "engineer_id": eng.id, "is_admin": bool(user.is_admin)}

@router.post("/logout")
def logout(response: Response, session_id: Optional[str] = Cookie(default=None), db: Session = Depends(get_db)):
    if session_id:
        session = db.query(SessionToken).filter(SessionToken.id == session_id).first()
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(_COOKIE)
    return {"ok": True}

class PasswordIn(BaseModel):
    current_password: str
    new_password:     str

@router.post("/password")
def change_password(data: PasswordIn, current=Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current["user_id"]).first()
    ok, _ = verify_pw(data.current_password, user.password)
    if not ok:
        raise HTTPException(400, "현재 비밀번호가 틀렸습니다")
    _check_new_password(data.new_password)
    if data.new_password == data.current_password:
        raise HTTPException(400, "현재 비밀번호와 다른 비밀번호를 입력해주세요")
    user.password = hash_pw(data.new_password)
    # 다른 기기의 로그인은 모두 끊는다 (지금 쓰는 세션만 유지)
    db.query(SessionToken).filter(SessionToken.user_id == user.id, SessionToken.id != current["session_id"]).delete()
    db.commit()
    return {"ok": True}

@router.get("/me")
def me(current=Depends(get_current_user)):
    return {k: v for k, v in current.items() if k != "session_id"}
