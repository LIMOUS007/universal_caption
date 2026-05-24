"""
WebSocket transcription endpoint.

Protocol
--------
Client → Server:
  1. TEXT  {"type":"session_start","provider":"openai_chunked","api_key":"...",
            "model":"whisper-1","sample_rate":16000,"encoding":"pcm_f32le"}
  2. BINARY <raw Float32-LE PCM frames>  (repeated)
  3. TEXT  {"type":"session_end"}         (graceful stop; or just disconnect)

Server → Client:
  1. {"type":"session_started","session_id":"<uuid>"}
  2. {"type":"transcript_delta","text":"...","is_final":false}  (Realtime only)
  3. {"type":"transcript","text":"...","is_final":true}
  4. {"type":"error","message":"..."}
  5. {"type":"session_ended","session_id":"<uuid>"}
"""

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from db import queries
from events import TranscriptEvent
from providers.factory import create_provider
from session_manager import SessionManager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/transcribe")
async def transcribe(ws: WebSocket) -> None:
    await ws.accept()

    session_manager = SessionManager(ws.app.state.redis)
    session_id: str | None = None
    provider = None

    try:
        # ----------------------------------------------------------------
        # Phase 1 — handshake
        # ----------------------------------------------------------------
        start_msg = await ws.receive_json()
        if start_msg.get("type") != "session_start":
            await ws.send_json({"type": "error", "message": "First message must be session_start"})
            await ws.close()
            return

        provider_type: str = start_msg["provider"]
        sample_rate: int   = int(start_msg.get("sample_rate", 16_000))
        encoding: str      = start_msg.get("encoding", "pcm_f32le")
        provider_config = {
            "api_key":     start_msg.get("api_key", ""),
            "model":       start_msg.get("model", "whisper-1"),
            "sample_rate": sample_rate,
            "language":    start_msg.get("language"),
        }

        session_id = await session_manager.create(
            provider=provider_type,
            model=provider_config["model"],
            sample_rate=sample_rate,
            encoding=encoding,
        )

        try:
            await queries.insert_session(
                session_id=session_id,
                provider=provider_type,
                model=provider_config["model"],
                sample_rate=sample_rate,
                encoding=encoding,
            )
        except Exception as exc:
            print(f"[ws] DB insert_session non-fatal: {exc}")

        provider = create_provider(provider_type, provider_config)
        await provider.start()

        await ws.send_json({"type": "session_started", "session_id": session_id})

        # ----------------------------------------------------------------
        # Phase 2 — bidirectional streaming
        # ----------------------------------------------------------------
        bytes_per_second = sample_rate * 4  # Float32-LE

        async def client_to_provider() -> None:
            while True:
                try:
                    frame = await ws.receive()
                except WebSocketDisconnect:
                    break

                if frame["type"] == "websocket.disconnect":
                    break

                if frame.get("bytes"):
                    chunk = frame["bytes"]
                    seq = await session_manager.increment_seq(session_id)
                    await provider.send_audio(chunk, {"seq": seq})
                    await session_manager.add_audio_seconds(
                        session_id, len(chunk) / bytes_per_second
                    )

                elif frame.get("text"):
                    try:
                        ctrl = json.loads(frame["text"])
                        if ctrl.get("type") == "session_end":
                            break
                    except Exception:
                        pass

        async def provider_to_client() -> None:
            async for event in provider.events():
                await ws.send_json(event.to_dict())
                if event.is_final and event.text.strip():
                    try:
                        await queries.insert_segment(
                            session_id=session_id,
                            text=event.text,
                            start_ms=event.start_ms,
                            end_ms=event.end_ms,
                            confidence=event.confidence,
                            is_final=event.is_final,
                        )
                    except Exception as exc:
                        print(f"[ws] DB insert_segment non-fatal: {exc}")

        client_task   = asyncio.create_task(client_to_provider())
        provider_task = asyncio.create_task(provider_to_client())

        done, pending = await asyncio.wait(
            [client_task, provider_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        # Surface any exception from the finished task
        for task in done:
            exc = task.exception()
            if exc:
                print(f"[ws] Task raised: {exc}")

    except WebSocketDisconnect:
        pass

    except Exception as exc:
        print(f"[ws] Unhandled: {exc}")
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass

    finally:
        if provider:
            await provider.stop()

        if session_id:
            state = await session_manager.get(session_id) or {}
            audio_seconds = float(state.get("audio_seconds", 0))
            await session_manager.close(session_id)

            try:
                await queries.close_session(session_id)
                if audio_seconds > 0:
                    await queries.insert_usage_event(
                        session_id=session_id,
                        provider=state.get("provider", "unknown"),
                        audio_seconds=audio_seconds,
                    )
            except Exception as exc:
                print(f"[ws] DB teardown non-fatal: {exc}")

            try:
                await ws.send_json({"type": "session_ended", "session_id": session_id})
            except Exception:
                pass
