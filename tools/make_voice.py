"""Generates the arcade announcer clips from voice/lines.json.

Run from the project folder:  python tools/make_voice.py
Needs:  python -m pip install --user edge-tts

The voice comes from Microsoft's free Edge read-aloud service. Fine for
personal use; if this app is ever sold, regenerate the clips with a voice
you have a commercial licence for (or record a real voice actor).
"""

import asyncio
import json
import pathlib

import edge_tts

VOICE = "en-US-AriaNeural"
RATE = "+12%"
PITCH = "+8Hz"

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINES = json.loads((ROOT / "voice" / "lines.json").read_text(encoding="utf-8"))
OUT = ROOT / "voice" / "arcade"


async def make(key: str, text: str) -> None:
    target = OUT / f"{key}.mp3"
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(str(target))
            if target.stat().st_size > 0:
                print(f"ok   {key}")
                return
        except Exception as err:  # the free service sometimes drops a request
            print(f"retry {key}: {err}")
    print(f"FAIL {key}")


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, text in LINES.items():
        await make(key, text)


asyncio.run(main())
