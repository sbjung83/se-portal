"""차량 운행 일지 (월 단위).

일정(점검·기술지원)을 가져와 운행 줄을 만들고, 그 달 첫 출발 km 와 마지막 도착 km 만 넣으면
거래처별 평소 거리 비율로 나눠 줄마다 출발·도착 km 를 채운다. 엑셀은 서버에 둔 양식
(`data/doc_templates/car_log.xlsx`)에 써넣어 내려준다.
"""
import io
import os
import re
import uuid
import zipfile
from datetime import datetime
from io import BytesIO
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import doc_fill
from database import CarMonth, CarProfile, CarTrip, Engineer, Schedule, WorkPlan, get_db

router = APIRouter(prefix="/api/engineers/{eng_id}/carlog", tags=["carlog"])

TEMPLATE_PATH = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "doc_templates", "car_log.xlsx"))
FIRST_ROW, LAST_ROW = 11, 296        # 양식에서 운행을 적는 줄
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ProfileIn(BaseModel):
    car_model: str = ""
    car_no: str = ""
    start_place: str = "회사"
    driver_name: str = ""      # 비우면 로그인 이름
    biz_no: str = ""


class MonthIn(BaseModel):
    month: str
    start_km: Optional[int] = None


class TripIn(BaseModel):
    trip_date: str
    start_place: Optional[str] = None       # 비우면 기본 출발지
    purpose: str = ""
    km: int = 0
    note: str = ""


class TripUpdate(BaseModel):
    trip_date: Optional[str] = None
    driver: Optional[str] = None            # 이 줄만 다른 성명 ("" = 기본 성명)
    start_place: Optional[str] = None
    purpose: Optional[str] = None
    km: Optional[int] = None
    note: Optional[str] = None


class DistributeIn(BaseModel):
    month: str
    start_km: int
    end_km: int
    keep_filled: bool = False                # 이미 거리를 넣은 줄은 그대로 두고 빈 줄만 채운다


def _ym(month: Optional[str]) -> str:
    month = month or datetime.now().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(400, detail="월 형식이 올바르지 않습니다 (YYYY-MM)")
    return month


def _date(v: str) -> str:
    try:
        return datetime.strptime((v or "").strip()[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, detail="날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _profile(eng_id: str, db: Session) -> CarProfile:
    p = db.query(CarProfile).filter(CarProfile.engineer_id == eng_id).first()
    if not p:
        p = CarProfile(engineer_id=eng_id, car_model="", car_no="", start_place="회사")
        db.add(p); db.commit()
    return p


def _month(eng_id: str, ym: str, db: Session) -> CarMonth:
    m = db.query(CarMonth).filter(CarMonth.engineer_id == eng_id, CarMonth.ym == ym).first()
    if not m:
        m = CarMonth(id=str(uuid.uuid4()), engineer_id=eng_id, ym=ym, start_km=None, imported=False)
        db.add(m); db.commit()
    return m


def _trips(eng_id: str, ym: str, db: Session) -> list:
    return (db.query(CarTrip).filter(CarTrip.engineer_id == eng_id, CarTrip.trip_date.startswith(ym))
            .order_by(CarTrip.trip_date, CarTrip.created_at, CarTrip.id).all())


def _prev_end(eng_id: str, ym: str, db: Session) -> Optional[int]:
    """바로 앞 달(기록이 있는 가장 가까운 달)의 마지막 도착 km."""
    m = (db.query(CarMonth).filter(CarMonth.engineer_id == eng_id, CarMonth.ym < ym, CarMonth.start_km.isnot(None))
         .order_by(CarMonth.ym.desc()).first())
    if not m:
        return None
    return m.start_km + sum(t.km or 0 for t in _trips(eng_id, m.ym, db))


def _import(eng_id: str, ym: str, db: Session) -> int:
    """그 달의 점검 일정·기술지원(유선원격만 한 건 제외)을 운행 줄로 만든다. 이미 가져온 건·같은 날 같은 거래처는 건너뛴다."""
    start_place = _profile(eng_id, db).start_place or "회사"
    have = _trips(eng_id, ym, db)
    seen_src = {t.src for t in have if t.src}
    seen_day = {(t.trip_date, (t.purpose or "").strip()) for t in have}
    found = []
    for s in db.query(Schedule).filter(Schedule.engineer_id == eng_id, Schedule.sched_date.startswith(ym)).all():
        found.append((s.sched_date[:10], (s.site.name if s.site else "").strip(), f"sched:{s.id}"))
    for w in db.query(WorkPlan).filter(WorkPlan.engineer_id == eng_id, WorkPlan.id.startswith("wp-"),
                                       WorkPlan.work_date.startswith(ym)).all():
        types = {x.strip() for x in (w.support_type or "").split(",") if x.strip()}
        if types == {"유선원격"}:
            continue
        found.append(((w.work_date or "")[:10], (w.site or "").strip(), f"wp:{w.id}"))
    added = 0
    for day, site, src in sorted(found):
        if not site or src in seen_src or (day, site) in seen_day:
            continue
        seen_day.add((day, site))
        db.add(CarTrip(id=str(uuid.uuid4()), engineer_id=eng_id, trip_date=day, start_place=start_place,
                       purpose=site, km=0, note="", src=src, created_at=_now() + f".{added:03d}"))
        added += 1
    db.commit()
    return added


def _state(eng_id: str, ym: str, db: Session, imported: int = 0) -> dict:
    p, m = _profile(eng_id, db), _month(eng_id, ym, db)
    eng = db.query(Engineer).filter(Engineer.id == eng_id).first()
    prev_end = _prev_end(eng_id, ym, db)
    start = m.start_km if m.start_km is not None else prev_end
    rows, cur = [], start
    for t in _trips(eng_id, ym, db):
        km = t.km or 0
        s = cur if (cur is not None and km) else None       # 거리를 아직 안 넣은 줄은 km 를 비워 둔다
        e = cur + km if s is not None else None
        if e is not None:
            cur = e
        rows.append({"id": t.id, "trip_date": t.trip_date, "driver": t.driver or "", "start_place": t.start_place, "purpose": t.purpose,
                     "km": km, "note": t.note, "from_schedule": bool(t.src), "start_km": s, "end_km": e})
    total = sum(r["km"] for r in rows)
    login_name = eng.name if eng else ""
    return {"month": ym, "name": (p.driver_name or "").strip() or login_name, "login_name": login_name,
            "profile": {"car_model": p.car_model, "car_no": p.car_no, "start_place": p.start_place or "회사",
                        "driver_name": p.driver_name or "", "biz_no": p.biz_no or ""},
            "start_km": start, "start_km_is_carried": m.start_km is None and prev_end is not None,
            "end_km": (start + total) if start is not None else None, "total_km": total,
            "empty_count": sum(1 for r in rows if not r["km"]), "imported": imported,
            "has_template": os.path.isfile(TEMPLATE_PATH), "trips": rows}


@router.get("")
def get_month(eng_id: str, month: Optional[str] = None, db: Session = Depends(get_db)):
    """그 달의 운행 일지. 처음 여는 달은 일정에서 운행 줄을 자동으로 가져온다."""
    ym = _ym(month)
    m, added = _month(eng_id, ym, db), 0
    if not m.imported:
        if not _trips(eng_id, ym, db):
            added = _import(eng_id, ym, db)
        m.imported = True
        db.commit()
    return _state(eng_id, ym, db, added)


@router.post("/import")
def import_schedules(eng_id: str, month: Optional[str] = None, db: Session = Depends(get_db)):
    ym = _ym(month)
    return _state(eng_id, ym, db, _import(eng_id, ym, db))


@router.put("/profile")
def set_profile(eng_id: str, data: ProfileIn, db: Session = Depends(get_db)):
    p = _profile(eng_id, db)
    p.car_model, p.car_no = data.car_model.strip()[:40], data.car_no.strip()[:30]
    p.start_place = data.start_place.strip()[:40] or "회사"
    p.driver_name, p.biz_no = data.driver_name.strip()[:30], data.biz_no.strip()[:30]
    db.commit()
    return {"ok": True}


@router.put("/month")
def set_month(eng_id: str, data: MonthIn, db: Session = Depends(get_db)):
    ym = _ym(data.month)
    if data.start_km is not None and not (0 <= data.start_km <= 9_999_999):
        raise HTTPException(400, detail="주행 km 값이 올바르지 않습니다")
    m = _month(eng_id, ym, db)
    m.start_km = data.start_km
    db.commit()
    return _state(eng_id, ym, db)


def _check_trip(t: CarTrip):
    t.trip_date = _date(t.trip_date)
    t.start_place = (t.start_place or "").strip()[:40]
    t.purpose = (t.purpose or "").strip()[:80]
    t.note = (t.note or "").strip()[:100]
    t.driver = (t.driver or "").strip()[:30]
    if t.km is None or not (0 <= t.km <= 5000):
        raise HTTPException(400, detail="운행 거리는 0~5000km 사이로 넣어주세요")


@router.post("/trips")
def create_trip(eng_id: str, data: TripIn, db: Session = Depends(get_db)):
    place = data.start_place if data.start_place is not None else (_profile(eng_id, db).start_place or "회사")
    t = CarTrip(id=str(uuid.uuid4()), engineer_id=eng_id, trip_date=data.trip_date, start_place=place,
                purpose=data.purpose, km=data.km, note=data.note, src="", created_at=_now())
    _check_trip(t)
    db.add(t); db.commit()
    return _state(eng_id, t.trip_date[:7], db)


@router.patch("/trips/{trip_id}")
def update_trip(eng_id: str, trip_id: str, data: TripUpdate, db: Session = Depends(get_db)):
    t = db.query(CarTrip).filter(CarTrip.id == trip_id, CarTrip.engineer_id == eng_id).first()
    if not t:
        raise HTTPException(404, detail="운행 기록을 찾을 수 없습니다")
    for k, v in data.dict(exclude_none=True).items():
        setattr(t, k, v)
    _check_trip(t)
    db.commit()
    return {"ok": True}


@router.delete("/trips/{trip_id}")
def delete_trip(eng_id: str, trip_id: str, db: Session = Depends(get_db)):
    t = db.query(CarTrip).filter(CarTrip.id == trip_id, CarTrip.engineer_id == eng_id).first()
    if not t:
        raise HTTPException(404, detail="운행 기록을 찾을 수 없습니다")
    db.delete(t); db.commit()
    return {"ok": True}


@router.post("/distribute")
def distribute(eng_id: str, data: DistributeIn, db: Session = Depends(get_db)):
    """첫 출발 km 와 마지막 도착 km 사이의 거리를 운행 줄에 나눈다.

    나누는 비율 = 그 거래처에 갔던 다른 달 운행의 평균 거리 (없으면 전체 평균, 그것도 없으면 똑같이)."""
    ym = _ym(data.month)
    trips = _trips(eng_id, ym, db)
    if not trips:
        raise HTTPException(400, detail="이 달에 운행 줄이 없습니다. 먼저 일정을 가져오거나 운행을 추가해주세요")
    total = data.end_km - data.start_km
    if data.start_km < 0 or total <= 0:
        raise HTTPException(400, detail="마지막 도착 km 가 첫 출발 km 보다 커야 합니다")
    targets = [t for t in trips if not (data.keep_filled and (t.km or 0) > 0)]
    remain = total - sum(t.km or 0 for t in trips if t not in targets)
    if not targets:
        raise HTTPException(400, detail="채울 빈 줄이 없습니다 ('넣어 둔 거리는 그대로' 를 끄면 전체를 다시 나눕니다)")
    if remain < len(targets):
        raise HTTPException(400, detail="이미 넣은 거리의 합이 전체 주행 거리보다 큽니다")
    hist = {}
    for t in db.query(CarTrip).filter(CarTrip.engineer_id == eng_id, CarTrip.km > 0).all():
        if not t.trip_date.startswith(ym) or t not in targets:
            hist.setdefault((t.purpose or "").strip(), []).append(t.km)
    overall = [k for v in hist.values() for k in v]
    base = sum(overall) / len(overall) if overall else 1.0
    weights = [(sum(hist[p]) / len(hist[p])) if (p := (t.purpose or "").strip()) in hist else base for t in targets]
    wsum = sum(weights)
    exact = [remain * w / wsum for w in weights]
    alloc = [max(1, int(x)) for x in exact]
    diff = remain - sum(alloc)
    order = sorted(range(len(targets)), key=lambda i: exact[i] - int(exact[i]), reverse=True)
    i = 0
    while diff != 0 and i < 100000:          # 나머지를 소수 부분이 큰 줄부터 1km 씩 맞춘다
        j = order[i % len(order)]
        if diff > 0:
            alloc[j] += 1; diff -= 1
        elif alloc[j] > 1:
            alloc[j] -= 1; diff += 1
        i += 1
    for t, km in zip(targets, alloc):
        t.km = km
    _month(eng_id, ym, db).start_km = data.start_km
    db.commit()
    out = _state(eng_id, ym, db)
    out["used_history"] = bool(overall)
    return out


@router.get("/download")
def download(eng_id: str, month: Optional[str] = None, db: Session = Depends(get_db)):
    ym = _ym(month)
    if not os.path.isfile(TEMPLATE_PATH):
        raise HTTPException(404, detail="운행 일지 양식 파일이 서버에 없습니다 (data/doc_templates/car_log.xlsx)")
    st = _state(eng_id, ym, db)
    if len(st["trips"]) > LAST_ROW - FIRST_ROW + 1:
        raise HTTPException(400, detail="운행 줄이 양식에 들어갈 수 있는 수보다 많습니다")
    with open(TEMPLATE_PATH, "rb") as f:
        template = f.read()
    try:
        sheet = next(iter(doc_fill._sheet_parts(zipfile.ZipFile(io.BytesIO(template)))))
    except Exception:
        raise HTTPException(400, detail="운행 일지 양식을 읽지 못했습니다")
    year, mon = ym.split("-")
    edits = {f"{sheet}!E5": f"{mon}월 차 량 운 행 일 지", f"{sheet}!A8": st["profile"]["car_model"], f"{sheet}!D8": st["profile"]["car_no"],
             f"{sheet}!E3": st["profile"]["biz_no"]}
    clear_to = max(FIRST_ROW + len(st["trips"]), 40)      # 양식에 예시로 적혀 있던 줄을 지운다
    for row in range(FIRST_ROW, clear_to + 1):
        for col in "ABCDEFGHI":
            edits[f"{sheet}!{col}{row}"] = ""              # 수식이 든 칸(F35~)은 doc_fill 이 그대로 둔다
    for i, t in enumerate(st["trips"]):
        row, d = FIRST_ROW + i, t["trip_date"]
        vals = {"A": str(int(d[:4])), "B": str(int(d[5:7])), "C": str(int(d[8:10])), "D": t["driver"] or st["name"], "E": t["start_place"],
                "F": "" if t["start_km"] is None else str(t["start_km"]), "G": t["purpose"],
                "H": "" if t["end_km"] is None else str(t["end_km"]), "I": t["note"]}
        for col, v in vals.items():
            edits[f"{sheet}!{col}{row}"] = v
    try:
        out = doc_fill.apply(template, "xlsx", edits)
    except doc_fill.TemplateError as e:
        raise HTTPException(400, detail=str(e))
    filename = f"차량운행일지_{st['name']}_{year}년{mon}월.xlsx"
    return StreamingResponse(BytesIO(out), media_type=XLSX_MIME,
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})
