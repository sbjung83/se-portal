import math
from datetime import datetime

def old_logic(dt):
    first_day = dt.replace(day=1)
    first_day_idx = (first_day.weekday() + 1) % 7
    week_num = math.ceil((dt.day + first_day_idx) / 7)
    return f"{dt.month}월 {week_num}주차"

print("Old logic for 2026-07-06:", old_logic(datetime.strptime('2026-07-06', '%Y-%m-%d')))
