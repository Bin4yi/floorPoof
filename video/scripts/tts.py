"""Voiceover with the OpenAI speech API. Reads OPENAI_API_KEY from the repo .env (never printed).
Writes public/audio/vo/<id>.mp3 and vo/durations.json. Only the narration text is sent."""
import json
import pathlib
import subprocess
import sys

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[1]
env = {}
for line in (ROOT.parent / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
key = env.get("OPENAI_API_KEY")
if not key:
    sys.exit("OPENAI_API_KEY missing in .env")

VOICE = "ash"
STYLE = ("Calm, clear, confident product-demo narrator. Friendly and precise, like a senior engineer giving a short "
         "walkthrough. Brisk, energetic pace, about 170 words per minute, no long pauses. Light emphasis on product names. Pronounce 'FloorProof' as 'floor proof', "
         "'Neo4j' as 'neo four jay', 'Cypher' as 'cipher', 'MCP' as 'M C P'.")
out = ROOT / "public" / "audio" / "vo"
out.mkdir(parents=True, exist_ok=True)
lines = json.loads((ROOT / "vo" / "script.json").read_text(encoding="utf-8"))
only = set(sys.argv[1:])
durations = {}
for item in lines:
    f = out / f"{item['id']}.mp3"
    if not only or item["id"] in only:
        r = httpx.post("https://api.openai.com/v1/audio/speech", timeout=120,
                       headers={"Authorization": f"Bearer {key}"},
                       json={"model": "gpt-4o-mini-tts", "voice": VOICE, "input": item["text"],
                             "instructions": STYLE, "response_format": "mp3"})
        if r.status_code != 200:
            sys.exit(f"{item['id']}: HTTP {r.status_code} {r.text[:200]}")
        f.write_bytes(r.content)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))
    durations[item["id"]] = round(d, 3)
    print(f"{item['id']:11} {d:5.2f} s")
(ROOT / "vo" / "durations.json").write_text(json.dumps(durations, indent=1))
print("total", round(sum(durations.values()), 1), "s")
