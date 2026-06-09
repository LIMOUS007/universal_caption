"""
Deepgram Nova transcription provider.

Accumulates Float32 PCM, encodes to WAV, and POSTs to Deepgram's
/v1/listen endpoint (raw binary body — no multipart).
"""

import asyncio
import io
import struct
import wave
from collections.abc import AsyncIterator

import httpx

from events import TranscriptionProvider, TranscriptEvent

_DEFAULT_WINDOW_BYTES = int(1.5 * 16_000 * 4)


class DeepgramTranscriber(TranscriptionProvider):
    def __init__(self, config: dict) -> None:
        self._api_key      = config["api_key"]
        self._model        = config.get("model", "nova-2")
        self._sample_rate  = config.get("sample_rate", 16_000)
        self._language     = config.get("language")
        self._window_bytes = config.get("window_bytes", _DEFAULT_WINDOW_BYTES)
        self._buffer       = bytearray()
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self._pending: set[asyncio.Task] = set()
        self._stopped      = False
        self._error_sent   = False
        self._http         = httpx.AsyncClient(timeout=30.0)

    async def start(self) -> None:
        self._stopped    = False
        self._error_sent = False
        self._buffer.clear()

    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        self._buffer.extend(chunk)
        if len(self._buffer) >= self._window_bytes:
            payload = bytes(self._buffer)
            self._buffer.clear()
            task = asyncio.create_task(self._call_api(payload))
            self._pending.add(task)
            task.add_done_callback(self._pending.discard)

    async def _call_api(self, payload: bytes) -> None:
        wav = _f32le_to_wav(payload, self._sample_rate)
        try:
            params: dict = {"model": self._model, "punctuate": "true", "smart_format": "true"}
            if self._language:
                params["language"] = self._language
            resp = await self._http.post(
                "https://api.deepgram.com/v1/listen",
                headers={
                    "Authorization": f"Token {self._api_key}",
                    "Content-Type": "audio/wav",
                },
                params=params,
                content=wav,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["results"]["channels"][0]["alternatives"][0]["transcript"].strip()
            if text:
                await self._queue.put(TranscriptEvent(
                    event_type="transcript",
                    text=text,
                    is_final=True,
                ))
        except Exception as exc:
            print(f"[deepgram] API error: {exc}")
            if not self._error_sent:
                self._error_sent = True
                await self._queue.put(TranscriptEvent(
                    event_type="error",
                    text=str(exc),
                    is_final=False,
                ))

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        if self._buffer:
            payload = bytes(self._buffer)
            self._buffer.clear()
            await self._call_api(payload)
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
        await self._queue.put(None)
        await self._http.aclose()


def _f32le_to_wav(pcm_f32: bytes, sample_rate: int) -> bytes:
    n = len(pcm_f32) // 4
    floats = struct.unpack_from(f"<{n}f", pcm_f32)
    pcm16 = struct.pack(
        f"<{n}h",
        *(max(-32_768, min(32_767, int(f * 32_767))) for f in floats),
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16)
    return buf.getvalue()
