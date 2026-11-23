#!/usr/bin/env bash
# Mac / Linux:   bash start.sh
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null || PY=python
$PY -m pip install -r requirements.txt || { echo "Could not install packages. Is Python installed?"; exit 1; }
echo "Starting SANCHARA at http://localhost:5000/  (Ctrl+C to stop)"
( sleep 3; (command -v xdg-open >/dev/null && xdg-open http://localhost:5000/) || (command -v open >/dev/null && open http://localhost:5000/) ) >/dev/null 2>&1 &
$PY run_server.py
