"""
OpenAI Chunked Whisper provider.

Accumulates Float32 PCM until a configurable window is full, encodes it to
WAV in-process (no tmp files, no external libraries), and calls the OpenAI
audio.transcriptions endpoint (whisper-1 or compatible model).
"""

import asyncio
import io
import struct
import wave
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from events import TranscriptionProvider, TranscriptEvent

# 5 s × 16 000 samples/s × 4 bytes/sample
_DEFAULT_WINDOW_BYTES = 5 * 16_000 * 4


class OpenAIChunkedTranscriber(TranscriptionProvider):
    def __init__(self, config: dict) -> None:
        self._client = AsyncOpenAI(api_key=config["api_key"])
        self._model: str = config.get("model", "whisper-1")
        self._sample_rate: int = config.get("sample_rate", 16_000)
        self._language: str | None = config.get("language")
        self._window_bytes: int = config.get("window_bytes", _DEFAULT_WINDOW_BYTES)
        self._buffer = bytearray()
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self._stopped = False

    async def start(self) -> None:
        self._stopped = False
        self._buffer.clear()

    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        self._buffer.extend(chunk)
        if len(self._buffer) >= self._window_bytes:
            await self._flush()

    async def _flush(self) -> None:
        if not self._buffer:
            return
        payload = bytes(self._buffer)
        self._buffer.clear()
        wav = _f32le_to_wav(payload, self._sample_rate)
        try:
            kwargs: dict = {"model": self._model, "file": ("audio.wav", wav, "audio/wav")}
            if self._language:
                kwargs["language"] = self._language
            result = await self._client.audio.transcriptions.create(**kwargs)
            text = result.text.strip()
            if text:
                await self._queue.put(TranscriptEvent(
                    event_type="transcript",
                    text=text,
                    is_final=True,
                ))
        except Exception as exc:
            print(f"[openai_chunked] Whisper API error: {exc}")

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def stop(self) -> None:
        self._stopped = True
        if self._buffer:
            await self._flush()
        await self._queue.put(None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _f32le_to_wav(pcm_f32: bytes, sample_rate: int) -> bytes:
    """Convert raw Float32-LE PCM to a WAV byte string (Int16, mono)."""
    n = len(pcm_f32) // 4
    floats = struct.unpack_from(f"<{n}f", pcm_f32)
    pcm16 = struct.pack(
        f"<{n}h",
        *(max(-32_768, min(32_767, int(f * 32_767))) for f in floats),
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)        # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16)
    return buf.getvalue()
