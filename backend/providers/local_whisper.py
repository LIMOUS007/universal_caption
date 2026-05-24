"""
Local Whisper provider (stub).

Intended implementation: faster-whisper running on CPU/GPU.
Add `faster-whisper` to pyproject.toml when ready.
"""

from collections.abc import AsyncIterator

from events import TranscriptionProvider, TranscriptEvent


class LocalWhisperTranscriber(TranscriptionProvider):
    def __init__(self, config: dict) -> None:
        self._model_size: str = config.get("model_size", "base")
        self._device: str = config.get("device", "cpu")
        self._model = None

    async def start(self) -> None:
        # TODO:
        # from faster_whisper import WhisperModel
        # self._model = WhisperModel(self._model_size, device=self._device)
        raise NotImplementedError(
            "LocalWhisperTranscriber is not yet implemented. "
            "Add faster-whisper to dependencies and fill in this provider."
        )

    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        raise NotImplementedError

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        raise NotImplementedError
        yield  # make static analysis recognise this as an async generator

    async def stop(self) -> None:
        self._model = None
