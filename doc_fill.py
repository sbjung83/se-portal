"""문서 양식(.xlsx / .docx) 미리보기와 채우기.

올려 둔 빈 양식을 화면에 표로 보여 주고(preview), 화면에서 고친 칸만 파일에 써넣는다(apply).
파일을 엑셀·워드 라이브러리로 다시 만들지 않고 압축 안의 글자 부분만 고치므로
서식·테두리·그림·인쇄 설정은 원본 그대로 남는다. (엑셀 미리보기를 읽을 때만 openpyxl 사용)
"""
import copy
import io
import re
import zipfile
from datetime import date, datetime, time

from lxml import etree

MAX_UNZIPPED = 200 * 1024 * 1024
MAX_ROWS, MAX_COLS, MAX_SHEETS = 300, 60, 8
_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
_NUM = re.compile(r"^-?(0|[1-9]\d{0,14})(\.\d+)?$")
_REF = re.compile(r"^([A-Z]{1,3})([1-9]\d{0,6})$")


class TemplateError(Exception):
    pass


def _open(data: bytes, ext: str) -> zipfile.ZipFile:
    if ext not in ("xlsx", "docx"):
        raise TemplateError("xlsx 또는 docx 파일만 쓸 수 있습니다")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise TemplateError(f"올바른 {ext} 파일이 아닙니다 (암호가 걸렸거나 예전 형식일 수 있습니다)")
    if sum(i.file_size for i in zf.infolist()) > MAX_UNZIPPED:
        raise TemplateError("파일이 너무 큽니다")
    if ("word/document.xml" if ext == "docx" else "xl/workbook.xml") not in zf.namelist():
        raise TemplateError(f"올바른 {ext} 파일이 아닙니다 (예전 형식 .doc/.xls 는 새 형식으로 저장해서 올려주세요)")
    return zf


def _parse(raw: bytes):
    return etree.fromstring(raw, etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False))


def _dump(root) -> bytes:
    return etree.tostring(root.getroottree(), xml_declaration=True, encoding="UTF-8", standalone=True)


def _rewrite(zf: zipfile.ZipFile, changed: dict) -> bytes:
    """바뀐 부분만 갈아 끼운 새 압축 파일."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zf.infolist():
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = zipfile.ZIP_STORED if info.compress_type == zipfile.ZIP_STORED else zipfile.ZIP_DEFLATED
            zi.external_attr = info.external_attr
            zout.writestr(zi, changed.get(info.filename) or zf.read(info))
    return out.getvalue()


def check(data: bytes, ext: str):
    """올릴 수 있는 파일인지 확인 (미리보기를 실제로 만들어 본다)."""
    preview(data, ext)


def preview(data: bytes, ext: str) -> dict:
    _open(data, ext)
    try:
        return _xlsx_preview(data) if ext == "xlsx" else _docx_preview(data)
    except TemplateError:
        raise
    except Exception as e:
        raise TemplateError(f"양식을 읽지 못했습니다 ({type(e).__name__})")


def apply(data: bytes, ext: str, edits: dict) -> bytes:
    """edits: 엑셀 {"시트이름!B3": "값"}, 워드 {"p12": "값"} (preview 가 준 key 그대로)."""
    zf = _open(data, ext)
    return _xlsx_apply(zf, edits) if ext == "xlsx" else _docx_apply(zf, edits)


# ── 엑셀 ───────────────────────────────────────────────────────
def _show(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d" if (v.hour, v.minute, v.second) == (0, 0, 0) else "%Y-%m-%d %H:%M")
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _xlsx_preview(data: bytes) -> dict:
    import openpyxl
    from openpyxl.utils import get_column_letter, column_index_from_string
    wb = openpyxl.load_workbook(io.BytesIO(data))
    try:
        wbv = openpyxl.load_workbook(io.BytesIO(data), data_only=True)     # 수식 칸에 보여 줄 계산값
    except Exception:
        wbv = None
    sheets = []
    for ws in wb.worksheets:
        if ws.sheet_state != "visible" or len(sheets) >= MAX_SHEETS or not hasattr(ws, "merged_cells"):
            continue
        wsv = wbv[ws.title] if wbv is not None and ws.title in wbv.sheetnames else None
        anchor, covered = {}, set()
        for rg in ws.merged_cells.ranges:
            if rg.min_row > MAX_ROWS or rg.min_col > MAX_COLS:
                continue
            anchor[(rg.min_row, rg.min_col)] = rg
            for r in range(rg.min_row, min(rg.max_row, MAX_ROWS) + 1):
                for c in range(rg.min_col, min(rg.max_col, MAX_COLS) + 1):
                    if (r, c) != (rg.min_row, rg.min_col):
                        covered.add((r, c))

        def sides(cell):
            b = cell.border
            return {k for k, s in (("t", b.top), ("b", b.bottom), ("l", b.left), ("r", b.right)) if s is not None and s.style}

        grid, last_r, last_c = {}, 0, 0
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, MAX_ROWS), max_col=min(ws.max_column, MAX_COLS)):
            for cell in row:
                r, c = cell.row, cell.column
                bd = sides(cell)
                if (r, c) in covered:
                    if bd:
                        last_r, last_c = max(last_r, r), max(last_c, c)
                    continue
                rg = anchor.get((r, c))
                if rg:      # 병합 칸의 오른쪽·아래 테두리는 끝 칸에 들어 있다
                    er, ec = min(rg.max_row, MAX_ROWS), min(rg.max_col, MAX_COLS)
                    bd = (bd & {"t", "l"}) | (sides(ws.cell(r, ec)) & {"r"}) | (sides(ws.cell(er, c)) & {"b"})
                val = cell.value
                formula = isinstance(val, str) and val.startswith("=") or cell.data_type == "f"
                text = _show(wsv.cell(r, c).value) if (formula and wsv is not None) else ("" if formula else _show(val))
                if not (text or bd or rg or formula):
                    continue
                d = {"k": f"{ws.title}!{cell.coordinate}", "v": text}
                if formula:
                    d["ro"] = 1
                if rg:
                    d["rs"], d["cs"] = min(rg.max_row, MAX_ROWS) - r + 1, min(rg.max_col, MAX_COLS) - c + 1
                if bd:
                    d["bd"] = "".join(sorted(bd))
                if cell.font is not None and cell.font.b:
                    d["b"] = 1
                if cell.font is not None and cell.font.sz and cell.font.sz != 11:
                    d["fs"] = float(cell.font.sz)
                al = cell.alignment
                if al is not None and al.horizontal in ("center", "right", "left", "centerContinuous", "distributed", "justify"):
                    d["a"] = "center" if al.horizontal in ("centerContinuous", "distributed") else al.horizontal
                if al is not None and al.wrap_text:
                    d["w"] = 1
                if al is not None and al.vertical in ("top", "bottom"):
                    d["va"] = al.vertical
                fill = cell.fill
                if fill is not None and fill.fill_type == "solid" and fill.fgColor is not None and fill.fgColor.type == "rgb":
                    rgb = str(fill.fgColor.rgb or "")
                    if len(rgb) == 8 and rgb[2:].upper() not in ("000000", "FFFFFF"):
                        d["bg"] = "#" + rgb[2:]
                grid[(r, c)] = d
                last_r = max(last_r, r + d.get("rs", 1) - 1)
                last_c = max(last_c, c + d.get("cs", 1) - 1)
        if not last_r:
            continue
        widths = {}
        for dim in ws.column_dimensions.values():
            if dim.width is None:
                continue
            lo = dim.min or column_index_from_string(dim.index)
            for i in range(lo, min(dim.max or lo, MAX_COLS) + 1):
                widths[i] = 0 if dim.hidden else dim.width
        default_w = (ws.sheet_format.defaultColWidth if ws.sheet_format is not None else None) or 8.43
        cols = [round(widths.get(i, default_w) * 7 + 5) if widths.get(i, default_w) else 0 for i in range(1, last_c + 1)]
        rows = []
        for r in range(1, last_r + 1):
            rd = ws.row_dimensions[r] if r in ws.row_dimensions else None
            if rd is not None and rd.hidden:
                continue
            cells = []
            for c in range(1, last_c + 1):
                if (r, c) in covered:
                    cells.append(None)          # 병합에 가려진 칸
                else:
                    cells.append(grid.get((r, c)) or {"k": f"{ws.title}!{get_column_letter(c)}{r}", "v": ""})
            rows.append({"h": round(rd.height * 1.33) if rd is not None and rd.height else 0, "cells": cells})
        sheets.append({"name": ws.title, "cols": cols, "rows": rows})
    if not sheets:
        raise TemplateError("내용이 있는 시트가 없습니다")
    return {"kind": "xlsx", "sheets": sheets}


def _col_num(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def _sheet_parts(zf: zipfile.ZipFile) -> dict:
    """시트 이름 → 압축 안의 경로."""
    wb = _parse(zf.read("xl/workbook.xml"))
    rels = _parse(zf.read("xl/_rels/workbook.xml.rels"))
    target = {}
    for rel in rels:
        t = rel.get("Target", "")
        target[rel.get("Id")] = t.lstrip("/") if t.startswith("/") else "xl/" + t
    return {sh.get("name"): target.get(sh.get(R_ID)) for sh in wb.iter(S + "sheet")}


def _xlsx_set(root, ref: str, val: str):
    m = _REF.match(ref)
    data = root.find(S + "sheetData")
    if not m or data is None:
        return
    col, rown = _col_num(m.group(1)), int(m.group(2))
    row = None
    for el in data:
        n = int(el.get("r") or 0)
        if n == rown:
            row = el
            break
        if n > rown:
            row = etree.Element(S + "row", r=str(rown))
            el.addprevious(row)
            break
    if row is None:
        row = etree.SubElement(data, S + "row", r=str(rown))
    cell = None
    for el in row:
        mm = _REF.match(el.get("r") or "")
        n = _col_num(mm.group(1)) if mm else 0
        if n == col:
            cell = el
            break
        if n > col:
            cell = etree.Element(S + "c", r=ref)
            el.addprevious(cell)
            break
    if cell is None:
        cell = etree.SubElement(row, S + "c", r=ref)
    if cell.find(S + "f") is not None:          # 수식 칸은 건드리지 않는다
        return
    for ch in list(cell):
        if ch.tag in (S + "v", S + "is"):
            cell.remove(ch)
    cell.attrib.pop("t", None)
    if val == "":
        return
    if _NUM.match(val):                          # 숫자는 숫자로 넣어야 합계 수식이 계산된다
        etree.SubElement(cell, S + "v").text = val
        return
    cell.set("t", "inlineStr")
    t = etree.SubElement(etree.SubElement(cell, S + "is"), S + "t")
    t.set(_XML_SPACE, "preserve")
    t.text = val


def _xlsx_apply(zf: zipfile.ZipFile, edits: dict) -> bytes:
    parts = _sheet_parts(zf)
    by_sheet = {}
    for key, val in edits.items():
        name, _, ref = str(key).rpartition("!")
        if parts.get(name) and _REF.match(ref):
            by_sheet.setdefault(name, {})[ref] = str(val).replace("\r\n", "\n")
    changed = {}
    for name, cells in by_sheet.items():
        root = _parse(zf.read(parts[name]))
        for ref, val in cells.items():
            _xlsx_set(root, ref, val)
        # 수식 칸에 남아 있는 예전 계산값(양식 예시로 계산된 합계 등)을 지운다.
        # 다시 계산하지 않는 뷰어(미리보기·보호된 보기·모바일)가 옛 숫자를 보여 주지 않게 하기 위함.
        for c in root.iter(S + "c"):
            if c.find(S + "f") is not None:
                for v in c.findall(S + "v"):
                    c.remove(v)
                c.attrib.pop("t", None)
        changed[parts[name]] = _dump(root)
    if changed:                                   # 열 때 수식을 다시 계산하게 한다
        wb = _parse(zf.read("xl/workbook.xml"))
        calc = wb.find(S + "calcPr")
        if calc is None:
            calc = etree.Element(S + "calcPr")
            after = [el for el in wb if el.tag in (S + "sheets", S + "functionGroups", S + "externalReferences", S + "definedNames")]
            (after[-1].addnext(calc)) if after else wb.append(calc)
        calc.set("fullCalcOnLoad", "1")
        changed["xl/workbook.xml"] = _dump(wb)
    return _rewrite(zf, changed)


# ── 워드 ───────────────────────────────────────────────────────
def _owner_p(el):
    p = el.getparent()
    while p is not None and p.tag != W + "p":
        p = p.getparent()
    return p


def _p_nodes(p):
    """이 문단에 직접 속한 글자·줄바꿈·탭 (문단 안 글상자 속 문단의 것은 뺀다)."""
    out = []
    for el in p.iter(W + "t", W + "br", W + "tab", W + "drawing", W + "fldChar", W + "pict", W + "object"):
        if el.tag == W + "tab" and el.getparent().tag != W + "r":
            continue                                # 탭 위치 정의(w:tabs)는 글자가 아니다
        if _owner_p(el) is p:
            out.append(el)
    return out


def _p_text(nodes) -> str:
    s = ""
    for el in nodes:
        if el.tag == W + "t":
            s += el.text or ""
        elif el.tag == W + "tab":
            s += "\t"
        elif el.tag == W + "br" and el.get(W + "type") in (None, "textWrapping"):
            s += "\n"
    return s


def _val(el, name, attr="val"):
    ch = el.find(W + name) if el is not None else None
    return None if ch is None else (ch.get(W + attr) or "")


def _docx_blocks(parent, index) -> list:
    out = []
    for ch in parent:
        if ch.tag == W + "sdt":
            body = ch.find(W + "sdtContent")
            if body is not None:
                out += _docx_blocks(body, index)
        elif ch.tag == W + "p":
            nodes = _p_nodes(ch)
            d = {"t": "p", "k": f"p{index[ch]}", "v": _p_text(nodes)}
            if any(n.tag in (W + "drawing", W + "fldChar", W + "pict", W + "object") for n in nodes):
                d["ro"] = 1                         # 그림·자동 필드가 든 문단은 고치지 않는다
            ppr = ch.find(W + "pPr")
            jc = _val(ppr, "jc")
            if jc in ("center", "right", "both", "distribute"):
                d["a"] = {"both": "justify", "distribute": "center"}.get(jc, jc)
            style = (_val(ppr, "pStyle") or "").lower()
            if style.startswith(("heading", "title")) or style in ("1", "2", "a3"):
                d["b"], d["fs"] = 1, 16 if style in ("title", "heading1", "1") else 13
            run = ch.find(W + "r")
            rpr = run.find(W + "rPr") if run is not None else (ppr.find(W + "rPr") if ppr is not None else None)
            if rpr is not None:
                b = rpr.find(W + "b")
                if b is not None and b.get(W + "val") not in ("0", "false"):
                    d["b"] = 1
                sz = _val(rpr, "sz")
                if sz and sz.isdigit():
                    d["fs"] = int(sz) / 2
            out.append(d)
        elif ch.tag == W + "tbl":
            grid = ch.find(W + "tblGrid")
            cols = [round(int(g.get(W + "w") or 0) / 15) for g in grid.findall(W + "gridCol")] if grid is not None else []
            rows = []
            for tr in ch.iter(W + "tr"):
                if next((a for a in tr.iterancestors(W + "tbl")), None) is not ch:
                    continue
                cells = []
                for tc in tr.findall(W + "tc"):
                    pr = tc.find(W + "tcPr")
                    c = {"blocks": _docx_blocks(tc, index)}
                    span = _val(pr, "gridSpan")
                    if span and span.isdigit() and int(span) > 1:
                        c["cs"] = int(span)
                    vm = _val(pr, "vMerge")
                    if vm is not None:
                        c["vm"] = "start" if vm == "restart" else "cont"
                    fill = _val(pr, "shd", "fill")
                    if fill and re.fullmatch(r"[0-9A-Fa-f]{6}", fill) and fill.upper() != "FFFFFF":
                        c["bg"] = "#" + fill
                    cells.append(c)
                rows.append(cells)
            out.append({"t": "tbl", "cols": cols, "rows": rows})
    return out


def _docx_root(zf):
    root = _parse(zf.read("word/document.xml"))
    return root, {p: i for i, p in enumerate(root.iter(W + "p"))}


def _docx_preview(data: bytes) -> dict:
    root, index = _docx_root(zipfile.ZipFile(io.BytesIO(data)))
    body = root.find(W + "body")
    if body is None:
        raise TemplateError("문서 본문이 없습니다")
    return {"kind": "docx", "blocks": _docx_blocks(body, index)}


def _docx_set(p, val: str):
    nodes = _p_nodes(p)
    if any(n.tag in (W + "drawing", W + "fldChar", W + "pict", W + "object") for n in nodes):
        return
    texts = [n for n in nodes if n.tag == W + "t"]
    for n in nodes:                                 # 예전 줄바꿈·탭은 지우고 새로 쓴다 (쪽 나눔은 남김)
        if n.tag == W + "tab" or (n.tag == W + "br" and n.get(W + "type") in (None, "textWrapping")):
            n.getparent().remove(n)
    if texts:
        first = texts[0]
        for t in texts[1:]:
            t.text = ""
    else:
        if val == "":
            return
        run = etree.SubElement(p, W + "r")
        ppr = p.find(W + "pPr")
        rpr = ppr.find(W + "rPr") if ppr is not None else None
        if rpr is not None:                         # 빈 칸의 글꼴 설정을 그대로 쓴다
            run.append(copy.deepcopy(rpr))
        first = etree.SubElement(run, W + "t")
    first.set(_XML_SPACE, "preserve")
    lines = val.replace("\t", "    ").split("\n")
    first.text = lines[0]
    prev = first
    for line in lines[1:]:                          # 워드는 글자 안의 줄바꿈을 무시하므로 줄바꿈 표시를 넣는다
        br = etree.Element(W + "br")
        nt = etree.Element(W + "t")
        nt.set(_XML_SPACE, "preserve")
        nt.text = line
        prev.addnext(br)
        br.addnext(nt)
        prev = nt


def _p_sub(p, pattern, repl) -> bool:
    """문단 글자에서 pattern 에 맞는 부분만 바꾼다 (조각난 run 과 탭·글꼴은 그대로 둔다). repl: 문자열 또는 match → 문자열."""
    ts = [n for n in _p_nodes(p) if n.tag == W + "t"]
    texts = [t.text or "" for t in ts]
    matches = list(re.finditer(pattern, "".join(texts)))
    if not matches:
        return False
    starts, pos = [], 0
    for x in texts:
        starts.append(pos)
        pos += len(x)

    def locate(off, end=False):
        for i in range(len(texts) - 1, -1, -1):
            if off > starts[i] or (off == starts[i] and not end):
                return i, off - starts[i]
        return 0, 0

    for m in reversed(matches):                 # 뒤에서부터 바꿔야 앞쪽 위치가 어긋나지 않는다
        val = repl(m) if callable(repl) else m.expand(repl)
        si, so = locate(m.start())
        ei, eo = locate(m.end(), end=True)
        tail = texts[ei][eo:]
        if si == ei:
            texts[si] = texts[si][:so] + val + tail
        else:
            texts[ei] = tail
            for k in range(si + 1, ei):
                texts[k] = ""
            texts[si] = texts[si][:so] + val
    for t, new in zip(ts, texts):
        if new != (t.text or ""):
            t.set(_XML_SPACE, "preserve")
            t.text = new
    return True


def docx_edit(data: bytes, editor) -> bytes:
    """워드 양식을 열어 editor(문서 root) 가 고친 결과를 돌려준다. 도우미: W, p_text(p), p_sub(...), p_set(p, 글자)."""
    zf = _open(data, "docx")
    root = _parse(zf.read("word/document.xml"))
    editor(root)
    return _rewrite(zf, {"word/document.xml": _dump(root)})


def p_text(p) -> str:
    return _p_text(_p_nodes(p))


def _docx_apply(zf: zipfile.ZipFile, edits: dict) -> bytes:
    root, index = _docx_root(zf)
    by_idx = {i: p for p, i in index.items()}
    done = False
    for key, val in edits.items():
        m = re.fullmatch(r"p(\d+)", str(key))
        p = by_idx.get(int(m.group(1))) if m else None
        if p is not None:
            _docx_set(p, str(val).replace("\r\n", "\n"))
            done = True
    return _rewrite(zf, {"word/document.xml": _dump(root)} if done else {})


p_set = _docx_set
p_sub = _p_sub
