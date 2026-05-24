from abc import ABC, abstractmethod
from typing import AsyncIterator

class TranscriptEvent:
    def __init(
            self,
            event_type: str,
            text: str,
            start_ms: int | None = None,
            end_ms: int | None = None,
            confidence: float | None = None,
            is_final: bool = False
    ):
        self.event_type = event_type
        self.text = text
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.confidence = confidence
        self.is_final = is_final


class TranscriptionProvider(ABC):
    @abstractmethod
    async def start(self) -> None:
        pass        

    @abstractmethod
    async def send_audio(self, chunk: bytes, metadata: dict) -> None:
        pass

    @abstractmethod
    async def events(self) -> AsyncIterator[TranscriptEvent]:
        pass

    @abstractmethod
    async def stop(self) -> None:
        pass


class OpenAIRealtimeTranscriber(TranscriptionProvider):
    ...


class OpenAIChunkedTranscriber(TranscriptionProvider):
    ...


class LocalWhisperTranscriber(TranscriptionProvider):
    ...