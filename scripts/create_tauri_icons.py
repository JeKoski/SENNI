"""
create_tauri_icons.py — Generate placeholder Tauri icons from a source PNG.

Usage:
    python scripts/create_tauri_icons.py [source.png]

If no source is given, tries assets/icon.png then generates a solid-colour
placeholder if that's also missing.

Run once before `cargo tauri build` or `cargo tauri dev`.
Replace src-tauri/icons/ contents with real icons before release.
"""

import sys
import struct
import zlib
from pathlib import Path

ICONS_DIR = Path(__file__).parent.parent / "src-tauri" / "icons"

SIZES = {
    "32x32.png":       (32, 32),
    "128x128.png":     (128, 128),
    "128x128@2x.png":  (256, 256),
    "icon.png":        (512, 512),
}


def _make_png(width: int, height: int, rgba: tuple[int, int, int, int]) -> bytes:
    """Create a minimal valid PNG filled with a single RGBA colour."""
    def chunk(name: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", crc)

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = chunk(b"IHDR", ihdr_data)

    # IDAT — one row per line, filter byte 0
    r, g, b, _ = rgba
    row = bytes([0]) + bytes([r, g, b]) * width
    raw = row * height
    idat = chunk(b"IDAT", zlib.compress(raw))

    # IEND
    iend = chunk(b"IEND", b"")

    return b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend


def _make_ico(png_32: bytes) -> bytes:
    """Wrap a 32×32 PNG as a minimal .ico file."""
    # ICO header + one directory entry + image data
    header = struct.pack("<HHH", 0, 1, 1)          # reserved, type=1 (ico), count=1
    entry  = struct.pack("<BBBBHHII",
        32, 32,   # width, height
        0,        # colour count (0 = no palette)
        0,        # reserved
        1, 32,    # colour planes, bits per pixel
        len(png_32),
        6 + 16,   # offset to image data (header + one entry)
    )
    return header + entry + png_32


def generate_from_source(source: Path) -> None:
    """Resize source PNG into all required icon sizes using Pillow."""
    from PIL import Image

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    src = Image.open(source).convert("RGBA")

    for name, (w, h) in SIZES.items():
        resized = src.resize((w, h), Image.LANCZOS)
        resized.save(ICONS_DIR / name, "PNG")
        print(f"  {name} ({w}×{h})")

    # .ico from 32x32
    small = src.resize((32, 32), Image.LANCZOS)
    small.save(ICONS_DIR / "icon.ico", format="ICO", sizes=[(32, 32)])
    print("  icon.ico")


def generate_placeholders() -> None:
    """Create solid-colour placeholder PNGs when no source is available."""
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    colour = (80, 60, 120, 255)  # muted purple — easy to spot as placeholder

    for name, (w, h) in SIZES.items():
        (ICONS_DIR / name).write_bytes(_make_png(w, h, colour))
        print(f"  {name} ({w}×{h}) [placeholder]")

    # .ico from the 32x32 PNG placeholder
    png_32 = _make_png(32, 32, colour)
    (ICONS_DIR / "icon.ico").write_bytes(_make_ico(png_32))
    print("  icon.ico [placeholder]")


def main() -> None:
    source_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    default_source = Path(__file__).parent.parent / "assets" / "icon.png"

    print(f"Writing icons to {ICONS_DIR}/")

    if source_arg and source_arg.exists():
        print(f"Source: {source_arg}")
        generate_from_source(source_arg)
    elif default_source.exists():
        print(f"Source: {default_source}")
        generate_from_source(default_source)
    else:
        print("No source PNG found — generating solid-colour placeholders.")
        print("For real icons: python scripts/create_tauri_icons.py assets/icon.png")
        generate_placeholders()

    print("Done.")


if __name__ == "__main__":
    main()
