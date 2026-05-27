"""
Comprehensive pytest test suite for the Universal Captions FastAPI backend.

Run from the backend/ directory:
    pytest tests/test_backend.py -v
"""

from __future__ import annotations

import asyncio
import io
import struct
import sys
import wave
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure the backend package root is on sys.path so all local imports resolve.
_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


# ===========================================================================
# 1. TranscriptEvent
# ===========================================================================


class TestTranscriptEvent:
    """Unit tests for the TranscriptEvent dataclass."""

    def test_to_dict_returns_all_required_keys(self):
        """to_dict() must include all six documented keys."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript", text="hello")
        d = event.to_dict()

        assert set(d.keys()) == {"type", "text", "start_ms", "end_ms", "confidence", "is_final"}

    def test_to_dict_maps_event_type_to_type_key(self):
        """to_dict() maps the event_type field to the key named 'type'."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript_delta", text="partial")
        assert event.to_dict()["type"] == "transcript_delta"

    def test_to_dict_final_event_values(self):
        """to_dict() returns correct values for a fully-populated final event."""
        from events import TranscriptEvent

        event = TranscriptEvent(
            event_type="transcript",
            text="Hello world",
            start_ms=100,
            end_ms=1500,
            confidence=0.95,
            is_final=True,
        )
        d = event.to_dict()

        assert d["text"] == "Hello world"
        assert d["start_ms"] == 100
        assert d["end_ms"] == 1500
        assert d["confidence"] == 0.95
        assert d["is_final"] is True

    def test_to_dict_non_final_event_has_is_final_false(self):
        """to_dict() returns is_final=False for a non-final delta event."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript_delta", text="hel", is_final=False)
        assert event.to_dict()["is_final"] is False

    def test_default_field_start_ms_is_none(self):
        """start_ms defaults to None when not provided."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript", text="hi")
        assert event.start_ms is None

    def test_default_field_end_ms_is_none(self):
        """end_ms defaults to None when not provided."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript", text="hi")
        assert event.end_ms is None

    def test_default_field_confidence_is_none(self):
        """confidence defaults to None when not provided."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript", text="hi")
        assert event.confidence is None

    def test_default_field_is_final_is_false(self):
        """is_final defaults to False when not provided."""
        from events import TranscriptEvent

        event = TranscriptEvent(event_type="transcript", text="hi")
        assert event.is_final is False

    def test_to_dict_optional_fields_none_by_default(self):
        """to_dict() preserves None for optional fields when they are not set."""
        from events import TranscriptEvent

        d = TranscriptEvent(event_type="transcript", text="hi").to_dict()

        assert d["start_ms"] is None
        assert d["end_ms"] is None
        assert d["confidence"] is None


# ===========================================================================
# 2. SessionManager
# ===========================================================================


class TestSessionManager:
    """Unit tests for SessionManager using a mocked Redis client."""

    def _make_redis(self) -> AsyncMock:
        """Return an async-capable mock that mimics redis.asyncio.Redis."""
        r = AsyncMock()
        r.hset = AsyncMock(return_value=1)
        r.expire = AsyncMock(return_value=True)
        r.hgetall = AsyncMock(return_value={})
        r.hincrby = AsyncMock(return_value=1)
        r.hincrbyfloat = AsyncMock(return_value=1.0)
        return r

    @pytest.mark.asyncio
    async def test_create_returns_uuid_string(self):
        """create() returns a non-empty string that is a valid UUID."""
        import uuid
        from session_manager import SessionManager

        sm = SessionManager(self._make_redis())
        sid = await sm.create(
            provider="openai_chunked",
            model="whisper-1",
            sample_rate=16_000,
            encoding="pcm_f32le",
        )

        assert isinstance(sid, str)
        uuid.UUID(sid)  # raises ValueError if not a valid UUID

    @pytest.mark.asyncio
    async def test_create_stores_all_required_fields(self):
        """create() calls hset with a mapping containing every required session field."""
        from session_manager import SessionManager

        redis = self._make_redis()
        sm = SessionManager(redis)
        sid = await sm.create(
            provider="openai_chunked",
            model="whisper-1",
            sample_rate=16_000,
            encoding="pcm_f32le",
        )

        redis.hset.assert_called_once()
        mapping = redis.hset.call_args[1]["mapping"]

        assert mapping["session_id"] == sid
        assert mapping["provider"] == "openai_chunked"
        assert mapping["model"] == "whisper-1"
        assert mapping["status"] == "active"
        assert mapping["sample_rate"] == "16000"
        assert mapping["encoding"] == "pcm_f32le"
        assert "started_at" in mapping
        assert mapping["packet_seq"] == "0"
        assert mapping["audio_seconds"] == "0.0"

    @pytest.mark.asyncio
    async def test_create_calls_expire_with_session_ttl(self):
        """create() calls expire() with the correct key and the configured TTL."""
        from config import settings
        from session_manager import SessionManager

        redis = self._make_redis()
        sm = SessionManager(redis)
        sid = await sm.create(
            provider="openai_chunked",
            model="whisper-1",
            sample_rate=16_000,
            encoding="pcm_f32le",
        )

        redis.expire.assert_called_once()
        key_arg, ttl_arg = redis.expire.call_args[0]
        assert sid in key_arg
        assert ttl_arg == settings.session_ttl

    @pytest.mark.asyncio
    async def test_get_decodes_byte_keys_and_values(self):
        """get() decodes byte keys and values returned by Redis hgetall into strings."""
        from session_manager import SessionManager

        redis = self._make_redis()
        redis.hgetall.return_value = {
            b"session_id": b"abc-123",
            b"status": b"active",
        }
        sm = SessionManager(redis)
        result = await sm.get("abc-123")

        assert result == {"session_id": "abc-123", "status": "active"}

    @pytest.mark.asyncio
    async def test_get_returns_none_for_missing_session(self):
        """get() returns None when Redis returns an empty dict for the session key."""
        from session_manager import SessionManager

        redis = self._make_redis()
        redis.hgetall.return_value = {}
        sm = SessionManager(redis)

        assert await sm.get("does-not-exist") is None

    @pytest.mark.asyncio
    async def test_set_status_calls_hset_with_correct_key_and_value(self):
        """set_status() calls hset on the session key with the new status value."""
        from session_manager import SessionManager, _SESSION_PREFIX

        redis = self._make_redis()
        sm = SessionManager(redis)
        await sm.set_status("sid-99", "paused")

        redis.hset.assert_called_once_with(
            f"{_SESSION_PREFIX}sid-99", "status", "paused"
        )

    @pytest.mark.asyncio
    async def test_close_sets_status_to_closed(self):
        """close() writes status=closed for the given session via hset."""
        from session_manager import SessionManager, _SESSION_PREFIX

        redis = self._make_redis()
        sm = SessionManager(redis)
        await sm.close("sid-77")

        redis.hset.assert_called_once_with(
            f"{_SESSION_PREFIX}sid-77", "status", "closed"
        )

    @pytest.mark.asyncio
    async def test_increment_seq_returns_integer(self):
        """increment_seq() returns the new sequence number as a Python int."""
        from session_manager import SessionManager

        redis = self._make_redis()
        redis.hincrby.return_value = 5
        sm = SessionManager(redis)

        result = await sm.increment_seq("sid-1")

        assert result == 5
        assert isinstance(result, int)

    @pytest.mark.asyncio
    async def test_increment_seq_calls_hincrby_by_one(self):
        """increment_seq() increments the packet_seq field by exactly 1."""
        from session_manager import SessionManager, _SESSION_PREFIX

        redis = self._make_redis()
        sm = SessionManager(redis)
        await sm.increment_seq("sid-42")

        redis.hincrby.assert_called_once_with(
            f"{_SESSION_PREFIX}sid-42", "packet_seq", 1
        )

    @pytest.mark.asyncio
    async def test_add_audio_seconds_calls_hincrbyfloat(self):
        """add_audio_seconds() calls hincrbyfloat with the correct key and delta."""
        from session_manager import SessionManager, _SESSION_PREFIX

        redis = self._make_redis()
        sm = SessionManager(redis)
        await sm.add_audio_seconds("sid-55", 2.5)

        redis.hincrbyfloat.assert_called_once_with(
            f"{_SESSION_PREFIX}sid-55", "audio_seconds", 2.5
        )


# ===========================================================================
# 3. create_provider factory
# ===========================================================================


class TestCreateProviderFactory:
    """Unit tests for the provider factory function."""

    def test_returns_openai_realtime_transcriber(self):
        """create_provider(openai_realtime) returns an OpenAIRealtimeTranscriber."""
        from providers.factory import create_provider
        from providers.openai_realtime import OpenAIRealtimeTranscriber

        provider = create_provider("openai_realtime", {"api_key": "sk-test"})
        assert isinstance(provider, OpenAIRealtimeTranscriber)

    def test_returns_openai_chunked_transcriber(self):
        """create_provider(openai_chunked) returns an OpenAIChunkedTranscriber."""
        from providers.factory import create_provider
        from providers.openai_chunked import OpenAIChunkedTranscriber

        provider = create_provider("openai_chunked", {"api_key": "sk-test"})
        assert isinstance(provider, OpenAIChunkedTranscriber)

    def test_returns_local_whisper_transcriber(self):
        """create_provider(local_whisper) returns a LocalWhisperTranscriber."""
        from providers.factory import create_provider
        from providers.local_whisper import LocalWhisperTranscriber

        provider = create_provider("local_whisper", {})
        assert isinstance(provider, LocalWhisperTranscriber)

    def test_raises_value_error_for_unknown_provider(self):
        """create_provider raises ValueError when the provider type is unrecognised."""
        from providers.factory import create_provider

        with pytest.raises(ValueError):
            create_provider("nonexistent_provider", {})

    def test_value_error_message_contains_unknown_provider_name(self):
        """The ValueError message includes the name of the bad provider."""
        from providers.factory import create_provider

        with pytest.raises(ValueError, match="bad_provider"):
            create_provider("bad_provider", {})

    def test_value_error_message_lists_all_available_providers(self):
        """The ValueError message enumerates every valid provider name."""
        from providers.factory import create_provider

        with pytest.raises(ValueError) as exc_info:
            create_provider("mystery_provider", {})

        msg = str(exc_info.value)
        assert "openai_realtime" in msg
        assert "openai_chunked" in msg
        assert "local_whisper" in msg


# ===========================================================================
# 4. _f32le_to_wav helper
# ===========================================================================


def _pack_f32(floats):
    """Pack a list of Python floats as little-endian Float32 bytes."""
    return struct.pack(f"<{len(floats)}f", *floats)


class TestF32leToWav:
    """Unit tests for the PCM Float32-LE to WAV conversion helper."""

    def test_output_is_readable_by_wave_module(self):
        """_f32le_to_wav() returns bytes that Python wave module can open without error."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([0.0, 0.5, -0.5, 1.0, -1.0])
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getnchannels() == 1

    def test_output_is_mono(self):
        """WAV output has exactly one audio channel."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([0.1] * 160)
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getnchannels() == 1

    def test_output_is_16bit(self):
        """WAV output uses 16-bit (2-byte) samples."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([0.1] * 160)
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getsampwidth() == 2

    def test_sample_rate_written_to_wav_header(self):
        """The WAV header framerate matches the sample_rate argument passed in."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([0.0] * 8)
        wav_bytes = _f32le_to_wav(pcm, sample_rate=44_100)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getframerate() == 44_100

    def test_frame_count_equals_number_of_input_samples(self):
        """Number of frames in the WAV equals the number of Float32 input samples."""
        from providers.openai_chunked import _f32le_to_wav

        samples = [0.1, 0.2, 0.3, 0.4]
        pcm = _pack_f32(samples)
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getnframes() == len(samples)

    def test_positive_clipping_clamped_to_plus_32767(self):
        """Float values above +1.0 are clamped to the Int16 maximum of +32767."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([2.0])
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            raw = wf.readframes(1)
        assert struct.unpack("<h", raw)[0] == 32_767

    def test_negative_clipping_clamped_to_minus_32768(self):
        """Float values below -1.0 are clamped to the Int16 minimum of -32768."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([-2.0])
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            raw = wf.readframes(1)
        assert struct.unpack("<h", raw)[0] == -32_768

    def test_zero_float_maps_to_zero_int16(self):
        """A 0.0 float sample produces a 0 Int16 output sample."""
        from providers.openai_chunked import _f32le_to_wav

        pcm = _pack_f32([0.0])
        wav_bytes = _f32le_to_wav(pcm, sample_rate=16_000)

        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            raw = wf.readframes(1)
        assert struct.unpack("<h", raw)[0] == 0


# ===========================================================================
# 5. OpenAIChunkedTranscriber
# ===========================================================================


def _make_chunked_transcriber(window_bytes: int = 100):
    """
    Build an OpenAIChunkedTranscriber with a mocked AsyncOpenAI client.
    Returns (transcriber, mock_openai_client).
    """
    from providers.openai_chunked import OpenAIChunkedTranscriber

    mock_client = MagicMock()
    mock_result = MagicMock()
    mock_result.text = "  hello world  "
    mock_client.audio.transcriptions.create = AsyncMock(return_value=mock_result)

    config = {
        "api_key": "sk-test",
        "model": "whisper-1",
        "sample_rate": 16_000,
        "window_bytes": window_bytes,
    }

    with patch("providers.openai_chunked.AsyncOpenAI", return_value=mock_client):
        transcriber = OpenAIChunkedTranscriber(config)

    return transcriber, mock_client


class TestOpenAIChunkedTranscriber:
    """Tests for OpenAIChunkedTranscriber with the OpenAI client mocked out."""

    @pytest.mark.asyncio
    async def test_send_audio_accumulates_small_chunk_in_buffer(self):
        """A chunk smaller than window_bytes is stored in the buffer without flushing."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=200)

        await transcriber.send_audio(b"\x00" * 50, {})

        assert len(transcriber._buffer) == 50
        mock_client.audio.transcriptions.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_send_audio_does_not_flush_before_window_full(self):
        """Multiple small chunks totalling less than window_bytes do not flush."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=100)

        await transcriber.send_audio(b"" * 40, {})
        await transcriber.send_audio(b"" * 40, {})  # total = 80 < 100

        mock_client.audio.transcriptions.create.assert_not_called()
        assert len(transcriber._buffer) == 80

    @pytest.mark.asyncio
    async def test_send_audio_flushes_when_buffer_reaches_window_bytes(self):
        """An API call is made once the accumulated buffer reaches window_bytes."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=100)

        await transcriber.send_audio(b"\x00" * 60, {})
        await transcriber.send_audio(b"\x00" * 40, {})  # total = 100 -> flush

        mock_client.audio.transcriptions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_buffer_is_empty_after_flush(self):
        """The internal buffer is cleared after a flush."""
        transcriber, _ = _make_chunked_transcriber(window_bytes=100)

        await transcriber.send_audio(b"\x00" * 100, {})

        assert len(transcriber._buffer) == 0

    @pytest.mark.asyncio
    async def test_stop_flushes_partial_buffer(self):
        """stop() triggers a flush even when the buffer has less than window_bytes."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=200)

        await transcriber.send_audio(b"" * 80, {})
        mock_client.audio.transcriptions.create.assert_not_called()

        await transcriber.stop()

        mock_client.audio.transcriptions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_stop_puts_none_sentinel_into_queue(self):
        """stop() puts None into the queue so that events() terminates."""
        transcriber, _ = _make_chunked_transcriber(window_bytes=200)

        # Empty buffer means flush is a no-op; only the sentinel is enqueued.
        await transcriber.stop()

        sentinel = transcriber._queue.get_nowait()
        assert sentinel is None

    @pytest.mark.asyncio
    async def test_flush_is_noop_on_empty_buffer(self):
        """_flush() makes no API call when the buffer is empty."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=100)

        await transcriber._flush()

        mock_client.audio.transcriptions.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_flush_queues_final_transcript_event(self):
        """A non-empty API response is enqueued as a TranscriptEvent with is_final=True."""
        from events import TranscriptEvent

        transcriber, _ = _make_chunked_transcriber(window_bytes=100)

        await transcriber.send_audio(b"\x00" * 100, {})  # triggers flush

        event = transcriber._queue.get_nowait()
        assert isinstance(event, TranscriptEvent)
        assert event.is_final is True
        assert event.event_type == "transcript"
        assert event.text == "hello world"  # stripped by _flush

    @pytest.mark.asyncio
    async def test_flush_does_not_queue_whitespace_only_transcript(self):
        """A whitespace-only API response is discarded; no event is enqueued."""
        transcriber, mock_client = _make_chunked_transcriber(window_bytes=100)

        whitespace_result = MagicMock()
        whitespace_result.text = "   "
        mock_client.audio.transcriptions.create.return_value = whitespace_result
        transcriber._client = mock_client

        await transcriber.send_audio(b"\x00" * 100, {})

        assert transcriber._queue.empty()

# ===========================================================================
# 6. WebSocket endpoint
# ===========================================================================


def _build_mock_redis() -> AsyncMock:
    r = AsyncMock()
    r.hset = AsyncMock(return_value=1)
    r.expire = AsyncMock(return_value=True)
    r.hincrby = AsyncMock(return_value=1)
    r.hincrbyfloat = AsyncMock(return_value=0.0)
    r.hgetall = AsyncMock(return_value={
        b"status": b"active",
        b"audio_seconds": b"0.0",
        b"provider": b"openai_chunked",
    })
    return r


@pytest.fixture()
def mock_redis():
    return _build_mock_redis()


@pytest.fixture()
def app_with_mock_redis(mock_redis):
    from main import app
    app.state.redis = mock_redis
    return app


@pytest.fixture()
def ws_test_client(mock_redis):
    """TestClient that patches lifespan Redis/Postgres so no real services are needed."""
    from main import app
    from starlette.testclient import TestClient
    with (
        patch("redis.asyncio.from_url", return_value=mock_redis),
        patch("main.init_pool", new=AsyncMock()),
        patch("main.close_pool", new=AsyncMock()),
    ):
        with TestClient(app) as client:
            yield client


def _noop_provider_stub():
    stub = AsyncMock()
    stub.start = AsyncMock()
    stub.stop = AsyncMock()

    async def _no_events():
        return
        yield

    stub.events = _no_events
    return stub


class TestWebSocketEndpoint:
    def test_valid_session_start_returns_session_started(self, ws_test_client):
        with (
            patch("endpoints.websocket.queries.insert_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.close_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_usage_event", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_segment", new=AsyncMock()),
            patch("endpoints.websocket.create_provider", return_value=_noop_provider_stub()),
        ):
            with ws_test_client.websocket_connect("/ws/transcribe") as ws:
                ws.send_json({
                    "type": "session_start",
                    "provider": "openai_chunked",
                    "api_key": "sk-test",
                    "model": "whisper-1",
                    "sample_rate": 16000,
                    "encoding": "pcm_f32le",
                })
                msg = ws.receive_json()
        assert msg["type"] == "session_started"
        assert "session_id" in msg
        assert isinstance(msg["session_id"], str)
        assert len(msg["session_id"]) > 0

    def test_session_started_contains_valid_uuid(self, ws_test_client):
        import uuid
        with (
            patch("endpoints.websocket.queries.insert_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.close_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_usage_event", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_segment", new=AsyncMock()),
            patch("endpoints.websocket.create_provider", return_value=_noop_provider_stub()),
        ):
            with ws_test_client.websocket_connect("/ws/transcribe") as ws:
                ws.send_json({
                    "type": "session_start",
                    "provider": "openai_chunked",
                    "api_key": "sk-test",
                    "model": "whisper-1",
                    "sample_rate": 16000,
                    "encoding": "pcm_f32le",
                })
                msg = ws.receive_json()
        uuid.UUID(msg["session_id"])  # raises ValueError if not a valid UUID

    def test_wrong_first_message_type_returns_error(self, ws_test_client):
        msg = None
        try:
            with ws_test_client.websocket_connect("/ws/transcribe") as ws:
                ws.send_json({"type": "audio_chunk"})
                msg = ws.receive_json()
        except Exception:
            pass
        assert msg is not None
        assert msg["type"] == "error"
        assert "session_start" in msg["message"].lower()

    def test_session_end_produces_session_ended(self, ws_test_client):
        with (
            patch("endpoints.websocket.queries.insert_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.close_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_usage_event", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_segment", new=AsyncMock()),
            patch("endpoints.websocket.create_provider", return_value=_noop_provider_stub()),
        ):
            received_types = []
            with ws_test_client.websocket_connect("/ws/transcribe") as ws:
                ws.send_json({
                    "type": "session_start",
                    "provider": "openai_chunked",
                    "api_key": "sk-test",
                    "model": "whisper-1",
                    "sample_rate": 16000,
                    "encoding": "pcm_f32le",
                })
                started = ws.receive_json()
                assert started["type"] == "session_started"
                ws.send_json({"type": "session_end"})
                try:
                    for _ in range(5):
                        m = ws.receive_json()
                        received_types.append(m["type"])
                        if m["type"] == "session_ended":
                            break
                except Exception:
                    pass
        assert "session_ended" in received_types

    def test_unknown_provider_returns_error(self, ws_test_client):
        with (
            patch("endpoints.websocket.queries.insert_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.close_session", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_usage_event", new=AsyncMock()),
            patch("endpoints.websocket.queries.insert_segment", new=AsyncMock()),
        ):
            received = []
            try:
                with ws_test_client.websocket_connect("/ws/transcribe") as ws:
                    ws.send_json({
                        "type": "session_start",
                        "provider": "does_not_exist",
                        "api_key": "sk-test",
                        "model": "whisper-1",
                        "sample_rate": 16000,
                        "encoding": "pcm_f32le",
                    })
                    for _ in range(4):
                        try:
                            m = ws.receive_json()
                            received.append(m)
                            if m["type"] == "error":
                                break  # found what we need; stop before server closes
                        except Exception:
                            break
            except Exception:
                pass
        types = [m["type"] for m in received]
        assert "error" in types


# ===========================================================================
# 7. Health endpoint
# ===========================================================================


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_get_root_returns_200(self, app_with_mock_redis):
        from httpx import ASGITransport, AsyncClient
        transport = ASGITransport(app=app_with_mock_redis)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_root_body_is_status_online(self, app_with_mock_redis):
        from httpx import ASGITransport, AsyncClient
        transport = ASGITransport(app=app_with_mock_redis)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
        assert response.json() == {"status": "online"}

    @pytest.mark.asyncio
    async def test_get_root_content_type_is_json(self, app_with_mock_redis):
        from httpx import ASGITransport, AsyncClient
        transport = ASGITransport(app=app_with_mock_redis)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
        assert "application/json" in response.headers["content-type"]
