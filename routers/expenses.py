"""개인 경비 정산 내역서 (월 단위).

머리글(제목·신청자·법인카드 번호)과 지출 줄(날짜·거래처·지출내용·법인카드/현금 금액·비고)을 입력하면
`GET /download` 가 서버에 둔 양식(`data/doc_templates/expense.xlsx`)에 채워 내려준다.

- 신청자·법인카드 번호는 저장할 때마다 `expense_profiles` 에 기본값으로 남아 다음 달 새로 쓸 때 미리 채워진다.
  달마다 따로 고칠 수 있다(`expense_reports`). 카드 번호는 secure_store 로 암호화 저장.
- 양식 칸 — 양식을 바꾸면 여기도 확인할 것:
  A1 제목 / B3 신청자 / D5 "법인카드\n(끝 4자리)" / 6~38행 지출 줄(A 날짜, B 거래처, C 지출내용, D 법인카드, E 현금(개인카드), F 비고)
  D39·E39 합계, D40 총계는 양식의 수식.
"""
import io
import os
import re
import uuid
import zipfile
from datetime import date, datetime
from io import BytesIO
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import doc_fill
import secure_store
from database import Engineer, ExpenseItem, ExpenseProfile, ExpenseReport, get_db

router = APIRouter(prefix="/api/engineers/{eng_id}/expenses", tags=["expenses"])

TEMPLATE_PATH = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "doc_templates", "expense.xlsx"))
FIRST_ROW, LAST_ROW = 6, 38
MAX_ROWS = LAST_ROW - FIRST_ROW + 1
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ITEM_FIELDS = ("spend_date", "vendor", "content", "card_amount", "cash_amount", "note")


def _ym(month: Optional[str]) -> str:
    month = (month or datetime.now().strftime("%Y-%m"))[:7]
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(400, detail="월 형식이 올바르지 않습니다 (YYYY-MM)")
    return month


def _default_title(ym: str) -> str:
    return f"{ym[:4]}년 {ym[5:7]}월 개인경비 정산 내역서"


def _card_tail(card_no: str) -> str:
    """양식 머리글에는 카드 번호 끝 4자리만 넣는다."""
    digits = re.sub(r"\D", "", card_no or "")
    return digits[-4:] if len(digits) >= 4 else (card_no or "").strip()


def _profile(eng_id: str, db: Session) -> dict:
    p = db.query(ExpenseProfile).filter(ExpenseProfile.engineer_id == eng_id).first()
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    return {"applicant": (p.applicant if p and p.applicant else (eng.name if eng else "")) or "",
            "card_no": secure_store.decrypt(p.card_no) if p and p.card_no else ""}


def _report(eng_id: str, ym: str, db: Session, create=False) -> Optional[ExpenseReport]:
    r = db.query(ExpenseReport).filter(ExpenseReport.engineer_id == eng_id, ExpenseReport.month == ym).first()
    if r is None and create:
        p = _profile(eng_id, db)
        r = ExpenseReport(id=str(uuid.uuid4()), engineer_id=eng_id, month=ym, title=_default_title(ym),
                          applicant=p["applicant"], card_no=secure_store.encrypt(p["card_no"]) if p["card_no"] else "")
        db.add(r)
        db.flush()
    return r


def _items(r: Optional[ExpenseReport], db: Session) -> list:
    if r is None:
        return []
    return (db.query(ExpenseItem).filter(ExpenseItem.report_id == r.id)
            .order_by(ExpenseItem.spend_date, ExpenseItem.order_idx).all())


def _item_dict(i: ExpenseItem) -> dict:
    return {"id": i.id, "spend_date": i.spend_date or "", "vendor": i.vendor or "", "content": i.content or "",
            "card_amount": i.card_amount or 0, "cash_amount": i.cash_amount or 0, "note": i.note or ""}


def _state(eng_id: str, ym: str, db: Session) -> dict:
    r = _report(eng_id, ym, db)
    prof = _profile(eng_id, db)
    items = [_item_dict(i) for i in _items(r, db)]
    card = sum(i["card_amount"] for i in items)
    cash = sum(i["cash_amount"] for i in items)
    return {"month": ym, "saved": r is not None,
            "title": r.title if r else _default_title(ym),
            "applicant": r.applicant if r else prof["applicant"],
            "card_no": (secure_store.decrypt(r.card_no) if r and r.card_no else ("" if r else prof["card_no"])),
            "profile": prof, "items": items, "card_total": card, "cash_total": cash, "total": card + cash,
            "max_rows": MAX_ROWS, "has_template": os.path.isfile(TEMPLATE_PATH)}


@router.get("")
def get_month(eng_id: str, month: Optional[str] = None, db: Session = Depends(get_db)):
    return _state(eng_id, _ym(month), db)


class HeaderIn(BaseModel):
    month: str
    title: Optional[str] = ""
    applicant: Optional[str] = ""
    card_no: Optional[str] = ""


@router.put("/header")
def save_header(eng_id: str, data: HeaderIn, db: Session = Depends(get_db)):
    """이 달의 제목·신청자·카드 번호. 신청자·카드 번호는 다음 달 기본값으로도 남긴다."""
    ym = _ym(data.month)
    applicant, card_no = (data.applicant or "").strip(), (data.card_no or "").strip()
    if len(card_no) > 40:
        raise HTTPException(400, detail="카드 번호가 너무 깁니다")
    r = _report(eng_id, ym, db, create=True)
    r.title = (data.title or "").strip() or _default_title(ym)
    r.applicant = applicant
    r.card_no = secure_store.encrypt(card_no) if card_no else ""
    p = db.query(ExpenseProfile).filter(ExpenseProfile.engineer_id == eng_id).first()
    if p is None:
        p = ExpenseProfile(engineer_id=eng_id)
        db.add(p)
    p.applicant, p.card_no = applicant, r.card_no
    db.commit()
    return _state(eng_id, ym, db)


class ItemNew(BaseModel):
    month: str
    spend_date: Optional[str] = ""


@router.post("/items")
def add_item(eng_id: str, data: ItemNew, db: Session = Depends(get_db)):
    ym = _ym(data.month)
    r = _report(eng_id, ym, db, create=True)
    n = len(_items(r, db))
    if n >= MAX_ROWS:
        raise HTTPException(400, detail=f"양식에는 한 달에 {MAX_ROWS}줄까지 들어갑니다")
    day = (data.spend_date or "")[:10]
    if not day.startswith(ym):
        today = date.today().isoformat()
        day = today if today.startswith(ym) else f"{ym}-01"
    db.add(ExpenseItem(id=str(uuid.uuid4()), report_id=r.id, engineer_id=eng_id, spend_date=day, order_idx=n))
    db.commit()
    return _state(eng_id, ym, db)


class ItemUpdate(BaseModel):
    spend_date: Optional[str] = None
    vendor: Optional[str] = None
    content: Optional[str] = None
    card_amount: Optional[int] = None
    cash_amount: Optional[int] = None
    note: Optional[str] = None


def _get_item(eng_id: str, item_id: str, db: Session) -> ExpenseItem:
    i = db.query(ExpenseItem).filter(ExpenseItem.id == item_id, ExpenseItem.engineer_id == eng_id).first()
    if not i:
        raise HTTPException(404, detail="지출 줄을 찾을 수 없습니다")
    return i


@router.patch("/items/{item_id}")
def update_item(eng_id: str, item_id: str, data: ItemUpdate, db: Session = Depends(get_db)):
    i = _get_item(eng_id, item_id, db)
    r = db.query(ExpenseReport).filter(ExpenseReport.id == i.report_id).first()
    upd = data.dict(exclude_none=True)
    if "spend_date" in upd:
        try:
            d = datetime.strptime(upd["spend_date"][:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, detail="날짜 형식이 올바르지 않습니다")
        if not d.startswith(r.month):
            raise HTTPException(400, detail=f"{r.month[:4]}년 {int(r.month[5:])}월 날짜만 넣을 수 있습니다")
        upd["spend_date"] = d
    for k in ("card_amount", "cash_amount"):
        if k in upd and upd[k] < 0:
            raise HTTPException(400, detail="금액이 올바르지 않습니다")
    for k, v in upd.items():
        setattr(i, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return _state(eng_id, r.month, db)


@router.delete("/items/{item_id}")
def delete_item(eng_id: str, item_id: str, db: Session = Depends(get_db)):
    i = _get_item(eng_id, item_id, db)
    r = db.query(ExpenseReport).filter(ExpenseReport.id == i.report_id).first()
    db.delete(i); db.commit()
    return _state(eng_id, r.month, db)


def _with_totals(data: bytes, st: dict) -> bytes:
    """합계(D39·E39)·총계(D40) 수식 칸에 이번 내용으로 계산한 값을 함께 적어 둔다 (다시 계산하지 않는 뷰어용)."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    sheet, part = next(iter(doc_fill._sheet_parts(zf).items()))
    root = doc_fill._parse(zf.read(part))
    want = {f"D{LAST_ROW + 1}": st["card_total"], f"E{LAST_ROW + 1}": st["cash_total"], f"D{LAST_ROW + 2}": st["total"]}
    for c in root.iter(doc_fill.S + "c"):
        if c.get("r") in want and c.find(doc_fill.S + "f") is not None:
            doc_fill.etree.SubElement(c, doc_fill.S + "v").text = str(want[c.get("r")])
    return doc_fill._rewrite(zf, {part: doc_fill._dump(root)})


def _excel_date(d: str) -> str:
    """양식의 날짜 칸(서식 mm-dd-yy)에 맞게 엑셀 날짜 숫자로 넣는다."""
    try:
        return str((date.fromisoformat(d) - date(1899, 12, 30)).days)
    except ValueError:
        return d


@router.get("/download")
def download(eng_id: str, month: Optional[str] = None, db: Session = Depends(get_db)):
    ym = _ym(month)
    if not os.path.isfile(TEMPLATE_PATH):
        raise HTTPException(404, detail="개인 경비 양식 파일이 서버에 없습니다 (data/doc_templates/expense.xlsx)")
    st = _state(eng_id, ym, db)
    if len(st["items"]) > MAX_ROWS:
        raise HTTPException(400, detail=f"지출 줄이 양식에 들어갈 수 있는 {MAX_ROWS}줄보다 많습니다")
    with open(TEMPLATE_PATH, "rb") as f:
        template = f.read()
    try:
        sheet = next(iter(doc_fill._sheet_parts(zipfile.ZipFile(io.BytesIO(template)))))
    except Exception:
        raise HTTPException(400, detail="개인 경비 양식을 읽지 못했습니다")
    tail = _card_tail(st["card_no"])
    cells = {"A1": st["title"], "B3": st["applicant"], "D5": f"법인카드\n({tail})" if tail else "법인카드"}
    for n in range(MAX_ROWS):
        row, it = FIRST_ROW + n, (st["items"][n] if n < len(st["items"]) else None)
        cells.update({f"A{row}": _excel_date(it["spend_date"]) if it else "", f"B{row}": it["vendor"] if it else "",
                      f"C{row}": it["content"] if it else "", f"F{row}": it["note"] if it else "",
                      f"D{row}": str(it["card_amount"]) if it and it["card_amount"] else "",
                      f"E{row}": str(it["cash_amount"]) if it and it["cash_amount"] else ""})
    try:
        out = doc_fill.apply(template, "xlsx", {f"{sheet}!{k}": v for k, v in cells.items()})
    except doc_fill.TemplateError as e:
        raise HTTPException(400, detail=str(e))
    out = _with_totals(out, st)
    filename = f"개인경비정산내역서_{st['applicant'] or '신청'}_{ym[:4]}년{ym[5:7]}월.xlsx"
    return StreamingResponse(BytesIO(out), media_type=XLSX_MIME,
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})
