# SANCHARA — BMTC + Namma Metro (merged)

One website, one server, one port.

| URL | What you see |
|---|---|
| http://localhost:5000/ | SANCHARA front page (BMTC / Namma Metro / Travel Guide cards) |
| http://localhost:5000/bmtc/ | BMTC bus app (service selection → dashboard) |
| http://localhost:5000/bmtc/admin | BMTC admin centre |
| http://localhost:5000/metro/ | Namma Metro app (planner, map, alerts, guide, assistance) |
| http://localhost:5000/api/...        | BMTC API |
| http://localhost:5000/metro-api/...  | Metro API (e.g. /metro-api/api/alerts/active) |

## Which address do I open?  ->  http://localhost:5000/

BMTC, Metro and the front page ALL live on the Flask server at **port 5000**.
If you open `localhost:5173/bmtc/` while only the metro dev server (Vite) is running you get
"404 page can't be found" - that is simply the wrong door. Always start with `python run_server.py`
(or double-click `start.bat` on Windows / run `bash start.sh` on Mac & Linux) and use port 5000.
(Live-edit mode on 5173 also works now because Vite forwards BMTC addresses to port 5000 - but port 5000
must be running too.)

## Run it (you only need Python 3.10+)

Easiest: **double-click `start.bat`** (Windows) or run `bash start.sh` (Mac/Linux). Or by hand:

```bash
pip install -r requirements.txt
python run_server.py
```
Then open http://localhost:5000/

The metro website is already built into `frontend/metro/`, so Node.js is NOT needed just to run the site.

## Folder map

```
sanchara/
├─ run_server.py          ← the ONLY command you run
├─ requirements.txt       ← Python packages for both apps
├─ backend/               ← BMTC server code  (app.py = the Flask server)
│   └─ metro_bridge.py    ← NEW: plugs the metro API into the Flask server
├─ metro_backend/         ← Metro server code (was called "backend" in the metro zip)
│   └─ metro.db           ← metro database (was backend/sanchara.db)
├─ metro_frontend/        ← Metro website SOURCE code (React + TypeScript). Edit here.
├─ frontend/
│   ├─ index.html         ← front page
│   ├─ bmtc/              ← BMTC pages
│   └─ metro/             ← BUILT metro website (generated; do not edit by hand)
└─ data/
    ├─ (BMTC data files)
    └─ metro/             ← metro datasets (raw / processed / metadata)
```

## If you change the metro website (React code)

```bash
cd metro_frontend
npm install          # first time only
npm run build        # rebuilds into ../frontend/metro/  (then refresh the browser)
```
Live-editing mode: start `python run_server.py` in one terminal (it MUST be running), then in another run
`cd metro_frontend && npm run dev`; it opens http://localhost:5173/ (changes to metro code appear instantly; the front page,
BMTC pages and all APIs are forwarded to port 5000 automatically).

## Metro admin login (development only)
`admin@sanchara.local` / `sanchara-admin-dev` — change this before any real deployment
(see `metro_backend/.env.example`).

## Tests
```bash
pip install pytest scikit-learn openpyxl
PYTHONPATH=. python -m pytest metro_backend/tests     # metro backend (62 tests)
python test_system.py                                 # BMTC engine
```
