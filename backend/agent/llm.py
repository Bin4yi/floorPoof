"""Language model clients. The model only proposes item positions.

MetaLLM   Meta Model API (Muse Spark), OpenAI-compatible /chat/completions.
Recorder  wraps a live client and keeps every call, so a run can be replayed.
ReplayLLM returns recorded responses in order. Needs no API key.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import httpx

from .. import config


class LLMError(RuntimeError):
    pass


def messages_hash(messages: list[dict]) -> str:
    return hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]


class MetaLLM:
    name = "meta"

    def __init__(self, api_key: str | None = None, model: str | None = None, base_url: str | None = None,
                 timeout: float = 180.0):
        self.api_key = api_key or config.META_API_KEY
        if not self.api_key:
            raise LLMError("META_API_KEY is not set")
        self.model = model or config.META_MODEL
        self.base_url = (base_url or config.META_BASE_URL).rstrip("/")
        self.timeout = timeout

    def complete(self, messages: list[dict]) -> str:
        # Muse Spark reasons before answering and those tokens count toward the cap,
        # so keep the effort low and the cap high, or the answer comes back empty.
        body = {"model": self.model, "messages": messages, "max_completion_tokens": 16000,
                "reasoning_effort": config.META_REASONING}
        last = None
        for attempt in range(3):
            try:
                r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                               headers={"Authorization": f"Bearer {self.api_key}"})
            except httpx.HTTPError as e:
                last = str(e)
            else:
                if r.status_code == 200:
                    return r.json()["choices"][0]["message"]["content"] or ""
                last = f"HTTP {r.status_code}: {r.text[:300]}"
                if r.status_code not in (408, 429, 500, 502, 503, 504):
                    break
            time.sleep(2 * (attempt + 1))
        raise LLMError(f"Meta Model API call failed: {last}")


class Recorder:
    def __init__(self, inner):
        self.inner = inner
        self.name = f"{inner.name}+record"
        self.calls: list[dict] = []

    def complete(self, messages: list[dict]) -> str:
        t0 = time.perf_counter()
        out = self.inner.complete(messages)
        self.calls.append({"hash": messages_hash(messages), "response": out,
                           "seconds": round(time.perf_counter() - t0, 2)})
        return out

    def save(self, path: Path, meta: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**meta, "model": getattr(self.inner, "model", self.inner.name),
                                    "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"), "calls": self.calls},
                                   indent=1), encoding="utf-8")


class ReplayLLM:
    name = "replay"

    def __init__(self, path: Path):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.model = data.get("model", "?")
        self.calls = list(data["calls"])
        self.i = 0
        self.mismatches = 0

    def complete(self, messages: list[dict]) -> str:
        if self.i >= len(self.calls):
            raise LLMError("replay has no more recorded responses")
        call = self.calls[self.i]
        self.i += 1
        if call["hash"] != messages_hash(messages):
            self.mismatches += 1  # prompt changed since recording; the answer is still replayed
        return call["response"]
