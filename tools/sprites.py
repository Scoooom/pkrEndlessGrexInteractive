#!/usr/bin/env python3
"""Cut the Pokémon front sprites the checklist needs out of the PokeRogue assets.

PokeRogue keeps each species' front sprite in assets/images/pokemon/<dex>[-form].png. Most are
sprite sheets (animation frames) described by a matching .json atlas; a few are a single image.
This takes the first frame of the normal (non-shiny) sprite, trims the empty border and writes
docs/sprites/<SPECIES_KEY>.png, which GitHub Pages serves with the rest of docs/.

Needs Pillow. Run after tools/extract.mjs (it reads spawns.json and pokerogue-ids.json):
  python3 tools/sprites.py /opt/pokerogue    (defaults: docs/data/*.json in, docs/sprites out)
"""
import json
import os
import sys

from PIL import Image

SRC, GUIDE, SPAWNS, IDS, OUT = (sys.argv[1:] + [None] * 5)[:5]
SRC = SRC or "/opt/pokerogue"
GUIDE = GUIDE or "docs/data/guide.json"
SPAWNS = SPAWNS or "docs/data/spawns.json"
IDS = IDS or "docs/data/pokerogue-ids.json"
OUT = OUT or "docs/sprites"
SPRITE_DIR = os.path.join(SRC, "assets/images/pokemon")


def wanted_keys():
    guide = json.load(open(GUIDE))
    spawns = json.load(open(SPAWNS))
    keys = set()
    for g in guide.get("groups", []):
        if g.get("sprite"):
            keys.add(g["sprite"])
    for s in guide.get("starters", []):
        if s.get("sprite"):
            keys.add(s["sprite"])
    for table in (spawns.get("steps", {}), spawns.get("items", {})):
        for entry in table.values():
            for b in entry["biomes"]:
                for mon in b["list"]:
                    if mon.get("key"):
                        keys.add(mon["key"])
    return keys


def first_frame(png_path):
    """First frame of a sprite sheet (via its .json atlas), or the whole image when there is none."""
    img = Image.open(png_path).convert("RGBA")
    atlas_path = png_path[:-4] + ".json"
    if os.path.exists(atlas_path):
        atlas = json.load(open(atlas_path))
        frames = atlas["textures"][0]["frames"] if "textures" in atlas else atlas["frames"]
        if isinstance(frames, dict):
            frames = [dict(v, filename=k) for k, v in frames.items()]
        frames = sorted(frames, key=lambda f: f.get("filename", ""))
        f = frames[0]["frame"]
        img = img.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    box = img.getbbox()
    return img.crop(box) if box else img


def main():
    ids = json.load(open(IDS))
    dex = {name: num for num, name in ids["species"].items()}
    os.makedirs(OUT, exist_ok=True)
    keys = sorted(wanted_keys())
    written, missing = 0, []
    for key in keys:
        num = dex.get(key)
        path = os.path.join(SPRITE_DIR, f"{num}.png") if num else None
        if path and not os.path.exists(path):
            # species that only exist as forms (Landorus-incarnate, Ogerpon-teal-mask, ...): take the first form
            forms = sorted(f for f in os.listdir(SPRITE_DIR) if f.startswith(f"{num}-") and f.endswith(".png"))
            path = os.path.join(SPRITE_DIR, forms[0]) if forms else None
        if not path or not os.path.exists(path):
            missing.append(key)
            continue
        first_frame(path).save(os.path.join(OUT, f"{key}.png"), optimize=True)
        written += 1
    # drop sprites that are no longer needed
    for f in os.listdir(OUT):
        if f.endswith(".png") and f[:-4] not in keys:
            os.remove(os.path.join(OUT, f))
    print(f"{written} sprites written to {OUT}" + (f", missing: {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
