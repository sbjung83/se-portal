import re
with open('/opt/se-portal/routers/projects.py', 'r') as f:
    code = f.read()

old_str = """class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = \"\"\""""

new_str = """class ProjectCreate(BaseModel):
    name: str
    customer: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    status: Optional[str] = "진행 대기"
    description: Optional[str] = ""
    template: Optional[str] = \"\"\""""

code = code.replace(old_str, new_str)

with open('/opt/se-portal/routers/projects.py', 'w') as f:
    f.write(code)
