from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, WebSocketException
from fastapi.responses import HTMLResponse
from typing import List, Dict, Any

router = APIRouter(prefix='/socket', tags=["Socket"])

class ConnectionManager:
    def __init__(self):
        self.active_connection: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connection.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connection.remove(websocket)
    
