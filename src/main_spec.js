import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { showPopup as showStrainPopup } from './strain_popup.js';
import * as strainHeatmap from './strain_heatmap.js';

const canvas = document.querySelector('#scene');
const resetViewButton = document.querySelector('#resetView');
const sectionViewButton = document.querySelector('#sectionView');
const planViewButton = document.querySelector('#planView');
const toggleExplodeButton = document.querySelector('#toggleExplode');
const toggleLabelsButton = document.querySelector('#toggleLabels');
const toggleDFOSButton = document.querySelector('#toggleDFOS');
const stageSelect = document.querySelector('#stageSelect');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 26, 90);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 180);
// Default view (set 2026-04-26): camera positioned to the south-east of the
// panel, elevated, looking NW. From this angle:
//   * North girder line is at the BACK of the view (the panel's north side)
//   * East side of panel is on the screen-right
//   * West side of panel is on the screen-left
//   * Columns extend toward the viewer (south-of-south)
camera.position.set(14, 12, -25);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.target.set(0, 0, -3);  // panel-centre, slightly north of mid so the IBC pile (East stage) sits at upper-right
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 8;
controls.maxDistance = 48;
// --- Panning ---
// Enable pan and put it on the LEFT mouse button when the user holds Shift
// (left-drag normally rotates; left-drag + Shift pans). Right-drag also pans
// by default. Keyboard arrows pan too — useful when there's no right-click.
controls.enablePan = true;
controls.screenSpacePanning = true;     // pan in the screen plane (intuitive)
controls.panSpeed = 1.0;
controls.keyPanSpeed = 12;
controls.listenToKeyEvents(window);     // Arrow keys pan the camera target
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,    // scroll wheel click + drag = pan
  RIGHT:  THREE.MOUSE.PAN,
};
// Shift-modifier pan: while Shift is held, left-drag pans instead of rotates.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
});

const ambient = new THREE.AmbientLight(0xffffff, 1.7);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(18, 22, 14);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdfe9f5, 1.1);
fillLight.position.set(-14, 8, -12);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
rimLight.position.set(-8, 5, 18);
scene.add(rimLight);

const root = new THREE.Group();
scene.add(root);

const layout = {
  baySpan: 7.5,
  width: 16,
  beamSpacing: 2,
  beamCount: 9,
  girderDepth: 0.99,
  girderWidth: 0.3,
  girderWeb: 0.0165,
  girderFlange: 0.031,
  floorDepth: 0.36,
  floorWidth: 0.17,
  floorWeb: 0.008,
  floorFlange: 0.0127,
  columnSize: 0.32,
  columnWall: 0.0125,
  columnHeight: 6.4,
  slabThickness: 0.2,
  toppingThickness: 0.149,
  deckThickness: 0.051,
  deckRibPitch: 0.15,
  studSpacing: 0.15,
};

const spans = {
  northGirderZ: 0,
  centralGirderZ: -layout.baySpan,
  southGirderZ: -layout.baySpan * 2,
  testZoneCenterZ: -layout.baySpan,
  areaACenterZ: -layout.baySpan / 2,
  areaBCenterZ: -layout.baySpan * 1.5,
};

const beamXs = Array.from(
  { length: layout.beamCount },
  (_, index) => layout.width / 2 - index * layout.beamSpacing
);
const columnXs = [-7.2, 7.2];
const southContinuityStubLength = 2.4;
const girderContinuityStubLength = 4.8;
const girderLength = layout.width + girderContinuityStubLength;

const elevations = {
  girderCenterY: 0.15,
};
elevations.girderTopY = elevations.girderCenterY + layout.girderDepth / 2;
elevations.girderBottomY = elevations.girderCenterY - layout.girderDepth / 2;
elevations.floorBeamCenterY = elevations.girderTopY - layout.floorDepth / 2;
elevations.deckCenterY = elevations.girderTopY + layout.deckThickness / 2;
elevations.toppingCenterY = elevations.girderTopY + layout.deckThickness + layout.toppingThickness / 2;

const colors = {
  girder: 0x6f7780,
  girderAccent: 0x4e565f,
  floor: 0x7e8790,
  column: 0x66717b,
  slab: 0xd9d4ca,
  deck: 0xb8c1c8,
  mesh: 0xb86a55,           // legacy (still used as the AK-band base tone)
  akTop: 0xd97a4a,          // AK band top mat (4 Phi12 bars parallel to minor beam, 58 mm depth)
  akBottom: 0x9a4f30,       // AK band bottom mat (45 Phi12 bars perpendicular to minor beam, 70 mm depth)
  ogTop: 0x4caf50,          // Over-girder top mat (4 Phi16 bars parallel to main girder, 94 mm depth) — green theme
  ogBottom: 0x1b5e20,       // Over-girder bottom mat (~80 Phi16 bars perpendicular to main girder, 110 mm depth) — dark green
  section: 0xaeb5bc,
  stud: 0xc8c2b8,
  outline: 0x3f454b,
};

const labelSprites = [];

function createLabelSprite(text, textColor = '#f3f1ea', backgroundColor = 'rgba(11,16,22,0.72)', trackVisibility = true) {
  const paddingX = 24;
  const paddingY = 14;
  const fontSize = 30;
  const tempCanvas = document.createElement('canvas');
  const tempContext = tempCanvas.getContext('2d');
  tempContext.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
  const textWidth = tempContext.measureText(text).width;
  tempCanvas.width = Math.ceil(textWidth + paddingX * 2);
  tempCanvas.height = Math.ceil(fontSize + paddingY * 2);

  const context = tempCanvas.getContext('2d');
  context.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = backgroundColor;
  context.strokeStyle = 'rgba(255,255,255,0.16)';
  context.lineWidth = 3;
  const width = tempCanvas.width;
  const height = tempCanvas.height;
  const radius = 18;
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(width, 0, width, height, radius);
  context.arcTo(width, height, 0, height, radius);
  context.arcTo(0, height, 0, 0, radius);
  context.arcTo(0, 0, width, 0, radius);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = textColor;
  context.fillText(text, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(tempCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
  );
  sprite.scale.set(0.009 * width, 0.009 * height, 1);
  if (trackVisibility) {
    labelSprites.push(sprite);
  }
  return sprite;
}

function createISection({ length, depth, flangeWidth, webThickness, flangeThickness, color }) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.3,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: colors.girderAccent,
    metalness: 0.15,
    roughness: 0.65,
  });

  const topFlange = new THREE.Mesh(new THREE.BoxGeometry(flangeWidth, flangeThickness, length), material);
  topFlange.position.y = depth / 2 - flangeThickness / 2;
  group.add(topFlange);

  const bottomFlange = new THREE.Mesh(new THREE.BoxGeometry(flangeWidth, flangeThickness, length), material);
  bottomFlange.position.y = -(depth / 2 - flangeThickness / 2);
  group.add(bottomFlange);

  const web = new THREE.Mesh(new THREE.BoxGeometry(webThickness, depth - 2 * flangeThickness, length), accentMaterial);
  group.add(web);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(flangeWidth, depth, length)),
    new THREE.LineBasicMaterial({ color: 0x24190f, transparent: true, opacity: 0.28 })
  );
  group.add(outline);

  return group;
}

function setGroupOpacity(group, opacity) {
  group.traverse((child) => {
    if (!child.material) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const transparentMaterials = materials.map((material) => {
      const clone = material.clone();
      clone.transparent = true;
      clone.opacity = opacity;
      clone.depthWrite = opacity > 0.4;
      return clone;
    });

    child.material = Array.isArray(child.material) ? transparentMaterials : transparentMaterials[0];
  });
  return group;
}

function createColumn({ height }) {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.BoxGeometry(layout.columnSize, height, layout.columnSize),
    new THREE.MeshStandardMaterial({
      color: colors.column,
      metalness: 0.15,
      roughness: 0.62,
    })
  );
  group.add(outer);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(layout.columnSize, height, layout.columnSize)),
    new THREE.LineBasicMaterial({ color: 0x184a1d, transparent: true, opacity: 0.42 })
  );
  group.add(outline);
  return group;
}

function createStud() {
  const geometry = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 10);
  const material = new THREE.MeshStandardMaterial({
    color: colors.stud,
    metalness: 0.85,
    roughness: 0.25,
  });
  return new THREE.Mesh(geometry, material);
}

function createStudInstances({ length, rows, y, alongStartOffset = 0 }) {
  const firstAlong = -length / 2 + alongStartOffset;
  const lastAlong = length / 2 - alongStartOffset;
  const countPerRow = Math.floor((lastAlong - firstAlong) / layout.studSpacing + 1e-6) + 1;
  const totalCount = countPerRow * rows.length;
  const geometry = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 10);
  const material = new THREE.MeshStandardMaterial({
    color: colors.stud,
    metalness: 0.85,
    roughness: 0.25,
  });
  const studs = new THREE.InstancedMesh(geometry, material, totalCount);
  const dummy = new THREE.Object3D();
  let instanceIndex = 0;

  rows.forEach((rowX) => {
    for (let index = 0; index < countPerRow; index += 1) {
      const alongLength = firstAlong + index * layout.studSpacing;
      dummy.position.set(rowX, y, Math.min(alongLength, lastAlong));
      dummy.updateMatrix();
      studs.setMatrixAt(instanceIndex, dummy.matrix);
      instanceIndex += 1;
    }
  });

  return studs;
}

function createFloorBeam({ x, z, beamLabel }) {
  const group = createISection({
    length: layout.baySpan,
    depth: layout.floorDepth,
    flangeWidth: layout.floorWidth,
    webThickness: layout.floorWeb,
    flangeThickness: layout.floorFlange,
    color: colors.floor,
  });
  group.rotation.y = 0;
  group.position.set(x, elevations.floorBeamCenterY, z);

  const label = createLabelSprite(`${beamLabel} | IPE 360`);
  label.position.set(0, 0.6, 0.1);
  group.add(label);

  group.add(createStudInstances({
    length: layout.baySpan,
    rows: [0],
    y: layout.floorDepth / 2 + 0.05,
    alongStartOffset: layout.deckRibPitch / 2,
  }));
  return group;
}

function createGirder({ z, labelText }) {
  const girder = createISection({
    length: girderLength,
    depth: layout.girderDepth,
    flangeWidth: layout.girderWidth,
    webThickness: layout.girderWeb,
    flangeThickness: layout.girderFlange,
    color: colors.girder,
  });
  girder.rotation.y = Math.PI / 2;
  girder.position.set(0, elevations.girderCenterY, z);

  girder.add(createStudInstances({
    length: layout.width,
    rows: [-layout.deckRibPitch / 2, layout.deckRibPitch / 2],
    y: layout.girderDepth / 2 + 0.055,
  }));

  const label = createLabelSprite(`${labelText} | HEA 1000`);
  label.position.set(0.1, 0.95, -7.8);
  girder.add(label);

  return girder;
}

function createSlab() {
  const slabGroup = new THREE.Group();

  const topping = new THREE.Mesh(
    new THREE.BoxGeometry(layout.width, layout.toppingThickness, layout.baySpan * 2 + 1e-3),
    new THREE.MeshStandardMaterial({
      color: colors.slab,
      transparent: true,
      opacity: 0.46,
      roughness: 0.82,
      metalness: 0.08,
      depthWrite: false,
    })
  );
  topping.position.set(0, elevations.toppingCenterY, spans.testZoneCenterZ);
  topping.renderOrder = 3;
  slabGroup.add(topping);

  const deckSheetThickness = 0.012;
  const ribHeight = layout.deckThickness - deckSheetThickness - 0.004;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(layout.width, deckSheetThickness, layout.baySpan * 2 + 1e-3),
    new THREE.MeshStandardMaterial({
      color: colors.deck,
      transparent: true,
      opacity: 0.48,
      roughness: 0.54,
      metalness: 0.55,
      depthWrite: false,
    })
  );
  deck.position.set(0, elevations.girderTopY + deckSheetThickness / 2, spans.testZoneCenterZ);
  deck.renderOrder = 1;
  slabGroup.add(deck);

  const deckRibs = new THREE.Group();
  const ribCount = Math.floor((layout.baySpan * 2) / layout.deckRibPitch);
  for (let index = 0; index <= ribCount; index += 1) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(layout.width, ribHeight, 0.045),
      new THREE.MeshStandardMaterial({
        color: 0x9eabb4,
        transparent: true,
        opacity: 0.5,
        roughness: 0.48,
        metalness: 0.58,
        depthWrite: false,
      })
    );
    rib.position.set(
      0,
      elevations.girderTopY + deckSheetThickness + 0.002 + ribHeight / 2,
      spans.southGirderZ + index * layout.deckRibPitch
    );
    rib.renderOrder = 1;
    deckRibs.add(rib);
  }
  slabGroup.add(deckRibs);

  // AK bands — Area A only (one per minor beam line).
  slabGroup.add(createAKBands());
  // Over-girder bands — both bays, all three main girder lines (structure-wide).
  slabGroup.add(createOverGirderBands());

  const slabLabel = createLabelSprite('SHR 51/150 deck + 149 mm topping');
  slabLabel.position.set(-6.8, elevations.toppingCenterY + 0.55, 1.1);
  slabGroup.add(slabLabel);

  return slabGroup;
}

// =====================================================================
// SUPPLEMENTAL REINFORCEMENT
// =====================================================================
// Two distinct reinforcement systems are present in the slab. Both are
// rendered against the as-built drawings per the 2026-04-25 corrections:
//
//   (1) AK band over each minor beam — Area A only
//       Drawing detail "AK", per docs/decisions.md 2026-04-25 (v4).
//       9 bands per bay, centred on minor-beam lines I1..I8/I10 at 2 m c/c.
//       Each band: 1000 mm wide N-S, ~6.6 m long along the minor-beam axis.
//       Top mat:    4 Phi12 bars at 150 mm c/c, parallel to minor beam (N-S),
//                   centroid 58 mm below top of slab.
//       Bottom mat: 45 Phi12 bars at 150 mm c/c, perpendicular to minor beam (E-W),
//                   each 1000 mm long, centroid 70 mm below top of slab.
//       Mats touch (centroid-to-centroid 12 mm = Phi12).
//
//   (2) Over-girder band on each main girder — BOTH bays (structure-wide)
//       Per docs/decisions.md 2026-04-25 (v3).
//       3 bands centred on the North, Central, and South girders.
//       Each band: 1300 mm wide N-S, 16 m long E-W (full slab E-W extent).
//       Top mat:    4 Phi16 bars at 200 mm c/c, parallel to main girder (E-W),
//                   each 16 m long, centroid 94 mm below top of slab.
//       Bottom mat: ~80 Phi16 bars at 200 mm c/c, perpendicular to main girder (N-S),
//                   each 1300 mm long, centroid 110 mm below top of slab.
//       Mats touch (centroid-to-centroid 16 mm = Phi16).
// =====================================================================

const slabTopY = elevations.girderTopY + layout.deckThickness + layout.toppingThickness;

// Visual-clarity bar radii. Actual Phi12 / Phi16 (6 mm / 8 mm) would be
// barely visible at the viewer's scale; we keep proportional sizes for
// visual distinction while preserving the count, spacing, and orientation.
const RADIUS_PHI12 = 0.012;
const RADIUS_PHI16 = 0.016;

function createBarMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.55,
    roughness: 0.4,
  });
}

// AK band over a single minor beam in Area A.
// xCenter is the E-W coordinate of the minor beam line.
//
// NOTE on N-S extents (user clarification 2026-04-26):
//  * The TOP mat (4 Phi12 bars parallel to the minor beam) runs continuously
//    along the minor-beam line through BOTH bays — Area A and Area B —
//    serving as continuity reinforcement across the central girder. Each
//    top bar therefore spans the full ~15 m N-S panel extent.
//  * The BOTTOM mat (45 Phi12 perpendicular bars, each 1000 mm long) is
//    localised over the Area A minor-beam line only, at 150 mm c/c covering
//    ~6.6 m of the 7.5 m Area A bay. Area B has no equivalent bottom mat.
function createAKBand(xCenter) {
  const group = new THREE.Group();

  const bandWidthEW = 1.0;          // 1000 mm wide footprint (E-W), centred on the minor-beam line

  // ---- TOP MAT: 4 Phi12 parallel to minor beam, spanning BOTH bays ----
  // Each bar runs the full N-S extent of the panel (north girder to south girder),
  // ≈ 15 m, providing continuity reinforcement across the central girder line.
  // 4 bars at 150 c/c span 3*150 = 450 mm in the E-W direction, centred in the
  // 1000 mm band (275 mm edge cover on each side).
  const topY = slabTopY - 0.058;          // centroid 58 mm below top of slab
  const topBarLength = spans.northGirderZ - spans.southGirderZ;  // = 2 * baySpan = 15 m
  const topBarCenterZ = (spans.northGirderZ + spans.southGirderZ) / 2;  // = -7.5 (central girder line)
  const topGeom = new THREE.CylinderGeometry(RADIUS_PHI12, RADIUS_PHI12, topBarLength, 10);
  const topMat = createBarMaterial(colors.akTop);
  const topInst = new THREE.InstancedMesh(topGeom, topMat, 4);
  const topDummy = new THREE.Object3D();
  topDummy.rotation.x = Math.PI / 2;       // rotate cylinder so its axis lies along Z (N-S)
  for (let i = 0; i < 4; i += 1) {
    const x = xCenter - bandWidthEW / 2 + 0.275 + i * 0.150;
    topDummy.position.set(x, topY, topBarCenterZ);
    topDummy.updateMatrix();
    topInst.setMatrixAt(i, topDummy.matrix);
  }
  group.add(topInst);

  // ---- BOTTOM MAT: 45 Phi12 perpendicular to minor beam, Area A only ----
  // Each bar spans the band width (1000 mm) in the X direction.
  // 45 bars at 150 c/c span 44*150 = 6600 mm in the N-S direction, centred on
  // the Area A bay mid-line (areaACenterZ = -baySpan/2 = -3.75 m).
  const bandLengthNS_bottom = 6.6;
  const bandCenterZ_bottom = spans.areaACenterZ;
  const bottomY = slabTopY - 0.070;        // centroid 70 mm below top of slab (touches top mat)
  const bottomBarLength = bandWidthEW;
  const bottomGeom = new THREE.CylinderGeometry(RADIUS_PHI12, RADIUS_PHI12, bottomBarLength, 10);
  const bottomMat = createBarMaterial(colors.akBottom);
  const bottomCount = 45;
  const bottomInst = new THREE.InstancedMesh(bottomGeom, bottomMat, bottomCount);
  const bottomDummy = new THREE.Object3D();
  bottomDummy.rotation.z = Math.PI / 2;    // rotate cylinder so its axis lies along X (E-W)
  for (let i = 0; i < bottomCount; i += 1) {
    const z = bandCenterZ_bottom - bandLengthNS_bottom / 2 + (i + 0.5) * (bandLengthNS_bottom / bottomCount);
    bottomDummy.position.set(xCenter, bottomY, z);
    bottomDummy.updateMatrix();
    bottomInst.setMatrixAt(i, bottomDummy.matrix);
  }
  group.add(bottomInst);

  return group;
}

// All AK bands for Area A (north bay only).
function createAKBands() {
  const group = new THREE.Group();
  group.name = 'akBandsGroup';
  // One band per minor beam line; reuses beamXs (9 entries: I1..I8 + I10).
  beamXs.forEach((x) => {
    group.add(createAKBand(x));
  });
  return group;
}

// Over-girder band on a single main girder line (zCenter).
// Applies in both bays since the slab is continuous and this rebar serves
// the slab hogging moment over the girder, regardless of bay.
//
// edgeTrim (optional): when set to "north", only the SOUTH HALF of the band
// is rendered, because the slab terminates at the North Girder centerline
// (the building ends there) and rebar would otherwise extend into mid-air.
// Per user 2026-04-26 (v7):
//   - Bottom mat (R/3) bar length is halved (1300 -> 650 mm), positioned
//     entirely south of zCenter
//   - Top mat (R/4) keeps only the 2 bars whose centroids fall south of
//     zCenter (i.e., on the slab side, "in Area A")
function createOverGirderBand(zCenter, edgeTrim = null) {
  const group = new THREE.Group();

  // Band footprint (full): 1300 mm N-S (transverse to girder), 16 m E-W (full slab).
  const bandWidthNS = 1.3;
  const bandLengthEW = layout.width;
  const trimNorthHalf = edgeTrim === 'north';

  // ---- TOP MAT: R/4, 4 Phi16 parallel to main girder, 16 m long ----
  // Default: 4 bars at z = zC + 0.30, +0.10, -0.10, -0.30 (chain 350/200/200/200/350).
  // North-edge trim: keep only the 2 bars at -0.10 and -0.30 (south of centerline).
  const topY = slabTopY - 0.094;
  const topBarLength = bandLengthEW;
  const topGeom = new THREE.CylinderGeometry(RADIUS_PHI16, RADIUS_PHI16, topBarLength, 10);
  const topMat = createBarMaterial(colors.ogTop);
  const topOffsets = trimNorthHalf
    ? [-0.30, -0.10]                  // 2 bars on the slab side only (Area A side)
    : [-0.30, -0.10, +0.10, +0.30];  // full 4 bars centred on the girder line
  const topInst = new THREE.InstancedMesh(topGeom, topMat, topOffsets.length);
  const topDummy = new THREE.Object3D();
  topDummy.rotation.z = Math.PI / 2;
  topOffsets.forEach((dz, i) => {
    topDummy.position.set(0, topY, zCenter + dz);
    topDummy.updateMatrix();
    topInst.setMatrixAt(i, topDummy.matrix);
  });
  group.add(topInst);

  // ---- BOTTOM MAT: R/3, ~80 Phi16 perpendicular to girder ----
  // Default: each bar 1300 mm long, centred on zCenter (z = zC - 0.65 to zC + 0.65).
  // North-edge trim: each bar 650 mm long, positioned south of zCenter
  //   (z = zC - 0.65 to zC), so the bars stop at the slab edge.
  const bottomY = slabTopY - 0.110;
  const bottomBarLength = trimNorthHalf ? bandWidthNS / 2 : bandWidthNS;  // 650 mm or 1300 mm
  const bottomBarCenterZ = trimNorthHalf
    ? zCenter - bandWidthNS / 4   // midpoint of (zCenter - 0.65, zCenter)
    : zCenter;
  const bottomGeom = new THREE.CylinderGeometry(RADIUS_PHI16, RADIUS_PHI16, bottomBarLength, 10);
  const bottomMat = createBarMaterial(colors.ogBottom);
  const bottomSpacingEW = 0.200;
  const bottomCount = Math.floor(bandLengthEW / bottomSpacingEW); // = 80
  const bottomInst = new THREE.InstancedMesh(bottomGeom, bottomMat, bottomCount);
  const bottomDummy = new THREE.Object3D();
  bottomDummy.rotation.x = Math.PI / 2;
  for (let i = 0; i < bottomCount; i += 1) {
    const x = -bandLengthEW / 2 + (i + 0.5) * bottomSpacingEW;
    bottomDummy.position.set(x, bottomY, bottomBarCenterZ);
    bottomDummy.updateMatrix();
    bottomInst.setMatrixAt(i, bottomDummy.matrix);
  }
  group.add(bottomInst);

  return group;
}

// All three over-girder bands (North, Central, South).
// The North Girder band is edge-trimmed because the slab terminates at the
// girder centerline (the building ends there) — see v7 note above.
function createOverGirderBands() {
  const group = new THREE.Group();
  group.name = 'overGirderBandsGroup';
  group.add(createOverGirderBand(spans.northGirderZ, 'north'));   // edge-trimmed
  group.add(createOverGirderBand(spans.centralGirderZ));          // full band
  group.add(createOverGirderBand(spans.southGirderZ));            // full band
  return group;
}

// =====================================================================
// LOAD PATCH VISUALIZATION (IBC water tanks)
// =====================================================================
// Per user 2026-04-26:
//   * Each stage = a 6 m wide (E-W) x 15 m tall (N-S) UDL patch at 10 kN/m^2
//   * Three discrete positions per batch: East, Middle, West
//   * The east-most stage is shifted 1 m east of the panel's east edge,
//     so only 5 m of the 6 m width sits inside the test panel; the
//     remaining 1 m hangs past the east edge into the rest of the building.
//
// The actual loading was applied with IBC (Intermediate Bulk Container)
// water tanks tiled across each 6 x 15 m patch. Each tank is roughly
// 1.0 m (E-W) x 1.2 m (N-S) x 1.16 m (tall) and holds 1000 L = 1 t of
// water. Six columns x twelve rows = 72 tanks per stage covers the
// 6 x 15 m patch (with ~12 cm slack in the N-S direction).
// =====================================================================

const IBC_TANK_EW = 1.00;   // tank width (E-W) in metres
const IBC_TANK_NS = 1.20;   // tank length (N-S) in metres
const IBC_TANK_H  = 1.16;   // tank height in metres
const IBC_PALLET_H = 0.14;  // wooden pallet beneath each tank
const IBC_CORNER_R = 0.08;  // corner-rounding radius for the plastic body

// Build a "rounded prism" geometry: a rectangular plate (W x D) with rounded
// vertical corners (radius r), extruded H tall. Output is centred at origin
// with the height along the +Y axis.
function createRoundedTankBodyGeometry(w, d, h, r) {
  const shape = new THREE.Shape();
  const x0 = -w / 2;
  const z0 = -d / 2;
  const radius = Math.min(r, w / 2, d / 2);
  shape.moveTo(x0 + radius, z0);
  shape.lineTo(x0 + w - radius, z0);
  shape.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + radius);
  shape.lineTo(x0 + w, z0 + d - radius);
  shape.quadraticCurveTo(x0 + w, z0 + d, x0 + w - radius, z0 + d);
  shape.lineTo(x0 + radius, z0 + d);
  shape.quadraticCurveTo(x0, z0 + d, x0, z0 + d - radius);
  shape.lineTo(x0, z0 + radius);
  shape.quadraticCurveTo(x0, z0, x0 + radius, z0);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: false,
    curveSegments: 4,
  });
  // Extrude is along +Z by default. Re-orient so height is along +Y, then
  // centre vertically.
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, -h / 2, 0);
  return geom;
}

function createIBCTankGrid(westEdgeX, southEdgeZ, label, color) {
  const group = new THREE.Group();
  const patchWidthEW = 6.0;
  const patchHeightNS = 15.0;

  // Number of tanks along each axis (round down to fit footprint)
  const nE = Math.floor(patchWidthEW / IBC_TANK_EW);   // = 6
  const nN = Math.floor(patchHeightNS / IBC_TANK_NS);  // = 12
  const total = nE * nN;

  // OUTER SHELL — rounded vertical-corner plastic body, very translucent so
  // the inner water level and the slab/rebar underneath remain visible.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xeef3f6,
    metalness: 0.0,
    roughness: 0.55,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const bodyGeom = createRoundedTankBodyGeometry(
    IBC_TANK_EW * 0.94,
    IBC_TANK_NS * 0.94,
    IBC_TANK_H,
    IBC_CORNER_R
  );
  const bodyInst = new THREE.InstancedMesh(bodyGeom, bodyMat, total);

  // WATER FILL — slightly smaller rounded prism inside the shell, filled to
  // ~95% of the tank height. More opaque, distinctly blue so the water is
  // visible through the translucent plastic.
  const waterFillFraction = 0.95;
  const waterHeight = IBC_TANK_H * waterFillFraction;
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x4ea3d6,
    metalness: 0.05,
    roughness: 0.35,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const waterGeom = createRoundedTankBodyGeometry(
    IBC_TANK_EW * 0.90,
    IBC_TANK_NS * 0.90,
    waterHeight,
    IBC_CORNER_R * 0.85
  );
  const waterInst = new THREE.InstancedMesh(waterGeom, waterMat, total);

  // Pallet InstancedMesh (wooden brown base) — translucent so the testing
  // area / rebar / DFOS lines underneath remain visible from a plan view.
  const palletMat = new THREE.MeshStandardMaterial({
    color: 0x8b6e4c,
    metalness: 0.0,
    roughness: 0.85,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
  });
  const palletWidth = IBC_TANK_EW * 1.02;
  const palletDepth = IBC_TANK_NS * 1.02;
  const palletGeom = new THREE.BoxGeometry(palletWidth, IBC_PALLET_H, palletDepth);
  const palletInst = new THREE.InstancedMesh(palletGeom, palletMat, total);

  // Tank cage wireframe — sharp-edged dark grey box outline around each tank body.
  const cageGeom = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(IBC_TANK_EW, IBC_TANK_H, IBC_TANK_NS)
  );
  const cageMat = new THREE.LineBasicMaterial({
    color: 0x3a3a3a,
    transparent: true,
    opacity: 0.8,
  });

  const slabSurfaceY = slabTopY;
  const palletCenterY = slabSurfaceY + IBC_PALLET_H / 2;
  const tankCenterY = slabSurfaceY + IBC_PALLET_H + IBC_TANK_H / 2;
  // Water sits at the bottom of the tank, filling 95% of internal height.
  // Tank inner-bottom is at slabSurfaceY + IBC_PALLET_H; water centroid is
  // half its own height above that.
  const waterCenterY = slabSurfaceY + IBC_PALLET_H + waterHeight / 2;

  // Centre the tank grid inside the patch in both E-W and N-S so the
  // grid centroid lands on the patch centroid (which sits on the central
  // girder centerline at z = -7.5). This matters when the tank-grid total
  // doesn't exactly fill the patch (12 x 1.2 = 14.4 m vs 15 m N-S leaves
  // 0.6 m of slack; the slack is split as 0.3 m at each end).
  const tankGridSpanEW = nE * IBC_TANK_EW;
  const tankGridSpanNS = nN * IBC_TANK_NS;
  const gridStartX = westEdgeX + (patchWidthEW - tankGridSpanEW) / 2;
  const gridStartZ = southEdgeZ + (patchHeightNS - tankGridSpanNS) / 2;

  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let i = 0; i < nE; i += 1) {
    for (let j = 0; j < nN; j += 1) {
      const x = gridStartX + (i + 0.5) * IBC_TANK_EW;
      const z = gridStartZ + (j + 0.5) * IBC_TANK_NS;

      // Pallet
      dummy.position.set(x, palletCenterY, z);
      dummy.updateMatrix();
      palletInst.setMatrixAt(idx, dummy.matrix);

      // Tank body (outer shell)
      dummy.position.set(x, tankCenterY, z);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(idx, dummy.matrix);

      // Water inside the tank
      dummy.position.set(x, waterCenterY, z);
      dummy.updateMatrix();
      waterInst.setMatrixAt(idx, dummy.matrix);

      // Tank cage wireframe (one LineSegments per cell, non-instanced)
      const cageLines = new THREE.LineSegments(cageGeom, cageMat);
      cageLines.position.set(x, tankCenterY, z);
      group.add(cageLines);

      idx += 1;
    }
  }

  group.add(palletInst);
  group.add(waterInst);   // water added before shell so depth-sorting reads inner -> outer
  group.add(bodyInst);

  // Outline rectangle on the slab surface so the patch boundary (including
  // the 1 m overhang) is unambiguous in plan view. Black outline regardless
  // of stage colour — the legend labels distinguish East / Middle / West.
  const patchEastEdge = westEdgeX + patchWidthEW;
  const patchNorthEdge = southEdgeZ + patchHeightNS;
  const yOnSlab = slabSurfaceY + 0.005;
  const outlineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95 });
  const outlinePoints = [
    new THREE.Vector3(westEdgeX,     yOnSlab, southEdgeZ),
    new THREE.Vector3(patchEastEdge, yOnSlab, southEdgeZ),
    new THREE.Vector3(patchEastEdge, yOnSlab, patchNorthEdge),
    new THREE.Vector3(westEdgeX,     yOnSlab, patchNorthEdge),
    new THREE.Vector3(westEdgeX,     yOnSlab, southEdgeZ),
  ];
  const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePoints);
  group.add(new THREE.Line(outlineGeom, outlineMat));

  // Label sprite floating above the patch centre
  const cx = westEdgeX + patchWidthEW / 2;
  const cz = southEdgeZ + patchHeightNS / 2;
  const sprite = createLabelSprite(`${label}  (10 kN/m², 6 × 15 m)`, '#0b1016',
    `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},0.95)`);
  sprite.position.set(cx, slabSurfaceY + IBC_PALLET_H + IBC_TANK_H + 0.9, cz);
  sprite.scale.set(0.22, 0.22, 1);
  group.add(sprite);

  return group;
}

const loadStageColors = {
  east:   0xf2c037,   // gold
  middle: 0xe87a3a,   // orange
  west:   0xd9485a,   // red
};

function createLoadStages() {
  // Returns an object with east/middle/west groups, each independently
  // toggleable via .visible. The cycle button shows one at a time.
  const stages = {};
  const patchSouthZ = (spans.northGirderZ + spans.southGirderZ) / 2 - 15 / 2;  // = -15

  // Load Stage 1 = East = Batches 1 + 4 (per docs/decisions.md v12, 2026-04-26).
  // Confirmed: 1 m east overhang past the panel east edge.
  // Patch east edge at x = +9 (panel east edge = +8); patch west edge at x = +3.
  // Coordinate-convention bridge: viewer uses +X = West, so the EAST patch's
  // smallest-X corner is on the east side at viewer x = -(layout.width/2 + 1)
  // = -9 (panel east edge -8 plus 1 m east overhang). Tanks extend +6 m in the
  // +X direction (= westward), ending at viewer x = -3. Same swap applies to
  // the West patch below (started at viewer x = +3, ends at +9).
  const eastPatchStartX = -(layout.width / 2 + 1);  // = -9
  stages.east = createIBCTankGrid(eastPatchStartX, patchSouthZ, 'Load Stage 1 (East), Batches 1 and 4', loadStageColors.east);

  // Load Stage 3 = Middle = Batches 3 + 6 (per docs/decisions.md v12, 2026-04-26).
  // Centred on panel. Patch east edge at x = +3, west edge at x = -3.
  stages.middle = createIBCTankGrid(-3, patchSouthZ, 'Load Stage 3 (Middle), Batches 3 and 6', loadStageColors.middle);

  // Load Stage 2 = West = Batches 2 + 5 (per docs/decisions.md v12, 2026-04-26).
  // Mirror of East. Patch west edge at x = -9, east edge at x = -3.
  stages.west = createIBCTankGrid(+3, patchSouthZ, 'Load Stage 2 (West), Batches 2 and 5', loadStageColors.west);

  return stages;
}

// =====================================================================
// COMPASS — north arrow indicator above the slab so "north side" is
// unambiguous regardless of camera orientation.
// =====================================================================
function createCompass() {
  const group = new THREE.Group();
  const arrowY = slabTopY + 1.2;
  const arrowX = -layout.width / 2 - 1.5;          // off the slab to the west
  const arrowTipZ = spans.northGirderZ + 1.2;       // points further north than the panel
  const arrowTailZ = spans.northGirderZ - 1.2;

  // Shaft (line from tail to tip)
  const shaftMat = new THREE.LineBasicMaterial({ color: 0x222222, transparent: false });
  const shaftPts = [
    new THREE.Vector3(arrowX, arrowY, arrowTailZ),
    new THREE.Vector3(arrowX, arrowY, arrowTipZ),
  ];
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(shaftPts), shaftMat));

  // Arrowhead — small triangle pointing toward +Z (north)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xc0392b });
  const headGeom = new THREE.ConeGeometry(0.32, 0.7, 12);
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.set(arrowX, arrowY, arrowTipZ + 0.35);
  head.rotation.x = -Math.PI / 2;   // cone tip pointing along +Z
  group.add(head);

  // "N" label sprite at the arrow tip
  const nLabel = createLabelSprite('N', '#0b1016', 'rgba(192,57,43,0.95)');
  nLabel.position.set(arrowX, arrowY + 0.7, arrowTipZ + 0.6);
  nLabel.scale.set(0.20, 0.20, 1);
  group.add(nLabel);

  return group;
}

// =====================================================================
// DFOS FIBRE OVERLAY
// =====================================================================
// Per specs/fiber_layout.md (v9 / v10 corrections):
//
//   TRANSVERSE fibres (run S↔N along each minor-beam line)
//     F1 at I2 (2 m from east edge)
//     F2 at I3 (4 m)
//     F3 at I4 (6 m)
//     F4 at I5 (8 m, panel centre) — F4_2 used in batches 3, 6
//     F5 at I6 (10 m)
//     F7 at I7 (12 m) — F6 broken
//     F8 at I8 (14 m)
//     F10 at I10 (16 m, west edge) — F9 broken; I9 also skipped
//
//   LONGITUDINAL fibres (run E↔W at fixed N–S coord)
//     F19 at Y = 15 m (north-girder line)
//     F18 at Y = 12.5 m (Area A)
//     F16 at Y = 10 m (Area A)
//     F15 excluded (position not located)
//     F14 at Y = 7.5 m (central-girder line)
//     F11 at Y = 5 m (Area B)
//     F12 at Y = 2.5 m (Area B; only first half functional)
//     F13 at Y = 0 m (south-girder line)
//
// Each fibre runs in TWO layers (~15 mm vertical separation in reality).
// For the viewer, the layers are exaggerated (~70 mm apart) so they're
// visually distinguishable.
// =====================================================================

const DFOS_FIBRE_BOTTOM_Y = slabTopY - 0.16;   // near slab bottom (deck-fibre side)
const DFOS_FIBRE_TOP_Y    = slabTopY - 0.04;   // near slab top
const DFOS_INSET_FROM_GIRDER = 0.12;           // pull line back a bit from the girder so it's not buried in the steel

const dfosColors = {
  // All DFOS fibres rendered in black to look like steel rods (per user 2026-04-26).
  // Top vs bottom layer is still distinguished by Y (vertical position in slab),
  // so the colours don't need to differ.
  transverseTop:       0x111111,   // near-black (top layer)
  transverseBottom:    0x000000,   // pure black (bottom layer)
  longitudinalTop:     0x111111,   // near-black
  longitudinalBottom:  0x000000,   // pure black
};

// DFOS fibre rendered as a thin cylinder so it has real visible thickness.
// (WebGL ignores LineBasicMaterial.linewidth on most drivers, so a Line was
//  rendering as a 1-px hairline — invisible against the slab.)
const DFOS_FIBRE_RADIUS = 0.018;   // 36 mm visual diameter — easy to see, still thinner than Phi12 rebar
function createDFOSFibre(p1, p2, color) {
  const direction = new THREE.Vector3().subVectors(p2, p1);
  const length = direction.length();
  const geom = new THREE.CylinderGeometry(DFOS_FIBRE_RADIUS, DFOS_FIBRE_RADIUS, length, 10);
  const mat  = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(p1).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return mesh;
}

// Per-fibre pivot data (sourced verbatim from Starter Tools/Fiber_Coor.m and
// the Per-fibre path interpretation tables in specs/fiber_layout.md).
// Each pass = sum of its two consecutive segments (one per bay) — see the
// "F1 path interpretation" section of fiber_layout.md for why a pass = 2 segs.
//
// passLengths order: [P1 BotEast, P2 BotMid, P3 BotWest, P4 TopWest, P5 TopMid, P6 TopEast]
const TRANSVERSE_FIBRE_PIVOTS = {
  F1:  { x: +6, leadIn: 1.74, totalLength: 94.27, passLengths: [14.61, 14.67, 14.63, 14.34, 14.64, 14.61] },
  F2:  { x: +4, leadIn: 4.03, totalLength: 95.57, passLengths: [14.64, 14.43, 14.39, 14.44, 14.41, 14.66] },
  F3:  { x: +2, leadIn: 2.97, totalLength: 96.16, passLengths: [14.69, 14.63, 14.63, 14.66, 14.62, 14.65] },
  F4:  { x:  0, leadIn: 3.12, totalLength: 94.95, passLengths: [14.67, 14.16, 14.33, 14.24, 14.27, 14.66] },
  F5:  { x: -2, leadIn: 2.54, totalLength: 96.27, passLengths: [14.65, 14.65, 14.63, 14.64, 14.66, 14.63] },
  F7:  { x: -4, leadIn: 3.36, totalLength: 95.39, passLengths: [14.68, 14.42, 14.41, 15.25, 14.44, 14.62] },
  F8:  { x: -6, leadIn: 2.50, totalLength: 96.30, passLengths: [14.66, 14.64, 14.63, 14.66, 14.66, 14.61] },
  F10: { x: -8, leadIn: 3.50, totalLength: 93.80, passLengths: [14.62, 13.02, 13.00, 12.85, 12.76, 14.71] },
};

// Pass configuration: layer + sub-row offset (E–W in metres) + colour token.
//
// Per user 2026-04-26 (final, confirmed):
//
//   Route 1: +1.000 m east of the fibre's I-line centerline → sits in the
//            bay between this I-line and the next I-line east. For F1 (at I2),
//            Route 1 is at x = +7, exactly 1 m west of I1. NO Route lands at
//            any I-line position; nothing is rendered AT I1.
//   Route 2: +50 mm east of I-line centerline → over the beam, east side.
//   Route 3: −50 mm west of I-line centerline → over the beam, west side.
//            Routes 2 and 3 are 100 mm apart, both over the IPE 360 top flange
//            (170 mm wide). They give two redundant readings of slab strain
//            over the minor beam (local hogging zone).
const PASS_CONFIG = [
  { idx: 0, route: 1, layer: 'bottom', subRowOffset: +1.0,  colorKey: 'transverseBottom' },  // P1 Bot Route 1 (in-bay, +1 m east of I-line)
  { idx: 1, route: 2, layer: 'bottom', subRowOffset: +0.05, colorKey: 'transverseBottom' },  // P2 Bot Route 2 (over beam, east side, +50 mm)
  { idx: 2, route: 3, layer: 'bottom', subRowOffset: -0.05, colorKey: 'transverseBottom' },  // P3 Bot Route 3 (over beam, west side, −50 mm)
  { idx: 3, route: 3, layer: 'top',    subRowOffset: -0.05, colorKey: 'transverseTop' },     // P4 Top Route 3
  { idx: 4, route: 2, layer: 'top',    subRowOffset: +0.05, colorKey: 'transverseTop' },     // P5 Top Route 2
  { idx: 5, route: 1, layer: 'top',    subRowOffset: +1.0,  colorKey: 'transverseTop' },     // P6 Top Route 1
];

function createDFOSFibresGroup() {
  const group = new THREE.Group();
  const transverseGroup = new THREE.Group();
  transverseGroup.name = 'dfosTransverseGroup';
  const longitudinalGroup = new THREE.Group();
  longitudinalGroup.name = 'dfosLongitudinalGroup';
  group.add(transverseGroup, longitudinalGroup);

  // TRANSVERSE fibres — each fibre lives entirely within its ONE I-line column.
  // Per spec/fiber_layout.md interpretation B (user-confirmed 2026-04-26):
  //   * Each fibre has 12 segments organised as 3 sub-rows × 2 layers × 2 bays.
  //   * Each sub-row has 2 segments end-to-end forming a full N–S "pass".
  //   * Pass length = sum of two consecutive segments from the per-fibre pivot
  //     table; the line length therefore varies fibre-to-fibre and pass-to-pass
  //     (e.g., F10 has noticeably shorter middle passes 13.0 m vs 14.6 m,
  //     and F7 pass 4 has a long segment 7 anomaly making the pass 15.25 m).
  //   * Each pass is rendered centred on the central girder line (z = −7.5),
  //     so a shorter pass leaves visible gaps at the north and south girders.
  const panelCenterZ = (spans.northGirderZ + spans.southGirderZ) / 2;  // = −7.5
  const yByLayer = {
    bottom: DFOS_FIBRE_BOTTOM_Y,
    top:    DFOS_FIBRE_TOP_Y,
  };

  // Coordinate-convention bridge:
  //   TRANSVERSE_FIBRE_PIVOTS uses MATLAB convention (+X = East), so F1 = +6,
  //   F10 = -8. The viewer's beamXs uses (+X = West), with I1 (East) at -8 and
  //   I10 (West) at +8. Negate fibre.x AND the sub-row offset together so that
  //   "+1 m east of the I-line" in the spec lands 1 m east of the same I-line
  //   in the viewer (i.e. toward the I-line one number lower).
  Object.entries(TRANSVERSE_FIBRE_PIVOTS).forEach(([fibreName, fibre]) => {
    let labelAnchor = null;
    PASS_CONFIG.forEach((cfg) => {
      const passLen = fibre.passLengths[cfg.idx];
      const xPos = -(fibre.x + cfg.subRowOffset);
      const yPos = yByLayer[cfg.layer];
      // Centre the pass on the panel-centre z (which sits on the central girder).
      const zStart = panelCenterZ - passLen / 2;
      const zEnd   = panelCenterZ + passLen / 2;
      const colour = dfosColors[cfg.colorKey];
      const fibreMesh = createDFOSFibre(
        new THREE.Vector3(xPos, yPos, zStart),
        new THREE.Vector3(xPos, yPos, zEnd),
        colour,
      );
      fibreMesh.userData = {
        route_id:    `${fibreName}_R${cfg.route}`,
        fibre_id:    fibreName,
        route:       cfg.route,
        layer:       cfg.layer === 'bottom' ? 'BOT' : 'TOP',
        orientation: 'transverse',
      };
      transverseGroup.add(fibreMesh);
      // Capture the south end of the bottom Route 2 pass (over the I-line) as
      // the anchor for this fibre's label.
      if (cfg.idx === 1) {
        labelAnchor = new THREE.Vector3(xPos, yPos, zStart - 0.6);
      }
    });
    if (labelAnchor) {
      const sprite = createLabelSprite(fibreName, '#f3f1ea', 'rgba(11,16,22,0.78)');
      sprite.position.copy(labelAnchor);
      transverseGroup.add(sprite);
    }
  });

  // Longitudinal fibres run from west panel edge (x = -8) to east panel edge (x = +8).
  // Per Fiber_Coor_batch4.m + user 2026-04-26:
  //   F11/F16/F18 each carry 4 segments → 2 routes per layer (outbound + return).
  //   F12 carries only 2 segments (half-working) → 1 route per layer.
  //   F13/F14/F19 placeholder — single route at the noted z (no user spec yet).
  // Route z-positions (user 2026-04-26):
  //   Area A (north bay) — y measured north of CENTRAL girder (z = -7.5):
  //     F18 — Route 1 z = -3.0  (4.5 m N), Route 2 z = -1.5 (6.0 m N)
  //     F16 — Route 1 z = -6.0  (1.5 m N), Route 2 z = -4.5 (3.0 m N)
  //   Area B (south bay) — y measured north of SOUTH girder (z = -15):
  //     F11 — Route 1 z = -10.5 (4.5 m N of S girder), Route 2 z = -9.0  (6.0 m N)
  //     F12 — Route 1 z = -13.5 (1.5 m N of S girder), Route 2 z = -12.0 (3.0 m N)
  //   F12 is half-working in data (only segs 1-2 per Gregor 2026-04-22) but both
  //   physical routes are rendered.
  const centralGirderZ = -7.5;
  const southGirderZ   = -15;
  const longitudinalDefs = [
    { name: 'F19', routes: [
        { z: -0.15 },                  // Route 1 East→West: 0.15 m S of north girder (z = 0)
        { z: +0.15 },                  // Route 2 West→East: 0.15 m N of north girder
    ] },
    { name: 'F18', routes: [
        { z: centralGirderZ + 4.5 },  // Route 1 East→West: segs 1 (bot) + 2 (top)
        { z: centralGirderZ + 6.0 },  // Route 2 West→East: segs 3 (top) + 4 (bot)
    ] },
    { name: 'F16', routes: [
        { z: centralGirderZ + 1.5 },  // Route 1 East→West: segs 1 (bot) + 2 (top)
        { z: centralGirderZ + 3.0 },  // Route 2 West→East: segs 3 (top) + 4 (bot)
    ] },
    { name: 'F14', routes: [
        { z: centralGirderZ - 0.15 },  // Route 1 East→West: 0.15 m S of central girder (z = -7.65)
        { z: centralGirderZ + 0.15 },  // Route 2 West→East: 0.15 m N of central girder (z = -7.35)
    ] },
    { name: 'F11', routes: [
        { z: southGirderZ + 4.5 },    // Route 1 East→West: segs 1 (bot) + 2 (top)
        { z: southGirderZ + 6.0 },    // Route 2 West→East: segs 3 (top) + 4 (bot)
    ] },
    { name: 'F12', routes: [
        { z: southGirderZ + 1.5 },    // Route 1 East→West: segs 1 (bot) + 2 (top, half-working)
        { z: southGirderZ + 3.0 },    // Route 2 West→East: physical route present
    ] },
    { name: 'F13', routes: [
        { z: southGirderZ - 0.15 },    // Route 1 East→West: 0.15 m S of south girder (z = -15.15)
        { z: southGirderZ + 0.15 },    // Route 2 West→East: 0.15 m N of south girder (z = -14.85)
    ] },
  ];
  const xWest = -layout.width / 2 + DFOS_INSET_FROM_GIRDER;   // -8 + 0.12
  const xEast =  layout.width / 2 - DFOS_INSET_FROM_GIRDER;   // +8 - 0.12

  longitudinalDefs.forEach(({ name, routes }) => {
    routes.forEach(({ z }, routeIdx) => {
      const routeNumber = routeIdx + 1;
      // Bottom layer
      const botMesh = createDFOSFibre(
        new THREE.Vector3(xWest, DFOS_FIBRE_BOTTOM_Y, z),
        new THREE.Vector3(xEast, DFOS_FIBRE_BOTTOM_Y, z),
        dfosColors.longitudinalBottom,
      );
      botMesh.userData = {
        route_id:    `${name}_R${routeNumber}`,
        fibre_id:    name,
        route:       routeNumber,
        layer:       'BOT',
        orientation: 'longitudinal',
      };
      longitudinalGroup.add(botMesh);
      // Top layer (slight z-offset so it's visible alongside the bottom layer)
      const topMesh = createDFOSFibre(
        new THREE.Vector3(xWest, DFOS_FIBRE_TOP_Y, z + 0.05),
        new THREE.Vector3(xEast, DFOS_FIBRE_TOP_Y, z + 0.05),
        dfosColors.longitudinalTop,
      );
      topMesh.userData = {
        route_id:    `${name}_R${routeNumber}`,
        fibre_id:    name,
        route:       routeNumber,
        layer:       'TOP',
        orientation: 'longitudinal',
      };
      longitudinalGroup.add(topMesh);
    });
    // One label per fibre at the west end of route 1.
    const sprite = createLabelSprite(name, '#f3f1ea', 'rgba(11,16,22,0.78)');
    sprite.position.set(xWest - 0.6, DFOS_FIBRE_BOTTOM_Y, routes[0].z);
    longitudinalGroup.add(sprite);
  });

  return group;
}

function createContinuityCues() {
  const group = new THREE.Group();

  beamXs.forEach((x) => {
    const southStub = createISection({
      length: southContinuityStubLength,
      depth: layout.floorDepth,
      flangeWidth: layout.floorWidth,
      webThickness: layout.floorWeb,
      flangeThickness: layout.floorFlange,
      color: colors.floor,
    });
    southStub.position.set(x, elevations.floorBeamCenterY, spans.southGirderZ - southContinuityStubLength / 2);
    group.add(setGroupOpacity(southStub, 0.32));
  });

  return group;
}

function createGrid() {
  const group = new THREE.Group();
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8fa0ad, transparent: true, opacity: 0.18 });
  const zeroLineMaterial = new THREE.LineBasicMaterial({ color: 0x5f6c76, transparent: true, opacity: 0.32 });
  const gridY = elevations.girderBottomY - layout.columnHeight - 0.02;
  const xStart = -layout.width / 2;
  const xEnd = layout.width / 2;
  const zStart = spans.northGirderZ;
  const zEnd = spans.southGirderZ;

  for (let offset = 0; offset <= layout.width; offset += 1) {
    const x = xStart + offset;
    const lineX = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, gridY, zStart),
      new THREE.Vector3(x, gridY, zEnd),
    ]);
    group.add(new THREE.Line(lineX, Math.abs(x - xStart) < 1e-6 ? zeroLineMaterial : lineMaterial));
  }

  for (let offset = 0; offset <= layout.baySpan * 2; offset += 1) {
    const z = zStart - offset;
    const lineZ = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xStart, gridY, z),
      new THREE.Vector3(xEnd, gridY, z),
    ]);
    group.add(new THREE.Line(lineZ, Math.abs(z - zStart) < 1e-6 ? zeroLineMaterial : lineMaterial));
  }
  return group;
}

function createColumnGrid() {
  const group = new THREE.Group();
  const columnRows = [
    { z: spans.northGirderZ, xs: columnXs },
    { z: spans.centralGirderZ, xs: columnXs },
    { z: spans.southGirderZ, xs: columnXs },
  ];

  columnRows.forEach(({ z, xs }) => {
    xs.forEach((x) => {
      const column = createColumn({ height: layout.columnHeight });
      column.position.set(x, elevations.girderBottomY - 3.2, z);
      group.add(column);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.12, 0.42),
        new THREE.MeshStandardMaterial({
          color: colors.girder,
          metalness: 0.72,
          roughness: 0.28,
        })
      );
      cap.position.set(x, elevations.girderBottomY + 0.06, z);
      group.add(cap);
    });
  });

  const label = createLabelSprite('HF SHS 320 x 320 x 12.5 columns');
  label.position.set(-7.7, 3.0, spans.southGirderZ + 1.2);
  group.add(label);

  return group;
}

function createFloorBeamLabels() {
  const group = new THREE.Group();
  const labels = ['I10', 'I8', 'I7', 'I6', 'I5', 'I4', 'I3', 'I2', 'I1'];
  labels.forEach((labelText, index) => {
    const label = createLabelSprite(labelText, '#0b1016', 'rgba(237,199,109,0.95)');
    label.scale.set(0.13, 0.13, 1);
    label.position.set(beamXs[index], 1.2, -0.35);
    group.add(label);
  });
  return group;
}

const structure = new THREE.Group();
root.add(structure);

const northGirder = createGirder({ z: spans.northGirderZ, labelText: 'North Girder' });
const centralGirder = createGirder({ z: spans.centralGirderZ, labelText: 'Central Girder' });
const southGirder = createGirder({ z: spans.southGirderZ, labelText: 'South Girder' });
structure.add(northGirder, centralGirder, southGirder);

const slab = createSlab();
structure.add(slab);

const continuityCues = createContinuityCues();
structure.add(continuityCues);

const northBayBeams = new THREE.Group();
const southBayBeams = new THREE.Group();

// Primekss minor-beam labelling: I1 (East), I2, I3, I4, I5, I6, I7, I8, I10 (West).
// I9 is intentionally skipped per the Primekss bar-schedule convention (user 2026-04-25 v5).
// beamXs[0] is at world +X = westmost in the current camera view, beamXs[8] is at world -X = eastmost.
const beamLabelByIndex = ['I10', 'I8', 'I7', 'I6', 'I5', 'I4', 'I3', 'I2', 'I1'];
beamXs.forEach((x, index) => {
  const labelText = beamLabelByIndex[index];
  northBayBeams.add(createFloorBeam({ x, z: spans.areaACenterZ, beamLabel: labelText }));
  southBayBeams.add(createFloorBeam({ x, z: spans.areaBCenterZ, beamLabel: labelText }));
});
structure.add(northBayBeams, southBayBeams);

const titleBadge = createLabelSprite('NORTH BAY / CENTRAL / SOUTH BAY', '#17212b', 'rgba(255,255,255,0.9)');
titleBadge.position.set(-7.8, 5.0, -2.4);
titleBadge.scale.set(0.22, 0.22, 1);
structure.add(titleBadge);

const columnGrid = createColumnGrid();
structure.add(columnGrid);

// Load-patch overlay rendered as IBC water tanks (1 m x 1.2 m x 1.16 m, ~1 t each).
// Three independent groups (East / Middle / West) corresponding to the three
// load positions in the campaign per docs/decisions.md v9: B1+B4 East,
// B2+B5 West, B3+B6 Middle. Only one is visible at a time; the user picks
// via the "Load position" dropdown. Default = East (matches the dropdown).
const loadStages = createLoadStages();
loadStages.east.visible = true;
loadStages.middle.visible = false;
loadStages.west.visible = false;
structure.add(loadStages.east);
structure.add(loadStages.middle);
structure.add(loadStages.west);

// DFOS fibre overlay (visible by default; toggleable via "Show / Hide DFOS" button)
const dfosFibres = createDFOSFibresGroup();
structure.add(dfosFibres);

const grid = createGrid();
scene.add(grid);

let exploded = false;
let labelsVisible = false;
labelSprites.forEach((label) => {
  label.visible = labelsVisible;
});
const defaultCamera = {
  position: camera.position.clone(),
  target: controls.target.clone(),
  up: camera.up.clone(),
  maxPolarAngle: controls.maxPolarAngle,
};

const cameraPresets = {
  section: {
    position: new THREE.Vector3(16, 7.5, 1.5),
    target: new THREE.Vector3(0, 0.8, -7.5),
    up: new THREE.Vector3(0, 1, 0),
    maxPolarAngle: Math.PI * 0.49,
  },
  plan: {
    position: new THREE.Vector3(0, 24, -7.5),
    target: new THREE.Vector3(0, 0, -7.5),
    up: new THREE.Vector3(0, 0, 1),
    maxPolarAngle: Math.PI,
  },
};

function setCameraPreset(preset) {
  camera.up.copy(preset.up);
  controls.maxPolarAngle = preset.maxPolarAngle;
  camera.position.copy(preset.position);
  controls.target.copy(preset.target);
  camera.lookAt(preset.target);
  controls.update();
  render();
}

function setExplodedView(nextExploded) {
  exploded = nextExploded;
  const girderShift = exploded ? 0.45 : 0;
  const beamShift = exploded ? 0.3 : 0;
  const slabShift = exploded ? 0.65 : 0;
  const columnShift = exploded ? -0.3 : 0;

  northGirder.position.y = elevations.girderCenterY + girderShift;
  centralGirder.position.y = elevations.girderCenterY + girderShift;
  southGirder.position.y = elevations.girderCenterY + girderShift;

  northBayBeams.position.y = beamShift;
  southBayBeams.position.y = beamShift;

  slab.position.y = slabShift;
  columnGrid.position.y = columnShift;
  continuityCues.position.y = exploded ? beamShift : 0;
}

setExplodedView(false);

resetViewButton.addEventListener('click', () => {
  camera.up.copy(defaultCamera.up);
  controls.maxPolarAngle = defaultCamera.maxPolarAngle;
  camera.position.copy(defaultCamera.position);
  controls.target.copy(defaultCamera.target);
  camera.lookAt(defaultCamera.target);
  controls.update();
  render();
});

sectionViewButton.addEventListener('click', () => {
  setCameraPreset(cameraPresets.section);
});

planViewButton.addEventListener('click', () => {
  setCameraPreset(cameraPresets.plan);
});

toggleExplodeButton.addEventListener('click', () => {
  setExplodedView(!exploded);
  render();
});

toggleLabelsButton.addEventListener('click', () => {
  labelsVisible = !labelsVisible;
  labelSprites.forEach((label) => {
    label.visible = labelsVisible;
  });
  toggleLabelsButton.textContent = labelsVisible ? 'Hide labels' : 'Show labels';
  render();
});

// DFOS fibre overlay toggles — master + per-orientation.
const dfosTransverseGroup = dfosFibres.getObjectByName('dfosTransverseGroup');
const dfosLongitudinalGroup = dfosFibres.getObjectByName('dfosLongitudinalGroup');
const toggleDFOSTransverseButton = document.querySelector('#toggleDFOSTransverse');
const toggleDFOSLongitudinalButton = document.querySelector('#toggleDFOSLongitudinal');
let dfosVisible = true;
let dfosTransverseVisible = true;
let dfosLongitudinalVisible = true;
toggleDFOSButton.addEventListener('click', () => {
  dfosVisible = !dfosVisible;
  dfosFibres.visible = dfosVisible;
  toggleDFOSButton.textContent = dfosVisible ? 'Hide DFOS (all)' : 'Show DFOS (all)';
  render();
});
toggleDFOSTransverseButton.addEventListener('click', () => {
  dfosTransverseVisible = !dfosTransverseVisible;
  dfosTransverseGroup.visible = dfosTransverseVisible;
  toggleDFOSTransverseButton.textContent = dfosTransverseVisible ? 'Hide DFOS transverse' : 'Show DFOS transverse';
  render();
});
toggleDFOSLongitudinalButton.addEventListener('click', () => {
  dfosLongitudinalVisible = !dfosLongitudinalVisible;
  dfosLongitudinalGroup.visible = dfosLongitudinalVisible;
  toggleDFOSLongitudinalButton.textContent = dfosLongitudinalVisible ? 'Hide DFOS longitudinal' : 'Show DFOS longitudinal';
  render();
});

// Supplementary rebar toggles — AK bands (over minor beams) and over-girder bands.
const akBandsGroup = slab.getObjectByName('akBandsGroup');
const overGirderBandsGroup = slab.getObjectByName('overGirderBandsGroup');
const toggleAKBandsButton = document.querySelector('#toggleAKBands');
const toggleOverGirderBandsButton = document.querySelector('#toggleOverGirderBands');
let akBandsVisible = true;
let overGirderBandsVisible = true;
toggleAKBandsButton.addEventListener('click', () => {
  akBandsVisible = !akBandsVisible;
  akBandsGroup.visible = akBandsVisible;
  toggleAKBandsButton.textContent = akBandsVisible ? 'Hide AK rebar' : 'Show AK rebar';
  render();
});
toggleOverGirderBandsButton.addEventListener('click', () => {
  overGirderBandsVisible = !overGirderBandsVisible;
  overGirderBandsGroup.visible = overGirderBandsVisible;
  toggleOverGirderBandsButton.textContent = overGirderBandsVisible ? 'Hide over-girder rebar' : 'Show over-girder rebar';
  render();
});

// Load-stage dropdown: choose East / Middle / West / None.
// Independent toggle for the IBC water-tank meshes — lets the user hide the
// tanks while keeping the Load stage dropdown active (so the heatmap still
// updates) and seeing the strain gradient unobstructed.
let _tanksHidden = false;

function applyStage(stage) {
  loadStages.east.visible   = !_tanksHidden && stage === 'east';
  loadStages.middle.visible = !_tanksHidden && stage === 'middle';
  loadStages.west.visible   = !_tanksHidden && stage === 'west';
  // Update the 2D strain heatmap to match (no-op when heatmap is hidden).
  if (typeof strainHeatmap !== 'undefined' && strainHeatmap.isVisible?.()) {
    const ls = { east: 'LS1_East', west: 'LS2_West', middle: 'LS3_Middle' }[stage];
    if (!ls) {
      // Stage = "None" — clear the heatmap so it doesn't show stale data.
      strainHeatmap.clear();
    } else {
      strainHeatmap.apply(
        ls,
        document.querySelector('#heatmapLayer')?.value || 'BOT',
        document.querySelector('#heatmapDir')?.value   || 'NS',
        document.querySelector('#heatmapMode')?.value  || 'smooth',
      );
    }
  }
  render();
}
applyStage(stageSelect.value);
stageSelect.addEventListener('change', (event) => {
  applyStage(event.target.value);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  render();
});

function render() {
  renderer.render(scene, camera);
}

controls.addEventListener('change', render);
render();

// ============ Phase 3b — 2D strain heatmap on slab top ============
strainHeatmap.init(scene, slabTopY, render);

// Hide / show the IBC water tanks independently of the Load stage dropdown.
const toggleTanksButton = document.querySelector('#toggleTanks');
toggleTanksButton.addEventListener('click', () => {
  _tanksHidden = !_tanksHidden;
  toggleTanksButton.textContent = _tanksHidden ? 'Show water tanks' : 'Hide water tanks';
  applyStage(stageSelect.value);
});

const toggleHeatmapButton = document.querySelector('#toggleHeatmap');
const heatmapLayerCtl     = document.querySelector('#heatmapLayerCtl');
const heatmapLayerSelect  = document.querySelector('#heatmapLayer');
const heatmapDirCtl       = document.querySelector('#heatmapDirCtl');
const heatmapDirSelect    = document.querySelector('#heatmapDir');
const heatmapModeCtl      = document.querySelector('#heatmapModeCtl');
const heatmapModeSelect   = document.querySelector('#heatmapMode');
const heatmapClampCtl     = document.querySelector('#heatmapClampCtl');
const heatmapClampInput   = document.querySelector('#heatmapClamp');
const _STAGE_TO_LS_HM = { east: 'LS1_East', west: 'LS2_West', middle: 'LS3_Middle' };

function applyHeatmapForCurrentStage() {
  const ls = _STAGE_TO_LS_HM[stageSelect.value];
  if (!ls) {
    // Stage = "None" — nothing to paint.
    strainHeatmap.clear();
    return;
  }
  strainHeatmap.apply(
    ls,
    heatmapLayerSelect.value,
    heatmapDirSelect.value,
    heatmapModeSelect.value,
  );
}

function rebuildColorbar() {
  const c   = strainHeatmap.getClamp();
  const dir = heatmapDirSelect.value;
  const fresh = strainHeatmap.buildColorbar(c, dir);
  fresh.style.display = strainHeatmap.isVisible() ? '' : 'none';
  heatmapColorbar.replaceWith(fresh);
  heatmapColorbar = fresh;
}

const heatmapCtls = [heatmapLayerCtl, heatmapDirCtl, heatmapModeCtl, heatmapClampCtl];

toggleHeatmapButton.addEventListener('click', () => {
  const newVisible = !strainHeatmap.isVisible();
  strainHeatmap.setVisible(newVisible);
  toggleHeatmapButton.textContent = newVisible ? 'Hide 2D strain heatmap' : 'Show 2D strain heatmap';
  for (const c of heatmapCtls) c.style.display = newVisible ? '' : 'none';
  heatmapColorbar.style.display = newVisible ? '' : 'none';
  if (newVisible) applyHeatmapForCurrentStage();
});
heatmapLayerSelect.addEventListener('change', () => {
  if (strainHeatmap.isVisible()) applyHeatmapForCurrentStage();
});
heatmapDirSelect.addEventListener('change', () => {
  rebuildColorbar();
  if (strainHeatmap.isVisible()) applyHeatmapForCurrentStage();
});
heatmapModeSelect.addEventListener('change', () => {
  if (strainHeatmap.isVisible()) applyHeatmapForCurrentStage();
});
heatmapClampInput.addEventListener('change', () => {
  const c = Number(heatmapClampInput.value);
  if (!Number.isFinite(c) || c <= 0) return;
  strainHeatmap.setClamp(c);
  rebuildColorbar();
});

// Colorbar overlay (bottom-right of the canvas).
let heatmapColorbar = strainHeatmap.buildColorbar(strainHeatmap.getClamp(), 'NS');
heatmapColorbar.style.display = 'none';
document.body.appendChild(heatmapColorbar);

// ============ Phase 1b — click DFOS route to open strain popup ============
const _raycaster = new THREE.Raycaster();
const _pointer   = new THREE.Vector2();
const STAGE_TO_LS = { east: 'LS1_East', west: 'LS2_West', middle: 'LS3_Middle' };

// Differentiate click from drag (OrbitControls steals pointerdown for camera).
let _pressX = 0, _pressY = 0, _pressed = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  _pressX = e.clientX; _pressY = e.clientY; _pressed = true;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_pressed) return;
  _pressed = false;
  const dx = Math.abs(e.clientX - _pressX);
  const dy = Math.abs(e.clientY - _pressY);
  if (dx + dy > 4) return; // treat as drag, not click
  if (!dfosFibres.visible) return;

  const rect = renderer.domElement.getBoundingClientRect();
  _pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  _pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointer, camera);
  const hits = _raycaster.intersectObjects(dfosFibres.children, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData?.route_id) obj = obj.parent;
    if (obj?.userData?.route_id) {
      const ls = STAGE_TO_LS[stageSelect.value] ?? 'LS1_East';
      showStrainPopup({
        routeId:   obj.userData.route_id,
        fibreId:   obj.userData.fibre_id,
        loadStage: ls,
      });
      return;
    }
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dfosFibres.visible) {
    renderer.domElement.style.cursor = 'default';
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  _pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  _pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointer, camera);
  const hits = _raycaster.intersectObjects(dfosFibres.children, true);
  let onRoute = false;
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData?.route_id) obj = obj.parent;
    if (obj?.userData?.route_id) { onRoute = true; break; }
  }
  renderer.domElement.style.cursor = onRoute ? 'pointer' : 'default';
});
