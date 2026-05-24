from events import TranscriptionProvider
from providers.openai_realtime import OpenAIRealtimeTranscriber
from providers.openai_chunked import OpenAIChunkedTranscriber
from providers.local_whisper import LocalWhisperTranscriber

_REGISTRY: dict[str, type[TranscriptionProvider]] = {
    "openai_realtime": OpenAIRealtimeTranscriber,
    "openai_chunked":  OpenAIChunkedTranscriber,
    "local_whisper":   LocalWhisperTranscriber,
}


def create_provider(provider_type: str, config: dict) -> TranscriptionProvider:
    cls = _REGISTRY.get(provider_type)
    if cls is None:
        available = ", ".join(_REGISTRY)
        raise ValueError(f"Unknown provider '{provider_type}'. Available: {available}")
    return cls(config)
