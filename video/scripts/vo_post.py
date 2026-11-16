"""Trim leading/trailing silence and speed up the voiceover slightly (pitch kept). Writes *_t.wav and vo/durations.json."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEMPO = 1.18
vo = ROOT / "public" / "audio" / "vo"
lines = json.loads((ROOT / "vo" / "script.json").read_text(encoding="utf-8"))
out = {}
for item in lines:
    src, dst = vo / f"{item['id']}.mp3", vo / f"{item['id']}_t.wav"
    trim = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,"
            "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,"
            f"atempo={TEMPO},loudnorm=I=-16:TP=-1.5:LRA=7")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", trim, "-ar", "48000", str(dst)], check=True)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dst)]))
    out[item["id"]] = round(d, 3)
    print(f"{item['id']:11} {d:5.2f} s")
(ROOT / "vo" / "durations.json").write_text(json.dumps(out, indent=1))
print("total", round(sum(out.values()), 1), "s")
