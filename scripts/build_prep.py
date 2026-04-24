"""
build_prep.py — Prepare build artifacts before running PyInstaller.

Windows: Downloads the matching Python embeddable zip + bootstraps pip into
         python-embed/ at the project root. PyInstaller then bundles this
         directory so the standalone exe can install extras without requiring
         a system Python.

Linux:   Creates a placeholder marker. Linux builds fall back to system Python
         at runtime (Linux users are expected to have Python available).

Run once before each release build:
    python scripts/build_prep.py
    pyinstaller senni-backend.spec
"""

import io
import platform
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
EMBED_DIR = ROOT / "python-embed"


def main() -> None:
    if platform.system() == "Windows":
        _prepare_windows()
    else:
        _prepare_linux()


def _prepare_windows() -> None:
    ver  = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    arch = "amd64" if sys.maxsize > 2**32 else "win32"
    url  = f"https://www.python.org/ftp/python/{ver}/python-{ver}-embed-{arch}.zip"

    print(f"Downloading Python {ver} embeddable ({arch})…")
    with urllib.request.urlopen(url) as resp:
        data = resp.read()
    print(f"  {len(data) // 1024 // 1024} MB downloaded.")

    EMBED_DIR.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(EMBED_DIR)
    print(f"  Extracted to {EMBED_DIR}/")

    # Enable site.py — required for pip to locate its own packages.
    # The embeddable ships with "#import site" commented out by default.
    for pth_file in EMBED_DIR.glob("*._pth"):
        content = pth_file.read_text(encoding="utf-8")
        updated = content.replace("#import site", "import site")
        if updated != content:
            pth_file.write_text(updated, encoding="utf-8")
            print(f"  Enabled site.py in {pth_file.name}")

    # Bootstrap pip via get-pip.py
    print("Bootstrapping pip…")
    get_pip_url  = "https://bootstrap.pypa.io/get-pip.py"
    get_pip_path = EMBED_DIR / "_get-pip.py"
    with urllib.request.urlopen(get_pip_url) as resp:
        get_pip_path.write_bytes(resp.read())

    python_exe = EMBED_DIR / "python.exe"
    result = subprocess.run(
        [str(python_exe), str(get_pip_path)],
        cwd=str(EMBED_DIR),
    )
    get_pip_path.unlink()

    if result.returncode != 0:
        print("ERROR: pip bootstrap failed.")
        sys.exit(1)

    print("  pip bootstrapped successfully.")
    print(f"\npython-embed/ ready. Now run:\n  pyinstaller senni-backend.spec")


def _prepare_linux() -> None:
    EMBED_DIR.mkdir(exist_ok=True)
    (EMBED_DIR / ".linux-placeholder").write_text(
        "Linux builds use system Python for extras installation.\n",
        encoding="utf-8",
    )
    print("Linux: python-embed/ placeholder created (system Python used at runtime).")
    print(f"\nNow run:\n  pyinstaller senni-backend.spec")


if __name__ == "__main__":
    main()
