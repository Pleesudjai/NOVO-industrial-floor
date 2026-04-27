"""
Phase 3a — pre-compute a 128 x 128 strain grid per (load stage, layer) by
interpolating the per-route DFOS samples onto a regular grid spanning the
full 16 m x 15 m panel.

Reads:    Note_x/data/strain/<LS>/<route>_<layer>.json (output of Phase 1a)
Writes:   Note_x/data/strain_grid/<LS>_<layer>.json    (6 files: 3 LS x 2 layers)
          Note_x/data/strain_grid/index.json           (manifest)

Strategy:
  1. For each (LS, layer):
       Build a scattered (x_panel, y_panel, strain) cloud by collecting all
       per-segment samples from the JSON files. Routes flagged partial in
       dfos_routes.csv (F12_R2, F13_*, F19_*) are skipped per the user-locked
       Phase 3 input policy (Question 7 of the design doc).
  2. Decimate each segment to ~500 points to keep the interpolation fast.
  3. scipy.interpolate.griddata(method="linear") onto a 128 x 128 grid.
     Points outside the convex hull of the input cloud are left as NaN
     (rendered transparent on the heat-map plane in Phase 3b).
  4. Emit a JSON with x_grid, y_grid, strain (128 rows x 128 cols), stats.

Run from the project root:

    python Note_x/scripts/build_strain_grids.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.interpolate import griddata

ROOT     = Path.cwd()
IN_ROOT  = ROOT / "Note_x" / "public" / "data" / "strain"
OUT_ROOT = ROOT / "Note_x" / "public" / "data" / "strain_grid"

LOAD_STAGES = ("LS1_East", "LS2_West", "LS3_Middle")
LAYERS      = ("BOT", "TOP")

# Panel coordinates (physical, metres):
#   x in [0, 16]   West (0) -> East (16)
#   y in [0, 15]   North (0) -> South (15)
PANEL_X_MIN, PANEL_X_MAX = 0.0, 16.0
PANEL_Y_MIN, PANEL_Y_MAX = 0.0, 15.0
NX, NY = 128, 128

# Transverse fibre -> I-line physical x (m). I1 is east edge (x=16); I10 west edge (x=0).
FIBRE_TO_X = {
    "F1":  14.0, "F2":  12.0, "F3":  10.0, "F4": 8.0,
    "F5":   6.0, "F7":   4.0, "F8":   2.0, "F10": 0.0,
}
# Transverse route x-offset (m) relative to its I-line.
TRANSVERSE_ROUTE_OFFSET = {1: +1.0, 2: +0.05, 3: -0.05}

# Longitudinal fibre/route -> physical y (m, where y=0 is north girder).
LONGITUDINAL_Y = {
    "F19": {1: 0.15,  2: -0.15},
    "F18": {1: 3.0,   2: 1.5},
    "F16": {1: 6.0,   2: 4.5},
    "F14": {1: 7.65,  2: 7.35},
    "F11": {1: 10.5,  2: 9.0},
    "F12": {1: 13.5,  2: 12.0},
    "F13": {1: 15.15, 2: 14.85},
}

# Routes whose data is partial / unreliable. F12_R2 stays excluded (no data
# at all); F13 and F19 are now INCLUDED so the heatmap reaches the north and
# south girder edges (per user 2026-04-26 follow-up).
SKIP_ROUTES = {"F12_R2"}

POINTS_PER_SEGMENT_TARGET = 500   # decimate from ~5000-6000 raw to ~500


def collect_samples(ls: str, layer: str, direction: str):
    """Return three numpy arrays: x_panel, y_panel, strain — for the requested
    strain component:
        direction = "NS" → epsilon_yy from transverse fibres only (N-S strain).
        direction = "EW" → epsilon_xx from longitudinal fibres only (E-W strain).

    Mixing transverse and longitudinal data into one grid would average two
    different components of the strain tensor, which is physically invalid.
    This function keeps them separate.
    """
    in_dir = IN_ROOT / ls
    if not in_dir.is_dir():
        return np.array([]), np.array([]), np.array([])
    want_orient = "transverse" if direction == "NS" else "longitudinal"
    xs, ys, ss = [], [], []
    for path in sorted(in_dir.glob(f"*_{layer}.json")):
        with path.open("r") as fh:
            d = json.load(fh)
        if d["route_id"] in SKIP_ROUTES:
            continue
        if d["orientation"] != want_orient:
            continue
        fibre_id = d["fibre_id"]
        route_n  = d["route"]

        if want_orient == "transverse":
            x_iline = FIBRE_TO_X.get(fibre_id)
            offset  = TRANSVERSE_ROUTE_OFFSET.get(route_n)
            if x_iline is None or offset is None:
                continue
            x_route = x_iline + offset
            for seg in d["segments"]:
                pos = np.asarray(seg["position"], dtype=float)
                strn = np.asarray(seg["strain_cleaned"], dtype=float)
                step = max(1, len(pos) // POINTS_PER_SEGMENT_TARGET)
                xs.extend([x_route] * len(pos[::step]))
                ys.extend(pos[::step].tolist())
                ss.extend(strn[::step].tolist())
        else:  # longitudinal
            y_route = LONGITUDINAL_Y.get(fibre_id, {}).get(route_n)
            if y_route is None:
                continue
            for seg in d["segments"]:
                pos = np.asarray(seg["position"], dtype=float)
                strn = np.asarray(seg["strain_cleaned"], dtype=float)
                step = max(1, len(pos) // POINTS_PER_SEGMENT_TARGET)
                xs.extend(pos[::step].tolist())
                ys.extend([y_route] * len(pos[::step]))
                ss.extend(strn[::step].tolist())

    return np.asarray(xs), np.asarray(ys), np.asarray(ss)


def interpolate_to_grid(x: np.ndarray, y: np.ndarray, s: np.ndarray):
    """Linear scattered-data interpolation onto a 128 x 128 panel grid."""
    xg = np.linspace(PANEL_X_MIN, PANEL_X_MAX, NX)
    yg = np.linspace(PANEL_Y_MIN, PANEL_Y_MAX, NY)
    XG, YG = np.meshgrid(xg, yg)        # shape (ny, nx) = (128, 128)
    # Clip cloud points to panel bounds to avoid wasted hull area.
    mask = (x >= PANEL_X_MIN) & (x <= PANEL_X_MAX) & (y >= PANEL_Y_MIN) & (y <= PANEL_Y_MAX)
    pts = np.column_stack([x[mask], y[mask]])
    vals = s[mask]
    grid = griddata(pts, vals, (XG, YG), method="linear")
    return xg, yg, grid


def main():
    if not IN_ROOT.is_dir():
        sys.exit(f"Cannot find {IN_ROOT}. Run from project root.")
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    manifest = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "panel_extent": { "x": [PANEL_X_MIN, PANEL_X_MAX], "y": [PANEL_Y_MIN, PANEL_Y_MAX] },
        "grid_size":    { "nx": NX, "ny": NY },
        "method":       "scipy.interpolate.griddata, method=linear",
        "skip_routes":  sorted(SKIP_ROUTES),
        "files":        {},
    }
    written = 0

    DIRECTIONS = (
        ("NS", "epsilon_yy (N-S strain) from transverse fibres only"),
        ("EW", "epsilon_xx (E-W strain) from longitudinal fibres only"),
    )
    for ls in LOAD_STAGES:
        for layer in LAYERS:
          for direction, dir_desc in DIRECTIONS:
            key = f"{ls}_{layer}_{direction}"
            print(f"\n=== {ls} / {layer} / {direction} ({dir_desc}) ===")
            x, y, s = collect_samples(ls, layer, direction)
            n = len(s)
            print(f"  decimated cloud: {n} samples")
            if n < 100:
                print("  [SKIP] too few samples for interpolation")
                continue

            xg, yg, grid = interpolate_to_grid(x, y, s)
            valid = grid[np.isfinite(grid)]
            if valid.size == 0:
                print("  [WARN] interpolation produced all-NaN grid")
                continue

            stats = {
                "min":  float(np.nanmin(grid)),
                "max":  float(np.nanmax(grid)),
                "p5":   float(np.percentile(valid, 5)),
                "p50":  float(np.percentile(valid, 50)),
                "p95":  float(np.percentile(valid, 95)),
                "n_valid_cells": int(valid.size),
                "n_total_cells": int(grid.size),
            }

            grid_list = [
                [None if not np.isfinite(v) else round(float(v), 3) for v in row]
                for row in grid
            ]
            payload = {
                "load_stage":       ls,
                "layer":            layer,
                "direction":        direction,
                "direction_desc":   dir_desc,
                "source_orientation": "transverse" if direction == "NS" else "longitudinal",
                "panel_extent":     { "x": [PANEL_X_MIN, PANEL_X_MAX], "y": [PANEL_Y_MIN, PANEL_Y_MAX] },
                "grid_size":        { "nx": NX, "ny": NY },
                "x_grid":           [round(float(v), 4) for v in xg],
                "y_grid":           [round(float(v), 4) for v in yg],
                "strain":           grid_list,
                "stats":            stats,
                "n_input_samples":  int(n),
                "method":           "scipy.interpolate.griddata, method=linear",
                "axis_convention":  "x_grid: panel west (0) to east (16); y_grid: panel north (0) to south (15)",
                "units_strain":     "microstrain",
                "skip_routes":      sorted(SKIP_ROUTES),
            }

            out_file = OUT_ROOT / f"{ls}_{layer}_{direction}.json"
            with out_file.open("w") as fh:
                json.dump(payload, fh)
            print(f"  [OK] {out_file.relative_to(ROOT)}  range [{stats['min']:.1f}, {stats['max']:.1f}] microstrain  "
                  f"valid cells {stats['n_valid_cells']}/{stats['n_total_cells']}")
            manifest["files"][key] = {
                "file": f"{ls}_{layer}_{direction}.json",
                "direction": direction,
                "direction_desc": dir_desc,
                "n_input_samples": int(n),
                "stats": stats,
            }
            written += 1

    manifest_file = OUT_ROOT / "index.json"
    with manifest_file.open("w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"\n=== DONE ===")
    print(f"  Wrote {written} grid file(s) under {OUT_ROOT.relative_to(ROOT)}")
    print(f"  Manifest: {manifest_file.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
