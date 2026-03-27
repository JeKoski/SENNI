"""
auto_backup.py — Called on server startup to snapshot tracked project files.

Reads .gitignore to know what to skip (same logic as git).
Saves to backups/YYYY-MM-DD_HH-MM-SS/ at the project root.
Keeps the 10 most recent backups and deletes older ones.
"""

import shutil
from datetime import datetime
from pathlib import Path

def run_backup(project_root: Path) -> None:
    backup_root = project_root / "backups"
    backup_root.mkdir(exist_ok=True)

    # Build ignore set from .gitignore
    ignored = _load_gitignore(project_root)

    # Create timestamped folder
    stamp  = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest   = backup_root / stamp
    dest.mkdir()

    # Copy all tracked files
    copied = 0
    for src in project_root.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(project_root)
        if _is_ignored(rel, ignored):
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        copied += 1

    # Prune — keep only the 10 most recent backups
    backups = sorted(backup_root.iterdir())
    for old in backups[:-10]:
        if old.is_dir():
            shutil.rmtree(old)

    print(f"[backup] {copied} files → backups/{stamp}/")


def _load_gitignore(project_root: Path) -> list[str]:
    gitignore = project_root / ".gitignore"
    if not gitignore.exists():
        return []
    lines = []
    for line in gitignore.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            lines.append(line)
    return lines


def _is_ignored(rel: Path, patterns: list[str]) -> bool:
    parts = rel.parts
    rel_str = str(rel)

    for pattern in patterns:
        # Always skip .git
        if parts[0] == ".git":
            return True
        # Directory patterns (trailing slash or plain name matching a part)
        p = pattern.rstrip("/")
        if p in parts:
            return True
        # Simple glob on filename
        if rel.name == p:
            return True
        # Wildcard extension e.g. *.pyc
        if pattern.startswith("*.") and rel.name.endswith(pattern[1:]):
            return True
        # Path prefix match
        if rel_str.startswith(p):
            return True

    return False
