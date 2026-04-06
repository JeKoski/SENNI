# Boot, Process Lifecycle & Server Internals

## Boot & process lifecycle

This is the most complex part of the server — read carefully before touching it.

### State variables (in `server.py`)

| Variable | Meaning |
|----------|---------| 
| `_llama_process` | The `Popen` handle for the cmd.exe / llama-server process, or `None` |
| `_boot_ready` | `True` once llama-server logs "server is listening" |
| `_boot_launching` | `True` from launch start until either ready or failure — prevents duplicate spawns |
| `_boot_lock` | Threading lock — all boot state mutations happen inside it |

### The TOCTOU problem (why `_boot_launching` exists)

`_llama_process` is set by the watcher thread *after* it starts — not inside the lock. Without `_boot_launching`, a second `/api/boot` call arriving before the thread runs would see `_llama_process is None` and spawn a second process. `_boot_launching` is set inside the lock before it releases, so any concurrent call sees it immediately.

### Boot sequence

1. `chat.js` `DOMContentLoaded` → `loadStatus()` → checks `model_running` AND `model_launching`
2. If `model_launching`: attach to existing SSE log stream, don't call `/api/boot`
3. If neither: call `/api/boot` → server sets `_boot_launching = True` inside lock → starts watcher thread
4. Watcher thread sets `_llama_process`, reads stdout, sets `_boot_ready = True` when ready, sets `_boot_launching = False`
5. SSE stream fires `{ready: true}` → chat.js calls `startSession()`

### Process tree kill (Windows)

On Windows Intel, `shell=True` means `_llama_process` is cmd.exe, not llama-server.exe. `proc.terminate()` does NOT cascade to children on Windows. We use `taskkill /F /T /PID` to kill the whole tree. This is handled by `_kill_process_tree()` in server.py.

On Linux Intel, we use `exec` in the shell command so the shell replaces itself with llama-server — `_llama_process` IS the target process, and terminate() works correctly.

### Shutdown paths

| Trigger | Path |
|---------|------|
| Ctrl+C on SENNI terminal | uvicorn catches SIGINT → `on_shutdown()` → `_kill_llama_server()` |
| Ctrl+C on llama-server terminal | llama-server exits → watcher thread readline loop ends → `_boot_launching = False` |
| In-app restart button | `POST /api/boot {force:true}` → `_kill_llama_server()` → relaunch |
| Factory reset | `POST /api/factory-reset` → `_kill_llama_server()` → delete files |
| Python crash/exit | `atexit.register(_kill_llama_server)` fires |

`_kill_llama_server()` is the single kill entry-point — always resets `_llama_process`, `_boot_launching`, `_boot_ready`.

---

## Per-OS path resolution

`config.json` stores both flat values (active OS) and per-OS dicts:

```json
{
  "model_path":  "...",          ← active OS flat value
  "model_paths": {               ← all OSes
    "Linux":   "/path/on/linux",
    "Windows": "C:\\path\\on\\windows"
  },
  "server_binary":   "...",      ← active OS flat value (empty = auto-discover)
  "server_binaries": {           ← per-OS binary paths
    "Windows": "C:\\path\\to\\llama-server.exe"
  }
}
```

`resolve_platform_paths()` reads the current OS's entry into the flat value on load.
`update_platform_paths()` writes the flat value back into the dict on save.
Empty `server_binary` means auto-discover — never write an empty string to `server_binaries`.

### llama-server binary resolution priority

1. `config["server_binary"]` — explicit path from Settings → Server
2. Candidate paths relative to the model file
3. `shutil.which()` PATH lookup
4. Bare exe name (will fail with a clear error message in the boot log)

---

## Settings UI — file browsing

The Settings panel (and wizard) both use `/api/browse` to open a native OS file picker via tkinter. **Do not use hidden `<input type="file">` elements as the primary browse mechanism** — they can't return full paths in the browser security model.

`/api/browse` accepts `type`: `"model"` | `"mmproj"` | `"binary"`.

tkinter runs in `_executor` (thread pool) — never on the event loop thread, which would deadlock on Windows.

Fallback: if `/api/browse` fails (headless server, tkinter unavailable), a manual text input appears inline.
