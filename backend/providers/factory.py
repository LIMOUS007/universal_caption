from events import TranscriptionProvider
from providers.openai_chunked import OpenAIChunkedTranscriber
from providers.local_whisper import LocalWhisperTranscriber
from providers.deepgram_provider import DeepgramTranscriber

_REGISTRY: dict[str, type[TranscriptionProvider]] = {
    "openai_chunked": OpenAIChunkedTranscriber,
    "local_whisper":  LocalWhisperTranscriber,
    "deepgram":       DeepgramTranscriber,
}

# OpenAI-compatible providers — resolved to openai_chunked with a base_url override
_COMPAT_BASES: dict[str, str] = {
    "groq": "https://api.groq.com/openai/v1",
}


def create_provider(provider_type: str, config: dict) -> TranscriptionProvider:
    if provider_type in _COMPAT_BASES:
        config = {**config, "base_url": _COMPAT_BASES[provider_type]}
        provider_type = "openai_chunked"
    cls = _REGISTRY.get(provider_type)
    if cls is None:
        available = ", ".join({**_REGISTRY, **_COMPAT_BASES})
        raise ValueError(f"Unknown provider '{provider_type}'. Available: {available}")
    return cls(config)
