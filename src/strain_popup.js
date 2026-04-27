// Phase 2 — clickable DFOS routes open a modal popup that always renders the
// interactive Plotly chart driven by Note_x/data/strain/<LS>/<route>_<layer>.json.
//
// Naming convention (per docs/decisions.md v12, 2026-04-26):
//   LS1_East   = batches B1 + B4
//   LS2_West   = batches B2 + B5
//   LS3_Middle = batches B3 + B6

import { renderInteractive } from './strain_chart.js';

const LS_LABEL = {
  LS1_East:   'Load Stage 1 (East)',
  LS2_West:   'Load Stage 2 (West)',
  LS3_Middle: 'Load Stage 3 (Middle)',
};
const ROUTE_DESC = {
  R1_transverse: 'Route 1, in-bay (1.0 m east of I-line)',
  R2_transverse: 'Route 2, over minor beam, east side (+50 mm)',
  R3_transverse: 'Route 3, over minor beam, west side (−50 mm)',
  R1_longitudinal: 'Route 1, east-to-west outbound (bot + top)',
  R2_longitudinal: 'Route 2, west-to-east return (bot + top)',
};
const ROUTE_SHORT = {
  R1_transverse:   'Route 1 (in-bay)',
  R2_transverse:   'Route 2 (over beam, east)',
  R3_transverse:   'Route 3 (over beam, west)',
  R1_longitudinal: 'Route 1 (E to W outbound)',
  R2_longitudinal: 'Route 2 (W to E return)',
};

// Keys used to drive the viewer's heatmap controls when the popup state
// changes — keeps the 1D plot and the 2D heatmap analysing the same data.
const POPUP_LS_TO_VIEWER_STAGE = {
  LS1_East: 'east', LS2_West: 'west', LS3_Middle: 'middle',
};

function syncViewerToPopup(opts = {}) {
  // Mirror the popup state onto the main viewer's controls so the heatmap
  // tracks the 1D analysis. Skipped silently if a control is missing.
  const { loadStage, layerMode, overlayAllStages, orientation } = _state;

  // Layer (popup -> viewer heatmap layer). 'both' leaves it alone; 'bot'/'top'
  // forces matching layer.
  if (layerMode === 'bot' || layerMode === 'top') {
    const want = layerMode.toUpperCase();
    const el = document.querySelector('#heatmapLayer');
    if (el && el.value !== want) {
      el.value = want;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  // Strain direction (orientation drives this on every popup open).
  if (opts.alsoOrientation) {
    const want = (orientation === 'longitudinal') ? 'EW' : 'NS';
    const el = document.querySelector('#heatmapDir');
    if (el && el.value !== want) {
      el.value = want;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  // Load stage (skip when overlay-all-stages is on — heatmap can only show
  // one stage at a time, so we leave whatever the user last picked).
  if (!overlayAllStages) {
    const want = POPUP_LS_TO_VIEWER_STAGE[loadStage];
    const el = document.querySelector('#stageSelect');
    if (want && el && el.value !== want) {
      el.value = want;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

let _orientations = null;     // { fibreId: 'transverse' | 'longitudinal' }
let _root         = null;
let _state        = {
  fibreId:          null,
  orientation:      'transverse',
  selectedRoute:    1,                // 1 | 2 | 3 | 'all'
  loadStage:        'LS1_East',
  layerMode:        'both',           // 'both' | 'bot' | 'top'
  overlayAllStages: false,
};

async function ensureOrientations() {
  if (_orientations) return _orientations;
  // Use the strain index.json (emitted by export_strain_to_json.py) for the
  // route -> orientation lookup. Fall back to png_manifest if absent.
  const tryUrls = ['/data/strain/index.json', '/data/strain/png_manifest.json'];
  for (const url of tryUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.toLowerCase().includes('json')) continue;
      const m = await res.json();
      _orientations = {};
      for (const [routeId, rec] of Object.entries(m.routes || {})) {
        const fibreId = rec.fibre_id || routeId.split('_R')[0];
        const orientation = rec.orientation
          || Object.values(rec.available || rec)?.[0]?.orientation
          || Object.values(rec)?.[0]?.orientation
          || 'transverse';
        _orientations[fibreId] = orientation;
      }
      if (Object.keys(_orientations).length > 0) return _orientations;
    } catch { /* try next */ }
  }
  _orientations = {};
  return _orientations;
}

function detectOrientation(fibreId) {
  return _orientations?.[fibreId] || 'transverse';
}

function buildDOM() {
  if (_root) return _root;
  const root = document.createElement('div');
  root.id = 'strainPopup';
  root.hidden = true;
  root.innerHTML = `
    <div class="sp-backdrop" data-action="close"></div>
    <div class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-title">
      <header class="sp-header">
        <div>
          <h2 id="sp-title">DFOS strain</h2>
          <p class="sp-sub" id="sp-sub"></p>
        </div>
        <button class="sp-close" data-action="close" aria-label="Close">×</button>
      </header>
      <div class="sp-controls">
        <label>
          Route
          <select id="sp-route"></select>
        </label>
        <label>
          Layer
          <select id="sp-layer">
            <option value="both">Both layers</option>
            <option value="bot">Bottom only</option>
            <option value="top">Top only</option>
          </select>
        </label>
        <label>
          Load stage
          <select id="sp-stage">
            <option value="LS1_East">Load Stage 1 (East)</option>
            <option value="LS2_West">Load Stage 2 (West)</option>
            <option value="LS3_Middle">Load Stage 3 (Middle)</option>
            <option value="all">All 3 stages (overlaid)</option>
          </select>
        </label>
        <p class="sp-note" id="sp-note">Click any fibre in the 3D view to swap to that fibre. Use the dropdowns above to change route, layer, or load stage.</p>
      </div>
      <div class="sp-body" id="sp-body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.addEventListener('click', (e) => {
    if (e.target.dataset?.action === 'close') hidePopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) hidePopup();
  });

  root.querySelector('#sp-route').addEventListener('change', (e) => {
    const v = e.target.value;
    _state.selectedRoute = v === 'all' ? 'all' : Number(v);
    renderBody();
  });
  root.querySelector('#sp-layer').addEventListener('change', (e) => {
    _state.layerMode = e.target.value;
    syncViewerToPopup();
    renderBody();
  });
  root.querySelector('#sp-stage').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'all') {
      _state.overlayAllStages = true;
    } else {
      _state.overlayAllStages = false;
      _state.loadStage = v;
    }
    syncViewerToPopup();
    renderBody();
  });

  _root = root;
  return root;
}

function populateRouteOptions(orientation) {
  const sel = _root.querySelector('#sp-route');
  const routeCount = orientation === 'transverse' ? 3 : 2;
  const opts = [];
  for (let r = 1; r <= routeCount; r++) {
    const label = ROUTE_SHORT[`R${r}_${orientation}`] || `Route ${r}`;
    opts.push(`<option value="${r}">${label}</option>`);
  }
  opts.push(`<option value="all">All ${routeCount} routes</option>`);
  sel.innerHTML = opts.join('');
}

function renderBody() {
  const body = _root.querySelector('#sp-body');
  const sub  = _root.querySelector('#sp-sub');
  const { fibreId, orientation, selectedRoute, loadStage, overlayAllStages } = _state;
  if (!fibreId) { body.innerHTML = ''; return; }

  let routeText;
  if (selectedRoute === 'all') {
    const n = orientation === 'transverse' ? 3 : 2;
    routeText = `${fibreId}, all ${n} routes`;
  } else {
    const desc = ROUTE_DESC[`R${selectedRoute}_${orientation}`] || `Route ${selectedRoute}`;
    routeText = `${fibreId} ${desc}`;
  }
  const stageText = overlayAllStages
    ? '<strong>Load Stage 1 (East), Load Stage 2 (West), and Load Stage 3 (Middle) overlaid</strong>'
    : `<strong>${LS_LABEL[loadStage]}</strong>`;
  sub.innerHTML = `${stageText} &nbsp;·&nbsp; ${routeText}`;

  // strain_chart.js expects state.routeId + state.viewMode for compatibility.
  const stateForChart = {
    ..._state,
    routeId:  selectedRoute === 'all' ? `${fibreId}_R1` : `${fibreId}_R${selectedRoute}`,
    viewMode: selectedRoute === 'all' ? 'all_routes_of_fibre' : 'this_route',
  };

  renderInteractive(body, stateForChart).catch(err => {
    console.error('strain_chart error:', err);
    body.innerHTML = `<p class="sp-empty">Interactive chart failed: ${err.message}.</p>`;
  });
}

export async function showPopup({ routeId, fibreId, loadStage }) {
  await ensureOrientations();
  buildDOM();

  const orientation = detectOrientation(fibreId);
  const initialRoute = Number((routeId || '').split('_R')[1]) || 1;

  _state.fibreId          = fibreId;
  _state.orientation      = orientation;
  _state.selectedRoute    = initialRoute;
  _state.loadStage        = loadStage in LS_LABEL ? loadStage : 'LS1_East';
  _state.layerMode        = 'both';
  _state.overlayAllStages = false;

  populateRouteOptions(orientation);

  _root.querySelector('#sp-route').value = String(_state.selectedRoute);
  _root.querySelector('#sp-layer').value = _state.layerMode;
  _root.querySelector('#sp-stage').value = _state.overlayAllStages ? 'all' : _state.loadStage;

  _root.querySelector('#sp-title').textContent = fibreId;

  _root.hidden = false;
  // Sync the viewer's heatmap to match the fibre we're now analysing —
  // orientation drives the heatmap's strain-direction selector on every
  // popup open, and the popup's load stage / layer mirror to the heatmap.
  syncViewerToPopup({ alsoOrientation: true });
  renderBody();
}

export function hidePopup() {
  if (_root) _root.hidden = true;
}
