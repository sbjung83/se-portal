with open("routers/schedules.py", "r") as f:
    content = f.read()

new_endpoint = """@router.get("/history")
def list_schedule_history(eng_id: str, db: Session = Depends(get_db)):
    \"\"\"완료된 점검 이력 반환\"\"\"
    rows = db.query(Schedule).filter(
        Schedule.engineer_id == eng_id,
        Schedule.status == "완료"
    ).order_by(Schedule.sched_date.desc()).all()
    return [_sch_dict(r, db) for r in rows]

@router.get("/all")"""

content = content.replace('@router.get("/all")', new_endpoint)

with open("routers/schedules.py", "w") as f:
    f.write(content)
