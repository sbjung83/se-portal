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
            tgt[key] = []                  # Active / Full Zone Database 에 두 번 나오면 뒤의 것으로 (멤버 중복 방지)
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


# ── 복구 매뉴얼 (활성 cfg/zoneset 기준으로 그대로 붙여 넣을 명령) ─────────
CHUNK = 20      # cfgadd / zoneset member 한 줄에 넣을 존 수


def _q(v: str) -> str:
    return '"' + v.replace('"', '') + '"'


DP_RE = re.compile(r"^\d+,\d+$")          # 포트 존 멤버 (Domain,Port)


def _uniq(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def _brocade_effective(text: str):
    """cfgshow 의 Effective configuration → (cfg 이름, {zone: [멤버(별칭은 풀린 값)]}) / 없으면 None."""
    lines = text.splitlines()
    try:
        k = next(i for i, ln in enumerate(lines) if ln.strip().lower().startswith("effective configuration"))
    except StopIteration:
        return None
    cfg, zones, cur = "", {}, None
    for ln in lines[k + 1:]:
        st = ln.strip()
        if not st:
            if zones:
                break
            continue
        m = re.match(r"^(cfg|zone):\s+(\S+)\s*(.*)$", st)
        if m:
            if m.group(1) == "cfg":
                cfg = m.group(2); cur = None
            else:
                cur = zones.setdefault(m.group(2), []); cur += _split(m.group(3))
        elif cur is not None and ln[:1].isspace():
            cur += _split(st)
        else:
            break
    return (cfg, zones) if cfg else None


def _restore_brocade(cfgs, zones, aliases, active, text=""):
    """활성 cfg 에 든 존 + 그 존이 쓰는 별칭만. alicreate → zonecreate → cfgcreate/cfgadd → cfgsave → cfgenable.
    cfgsave·cfgenable·cfgdisable·cfgclear 는 확인을 물으므로(yes/no) 바로 다음 줄에 y 를 둔다 — 여러 줄을 붙여 넣으면
    다음 명령이 답으로 먹혀 저장·활성화가 취소되기 때문. (질문이 안 나오면 y 는 'command not found' 로 끝나 해가 없다)"""
    warn = []
    zones = {k: _uniq(v) for k, v in zones.items()}
    aliases = {k: _uniq(v) for k, v in aliases.items()}
    use_cfgs = _uniq([c for c in active if c in cfgs])
    if not use_cfgs:
        use_cfgs = list(cfgs)
        warn.append("설정에 활성 cfg(enable / Effective configuration) 정보가 없어 정의된 cfg 전부를 만들고, cfgenable 은 넣지 않았습니다.")
    missing_cfg = [c for c in active if c not in cfgs]
    if missing_cfg:
        warn.append(f"활성 cfg {', '.join(missing_cfg)} 의 정의(Defined)가 설정에 없습니다. 원문을 확인하세요.")
    zone_names = _uniq([z for c in use_cfgs for z in cfgs[c]])
    missing_z = [z for z in zone_names if z not in zones]
    if missing_z:
        warn.append(f"cfg 에 있지만 정의가 없는 존 {len(missing_z)}개는 넣지 않았습니다: {', '.join(missing_z)}")
    zone_names = [z for z in zone_names if z in zones]
    alias_names = []

    def use_alias(name):
        if name in aliases and name not in alias_names:
            alias_names.append(name)
    undef = []
    for z in zone_names:
        for m in zones[z]:
            if WWN_RE.fullmatch(m) or DP_RE.match(m):
                continue
            if m in aliases:
                use_alias(m)
            else:
                undef.append(m)
    if undef:
        warn.append(f"존 멤버 중 별칭 정의가 없는 이름 {len(_uniq(undef))}개: {', '.join(_uniq(undef)[:10])} — 스위치에서 cfgsave 가 실패할 수 있으니 원문을 확인하세요.")
    peer = [z for z in zone_names if any(m.lower().startswith("00:02:00:00") for m in zones[z])]
    if peer:
        warn.append(f"피어 존(Peer zone)으로 보이는 존 {len(peer)}개: {', '.join(peer[:10])} — 일반 zonecreate 로 만들면 안 되므로 'zonecreate --peerzone' 으로 직접 만드세요.")
    # 포트 존(Domain,Port): 새 스위치의 Domain ID·포트 연결이 같아야 한다
    used_members = [m for z in zone_names for m in zones[z]] + [m for a in alias_names for m in aliases[a]]
    doms = sorted({m.split(",")[0] for m in used_members if DP_RE.match(m)}, key=int)
    if doms:
        n_dp = sum(1 for m in used_members if DP_RE.match(m))
        warn.append(f"포트 존(Domain,Port) 멤버 {n_dp}개 — Domain ID {', '.join(doms)} 기준입니다. 교체 스위치는 같은 Domain ID(switchshow 의 switchDomain, 바꾸려면 switchdisable → configure)로 맞추고 "
                    f"장비를 같은 포트에 연결해야 존이 동작합니다. 다른 스위치 도메인 번호가 섞여 있으면 패브릭의 그 스위치 포트입니다.")
    # Defined ↔ Effective 비교 (cfgshow): 고친 뒤 enable 하지 않은 변경이 있으면 알린다
    eff = _brocade_effective(text) if text else None
    if eff and eff[0] in cfgs:
        def resolved(z):
            out = []
            for m in zones.get(z, []):
                out += [x.lower() for x in aliases[m]] if m in aliases else [m.lower()]
            return sorted(set(out))
        ez = eff[1]
        dz = set(cfgs[eff[0]])
        only_d = sorted(dz - set(ez)); only_e = sorted(set(ez) - dz)
        diff_m = sorted(z for z in dz & set(ez) if resolved(z) != sorted({m.lower() for m in ez[z]}))
        if only_d or only_e or diff_m:
            parts = []
            if only_d: parts.append(f"정의에만 있는 존 {', '.join(only_d[:8])}")
            if only_e: parts.append(f"실제 적용에만 있는 존 {', '.join(only_e[:8])}")
            if diff_m: parts.append(f"멤버가 다른 존 {', '.join(diff_m[:8])}")
            warn.append("정의(Defined)와 실제 적용(Effective)이 다릅니다 — 고친 뒤 cfgenable 하지 않은 변경이 있습니다. 이 매뉴얼은 정의 기준이니, 당시 실제 동작한 상태로 복구하려면 원문의 Effective 부분과 비교하세요: " + " / ".join(parts))
    bad_names = [n for n in use_cfgs + zone_names + alias_names if not re.fullmatch(r"[A-Za-z0-9_$^\-]+", n)]
    if bad_names:
        warn.append(f"Brocade 이름에 쓸 수 없는 글자가 든 이름 {len(bad_names)}개: {', '.join(bad_names[:10])} — 그 줄은 실패하니 이름을 확인하세요.")
    steps = []
    if alias_names:
        steps.append({"title": "별칭(alias) 만들기", "desc": f"존에서 쓰는 별칭 {len(alias_names)}개",
                      "lines": [f"alicreate {_q(a)}, {_q('; '.join(aliases[a]))}" for a in alias_names]})
    steps.append({"title": "존(zone) 만들기", "desc": f"활성 cfg 에 든 존 {len(zone_names)}개",
                  "lines": [f"zonecreate {_q(z)}, {_q('; '.join(zones[z]))}" for z in zone_names]})
    cl = []
    for c in use_cfgs:
        zs = _uniq([z for z in cfgs[c] if z in zones])
        if not zs:
            continue
        cl.append(f"cfgcreate {_q(c)}, {_q(zs[0])}")
        for i in range(1, len(zs), CHUNK):
            cl.append(f"cfgadd {_q(c)}, {_q('; '.join(zs[i:i + CHUNK]))}")
    steps.append({"title": "cfg 만들기 · 존을 cfg 에 추가", "desc": f"첫 존으로 cfgcreate 후 나머지는 cfgadd ({CHUNK}개씩)", "lines": cl})
    en = [c for c in active if c in cfgs][:1]
    steps.append({"title": "저장 · 활성화", "desc": "y 줄은 확인 질문(yes, y, no, n)의 답입니다 — 지우지 말고 함께 붙여 넣으세요",
                  "lines": ["cfgsave", "y"] + [ln for c in en for ln in (f"cfgenable {_q(c)}", "y")]})
    steps.append({"title": "확인", "desc": "활성 cfg 이름과 존 수가 원래 설정과 같은지 봅니다",
                  "lines": ["cfgactvshow", "cfgshow"]})
    pre = {"title": "작업 전 확인 (복구할 스위치)", "desc": "이미 같은 이름의 존·별칭이 있으면 create 가 실패합니다. 교체 스위치에 넣을 때만 기존 zoning 을 비웁니다(cfgclear 는 지금 zoning 을 모두 지움). y 줄은 확인 질문의 답입니다.",
           "lines": ["switchshow", "cfgshow", "cfgdisable", "y", "cfgclear", "y", "cfgsave", "y"], "optional": True}
    return {"pre": pre, "steps": steps, "warnings": warn,
            "used": {"cfgs": use_cfgs, "zones": zone_names, "aliases": alias_names},
            "skipped": {"cfgs": [c for c in cfgs if c not in use_cfgs],
                        "zones": [z for z in zones if z not in zone_names],
                        "aliases": [a for a in aliases if a not in alias_names]}}


def _cisco_raw(text: str):
    """복구용 MDS 읽기 — 멤버 줄을 'member ' 뒤 원문 그대로(종류·init/target 속성 유지) 보관.
    running-config 에는 같은 존이 Active / Full Zone Database 두 곳에 나오므로 다시 나오면 새로 받는다(뒤의 Full 이 남음)."""
    dev, fca, zones, sets, active, enhanced = {}, {}, {}, {}, [], set()
    cur = None
    for ln in text.splitlines():
        s = ln.strip()
        m = re.match(r"^device-alias name (\S+) pwwn (\S+)", s)
        if m:
            dev[m.group(1)] = m.group(2).lower(); cur = None; continue
        m = re.match(r"^zone mode enhanced vsan (\d+)", s)
        if m:
            enhanced.add(m.group(1)); continue
        m = re.match(r"^zoneset activate name (\S+) vsan (\d+)", s)
        if m:
            k = f"{m.group(1)}@{m.group(2)}"
            if k not in active:
                active.append(k)
            cur = None; continue
        m = re.match(r"^(fcalias|zone|zoneset) name (\S+) vsan (\d+)", s)
        if m:
            kind, name, vsan = m.groups()
            tgt = {"fcalias": fca, "zone": zones, "zoneset": sets}[kind]
            tgt[f"{name}@{vsan}"] = []
            cur = tgt[f"{name}@{vsan}"]
            continue
        if cur is not None and ln[:1].isspace():
            m = re.match(r"^member\s+(.*)$", s)
            if m:
                body = re.sub(r"\s+", " ", m.group(1).strip())
                if body.lower().startswith("pwwn "):
                    parts = body.split(" ")
                    parts[1] = parts[1].lower()
                    body = " ".join(parts)
                if body not in cur:
                    cur.append(body)
            continue
        if s and not ln[:1].isspace():
            cur = None
    return dev, fca, zones, sets, active, enhanced


def _restore_cisco(text):
    """활성 zoneset(VSAN 별)에 든 존 + 그 존이 쓰는 device-alias / fcalias 만."""
    dev, fca, zones, sets, active, enhanced = _cisco_raw(text)
    warn = []
    nm = lambda k: k.split("@")[0]
    vs = lambda k: k.split("@")[1] if "@" in k else ""
    use_sets = [a for a in active if a in sets]
    if not use_sets:
        use_sets = list(sets)
        warn.append("설정에 'zoneset activate' 정보가 없어 정의된 zoneset 전부를 만들고, 활성화 명령은 넣지 않았습니다.")
    miss = [a for a in active if a not in sets]
    if miss:
        warn.append(f"활성 zoneset {', '.join(nm(a) + ' (VSAN ' + vs(a) + ')' for a in miss)} 의 정의가 설정에 없습니다.")
    zone_keys, missing_z = [], []
    for zs in use_sets:
        for z in sets[zs]:
            k = f"{z}@{vs(zs)}"
            if k in zones:
                if k not in zone_keys:
                    zone_keys.append(k)
            else:
                missing_z.append(k)
    if missing_z:
        warn.append(f"zoneset 에 있지만 정의가 없는 존 {len(missing_z)}개는 넣지 않았습니다: {', '.join(nm(k) for k in missing_z[:10])}")
    dev_used, fca_used, undef, special = [], [], [], []

    def note(body, vsan):
        w = body.split(" ")
        if w[0] == "device-alias" and len(w) > 1:
            if w[1] in dev:
                if w[1] not in dev_used:
                    dev_used.append(w[1])
            else:
                undef.append(w[1])
        elif w[0] == "fcalias" and len(w) > 1:
            k = f"{w[1]}@{vsan}"
            if k in fca:
                if k not in fca_used:
                    fca_used.append(k)
                    for b in fca[k]:
                        note(b, vsan)
            else:
                undef.append(w[1])
        elif w[0] in ("interface", "domain-id", "fcid", "fwwn", "symbolic-nodename", "ip-address", "fv", "lun"):
            special.append(body)
    for z in zone_keys:
        for b in zones[z]:
            note(b, vs(z))
    if undef:
        warn.append(f"정의가 없는 별칭 {len(_uniq(undef))}개: {', '.join(_uniq(undef)[:10])} — 원문을 확인하세요.")
    if special:
        warn.append(f"인터페이스·도메인·FCID 기준 멤버 {len(special)}개(예: {special[0]}) — 스위치 WWN(swwn)·Domain ID 가 원래 스위치 기준이라, 교체 스위치에서는 값을 고쳐야 합니다.")
    steps = []
    if dev_used:
        steps.append({"title": "device-alias 만들기", "desc": f"존에서 쓰는 device-alias {len(dev_used)}개. device-alias 배포(distribute)를 쓰지 않는 스위치면 commit 줄은 오류가 나도 괜찮습니다",
                      "lines": ["configure terminal", "device-alias database"]
                      + [f"  device-alias name {a} pwwn {dev[a]}" for a in dev_used] + ["exit", "device-alias commit", "end"]})
    if fca_used:
        fl = ["configure terminal"]
        for a in fca_used:
            fl.append(f"fcalias name {nm(a)} vsan {vs(a)}")
            fl += [f"  member {b}" for b in fca[a]]
        fl.append("end")
        steps.append({"title": "fcalias 만들기", "desc": f"존에서 쓰는 fcalias {len(fca_used)}개", "lines": fl})
    zl = ["configure terminal"]
    for z in zone_keys:
        zl.append(f"zone name {nm(z)} vsan {vs(z)}")
        zl += [f"  member {b}" for b in zones[z]]
    zl.append("end")
    steps.append({"title": "존(zone) 만들기", "desc": f"활성 zoneset 에 든 존 {len(zone_keys)}개", "lines": zl})
    sl = ["configure terminal"]
    for zs in use_sets:
        sl.append(f"zoneset name {nm(zs)} vsan {vs(zs)}")
        sl += [f"  member {z}" for z in _uniq(sets[zs]) if f"{z}@{vs(zs)}" in zones]
    sl.append("end")
    steps.append({"title": "zoneset 만들기 · 존을 zoneset 에 추가", "desc": "", "lines": sl})
    act = ["configure terminal"]
    for a in active:
        if a in sets:
            act.append(f"zoneset activate name {nm(a)} vsan {vs(a)}")
            if vs(a) in enhanced:
                act.append(f"zone commit vsan {vs(a)}")
    act.append("end")
    if len(act) > 2:
        steps.append({"title": "활성화", "desc": "enhanced zone 모드인 VSAN 은 zone commit 까지 넣었습니다" if any(vs(a) in enhanced for a in active) else "",
                      "lines": act})
    steps.append({"title": "저장", "desc": "", "lines": ["copy running-config startup-config"]})
    steps.append({"title": "확인", "desc": "활성 zoneset 과 존 수가 원래 설정과 같은지 봅니다",
                  "lines": [f"show zoneset active vsan {v}" for v in _uniq([vs(a) for a in use_sets])] + ["show device-alias database"]})
    vsans = _uniq([vs(a) for a in use_sets])
    pre = {"title": "작업 전 확인 (복구할 스위치)", "desc": f"VSAN {', '.join(vsans)} 이 만들어져 있고 포트가 그 VSAN 에 들어가 있어야 합니다. 같은 이름의 존·zoneset 이 이미 있으면 멤버가 더해지므로 먼저 확인합니다.",
           "lines": ["show vsan", "show zoneset brief", "show zone status"], "optional": True}
    return {"pre": pre, "steps": steps, "warnings": warn,
            "used": {"cfgs": [nm(z) + f" (VSAN {vs(z)})" for z in use_sets],
                     "zones": [nm(z) + f" (VSAN {vs(z)})" for z in zone_keys],
                     "aliases": dev_used + [nm(a) for a in fca_used]},
            "skipped": {"cfgs": [nm(c) + f" (VSAN {vs(c)})" for c in sets if c not in use_sets],
                        "zones": [nm(z) + f" (VSAN {vs(z)})" for z in zones if z not in zone_keys],
                        "aliases": [a for a in dev if a not in dev_used] + [nm(a) + f" (VSAN {vs(a)})" for a in fca if a not in fca_used]}}


def restore_plan(text: str, vendor: str = ""):
    vendor = vendor or detect_vendor(text)
    if vendor == "cisco":
        r = _parse_cisco(text)
        return {"vendor": "cisco", "ok": bool(r), **(_restore_cisco(text) if r else {})}
    r = _parse_brocade(text)
    return {"vendor": "brocade", "ok": bool(r), **(_restore_brocade(*r, text) if r else {})}


def restore_text(plan: dict, title: str) -> str:
    """텍스트 파일용 (# 줄은 설명 — 붙여 넣을 때는 명령 줄만)."""
    out = [f"# {title}", f"# 장비: {'Cisco MDS' if plan['vendor'] == 'cisco' else 'Brocade'}  ·  만든 날 {datetime.now():%Y-%m-%d %H:%M}", ""]
    for w in plan.get("warnings", []):
        out.append(f"# 주의: {w}")
    blocks = [plan["pre"]] + plan["steps"]
    for i, b in enumerate(blocks):
        out += ["", f"# {'[선택] ' if b.get('optional') else f'{i}. '}{b['title']}"]
        if b.get("desc"):
            out.append(f"#   {b['desc']}")
        # [선택] 블록(cfgclear 등 지금 zoning 을 지우는 명령 포함)은 통째로 붙여 넣어도 실행되지 않게 주석으로
        out += [("# " + ln) if b.get("optional") else ln for ln in b["lines"]]
    sk = plan["skipped"]
    out += ["", f"# 제외 (활성 cfg 에서 안 쓰는 것) — cfg {len(sk['cfgs'])} · 존 {len(sk['zones'])} · 별칭 {len(sk['aliases'])}"]
    for k, label in (("cfgs", "cfg"), ("zones", "존"), ("aliases", "별칭")):
        if sk[k]:
            out.append(f"#   {label}: " + ", ".join(sk[k]))
    return "\n".join(out) + "\n"


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


@router.get("/devices/{dev_id}/configs/{cfg_id}/restore")
def restore_config(eng_id: str, site_id: str, dev_id: str, cfg_id: str, txt: bool = False, db: Session = Depends(get_db)):
    """복구 매뉴얼: 활성 cfg(zoneset) 기준 alias → zone → cfg → save/enable 명령. txt=1 이면 텍스트 파일로."""
    dev = _device(eng_id, site_id, dev_id, db)
    c = _config(dev, cfg_id, db)
    plan = restore_plan(_text(c), c.vendor or "")
    if not plan["ok"]:
        raise HTTPException(400, detail="존·별칭 정보를 찾지 못해 복구 매뉴얼을 만들 수 없습니다")
    if txt:
        body = restore_text(plan, f"{dev.name} SAN zoning 복구 매뉴얼 (설정 {c.taken_date})")
        fname = quote(f"{dev.name}_zoning_복구_{c.taken_date}.txt")
        return Response(body.encode("utf-8"), media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"})
    return {**plan, "device": dev.name, "taken_date": c.taken_date}


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
