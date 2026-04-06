# TTS System — Kokoro Integration

Kokoro TTS integrated as an optional subprocess. SENNI runs cleanly without it.

---

## Architecture

- `scripts/tts.py` — standalone subprocess. Reads JSON lines from stdin (text + voice blend + speed + pitch), writes length-prefixed WAV bytes to stdout. Exits with code 2 if `kokoro` or `soundfile` not installed — `tts_server.py` surfaces this as a clean "unavailable" state, never a crash.
- `scripts/tts_server.py` — FastAPI router mounted into `server.py` via `app.include_router(tts_router)`. Owns process lifecycle. All endpoints return `{"ok": false, "reason": "..."}` on unavailability — never 500s.
- `static/js/tts.js` — hooks `onTtsToken` in `api.js`. Accumulates tokens into sentence buffer, flushes on `.!?…` boundaries (min 15 chars). Sequential fetch queue to `/api/tts/speak` preserves sentence order. Web Audio API queue for gapless playback. `ttsStop()` aborts everything on user stop/tab close/new message.
- `static/js/companion-tts.js` — Voice tab UI. Up to 5 voice blend slots with weight sliders (shows live normalised percentages). Speed + pitch inputs. Preview button.

---

## Config schema

**Global TTS config** lives in `config.json["tts"]`:
- `enabled`
- `python_path`
- `voices_path`
- `espeak_path`

**Per-companion TTS** lives in `companions/<folder>/config.json["tts"]`:
- `voice_blend` (dict of voice → weight)
- `speed`
- `pitch`

Mood TTS overrides are **schema-ready** but UI not yet built — will follow mood system UI.

---

## Aurini integration boundary

Aurini owns installation of Kokoro (pip install + espeak-ng). SENNI just needs:
- `python_path` — path to Python executable with kokoro installed (empty = sys.executable)
- `voices_path` — path to `voices/` dir with `.pt` files (empty = auto-discover next to tts.py)
- `espeak_path` — path to espeak-ng binary (empty = rely on PATH)

All three are set in Settings → Server → Voice section and saved via `/api/settings/tts`.

---

## What's working

- Kokoro confirmed working via Aurini ✓
- Stdin bug in `tts.py` fixed ✓
- Voice blend UI (up to 5 slots) ✓
- Speed + pitch controls ✓
- Preview button ✓
- Sentence buffering + gapless playback ✓
- Stop/abort on user action ✓

---

## What's not yet done

- Mood → TTS override UI (speed/blend per mood) — implement alongside Mood UI
- Voice discovery UI feedback when no voices found (currently silent)
- Intel Arc / oneAPI support for Kokoro is **unconfirmed** — needs research before committing to GPU path
- Future: Qwen3-TTS option for better tone/emphasis control — current hardware likely limits to Kokoro only for now
