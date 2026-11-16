"""휴가원 작성과 연차 사용 내역.

화면에서 종류·기간·사유·신청일만 받아 기록하고, 휴가원 문서는 서버에 둔 양식
(`data/doc_templates/leave.docx`)에 그 값을 채워 내려준다 (채우기는 doc_fill.py).
"""
import os
import re
import uuid
from datetime import datetime
from io import BytesIO
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import doc_fill
from database import Engineer, LeaveProfile, LeaveQuota, LeaveRecord, get_db

router = APIRouter(prefix="/api/engineers/{eng_id}/leaves", tags=["leaves"])

TEMPLATE_PATH = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "doc_templates", "leave.docx"))
LEAVE_TYPES = ["연차", "월차", "생리휴가", "경조휴가", "공가", "병가", "조퇴", "결근", "대체휴무", "기타"]   # 휴가원 양식의 번호 순
DEDUCT_TYPES = ("연차", "월차")          # 연차에서 빼는 종류
DEFAULT_TOTAL = 15.0
WEEKDAYS = "월화수목금토일"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class LeaveIn(BaseModel):
    leave_type: str = "연차"
    start_date: str
    end_date: str = ""
    days: float = 1
    reason: str = ""
    apply_date: str = ""


class LeaveUpdate(BaseModel):
    leave_type: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    days: Optional[float] = None
    reason: Optional[str] = None
    apply_date: Optional[str] = None


class QuotaIn(BaseModel):
    year: str
    total_days: float


class ProfileIn(BaseModel):
    dept: str = ""
    position: str = ""
    name: str = ""


def _leave_dict(r: LeaveRecord) -> dict:
    return {"id": r.id, "leave_type": r.leave_type, "start_date": r.start_date, "end_date": r.end_date,
            "days": r.days, "reason": r.reason, "apply_date": r.apply_date or (r.created_at or "")[:10],
            "created_at": r.created_at, "deduct": r.leave_type in DEDUCT_TYPES}


def _check_date(v: str, label: str) -> str:
    try:
        return datetime.strptime((v or "").strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, detail=f"{label} 형식이 올바르지 않습니다 (YYYY-MM-DD)")


def _validate(r: LeaveRecord):
    if r.leave_type not in LEAVE_TYPES:
        raise HTTPException(400, detail=f"휴가 종류 값이 올바르지 않습니다 ({' / '.join(LEAVE_TYPES)})")
    r.start_date = _check_date(r.start_date, "시작일")
    r.end_date = _check_date(r.end_date, "종료일") if (r.end_date or "").strip() else r.start_date
    if r.end_date < r.start_date:
        raise HTTPException(400, detail="종료일이 시작일보다 빠릅니다")
    r.apply_date = _check_date(r.apply_date, "신청일") if (r.apply_date or "").strip() else datetime.now().strftime("%Y-%m-%d")
    if r.days is None or not (0 < r.days <= 366):
        raise HTTPException(400, detail="일수는 0보다 커야 합니다")
    r.reason = (r.reason or "").strip()[:500]


def _check_year(year: str) -> str:
    if not (len(year) == 4 and year.isdigit()):
        raise HTTPException(400, detail="연도 형식이 올바르지 않습니다 (YYYY)")
    return year


def _profile(eng_id: str, db: Session) -> dict:
    p = db.query(LeaveProfile).filter(LeaveProfile.engineer_id == eng_id).first()
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    return {"dept": p.dept if p else "", "position": p.position if p else "",
            "name": (p.name if p and p.name else (eng.name if eng else "")) or ""}


def _get(eng_id: str, leave_id: str, db: Session) -> LeaveRecord:
    r = db.query(LeaveRecord).filter(LeaveRecord.id == leave_id, LeaveRecord.engineer_id == eng_id).first()
    if not r:
        raise HTTPException(404, detail="휴가 기록을 찾을 수 없습니다")
    return r


@router.get("")
def list_leaves(eng_id: str, year: Optional[str] = None, db: Session = Depends(get_db)):
    """그 해(시작일 기준)의 휴가 기록과 연차 합계."""
    year = _check_year(year or datetime.now().strftime("%Y"))
    recs = (db.query(LeaveRecord).filter(LeaveRecord.engineer_id == eng_id, LeaveRecord.start_date.startswith(year))
            .order_by(LeaveRecord.start_date.desc(), LeaveRecord.created_at.desc()).all())
    q = db.query(LeaveQuota).filter(LeaveQuota.engineer_id == eng_id, LeaveQuota.year == year).first()
    total = q.total_days if q else DEFAULT_TOTAL
    used = sum(r.days or 0 for r in recs if r.leave_type in DEDUCT_TYPES)
    other = sum(r.days or 0 for r in recs if r.leave_type not in DEDUCT_TYPES)
    return {"year": year, "total": total, "total_is_default": q is None, "used": used, "remain": total - used,
            "other": other, "types": LEAVE_TYPES, "deduct_types": list(DEDUCT_TYPES),
            "profile": _profile(eng_id, db), "has_template": os.path.isfile(TEMPLATE_PATH),
            "records": [_leave_dict(r) for r in recs]}


@router.put("/quota")
def set_quota(eng_id: str, data: QuotaIn, db: Session = Depends(get_db)):
    year = _check_year(data.year)
    if not (0 <= data.total_days <= 366):
        raise HTTPException(400, detail="총 연차 일수가 올바르지 않습니다")
    q = db.query(LeaveQuota).filter(LeaveQuota.engineer_id == eng_id, LeaveQuota.year == year).first()
    if q:
        q.total_days = data.total_days
    else:
        db.add(LeaveQuota(id=str(uuid.uuid4()), engineer_id=eng_id, year=year, total_days=data.total_days))
    db.commit()
    return {"ok": True}


@router.put("/profile")
def set_profile(eng_id: str, data: ProfileIn, db: Session = Depends(get_db)):
    """휴가원에 들어갈 부서·직위·성명. 비워 두면 양식에 적힌 그대로(성명은 로그인 이름) 쓴다."""
    p = db.query(LeaveProfile).filter(LeaveProfile.engineer_id == eng_id).first()
    if not p:
        p = LeaveProfile(engineer_id=eng_id)
        db.add(p)
    p.dept, p.position, p.name = data.dept.strip()[:50], data.position.strip()[:30], data.name.strip()[:30]
    db.commit()
    return _profile(eng_id, db)


@router.post("")
def create_leave(eng_id: str, data: LeaveIn, db: Session = Depends(get_db)):
    r = LeaveRecord(id=str(uuid.uuid4()), engineer_id=eng_id, created_at=datetime.now().strftime("%Y-%m-%d %H:%M"), **data.dict())
    _validate(r)
    db.add(r); db.commit()
    return _leave_dict(r)


@router.patch("/{leave_id}")
def update_leave(eng_id: str, leave_id: str, data: LeaveUpdate, db: Session = Depends(get_db)):
    r = _get(eng_id, leave_id, db)
    for k, v in data.dict(exclude_none=True).items():
        setattr(r, k, v)
    _validate(r)
    db.commit()
    return _leave_dict(r)


@router.delete("/{leave_id}")
def delete_leave(eng_id: str, leave_id: str, db: Session = Depends(get_db)):
    r = _get(eng_id, leave_id, db)
    db.delete(r); db.commit()
    return {"ok": True}


# ── 휴가원 문서 ───────────────────────────────────────────────
def _num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _kdate(v: str, weekday: bool = False) -> str:
    d = datetime.strptime(v, "%Y-%m-%d")
    return f"{d.year}년 {d.month}월 {d.day}일" + (f"({WEEKDAYS[d.weekday()]})" if weekday else "")


def _flat(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def build_leave_doc(template: bytes, r: LeaveRecord, profile: dict) -> bytes:
    """휴가원 양식에 기록 1건을 채운다. 칸은 양식에 적힌 글자(부서·직위·성명·기간·사유 …)로 찾는다."""
    W = doc_fill.W
    type_pat = r"\s*".join(map(re.escape, r.leave_type))            # 양식은 '연　　차'처럼 띄어 쓴다
    name = profile.get("name") or ""

    def right_cell(tc):
        nxt = tc.getnext()
        while nxt is not None and nxt.tag != W + "tc":
            nxt = nxt.getnext()
        return nxt

    def set_cell(tc, text):
        ps = tc.findall(W + "p") if tc is not None else []
        if ps:
            doc_fill.p_set(ps[0], text)
            for extra in ps[1:]:
                tc.remove(extra)

    def editor(root):
        # 표의 칸: 왼쪽 칸 이름으로 오른쪽 칸을 찾는다
        for tc in root.iter(W + "tc"):
            label = _flat("".join(doc_fill.p_text(p) for p in tc.findall(W + "p")))
            if label == "부서" and profile.get("dept"):
                set_cell(right_cell(tc), profile["dept"])
            elif label == "직위" and profile.get("position"):
                set_cell(right_cell(tc), profile["position"])
            elif label == "성명" and name:
                set_cell(right_cell(tc), " ".join(name))
            elif label == "사유":
                set_cell(right_cell(tc), r.reason or "")
        blank_date = r"(?:\d{4}\s*)?년\s*월\s*일"
        for p in root.iter(W + "p"):
            text = doc_fill.p_text(p)
            if "(" in text and re.search(type_pat + r"\s*\(\s*\)", text):       # 휴가의 종류: 해당 번호에 ○
                doc_fill.p_sub(p, "(" + type_pat + r")\s*\(\s*\)", lambda m: m.group(1) + "( ○ )")
            if "부터" in text:
                doc_fill.p_sub(p, blank_date + r"\s*\(\s*\)", _kdate(r.start_date, True))
            elif "까지" in text:
                doc_fill.p_sub(p, blank_date + r"\s*\(\s*\)", _kdate(r.end_date or r.start_date, True))
            elif "일간" in text:
                doc_fill.p_sub(p, r"\(\s*\)\s*일간", f"( {_num(r.days)} )일간")
            elif re.fullmatch(r"\s*" + blank_date + r"\s*", text):                # 아래쪽 신청일
                doc_fill.p_sub(p, blank_date, _kdate(r.apply_date or r.start_date))
            elif name and re.search(r"신\s*청\s*인\s*:", text):
                doc_fill.p_sub(p, r"(신\s*청\s*인\s*:\s*).*?(\s*\(인\))", lambda m: m.group(1) + "    ".join(name) + m.group(2))

    return doc_fill.docx_edit(template, editor)


@router.get("/{leave_id}/document")
def download_document(eng_id: str, leave_id: str, db: Session = Depends(get_db)):
    r = _get(eng_id, leave_id, db)
    if not os.path.isfile(TEMPLATE_PATH):
        raise HTTPException(404, detail="휴가원 양식 파일이 서버에 없습니다 (data/doc_templates/leave.docx)")
    with open(TEMPLATE_PATH, "rb") as f:
        template = f.read()
    profile = _profile(eng_id, db)
    try:
        out = build_leave_doc(template, r, profile)
    except doc_fill.TemplateError as e:
        raise HTTPException(400, detail=str(e))
    filename = f"휴가원_{profile['name'] or '신청'}_{r.start_date.replace('-', '')}.docx"
    return StreamingResponse(BytesIO(out), media_type=DOCX_MIME,
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})
