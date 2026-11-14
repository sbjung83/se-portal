"""테스트 서버 원격 접속 (브라우저만으로 SSH · RDP).

- SSH : 포털이 asyncssh 로 대신 접속하고, 브라우저의 xterm.js 터미널과 WebSocket 으로 잇는다.
- RDP : guacd(Apache Guacamole 변환 엔진, 127.0.0.1:4822, podman 서비스 `guacd`)를 거쳐
        브라우저의 guacamole-common-js 와 WebSocket 으로 잇는다.

접속 대상·계정은 테스트서버 접속 정보(routers/lab.py)의 LabConn/LabAccount 를 쓰고,
비밀번호는 서버 안에서만 풀어 쓴다(브라우저로 보내지 않음). 접속할 때마다 LabAccessLog 에 기록한다.
WebSocket 은 app.py 의 require_login 이 적용되지 않으므로 여기서 세션 쿠키와 Origin 을 직접 확인한다.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime
from urllib.parse import urlparse

import asyncssh
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

import database
import secure_store
from database import Engineer, LabAccessLog, LabAccount, LabConn, LabServer, SessionToken, User
from routers.auth import _expiry

router = APIRouter(tags=["remote"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUACD_HOST = os.environ.get("GUACD_HOST", "127.0.0.1")
GUACD_PORT = int(os.environ.get("GUACD_PORT", "4822"))
CONNECT_TIMEOUT = 10      # 포트 응답 대기(초)
LOGIN_TIMEOUT = 60        # SSH 로그인 완료까지(초)
DEFAULT_PORT = {"SSH": 22, "RDP": 3389}

# 오래된 장비(네트워크 장비·구형 OS)도 붙도록 기본 알고리즘 뒤에 예전 방식을 덧붙인다.
_LEGACY = dict(
    kex_algs="+diffie-hellman-group14-sha1,diffie-hellman-group-exchange-sha1,diffie-hellman-group1-sha1",
    encryption_algs="+aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc",
    server_host_key_algs="+ssh-rsa,ssh-dss",
    mac_algs="+hmac-sha1",
)


@router.get("/remote", include_in_schema=False)
def remote_page():
    """원격 접속 화면(껍데기). 실제 접속은 아래 WebSocket 에서 로그인·소유를 확인한다."""
    return FileResponse(os.path.join(BASE_DIR, "templates", "remote.html"), media_type="text/html",
                        headers={"Cache-Control": "no-store"})


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _client_ip(ws: WebSocket) -> str:
    fwd = ws.headers.get("x-real-ip") or (ws.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (ws.client.host if ws.client else "")


def _prepare(ws: WebSocket, conn_id: str, kind: str):
    """로그인·소유 확인 후 접속에 필요한 값을 돌려준다. 실패하면 (None, 사유)."""
    origin = ws.headers.get("origin")
    if origin and urlparse(origin).netloc != ws.headers.get("host"):
        return None, "허용되지 않은 접근입니다"
    sid = ws.cookies.get("session_id")
    db = database.SessionLocal()
    try:
        sess = db.query(SessionToken).filter(SessionToken.id == sid).first() if sid else None
        if not sess or _expiry(sess) <= datetime.utcnow():
            return None, "로그인이 필요합니다"
        if not db.query(User).filter(User.id == sess.user_id).first() or \
           not db.query(Engineer).filter(Engineer.id == sess.engineer_id).first():
            return None, "로그인이 필요합니다"
        row = (db.query(LabConn, LabServer).join(LabServer, LabConn.server_id == LabServer.id)
               .filter(LabConn.id == conn_id, LabServer.engineer_id == sess.engineer_id).first())
        if not row:
            return None, "접속 대상을 찾을 수 없습니다"
        conn, srv = row
        if conn.kind != kind:
            return None, "접속 방식이 맞지 않습니다"
        acc = (db.query(LabAccount).filter(LabAccount.id == conn.account_id, LabAccount.server_id == srv.id).first()
               if conn.account_id else None)
        if not acc:
            return None, "접속에 쓸 계정이 지정되지 않았습니다. 서버 수정 창에서 계정을 골라주세요"
        try:
            password = secure_store.decrypt(acc.password)
        except ValueError:
            return None, "저장된 비밀번호를 풀 수 없습니다 (data/secret.key 확인)"
        port = conn.port or DEFAULT_PORT[kind]
        log = LabAccessLog(id=str(uuid.uuid4()), engineer_id=sess.engineer_id,
                           server_name=srv.name + (f" ({conn.label})" if conn.label else ""), kind=kind,
                           target=f"{conn.host}:{port}", username=acc.username, client_ip=_client_ip(ws),
                           started_at=_now(), result="접속 중")
        db.add(log); db.commit()
        return {"host": conn.host, "port": port, "username": acc.username, "password": password,
                "log_id": log.id}, ""
    finally:
        db.close()


def _finish(log_id: str, result: str):
    db = database.SessionLocal()
    try:
        log = db.query(LabAccessLog).filter(LabAccessLog.id == log_id).first()
        if log:
            log.ended_at = _now()
            log.result = result[:200]
            db.commit()
    finally:
        db.close()


def close_stale_logs():
    """서비스가 내려가며 닫지 못한 기록 정리 (app.py 시작 시 호출)."""
    db = database.SessionLocal()
    try:
        for log in db.query(LabAccessLog).filter(LabAccessLog.result == "접속 중").all():
            log.ended_at = log.ended_at or _now()
            log.result = "종료 (서비스 재시작)"
        db.commit()
    finally:
        db.close()


async def _refuse(ws: WebSocket, msg: str, guac: bool = False):
    """연결은 받아 준 뒤 사유를 알리고 닫는다 (브라우저는 거절된 WebSocket 의 사유를 읽지 못한다)."""
    await ws.accept(subprotocol="guacamole" if guac else None)
    try:
        if guac:
            await ws.send_text(_ins("error", msg, "769"))
        else:
            await ws.send_text(json.dumps({"t": "error", "msg": msg}, ensure_ascii=False))
        await ws.close()
    except Exception:
        pass


def _ssh_error(e: Exception) -> str:
    if isinstance(e, asyncssh.PermissionDenied):
        return "로그인 거부 (계정·비밀번호 확인)"
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
        return "응답 없음 (시간 초과)"
    if isinstance(e, asyncssh.ConnectionLost):
        return "로그인 도중 서버가 연결을 끊음 (계정 잠김·접속 제한 가능)"
    if isinstance(e, ConnectionRefusedError):
        return "연결 거부 (SSH 포트가 닫혀 있음)"
    if isinstance(e, OSError):
        return f"연결 실패 ({e.strerror or e})"
    return f"연결 실패 ({type(e).__name__}: {e})"


# ── SSH ────────────────────────────────────────────────────────
@router.websocket("/api/remote/{conn_id}/ssh")
async def ssh_ws(ws: WebSocket, conn_id: str, cols: int = 120, rows: int = 32):
    info, err = await asyncio.to_thread(_prepare, ws, conn_id, "SSH")
    if not info:
        return await _refuse(ws, err)
    await ws.accept()
    cols, rows = max(20, min(cols, 500)), max(5, min(rows, 200))
    result = "정상 종료"
    conn = None
    try:
        try:
            # 연결(포트 응답)은 짧게, 로그인은 넉넉히 기다린다 — 비밀번호가 틀리면 일부러 20초쯤 끄는 장비(vCenter 등)가 있어
            # 한꺼번에 짧게 끊으면 '로그인 거부'가 '응답 없음'으로 잘못 보인다.
            conn = await asyncio.wait_for(asyncssh.connect(
                info["host"], port=info["port"], username=info["username"], password=info["password"],
                known_hosts=None, client_keys=None, agent_path=None, config=None,
                connect_timeout=CONNECT_TIMEOUT, login_timeout=LOGIN_TIMEOUT,
                keepalive_interval=30, **_LEGACY), CONNECT_TIMEOUT + LOGIN_TIMEOUT + 5)
            proc = await conn.create_process(term_type="xterm-256color", term_size=(cols, rows),
                                             encoding=None, stderr=asyncssh.STDOUT)
        except Exception as e:
            result = "실패: " + _ssh_error(e)
            await ws.send_text(json.dumps({"t": "error", "msg": _ssh_error(e)}, ensure_ascii=False))
            return
        await ws.send_text(json.dumps({"t": "ready"}))

        async def pump_out():
            while True:
                data = await proc.stdout.read(65536)
                if not data:
                    return
                await ws.send_bytes(data)

        async def pump_in():
            while True:
                m = json.loads(await ws.receive_text())
                if m.get("t") == "i":
                    proc.stdin.write(str(m.get("d", "")).encode("utf-8"))
                elif m.get("t") == "r":
                    proc.change_terminal_size(max(20, min(int(m["c"]), 500)), max(5, min(int(m["r"]), 200)))

        tasks = [asyncio.create_task(pump_out()), asyncio.create_task(pump_in())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for t in done:
            e = t.exception()
            if e and not isinstance(e, WebSocketDisconnect):
                result = f"종료 ({type(e).__name__})"
        try:
            await ws.send_text(json.dumps({"t": "closed"}))
        except Exception:
            pass
    finally:
        if conn:
            conn.close()
        await asyncio.to_thread(_finish, info["log_id"], result)
        try:
            await ws.close()
        except Exception:
            pass


# ── RDP (guacd) ────────────────────────────────────────────────
def _ins(*elements) -> str:
    """Guacamole 명령 한 줄: '길이.값,길이.값;' (길이는 글자 수)."""
    return ",".join(f"{len(str(e))}.{e}" for e in elements) + ";"


_GUAC_CODES = {"769": "로그인 거부 (계정·비밀번호 확인)", "771": "원격 접속 권한 없음", "519": "서버에 닿지 않음",
               "514": "응답 없음 (시간 초과)", "521": "같은 계정의 다른 접속으로 끊김", "522": "서버가 세션을 종료함"}


def _guac_error(ins: str) -> str:
    """'5.error,<길이>.<메시지>,<길이>.<코드>;' 에서 기록용 사유를 뽑는다."""
    parts, i = [], 0
    try:
        while i < len(ins) and len(parts) < 3:
            dot = ins.index(".", i)
            j = dot + 1 + int(ins[i:dot])
            parts.append(ins[dot + 1:j])
            i = j + 1
    except ValueError:
        pass
    msg = parts[1] if len(parts) > 1 else ""
    code = parts[2] if len(parts) > 2 else ""
    return _GUAC_CODES.get(code) or (f"{msg} [{code}]" if msg else f"오류 [{code}]")


class _InsReader:
    """guacd 에서 오는 바이트를 '완성된 명령' 단위 문자열로 잘라 준다 (브라우저는 잘린 명령을 못 읽는다)."""

    def __init__(self, reader: asyncio.StreamReader):
        self.reader = reader
        self.buf = ""
        import codecs
        self.dec = codecs.getincrementaldecoder("utf-8")()

    def _complete_end(self) -> int:
        """buf 안에서 마지막으로 완성된 명령의 끝 위치(없으면 0)."""
        i, end, n = 0, 0, len(self.buf)
        while i < n:
            dot = self.buf.find(".", i)
            if dot < 0:
                break
            j = dot + 1 + int(self.buf[i:dot])
            if j >= n:
                break
            if self.buf[j] == ";":
                end = j + 1
            i = j + 1
        return end

    async def read(self) -> str:
        """완성된 명령 1개 이상을 이어 붙인 문자열. 연결이 끊기면 ''."""
        while True:
            end = self._complete_end()
            if end:
                out, self.buf = self.buf[:end], self.buf[end:]
                return out
            data = await self.reader.read(65536)
            if not data:
                return ""
            self.buf += self.dec.decode(data)

    async def read_one(self) -> list:
        """명령 1개를 [opcode, 인자...] 로."""
        while True:
            i, parts, n = 0, [], len(self.buf)
            while i < n:
                dot = self.buf.find(".", i)
                if dot < 0:
                    break
                j = dot + 1 + int(self.buf[i:dot])
                if j >= n:
                    break
                parts.append(self.buf[dot + 1:j])
                if self.buf[j] == ";":
                    self.buf = self.buf[j + 1:]
                    return parts
                i = j + 1
            data = await self.reader.read(65536)
            if not data:
                return []
            self.buf += self.dec.decode(data)


def _rdp_args(names: list, info: dict, w: int, h: int, dpi: int) -> list:
    vals = {
        "hostname": info["host"], "port": str(info["port"]),
        "username": info["username"], "password": info["password"],
        "width": str(w), "height": str(h), "dpi": str(dpi),
        "security": "any", "ignore-cert": "true",
        "resize-method": "display-update",
        "disable-audio": "true",            # 소리는 끈다 (서버 부하·대역폭)
        "color-depth": "16",
        "enable-font-smoothing": "true",
    }
    domain = ""
    user = info["username"]
    if "\\" in user:                        # DOMAIN\user 형태
        domain, user = user.split("\\", 1)
        vals["username"], vals["domain"] = user, domain
    return [n if n.startswith("VERSION_") else vals.get(n, "") for n in names]


@router.websocket("/api/remote/{conn_id}/rdp")
async def rdp_ws(ws: WebSocket, conn_id: str, w: int = 1280, h: int = 720, dpi: int = 96):
    info, err = await asyncio.to_thread(_prepare, ws, conn_id, "RDP")
    if not info:
        return await _refuse(ws, err, guac=True)
    await ws.accept(subprotocol="guacamole")
    w, h, dpi = max(640, min(w, 3840)), max(480, min(h, 2160)), max(72, min(dpi, 192))
    result = "정상 종료"
    writer = None
    try:
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(GUACD_HOST, GUACD_PORT), 5)
        except Exception:
            result = "실패: guacd 서비스에 연결할 수 없음"
            await ws.send_text(_ins("error", "원격 화면 엔진(guacd)에 연결할 수 없습니다. 서버에서 systemctl status guacd 를 확인해주세요", "512"))
            return
        ins = _InsReader(reader)
        writer.write(_ins("select", "rdp").encode())
        args = await asyncio.wait_for(ins.read_one(), 10)
        if not args or args[0] != "args":
            result = "실패: guacd 응답 이상"
            await ws.send_text(_ins("error", "원격 화면 엔진(guacd) 응답이 올바르지 않습니다", "512"))
            return
        writer.write((_ins("size", w, h, dpi) + _ins("audio") + _ins("video")
                      + _ins("image", "image/png", "image/jpeg", "image/webp")
                      + _ins("connect", *_rdp_args(args[1:], info, w, h, dpi))).encode("utf-8"))
        await writer.drain()
        await ws.send_text(_ins("", str(uuid.uuid4())))      # 터널 식별자 (브라우저 라이브러리가 기다림)

        state = {"error": ""}

        async def pump_out():
            while True:
                chunk = await ins.read()
                if not chunk:
                    return
                if not state["error"] and "5.error," in chunk:
                    state["error"] = _guac_error(chunk[chunk.find("5.error,"):])
                await ws.send_text(chunk)

        async def pump_in():
            while True:
                msg = await ws.receive_text()
                if msg.startswith("0.,"):                     # 터널 내부 명령(ping)은 그대로 돌려준다
                    await ws.send_text(msg)
                    continue
                writer.write(msg.encode("utf-8"))
                await writer.drain()

        tasks = [asyncio.create_task(pump_out()), asyncio.create_task(pump_in())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for t in done:
            e = t.exception()
            if e and not isinstance(e, WebSocketDisconnect):
                result = f"종료 ({type(e).__name__})"
        if state["error"]:
            result = "실패: " + state["error"]
    finally:
        if writer:
            try:
                writer.write(_ins("disconnect").encode())
                writer.close()
            except Exception:
                pass
        await asyncio.to_thread(_finish, info["log_id"], result)
        try:
            await ws.close()
        except Exception:
            pass
