from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Schedule
import os

DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "portal.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("Schedules in DB:")
for s in db.query(Schedule).all():
    print(s.id, s.title, s.status)

