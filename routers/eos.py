"""OS별 EOS 현황 (지식 창고 > OS별 EOS 현황).

OS·버전별 지원 종료일을 하루 한 번 자동으로 받아 eos_products / eos_releases 에 저장한다 (엔지니어 공용 데이터).
- 대부분: endoflife.date API (제조사 공식 발표를 모은 오픈소스 데이터, https://endoflife.date/api/v1/products/<이름>/)
- Hyper-V Server: Microsoft 공식 수명 주기 페이지를 직접 읽는다 (날짜는 태평양 시간 오전 6:59 = 그 전날까지 지원)
- HP-UX: HPE 사이트를 서버에서 읽을 수 없어 공식 발표 값을 아래 MANUAL 에 직접 둔다 (자동 갱신 안 됨)

날짜 칸 값: "YYYY-MM-DD" / "Y"(종료됐지만 날짜 모름) / "N"(종료일 미발표) / ""(그 제품엔 해당 없음).
갱신에 실패한 제품은 마지막으로 받은 값을 그대로 둔다. 날짜가 바뀌면 changes 에 이전 값을 남긴다(화면에 '변경' 표시).
"""
import json
import re
import threading
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import database
from database import EosProduct, EosRelease, get_db

router = APIRouter(prefix="/api/eos", tags=["eos"])

CATEGORIES = ["Windows", "Linux", "Unix", "가상화"]
REFRESH_HOURS = 24          # 자동 갱신 간격
RETRY_MINUTES = 60          # 실패했을 때 다시 시도하는 간격
MANUAL_MIN_GAP = 5 * 60     # '지금 갱신' 버튼 최소 간격(초)
UA = {"User-Agent": "SE-Portal-EOS/1.0"}

# (키, 화면 이름, 분류, 받는 곳)
PRODUCTS = [
    ("windows-server", "Windows Server", "Windows", "endoflife"),
    ("windows", "Windows (클라이언트)", "Windows", "endoflife"),
    ("rhel", "Red Hat Enterprise Linux", "Linux", "endoflife"),
    ("rocky-linux", "Rocky Linux", "Linux", "endoflife"),
    ("ubuntu", "Ubuntu", "Linux", "endoflife"),
    ("debian", "Debian", "Linux", "endoflife"),
    ("fedora", "Fedora Linux", "Linux", "endoflife"),
    ("ibm-aix", "IBM AIX", "Unix", "endoflife"),
    ("hp-ux", "HPE HP-UX", "Unix", "manual"),
    ("oracle-solaris", "Oracle Solaris", "Unix", "endoflife"),
    ("esxi", "VMware ESXi", "가상화", "endoflife"),
    ("vcenter", "VMware vCenter Server", "가상화", "endoflife"),
    ("hyperv", "Microsoft Hyper-V Server", "가상화", "microsoft"),
    ("proxmox-ve", "Proxmox VE", "가상화", "endoflife"),
]

PRODUCT_NOTES = {
    "hyperv": "무료 단독 제품 Hyper-V Server 기준 (2019 이 마지막). Windows Server 의 Hyper-V 역할은 Windows Server 수명 주기를 따릅니다.",
    "hp-ux": "HPE 지원 표(Support Matrix) 공식 발표 기준으로 직접 입력한 값입니다 — 자동 갱신되지 않습니다.",
    "ibm-aix": "버전 = 릴리스.TL (예: 7.2.5 = AIX 7.2 TL5, oslevel 7200-05-xx).",
    "windows": "(W) = Home·Pro, (E) = Enterprise·Education.",
}

# Hyper-V Server: Microsoft 수명 주기 페이지 (페이지 주소 끝, 버전 이름)
HYPERV_PAGES = [("hyperv-server-2019", "2019"), ("hyperv-server-2016", "2016"), ("hyperv-server-2012-r2", "2012 R2")]
HYPERV_POLICY = "https://learn.microsoft.com/lifecycle/products/?terms=Hyper-V%20Server"

# 자동으로 받을 수 없는 제품 — 공식 발표 값을 직접 둔다
MANUAL = {
    "hp-ux": {
        "policy": "https://www.hpe.com/global/softwarereleases/releases-media2/HPEredesign/pages/matrixguide.html",
        "terms": {"eoas": None, "eol": "Standard Support", "eoes": "Mature Support (Sustaining Engineering 없음)"},
        "releases": [
            {"cycle": "11i v3", "label": "HP-UX 11i v3 (Integrity)", "release_date": "", "eoas": "",
             "eol": "2025-12-31", "eoes": "2028-12-31", "latest": "2505.11iv3",
             "note": "표준 지원 2025-12-31 종료. 이후 성숙 지원(패치 개발 없음)은 최소 2028-12-31 까지 (HPE Support Matrix)"},
        ],
    },
}

_lock = threading.Lock()
_last_manual = 0.0


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _dv(flag, date) -> str:
    """endoflife.date 의 (isXxx, xxxFrom) → 저장 값."""
    if date:
        return str(date)[:10]
    if flag is True:
        return "Y"
    if flag is False:
        return "N"
    return ""


def _fetch_endoflife(client: httpx.Client, key: str):
    r = client.get(f"https://endoflife.date/api/v1/products/{key}/")
    r.raise_for_status()
    d = r.json()["result"]
    labels = d.get("labels") or {}
    rels = []
    for x in d.get("releases") or []:
        latest = x.get("latest") or {}
        rels.append({
            "cycle": str(x.get("name", "")), "label": x.get("label") or str(x.get("name", "")),
            "lts": bool(x.get("isLts")), "release_date": (x.get("releaseDate") or "")[:10],
            "eoas": _dv(x.get("isEoas"), x.get("eoasFrom")) if labels.get("eoas") else "",
            "eol": _dv(x.get("isEol"), x.get("eolFrom")),
            "eoes": _dv(x.get("isEoes"), x.get("eoesFrom")) if labels.get("eoes") else "",
            "latest": latest.get("name") or "", "link": latest.get("link") or "", "note": "",
        })
    policy = (d.get("links") or {}).get("releasePolicy") or (d.get("links") or {}).get("html") or ""
    return {"eoas": labels.get("eoas"), "eol": labels.get("eol"), "eoes": labels.get("eoes")}, policy, rels


def _ms_date(s: str, end: bool) -> str:
    """'1/10/2024 6:59:59 AM'(태평양 시간) → 'YYYY-MM-DD'. 종료 시각이 오전이면 그 전날까지 지원한 것."""
    dt = datetime.strptime(s.strip(), "%m/%d/%Y %I:%M:%S %p")
    if end and dt.hour < 12:
        dt -= timedelta(days=1)
    return dt.strftime("%Y-%m-%d")


def _fetch_hyperv(client: httpx.Client):
    rels = []
    for page, name in HYPERV_PAGES:
        url = f"https://learn.microsoft.com/en-us/lifecycle/products/{page}"
        r = client.get(url)
        r.raise_for_status()
        part = r.text.split("Support Dates", 1)[-1]
        dates = re.findall(r'<local-time[^>]*datetime="([^"]+)"', part)
        if len(dates) < 3:
            raise ValueError(f"{page}: 지원 날짜 표를 찾지 못했습니다")
        rels.append({"cycle": name, "label": f"Hyper-V Server {name}", "lts": False,
                     "release_date": _ms_date(dates[0], False), "eoas": _ms_date(dates[1], True),
                     "eol": _ms_date(dates[2], True), "eoes": "", "latest": "", "link": url, "note": ""})
    return {"eoas": "Mainstream Support", "eol": "Extended Support", "eoes": None}, HYPERV_POLICY, rels


def _store(db: Session, key: str, rels: list):
    """받은 버전 목록을 저장하고, 날짜가 바뀐 칸은 changes 에 이전 값을 남긴다."""
    today = datetime.now().strftime("%Y-%m-%d")
    have = {r.id: r for r in db.query(EosRelease).filter(EosRelease.product == key).all()}
    first = not have
    seen = set()
    for i, x in enumerate(rels):
        rid = f"{key}:{x['cycle']}"
        if rid in seen:
            continue
        seen.add(rid)
        r = have.get(rid)
        if not r:
            r = EosRelease(id=rid, product=key, changes="{}", added_at="" if first else today)
            db.add(r)
        else:
            ch = json.loads(r.changes or "{}")
            for f in ("eoas", "eol", "eoes"):
                old, new = getattr(r, f) or "", x[f] or ""
                if old and old != new:
                    ch[f] = {"old": old, "new": new, "at": today}
            r.changes = json.dumps(ch, ensure_ascii=False)
        for f in ("cycle", "label", "lts", "release_date", "eoas", "eol", "eoes", "latest", "link", "note"):
            setattr(r, f, x[f])
        r.order_idx = i
    for rid, r in have.items():
        if rid not in seen:
            db.delete(r)


def refresh_all() -> dict:
    """모든 제품을 다시 받는다. 실패한 제품은 이전 값을 유지한다."""
    with _lock:
        db = database.SessionLocal()
        ok, failed = 0, []
        try:
            with httpx.Client(timeout=20, headers=UA, follow_redirects=True) as client:
                for idx, (key, label, cat, src) in enumerate(PRODUCTS):
                    p = db.query(EosProduct).filter(EosProduct.key == key).first()
                    if not p:
                        p = EosProduct(key=key)
                        db.add(p)
                    p.label, p.category, p.source, p.order_idx = label, cat, src, idx
                    p.note = PRODUCT_NOTES.get(key, "")
                    p.checked_at = _now()
                    try:
                        if src == "endoflife":
                            terms, policy, rels = _fetch_endoflife(client, key)
                        elif src == "microsoft":
                            terms, policy, rels = _fetch_hyperv(client)
                        else:
                            m = MANUAL[key]
                            terms, policy, rels = m["terms"], m["policy"], [dict({"lts": False, "link": ""}, **x) for x in m["releases"]]
                        if not rels:
                            raise ValueError("버전 정보가 비어 있습니다")
                        _store(db, key, rels)
                        p.terms, p.policy_link = json.dumps(terms, ensure_ascii=False), policy
                        p.fetched_at, p.error = p.checked_at, ""
                        ok += 1
                    except Exception as e:
                        p.error = f"{type(e).__name__}: {e}"[:200]
                        failed.append(label)
                    db.commit()
            db.query(EosProduct).filter(EosProduct.key.notin_([k for k, *_ in PRODUCTS])).delete(synchronize_session=False)
            db.query(EosRelease).filter(EosRelease.product.notin_([k for k, *_ in PRODUCTS])).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        return {"ok": ok, "failed": failed}


def refresh_due() -> bool:
    """자동 갱신할 때인지: 마지막 성공이 REFRESH_HOURS 전이고, 마지막 시도가 RETRY_MINUTES 전."""
    db = database.SessionLocal()
    try:
        rows = db.query(EosProduct).all()
        if len(rows) < len(PRODUCTS):
            return True
        now = datetime.now()
        last_ok = min((r.fetched_at or "") for r in rows)
        last_try = max((r.checked_at or "") for r in rows)
        def ago(s):
            return (now - datetime.strptime(s, "%Y-%m-%d %H:%M:%S")) if s else timedelta(days=999)
        return ago(last_ok) >= timedelta(hours=REFRESH_HOURS) and ago(last_try) >= timedelta(minutes=RETRY_MINUTES)
    finally:
        db.close()


def _product_dict(p: EosProduct, rels: list) -> dict:
    return {"key": p.key, "label": p.label, "category": p.category, "source": p.source, "policy_link": p.policy_link,
            "terms": json.loads(p.terms or "{}"), "note": p.note, "fetched_at": p.fetched_at, "checked_at": p.checked_at,
            "error": p.error,
            "releases": [{"id": r.id, "cycle": r.cycle, "label": r.label, "lts": bool(r.lts), "release_date": r.release_date,
                          "eoas": r.eoas, "eol": r.eol, "eoes": r.eoes, "latest": r.latest, "link": r.link, "note": r.note,
                          "changes": json.loads(r.changes or "{}"), "added_at": r.added_at} for r in rels]}


@router.get("")
def get_eos(db: Session = Depends(get_db)):
    prods = db.query(EosProduct).order_by(EosProduct.order_idx).all()
    rels = {}
    for r in db.query(EosRelease).order_by(EosRelease.product, EosRelease.order_idx).all():
        rels.setdefault(r.product, []).append(r)
    times = [p.fetched_at for p in prods if p.fetched_at]
    return {"categories": CATEGORIES, "refresh_hours": REFRESH_HOURS,
            "last_refresh": max(times) if times else "", "refreshing": _lock.locked(),
            "products": [_product_dict(p, rels.get(p.key, [])) for p in prods]}


@router.post("/refresh")
async def refresh_now(db: Session = Depends(get_db)):
    """'지금 갱신' — 너무 자주 누르지 않도록 5분 간격."""
    import asyncio, time
    global _last_manual
    if _lock.locked():
        raise HTTPException(409, detail="지금 갱신하는 중입니다. 잠시 뒤 다시 확인해주세요")
    if time.monotonic() - _last_manual < MANUAL_MIN_GAP:
        raise HTTPException(429, detail="방금 갱신했습니다. 5분 뒤에 다시 시도해주세요")
    _last_manual = time.monotonic()
    res = await asyncio.to_thread(refresh_all)
    return {"ok": True, **res}
