# Shiftgrid

A gamified driving dashboard. Phase 1 runs on simulated driving data.

## What's where

| Folder / file | What it does |
| --- | --- |
| `index.html` | The screens: startup, garage, dashboard, report card |
| `css/dash.css` | All the colours and layout, including the three looks |
| `js/config.js` | **Every tunable number** (shift points, thresholds, gear ratios) |
| `js/data/simulator.js` | The pretend car. Phase 2 adds a Bluetooth OBD reader next to it |
| `js/core/telemetry.js` | Works out gear and distance from rpm and speed |
| `js/core/shifts.js` | Grades upshifts and downshifts, runs the combo |
| `js/core/launch.js` | 0–60 and quarter-mile timer |
| `js/core/drive.js` | One drive: smoothness, harsh braking, warm-up, ghost laps |
| `js/core/progress.js` | XP, ranks, badges, personal bests, daily challenge, weekly stats |
| `js/ui/` | Drawing the dashboard, the screens, sounds and the startup animation |
| `js/main.js` | Connects everything together |
| `voice/lines.json` | Every announcer line (edit the text here) |
| `voice/arcade/` | The arcade announcer clips (Aria voice) |
| `tools/make_voice.py` | Regenerates the clips after editing `lines.json` |
| `js/ui/voice.js` / `myvoice.js` | Plays clips with the arcade effect / the My voice screen |

## Changing the announcer

Edit a line in `voice/lines.json`, then run `python tools/make_voice.py`.
The free voice is for personal use. Before selling, switch to a licensed voice or a voice actor.

## How the pieces talk

```
data source -> telemetry -> shift grader / launch timer / drive session
            -> events ("shift", "launch", "badge"...) -> screen, sound, voice, progress
```

Every data source (simulator now, OBD in Phase 2, in-car computer in Phase 3)
produces the same readings, so only one line in `main.js` changes when we switch.

## Running it on this computer

```bash
python -m http.server 5173
```

Then open http://localhost:5173 in a browser.

## Known limits (be honest with yourself about these)

- OBD can't see paddle presses, only gear changes. Grading only runs with "Paddle shifting" on.
- Gear ratios, final drive and redline in `config.js` are placeholders until a calibration drive.
- Shift timing from a Bluetooth OBD adapter (about 10–20 readings a second) will be approximate.
- Ghost laps use distance in Phase 1. Phase 2 will use GPS start/finish lines.
- Progress is saved in the browser on each device; moving to a new web address starts fresh.
