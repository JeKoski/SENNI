"""
tag_release.py — Tag a release and push it to GitHub.

Usage:
    python scripts/tag_release.py

Shows the current latest tag, prompts for a new version.
- Enter → auto-increments the patch (v0.4.0 → v0.4.1)
- Type a version → uses it, or appends .1/.2/... if that tag already exists
"""

import subprocess
import sys


def _run(cmd: list[str], capture: bool = False) -> str | int:
    result = subprocess.run(cmd, capture_output=capture, text=True)
    return result.stdout.strip() if capture else result.returncode


def _latest_tag() -> str | None:
    out = _run(["git", "tag", "--sort=-version:refname"], capture=True)
    tags = [t for t in out.splitlines() if t.startswith("v")]
    return tags[0] if tags else None


def _tag_exists(tag: str) -> bool:
    return bool(_run(["git", "tag", "-l", tag], capture=True))


def _next_free(base: str) -> str:
    """Return base if it's unused, otherwise base.1, base.2, ..."""
    if not _tag_exists(base):
        return base
    n = 1
    while True:
        candidate = f"{base}.{n}"
        if not _tag_exists(candidate):
            return candidate
        n += 1


def _bump_patch(tag: str) -> str:
    """Increment the last numeric segment: v0.4.0 → v0.4.1"""
    prefix = "v" if tag.startswith("v") else ""
    parts = tag.lstrip("v").split(".")
    try:
        parts[-1] = str(int(parts[-1]) + 1)
    except (ValueError, IndexError):
        parts.append("1")
    return prefix + ".".join(parts)


def main() -> None:
    latest = _latest_tag()

    print()
    print(f"  Current version : {latest or '(none)'}")

    if latest:
        default = _bump_patch(latest)
        raw = input(f"  New version     : (Enter for {default}) ").strip()
    else:
        default = "v0.1.0"
        raw = input(f"  New version     : (Enter for {default}) ").strip()

    if not raw:
        tag = _next_free(default)
        if tag != default:
            print(f"  {default} already exists — using {tag}")
    else:
        tag = raw if raw.startswith("v") else f"v{raw}"
        tag = _next_free(tag)
        if tag != (raw if raw.startswith("v") else f"v{raw}"):
            print(f"  Already exists — using {tag}")

    print()
    print(f"  Tag to push: {tag}")
    confirm = input("  Confirm? [Y/n]: ").strip().lower()
    if confirm and confirm != "y":
        print("  Aborted.")
        sys.exit(0)

    print()
    if _run(["git", "tag", tag]) != 0:
        print("ERROR: git tag failed.")
        sys.exit(1)

    if _run(["git", "push", "origin", tag]) != 0:
        print("ERROR: git push failed — rolling back local tag.")
        _run(["git", "tag", "-d", tag])
        sys.exit(1)

    print(f"  Done! Release workflow triggered for {tag}.")
    print(f"  https://github.com/JeKoski/SENNI/actions")
    print()


if __name__ == "__main__":
    main()
