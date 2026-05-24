"""
Client WebSocket
    ↓ audio packets
FastAPI server
    ↓ provider WebSocket/session
OpenAI Realtime Transcription
    ↓ transcript deltas
FastAPI server
    ↓ normalized events
Client

pseudocode:

@router.websocket("/ws/transcribe")
async def transcribe(ws: WebSocket):
    await ws.accept()

    session = None
    provider = None

    try:
        start_msg = await ws.receive_json()
        session = await session_manager.create_from_start_message(start_msg)

        provider = provider_factory.create(session.provider_config)
        await provider.start()

        await ws.send_json({
            "type": "session_started",
            "session_id": session.id,
        })

        async def client_to_provider():
            async for packet in receive_audio_packets(ws):
                validated = await packet_validator.validate(packet, session)
                audio_bytes = await decrypt_if_needed(validated)
                await session_manager.record_packet(session.id, validated.seq)
                await provider.send_audio(audio_bytes, validated.metadata)

        async def provider_to_client():
            async for event in provider.events():
                normalized = normalize_transcript_event(event, session.id)
                await ws.send_json(normalized)
                await session_manager.record_transcript_event(session.id, normalized)

        await asyncio.gather(client_to_provider(), provider_to_client())

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await safe_send_error(ws, exc)
    finally:
        if provider:
            await provider.stop()
        if session:
            await session_manager.close(session.id)
"""


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
    
