"""사내 테스트 서버 접속 정보.

서버 1대(LabServer)에 계정 여러 개(LabAccount). 비밀번호는 secure_store 로 암호화해 저장하고,
목록에는 내려주지 않으며 '보기/복사'를 누를 때만 따로 돌려준다.
원격 접속 대상(LabConn: 웹/SSH/RDP)도 여기서 관리하고, 실제 접속은 routers/remote.py 가 맡는다.
"""
import uuid
from typing import List, Optional

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import secure_store
from database import Engineer, LabAccessLog, LabAccount, LabConn, LabServer, get_db
from routers.auth import require_admin
from routers.remote import blocked_target

router = APIRouter(prefix="/api/engineers/{eng_id}/lab", tags=["lab"])


class AccountIn(BaseModel):
    id:       Optional[str] = None      # 수정 시 기존 계정 id
    label:    str = ""
    username: str = ""
    password: Optional[str] = None      # None = 기존 유지, "" = 지움


CONN_KINDS = ("웹", "SSH", "RDP")


class ConnIn(BaseModel):
    id:          Optional[str] = None
    kind:        str = "SSH"
    label:       str = ""
    host:        str = ""
    port:        Optional[int] = None
    account_idx: Optional[int] = None   # 같이 보낸 accounts 목록에서 몇 번째 계정으로 접속할지


class ServerIn(BaseModel):
    group_name: str = ""
    name:       str
    os:         str = ""
    address:    str = ""
    memo:       str = ""
    accounts:   List[AccountIn] = []
    conns:      Optional[List[ConnIn]] = None   # None = 기존 유지


def _server_dict(s: LabServer):
    return {"id": s.id, "group_name": s.group_name or "", "name": s.name, "os": s.os or "",
            "address": s.address or "", "memo": s.memo or "", "order_idx": s.order_idx or 0,
            "accounts": [{"id": a.id, "label": a.label or "", "username": a.username or "",
                          "has_password": bool(a.password)} for a in s.accounts],
            "conns": [{"id": c.id, "kind": c.kind, "label": c.label or "", "host": c.host or "",
                       "port": c.port, "account_id": c.account_id or ""} for c in s.conns]}


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
    by_idx = {}             # 보낸 순번 → 계정 (접속 대상의 account_idx 를 풀 때 사용)
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
        by_idx[i] = acc
    s.accounts = kept       # 빠진 계정은 delete-orphan 으로 삭제
    kept_ids = {a.id for a in kept}
    if data.conns is None:
        for c in s.conns:   # 지워진 계정을 가리키던 접속 대상은 계정만 비운다
            if c.account_id and c.account_id not in kept_ids:
                c.account_id = ""
        return
    old_c = {c.id: c for c in s.conns}
    conns = []
    for i, c in enumerate(data.conns):
        host = c.host.strip()
        if not host:
            continue
        if c.kind not in CONN_KINDS:
            raise HTTPException(status_code=400, detail="접속 방식은 웹/SSH/RDP 중 하나여야 합니다")
        if c.kind == "웹" and not host.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="웹 접속 주소는 http:// 또는 https:// 로 시작해야 합니다")
        if c.kind != "웹" and (" " in host or "/" in host):
            raise HTTPException(status_code=400, detail=f"{c.kind} 접속 주소에는 IP 또는 호스트 이름만 적어주세요")
        why = blocked_target(host, resolve=False) if c.kind != "웹" else None
        if why:
            raise HTTPException(status_code=400, detail=why)
        if c.port is not None and not (1 <= c.port <= 65535):
            raise HTTPException(status_code=400, detail="포트는 1~65535 사이여야 합니다")
        conn = old_c.get(c.id) if c.id else None
        if conn is None:
            conn = LabConn(id=str(uuid.uuid4()))
        acc = by_idx.get(c.account_idx) if c.account_idx is not None else None
        conn.kind, conn.label, conn.host = c.kind, c.label.strip(), host
        conn.port = None if c.kind == "웹" else c.port
        conn.account_id = acc.id if (acc and c.kind != "웹") else ""
        conn.order_idx = i
        conns.append(conn)
    s.conns = conns


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


def _log_dict(r: LabAccessLog, names: dict = None):
    d = {"id": r.id, "server_name": r.server_name, "kind": r.kind, "target": r.target, "username": r.username,
         "client_ip": r.client_ip, "started_at": r.started_at, "ended_at": r.ended_at, "result": r.result}
    if names is not None:
        d["engineer"] = names.get(r.engineer_id, "")
    return d


@router.get("/logs")
def list_logs(eng_id: str, db: Session = Depends(get_db)):
    """내 접속·비밀번호 보기 기록 최근 100건."""
    rows = (db.query(LabAccessLog).filter(LabAccessLog.engineer_id == eng_id)
            .order_by(LabAccessLog.started_at.desc()).limit(100).all())
    return [_log_dict(r) for r in rows]


@router.get("/logs/all")
def list_all_logs(eng_id: str, admin=Depends(require_admin), db: Session = Depends(get_db)):
    """관리자 전용: 모든 엔지니어의 기록 최근 300건."""
    names = {e.id: e.name for e in db.query(Engineer).all()}
    rows = db.query(LabAccessLog).order_by(LabAccessLog.started_at.desc()).limit(300).all()
    return [_log_dict(r, names) for r in rows]


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
def get_password(eng_id: str, acc_id: str, request: Request, db: Session = Depends(get_db)):
    """비밀번호 보기·복사. 볼 때마다 접속 기록(lab_access_logs)에 '비밀번호 보기'로 남긴다."""
    acc = (db.query(LabAccount).join(LabServer)
           .filter(LabAccount.id == acc_id, LabServer.engineer_id == eng_id).first())
    if not acc:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    ip = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() \
        or (request.client.host if request.client else "")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.add(LabAccessLog(id=str(uuid.uuid4()), engineer_id=eng_id, server_name=acc.server.name, kind="비밀번호 보기",
                        target=acc.label or "", username=acc.username or "", client_ip=ip,
                        started_at=now, ended_at=now, result="조회"))
    db.commit()
    try:
        return {"password": secure_store.decrypt(acc.password)}
    except ValueError:
        raise HTTPException(status_code=500, detail="저장된 비밀번호를 풀 수 없습니다. 암호화 키 파일(data/secret.key)을 확인해주세요")
