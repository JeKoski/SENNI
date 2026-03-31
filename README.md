# SENNI

## Still very early in development — Not intended for end-users yet

## S.E.N.N.I — Shared Experience Nexus for Neural Intelligence
or just *Senni* for short

S.E.N.N.I is a fully local framework for creating and interacting with your own AI assistants and companions.

<img width="1336" height="922" alt="screencap-senni" src="https://github.com/user-attachments/assets/5bc12e79-28a6-4ef2-b068-5763445dd1dc" />


## Focus is on:
- **Local & Private** — Everything happens on your own computer. No cloud.
- **Fully GUI driven** — A clean interface where you can manage everything without touching code or the command line.
- **Ease of use**
- **Experience customisability**
- **Platform agnostic**

---

> ⚠️ **WARNING: Installation not yet officially supported**
> Still in early development. The steps below should work but may need tweaking depending on your setup.

---

## Installation

### Prerequisites (all platforms)
- **Python 3.10+** (3.12 recommended)
- **llama.cpp** built for your platform (provides `llama-server`)
- A model file in `.gguf` format

---

### 🐧 Linux

```bash
# 1. Clone or download the project
cd ~/SENNI

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
python main.py
```

The browser will open automatically. On first run, the setup wizard will guide you through choosing a model and GPU.

**Intel GPU (SYCL):** Only Intel Arc / Iris / UHD GPUs are currently supported out of the box via oneAPI. Make sure oneAPI is installed at `/opt/intel/oneapi/`.

---

### 🪟 Windows

#### Quick start
1. Install [Python 3.12](https://www.python.org/downloads/) — tick **"Add Python to PATH"** during install.
2. Build or download `llama-server.exe` for your GPU:
   - **NVIDIA:** use the CUDA build from the [llama.cpp releases](https://github.com/ggerganov/llama.cpp/releases)
   - **Intel Arc:** use the SYCL build and install [Intel oneAPI Base Toolkit](https://www.intel.com/content/www/us/en/developer/tools/oneapi/base-toolkit-download.html)
   - **AMD / CPU:** use the CPU or Vulkan build
3. Place `llama-server.exe` somewhere — SENNI will find it automatically if it's in the same folder as your model, or on your PATH.
4. Download a `.gguf` model file.
5. Double-click **`start.bat`** in the SENNI folder (or run `python main.py` in a terminal).

The browser will open automatically. The wizard will walk you through the rest.

#### Manual (command prompt)
```bat
cd C:\path\to\SENNI
pip install -r requirements.txt
python main.py
```

#### Notes for Windows users
- Model paths use normal Windows paths, e.g. `C:\AI\models\my-model.gguf`
- The file browser (wizard) uses a native Windows file picker
- Intel SYCL on Windows expects oneAPI installed at `C:\Program Files (x86)\Intel\oneAPI\`

---

### 🍎 macOS

macOS is not officially supported yet, but the Python bridge server should run fine. You will need to source your own `llama-server` binary (e.g. built from source with Metal support). GPU acceleration will fall back to CPU in the meantime.

---

## Folder structure

```
main.py              — entry point (run this)
start.bat            — Windows double-click launcher
requirements.txt     — Python dependencies
scripts/             — server, config, tool loader
static/              — web UI (HTML, CSS, JS)
templates/           — default markdown templates for new companions
tools/               — tool plugins (drop a .py file here to add a tool)
companions/          — companion memory (created on first run)
```

---

## Adding tools

Drop a `.py` file in `tools/` with:

```python
TOOL_NAME    = "my_tool"
DESCRIPTION  = "Does something useful."
INPUT_SCHEMA = {"type": "object", "properties": {...}}

def run(args: dict) -> str:
    ...
```

The tool is auto-discovered on next start.
