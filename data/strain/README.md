# Note_x/data/strain/

Per-route per-layer strain JSON for the localhost viewer popup feature.
Phase 1a output of the strain-into-viewer integration plan (see decisions.md v11).

## Folder layout

```
strain/
├── index.json                      master manifest of available routes/stages/layers
├── LS1_West/
│   ├── F1_R1_BOT.json              transverse F1 Route 1 bottom layer, west load
│   ├── F1_R1_TOP.json              transverse F1 Route 1 top layer, west load
│   ├── F1_R2_BOT.json              ...
│   └── F11_R1_BOT.json             longitudinal F11 Route 1 bottom layer, west load
├── LS2_East/                       same naming, east load (B1 transverse + B4 longitudinal)
└── LS3_Middle/                     same naming, middle load (B3 transverse + B6 longitudinal)
```

Per-file schema:

```json
{
  "route_id":          "F1_R1",
  "fibre_id":          "F1",
  "route":             1,
  "layer":             "BOT",
  "load_stage":        "LS1_West",
  "batch":             "B2",
  "orientation":       "transverse",
  "viewer_axis":       "X",
  "viewer_position_m": -7.0,
  "reference_element": "I2",
  "offset_m":          1.0,
  "offset_direction":  "east",
  "status":            "confirmed",
  "segments":          [1, 2],
  "segment_labels":    ["B-1f", "A-2f"],
  "snapshot_policy":   "median_of_last_5_loaded_snapshots",
  "units_strain":      "microstrain",
  "units_position":    "meters_arc_length",
  "n":                 5616,
  "position":          [...],
  "strain":            [...]
}
```

## Regenerate from MATLAB

From the project root (NOT this folder):

```matlab
cd 'C:\Users\chidc\ASU Dropbox\Mobasher_Group\Research\2024_Primekss\Fiber_optic\NOVO_Primekss_FiberOptic_2026_Active_FEN'
run('Note_x/scripts/export_strain_to_json.m')
```

The script:

1. Reads `03 DuckDB/dfos_routes.csv` for route geometry + segment mapping.
2. Loads each batch's `fiber_data.mat` (B1-B6).
3. For each fibre, walks its routes from the CSV and groups segments by layer (BOT/TOP).
4. Writes one JSON per (route, layer) into the matching `LS*` folder.
5. Updates `index.json` with what was written.

Behavior on collisions (e.g., B6 re-scans transverse fibres already in B3): the **later batch overwrites**, with a `[REPLACE]` log line.

## What's intentionally skipped

- Fibres `F6`, `F9`, `F15`, `F17` are broken/excluded and never written.
- Routes with empty `segment_indices` in the CSV (e.g., F12 R2 — half-working) are skipped per layer when no data exists.
- Snapshot is the median of the last 5 loaded snapshots, **already applied during the .mat creation pipeline**. This script does NOT re-snapshot; it just routes existing strain traces.

## Source-of-truth chain

```
ODiSI .tsv → .xlsx → fiber_data.mat   (existing pipeline, snapshot already collapsed)
                  + 03 DuckDB/dfos_routes.csv (route geometry)
                  → Note_x/data/strain/*.json  (this folder)
                  → Note_x viewer popup        (Phase 1b — TODO)
```
