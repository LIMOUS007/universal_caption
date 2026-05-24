from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass
class TranscriptEvent:
    event_type: str
    text: str
    start_ms: int | None = None
    end_ms: int | None = None
    confidence: float | None = None
    is_final: bool = False

    def to_dict(self) -> dict:
        return {
            "type": self.event_type,
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "confidence": self.confidence,
            "is_final": self.is_final,
        }


class TranscriptionProvider(ABC):
    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def send_audio(self, chunk: bytes, metadata: dict) -> None: ...

    @abstractmethod
    async def events(self) -> AsyncIterator[TranscriptEvent]: ...

    @abstractmethod
    async def stop(self) -> None: ...


class OpenAIRealtimeTranscriber(TranscriptionProvider): ...

class OpenAIChunkedTranscriber(TranscriptionProvider): ...

class LocalWhisperTranscriber(TranscriptionProvider): ...
