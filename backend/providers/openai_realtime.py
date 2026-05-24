"""
OpenAI Realtime Transcription provider.

Uses the OpenAI Realtime API (gpt-4o-transcribe) via the official Python SDK.
Audio arrives as Float32 LE PCM and is converted to Int16 PCM before sending,
because the Realtime API expects pcm16 format.
"""

import asyncio
import base64
import struct
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from events import TranscriptionProvider, TranscriptEvent


class OpenAIRealtimeTranscriber(TranscriptionProvider):
    def __init__(self, config: dict) -> None:
        self._client = AsyncOpenAI(api_key=config["api_key"])
        self._sample_rate: int = config.get("sample_rate", 16_000)
        self._model: str = config.get("model", "gpt-4o-transcribe")
        self._conn = None
        self._ctx = None
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self._recv_task: asyncio.Task | None = None

    async def start(self) -> None:
        self._ctx = self._client.beta.realtime.connect(model=self._model)
        self._conn = await self._ctx.__aenter__()
        await self._conn.session.update(session={
            "modalities": ["text"],
            "input_audio_format": "pcm16",
            "input_audio_transcription": {"model": self._model},
            "turn_detection": {
                "type": "server_vad",
                "silence_duration_ms": 500,
                "threshold": 0.5,
            },
        })
        self._recv_task = asyncio.create_task(self._receive_loop())

    async def _receive_loop(self) -> None:
        try:
            async for event in self._conn:
                et = event.type
                if et == "conversation.item.input_audio_transcription.delta":
                    await self._queue.put(TranscriptEvent(
                        event_type="transcript_delta",
                        text=event.delta,
                        is_final=False,
                    ))
                elif et == "conversation.item.input_audio_transcription.completed":
                    await self._queue.put(TranscriptEvent(
                        event_type="transcript",
                        text=event.transcript,
                        is_final=True,
                    ))
        except Exception as exc:
            print(f"[openai_realtime] receive loop error: {exc}")
        finally:
            await self._queue.put(None)  # sentinel — stops events()

    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        # chunk is Float32 LE from the AudioWorklet; convert to Int16 for OpenAI
        n = len(chunk) // 4
        floats = struct.unpack_from(f"<{n}f", chunk)
        pcm16 = struct.pack(f"<{n}h", *(max(-32_768, min(32_767, int(f * 32_767))) for f in floats))
        await self._conn.input_audio_buffer.append(audio=base64.b64encode(pcm16).decode())

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def stop(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ctx and self._conn:
            try:
                await self._ctx.__aexit__(None, None, None)
            except Exception:
                pass
