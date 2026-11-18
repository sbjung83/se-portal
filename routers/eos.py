"""OS별 EOS 현황 (지식 창고 > OS별 EOS 현황).

OS·버전별 지원 종료일을 하루 한 번 자동으로 받아 eos_products / eos_releases 에 저장한다 (엔지니어 공용 데이터).
- 대부분: endoflife.date API (제조사 공식 발표를 모은 오픈소스 데이터, https://endoflife.date/api/v1/products/<이름>/)
- Hyper-V Server: Microsoft 공식 수명 주기 페이지를 직접 읽는다 (날짜는 태평양 시간 오전 6:59 = 그 전날까지 지원)
- IBM HMC / PowerVM(VIOS): IBM FLRT(Fix Level Recommendation Tool) JSON — 레벨별 발표일·서비스팩 지원 종료일(EoSPS)을 릴리스 단위로 묶는다
- IBM PowerVC: IBM 공식 수명 주기 페이지(PowerVC Lifecycle Information) 표를 읽는다
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

CATEGORIES = ["Windows", "Linux", "Unix", "가상화", "IBM"]
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
    ("ibm-powervm", "IBM PowerVM (VIOS)", "IBM", "flrt"),
    ("ibm-hmc", "IBM HMC", "IBM", "flrt"),
    ("ibm-powervc", "IBM PowerVC", "IBM", "ibm"),
]

PRODUCT_NOTES = {
    "hyperv": "무료 단독 제품 Hyper-V Server 기준 (2019 이 마지막). Windows Server 의 Hyper-V 역할은 Windows Server 수명 주기를 따릅니다.",
    "hp-ux": "HPE 지원 표(Support Matrix) 공식 발표 기준으로 직접 입력한 값입니다 — 자동 갱신되지 않습니다.",
    "ibm-aix": "버전 = 릴리스.TL (예: 7.2.5 = AIX 7.2 TL5, oslevel 7200-05-xx).",
    "windows": "(W) = Home·Pro, (E) = Enterprise·Education.",
    "ibm-powervm": "PowerVM 은 VIOS(Virtual I/O Server) 레벨 기준 — 버전 = VIOS x.y.z (예: 4.1.2 = 4.1.2.xx 레벨들). "
                   "지원 종료 = 그 릴리스의 서비스팩 지원 종료일(EoSPS), 최신 = 그 릴리스의 최신 레벨. 시스템 펌웨어(하이퍼바이저)는 포함하지 않습니다.",
    "ibm-hmc": "버전 = HMC 릴리스(V R). 지원 종료 = 그 릴리스의 서비스팩 지원 종료일(EoSPS), 최신 = 그 릴리스의 최신 레벨(M). "
               "미발표 = IBM 이 아직 종료일을 정하지 않은 최신 릴리스.",
    "ibm-powervc": "IBM PowerVC for Private Cloud. 일반 지원 종료 칸 = 서비스팩 지원 종료(EoSPS, 이후 수정 없음), 지원 종료 = EOS.",
}

# IBM FLRT (키 → FLRT prodKey, 화면에 붙일 이름, 릴리스로 묶는 정규식)
FLRT = {
    "ibm-powervm": ("vios", "VIOS ", r"^(\d+\.\d+\.\d+)"),
    "ibm-hmc": ("hmc", "HMC ", r"^(V\d+\s*R\d+)"),
}
FLRT_URL = "https://esupport.ibm.com/customercare/flrt/liteTable?prodKey={}&format=json"
FLRT_POLICY = "https://esupport.ibm.com/customercare/flrt/lite"
POWERVC_URL = "https://www.ibm.com/support/pages/node/6856373"     # PowerVC Lifecycle Information

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


def _flrt_date(s: str) -> str:
    """'2026.08.14' → '2026-08-14', 'NA' → 'N'(미발표)."""
    s = (s or "").strip()
    if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", s):
        return s.replace(".", "-")
    return "N" if s.upper() == "NA" else ""


def _fetch_flrt(client: httpx.Client, key: str):
    """IBM FLRT 레벨 목록(최신 순)을 릴리스 단위로 묶는다: 발표일 = 첫 레벨, 지원 종료 = 가장 늦은 EoSPS."""
    prod, prefix, pat = FLRT[key]
    r = client.get(FLRT_URL.format(prod))
    r.raise_for_status()
    groups = {}
    for x in r.json().get("results") or []:
        lvl = (x.get("input") or "").strip()
        m = re.match(pat, lvl)
        if not m:
            continue
        cyc = re.sub(r"\s+", " ", m.group(1))
        groups.setdefault(cyc, []).append(x)
    rels = []
    for cyc, lv in groups.items():
        gas = [d for d in (_flrt_date(x.get("ga")) for x in lv) if len(d) == 10]
        eos = [_flrt_date(x.get("eosps")) for x in lv]
        dated = [d for d in eos if len(d) == 10]
        eol = "N" if "N" in eos else (max(dated) if dated else "")
        link = (lv[0].get("inputurl") or "").replace("http://", "https://", 1)
        rels.append({"cycle": cyc, "label": prefix + cyc, "lts": False, "release_date": min(gas) if gas else "",
                     "eoas": "", "eol": eol, "eoes": "", "latest": (lv[0].get("input") or "").strip(),
                     "link": link, "note": ""})
    return {"eoas": None, "eol": "End of Service Pack Support (EoSPS)", "eoes": None}, FLRT_POLICY, rels


def _ibm_date(s: str) -> str:
    s = re.sub(r"\s+", " ", s.strip())
    for f in ("%d %b %Y", "%d %B %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def _fetch_powervc(client: httpx.Client):
    """PowerVC Lifecycle Information 표: 릴리스(2.3.x 등)마다 여러 줄(중간 릴리스·서비스팩).
    줄마다 날짜가 [발표일, EoSPS, (EOS)] 순 → 릴리스별로 발표일 = 가장 이른 값, EoSPS·EOS = 가장 늦은 값."""
    import html as _html
    r = client.get(POWERVC_URL)
    r.raise_for_status()
    tables = re.findall(r"<table.*?</table>", r.text, re.S)
    table = next((t for t in tables if "EoSPS" in t or "End of Service Pack" in t), None)
    if not table:
        raise ValueError("PowerVC 수명 주기 표를 찾지 못했습니다")
    groups, cur = [], None
    for tr in re.findall(r"<tr.*?</tr>", table, re.S):
        cells = [_html.unescape(re.sub(r"<[^>]+>", " ", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if not cells:
            continue
        m = re.match(r"^(\d+\.\d+)\.x", cells[0])
        if m:
            cur = {"cycle": m.group(1), "rel": [], "eosps": [], "eos": [], "vers": []}
            groups.append(cur)
        if cur is None:
            continue
        dates = [d for d in (_ibm_date(c) for c in cells) if d]
        if dates:
            cur["rel"].append(dates[0])
        if len(dates) > 1:
            cur["eosps"].append(dates[1])
        if len(dates) > 2:
            cur["eos"].append(dates[2])
        cur["vers"] += re.findall(r"\b\d+\.\d+\.\d+(?:\.\d+)?\b", " ".join(cells))
    rels = []
    for g in groups:
        if not g["eos"] and not g["eosps"]:
            continue
        vers = sorted(set(g["vers"]), key=lambda v: [int(n) for n in v.split(".")])
        rels.append({"cycle": g["cycle"], "label": f"PowerVC {g['cycle']}", "lts": False,
                     "release_date": min(g["rel"]) if g["rel"] else "",
                     "eoas": max(g["eosps"]) if g["eosps"] else "", "eol": max(g["eos"]) if g["eos"] else "N",
                     "eoes": "", "latest": vers[-1] if vers else "", "link": POWERVC_URL, "note": ""})
    return {"eoas": "End of Service Pack Support (EoSPS)", "eol": "End of Support (EOS)", "eoes": None}, POWERVC_URL, rels


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
                        elif src == "flrt":
                            terms, policy, rels = _fetch_flrt(client, key)
                        elif src == "ibm":
                            terms, policy, rels = _fetch_powervc(client)
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
    cur = {k: (label, cat) for k, label, cat, _ in PRODUCTS}.get(p.key, (p.label, p.category))   # 이름·분류는 코드 값 (갱신 전에도 바로 반영)
    return {"key": p.key, "label": cur[0], "category": cur[1], "source": p.source, "policy_link": p.policy_link,
            "terms": json.loads(p.terms or "{}"), "note": p.note, "fetched_at": p.fetched_at, "checked_at": p.checked_at,
            "error": p.error,
            "releases": [{"id": r.id, "cycle": r.cycle, "label": r.label, "lts": bool(r.lts), "release_date": r.release_date,
                          "eoas": r.eoas, "eol": r.eol, "eoes": r.eoes, "latest": r.latest, "link": r.link, "note": r.note,
                          "changes": json.loads(r.changes or "{}"), "added_at": r.added_at} for r in rels]}


@router.get("")
def get_eos(db: Session = Depends(get_db)):
    order = {k: i for i, (k, *_) in enumerate(PRODUCTS)}
    prods = sorted(db.query(EosProduct).all(), key=lambda p: order.get(p.key, 999))
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
