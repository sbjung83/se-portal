"""장비의 OS 칸(자유 입력)을 'OS별 EOS 현황'(eos_releases)의 제품·버전과 맞춘다.

예) "ESXi7.0.3- 22348816" → esxi 7.0 / "AIX 7.2 TL05 SP05", "7200-05-05-2246" → ibm-aix 7.2.5
    "V10R2M1030" → ibm-hmc V10 R2 / "Rocky linux 9" → rocky-linux 9 / "Windows Server 2019" → windows-server 2019
버전을 알 수 없으면(예: "Windows", "linux") 맞추지 않는다(None).
상태는 화면의 eosStatus()와 같은 기준: end(지원 종료) / ext(연장 지원만) / soon(1년 안에 EOL) / maint(유지보수 단계) / ok(지원 중).
"""
import re
from datetime import date, datetime

from database import EosProduct, EosRelease

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_index(db) -> dict:
    """{제품 키: {"label": 화면 이름, "rels": {cycle 소문자: EosRelease}}}"""
    labels = {p.key: p.label for p in db.query(EosProduct).all()}
    idx = {}
    for r in db.query(EosRelease).all():
        idx.setdefault(r.product, {"label": labels.get(r.product, r.product), "rels": {}})["rels"][r.cycle.lower()] = r
    return idx


def _guess(text: str):
    """OS 글자 → (제품 키, 후보 cycle 목록). 모르면 None."""
    t = (text or "").lower().strip()
    if not t:
        return None
    t1 = re.sub(r"\s+", " ", t)
    tn = t1.replace(" ", "")
    # IBM AIX: "AIX 7.2 TL05 SP05" / oslevel "7200-05-05-2246" / "AIX 7.3.2"
    m = re.match(r"^(\d)(\d)00-(\d\d)", tn)
    if m:
        return "ibm-aix", [f"{m[1]}.{m[2]}.{int(m[3])}"]
    if "aix" in t1:
        m = re.search(r"(\d)\.(\d)(?:\.(\d+)|\s*tl\s*0*(\d+))?", t1)
        if m:
            tl = m[3] or m[4]
            return "ibm-aix", ([f"{m[1]}.{m[2]}.{int(tl)}"] if tl else []) + [f"{m[1]}.{m[2]}"]
        return None
    # IBM HMC: "V10R2M1030" / "HMC V10 R3"
    m = re.search(r"v(\d+)\s*r(\d+)", t1)
    if m and ("hmc" in t1 or re.match(r"^v\d+\s*r\d+", t1)):
        return "ibm-hmc", [f"v{m[1]} r{m[2]}"]
    if "vios" in t1 or "powervm" in t1:
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", t1)
        return ("ibm-powervm", [f"{m[1]}.{m[2]}.{m[3]}"]) if m else None
    if "powervc" in t1:
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", t1)
        return ("ibm-powervc", [f"{m[1]}.{m[2]}.{m[3]}", f"{m[1]}.{m[2]}"]) if m else None
    # VMware
    if "esxi" in tn or "vsphere" in tn:
        m = re.search(r"(\d+)(?:\.(\d+))?", t1.split("esxi", 1)[-1] if "esxi" in t1 else t1)
        return ("esxi", [f"{m[1]}.{m[2] or 0}"]) if m else None
    if "vcenter" in tn or "vcsa" in tn:
        m = re.search(r"(\d+)(?:\.(\d+))?", t1)
        return ("vcenter", [f"{m[1]}.{m[2] or 0}"]) if m else None
    if "proxmox" in t1 or re.search(r"\bpve\b", t1):
        m = re.search(r"(\d+)", t1)
        return ("proxmox-ve", [m[1]]) if m else None
    # Hyper-V Server (단독 제품)
    if "hyper-v" in tn or "hyperv" in tn:
        m = re.search(r"(20\d\d)\s*(r2)?", t1)
        return ("hyperv", [f"{m[1]} R2".lower() if m[2] else m[1]]) if m else None
    # Windows Server / Windows
    if "win" in t1:
        m = re.search(r"(20\d\d)\s*(r2)?", t1)
        if m and ("server" in t1 or m[1] in ("2003", "2008", "2012", "2016", "2019", "2022", "2025")):
            y = m[1]
            if m[2]:
                return "windows-server", [f"{y}-r2", f"{y}-r2-sp1"]
            return "windows-server", [y, f"{y}-sp2", f"{y}-sp1"]
        return None
    # Linux
    for key, words, pat in (
        ("rhel", ("rhel", "red hat", "redhat"), r"(\d+)(?:\.\d+)?"),
        ("rocky-linux", ("rocky",), r"(\d+)(?:\.\d+)?"),
        ("ubuntu", ("ubuntu",), r"(\d+\.\d+)"),
        ("debian", ("debian",), r"(\d+)"),
        ("fedora", ("fedora",), r"(\d+)"),
    ):
        if any(w in t1 for w in words):
            m = re.search(pat, t1)
            return (key, [m[1]]) if m else None
    if "solaris" in t1:
        m = re.search(r"(\d+)(?:\.(\d+))?", t1)
        return ("oracle-solaris", ([f"{m[1]}.{m[2]}"] if m[2] else []) + [m[1]]) if m else None
    if "hp-ux" in t1 or "hpux" in tn:
        return "hp-ux", ["11i v3"]
    return None


def status_of(eol: str, eoas: str, eoes: str, today: str) -> str:
    ended = eol == "Y" or (bool(_DATE.match(eol or "")) and eol < today)
    if ended:
        return "ext" if _DATE.match(eoes or "") and eoes >= today else "end"
    if _DATE.match(eol or "") and (date.fromisoformat(eol) - date.fromisoformat(today)).days <= 365:
        return "soon"
    if eoas == "Y" or (_DATE.match(eoas or "") and eoas < today):
        return "maint"
    return "ok"


def match_os(text: str, idx: dict, today: str = None):
    """맞추면 {product, product_label, cycle, label, eol, eoes, state, days} / 못 맞추면 None."""
    g = _guess(text)
    if not g:
        return None
    key, cycles = g
    prod = idx.get(key)
    if not prod:
        return None
    rel = next((prod["rels"][c.lower()] for c in cycles if c.lower() in prod["rels"]), None)
    today = today or datetime.now().strftime("%Y-%m-%d")
    if not rel:
        # 표에 없는 옛 TL(예: AIX 7.1.4): 같은 릴리스의 더 높은 TL 이 이미 지원 종료면 이것도 종료로 본다
        m = re.match(r"^(\d+\.\d+)\.(\d+)$", cycles[0])
        if not m:
            return None
        newer = [r for c, r in prod["rels"].items()
                 if c.startswith(m[1] + ".") and c[len(m[1]) + 1:].isdigit() and int(c[len(m[1]) + 1:]) > int(m[2])]
        if newer and all(status_of(r.eol or "", r.eoas or "", r.eoes or "", today) == "end" for r in newer):
            return {"product": key, "product_label": prod["label"], "cycle": cycles[0], "label": cycles[0],
                    "eol": "Y", "eoes": "", "state": "end", "days": None}
        return None
    eol = rel.eol or ""
    days = (date.fromisoformat(eol) - date.fromisoformat(today)).days if _DATE.match(eol) else None
    return {"product": key, "product_label": prod["label"], "cycle": rel.cycle, "label": rel.label or rel.cycle,
            "eol": eol, "eoes": rel.eoes or "", "state": status_of(eol, rel.eoas or "", rel.eoes or "", today),
            "days": days}


def needs_attention(m) -> bool:
    """사이트 '확인할 것'·대시보드에 올릴 상태: 지원 종료 / 연장 지원만 / 1년 안에 종료."""
    return bool(m) and m["state"] in ("end", "ext", "soon")


def device_alert(dev, idx):
    """장비(Device) 한 대의 경고용 결과: 철수한 장비는 제외, 지원 종료·연장만·임박일 때만 match 결과를 돌려준다."""
    if not idx or (dev.status or "") == "철수":
        return None
    m = match_os(dev.os, idx)
    return m if needs_attention(m) else None
