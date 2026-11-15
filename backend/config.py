"""Settings from environment variables, with a .env file in the repo root as fallback."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

META_API_KEY = os.environ.get("META_API_KEY") or os.environ.get("MODEL_API_KEY") or ""
META_BASE_URL = os.environ.get("META_BASE_URL", "https://api.meta.ai/v1")
META_MODEL = os.environ.get("META_MODEL", "muse-spark-1.1")
META_REASONING = os.environ.get("META_REASONING", "low")
# auto: live if a key is set, else replay. live: always call the model. replay: never call it.
LLM_MODE = os.environ.get("FLOORPROOF_LLM", "auto")
STORE = os.environ.get("FLOORPROOF_STORE", str(ROOT / "floorproof.rl"))
REPLAY_DIR = ROOT / "backend" / "replay"
