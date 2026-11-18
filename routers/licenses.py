"""라이선스 정책 (지식 창고 > 라이선스 정책). 엔지니어 공용 데이터 — eng_id 없음, 로그인만 필요.

- 설명 글: license_guide.py 의 기본 내용을 lic_items 에 맞춰 둔다(sync_items). 관리자가 고친 항목(edited)은 덮어쓰지 않는다.
- 변경 감지: 각 항목 근거 중 watch=True 주소를 하루 한 번 읽는다(app.py _license_loop → check_due/check_all).
  HTML 은 스크립트·메뉴 등을 걷어낸 글자를 줄 단위로 정리해 비교하고, PDF 는 파일 자체를 비교한다.
  바뀌면 changed_at·acked=False → 화면 '변경 감지', 아무나 '확인함'으로 끈다. 글을 자동으로 고치지는 않는다.
"""
import difflib
import hashlib
import json
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import database
import license_guide as G
from database import LicItem, LicWatch, get_db
from routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/licenses", tags=["licenses"])

CHECK_HOURS = 24
MANUAL_MIN_GAP = 5 * 60
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) SE-Portal-License/1.0"}
_lock = threading.Lock()
_last_manual = 0.0

_BLOCK = {"p", "div", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "br", "section",
          "article", "dt", "dd", "pre", "blockquote", "table", "ul", "ol", "caption"}
_NOISE = re.compile(r"\b[0-9a-f]{16,}\b|\b[0-9A-Za-z_-]{32,}\b")   # 추적 ID·토큰 같은 매번 바뀌는 글자


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ── 기본 내용 맞추기 ──────────────────────────────
def sync_items(db: Session):
    """license_guide.ITEMS 를 lic_items·lic_watch 에 맞춘다 (고친 항목의 요약·본문은 그대로)."""
    keys = []
    for i, it in enumerate(G.ITEMS):
        keys.append(it["key"])
        srcs = [{"label": l, "url": u, "watch": bool(w)} for l, u, w in it["sources"]]
        row = db.query(LicItem).filter(LicItem.key == it["key"]).first()
        if not row:
            row = LicItem(key=it["key"], edited=False)
            db.add(row)
        row.category, row.sort, row.name, row.vendor = it["cat"], i, it["name"], it["vendor"]
        row.sources = json.dumps(srcs, ensure_ascii=False)
        if not row.edited:
            row.summary, row.body = it["summary"], it["body"]
        want = {s["url"]: s["label"] for s in srcs if s["watch"]}
        have = {w.url: w for w in db.query(LicWatch).filter(LicWatch.item_key == it["key"]).all()}
        for url, label in want.items():
            if url in have:
                have[url].label = label
            else:
                db.add(LicWatch(id=hashlib.sha1(f"{it['key']}|{url}".encode()).hexdigest()[:16],
                                item_key=it["key"], url=url, label=label))
        for url, w in have.items():
            if url not in want:
                db.delete(w)
    db.query(LicItem).filter(LicItem.key.notin_(keys)).delete(synchronize_session=False)
    db.query(LicWatch).filter(LicWatch.item_key.notin_(keys)).delete(synchronize_session=False)
    db.commit()


# ── 페이지 읽기 ──────────────────────────────────
def _page_text(content: bytes) -> str:
    """HTML → 비교용 글자: 스크립트·메뉴·머리말·꼬리말을 빼고 블록마다 한 줄, 매번 바뀌는 토큰 제거."""
    from lxml import html as LH
    doc = LH.fromstring(content)
    for b in doc.xpath("//script|//style|//noscript|//svg|//header|//footer|//nav|//iframe|//form|//button"):
        b.drop_tree()
    for el in doc.iter():
        if isinstance(el.tag, str) and el.tag.lower() in _BLOCK:
            el.text = "\n" + (el.text or "")
            el.tail = "\n" + (el.tail or "")
    lines, seen = [], set()
    for ln in doc.text_content().split("\n"):
        ln = _NOISE.sub("", re.sub(r"\s+", " ", ln)).strip()
        if len(ln) < 4 or ln in seen:
            continue
        seen.add(ln)
        lines.append(ln)
    return "\n".join(lines)[:300_000]


def _fetch(client: httpx.Client, url: str):
    """(digest, text) — PDF 는 text 가 빈 값. 실패하면 예외(한국어 사유)."""
    r = client.get(url)
    if r.status_code != 200:
        raise ValueError(f"HTTP {r.status_code}")
    ct = r.headers.get("content-type", "").lower()
    if "pdf" in ct or url.lower().endswith(".pdf"):
        if len(r.content) < 1000:
            raise ValueError("파일이 비어 있습니다")
        return hashlib.sha256(r.content).hexdigest(), ""
    text = _page_text(r.content)
    if len(text) < 300:
        raise ValueError("내용을 읽을 수 없습니다 (화면을 스크립트로 그리는 페이지)")
    return hashlib.sha256(text.encode()).hexdigest(), text


def check_all() -> dict:
    """모든 근거 페이지를 읽어 바뀐 것을 표시한다."""
    with _lock:
        db = database.SessionLocal()
        ok, changed, failed = 0, 0, 0
        try:
            sync_items(db)
            with httpx.Client(timeout=40, headers=UA, follow_redirects=True) as client:
                for w in db.query(LicWatch).all():
                    w.checked_at = _now()
                    try:
                        digest, text = _fetch(client, w.url)
                        if w.digest and digest != w.digest:
                            w.prev_text, w.changed_at, w.acked, w.acked_by = w.text or "", w.checked_at, False, ""
                            changed += 1
                        w.digest, w.text, w.ok_at, w.error = digest, text, w.checked_at, ""
                        ok += 1
                    except Exception as e:
                        w.error = (str(e) if isinstance(e, ValueError) else type(e).__name__)[:200]
                        failed += 1
                    db.commit()
        finally:
            db.close()
        return {"ok": ok, "changed": changed, "failed": failed}


def check_due() -> bool:
    """하루에 한 번: 아직 한 번도 안 읽었거나, 가장 오래전에 읽은 것이 CHECK_HOURS 지났으면."""
    db = database.SessionLocal()
    try:
        sync_items(db)
        rows = db.query(LicWatch).all()
        if not rows:
            return False
        oldest = min((w.checked_at or "") for w in rows)
        return not oldest or datetime.now() - datetime.strptime(oldest, "%Y-%m-%d %H:%M:%S") >= timedelta(hours=CHECK_HOURS)
    finally:
        db.close()


def pending_changes(db: Session) -> list:
    """아직 확인 안 한 변경: [(항목 이름, 근거 이름)] — 아침 알림에서 씀."""
    names = {i.key: i.name for i in db.query(LicItem).all()}
    return [(names.get(w.item_key, w.item_key), w.label)
            for w in db.query(LicWatch).filter(LicWatch.acked == False).all()]   # noqa: E712


# ── API ───────────────────────────────────────────
def _watch_dict(w: Optional[LicWatch]):
    if not w:
        return None
    return {"id": w.id, "checked_at": w.checked_at, "ok_at": w.ok_at, "changed_at": w.changed_at,
            "acked": bool(w.acked), "acked_by": w.acked_by, "error": w.error, "pdf": bool(w.digest) and not w.text}


@router.get("")
def list_items(db: Session = Depends(get_db)):
    sync_items(db)
    watches = {(w.item_key, w.url): w for w in db.query(LicWatch).all()}
    items = []
    for it in db.query(LicItem).order_by(LicItem.sort).all():
        srcs = [dict(s, state=_watch_dict(watches.get((it.key, s["url"])))) for s in json.loads(it.sources or "[]")]
        items.append({"key": it.key, "category": it.category, "name": it.name, "vendor": it.vendor,
                      "summary": it.summary, "body": it.body, "edited": bool(it.edited),
                      "updated_at": it.updated_at, "updated_by": it.updated_by, "sources": srcs,
                      "changed": any(s["state"] and not s["state"]["acked"] for s in srcs)})
    checks = [w.checked_at for w in watches.values() if w.checked_at]
    return {"categories": [{"key": k, "label": l, "intro": G.CAT_INTRO.get(k, "")} for k, l in G.CATEGORIES],
            "reviewed": G.REVIEWED, "check_hours": CHECK_HOURS, "last_check": max(checks) if checks else "",
            "checking": _lock.locked(), "items": items}


@router.post("/check")
async def check_now():
    """'지금 확인' — 5분 간격 제한."""
    import asyncio
    global _last_manual
    if _lock.locked():
        raise HTTPException(409, detail="지금 확인하는 중입니다. 잠시 뒤 다시 보세요")
    if time.monotonic() - _last_manual < MANUAL_MIN_GAP:
        raise HTTPException(429, detail="방금 확인했습니다. 5분 뒤에 다시 시도해주세요")
    _last_manual = time.monotonic()
    return {"ok": True, **(await asyncio.to_thread(check_all))}


@router.get("/watch/{watch_id}/diff")
def watch_diff(watch_id: str, db: Session = Depends(get_db)):
    """바뀐 부분: 없어진 줄 / 새로 생긴 줄 (각 최대 120줄)."""
    w = db.query(LicWatch).filter(LicWatch.id == watch_id).first()
    if not w:
        raise HTTPException(404, detail="근거 페이지를 찾을 수 없습니다")
    old, new = (w.prev_text or "").split("\n"), (w.text or "").split("\n")
    removed, added = [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            removed += old[i1:i2]
        if tag in ("replace", "insert"):
            added += new[j1:j2]
    return {"label": w.label, "url": w.url, "changed_at": w.changed_at, "pdf": bool(w.digest) and not w.text,
            "removed": removed[:120], "added": added[:120], "more": max(len(removed), len(added)) > 120}


@router.post("/watch/{watch_id}/ack")
def ack_watch(watch_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    w = db.query(LicWatch).filter(LicWatch.id == watch_id).first()
    if not w:
        raise HTTPException(404, detail="근거 페이지를 찾을 수 없습니다")
    w.acked, w.acked_by = True, user["engineer_name"]
    db.commit()
    return {"ok": True}


class LicEdit(BaseModel):
    summary: str
    body: str


@router.put("/items/{key}", dependencies=[Depends(require_admin)])
def edit_item(key: str, data: LicEdit, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    it = db.query(LicItem).filter(LicItem.key == key).first()
    if not it:
        raise HTTPException(404, detail="항목을 찾을 수 없습니다")
    if not data.summary.strip() or not data.body.strip():
        raise HTTPException(400, detail="요약과 본문을 모두 입력해주세요")
    it.summary, it.body, it.edited = data.summary.strip(), data.body.strip() + "\n", True
    it.updated_at, it.updated_by = _now()[:16], user["engineer_name"]
    db.commit()
    return {"ok": True}


@router.post("/items/{key}/reset", dependencies=[Depends(require_admin)])
def reset_item(key: str, db: Session = Depends(get_db)):
    """화면에서 고친 내용을 버리고 기본 내용(license_guide.py)으로 되돌린다."""
    it = db.query(LicItem).filter(LicItem.key == key).first()
    if not it:
        raise HTTPException(404, detail="항목을 찾을 수 없습니다")
    it.edited, it.updated_at, it.updated_by = False, "", ""
    db.commit()
    sync_items(db)
    return {"ok": True}
