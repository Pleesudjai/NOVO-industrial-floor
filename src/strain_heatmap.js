// Phase 3b — paint a 2D strain heatmap on top of the slab in the 3D viewer.
//
// Two view modes:
//   1. SMOOTH    — flat textured plane backed by a 128 x 128 strain grid file
//                  (pre-computed by build_strain_grids.py).
//   2. STREAKS   — raw per-fibre coloured lines on the slab surface, one Three.js
//                  Line per route, vertex colours from the per-route strain JSON
//                  (no interpolation between fibres).
//
// Direction (which strain component): NS = epsilon_yy (transverse fibres);
// EW = epsilon_xx (longitudinal fibres). Mixing the two is physically wrong
// (different strain-tensor components) so we keep the data sources separate.
//
// Coordinate convention bridge:
//   Grid file & per-route JSON: x in [0, 16] (panel west to east),
//                                y in [0, 15] (north to south).
//   Viewer:                     +X = West (panel west = +8, east = -8);
//                                +Z = North (north girder z = 0).

import * as THREE from 'three';

const GRID_NX = 128;
const GRID_NY = 128;
const PANEL_W = 16;
const PANEL_H = 15;
const PANEL_CENTER_Z = -7.5;
const DEFAULT_CLAMP = 25;

// State -----------------------------------------------------------------------
let _state = {
  loadStage: 'LS1_East',
  layer:     'BOT',
  direction: 'NS',                // 'NS' (epsilon_yy) | 'EW' (epsilon_xx)
  mode:      'smooth',            // 'smooth' | 'streaks'
  clamp:     DEFAULT_CLAMP,
  visible:   false,
};

let _scene      = null;
let _slabTopY   = null;
let _onRender   = null;

let _planeMesh  = null;
let _planeTex   = null;

// Streaks: one parent group; refilled on apply().
let _streaksGroup = null;

// Caches ----------------------------------------------------------------------
const _gridCache  = new Map();
const _routeCache = new Map();

async function fetchJSON(url) {
  let r;
  try { r = await fetch(url); } catch { return null; }
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('json')) return null;
  try { return await r.json(); } catch { return null; }
}

async function fetchGrid(loadStage, layer, direction) {
  const key = `${loadStage}_${layer}_${direction}`;
  if (_gridCache.has(key)) return _gridCache.get(key);
  const promise = fetchJSON(`/data/strain_grid/${key}.json`);
  _gridCache.set(key, promise);
  return promise;
}

async function fetchRoute(routeId, layer, loadStage) {
  const key = `${loadStage}/${routeId}_${layer}`;
  if (_routeCache.has(key)) return _routeCache.get(key);
  const promise = fetchJSON(`/data/strain/${loadStage}/${routeId}_${layer}.json`);
  _routeCache.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Colormap (divergent red-white-blue with magnitude-proportional alpha)
// ---------------------------------------------------------------------------
function rwbColor(value, clamp) {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  const t = Math.max(-1, Math.min(1, value / clamp));
  const a = Math.round(30 + 190 * Math.abs(t));
  if (t >= 0) {
    const r = 255 + (214 - 255) * t;
    const g = 255 + ( 39 - 255) * t;
    const b = 255 + ( 40 - 255) * t;
    return [r, g, b, a];
  } else {
    const k = -t;
    const r = 255 + ( 31 - 255) * k;
    const g = 255 + ( 78 - 255) * k;
    const b = 255 + (138 - 255) * k;
    return [r, g, b, a];
  }
}

// ---------------------------------------------------------------------------
// SMOOTH mode — DataTexture on a horizontal plane
// ---------------------------------------------------------------------------
function buildRGBA(grid, clamp, flipColumns) {
  const ny = grid.length;
  const nx = grid[0].length;
  const data = new Uint8Array(ny * nx * 4);
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const dataCol = flipColumns ? (nx - 1 - col) : col;
      const v = grid[row][dataCol];
      const [r, g, b, a] = rwbColor(v, clamp);
      const i = (row * nx + col) * 4;
      data[i    ] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

function ensurePlane() {
  if (_planeMesh) return;
  const geom = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
  const placeholder = new Uint8Array(GRID_NX * GRID_NY * 4);
  _planeTex = new THREE.DataTexture(placeholder, GRID_NX, GRID_NY, THREE.RGBAFormat);
  _planeTex.minFilter = THREE.LinearFilter;
  _planeTex.magFilter = THREE.LinearFilter;
  _planeTex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: _planeTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  _planeMesh = new THREE.Mesh(geom, mat);
  _planeMesh.rotation.x = -Math.PI / 2;
  _planeMesh.position.set(0, _slabTopY + 0.01, PANEL_CENTER_Z);
  _planeMesh.renderOrder = 5;
  _planeMesh.visible = false;
  _scene.add(_planeMesh);
}

async function applySmooth() {
  ensurePlane();
  const grid = await fetchGrid(_state.loadStage, _state.layer, _state.direction);
  if (!grid) {
    console.warn(`[strain_heatmap] grid missing for ${_state.loadStage}/${_state.layer}/${_state.direction}`);
    _planeMesh.visible = false;
    return null;
  }
  const rgba = buildRGBA(grid.strain, _state.clamp, /*flipColumns*/ true);
  _planeTex.image = { data: rgba, width: GRID_NX, height: GRID_NY };
  _planeTex.needsUpdate = true;
  _planeMesh.visible = _state.visible;
  return grid;
}

function hidePlane() { if (_planeMesh) _planeMesh.visible = false; }

// ---------------------------------------------------------------------------
// STREAKS mode — per-route coloured line on the slab top
// ---------------------------------------------------------------------------
const FIBRE_TO_X = {
  F1: 14, F2: 12, F3: 10, F4: 8, F5: 6, F7: 4, F8: 2, F10: 0,
};
const TRANSVERSE_OFFSET = { 1: +1.0, 2: +0.05, 3: -0.05 };
const LONG_Y = {
  F19: { 1: 0.15,  2: -0.15 },
  F18: { 1: 3.0,   2: 1.5 },
  F16: { 1: 6.0,   2: 4.5 },
  F14: { 1: 7.65,  2: 7.35 },
  F11: { 1: 10.5,  2: 9.0 },
  F12: { 1: 13.5,  2: 12.0 },
  F13: { 1: 15.15, 2: 14.85 },
};
// Match build_strain_grids.py: only F12_R2 has no recorded data; F13 and F19
// are partial but useful for the heatmap edge coverage.
const SKIP_ROUTES = new Set(['F12_R2']);

// Convert panel (x, y in metres) -> viewer world (vx, vz). +X viewer = West, +Z = North.
function panelToWorld(x_panel, y_panel) {
  return { vx: 8 - x_panel, vz: -y_panel };
}

function ensureStreaksGroup() {
  if (_streaksGroup) return;
  _streaksGroup = new THREE.Group();
  _streaksGroup.visible = false;
  _scene.add(_streaksGroup);
}

function clearStreaks() {
  if (!_streaksGroup) return;
  while (_streaksGroup.children.length) {
    const obj = _streaksGroup.children.pop();
    obj.geometry?.dispose?.();
    obj.material?.dispose?.();
  }
}

async function buildOneStreak(routeId, layer, loadStage, getXY) {
  const data = await fetchRoute(routeId, layer, loadStage);
  if (!data?.segments?.length) return null;
  const positions = [];
  const colors    = [];
  for (const seg of data.segments) {
    const pos = seg.position;
    const strn = seg.strain_cleaned;
    if (!pos?.length) continue;
    // Sub-sample to keep the geometry small.
    const step = Math.max(1, Math.floor(pos.length / 800));
    for (let i = 0; i < pos.length; i += step) {
      const wp = getXY(pos[i]);
      positions.push(wp.vx, _slabTopY + 0.012, wp.vz);
      const [r, g, b, a] = rwbColor(strn[i], _state.clamp);
      // Vertex colour uses 0..1 range
      colors.push(r / 255, g / 255, b / 255);
    }
  }
  if (!positions.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, linewidth: 1,
  });
  return new THREE.Line(geom, mat);
}

async function applyStreaks() {
  ensureStreaksGroup();
  clearStreaks();

  const want_orient = _state.direction === 'NS' ? 'transverse' : 'longitudinal';
  // Routes to draw:
  const routes = [];
  if (want_orient === 'transverse') {
    for (const fid of Object.keys(FIBRE_TO_X)) {
      for (const r of [1, 2, 3]) {
        const rid = `${fid}_R${r}`;
        if (SKIP_ROUTES.has(rid)) continue;
        const xRoute = FIBRE_TO_X[fid] + TRANSVERSE_OFFSET[r];
        routes.push({ rid,
          getXY: (y_arc) => panelToWorld(xRoute, y_arc) });
      }
    }
  } else {
    for (const fid of Object.keys(LONG_Y)) {
      for (const r of [1, 2]) {
        const rid = `${fid}_R${r}`;
        if (SKIP_ROUTES.has(rid)) continue;
        const yRoute = LONG_Y[fid][r];
        if (yRoute == null) continue;
        routes.push({ rid,
          getXY: (x_arc) => panelToWorld(x_arc, yRoute) });
      }
    }
  }

  await Promise.all(routes.map(async ({ rid, getXY }) => {
    const line = await buildOneStreak(rid, _state.layer, _state.loadStage, getXY);
    if (line) _streaksGroup.add(line);
  }));

  _streaksGroup.visible = _state.visible;
}

function hideStreaks() { if (_streaksGroup) _streaksGroup.visible = false; }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function init(scene, slabTopY, render) {
  _scene = scene;
  _slabTopY = slabTopY;
  _onRender = render;
  ensurePlane();
  ensureStreaksGroup();
}

export async function apply(loadStage, layer, direction, mode, clamp) {
  if (loadStage) _state.loadStage = loadStage;
  if (layer)     _state.layer     = layer;
  if (direction) _state.direction = direction;
  if (mode)      _state.mode      = mode;
  if (clamp != null) _state.clamp = clamp;

  if (!_state.visible) {
    hidePlane(); hideStreaks(); _onRender?.(); return;
  }

  if (_state.mode === 'smooth') {
    hideStreaks();
    await applySmooth();
  } else {
    hidePlane();
    await applyStreaks();
  }
  _onRender?.();
}

export function setVisible(v) {
  _state.visible = !!v;
  if (!v) { hidePlane(); hideStreaks(); }
  else if (_state.mode === 'smooth') { if (_planeMesh) _planeMesh.visible = true; }
  else { if (_streaksGroup) _streaksGroup.visible = true; }
  _onRender?.();
}

// Hide all heatmap meshes without changing the user's visibility intent.
// Called when no load stage is selected (stage = "none") so the heatmap
// shows nothing instead of stale data from a previously-selected stage.
export function clear() {
  hidePlane();
  hideStreaks();
  _onRender?.();
}

export function isVisible() { return _state.visible; }
export function getState()  { return { ..._state }; }
export function getClamp()  { return _state.clamp; }

export async function setClamp(c) {
  if (!Number.isFinite(c) || c <= 0) return;
  _state.clamp = c;
  await apply();
}

// Build a horizontal HTML colorbar element for the legend overlay.
export function buildColorbar(clamp, direction = 'NS') {
  const div = document.createElement('div');
  div.className = 'sh-colorbar';
  const dirLabel = direction === 'NS'
    ? 'ε_yy (N–S strain, from transverse fibres)'
    : 'ε_xx (E–W strain, from longitudinal fibres)';
  div.innerHTML = `
    <div class="sh-cb-bar"></div>
    <div class="sh-cb-ticks">
      <span>${-clamp}</span>
      <span>${-Math.round(clamp/2)}</span>
      <span>0</span>
      <span>+${Math.round(clamp/2)}</span>
      <span>+${clamp}</span>
    </div>
    <div class="sh-cb-label"><strong>${dirLabel}</strong> &nbsp; (με) &nbsp; clamp ±${clamp}, blue = compression, red = tension</div>
  `;
  return div;
}
