// Phase 2 — interactive Plotly chart driven by Note_x/data/strain/<LS>/<route>_<layer>.json
//
// Strict visual match to the MATLAB Group plots produced by
// Fiber_Coor_Active4.m §5.3 (East / Middle / West Side):
//
//   - Per-segment traces (so the central-girder gap is visible).
//   - Grey raw trace underneath, colored cleaned trace on top.
//   - Color by cable type × layer:
//        Bottom B-type = dark blue   #004CCC
//        Bottom A-type = light blue  #3380FF
//        Top    B-type = dark red    #CC0000
//        Top    A-type = light red   #FF4C4C
//        Raw                          #D9D9D9
//   - X-axis: "Physical Y Position: South ↔ North (m)" (transverse)
//             "Distance from West End (m)"             (longitudinal)
//   - Y-axis: "Strain (με)" with default limits ±50 (matching MATLAB).
//   - Title format: "Route N — <position label> — <fibre>"

const COLOR_CABLE = {
  BOT: { B: '#004CCC', A: '#3380FF' },   // bottom_colors from Active4.m line ~1110
  TOP: { B: '#CC0000', A: '#FF4C4C' },   // top_colors    from Active4.m line ~1112
};
// Fallback colors for longitudinal fibres (whose segment labels like "F11_1-1f"
// don't carry an A/B cable type). MATLAB's Fiber_Coor_Active3_batch4.m line ~603
// computes is_B_type via contains(label,'B-') which is false for longitudinal,
// so it uses bottom_colors(2,:) and top_colors(2,:) — the LIGHTER shade.
const COLOR_LAYER_DEFAULT = { BOT: '#3380FF', TOP: '#FF4C4C' };
const COLOR_RAW = '#D9D9D9';
// Overlay-mode encoding: each (stage, layer) combo gets its own color.
// Same hue per stage; light shade for BOT (tension), dark shade for TOP
// (compression). All solid lines.
//   Load Stage 1 (East)   = reds
//   Load Stage 2 (West)   = blues
//   Load Stage 3 (Middle) = greens
const COLOR_STAGE_LAYER = {
  LS1_East:   { BOT: '#FF6B6B', TOP: '#C92A2A' },   // light coral / deep red
  LS2_West:   { BOT: '#74C0FC', TOP: '#1864AB' },   // sky blue / navy
  LS3_Middle: { BOT: '#8CE99A', TOP: '#2B8A3E' },   // light green / forest
};
// Full human-readable stage names — never abbreviate to LS1/LS2/LS3 in user-facing text.
const LS_LABEL_FULL = {
  LS1_East:   'Load Stage 1 (East)',
  LS2_West:   'Load Stage 2 (West)',
  LS3_Middle: 'Load Stage 3 (Middle)',
};
const ROUTE_POSITION_LABEL = {
  // Transverse — MATLAB Group titles
  R1_transverse: 'East Side',
  R2_transverse: 'Middle',
  R3_transverse: 'West Side',
  // Longitudinal — outbound (E->W) and return (W->E) per dfos_routes.csv
  R1_longitudinal: 'Outbound (E→W)',
  R2_longitudinal: 'Return (W→E)',
};

const Y_LIMIT = 50; // ±50 με default, matches MATLAB ylim_lower/upper

let _PlotlyPromise = null;
function loadPlotly() {
  _PlotlyPromise ??= import('plotly.js-basic-dist').then(mod => mod.default || mod);
  return _PlotlyPromise;
}

const _jsonCache = new Map();
async function fetchTrace(routeId, layer, ls) {
  const key = `${ls}/${routeId}_${layer}`;
  if (_jsonCache.has(key)) return _jsonCache.get(key);
  const url = `/data/strain/${ls}/${routeId}_${layer}.json`;
  const promise = (async () => {
    let r;
    try { r = await fetch(url); } catch { return null; }
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('json')) return null;
    try { return await r.json(); } catch { return null; }
  })();
  _jsonCache.set(key, promise);
  return promise;
}

function tracesForFile(json, opts = {}) {
  // opts: { overlayMode }
  //   overlayMode = false (single stage):  cable-shaded color, solid line, raw shown
  //   overlayMode = true  (3-stage overlay): stage-color, layer-dash, raw hidden
  if (!json?.segments?.length) return [];
  const traces = [];
  for (const seg of json.segments) {
    const layerName = json.layer === 'BOT' ? 'FOS Bottom' : 'FOS Top';

    if (opts.overlayMode) {
      // (stage, layer) -> distinct color. All solid. No raw trace.
      const colour = COLOR_STAGE_LAYER[json.load_stage]?.[json.layer] ?? '#444';
      traces.push({
        x: seg.position, y: seg.strain_cleaned,
        mode: 'lines',
        type: 'scattergl',
        name: `${LS_LABEL_FULL[json.load_stage]} · ${layerName} (${seg.label})`,
        legendgroup: `${json.load_stage}_${json.layer}`,
        line: { color: colour, width: 1.8, dash: 'solid' },
        hovertemplate: '%{x:.3f} m · %{y:.1f} με<extra>%{fullData.name}</extra>',
      });
    } else {
      // Single-stage view — preserve MATLAB look (raw grey under, cleaned colored).
      //   Transverse  : color by A/B cable type (per Active4.m).
      //   Longitudinal: shade by route number — R1 uses the DARK shade, R2 the
      //                 LIGHT shade, so you can tell the outbound and return
      //                 routes apart at a glance.
      let colour;
      if (json.orientation === 'longitudinal') {
        colour = (json.route === 1)
          ? COLOR_CABLE[json.layer]?.B   // dark blue / dark red
          : COLOR_CABLE[json.layer]?.A;  // light blue / light red
      } else {
        colour = COLOR_CABLE[json.layer]?.[seg.cable];
      }
      colour ??= COLOR_LAYER_DEFAULT[json.layer] ?? '#444';
      traces.push({
        x: seg.position, y: seg.strain_raw,
        mode: 'lines',
        type: 'scattergl',
        name: 'Raw (with spikes)',
        legendgroup: 'raw',
        line: { color: COLOR_RAW, width: 0.8, dash: 'solid' },
        hoverinfo: 'skip',
      });
      traces.push({
        x: seg.position, y: seg.strain_cleaned,
        mode: 'lines',
        type: 'scattergl',
        name: `${seg.label} (${layerName})`,
        legendgroup: seg.label,
        line: { color: colour, width: 1.6, dash: 'solid' },
        hovertemplate: '%{x:.3f} m · %{y:.1f} με<extra>%{fullData.name}</extra>',
      });
    }
  }
  return traces;
}

// ---------------------------------------------------------------------------
// Top-right plan-view schematic showing where the selected route(s) sit.
// ---------------------------------------------------------------------------
function buildRouteSchematic(state, orientation) {
  if (orientation === 'transverse') return buildTransverseSchematic(state);
  if (orientation === 'longitudinal') return buildLongitudinalSchematic(state);
  return null;
}

// Fibre -> I-line number (per CLAUDE.md): F1=I2, F2=I3, ..., F10=I10
const FIBRE_TO_ILINE = { F1: 2, F2: 3, F3: 4, F4: 5, F5: 6, F7: 7, F8: 8, F10: 10 };
// I-line number -> physical x (m) on the slab. I1=east edge (x=16), I10=west edge (x=0).
const ILINE_TO_X = { 1: 16, 2: 14, 3: 12, 4: 10, 5: 8, 6: 6, 7: 4, 8: 2, 10: 0 };
const ILINE_ORDER_W_TO_E = [10, 8, 7, 6, 5, 4, 3, 2, 1];   // I9 skipped per Primekss labels

// Load-patch geometry per loading_protocol.md v12 (physical x in metres,
// origin = panel west edge, +X = East). Each patch is 6 m E-W × 15 m N-S.
const LOAD_PATCH = {
  LS1_East:   { x0: 11, x1: 17, color: '#D62728', name: 'Load Stage 1 (East)'   },
  LS2_West:   { x0: -1, x1:  5, color: '#1F77B4', name: 'Load Stage 2 (West)'   },
  LS3_Middle: { x0:  5, x1: 11, color: '#2CA02C', name: 'Load Stage 3 (Middle)' },
};

function buildTransverseSchematic(state) {
  const sel = state.selectedRoute;            // 1 | 2 | 3 | 'all'
  const isSel = (n) => sel === 'all' || sel === n;
  const fibreId = state.fibreId;
  const iLine = FIBRE_TO_ILINE[fibreId];
  const xI = iLine != null ? ILINE_TO_X[iLine] : null;
  const { loadStage, overlayAllStages } = state;

  // SVG layout — full plan-view miniature of the slab (16 m E-W x 15 m N-S).
  // viewBox 380 x 240. Panel drawn at x=40..344 (304 px = 16 m, 19 px/m),
  // y=44..224 (180 px = 15 m, 12 px/m). N at top, S at bottom; W left, E right.
  const xPx = (m) => 40 + m * (304 / 16);
  const yPx = (m_from_north) => 44 + m_from_north * (180 / 15);

  // I-line vertical lines + labels at top edge. Black-and-white: the current
  // fibre's I-line is just thicker and solid; others are thin dashed grey.
  const iLineLines = ILINE_ORDER_W_TO_E.map(n => {
    const x = xPx(ILINE_TO_X[n]);
    const isMine = (n === iLine);
    return `
      <line x1="${x}" y1="${yPx(0)}" x2="${x}" y2="${yPx(15)}"
            stroke="${isMine ? '#0b1016' : '#aab0b6'}"
            stroke-width="${isMine ? 2.2 : 0.9}"
            stroke-dasharray="${isMine ? '' : '4 3'}" opacity="1" />
      <text x="${x}" y="${yPx(0) - 4}" text-anchor="middle"
            font-size="9" fill="${isMine ? '#0b1016' : '#777'}"
            font-weight="${isMine ? 700 : 400}">I${n}</text>
    `;
  }).join('');

  // Girder horizontal lines
  const girderRows = [
    { y: 0,    label: 'North girder' },
    { y: 7.5,  label: 'Central girder' },
    { y: 15,   label: 'South girder' },
  ].map(g => `
    <line x1="${xPx(0)}" y1="${yPx(g.y)}" x2="${xPx(16)}" y2="${yPx(g.y)}"
          stroke="#7e8790" stroke-width="${g.y === 7.5 ? 2 : 2.2}" opacity="0.55" />
    <text x="${xPx(16) + 4}" y="${yPx(g.y) + 3}" font-size="9" fill="#666">${g.label}</text>
  `).join('');

  // Three N-S route lines for the current fibre.
  // R1 (in-bay, +1 m east of I-line), R2 (+50 mm), R3 (-50 mm).
  // R2 and R3 visually merge at this scale, so we represent them as a single
  // marker labeled "R2/R3" at the I-line position.
  let routes = '';
  let calloutDots = '';
  if (xI != null) {
    // Selected route = solid black; non-selected = medium grey (no transparency,
    // so they stay readable on top of the colored load patch).
    const SEL_COLOR   = '#0b1016';   // near-black
    const UNSEL_COLOR = '#7a7a7a';   // medium grey
    const r1x = xPx(xI + 1);
    const r1Sel = isSel(1);
    routes += `
      <line x1="${r1x}" y1="${yPx(0)}" x2="${r1x}" y2="${yPx(15)}"
            stroke="${r1Sel ? SEL_COLOR : UNSEL_COLOR}"
            stroke-width="${r1Sel ? 2.8 : 1.4}" opacity="1" />
      <text x="${r1x}" y="${yPx(15) + 14}" text-anchor="middle"
            font-size="10" fill="${r1Sel ? SEL_COLOR : '#555'}"
            font-weight="${r1Sel ? 700 : 500}">R1 (in-bay)</text>
    `;
    const r2x = xPx(xI + 0.05);
    const r3x = xPx(xI - 0.05);
    const r23Sel = isSel(2) || isSel(3);
    routes += `
      <line x1="${r2x}" y1="${yPx(0)}" x2="${r2x}" y2="${yPx(15)}"
            stroke="${r23Sel ? SEL_COLOR : UNSEL_COLOR}"
            stroke-width="${r23Sel ? 2.6 : 1.2}" opacity="1" />
      <line x1="${r3x}" y1="${yPx(0)}" x2="${r3x}" y2="${yPx(15)}"
            stroke="${r23Sel ? SEL_COLOR : UNSEL_COLOR}"
            stroke-width="${r23Sel ? 2.6 : 1.2}" opacity="1" />
      <text x="${xPx(xI)}" y="${yPx(15) + 26}" text-anchor="middle"
            font-size="10" fill="${r23Sel ? SEL_COLOR : '#555'}"
            font-weight="${r23Sel ? 700 : 500}">R2,R3 (over beam, ±50 mm)</text>
    `;
  }

  // Cardinal-direction labels — placed inside the panel corners (top-left and
  // bottom-left for N/S) so they don't collide with the subtitle / patch
  // caption above and below.
  const compass = `
    <text x="${xPx(0) + 6}" y="${yPx(0) + 12}" font-size="9" fill="#666" font-weight="600">N</text>
    <text x="${xPx(0) + 6}" y="${yPx(15) - 4}" font-size="9" fill="#666" font-weight="600">S</text>
    <text x="${xPx(0) - 12}" y="${yPx(7.5) + 4}" text-anchor="end" font-size="10" fill="#666" font-weight="600">W</text>
    <text x="${xPx(16) + 90}" y="${yPx(7.5) + 4}" font-size="10" fill="#666" font-weight="600">E</text>
  `;

  // Slab outline + bay shading (north bay = Area A, south bay = Area B)
  const slab = `
    <rect x="${xPx(0)}" y="${yPx(0)}" width="${xPx(16) - xPx(0)}" height="${yPx(7.5) - yPx(0)}"
          fill="#e8eef3" opacity="0.55" />
    <rect x="${xPx(0)}" y="${yPx(7.5)}" width="${xPx(16) - xPx(0)}" height="${yPx(15) - yPx(7.5)}"
          fill="#dfe6ec" opacity="0.55" />
    <text x="${xPx(15.6)}" y="${yPx(0.7)}" text-anchor="end" font-size="8" fill="#888">Area A (North bay)</text>
    <text x="${xPx(15.6)}" y="${yPx(8.2)}" text-anchor="end" font-size="8" fill="#888">Area B (South bay)</text>
  `;

  // Load patch highlight (drawn over the slab, behind the I-lines/routes).
  let loadPatches = '';
  let patchSubtitle = '';
  const drawPatch = (key, opacity) => {
    const p = LOAD_PATCH[key];
    if (!p) return '';
    return `
      <rect x="${xPx(p.x0)}" y="${yPx(0)}" width="${xPx(p.x1) - xPx(p.x0)}" height="${yPx(15) - yPx(0)}"
            fill="${p.color}" opacity="${opacity}" />`;
  };
  if (overlayAllStages) {
    loadPatches = ['LS1_East', 'LS2_West', 'LS3_Middle'].map(k => drawPatch(k, 0.15)).join('');
    patchSubtitle = 'All 3 stages overlaid (red = LS1 East, blue = LS2 West, green = LS3 Middle)';
  } else if (LOAD_PATCH[loadStage]) {
    loadPatches = drawPatch(loadStage, 0.22);
    const p = LOAD_PATCH[loadStage];
    patchSubtitle = `${p.name}: 6 m wide UDL patch at 10 kN/m² (IBC water tanks)`;
  }

  const wrap = document.createElement('div');
  wrap.className = 'sp-schematic';
  wrap.innerHTML = `
    <svg viewBox="0 0 460 310" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <text x="230" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#0b1016">
        Top-down plan view of test panel
      </text>
      <text x="230" y="28" text-anchor="middle" font-size="10" fill="#888">
        Fibre <tspan font-weight="700" fill="#0b1016">${fibreId}</tspan> at minor-beam line <tspan font-weight="700" fill="#0b1016">I${iLine ?? '?'}</tspan>
      </text>
      ${slab}
      ${loadPatches}
      ${girderRows}
      ${iLineLines}
      ${routes}
      ${calloutDots}
      ${compass}
      <text x="230" y="295" text-anchor="middle" font-size="10" fill="#444"
            font-weight="600">${patchSubtitle}</text>
    </svg>
  `;
  return wrap;
}

// Longitudinal fibre N-S route positions (physical y in m, where y=0 is the
// north girder line at the top of the panel and y=15 is the south girder).
// Per dfos_routes.csv (v11, 2026-04-26).
const LONGITUDINAL_ROUTE_Y = {
  F19: { R1: 0.15,  R2: -0.15, ref: 'north girder'   }, // R2 just outside panel N edge
  F18: { R1: 3.0,   R2: 1.5,   ref: 'central girder' },
  F16: { R1: 6.0,   R2: 4.5,   ref: 'central girder' },
  F14: { R1: 7.65,  R2: 7.35,  ref: 'central girder' },
  F11: { R1: 10.5,  R2: 9.0,   ref: 'south girder'   },
  F12: { R1: 13.5,  R2: 12.0,  ref: 'south girder'   },
  F13: { R1: 15.15, R2: 14.85, ref: 'south girder'   }, // R1 just outside panel S edge
};

function buildLongitudinalSchematic(state) {
  const sel = state.selectedRoute;          // 1 | 2 | 'all'
  const isSel = (n) => sel === 'all' || sel === n;
  const fibreId = state.fibreId;
  const routeYs = LONGITUDINAL_ROUTE_Y[fibreId];
  const { loadStage, overlayAllStages } = state;

  // Same coord system as the transverse schematic.
  const xPx = (m) => 40 + m * (304 / 16);
  const yPx = (m_from_north) => 44 + m_from_north * (180 / 15);

  // I-lines (context only — no fibre is at any single I-line for longitudinal).
  const iLineLines = ILINE_ORDER_W_TO_E.map(n => {
    const x = xPx(ILINE_TO_X[n]);
    return `
      <line x1="${x}" y1="${yPx(0)}" x2="${x}" y2="${yPx(15)}"
            stroke="#aab0b6" stroke-width="0.9" stroke-dasharray="4 3" opacity="1" />
      <text x="${x}" y="${yPx(0) - 4}" text-anchor="middle"
            font-size="9" fill="#777" font-weight="400">I${n}</text>
    `;
  }).join('');

  // Girder lines (highlight the fibre's reference girder in solid black).
  const refGirder = routeYs?.ref;
  const girderRows = [
    { y: 0,    label: 'North girder',   key: 'north girder'   },
    { y: 7.5,  label: 'Central girder', key: 'central girder' },
    { y: 15,   label: 'South girder',   key: 'south girder'   },
  ].map(g => {
    const isRef = (g.key === refGirder);
    return `
      <line x1="${xPx(0)}" y1="${yPx(g.y)}" x2="${xPx(16)}" y2="${yPx(g.y)}"
            stroke="${isRef ? '#7e8790' : '#7e8790'}"
            stroke-width="${isRef ? 3 : 2}" opacity="${isRef ? 0.85 : 0.5}" />
      <text x="${xPx(16) + 4}" y="${yPx(g.y) + 3}" font-size="9"
            fill="${isRef ? '#0b1016' : '#666'}" font-weight="${isRef ? 600 : 400}">${g.label}</text>
    `;
  }).join('');

  // Two horizontal routes for the current fibre.
  let routes = '';
  if (routeYs) {
    for (const rNum of [1, 2]) {
      const y = routeYs[`R${rNum}`];
      if (y == null) continue;
      // Clip to panel for drawing if a route sits just outside the panel edge.
      const yClamped = Math.max(0, Math.min(15, y));
      const yLabelOffset = (rNum === 1) ? 12 : -4;
      const isThis = isSel(rNum);
      routes += `
        <line x1="${xPx(0)}" y1="${yPx(yClamped)}" x2="${xPx(16)}" y2="${yPx(yClamped)}"
              stroke="${isThis ? '#0b1016' : '#7a7a7a'}"
              stroke-width="${isThis ? 2.6 : 1.2}" opacity="1" />
        <text x="${xPx(0) - 6}" y="${yPx(yClamped) + yLabelOffset}" text-anchor="end"
              font-size="9" fill="${isThis ? '#0b1016' : '#555'}"
              font-weight="${isThis ? 700 : 500}">R${rNum}</text>
      `;
    }
  }

  // Slab + bay shading (same as transverse).
  const slab = `
    <rect x="${xPx(0)}" y="${yPx(0)}" width="${xPx(16) - xPx(0)}" height="${yPx(7.5) - yPx(0)}"
          fill="#e8eef3" opacity="0.55" />
    <rect x="${xPx(0)}" y="${yPx(7.5)}" width="${xPx(16) - xPx(0)}" height="${yPx(15) - yPx(7.5)}"
          fill="#dfe6ec" opacity="0.55" />
    <text x="${xPx(15.6)}" y="${yPx(0.7)}" text-anchor="end" font-size="8" fill="#888">Area A (North bay)</text>
    <text x="${xPx(15.6)}" y="${yPx(8.2)}" text-anchor="end" font-size="8" fill="#888">Area B (South bay)</text>
  `;

  // Load patch (same as transverse).
  let loadPatches = '';
  let patchSubtitle = '';
  const drawPatch = (key, opacity) => {
    const p = LOAD_PATCH[key];
    if (!p) return '';
    return `
      <rect x="${xPx(p.x0)}" y="${yPx(0)}" width="${xPx(p.x1) - xPx(p.x0)}" height="${yPx(15) - yPx(0)}"
            fill="${p.color}" opacity="${opacity}" />`;
  };
  if (overlayAllStages) {
    loadPatches = ['LS1_East', 'LS2_West', 'LS3_Middle'].map(k => drawPatch(k, 0.15)).join('');
    patchSubtitle = 'All 3 stages overlaid (red = LS1 East, blue = LS2 West, green = LS3 Middle)';
  } else if (LOAD_PATCH[loadStage]) {
    loadPatches = drawPatch(loadStage, 0.22);
    const p = LOAD_PATCH[loadStage];
    patchSubtitle = `${p.name}: 6 m wide UDL patch at 10 kN/m² (IBC water tanks)`;
  }

  // Compass labels (top-left and bottom-left inside panel; W and E outside).
  const compass = `
    <text x="${xPx(0) + 6}" y="${yPx(0) + 12}" font-size="9" fill="#666" font-weight="600">N</text>
    <text x="${xPx(0) + 6}" y="${yPx(15) - 4}" font-size="9" fill="#666" font-weight="600">S</text>
    <text x="${xPx(0) - 12}" y="${yPx(7.5) + 4}" text-anchor="end" font-size="10" fill="#666" font-weight="600">W</text>
    <text x="${xPx(16) + 90}" y="${yPx(7.5) + 4}" font-size="10" fill="#666" font-weight="600">E</text>
  `;

  const refText = refGirder ? `relative to ${refGirder}` : '';
  const wrap = document.createElement('div');
  wrap.className = 'sp-schematic';
  wrap.innerHTML = `
    <svg viewBox="0 0 460 310" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <text x="230" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#0b1016">
        Top-down plan view of test panel
      </text>
      <text x="230" y="28" text-anchor="middle" font-size="10" fill="#888">
        Longitudinal fibre <tspan font-weight="700" fill="#0b1016">${fibreId}</tspan> ${refText}
      </text>
      ${slab}
      ${loadPatches}
      ${girderRows}
      ${iLineLines}
      ${routes}
      ${compass}
      <text x="230" y="295" text-anchor="middle" font-size="10" fill="#444"
            font-weight="600">${patchSubtitle}</text>
    </svg>
  `;
  return wrap;
}


async function gatherDatasets(state) {
  const { routeId, fibreId, layerMode, viewMode, overlayAllStages, loadStage } = state;
  const routeNumbers = (viewMode === 'all_routes_of_fibre') ? [1, 2, 3] : [Number(routeId.split('_R')[1])];
  const layers = layerMode === 'both' ? ['BOT', 'TOP'] : [layerMode.toUpperCase()];
  const stages = overlayAllStages ? ['LS1_East', 'LS2_West', 'LS3_Middle'] : [loadStage];

  const jobs = [];
  for (const rn of routeNumbers) {
    const rid = `${fibreId}_R${rn}`;
    for (const layer of layers) {
      for (const ls of stages) {
        jobs.push(
          fetchTrace(rid, layer, ls).then(j => ({ json: j, rid, layer, ls }))
        );
      }
    }
  }
  return Promise.all(jobs);
}

function buildLayout(state, datasets) {
  const { fibreId, routeId, viewMode, loadStage, overlayAllStages, layerMode } = state;
  const orientation = datasets.find(d => d?.json)?.json.orientation || 'transverse';
  const xTitle = orientation === 'transverse'
    ? 'Physical Y Position: South ←→ North (m)'
    : 'Distance from West End (m)';

  let titleText;
  if (viewMode === 'all_routes_of_fibre') {
    titleText = `<b>${fibreId}</b>, all routes`;
  } else {
    const rNum = Number(routeId.split('_R')[1]);
    const posLabel = ROUTE_POSITION_LABEL[`R${rNum}_${orientation}`] || '';
    titleText = `<b>Group ${rNum}: ${posLabel}</b>, ${fibreId}`;
  }
  const stageText = overlayAllStages
    ? 'Load Stage 1 (East), Load Stage 2 (West), and Load Stage 3 (Middle) overlaid'
    : (LS_LABEL_FULL[loadStage] || '');
  const layerText = layerMode === 'both'
    ? 'Bottom + Top'
    : layerMode === 'bot' ? 'Bottom only'
    : 'Top only';
  const subTitle = `${stageText} · ${layerText}`;

  return {
    title: { text: `${titleText}<br><span style="font-size:0.85em;color:#666">${subTitle}</span>`, font: { size: 14 } },
    xaxis: {
      title: xTitle,
      // Lock transverse plots to [0, 15] m (panel N-S extent) and longitudinal
      // plots to [0, 16] m (panel E-W extent), matching the actual test panel.
      range: orientation === 'transverse' ? [0, 15] : [0, 16],
      // 1 m major ticks for both orientations.
      dtick: 1,
      tick0: 0,
      ticks: 'outside',
      ticklen: 5,
      tickwidth: 1,
      tickcolor: 'rgba(27,39,51,0.40)',
      gridcolor: 'rgba(27,39,51,0.10)',
      zerolinecolor: 'rgba(27,39,51,0.10)',
    },
    yaxis: {
      title: 'Strain (με)',
      range: [-Y_LIMIT, Y_LIMIT],
      gridcolor: 'rgba(27,39,51,0.10)',
      zerolinecolor: 'rgba(27,39,51,0.40)',
      zerolinewidth: 1,
    },
    margin: { l: 70, r: 30, t: 70, b: 60 },
    legend: { orientation: 'h', y: -0.20, x: 0.5, xanchor: 'center' },
    hovermode: 'x unified',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { family: 'IBM Plex Sans, sans-serif', color: '#17212b', size: 12 },
  };
}

export async function renderInteractive(container, state) {
  container.innerHTML = '<p class="sp-loading">Loading interactive chart…</p>';

  const [Plotly, datasets] = await Promise.all([loadPlotly(), gatherDatasets(state)]);
  const present = datasets.filter(d => d?.json);
  if (present.length === 0) {
    const fibreId = state.fibreId || '';
    const isF12R2 = (fibreId === 'F12' && state.selectedRoute === 2);
    const isF15 = (fibreId === 'F15');
    let reason;
    if (isF12R2) {
      reason = `<strong>F12 Route 2</strong> has no recorded data. F12 was a half-working fibre during the test, only the outbound segments of Route 1 were captured.`;
    } else if (isF15) {
      reason = `<strong>F15</strong> is excluded from the analysis. The fibre broke during testing and only one usable segment remained.`;
    } else {
      reason = `No strain data is available for <strong>${fibreId}</strong> at the requested load stage and layer combination.`;
    }
    container.innerHTML = `
      <div class="sp-empty">
        <p>${reason}</p>
        <p>Try a different load stage, switch the layer, or click another fibre in the 3D view.</p>
      </div>`;
    return;
  }

  // Build trace list. Overlay mode = stage-as-color, layer-as-dash, no raw.
  // Single-stage mode = MATLAB cable shades + raw grey trace underneath.
  const overlayMode = !!state.overlayAllStages;
  const traces = [];
  for (const d of present) {
    traces.push(...tracesForFile(d.json, { overlayMode }));
  }

  // Legend hygiene: keep one entry per legendgroup so we don't get a row per
  // segment. Raw is suppressed entirely in overlay mode by tracesForFile.
  const seenLegendGroups = new Set();
  for (const t of traces) {
    if (seenLegendGroups.has(t.legendgroup)) {
      t.showlegend = false;
    } else {
      t.showlegend = true;
      seenLegendGroups.add(t.legendgroup);
    }
  }

  const layout = buildLayout(state, present);
  const config  = {
    displaylogo: false,
    responsive: true,
    toImageButtonOptions: { format: 'png', filename: state.routeId, height: 500, width: 1200, scale: 2 },
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  };

  // Schematic is OUTSIDE the plot area — sits above it as its own block,
  // so it never overlaps the Plotly modebar (zoom / pan / save).
  container.innerHTML = '';
  const schematic = buildRouteSchematic(state, present[0]?.json?.orientation);
  if (schematic) container.appendChild(schematic);

  const plotDiv = document.createElement('div');
  plotDiv.className = 'sp-plot';
  plotDiv.style.width = '100%';
  plotDiv.style.height = '540px';
  container.appendChild(plotDiv);
  await Plotly.newPlot(plotDiv, traces, layout, config);

  // Provenance footer — small print under the plot showing batch / file source.
  const meta = present.map(d => ({
    rid: d.rid, layer: d.layer, ls: d.ls, batch: d.json.batch,
    n: d.json.segments.reduce((a, s) => a + s.n, 0),
    seg_count: d.json.segments.length,
  }));
  const metaHtml = meta.map(m =>
    `<span><b>${m.rid}</b> ${m.layer} · ${LS_LABEL_FULL[m.ls]} · batch ${m.batch} · ${m.seg_count} seg(s) · n=${m.n}</span>`
  ).join(' &nbsp;|&nbsp; ');
  const footer = document.createElement('div');
  footer.className = 'sp-provenance';
  footer.innerHTML = `<small>Snapshot: median of last 5 loaded snapshots · Cleaning: gradient(>5000 με/m) + local-median(±25 με, window=21) iterative · ${metaHtml}</small>`;
  container.appendChild(footer);
}
