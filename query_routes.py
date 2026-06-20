import sys
sys.path.append("/opt/se-portal")
from app import app
from fastapi.routing import APIRoute

for route in app.routes:
    if isinstance(route, APIRoute):
        print(route.path, route.methods)
