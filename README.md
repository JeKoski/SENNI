# SENNI

*Still very early in development*

**S.E.N.N.I - Shared Experience Nexus for Neural Intelligence**
or just *Senni* for short

S.E.N.N.I is a fully local framework for creating and interacting with your own AI assistants and companions

Focus is on:
- Local & Privacy - Everything happens on your own computer. No cloud
- Fully GUI driven - A clean interface where you can manage everything without having to touch code or the commandline
- Ease of use
- Experience customizability
- Platform agnostic

---

## Quick start

1. Install Python 3.10+
2. pip install -r requirements.txt
3. python main.py

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
