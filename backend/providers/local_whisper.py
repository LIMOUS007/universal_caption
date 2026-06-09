"""
Local Whisper provider using faster-whisper.
Runs inference in a thread executor so the async event loop is never blocked.
"""

import asyncio
from collections.abc import AsyncIterator

from events import TranscriptionProvider, TranscriptEvent

# 1.5 seconds of Float32-LE at 16kHz
_DEFAULT_WINDOW_BYTES = int(1.5 * 16_000 * 4)


class LocalWhisperTranscriber(TranscriptionProvider):
    def __init__(self, config: dict) -> None:
        self._model_size: str   = config.get("model_size", "small")
        self._device: str       = config.get("device", "cpu")
        self._compute_type: str = config.get("compute_type", "int8")
        self._language: str | None = config.get("language")
        self._window_bytes: int = config.get("window_bytes", _DEFAULT_WINDOW_BYTES)
        self._model = None
        self._buffer = bytearray()
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self._pending: set[asyncio.Task] = set()
        self._stopped = False

    async def start(self) -> None:
        from faster_whisper import WhisperModel
        loop = asyncio.get_running_loop()
        self._model = await loop.run_in_executor(
            None,
            lambda: WhisperModel(
                self._model_size,
                device=self._device,
                compute_type=self._compute_type,
            ),
        )
        self._stopped = False
        self._buffer.clear()

    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        self._buffer.extend(chunk)
        if len(self._buffer) >= self._window_bytes:
            payload = bytes(self._buffer)
            self._buffer.clear()
            task = asyncio.create_task(self._transcribe(payload))
            self._pending.add(task)
            task.add_done_callback(self._pending.discard)

    async def _transcribe(self, payload: bytes) -> None:
        audio = _f32le_to_numpy(payload)
        loop = asyncio.get_running_loop()
        try:
            # Consume the generator inside the executor — faster-whisper returns a
            # lazy iterator and the actual inference happens during iteration.
            def _run() -> str:
                segs, _ = self._model.transcribe(
                    audio,
                    language=self._language,
                    beam_size=5,
                )
                return " ".join(s.text for s in segs).strip()

            text = await loop.run_in_executor(None, _run)
            if text:
                await self._queue.put(TranscriptEvent(
                    event_type="transcript",
                    text=text,
                    is_final=True,
                ))
        except Exception as exc:
            print(f"[local_whisper] inference error: {exc}")
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
            await self._transcribe(payload)
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
        await self._queue.put(None)


def _f32le_to_numpy(pcm_f32: bytes) -> "np.ndarray":
    import numpy as np
    return np.frombuffer(pcm_f32, dtype="<f4").astype("float32")
