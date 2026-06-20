import sqlite3
import math
from datetime import datetime, timedelta

def get_month_week(dt):
    first_day = dt.replace(day=1)
    first_mon_day = 1 + (7 - first_day.weekday()) % 7
    if dt.day < first_mon_day:
        prev_month_last_day = first_day - timedelta(days=1)
        return get_month_week(prev_month_last_day)
    week_num = (dt.day - first_mon_day) // 7 + 1
    return f"{dt.month}월 {week_num}주차"

conn = sqlite3.connect('data/portal.db')
c = conn.cursor()
c.execute("SELECT id, name, start_date FROM project_tasks")
rows = c.fetchall()
updated = 0
for row in rows:
    task_id, name, start_date = row
    if not start_date:
        continue
    # Extract the task description part after the colon
    if ":" in name:
        _, desc = name.split(":", 1)
        desc = desc.strip()
    else:
        desc = name
    
    try:
        dt = datetime.strptime(start_date, "%Y-%m-%d")
        new_name = f"{get_month_week(dt)}: {desc}"
        if new_name != name:
            c.execute("UPDATE project_tasks SET name = ? WHERE id = ?", (new_name, task_id))
            updated += 1
    except Exception as e:
        print(f"Error parsing date {start_date} for task {task_id}: {e}")

conn.commit()
conn.close()
print(f"Updated {updated} tasks.")
