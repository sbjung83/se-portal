"""사내 테스트 서버 접속 정보.

서버 1대(LabServer)에 계정 여러 개(LabAccount). 비밀번호는 secure_store 로 암호화해 저장하고,
목록에는 내려주지 않으며 '보기/복사'를 누를 때만 따로 돌려준다.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import secure_store
from database import LabAccount, LabServer, get_db

router = APIRouter(prefix="/api/engineers/{eng_id}/lab", tags=["lab"])


class AccountIn(BaseModel):
    id:       Optional[str] = None      # 수정 시 기존 계정 id
    label:    str = ""
    username: str = ""
    password: Optional[str] = None      # None = 기존 유지, "" = 지움


class ServerIn(BaseModel):
    group_name: str = ""
    name:       str
    os:         str = ""
    address:    str = ""
    memo:       str = ""
    accounts:   List[AccountIn] = []


def _server_dict(s: LabServer):
    return {"id": s.id, "group_name": s.group_name or "", "name": s.name, "os": s.os or "",
            "address": s.address or "", "memo": s.memo or "", "order_idx": s.order_idx or 0,
            "accounts": [{"id": a.id, "label": a.label or "", "username": a.username or "",
                          "has_password": bool(a.password)} for a in s.accounts]}


def _get_server(eng_id: str, srv_id: str, db: Session) -> LabServer:
    s = db.query(LabServer).filter(LabServer.id == srv_id, LabServer.engineer_id == eng_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="서버 정보를 찾을 수 없습니다")
    return s


def _apply(s: LabServer, data: ServerIn):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="이름을 입력해주세요")
    s.group_name = data.group_name.strip()
    s.name = name
    s.os = data.os.strip()
    s.address = data.address.strip()
    s.memo = data.memo.strip()
    old = {a.id: a for a in s.accounts}
    kept = []
    for i, a in enumerate(data.accounts):
        if not (a.label.strip() or a.username.strip() or a.password or (a.id and a.id in old)):
            continue
        acc = old.get(a.id) if a.id else None
        if acc is None:
            acc = LabAccount(id=str(uuid.uuid4()), password="")
        acc.label = a.label.strip()
        acc.username = a.username.strip()
        if a.password is not None:
            acc.password = secure_store.encrypt(a.password)
        acc.order_idx = i
        kept.append(acc)
    s.accounts = kept       # 빠진 계정은 delete-orphan 으로 삭제


@router.get("")
def list_servers(eng_id: str, db: Session = Depends(get_db)):
    rows = (db.query(LabServer).filter(LabServer.engineer_id == eng_id)
            .order_by(LabServer.order_idx, LabServer.name).all())
    return [_server_dict(s) for s in rows]


@router.post("")
def create_server(eng_id: str, data: ServerIn, db: Session = Depends(get_db)):
    last = (db.query(LabServer).filter(LabServer.engineer_id == eng_id)
            .order_by(LabServer.order_idx.desc()).first())
    s = LabServer(id=str(uuid.uuid4()), engineer_id=eng_id, order_idx=(last.order_idx or 0) + 1 if last else 1)
    _apply(s, data)
    db.add(s); db.commit(); db.refresh(s)
    return _server_dict(s)


@router.put("/{srv_id}")
def update_server(eng_id: str, srv_id: str, data: ServerIn, db: Session = Depends(get_db)):
    s = _get_server(eng_id, srv_id, db)
    _apply(s, data)
    db.commit(); db.refresh(s)
    return _server_dict(s)


@router.delete("/{srv_id}")
def delete_server(eng_id: str, srv_id: str, db: Session = Depends(get_db)):
    s = _get_server(eng_id, srv_id, db)
    db.delete(s); db.commit()
    return {"ok": True}


@router.get("/accounts/{acc_id}/password")
def get_password(eng_id: str, acc_id: str, db: Session = Depends(get_db)):
    acc = (db.query(LabAccount).join(LabServer)
           .filter(LabAccount.id == acc_id, LabServer.engineer_id == eng_id).first())
    if not acc:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    try:
        return {"password": secure_store.decrypt(acc.password)}
    except ValueError:
        raise HTTPException(status_code=500, detail="저장된 비밀번호를 풀 수 없습니다. 암호화 키 파일(data/secret.key)을 확인해주세요")
