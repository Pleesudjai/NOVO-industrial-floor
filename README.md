# NOVO Industrial Floor, Digital Twin

Interactive digital twin of a Primekss PrimX steel-fibre-reinforced concrete
industrial floor test panel, built for the NOVO distributed fibre optic sensing
campaign run by the Mobasher group at ASU.

The viewer lets you:

- Inspect the steel-composite frame (HEA 1000 main girders, IPE 360 floor
  beams, SHS columns, SHR composite deck) in 3D.
- Click any embedded fibre to view the cleaned strain trace along its arc
  length, switch between routes, layers, and load stages, or overlay all
  three load stages on the same chart.
- Toggle a 2D strain heatmap on the slab top, with separate views for the
  N to S strain component (epsilon yy, from transverse fibres) and the
  E to W strain component (epsilon xx, from longitudinal fibres). Switch
  between a smooth interpolated grid and the raw per-fibre streak view.
- Hide or show the IBC water tanks, supplementary rebar, fibre groups, and
  load-patch outline independently.

The 1D plot, 2D heatmap, and 3D model are linked. Picking a different fibre
or load stage in any one view updates the others.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build for static hosting (Netlify, GitHub Pages, etc.)

```bash
npm run build
```

The compiled site lands in `dist/`. Serve it with any static host.

## Repository layout

| Folder | Purpose |
|---|---|
| `src/`         | Three.js viewer, popup, chart, and heatmap modules |
| `scripts/`    | Python scripts that produce the strain JSON consumed by the viewer |
| `data/strain/` | Per-route per-layer cleaned strain JSON (~210 files) for the 1D popup |
| `data/strain_grid/` | 12 interpolated 128 by 128 grids for the 2D heatmap |
| `vite.config.js` | Vite dev server with a small middleware that serves legacy PNG plots from outside this folder during development (no effect on the production build) |

## Data pipeline

The strain data on this site was produced by the following steps from the raw
ODiSI 6000 measurements:

1. ODiSI tare-and-snapshot acquisition during each load test, exported as TSV.
2. TSV to XLSX conversion, then loading into the per-batch `fiber_data.mat`
   structure (handled in MATLAB during the original analysis).
3. `scripts/export_strain_to_json.py` reads the .mat files, combines the
   per-sheet position and strain arrays, slices each segment by its pivot
   table, runs the iterative gradient and local-median outlier-cleaning
   procedure (5000 microstrain per metre gradient limit, 21-point window,
   25 microstrain local-median tolerance), maps each segment from raw
   fibre arc length to physical position on the slab, and writes one JSON
   per route per layer per load stage into `data/strain/`.
4. `scripts/build_strain_grids.py` reads those JSON files, builds two
   scattered point clouds per (load stage, layer) (one for epsilon yy from
   transverse fibres, one for epsilon xx from longitudinal fibres), and
   interpolates each onto a regular 128 by 128 grid spanning the panel.

## Authors

Chidchanok Pleesudjai, Mobasher Group, Arizona State University, 2026.
