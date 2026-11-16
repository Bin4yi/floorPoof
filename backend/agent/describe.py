"""Turn a plain description of a machine into item fields (size, height, kW, look).

The model (or, with no API key, a simple text parser) only fills in a form.
The user checks and edits the values before the item type is saved. Nothing
here decides pass or fail; the graph checks do that once the item is placed.
"""
from __future__ import annotations

import json
import re

from .. import config
from ..graph.custom import SHAPES
from .llm import LLMError, MetaLLM

PROMPT = f"""You turn a short description of a factory or warehouse item into JSON for a floor planner.
Return only one JSON object with these keys:
  "label": short name (2-4 words),
  "w_m": footprint width in metres, "d_m": footprint depth in metres, "h_m": height in metres,
  "kw": electrical load in kW (0 if not powered),
  "heat": true if it gets hot (heaters, presses, ovens, dryers), else false,
  "shape": one of {list(SHAPES)},
  "color": a hex colour like "#33ccff",
  "assumed": list of the values you guessed because the description did not give them.
Use the numbers given in the description exactly. If a number is not given, give a typical value
for that kind of item and list it in "assumed". The user will check every value."""

SHAPE_WORDS = {
    "press": ["press", "iron", "heat", "steam"], "rack": ["rack", "shelf", "shelv", "storage"],
    "table": ["table", "bench", "desk", "station"], "tank": ["tank", "boiler", "silo", "vessel", "drum", "dryer"],
    "conveyor": ["conveyor", "belt"], "robot": ["robot", "arm", "cobot"], "pallet": ["pallet"],
    "box": ["box", "crate", "bin", "cabinet", "locker"],
}
NUM = r"(\d+(?:\.\d+)?)"


def _unit(v: float, u: str) -> float:
    u = (u or "m").lower()
    return v / 100 if u.startswith("cm") else v / 1000 if u.startswith("mm") else v * 0.3048 if u in ("ft", "feet", "foot") else v


def parse_text(text: str) -> dict:
    """No-key fallback: read sizes like '2 x 1.5 m', 'height 1.8 m', '4 kW'."""
    s = text.lower()
    out: dict = {"assumed": []}
    m = re.search(NUM + r"\s*(mm|cm|m|ft|feet)?\s*(?:x|by|\*|×)\s*" + NUM + r"\s*(mm|cm|m|ft|feet)?"
                  r"(?:\s*(?:x|by|\*|×)\s*" + NUM + r"\s*(mm|cm|m|ft|feet)?)?", s)
    if m:
        u = m.group(6) or m.group(4) or m.group(2) or "m"
        out["w_m"] = round(_unit(float(m.group(1)), m.group(2) or u), 2)
        out["d_m"] = round(_unit(float(m.group(3)), m.group(4) or u), 2)
        if m.group(5):
            out["h_m"] = round(_unit(float(m.group(5)), m.group(6) or u), 2)
    h = re.search(NUM + r"\s*(mm|cm|m|ft)?\s*(?:tall|high)", s) or \
        re.search(r"(?:height|tall|high)[^\d,;]{0,12}" + NUM + r"\s*(mm|cm|m|ft)?", s)
    if h:
        out["h_m"] = round(_unit(float(h.group(1)), h.group(2) or "m"), 2)
    k = re.search(NUM + r"\s*kw", s)
    w = re.search(NUM + r"\s*w\b", s)
    if k:
        out["kw"] = float(k.group(1))
    elif w:
        out["kw"] = round(float(w.group(1)) / 1000, 3)
    shape = next((sh for sh, words in SHAPE_WORDS.items() if any(x in s for x in words)), "machine")
    out["shape"] = shape
    out["heat"] = shape == "press" or any(x in s for x in ("hot", "heat", "oven", "dryer", "furnace", "boiler"))
    label = re.split(r"[,.;(]|\d| with | that ", text.strip(), maxsplit=1)[0].strip()
    out["label"] = (label[:1].upper() + label[1:])[:40] if label else "Custom item"
    for key, default in (("w_m", 1.5), ("d_m", 1.0), ("h_m", 1.2), ("kw", 0.0)):
        if key not in out:
            out[key] = default
            out["assumed"].append(key)
    out["color"] = {"press": "#ff5d73", "rack": "#a78bfa", "table": "#facc15", "tank": "#38bdf8",
                    "conveyor": "#fb923c", "robot": "#f472b6", "pallet": "#a3e635", "box": "#94a3b8"}.get(shape, "#5ad1ff")
    return out


def _clean(d: dict) -> dict:
    out = {"label": str(d.get("label") or "Custom item")[:40], "assumed": [str(a) for a in d.get("assumed", [])][:8]}
    for k, lo, hi, default in (("w_m", 0.3, 30, 1.5), ("d_m", 0.3, 30, 1.0), ("h_m", 0.1, 15, 1.2), ("kw", 0, 500, 0)):
        try:
            v = float(d.get(k))
        except (TypeError, ValueError):
            v = default
            out["assumed"].append(k)
        out[k] = round(min(max(v, lo), hi), 2)
    out["heat"] = bool(d.get("heat"))
    out["shape"] = d.get("shape") if d.get("shape") in SHAPES else "machine"
    c = str(d.get("color") or "")
    out["color"] = c if re.fullmatch(r"#[0-9a-fA-F]{6}", c) else "#5ad1ff"
    return out


def describe(text: str, use_model: bool | None = None) -> dict:
    text = text.strip()[:500]
    if not text:
        raise ValueError("describe the item first")
    use_model = bool(config.META_API_KEY) and config.LLM_MODE != "replay" if use_model is None else use_model
    if use_model:
        try:
            raw = MetaLLM(timeout=60).complete([{"role": "developer", "content": PROMPT},
                                                {"role": "user", "content": text}])
            m = re.search(r"\{.*\}", raw, re.S)
            if m:
                return {**_clean(json.loads(m.group(0))), "description": text, "source": "model",
                        "model": config.META_MODEL}
        except (LLMError, json.JSONDecodeError, ValueError):
            pass
    return {**_clean(parse_text(text)), "description": text, "source": "parser"}
