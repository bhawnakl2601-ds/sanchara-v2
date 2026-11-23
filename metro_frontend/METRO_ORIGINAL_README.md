# SANCHARA — cinematic Bengaluru Metro navigation

React + TypeScript + Vite + Three.js + Framer Motion.

```
npm install
npm run dev        # website + Smart Alerts backend together, http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm test           # routing/fare/search/schematic + transition-math checks
```

## Train models
The five supplied GLBs live in `public/models/metro_<line>.glb` (purple, green, yellow, blue, pink). The hub shows `metro_purple.glb`; change the line in `TrainScene.ts` (`loadTrain('purple')`). Built-in track meshes are stripped, the model is turned so its cab faces the direction of travel (`GLB_FLIP` in `src/three/trainModel.ts`), scaled to 18 units and centred from its bounding box.

## Layout
- `src/data/metro.json` — built by `scripts/extract.py` from the BMRCL GTFS (stations, order, run times, dwell, headways, track geometry, pair fares), OSM station KML (Kannada names/aliases) and the 14.02.2025 fare chart.
- `src/engine/` — Dijkstra on (station,line) states, fare calculator, station search, schematic layout, geometry slicing.
- `src/app/transition.ts` — TransitionManager + pure `poseFor(kind, progress)` (the whole cinematic is a function of progress).
- `src/three/` — one persistent canvas/scene/render loop; turntable + rails, tunnel rings, trails, particles.
- `src/ui/` — Hub, Planner, MapView, ComingSoon. Features 03/04 are in `ComingSoon.tsx` (swap in real pages later).

## Notes
- Official line colours (Green #009933, Yellow #FFDF00, Purple #8C2877) come from the GTFS and are only used for transit data.
- Journey time = in-train time + dwell + transfer walk (GTFS min transfer) + half the destination line's headway. First-train wait is shown separately.
- Fares come from the GTFS pair table, which matches the PDF slab chart on all same-line pairs; smart-card 5% peak / 10% off-peak / 10% Sundays & 26 Jan, 15 Aug, 2 Oct.

---

# Option 03 — Smart Alerts & Passenger Assistance

Hub option **03** opens Smart Alerts (9 pages: Alerts, Delays, Route changes, Closures, Crowd prediction, Emergency, Lost & found, My notifications, Control room). The original planner, map, 3D hub and transitions are unchanged; verified closures are fed into the **same** Dijkstra engine, and the map gains alert/closure/heatmap overlays.

## Run it

```bash
# 1. backend (Python 3.10+)
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env           # optional; defaults work for dev
python -m backend.serve                        # FastAPI + uvicorn on :8000  (docs at /docs)
python -m backend.serve --stdlib               # zero-dependency fallback server (adds SSE instead of WebSocket)
# 2. frontend
npm install && npm run dev                     # http://localhost:5173  (VITE_API_URL overrides http://127.0.0.1:8000)
```

Dev admin (only when `SANCHARA_ENV=dev`): `admin@sanchara.local` / `sanchara-admin-dev`. In production set `ADMIN_EMAIL`/`ADMIN_PASSWORD`, a real `JWT_SECRET`, and `SANCHARA_ENV=production`.
If the backend is down the app keeps working (planner, map, 3D) and Smart Alerts says it is offline.

## Data pipeline & model (repeatable)

```bash
python -m backend.ml.preprocessing             # data/raw -> data/processed + data/metadata (raw files are never modified)
PYTHONPATH=. python -m backend.ml.train        # trains, evaluates, writes backend/models_store + data/metadata/model_report.json
PYTHONPATH=. python -m pytest backend/tests    # 45 tests
npm test                                       # engine, restrictions, transitions
```

See `docs/DATA_DICTIONARY.md`, `docs/DATA_SOURCES.md` and `docs/LIMITATIONS.md`.

## Principles

- Nothing is presented as live BMRCL data. With no feed configured the UI says: *"Live BMRCL feed not connected. Showing the latest verified information available."*
- Only administrators create/verify alerts and closures. Passenger reports are never official automatically.
- Crowd numbers are **"AI-Predicted Station Demand"** from historical hourly entries/exits — not live occupancy or coach crowding. No random values; if the model is missing it shows "unavailable".
- Emergency numbers are shown as supplied, flagged "verify periodically". Location is only read when you tap a button and is never stored.

## Visual identity (v3)
- Palette: forest green `#027032` (≈60%, used as shades for backgrounds), beige `#E9DFC9` (≈30%, content/planner/bulletin surfaces), electric purple `#A855F7` (≈10%, interaction + lighting). Map line colours remain the real Namma Metro line colours.
- The hub train is **one coach** (`src/three/trainModel.ts`, `COACHES = 1`); `TRAIN_HALF`/`CLOSE_DIST` in `src/app/transition.ts` match it.
- If WebGL is unavailable the app still works (no 3D scene); see `src/three/Stage.tsx`.

## Run everything with one command
```
npm install
npm run dev        # starts the website (http://localhost:5173) AND the Smart Alerts / crowd-prediction backend (:8000)
```
No separate `python -m backend.serve --stdlib` is needed any more. If Python's numpy/pandas are missing, `npm run dev` installs them once.
`npm run dev:web` starts only the website. The backend still runs on its own with `python -m backend.serve --stdlib`.

## Accessibility mode
Open it from the **Accessibility** button (top right) or press **Alt+A**. Options: high contrast, text size (Normal / Large / Larger), plain easy-to-read font, reduce motion (short fade instead of the 3D journey), and text to speech — **Read this page** (or just the text you selected; **Alt+R**), pause/resume/stop (**Esc**), speed, read items on keyboard focus, and read text under the mouse (on by default; browsers only allow speech after you have clicked or pressed a key on the page once). Settings are remembered in the browser. Speech uses the voices installed on the device (Web Speech API), so availability and language support vary by browser and operating system.


## Verification status (read this)
See `docs/IMPLEMENTATION_STATUS.md`, `docs/TEST_REPORT.md` and `docs/DATA_VERIFICATION.md`. Short version: fares use the 14 Feb 2025 chart (a 2026 revision could not be confirmed); accessibility is station-level and shown as **unverified**; lift outages entered by an admin (closure type `LIFT_OUTAGE`) are avoided by Accessible routing; no live BMRCL feed is configured; `package-lock.json` is not included because the build environment had no network. After `npm install`, commit the generated lock file and run `npm run build`.

## Fresh install (Windows, macOS, Linux)
1. Install Node 18+ and Python 3.10+.
2. `npm install`
3. `npm run dev` (starts the API with `python -m backend.serve --stdlib` and the web app; creates `backend/sanchara.db` on first run).
4. Copy `.env.example` to `backend/.env` only if you want to change settings. Never commit real secrets.
