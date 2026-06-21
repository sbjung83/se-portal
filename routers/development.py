from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
from typing import Optional, List
import json
import os

router = APIRouter(prefix="/api/dev", tags=["development"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV_CHECKLIST_FILE = os.path.join(BASE_DIR, "data", "portal-development.json")

def load_checklist():
    """JSON 파일에서 체크리스트 로드"""
    if os.path.exists(DEV_CHECKLIST_FILE):
        with open(DEV_CHECKLIST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_checklist(data):
    """체크리스트를 JSON 파일에 저장"""
    os.makedirs(os.path.dirname(DEV_CHECKLIST_FILE), exist_ok=True)
    with open(DEV_CHECKLIST_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class ItemUpdate(BaseModel):
    status: Optional[str] = None  # 예정, 진행중, 완료
    notes: Optional[str] = None
    priority: Optional[str] = None

@router.get("/checklist")
def get_checklist():
    """전체 개발 체크리스트 조회"""
    return load_checklist()

@router.get("/checklist/summary")
def get_summary():
    """체크리스트 요약 통계"""
    data = load_checklist()
    return data.get("summary", {})

@router.get("/checklist/section/{section_name}")
def get_section(section_name: str):
    """특정 섹션 조회"""
    data = load_checklist()
    sections = data.get("sections", [])
    for section in sections:
        if section_name in section.get("category", ""):
            return section
    raise HTTPException(status_code=404, detail="Section not found")

@router.get("/checklist/status/{status}")
def get_by_status(status: str):
    """상태별로 항목 필터링 (완료, 진행중, 예정)"""
    data = load_checklist()
    sections = data.get("sections", [])
    result = []
    
    for section in sections:
        items = [item for item in section.get("items", []) if item.get("status") == status]
        if items:
            result.append({
                "category": section.get("category"),
                "items": items
            })
    
    return result

@router.patch("/checklist/item/{item_id}")
def update_item(item_id: str, update: ItemUpdate):
    """특정 항목 업데이트"""
    data = load_checklist()
    sections = data.get("sections", [])
    
    for section in sections:
        for item in section.get("items", []):
            if item.get("id") == item_id:
                # 상태 업데이트
                if update.status:
                    item["status"] = update.status
                # 노트 업데이트
                if update.notes is not None:
                    item["notes"] = update.notes
                # 우선순위 업데이트
                if update.priority:
                    item["priority"] = update.priority
                
                # 파일 저장
                save_checklist(data)
                
                # 요약 통계 업데이트
                _update_summary(data)
                
                return {"success": True, "item": item}
    
    raise HTTPException(status_code=404, detail="Item not found")

def _update_summary(data):
    """요약 통계 업데이트"""
    total = 0
    completed = 0
    in_progress = 0
    planned = 0
    
    sections = data.get("sections", [])
    for section in sections:
        for item in section.get("items", []):
            total += 1
            status = item.get("status", "")
            if status == "완료":
                completed += 1
            elif status == "진행중":
                in_progress += 1
            elif status == "예정":
                planned += 1
    
    completion_rate = round((completed / total * 100), 1) if total > 0 else 0
    
    data["summary"] = {
        "total_items": total,
        "completed": completed,
        "in_progress": in_progress,
        "planned": planned,
        "completion_rate": f"{completion_rate}%"
    }
    
    save_checklist(data)

@router.get("/checklist/stats")
def get_stats():
    """상세 통계"""
    data = load_checklist()
    sections = data.get("sections", [])
    
    stats = []
    for section in sections:
        total = len(section.get("items", []))
        completed = len([i for i in section.get("items", []) if i.get("status") == "완료"])
        in_progress = len([i for i in section.get("items", []) if i.get("status") == "진행중"])
        planned = len([i for i in section.get("items", []) if i.get("status") == "예정"])
        
        rate = round((completed / total * 100), 1) if total > 0 else 0
        
        stats.append({
            "category": section.get("category"),
            "total": total,
            "completed": completed,
            "in_progress": in_progress,
            "planned": planned,
            "completion_rate": rate
        })
    
    return stats
