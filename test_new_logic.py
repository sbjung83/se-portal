from datetime import datetime, timedelta

def get_month_week(dt):
    first_day = dt.replace(day=1)
    first_mon_day = 1 + (7 - first_day.weekday()) % 7
    if dt.day < first_mon_day:
        prev_month_last_day = first_day - timedelta(days=1)
        return get_month_week(prev_month_last_day)
    week_num = (dt.day - first_mon_day) // 7 + 1
    return f"{dt.month}월 {week_num}주차"

print("July 1:", get_month_week(datetime.strptime('2026-07-01', '%Y-%m-%d')))
print("July 6:", get_month_week(datetime.strptime('2026-07-06', '%Y-%m-%d')))
print("July 13:", get_month_week(datetime.strptime('2026-07-13', '%Y-%m-%d')))
