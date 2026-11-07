# Endless checklist

Checklist for the PokeRogue "Entrainment Normalize" Endless guide, served at endless.scooom.com
(Cloudflare tunnel → `http://localhost:3310`). Progress lives in each browser's localStorage; the
server only serves the page and data, and decodes save files for import.

## Refreshing data from the PokeRogue source

After `/opt/pokerogue` changes, or after editing `guide.json`:

```sh
cd /opt/endless
node tools/extract.mjs /opt/pokerogue guide.json spawns.json pokerogue-ids.json   # spawns, ids, forms
python3 tools/sprites.py /opt/pokerogue guide.json spawns.json pokerogue-ids.json public/sprites  # needs Pillow
docker compose up -d --build
```

`tools/sprites.py` cuts the first frame of each needed Pokémon's normal (non-shiny) front sprite
out of `assets/images/pokemon` (single images or sprite sheets) into `public/sprites/<SPECIES>.png`,
which is baked into the image.
