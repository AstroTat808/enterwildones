#!/usr/bin/env python3
"""Export approved AUREVA January 2027 vector masters to upload-ready PNGs.
Preserves the original embedded AUREVA logo and validates dimensions.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "site" / "assets" / "images" / "aureva-2027-campaign"
OUT = ROOT / "dist" / "aureva-social-2027"
ASSETS = {
    "aureva-jan2027-facebook-wide": (1920, 1080),
    "aureva-jan2027-ig-square": (1080, 1080),
    "aureva-jan2027-feed": (1080, 1350),
    "aureva-jan2027-story": (1080, 1920),
    "aureva-jan2027-afterglow-story": (1080, 1920),
}

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for stem, dimensions in ASSETS.items():
        svg_path = SRC / f"{stem}.svg"
        svg = svg_path.read_text(encoding="utf-8")
        match = __import__("xml.etree.ElementTree", fromlist=["fromstring"]).fromstring(svg)
        if (int(match.get("width", "0")), int(match.get("height", "0"))) != dimensions:
            raise RuntimeError(f"{stem}: SVG dimensions do not match approved export size")
        if "data:image/png;base64," not in svg:
            raise RuntimeError(f"{stem}: original embedded official logo is missing")
        if "2027" not in svg or "Jan" not in svg and "JAN" not in svg:
            raise RuntimeError(f"{stem}: approved January 2027 date missing")
        out_path = OUT / f"{stem}.png"
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(out_path),
                         output_width=dimensions[0], output_height=dimensions[1])
        with Image.open(out_path) as im:
            if im.size != dimensions:
                raise RuntimeError(f"{stem}: PNG has wrong dimensions: {im.size}")
            if im.mode != "RGB":
                rgb = Image.new("RGB", im.size, (4, 5, 10))
                rgb.paste(im.convert("RGBA"), mask=im.convert("RGBA").getchannel("A"))
                rgb.save(out_path, format="PNG", optimize=True)
        digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
        manifest.append(dict(file=out_path.name, width=dimensions[0],
                             height=dimensions[1], sha256=digest))
        print(f"EXPORTED {out_path.name}: {dimensions[0]}x{dimensions[1]} sha256={digest[:16]}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "README.txt").write_text(
        "AUREVA · Realm I Light | Saturday Jan 23, 2027, 7PM–3AM HST\n"
        "First Light $55 through Jan 9, 11:59PM HST | Full Radiance $70 from Jan 10\n"
        "Optional Afterglow late checkout $25 per person until Jan 24, 10AM HST.\n"
        "Official original AUREVA logo preserved from embedded vector masters.\n"
        "Publishing gate: request applications while paid ticket sales remain closed.\n"
        "Do not announce ticket checkout until explicit launch GO is issued.\n",
        encoding="utf-8",
    )
    print(f"Verified {len(manifest)} social graphics.")

if __name__ == "__main__":
    main()
