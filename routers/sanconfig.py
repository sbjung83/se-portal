"""SAN Switch 설정 백업 (사이트 관리 > 장비 리스트 > 'SAN 설정').

- 장비 1대에 설정 버전 여러 개(device_configs). 원문은 secure_store 로 암호화 저장(SNMP 커뮤니티·계정 해시 등이 들어 있을 수 있음).
- 받는 자료: Brocade `configupload` 파일([Zoning] 의 cfg./zone./alias. 줄), Brocade `cfgshow` 출력,
  Cisco MDS `copy running-config scp:/tftp:` 파일 또는 `show running-config` 출력(device-alias / fcalias / zone / zoneset).
- 읽어서 존·별칭·WWN·활성 cfg(zoneset) 를 정리하고, 버전 비교(존 변경 + 줄 비교)와 사이트 전체 WWN·이름 검색을 한다.
"""
import difflib
import hashlib
import json
import re
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

import secure_store
from database import Device, DeviceConfig, get_db
from routers.sites import _get_valid_site

router = APIRouter(prefix="/api/engineers/{eng_id}/sites/{site_id}", tags=["sanconfig"])

MAX_BYTES = 5 * 1024 * 1024
WWN_RE = re.compile(r"\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){7}\b")


# ── 읽기 (Brocade / Cisco) ─────────────────────────
def _wwns(text: str):
    return [w.lower() for w in WWN_RE.findall(text or "")]


def _split(members: str):
    return [m.strip() for m in re.split(r"[;\s]+", members or "") if m.strip()]


def _parse_brocade(text: str):
    """configupload([Zoning] 의 cfg.X:a;b / zone.X:.. / alias.X:.. / enable:X) 또는 cfgshow 출력."""
    cfgs, zones, aliases, active = {}, {}, {}, []
    lines = text.splitlines()
    sec = ""
    found = False
    for ln in lines:
        s = ln.strip()
        if s.startswith("[") and s.endswith("]"):
            sec = s.lower()
            continue
        m = re.match(r"^(cfg|zone|alias)\.([^:\s]+):(.*)$", s)
        if m and (sec in ("", "[zoning]") or "zoning" in sec):
            kind, name, mem = m.group(1), m.group(2), _split(m.group(3))
            {"cfg": cfgs, "zone": zones, "alias": aliases}[kind][name] = mem
            found = True
            continue
        m = re.match(r"^enable:\s*(\S+)$", s)
        if m and (sec in ("", "[zoning]") or "zoning" in sec):
            active.append(m.group(1))
    if found:
        return cfgs, zones, aliases, active
    # cfgshow: Defined configuration: / Effective configuration:
    part, last = "", None
    for ln in lines:
        s = ln.strip()
        if s.lower().startswith("defined configuration"):
            part = "def"; last = None; continue
        if s.lower().startswith("effective configuration"):
            part = "eff"; last = None; continue
        m = re.match(r"^(cfg|zone|alias):\s+(\S+)\s*(.*)$", s)
        if m:
            kind, name, rest = m.groups()
            if part == "eff":
                if kind == "cfg":
                    active.append(name)
                last = None
                continue
            tgt = {"cfg": cfgs, "zone": zones, "alias": aliases}[kind]
            tgt[name] = _split(rest)
            last = tgt[name]
            found = True
        elif last is not None and s and part == "def" and ln[:1].isspace():
            last.extend(_split(s))          # 멤버가 다음 줄로 넘어간 경우
        elif not s:
            last = None
    return (cfgs, zones, aliases, active) if found else None


def _parse_cisco(text: str):
    """MDS running-config: device-alias name X pwwn W / fcalias name X vsan N / zone name Z vsan N / zoneset name S vsan N."""
    cfgs, zones, aliases, active = {}, {}, {}, []
    cur, found = None, False
    for ln in text.splitlines():
        s = ln.strip()
        m = re.match(r"^device-alias name (\S+) pwwn (\S+)", s)
        if m:
            aliases[m.group(1)] = [m.group(2).lower()]; found = True; cur = None; continue
        m = re.match(r"^zoneset activate name (\S+) vsan (\d+)", s)
        if m:
            active.append(f"{m.group(1)}@{m.group(2)}"); cur = None; continue
        m = re.match(r"^(fcalias|zone|zoneset) name (\S+) vsan (\d+)", s)
        if m:
            kind, name, vsan = m.groups()
            key = f"{name}@{vsan}"
            tgt = {"fcalias": aliases, "zone": zones, "zoneset": cfgs}[kind]
            tgt.setdefault(key, [])
            cur = tgt[key]; found = True
            continue
        if cur is not None and ln[:1].isspace():
            m = re.match(r"^member\s+(.*)$", s)
            if m:
                body = m.group(1).split()
                if body and body[0] in ("pwwn", "device-alias", "fcalias") and len(body) > 1:
                    v = body[1].lower() if body[0] == "pwwn" else body[1]
                    cur.append(v)
                else:
                    cur.append(" ".join(body))
            continue
        if s and not ln[:1].isspace():
            cur = None
    if not found:
        return None
    # zoneset 의 멤버(zone 이름)는 같은 vsan 의 zone 으로
    for key, mem in cfgs.items():
        vs = key.split("@")[1]
        cfgs[key] = [z if "@" in z else f"{z}@{vs}" for z in mem]
    return cfgs, zones, aliases, active


def detect_vendor(text: str) -> str:
    head = text[:20000]
    if re.search(r"^\[Zoning\]|^zone\.\S+:|Defined configuration:|^\s*zone:\s", head, re.M) or "configupload" in head.lower():
        return "brocade"
    if re.search(r"^(zoneset|zone) name \S+ vsan \d+|^device-alias database|^version \d.*NX-OS|^feature ", head, re.M):
        return "cisco"
    if re.search(r"^(cfg|zone|alias)\.", text, re.M):
        return "brocade"
    if re.search(r"^zone name \S+ vsan", text, re.M):
        return "cisco"
    return ""


def parse(text: str, vendor: str = ""):
    """→ {vendor, active[], cfgs{}, zones[{name,vsan,active,members[{name,kind,wwns}]}], aliases[{name,vsan,wwns}]}"""
    vendor = vendor or detect_vendor(text)
    r = (_parse_cisco(text) if vendor == "cisco" else _parse_brocade(text)) if vendor else None
    if r is None:
        r = _parse_brocade(text) or _parse_cisco(text)
    if r is None:
        return {"vendor": vendor, "ok": False, "active": [], "cfgs": {}, "zones": [], "aliases": []}
    cfgs, zones, aliases, active = r
    nm = lambda k: k.split("@")[0]
    vs = lambda k: k.split("@")[1] if "@" in k else ""
    # 별칭 이름으로 찾기 (Cisco 는 이름@vsan, device-alias 는 vsan 없음)
    def resolve(member, vsan):
        if WWN_RE.fullmatch(member):
            return {"name": member.lower(), "kind": "wwn", "wwns": [member.lower()]}
        for key in (f"{member}@{vsan}", member):
            if key in aliases:
                ws = []
                for x in aliases[key]:
                    if WWN_RE.fullmatch(x):
                        ws.append(x.lower())
                    elif x in aliases:
                        ws += [w for w in aliases[x] if WWN_RE.fullmatch(w)]
                return {"name": member, "kind": "alias", "wwns": ws}
        return {"name": member, "kind": "other", "wwns": _wwns(member)}
    act_zones = set()
    for a in active:
        act_zones.update(cfgs.get(a, []))
    zl = [{"name": nm(k), "key": k, "vsan": vs(k), "active": k in act_zones,
           "cfgs": [nm(c) for c, zs in cfgs.items() if k in zs],
           "members": [resolve(m, vs(k)) for m in mem]} for k, mem in zones.items()]
    zl.sort(key=lambda z: (not z["active"], z["vsan"], z["name"].lower()))
    al = [{"name": nm(k), "key": k, "vsan": vs(k),
           "wwns": [w.lower() for w in v if WWN_RE.fullmatch(w)] or _wwns(" ".join(v)),
           "zones": [z["name"] for z in zl if any(m["kind"] == "alias" and m["name"] == nm(k) for m in z["members"])]}
          for k, v in aliases.items()]
    al.sort(key=lambda a: (a["vsan"], a["name"].lower()))
    return {"vendor": vendor or "", "ok": True, "active": [nm(a) + (f" (VSAN {vs(a)})" if vs(a) else "") for a in active],
            "cfgs": {nm(k) + (f" (VSAN {vs(k)})" if vs(k) else ""): [nm(z) for z in v] for k, v in cfgs.items()},
            "zones": zl, "aliases": al}


def _summary(p):
    return {"zones": len(p["zones"]), "active_zones": sum(1 for z in p["zones"] if z["active"]),
            "aliases": len(p["aliases"]), "active": p["active"], "ok": p["ok"]}


def _decode(raw: bytes) -> str:
    if b"\x00" in raw[:4096]:
        raise HTTPException(400, detail="텍스트 설정 파일이 아닙니다 (supportsave 묶음·압축 파일은 받지 않습니다 — configupload 결과 파일을 올려 주세요)")
    for enc in ("utf-8", "cp949", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", "replace")


# ── API ───────────────────────────────────────────
def _device(eng_id, site_id, dev_id, db):
    _get_valid_site(eng_id, site_id, db)
    dev = db.query(Device).filter(Device.id == dev_id, Device.site_id == site_id).first()
    if not dev:
        raise HTTPException(404, detail="장비를 찾을 수 없습니다")
    return dev


def _config(dev, cfg_id, db):
    c = db.query(DeviceConfig).filter(DeviceConfig.id == cfg_id, DeviceConfig.device_id == dev.id).first()
    if not c:
        raise HTTPException(404, detail="설정을 찾을 수 없습니다")
    return c


def _text(c: DeviceConfig) -> str:
    return secure_store.decrypt(c.content or "")


def _cfg_dict(c: DeviceConfig):
    return {"id": c.id, "taken_date": c.taken_date, "memo": c.memo or "", "filename": c.filename or "",
            "vendor": c.vendor or "", "size": c.size or 0, "created_at": c.created_at or "",
            "summary": json.loads(c.summary or "{}")}


def _sorted(dev):
    return sorted(dev.configs, key=lambda c: (c.taken_date or "", c.created_at or ""), reverse=True)


@router.get("/devices/{dev_id}/configs")
def list_configs(eng_id: str, site_id: str, dev_id: str, db: Session = Depends(get_db)):
    dev = _device(eng_id, site_id, dev_id, db)
    return {"device": {"id": dev.id, "name": dev.name, "model": dev.model or "", "dev_type": dev.dev_type},
            "items": [_cfg_dict(c) for c in _sorted(dev)]}


@router.post("/devices/{dev_id}/configs")
async def add_config(eng_id: str, site_id: str, dev_id: str, file: Optional[UploadFile] = File(None),
                     text: str = Form(""), taken_date: str = Form(""), memo: str = Form(""),
                     db: Session = Depends(get_db)):
    dev = _device(eng_id, site_id, dev_id, db)
    if file is not None and file.filename:
        raw = await file.read(MAX_BYTES + 1)
        name = file.filename
    else:
        raw = (text or "").encode("utf-8")
        name = ""
    if not raw.strip():
        raise HTTPException(400, detail="설정 파일을 고르거나 내용을 붙여 넣어 주세요")
    if len(raw) > MAX_BYTES:
        raise HTTPException(400, detail="설정 파일은 5MB 까지 올릴 수 있습니다")
    body = _decode(raw).replace("\r\n", "\n")
    p = parse(body)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", taken_date or ""):
        taken_date = datetime.now().strftime("%Y-%m-%d")
    sha = hashlib.sha256(body.encode()).hexdigest()
    prev = next(iter(_sorted(dev)), None)
    c = DeviceConfig(id=str(uuid.uuid4()), device_id=dev.id, taken_date=taken_date, memo=(memo or "").strip()[:200],
                     filename=(name or "")[:200], vendor=p["vendor"], size=len(body.encode()), sha256=sha,
                     content=secure_store.encrypt(body), summary=json.dumps(_summary(p), ensure_ascii=False),
                     created_at=datetime.now().strftime("%Y-%m-%d %H:%M"))
    db.add(c); db.commit()
    return {**_cfg_dict(c), "same_as_prev": bool(prev and prev.sha256 == sha), "parsed": p["ok"]}


class CfgUpdate(BaseModel):
    taken_date: Optional[str] = None
    memo: Optional[str] = None


@router.patch("/devices/{dev_id}/configs/{cfg_id}")
def update_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, data: CfgUpdate, db: Session = Depends(get_db)):
    c = _config(_device(eng_id, site_id, dev_id, db), cfg_id, db)
    if data.taken_date is not None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data.taken_date):
            raise HTTPException(400, detail="날짜 형식이 올바르지 않습니다")
        c.taken_date = data.taken_date
    if data.memo is not None:
        c.memo = data.memo.strip()[:200]
    db.commit()
    return _cfg_dict(c)


@router.delete("/devices/{dev_id}/configs/{cfg_id}")
def delete_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, db: Session = Depends(get_db)):
    c = _config(_device(eng_id, site_id, dev_id, db), cfg_id, db)
    db.delete(c); db.commit()
    return {"ok": True}


@router.get("/devices/{dev_id}/configs/{cfg_id}")
def get_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, raw: bool = False, db: Session = Depends(get_db)):
    """정리된 존·별칭 (raw=1 이면 원문도)."""
    c = _config(_device(eng_id, site_id, dev_id, db), cfg_id, db)
    t = _text(c)
    out = {**_cfg_dict(c), **parse(t, c.vendor or "")}
    if raw:
        out["text"] = t
    return out


@router.get("/devices/{dev_id}/configs/{cfg_id}/download")
def download_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, db: Session = Depends(get_db)):
    dev = _device(eng_id, site_id, dev_id, db)
    c = _config(dev, cfg_id, db)
    fname = c.filename or f"{dev.name}_{c.taken_date}.txt"
    return Response(_text(c).encode("utf-8"), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"})


@router.get("/devices/{dev_id}/configs/{cfg_id}/diff")
def diff_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, base: str, db: Session = Depends(get_db)):
    """base(이전) → cfg_id(이후): 존·별칭·활성 cfg 변경 + 줄 비교."""
    dev = _device(eng_id, site_id, dev_id, db)
    new, old = _config(dev, cfg_id, db), _config(dev, base, db)
    tn, to = _text(new), _text(old)
    pn, po = parse(tn, new.vendor or ""), parse(to, old.vendor or "")

    def zmap(p):
        return {(z["name"], z["vsan"]): [m["name"] for m in z["members"]] for z in p["zones"]}

    def amap(p):
        return {(a["name"], a["vsan"]): a["wwns"] for a in p["aliases"]}

    def cmp(a, b):
        added = [{"name": k[0], "vsan": k[1], "members": b[k]} for k in b if k not in a]
        removed = [{"name": k[0], "vsan": k[1], "members": a[k]} for k in a if k not in b]
        changed = [{"name": k[0], "vsan": k[1], "added": [m for m in b[k] if m not in a[k]],
                    "removed": [m for m in a[k] if m not in b[k]]}
                   for k in a if k in b and sorted(a[k]) != sorted(b[k])]
        return {"added": added, "removed": removed, "changed": changed}

    ol, nl = to.split("\n"), tn.split("\n")
    rem, add = [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ol, nl, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            rem += ol[i1:i2]
        if tag in ("replace", "insert"):
            add += nl[j1:j2]
    return {"from": _cfg_dict(old), "to": _cfg_dict(new),
            "active": {"before": po["active"], "after": pn["active"]},
            "zones": cmp(zmap(po), zmap(pn)), "aliases": cmp(amap(po), amap(pn)),
            "lines": {"removed": rem[:300], "added": add[:300], "more": max(len(rem), len(add)) > 300}}


@router.get("/san/search")
def san_search(eng_id: str, site_id: str, q: str, db: Session = Depends(get_db)):
    """사이트의 모든 장비 최신 설정에서 WWN(일부) 또는 별칭·존 이름으로 찾는다."""
    _get_valid_site(eng_id, site_id, db)
    q = (q or "").strip().lower()
    if len(q) < 3:
        raise HTTPException(400, detail="세 글자 이상 입력해주세요")
    hexq = re.sub(r"[:\-\s]", "", q)
    is_hex = bool(re.fullmatch(r"[0-9a-f]{4,16}", hexq))
    hit_w = lambda w: is_hex and hexq in w.replace(":", "")
    rows = []
    for dev in db.query(Device).filter(Device.site_id == site_id).all():
        if not dev.configs:
            continue
        c = _sorted(dev)[0]
        p = parse(_text(c), c.vendor or "")
        for z in p["zones"]:
            for m in z["members"]:
                ws = m["wwns"] or [""]
                for w in ws:
                    if hit_w(w) or q in m["name"].lower() or q in z["name"].lower():
                        rows.append({"device_id": dev.id, "device": dev.name, "cfg_id": c.id, "date": c.taken_date,
                                     "zone": z["name"], "vsan": z["vsan"], "active": z["active"],
                                     "member": m["name"] if m["kind"] != "wwn" else "", "wwn": w})
        zoned = {(m["name"]) for z in p["zones"] for m in z["members"]}
        for a in p["aliases"]:       # 존에 안 들어간 별칭도
            if a["name"] in zoned:
                continue
            for w in a["wwns"] or [""]:
                if hit_w(w) or q in a["name"].lower():
                    rows.append({"device_id": dev.id, "device": dev.name, "cfg_id": c.id, "date": c.taken_date,
                                 "zone": "", "vsan": a["vsan"], "active": False, "member": a["name"], "wwn": w})
    seen, out = set(), []
    for r in rows:
        k = (r["device_id"], r["zone"], r["vsan"], r["member"], r["wwn"])
        if k not in seen:
            seen.add(k); out.append(r)
    return {"items": out[:300], "more": len(out) > 300}
