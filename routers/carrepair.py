"""법인차량 점검 품의서 + 정비 이력.

화면에서 정비 내용(정비처·품목·금액)을 넣어 저장하면 정비 이력(`car_repairs`)에 남고,
`GET /{id}/document` 가 서버에 둔 양식(`data/doc_templates/car_repair.xlsx`)에 값을 채워 품의서를 내려준다.

양식(시트 1장)에서 채우는 칸 — 양식을 바꾸면 여기도 확인할 것:
  G4 작성일 / D5 부서 / D6 직급 / E6 성명 (인) / D8 거래내역 / D9 정비처
  (D11 대금지급조건 · D12 입고(예정)일은 기입하지 않으므로 늘 빈칸)
  16~21행 품목(B 거래처, C 품명, E 단가, F 수량 — G 금액은 수식) / B25~B33 특기사항
  D10 매입금액, G22 소계, G23 계(부가세 포함)는 양식의 수식. 단가는 부가세 별도.
"""
import io
import json
import os
import uuid
import zipfile
from datetime import datetime
from io import BytesIO
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import doc_fill
from database import CarRepair, get_db
from routers.leaves import _profile

router = APIRouter(prefix="/api/engineers/{eng_id}/carrepairs", tags=["carrepairs"])

TEMPLATE_PATH = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "doc_templates", "car_repair.xlsx"))
ITEM_FIRST_ROW, MAX_ITEMS = 16, 6          # 품목을 적는 줄: 16~21행
NOTE_FIRST_ROW, MAX_NOTES = 25, 9          # 특기사항: 25~33행
VAT = 0.1
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ItemIn(BaseModel):
    name: str = ""
    price: float = 0          # 단가 (부가세 별도)
    qty: float = 1


class RepairIn(BaseModel):
    doc_date: str                         # 작성일 "YYYY-MM-DD"
    car_no: Optional[str] = ""
    title: Optional[str] = ""             # 거래내역 (비우면 "법인차량(차량번호) 정비")
    vendor: str                           # 정비처
    odometer: Optional[int] = None        # 정비 때 주행거리 km (이력용, 품의서에는 안 들어감)
    note: Optional[str] = ""              # 특기사항 (줄마다 한 항목)
    items: List[ItemIn] = []


def _day(v: str, label: str, required=True) -> str:
    v = (v or "").strip()[:10]
    if not v and not required:
        return ""
    try:
        return datetime.strptime(v, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, detail=f"{label} 형식이 올바르지 않습니다 (YYYY-MM-DD)")


def _num(v: float):
    return int(v) if float(v).is_integer() else round(float(v), 2)


def _items(r: CarRepair) -> list:
    try:
        return json.loads(r.items or "[]")
    except ValueError:
        return []


def _totals(items: list):
    subtotal = sum(i["price"] * i["qty"] for i in items)
    return subtotal, round(subtotal * (1 + VAT))


def _repair_dict(r: CarRepair) -> dict:
    items = _items(r)
    subtotal, total = _totals(items)
    return {"id": r.id, "doc_date": r.doc_date, "car_no": r.car_no or "", "title": r.title or "", "vendor": r.vendor or "",
            "odometer": r.odometer, "note": r.note or "",
            "items": items, "subtotal": _num(subtotal), "total": total}


def _get(eng_id: str, repair_id: str, db: Session) -> CarRepair:
    r = db.query(CarRepair).filter(CarRepair.id == repair_id, CarRepair.engineer_id == eng_id).first()
    if not r:
        raise HTTPException(404, detail="정비 이력을 찾을 수 없습니다")
    return r


def _apply(r: CarRepair, data: RepairIn):
    vendor = (data.vendor or "").strip()
    if not vendor:
        raise HTTPException(400, detail="정비처를 입력해주세요")
    items = []
    for i in data.items:
        name = (i.name or "").strip()
        if not name:
            continue
        if i.price < 0 or i.qty <= 0:
            raise HTTPException(400, detail=f"'{name}'의 단가·수량이 올바르지 않습니다")
        items.append({"name": name, "price": _num(i.price), "qty": _num(i.qty)})
    if not items:
        raise HTTPException(400, detail="정비 품목을 하나 이상 입력해주세요")
    if len(items) > MAX_ITEMS:
        raise HTTPException(400, detail=f"품목은 양식에 {MAX_ITEMS}줄까지 들어갑니다")
    if data.odometer is not None and data.odometer < 0:
        raise HTTPException(400, detail="주행거리가 올바르지 않습니다")
    car_no = (data.car_no or "").strip()
    r.doc_date = _day(data.doc_date, "작성일")
    r.car_no, r.vendor = car_no, vendor
    r.title = (data.title or "").strip() or (f"법인차량({car_no}) 정비" if car_no else "법인차량 정비")
    r.odometer, r.note = data.odometer, (data.note or "").strip()
    r.items = json.dumps(items, ensure_ascii=False)


@router.get("")
def list_repairs(eng_id: str, year: Optional[str] = None, db: Session = Depends(get_db)):
    """그 해(작성일 기준)의 정비 이력. 새로 쓸 때 채워 줄 기본값(차량번호·최근 정비처)도 함께 준다."""
    year = year or datetime.now().strftime("%Y")
    if not (len(year) == 4 and year.isdigit()):
        raise HTTPException(400, detail="연도 형식이 올바르지 않습니다 (YYYY)")
    recs = (db.query(CarRepair).filter(CarRepair.engineer_id == eng_id, CarRepair.doc_date.startswith(year))
            .order_by(CarRepair.doc_date.desc(), CarRepair.created_at.desc()).all())
    last = (db.query(CarRepair).filter(CarRepair.engineer_id == eng_id)
            .order_by(CarRepair.doc_date.desc(), CarRepair.created_at.desc()).first())
    rows = [_repair_dict(r) for r in recs]
    return {"year": year, "records": rows, "count": len(rows), "total": sum(r["total"] for r in rows),
            "defaults": {"car_no": (last.car_no if last else "") or "",     # 운행 일지 차량은 개인 차량일 수 있어 쓰지 않는다
                         "vendor": (last.vendor if last else "") or ""},
            "profile": _profile(eng_id, db), "max_items": MAX_ITEMS, "has_template": os.path.isfile(TEMPLATE_PATH)}


@router.post("")
def create_repair(eng_id: str, data: RepairIn, db: Session = Depends(get_db)):
    r = CarRepair(id=str(uuid.uuid4()), engineer_id=eng_id, created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    _apply(r, data)
    db.add(r); db.commit()
    return _repair_dict(r)


@router.put("/{repair_id}")
def update_repair(eng_id: str, repair_id: str, data: RepairIn, db: Session = Depends(get_db)):
    r = _get(eng_id, repair_id, db)
    _apply(r, data)
    db.commit()
    return _repair_dict(r)


@router.delete("/{repair_id}")
def delete_repair(eng_id: str, repair_id: str, db: Session = Depends(get_db)):
    db.delete(_get(eng_id, repair_id, db)); db.commit()
    return {"ok": True}


def _kdate(d: str) -> str:
    return f"{d[:4]}년 {d[5:7]}월 {d[8:10]}일" if d else ""


def _set_cached(root, ref: str, value):
    """수식 칸에 계산해 둔 값을 같이 적는다 (수식을 다시 계산하지 않는 미리보기에서도 숫자가 보이게)."""
    for c in root.iter(doc_fill.S + "c"):
        if c.get("r") == ref and c.find(doc_fill.S + "f") is not None:
            for ch in c.findall(doc_fill.S + "v"):
                c.remove(ch)
            c.attrib.pop("t", None)
            doc_fill.etree.SubElement(c, doc_fill.S + "v").text = str(value)
            return


def build_repair_doc(template: bytes, r: CarRepair, profile: dict) -> bytes:
    try:
        sheet, part = next(iter(doc_fill._sheet_parts(zipfile.ZipFile(io.BytesIO(template))).items()))
    except Exception:
        raise HTTPException(400, detail="품의서 양식을 읽지 못했습니다")
    items = _items(r)
    cells = {"G4": f" 작성일 : {_kdate(r.doc_date)}", "D5": profile["dept"], "D6": profile["position"],
             "E6": f"           {profile['name']}  (인)", "D8": r.title, "D9": r.vendor, "D11": "", "D12": ""}
    for n in range(MAX_ITEMS):
        row, it = ITEM_FIRST_ROW + n, (items[n] if n < len(items) else None)
        cells[f"B{row}"] = r.vendor if it else ""
        cells[f"C{row}"] = it["name"] if it else ""
        cells[f"E{row}"] = str(it["price"]) if it else ""
        cells[f"F{row}"] = str(it["qty"]) if it else ""
    notes = [l.strip() for l in (r.note or "").splitlines() if l.strip()][:MAX_NOTES]
    for n in range(MAX_NOTES):
        line = notes[n] if n < len(notes) else ""
        cells[f"B{NOTE_FIRST_ROW + n}"] = (" " + (line if line.startswith("-") else f"- {line}")) if line else ""
    out = doc_fill.apply(template, "xlsx", {f"{sheet}!{k}": v for k, v in cells.items()})
    zf = zipfile.ZipFile(io.BytesIO(out))
    root = doc_fill._parse(zf.read(part))
    subtotal, total = _totals(items)
    for n, it in enumerate(items):
        _set_cached(root, f"G{ITEM_FIRST_ROW + n}", _num(it["price"] * it["qty"]))
    _set_cached(root, f"G{ITEM_FIRST_ROW + MAX_ITEMS}", _num(subtotal))          # G22 소계
    _set_cached(root, f"G{ITEM_FIRST_ROW + MAX_ITEMS + 1}", _num(subtotal * (1 + VAT)))   # G23 계(부가세 포함)
    _set_cached(root, "D10", total)
    return doc_fill._rewrite(zf, {part: doc_fill._dump(root)})


@router.get("/{repair_id}/document")
def download_document(eng_id: str, repair_id: str, db: Session = Depends(get_db)):
    r = _get(eng_id, repair_id, db)
    if not os.path.isfile(TEMPLATE_PATH):
        raise HTTPException(404, detail="품의서 양식 파일이 서버에 없습니다 (data/doc_templates/car_repair.xlsx)")
    with open(TEMPLATE_PATH, "rb") as f:
        template = f.read()
    try:
        out = build_repair_doc(template, r, _profile(eng_id, db))
    except doc_fill.TemplateError as e:
        raise HTTPException(400, detail=str(e))
    filename = f"법인차량 점검_품의서_{(r.car_no or '').replace(' ', '')}_{r.doc_date.replace('-', '')}.xlsx"
    return StreamingResponse(BytesIO(out), media_type=XLSX_MIME,
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})
