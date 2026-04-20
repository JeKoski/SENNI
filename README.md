# S.E.N.N.I — Shared Experience Nexus for Neural Intelligence
or just *Senni* for short

S.E.N.N.I is a fully local framework for creating and interacting with your own AI assistants and companions.

<img width="1336" height="922" alt="screencap-senni" src="https://github.com/user-attachments/assets/5bc12e79-28a6-4ef2-b068-5763445dd1dc" />


## Focus is on:
- **Local & Private** — Everything happens on your own computer. No cloud.
- **Ease of use** — Automated installation and setup.
- **Fully GUI driven** — A clean interface where you can manage everything without touching code or the command line.
- **Dynamic Experience** — Your companion adjusts and changes based on what is happening. And if you allow it, they can evolve autonomously!
- **Experience customisability** — Almost everything to do with companions is fully customizable.
- **Platform agnostic** — Run on almost any OS or hardware setup. My first development platform was i5-7600k (a 9 year old CPU!) and a 180€ Intel Arc GPU. Anything better and you should be able to run Senni!

---

## 🚧 **Early in development** 🚧

*Expect compatibility issues, bugs, quirks and possibly losing companion or user data - Back up often!*

Development version confirmed to be working specifically on Windows 10 and Ubuntu 25.10 using Intel Arc A750.
Ensuring wide platform and hardware compatibility, and ease of installation and use are high priorities and are being actively worked on.
My means of testing different setups is limited to what I can access. Ensuring real world compatibility is challenging at the moment.

If you install Senni, please let me know how it went!

Whether you want to give feedback or you have any issues with Senni, feel free to [contact me via email](https://github.com/JeKoski), Discord (Sdesser) or [open a new issue](https://github.com/JeKoski/SENNI/issues).

---

**Currently working on easy setup** — once finished, you should be able to just double click an executable and Senni should handle everything for you.

For now, these methods should work. Do let me know how it goes:
- _**All platforms:**_ Make sure you have Python installed! *Version 3.12.XX recommended*
- **Windows** — run `startup.bat`. Setup Wizard should deal with the rest.
- **Linux** — run `pip install -r requirements.txt` in Senni root and then boot with `python main.py`. Setup Wizard should deal with the rest.
- **Mac** — support is experimental. Running `pip install -r requirements.txt` in Senni root followed by `python main.py` to boot up might just work, but haven't had the hardware to test this. While the Setup Wizard tries to install llama.cpp and other components for you, I've no clue if it works.

---

## 🚧 **Having issues?**

Please post into [Issues](https://github.com/JeKoski/SENNI/issues)

**Provide as much info as you can:**
- What platform you're on.
- What your hardware setup is.
- What you did before the issue appeared.
- What happened when the issue appeared.
- Any log and error messages you get.
- A screenshot of the issue if relevant.

---

## 🔄 Updates & Progress

**Setup Wizard** — is functional with polishing still going on. On fresh install, Setup Wizard guides you through getting Senni up and running.

**Companion Creation Wizard** — is in! Access during Setup Wizard or from Settings -> Companion -> + Create (top right of menu).
*Default Senni companion (featured during Setup Wizard) isn't implemented yet, but is one of the next things on the list.*

**Mood System** — is in! Your companion is able to change their active mood. Visual feedback included. Fully configurable in Companion Settings>Moods.

---



> ⚠️ **WARNING: Installation not yet officially supported**
> This is being actively worked on right now.
> Still in early development. The steps below should work but may need tweaking depending on your setup.
> On Windows, running `startup.bat` should get everything installed.

---

## Installation

### Prerequisites (all platforms)
- **Python 3.10+** (3.12 recommended).
- **llama.cpp** built for your platform (provides `llama-server`) — This should now be automatically downloaded during Setup.
- A model file in `.gguf` format — Setup can download Gemma 4 E4B or Qwen 3.5 9B (Unsloth GGUFs in Q4_K_M) for you to get started or you can point it to a model you already have downloaded.

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

The browser will open automatically. On first run, the Setup Wizard will guide you through setting things up.

**Intel GPU (SYCL):** Make sure oneAPI is installed at `/opt/intel/oneapi/`. Alternatively, use Vulkan build of llama.cpp.

---

### ⊞ Windows

#### Quick start
1. Install [Python 3.12](https://www.python.org/downloads/) — tick **"Add Python to PATH"** during install.
2. Double-click **`start.bat`** in the SENNI folder (or run `python main.py` in a terminal).

The browser will open automatically. The Setup Wizard will walk you through the rest.

#### Manual (command prompt)
```bat
cd C:\path\to\SENNI
pip install -r requirements.txt
python main.py
```

#### Notes for Windows users
- Model paths use normal Windows paths, e.g. `C:\AI\models\my-model.gguf`.
- The file browser (wizard) uses a native Windows file picker.
- Intel SYCL on Windows expects oneAPI installed at `C:\Program Files (x86)\Intel\oneAPI\`.
- Alternatively, choose Vulkan during Setup Wizard for no additional requirements.
- ROCm support for AMD cards requires manual setup.

---

### 🍎 macOS

🚧 *Support is experimental* 🚧

Make sure you have Python installed (recommended version: 3.12.XX).
Setup Wizard should theoretically work, but I have no device to test this on.

If llama-server doesn't get automatically downloaded, you can [manually download llama.cpp](https://github.com/ggml-org/llama.cpp/releases)
1. Download and extract.
2. Point Senni to `llama-server` binary during Setup Wizard or in Settings -> Server.

---

## Folder structure

*Outdated but main structure remains*

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

🚧 *Known issue: Tools requiring manual declaration in ./static/js/tool-parser.js* 🚧

Drop a `.py` file in `tools/` with:

```python
TOOL_NAME    = "my_tool"
DESCRIPTION  = "Does something useful."
INPUT_SCHEMA = {"type": "object", "properties": {...}}

def run(args: dict) -> str:
    ...
```

The tool is auto-discovered on next start.
