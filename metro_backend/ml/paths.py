from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]          # the project root (the folder that contains metro_backend/, backend/, frontend/ ...)
METRO_DATA = ROOT/'data'/'metro'                    # all metro datasets live in data/metro/ so they never mix with the BMTC files in data/raw/
RAW, PROCESSED, METADATA = METRO_DATA/'raw', METRO_DATA/'processed', METRO_DATA/'metadata'
METRO_JSON = ROOT/'metro_frontend'/'src'/'data'/'metro.json'
MODEL_DIR = ROOT/'metro_backend'/'models_store'
