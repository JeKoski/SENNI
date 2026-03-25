# SENNI

## Still very early in development - Not intended for end-users yet

## S.E.N.N.I - Shared Experience Nexus for Neural Intelligence
or just *Senni* for short

S.E.N.N.I is a fully local framework for creating and interacting with your own AI assistants and companions

## Focus is on:
- Local & Privacy - Everything happens on your own computer. No cloud
- Fully GUI driven - A clean interface where you can manage everything without having to touch code or the commandline
- Ease of use
- Experience customizability
- Platform agnostic

---

# WARNING: Installation not yet set-up or supported
For current early development versions, only Linux & possibly only Intel GPUs via SYCL are supported out the box
You'll need to tweak config and possibly scripts to set everything up at the moment

1. Install llama.cpp
2. Install Python 3.10+ (3.12 recommended)
3. Download a model of your choice in .gguf format
4. Open terminal at project root (~/SENNI)
5. Run `pip install -r requirements.txt`
6. Run `python main.py`

The browser will open automatically.
First run → setup wizard → configure model path and GPU → chat.

## Folder structure

main.py              — entry point (run this)
requirements.txt     — Python dependencies
scripts/             — server, config, tool loader
static/              — web UI (HTML, CSS, JS)
templates/           — default markdown templates for new companions
tools/               — tool plugins (drop a .py file here to add a tool)
companions/          — companion memory (created on first run)

## Adding tools

Drop a .py file in tools/ with:
  TOOL_NAME   = "my_tool"
  DESCRIPTION = "Does something useful."
  INPUT_SCHEMA = {"type": "object", "properties": {...}}
  def run(args: dict) -> str: ...

The tool is auto-discovered on next start.
