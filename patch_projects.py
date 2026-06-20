import sys

with open('/opt/se-portal/routers/projects.py', 'r') as f:
    code = f.read()

# Add template to ProjectCreate
code = code.replace(
'''class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = ""''',
'''class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = ""
    template: Optional[str] = ""'''
)

# Also modify create_project to handle template
old_create = '''@router.post("")
def create_project(eng_id: str, payload: ProjectCreate, db: Session = Depends(get_db)):
    pid = str(uuid.uuid4())
    p = Project(
        id=pid,
        engineer_id=eng_id,
        name=payload.name,
        customer=payload.customer,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
        description=payload.description
    )
    db.add(p)
    db.commit()
    return {"message": "Project created", "id": pid}'''

new_create = '''@router.post("")
def create_project(eng_id: str, payload: ProjectCreate, db: Session = Depends(get_db)):
    pid = str(uuid.uuid4())
    p = Project(
        id=pid,
        engineer_id=eng_id,
        name=payload.name,
        customer=payload.customer,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=payload.status,
        description=payload.description
    )
    db.add(p)
    
    if payload.template and payload.start_date:
        from datetime import datetime, timedelta
        try:
            start_dt = datetime.strptime(payload.start_date, "%Y-%m-%d")
            templates = {
                "storage": [
                    "스토리지 납품",
                    "스토리지 설치 및 구성",
                    "데이터 복제 구성 (GAD 등)",
                    "호스트 연결 및 절체 테스트",
                    "안정화 및 산출물 제출"
                ],
                "server": [
                    "서버 납품",
                    "OS 설치 및 기본 구성",
                    "네트워크 및 스토리지 연동",
                    "애플리케이션 설치 지원",
                    "안정화 및 산출물 제출"
                ]
            }
            tasks = templates.get(payload.template, [])
            for i, task_name in enumerate(tasks):
                due = (start_dt + timedelta(days=7*(i+1) - 1)).strftime("%Y-%m-%d")
                t = ProjectTask(
                    id=str(uuid.uuid4()),
                    project_id=pid,
                    name=f"{i+1}주차: {task_name}",
                    status="대기",
                    due_date=due,
                    order_idx=i
                )
                db.add(t)
        except Exception as e:
            pass # ignore date parsing errors

    db.commit()
    return {"message": "Project created", "id": pid}'''

code = code.replace(old_create, new_create)

with open('/opt/se-portal/routers/projects.py', 'w') as f:
    f.write(code)
print("PATCH_DONE")
