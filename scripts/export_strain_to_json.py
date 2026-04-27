"""
Phase 1a (Python port) — read each batch's fiber_data.mat with scipy and emit
per-route per-layer JSON for the Note_x viewer popup.

Strict port of Fiber_Coor_Active4.m (transverse) and Fiber_Coor_Active3_batch4.m
(longitudinal). Steps performed:

  Step 3:   combine data_1/2/3 -> sorted alldata
  Step 4:   slice by pivot rows -> per-segment arrays
  Step 4.2: iterative gradient + local-neighborhood outlier cleaning
            (gradient_limit 5000 μϵ/m, local_window 21, local_tolerance 25 μϵ,
             max_iterations 10, linear-interpolated replacement)
  Step 5.3: build phys_paths — for each segment, map fiber arc-length to
            PHYSICAL position on the slab (Y for transverse, X for longitudinal)
            using the same pre_trans_dirs sequence as the MATLAB script.
  Step 7:   emit JSON (physical_position, raw, cleaned) per (route, layer).

Output schema preserves segment-by-segment structure with explicit gaps so the
plot matches the MATLAB Group plot: each segment is its own block within the
Route's plot, colored by its cable type (B vs A) and layer (Bottom vs Top).

Run from project root:

    python Note_x/scripts/export_strain_to_json.py
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import scipy.io

PROJECT_ROOT = Path.cwd()
ROUTES_CSV   = PROJECT_ROOT / "03 DuckDB" / "dfos_routes.csv"
OUT_ROOT     = PROJECT_ROOT / "Note_x" / "data" / "strain"

# v12 (2026-04-26): LS1=East=B1+B4, LS2=West=B2+B5, LS3=Middle=B3+B6
BATCHES = [
    ("B1", "LS1_East",   PROJECT_ROOT / "batch 1 - Tranverse"   / "01 Plots"           / "fiber_data.mat"),
    ("B2", "LS2_West",   PROJECT_ROOT / "batch 2 - Tranverse"   / "01 Plots"           / "fiber_data_22to24.mat"),
    ("B3", "LS3_Middle", PROJECT_ROOT / "batch 3 - Tranverse"   / "01 Plots"           / "fiber_data_batch_3.mat"),
    ("B4", "LS1_East",   PROJECT_ROOT / "batch 4 - Logitudinal" / "00 Data Processing" / "fiber_data_batch_4.mat"),
    ("B5", "LS2_West",   PROJECT_ROOT / "batch 5 - Logitudinal" / "00 Data Processing" / "fiber_data_batch_5.mat"),
    ("B6", "LS3_Middle", PROJECT_ROOT / "batch 6 - Logitudinal" / "00 Data Processing" / "fiber_data_batch_6.mat"),
]

EXCLUDE_FIBRES = {"F6", "F9", "F15", "F17"}

# Outlier-cleaning parameters (verbatim from Fiber_Coor_Active4.m §4.2)
GRADIENT_LIMIT  = 5000.0
LOCAL_WINDOW    = 21
LOCAL_TOLERANCE = 25.0
MAX_ITERATIONS  = 10

# Fiber_Coor_Active4.m line ~1080: pre_trans_dirs for the standard 12-segment
# transverse serpentine (transitions 1->2 .. 11->12).
TRANSVERSE_PRE_TRANS_DIRS = ['N', 'W', 'S', 'W', 'N', 'Z', 'S', 'E', 'N', 'E', 'S']


# ---------------------------------------------------------------------------
# DFOS routes table
# ---------------------------------------------------------------------------
def load_routes_csv():
    rows = []
    with ROUTES_CSV.open("r", newline="") as f:
        for r in csv.DictReader(f):
            seg_str = r["segment_indices"].strip()
            seg = [int(x) for x in seg_str.split(",")] if seg_str else []
            r["segment_indices_parsed"] = seg
            r["route_number"] = int(r["route_number"])
            rows.append(r)
    return rows


def fibre_id_from_field(field_name: str) -> str:
    """F1_2 -> F1, F11_1 -> F11, F14_2 -> F14."""
    parts = field_name.rsplit("_", 1)
    return parts[0] if len(parts) == 2 and parts[1].isdigit() else field_name


# ---------------------------------------------------------------------------
# .mat helpers
# ---------------------------------------------------------------------------
def _flat_str(x) -> str:
    if isinstance(x, np.ndarray):
        if x.size == 1:
            return _flat_str(x.flat[0])
        return "".join(_flat_str(v) for v in x.flat)
    return str(x)


def get_field(s, name):
    return getattr(s, name) if hasattr(s, name) else None


def collect_alldata(F):
    """Step 3: combine data_1/2/3 into sorted (position, strain). Drops NaNs."""
    pos_chunks, str_chunks = [], []
    for sheet in ("data_1", "data_2", "data_3"):
        S = get_field(F, sheet)
        if S is None:
            continue
        p = get_field(S, "position")
        s = get_field(S, "strain")
        if p is None or s is None:
            continue
        p = np.asarray(p, dtype=float).ravel()
        s = np.asarray(s, dtype=float).ravel()
        n = min(p.size, s.size)
        if n == 0:
            continue
        mask = np.isfinite(p[:n]) & np.isfinite(s[:n])
        if not mask.any():
            continue
        pos_chunks.append(p[:n][mask])
        str_chunks.append(s[:n][mask])
    if not pos_chunks:
        return np.array([]), np.array([])
    pos = np.concatenate(pos_chunks)
    strain = np.concatenate(str_chunks)
    order = np.argsort(pos)
    return pos[order], strain[order]


def get_pivots(F):
    """Pivot table as (n_seg, 3) ndarray = [start, end, length]."""
    d = get_field(F, "data")
    if d is None:
        return None
    arr = np.asarray(d, dtype=float)
    if arr.ndim == 1 and arr.size == 3:
        arr = arr.reshape(1, 3)
    if arr.ndim != 2 or arr.shape[1] != 3:
        return None
    return arr


def get_labels(F, n_seg):
    """Return list of segment label strings, length n_seg."""
    labels = get_field(F, "labels")
    if labels is None:
        return [""] * n_seg
    arr = np.asarray(labels, dtype=object).ravel()
    return [_flat_str(arr[i]).strip() if i < len(arr) else "" for i in range(n_seg)]


def get_directions(F, n_seg, label_list):
    """Return list of 'f'/'r' direction strings; falls back to label suffix."""
    d = get_field(F, "direction")
    if d is None:
        return ['f' if lbl.endswith('f') else 'r' for lbl in label_list]
    arr = np.asarray(d, dtype=object).ravel()
    out = []
    for i in range(n_seg):
        s = _flat_str(arr[i]).strip().lower() if i < len(arr) else ""
        out.append('f' if s.startswith('f') else 'r')
    return out


def get_layer_per_segment(F, n_seg, orientation):
    """Return list of 'BOT'/'TOP' strings of length n_seg."""
    if orientation == "transverse":
        return ["BOT" if i + 1 <= 6 else "TOP" for i in range(n_seg)]
    layer_cell = get_field(F, "layer")
    if layer_cell is None:
        return None
    arr = np.asarray(layer_cell, dtype=object).ravel()
    out = []
    for i in range(n_seg):
        if i >= len(arr):
            return None
        s = _flat_str(arr[i]).strip().lower()
        if s == "bottom": out.append("BOT")
        elif s == "top":  out.append("TOP")
        else: return None
    return out


def cable_type_from_label(label: str) -> str:
    """B-1f -> 'B', A-3r -> 'A'."""
    if label.startswith("A-"): return "A"
    if label.startswith("B-"): return "B"
    return "?"


# ---------------------------------------------------------------------------
# Step 5.3 — phys_paths (transverse, line ~1075 of Active4.m)
# ---------------------------------------------------------------------------
def build_transverse_phys_paths(pivots, labels, directions):
    """For each segment 1..n_seg, compute physical Y range, then SNAP each
    segment's start/end to the bay grid {0, 7.5, 15} so the central-girder
    transition is fixed at exactly y = 7.5 m (instead of drifting to ~7.3 m
    due to arc-length-vs-bay-length differences).

    Mirrors Fiber_Coor_Active4.m phys_paths construction (line ~1075) for
    the running cur_y, then applies the bay-snap on output.

    Bay grid:
        y = 0    south girder (south end of South Bay = Area B)
        y = 7.5  central girder (between bays)
        y = 15   north girder (north end of North Bay = Area A)
    """
    n_seg = pivots.shape[0]
    bay_grid = (0.0, 7.5, 15.0)

    phys = []
    pre_gaps = [pivots[i + 1, 0] - pivots[i, 1] for i in range(n_seg - 1)]
    cur_y = 0.0
    for i in range(n_seg):
        dir_p = +1 if directions[i] == 'f' else -1
        seg_len = pivots[i, 2]
        y_start_raw = cur_y
        y_end_raw   = cur_y + dir_p * seg_len
        # Snap each endpoint to the nearest bay-grid line.
        y_start = min(bay_grid, key=lambda g: abs(g - y_start_raw))
        y_end   = min(bay_grid, key=lambda g: abs(g - y_end_raw))
        phys.append({
            "pivot_start": float(pivots[i, 0]),
            "pivot_end":   float(pivots[i, 1]),
            "y_start":     float(y_start),
            "y_end":       float(y_end),
        })
        # Advance the running cumulative position with the RAW value so the
        # next segment's pre-snap location is still consistent with the
        # serpentine path (snap happens per-segment on output only).
        cur_y = y_end_raw
        if i < n_seg - 1:
            trans = TRANSVERSE_PRE_TRANS_DIRS[i] if i < len(TRANSVERSE_PRE_TRANS_DIRS) else 'Z'
            gap = pre_gaps[i]
            if   trans == 'N': cur_y += gap
            elif trans == 'S': cur_y -= gap
            # E/W/Z: no Y change
    return phys


def build_longitudinal_phys_paths(pivots, directions, layers):
    """For each longitudinal segment, return physical X range snapped to the
    panel's {0, 16} grid (panel is 16 m wide E-W).

    Each longitudinal segment runs the FULL E-W span of the slab. The fiber
    arc-length per segment is ~15.88-15.98 m (slightly less than 16 m due to
    curvature/slack), so without snapping the cumulative running position
    drifts to about -1.5 m or +17 m past the panel edges. Snap so:
        forward (f):  x_start = 0,  x_end = 16  (West -> East)
        reverse (r):  x_start = 16, x_end = 0   (East -> West)

    Mirrors the intent of Fiber_Coor_Active3_batch4.m phys_x mapping but
    aligned with the panel's true physical extent (0 to 16 m).
    """
    n_seg = pivots.shape[0]
    phys = []
    PANEL_W = 16.0
    for i in range(n_seg):
        forward = (directions[i] == 'f')
        x_start = 0.0      if forward else PANEL_W
        x_end   = PANEL_W  if forward else 0.0
        phys.append({
            "pivot_start": float(pivots[i, 0]),
            "pivot_end":   float(pivots[i, 1]),
            "x_start":     float(x_start),
            "x_end":       float(x_end),
        })
    return phys


def map_arclen_to_physical(seg_pos: np.ndarray, phys_entry: dict, axis: str) -> np.ndarray:
    """Linear remap arc-length within [pivot_start, pivot_end] to [start, end] of phys axis."""
    p0, p1 = phys_entry["pivot_start"], phys_entry["pivot_end"]
    span = max(p1 - p0, 1e-12)
    t = (seg_pos - p0) / span
    if axis == 'y':
        return phys_entry["y_start"] + t * (phys_entry["y_end"] - phys_entry["y_start"])
    return phys_entry["x_start"] + t * (phys_entry["x_end"] - phys_entry["x_start"])


# ---------------------------------------------------------------------------
# Step 4.2 — outlier cleaning (verbatim port of Fiber_Coor_Active4.m)
# ---------------------------------------------------------------------------
def clean_segment(strain_raw: np.ndarray, pos_raw: np.ndarray) -> np.ndarray:
    n_pts = strain_raw.size
    if n_pts < LOCAL_WINDOW:
        return strain_raw.copy()
    outlier_mask = np.zeros(n_pts, dtype=bool)
    strain_work = strain_raw.copy()
    half_win = LOCAL_WINDOW // 2

    for _ in range(MAX_ITERATIONS):
        good_idx = np.flatnonzero(~outlier_mask)
        n_good = good_idx.size
        if n_good < LOCAL_WINDOW:
            break
        pos_good = pos_raw[good_idx]
        strain_good = strain_work[good_idx]

        dpos = np.diff(pos_good)
        dstrain = np.diff(strain_good)
        dpos = np.where(dpos < 1e-10, 1e-10, dpos)
        gradient = np.abs(dstrain / dpos)

        grad_flag = np.zeros(n_good, dtype=bool)
        if n_good >= 3:
            for k in range(1, n_good - 1):
                if gradient[k - 1] > GRADIENT_LIMIT and gradient[k] > GRADIENT_LIMIT:
                    grad_flag[k] = True
        if n_good >= 2:
            if gradient[0]  > GRADIENT_LIMIT: grad_flag[0]  = True
            if gradient[-1] > GRADIENT_LIMIT: grad_flag[-1] = True

        local_flag = np.zeros(n_good, dtype=bool)
        for k in range(n_good):
            w_start = max(0, k - half_win)
            w_end   = min(n_good, k + half_win + 1)
            win = list(range(w_start, k)) + list(range(k + 1, w_end))
            if len(win) < 3:
                continue
            if abs(strain_good[k] - np.median(strain_good[win])) > LOCAL_TOLERANCE:
                local_flag[k] = True

        combined = grad_flag | local_flag
        flagged = good_idx[combined]
        new_mask = np.zeros(n_pts, dtype=bool)
        new_mask[flagged] = True
        if int(np.sum(new_mask & ~outlier_mask)) == 0:
            break
        outlier_mask |= new_mask
        good_now = np.flatnonzero(~outlier_mask)
        if good_now.size >= 2:
            strain_work = strain_raw.copy()
            strain_work[outlier_mask] = np.interp(
                pos_raw[outlier_mask], pos_raw[good_now], strain_raw[good_now]
            )

    cleaned = strain_raw.copy()
    if outlier_mask.any():
        good_final = np.flatnonzero(~outlier_mask)
        if good_final.size >= 2:
            cleaned[outlier_mask] = np.interp(
                pos_raw[outlier_mask], pos_raw[good_final], strain_raw[good_final]
            )
    return cleaned


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if not ROUTES_CSV.exists():
        sys.exit(f"Cannot find {ROUTES_CSV}. Run from the project root.")
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    routes = load_routes_csv()
    routes_by_fibre = {}
    for r in routes:
        routes_by_fibre.setdefault(r["fibre_id"], []).append(r)

    manifest = {
        "generated_utc":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "snapshot_policy":   "median_of_last_5_loaded_snapshots (already applied during ODiSI tare/snapshot pipeline)",
        "cleaning_policy":   "iterative gradient + local-median, params from Fiber_Coor_Active4.m §4.2",
        "axis_convention": {
            "transverse":   "Physical Y position (m), South -> North.  phys_paths from Fiber_Coor_Active4.m §5.3 with pre_trans_dirs ['N','W','S','W','N','Z','S','E','N','E','S']",
            "longitudinal": "Physical X position (m), West -> East.  phys_paths from Fiber_Coor_Active3_batch4.m segment_paths.",
        },
        "units_strain":      "microstrain",
        "load_stages":       ["LS1_East", "LS2_West", "LS3_Middle"],
        "routes":            {},
    }

    n_written = n_replaced = n_skipped = 0

    for batch_id, ls, mat_path in BATCHES:
        print(f"\n=== {batch_id} -> {ls} ===")
        if not mat_path.exists():
            print(f"  [SKIP] mat file not found: {mat_path}")
            continue

        ls_dir = OUT_ROOT / ls
        ls_dir.mkdir(parents=True, exist_ok=True)

        try:
            mat = scipy.io.loadmat(str(mat_path), struct_as_record=False, squeeze_me=True)
        except Exception as e:
            print(f"  [ERROR] could not read {mat_path.name}: {e}")
            continue

        fiber_data = mat.get("fiber_data")
        if fiber_data is None:
            print(f"  [WARN] no 'fiber_data' variable in {mat_path.name}")
            continue

        field_names = [f for f in getattr(fiber_data, "_fieldnames", [])
                       if f not in ("metadata", "column_labels")]

        for fname in field_names:
            fibre_id = fibre_id_from_field(fname)
            if fibre_id in EXCLUDE_FIBRES:
                print(f"  [SKIP] {fname} (broken/excluded)")
                n_skipped += 1
                continue
            these = routes_by_fibre.get(fibre_id)
            if not these:
                print(f"  [WARN] no routes in CSV for fibre {fibre_id} (mat field {fname})")
                continue

            F = getattr(fiber_data, fname)
            pos_all, strain_all = collect_alldata(F)
            if pos_all.size == 0:
                print(f"  [WARN] {fname}: data_1/data_2/data_3 empty")
                continue

            pivots = get_pivots(F)
            if pivots is None:
                print(f"  [WARN] {fname}: no pivot table")
                continue

            n_seg = pivots.shape[0]
            orientation = these[0]["orientation"]
            labels = get_labels(F, n_seg)
            directions = get_directions(F, n_seg, labels)
            layers = get_layer_per_segment(F, n_seg, orientation)

            if orientation == "transverse":
                phys_paths = build_transverse_phys_paths(pivots, labels, directions)
                axis = 'y'
            else:
                phys_paths = build_longitudinal_phys_paths(pivots, directions, layers)
                axis = 'x'

            # Pre-compute per-segment cleaned arrays + physical positions.
            seg_data = {}
            for j in range(n_seg):
                start, end, _ = pivots[j]
                mask = (pos_all >= start) & (pos_all <= end)
                p_arc = pos_all[mask]
                s_raw = strain_all[mask]
                if p_arc.size == 0:
                    continue
                s_clean = clean_segment(s_raw, p_arc) if p_arc.size >= LOCAL_WINDOW else s_raw
                phys_pos = map_arclen_to_physical(p_arc, phys_paths[j], axis)
                seg_data[j + 1] = {
                    "label":     labels[j],
                    "direction": directions[j],
                    "cable":     cable_type_from_label(labels[j]),
                    "layer":     layers[j] if layers else ("BOT" if j + 1 <= 6 else "TOP"),
                    "phys_start": phys_paths[j][f"{axis}_start"],
                    "phys_end":   phys_paths[j][f"{axis}_end"],
                    "phys_pos":   phys_pos,
                    "strain_raw": s_raw,
                    "strain_cleaned": s_clean,
                }

            for r in these:
                seg_idx_list = r["segment_indices_parsed"]
                if not seg_idx_list:
                    print(f"  [SKIP] {r['route_id']}: no segment indices listed in CSV")
                    continue

                for layer in ("BOT", "TOP"):
                    layer_segs = [s for s in seg_idx_list
                                  if s in seg_data and seg_data[s]["layer"] == layer]
                    if not layer_segs:
                        continue

                    seg_blocks = []
                    for s in layer_segs:
                        sd = seg_data[s]
                        # Sort within segment by physical position (ascending) so the trace is monotonic.
                        order = np.argsort(sd["phys_pos"])
                        seg_blocks.append({
                            "seg":        s,
                            "label":      sd["label"],
                            "direction":  sd["direction"],
                            "cable":      sd["cable"],
                            "phys_start": sd["phys_start"],
                            "phys_end":   sd["phys_end"],
                            "n":          int(sd["phys_pos"].size),
                            "position":   [round(float(x), 4) for x in sd["phys_pos"][order].tolist()],
                            "strain_raw":     [round(float(x), 3) for x in sd["strain_raw"][order].tolist()],
                            "strain_cleaned": [round(float(x), 3) for x in sd["strain_cleaned"][order].tolist()],
                        })

                    payload = {
                        "route_id":          r["route_id"],
                        "fibre_id":          r["fibre_id"],
                        "route":             r["route_number"],
                        "layer":             layer,
                        "load_stage":        ls,
                        "batch":             batch_id,
                        "orientation":       r["orientation"],
                        "viewer_axis":       r["viewer_axis"],
                        "viewer_position_m": float(r["viewer_position_m"]),
                        "reference_element": r["reference_element"],
                        "offset_m":          float(r["offset_m"]),
                        "offset_direction":  r["offset_direction"],
                        "status":            r["status"],
                        "phys_axis":         "Physical Y position (m), South -> North"
                                              if r["orientation"] == "transverse"
                                              else "Physical X position (m), West -> East",
                        "phys_axis_short":   "Physical Y (m, South -> North)"
                                              if r["orientation"] == "transverse"
                                              else "Physical X (m, West -> East)",
                        "snapshot_policy":   "median_of_last_5_loaded_snapshots",
                        "cleaning_policy":   "Active4.m §4.2 (gradient 5000 + local-median 25, window 21)",
                        "units_strain":      "microstrain",
                        "segments":          seg_blocks,
                    }

                    out_file = ls_dir / f"{r['route_id']}_{layer}.json"
                    already = out_file.exists()
                    with out_file.open("w") as fh:
                        json.dump(payload, fh)

                    tag = "REPLACE" if already else "OK"
                    seg_count = len(seg_blocks)
                    total_n = sum(b["n"] for b in seg_blocks)
                    print(f"  [{tag}] {ls}/{r['route_id']}_{layer}.json (segs={seg_count}, n={total_n})")
                    n_written += 1
                    if already: n_replaced += 1

                    key = r["route_id"]
                    rec = manifest["routes"].setdefault(key, {
                        "fibre_id":         r["fibre_id"],
                        "route_number":     r["route_number"],
                        "orientation":      r["orientation"],
                        "viewer_axis":      r["viewer_axis"],
                        "viewer_position_m": float(r["viewer_position_m"]),
                        "reference_element": r["reference_element"],
                        "status":           r["status"],
                        "available":        {},
                    })
                    avail = rec["available"].setdefault(ls, {"layers": []})
                    if layer not in avail["layers"]:
                        avail["layers"].append(layer)

    manifest_file = OUT_ROOT / "index.json"
    with manifest_file.open("w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"\n=== DONE ===")
    print(f"  Wrote   : {n_written} JSON file(s)")
    print(f"  Replaced: {n_replaced} existing file(s)")
    print(f"  Skipped : {n_skipped} fibre(s)")
    print(f"  Manifest: {manifest_file}")


if __name__ == "__main__":
    main()
