from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from sqlalchemy.orm import Session
from database import get_db, User, Engineer, hash_pw, SessionToken
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter(prefix="/api/auth", tags=["auth"])

def get_current_user(
    session_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not session_id:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    session = db.query(SessionToken).filter(SessionToken.id == session_id).first()
    if not session:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    user = db.query(User).filter(User.id == session.user_id).first()
    eng = db.query(Engineer).filter(Engineer.id == session.engineer_id).first()
    if not user or not eng:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    return {
        "user_id": user.id,
        "username": user.username,
        "engineer_id": eng.id,
        "engineer_name": eng.name,
    }

class RegisterIn(BaseModel):
    username:      str
    password:      str
    engineer_name: str

@router.post("/register")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(400, "이미 사용 중인 아이디입니다")
    if db.query(Engineer).filter(Engineer.name == data.engineer_name).first():
        raise HTTPException(400, "이미 사용 중인 엔지니어 이름입니다")
    eid = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    db.add(Engineer(id=eid, name=data.engineer_name))
    db.flush()
    db.add(User(id=uid, username=data.username, password=hash_pw(data.password), engineer_id=eid))
    db.commit()
    return {"ok": True, "message": f"'{data.engineer_name}' 계정이 생성되었습니다"}

class LoginIn(BaseModel):
    username: str
    password: str

@router.post("/login")
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.username == data.username,
        User.password == hash_pw(data.password)
    ).first()
    if not user:
        raise HTTPException(401, "아이디 또는 비밀번호가 틀렸습니다")
    eng = db.query(Engineer).filter(Engineer.id == user.engineer_id).first()
    if not eng:
        raise HTTPException(500, "연결된 엔지니어 정보가 없습니다")
    sid = str(uuid.uuid4())
    session = SessionToken(id=sid, user_id=user.id, engineer_id=eng.id)
    db.add(session)
    db.commit()
    response.set_cookie("session_id", sid, httponly=True, samesite="lax")
    return {"ok": True, "engineer_name": eng.name, "engineer_id": eng.id}

@router.post("/logout")
def logout(response: Response, session_id: Optional[str] = Cookie(default=None), db: Session = Depends(get_db)):
    if session_id:
        session = db.query(SessionToken).filter(SessionToken.id == session_id).first()
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie("session_id")
    return {"ok": True}

@router.get("/me")
def me(current=Depends(get_current_user)):
    return current
