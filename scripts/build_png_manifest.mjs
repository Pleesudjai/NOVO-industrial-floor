// Phase 1b — build a route_id × load_stage → PNG path manifest by walking
// each batch's 01 Plots/ folder. Output: Note_x/data/strain/png_manifest.json
//
// Usage (from project root):
//   node Note_x/scripts/build_png_manifest.mjs
//
// Pattern observed (consistent across B1/B2/B3):
//   batch N - Tranverse/01 Plots/<fibre>/Figure_8_Group_1_East_Side_<fibre>.png   → Route 1
//   batch N - Tranverse/01 Plots/<fibre>/Figure_9_Group_2_Middle_<fibre>.png      → Route 2
//   batch N - Tranverse/01 Plots/<fibre>/Figure_10_Group_3_West_Side_<fibre>.png  → Route 3
//   batch N - Logitudinal/01 Plots/<fibre>/Concatenated_Bottom_vs_Top_-_<fibre>.png → Both routes (no per-route split exists yet)

import { promises as fs } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const OUT = path.join(PROJECT_ROOT, 'Note_x', 'public', 'data', 'strain', 'png_manifest.json');

// Batch -> Load Stage (per docs/decisions.md v12, 2026-04-26)
//   LS1 = East   = B1 (transverse) + B4 (longitudinal)
//   LS2 = West   = B2 (transverse) + B5 (longitudinal)
//   LS3 = Middle = B3 (transverse) + B6 (longitudinal)
const BATCHES = [
  { id: 'B1', dir: 'batch 1 - Tranverse',   plotsDir: '01 Plots', LS: 'LS1_East',   orientation: 'transverse'   },
  { id: 'B2', dir: 'batch 2 - Tranverse',   plotsDir: '01 Plots', LS: 'LS2_West',   orientation: 'transverse'   },
  { id: 'B3', dir: 'batch 3 - Tranverse',   plotsDir: '01 Plots', LS: 'LS3_Middle', orientation: 'transverse'   },
  { id: 'B4', dir: 'batch 4 - Logitudinal', plotsDir: '01 Plots', LS: 'LS1_East',   orientation: 'longitudinal' },
  { id: 'B5', dir: 'batch 5 - Logitudinal', plotsDir: '01 Plots', LS: 'LS2_West',   orientation: 'longitudinal' },
  { id: 'B6', dir: 'batch 6 - Logitudinal', plotsDir: '01 Plots', LS: 'LS3_Middle', orientation: 'longitudinal' },
];

// Transverse route -> figure-prefix substring
const TRANSVERSE_ROUTE_FIG = {
  1: 'Figure_8_Group_1_East_Side',
  2: 'Figure_9_Group_2_Middle',
  3: 'Figure_10_Group_3_West_Side',
};
const LONGITUDINAL_BOTH_ROUTES_FIG = 'Concatenated_Bottom_vs_Top_-_';

function fibreIdFromFolder(folderName) {
  // 'F1_2' -> 'F1', 'F11_1' -> 'F11', 'F14_2' -> 'F14'
  return folderName.replace(/_\d+$/, '');
}

// Plain readdir — withFileTypes returns isFile()=false for Dropbox online-only
// placeholder files, so use stat() instead.
async function listDir(dir) {
  let names;
  try { names = await fs.readdir(dir); }
  catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const st = await fs.stat(path.join(dir, name));
      out.push({ name, isFile: st.isFile(), isDirectory: st.isDirectory() });
    } catch { /* skip unreadable */ }
  }
  return out;
}

async function main() {
  const manifest = {
    generated_utc: new Date().toISOString(),
    description: 'Phase 1b — route_id × load_stage → PNG (existing MATLAB plot output) for the localhost viewer popup.',
    notes: 'Transverse fibres have one PNG per route. Longitudinal fibres share a single Concatenated_Bottom_vs_Top PNG across both routes (no per-route plot exists yet).',
    routes: {},
  };

  let count = 0;
  let collisions = 0;

  for (const batch of BATCHES) {
    const plotsRoot = path.join(PROJECT_ROOT, batch.dir, batch.plotsDir);
    // Only accept canonical fibre folder names like F1_2, F11_1, F14_2 — skip
    // intermediate debug folders (22_F7_1, 23_F7_1, .claude, _archive, etc.).
    const fibreFolders = (await listDir(plotsRoot))
      .filter(d => d.isDirectory && /^F\d+_\d+$/.test(d.name));

    for (const folder of fibreFolders) {
      const fibreFolder = folder.name;            // e.g. 'F1_2'
      const fibreId     = fibreIdFromFolder(fibreFolder);   // e.g. 'F1'
      const fibrePath   = path.join(plotsRoot, fibreFolder);
      const files       = (await listDir(fibrePath)).filter(d => d.isFile).map(d => d.name);

      // Decide which routes this folder serves
      const isTransverse = files.some(f => /^Figure_(8|9|10)_Group_/.test(f));
      const isLongitudinal = files.some(f => f.startsWith(LONGITUDINAL_BOTH_ROUTES_FIG));

      const routeMappings = [];
      if (isTransverse) {
        for (const [r, prefix] of Object.entries(TRANSVERSE_ROUTE_FIG)) {
          const png = files.find(f => f.startsWith(prefix) && f.endsWith('.png'));
          if (png) {
            routeMappings.push({ route: Number(r), file: png });
          }
        }
      }
      if (isLongitudinal) {
        const png = files.find(f => f.startsWith(LONGITUDINAL_BOTH_ROUTES_FIG) && f.endsWith('.png') && !f.includes('Fiber_Pairs'));
        if (png) {
          routeMappings.push({ route: 1, file: png, scope: 'whole_fibre' });
          routeMappings.push({ route: 2, file: png, scope: 'whole_fibre' });
        }
      }

      for (const m of routeMappings) {
        const routeId = `${fibreId}_R${m.route}`;
        const url = path.posix.join(
          '/data/png_plots',
          batch.dir.replace(/ /g, '%20'),
          batch.plotsDir.replace(/ /g, '%20'),
          fibreFolder,
          m.file.replace(/ /g, '%20')
        );

        manifest.routes[routeId] ??= {};
        if (manifest.routes[routeId][batch.LS]) {
          collisions++;
          console.log(`  [REPLACE] ${routeId} @ ${batch.LS}: ${batch.id} overrides ${manifest.routes[routeId][batch.LS].batch}`);
        }
        manifest.routes[routeId][batch.LS] = {
          batch: batch.id,
          orientation: batch.orientation,
          fibre_folder: fibreFolder,
          png_file: m.file,
          png_url: url,
          scope: m.scope || 'route_only',
        };
        count++;
      }
    }
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${count} (route, LS) entries (${collisions} replacements) to:`);
  console.log('  ' + path.relative(PROJECT_ROOT, OUT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
