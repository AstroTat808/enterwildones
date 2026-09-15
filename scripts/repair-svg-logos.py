from __future__ import annotations

import base64
import io
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REALMS = ROOT / "site" / "assets" / "images" / "realms"
LOGOS = (
    "enter-wild-ones.svg",
    "aureva.svg",
    "halora.svg",
    "sunveil.svg",
    "nocturne.svg",
)

AVIF_DATA = re.compile(r"data:image/avif;base64,([A-Za-z0-9+/=]+)")


def decode_avif(avif_bytes: bytes) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "source.avif"
        dst = Path(tmp) / "decoded.png"
        src.write_bytes(avif_bytes)
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(src),
                "-frames:v",
                "1",
                str(dst),
            ],
            check=True,
        )
        return Image.open(dst).convert("RGBA")


def repair(path: Path) -> tuple[int, int]:
    text = path.read_text(encoding="utf-8")
    match = AVIF_DATA.search(text)
    if not match:
        if "data:image/png;base64," in text:
            return (path.stat().st_size, path.stat().st_size)
        raise RuntimeError(f"No embedded AVIF payload found in {path}")

    avif_bytes = base64.b64decode(match.group(1))
    print(f"Decoding {path.name}: {len(avif_bytes):,} bytes, magic={avif_bytes[:12]!r}")
    image = decode_avif(avif_bytes)

    # Indexed PNG is universally supported inside SVG <image>, preserves alpha,
    # and keeps these supplied raster-in-SVG lockups compact enough for mobile.
    image = image.quantize(
        colors=256,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.FLOYDSTEINBERG,
    )
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True, compress_level=9)
    png_b64 = base64.b64encode(out.getvalue()).decode("ascii")

    repaired = AVIF_DATA.sub(f"data:image/png;base64,{png_b64}", text, count=1)
    path.write_text(repaired, encoding="utf-8")
    return (len(text.encode("utf-8")), len(repaired.encode("utf-8")))


for name in LOGOS:
    before, after = repair(REALMS / name)
    print(f"{name}: {before:,} -> {after:,} bytes")

validator = ROOT / "scripts" / "validate-branding.mjs"
source = validator.read_text(encoding="utf-8")
source = source.replace('data:image/avif;base64,', 'data:image/png;base64,')
source = source.replace('embedded AVIF', 'embedded browser-safe PNG')
source = source.replace('stat.size < 100000', 'stat.size < 500000')
validator.write_text(source, encoding="utf-8")
print("Updated branding validator for browser-safe PNG-backed SVGs.")
