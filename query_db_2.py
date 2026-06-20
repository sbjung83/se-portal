from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Schedule
import os

DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "portal.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

s = db.query(Schedule).filter(Schedule.id == '60d66ca5-e4e7-46e8-b0db-11ac9c9265fb').first()
print(f"Schedule: {s.title}, Engineer ID: {s.engineer_id}")
