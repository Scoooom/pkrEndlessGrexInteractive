# Endless checklist

Checklist for the PokeRogue "Entrainment Normalize" Endless guide. It is a static site: everything
in `docs/` runs in the browser. Progress lives in each browser's localStorage, and save import
(decrypting the `.prsv`, detecting the build, mapping it) happens in the browser too.

## Hosting

- **GitHub Pages:** in the repo settings, set Pages > Source to "Deploy from a branch", branch
  `main`, folder `/docs`. `docs/CNAME` sets the custom domain (endless.scooom.com) and
  `docs/.nojekyll` skips Jekyll.
- **Locally:** `docker compose up -d --build` runs `server.js`, a plain static server for testing.
  Any static server pointed at `docs/` works too. Save import needs https or localhost (Web Crypto).

## Refreshing data from the PokeRogue source

After `/opt/pokerogue` changes, or after editing `docs/data/guide.json`:

```sh
node tools/extract.mjs /opt/pokerogue      # writes docs/data/spawns.json and pokerogue-ids.json
python3 tools/sprites.py /opt/pokerogue    # needs Pillow, writes docs/sprites
```

`tools/sprites.py` cuts the first frame of each needed Pokémon's normal (non-shiny) front sprite
out of `assets/images/pokemon` (single images or sprite sheets) into `docs/sprites/<SPECIES>.png`.
