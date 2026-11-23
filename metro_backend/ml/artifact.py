"""Version-independent model artefact.

The previous artefact was a joblib/pickle of sklearn estimators + pandas DataFrames. Pickles are tied to the exact library
versions that wrote them (the reported `StringDtype.__init__() takes from 1 to 2 positional arguments but 3 were given`
is a pandas pickle mismatch). This module stores the model as plain data instead:

  crowd_model/forest_<target>.npz   decision-tree arrays (children, feature, threshold, value) for every tree
  crowd_model/tables/*.csv          history statistics, class thresholds, daily profiles
  crowd_model/meta.json             version, training window, validation metrics, calibration, library versions at training time

Inference needs only numpy + pandas (no scikit-learn, no pickle), so a fresh `pip install` loads it on any supported version.
scikit-learn is needed only to TRAIN.
"""
from __future__ import annotations
import json, hashlib
from pathlib import Path
import numpy as np, pandas as pd

FORMAT_VERSION = 2

def export_forest(rf) -> dict[str, np.ndarray]:
    """Flatten a fitted RandomForestRegressor into concatenated arrays with per-tree offsets."""
    cl, cr, ft, th, val, off = [], [], [], [], [], [0]
    for est in rf.estimators_:
        t = est.tree_; n = t.node_count
        cl.append(t.children_left.astype(np.int32)); cr.append(t.children_right.astype(np.int32))
        ft.append(t.feature.astype(np.int32)); th.append(t.threshold.astype(np.float64)); val.append(t.value[:, 0, 0].astype(np.float64)); off.append(off[-1] + n)
    return dict(left=np.concatenate(cl), right=np.concatenate(cr), feature=np.concatenate(ft), threshold=np.concatenate(th), value=np.concatenate(val), offsets=np.array(off, dtype=np.int64))

def forest_predict(f: dict, X: np.ndarray) -> np.ndarray:
    """Per-tree predictions, shape (n_trees, n_samples). Same split rule as sklearn: go left if x[feature] <= threshold."""
    X = np.asarray(X, dtype=np.float64); n = X.shape[0]; offs = f['offsets']; out = np.empty((len(offs) - 1, n))
    rows = np.arange(n)
    for t in range(len(offs) - 1):
        a, b = int(offs[t]), int(offs[t + 1]); left, right, feat, thr, val = f['left'][a:b], f['right'][a:b], f['feature'][a:b], f['threshold'][a:b], f['value'][a:b]
        node = np.zeros(n, dtype=np.int64)
        for _ in range(b - a):                       # bounded by node count
            internal = left[node] != -1
            if not internal.any(): break
            nd = node[internal]; go_left = X[rows[internal], feat[nd]] <= thr[nd]
            node[internal] = np.where(go_left, left[nd], right[nd])
        out[t] = val[node]
    return out

def save(dir_: Path, forests: dict[str, dict], tables: dict[str, pd.DataFrame], meta: dict) -> None:
    dir_.mkdir(parents=True, exist_ok=True); (dir_ / 'tables').mkdir(exist_ok=True)
    for name, f in forests.items(): np.savez_compressed(dir_ / f'forest_{name}.npz', **f)
    for name, df in tables.items(): df.to_csv(dir_ / 'tables' / f'{name}.csv', index=False)
    files = sorted(p for p in dir_.rglob('*') if p.is_file() and p.name not in ('meta.json', 'model_card.json'))
    meta = dict(meta, format_version=FORMAT_VERSION, checksums={str(p.relative_to(dir_)): hashlib.sha256(p.read_bytes()).hexdigest()[:16] for p in files})
    (dir_ / 'meta.json').write_text(json.dumps(meta, indent=2, default=str))

def load(dir_: Path) -> dict:
    """Raise FileNotFoundError if the artefact is absent, ValueError if it is damaged or from another format version."""
    mp = dir_ / 'meta.json'
    if not mp.exists(): raise FileNotFoundError(f'no model artefact at {dir_}')
    meta = json.loads(mp.read_text())
    if meta.get('format_version') != FORMAT_VERSION: raise ValueError(f"artefact format {meta.get('format_version')} != {FORMAT_VERSION}; retrain with `python -m metro_backend.ml.train`")
    for rel, want in meta.get('checksums', {}).items():
        p = dir_ / rel
        if not p.exists(): raise ValueError(f'artefact file missing: {rel}')
        if hashlib.sha256(p.read_bytes()).hexdigest()[:16] != want: raise ValueError(f'artefact file corrupt (checksum mismatch): {rel}')
    forests = {}
    for t in ('entries', 'exits'):
        with np.load(dir_ / f'forest_{t}.npz') as z: forests[t] = {k: z[k] for k in z.files}
    tb = {p.stem: pd.read_csv(p) for p in (dir_ / 'tables').glob('*.csv')}
    return dict(forests=forests, tables=tb, meta=meta)
