# Mali putnici · Little Travellers

Proverene i bezbedne destinacije po Evropi, Balkanu, Grčkoj i Rumuniji za porodice sa bebama i malom decom (0–6 godina), sa realnom procenom troškova.

Checked, safe destinations across Europe, the Balkans, Greece and Romania for families with babies and small children (0–6), with realistic cost estimates.

Bilingual: Serbian Latin (default) and English. Static site, no build tools, no backend. Every price and fact was checked against 2025–2026 sources, and every photo is a free-licence Wikimedia Commons image with attribution.

## Structure

```
site/                    the site (GitHub Pages serves this folder)
  index.html             shell + SVG icon/illustration sprite
  assets/app.css         design system (light + dark, mobile-first)
  assets/app.js          app logic (render, filters, map, calculator, compare)
  assets/i18n.js         all UI strings sr/en
  assets/calc.js         cost estimator (pure functions)
  data/destinations.js   generated: destinations + airports + pricing
  img/<id>/*.jpg         downloaded, re-compressed Commons photos + LQIP
  data/                  source data + schema + research brief
  tools/                 build script, Commons image search, calc tests
```

## Local build

Requirements: Python 3.11+ with Pillow and requests.

```bash
cd site
python tools/build.py            # validate data, download images, write data/destinations.js
python tools/build.py --no-img   # validate + write data only (images must already exist)
node tools/test-calc.js          # unit-test the cost estimator
```

Then open `site/index.html` in a browser (works from `file://`) or serve the folder with any static server.

## Editing content

Destinations live in `site/data/raw/batch-1..6.json`. The record shape is defined in `site/data/SCHEMA.md`. After editing, re-run `tools/build.py`.

## Deploy (GitHub Pages)

Push to `main`. The `.github/workflows/pages.yml` action publishes the `site/` folder. Enable Pages → Source: GitHub Actions in the repo settings.

## Licence

Code: MIT (see below). Photos: © their respective authors, used under the free licences listed in the site's credits (CC0 / CC BY / CC BY-SA / public domain).
