import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

const canvas = document.querySelector('#scene');
const resetViewButton = document.querySelector('#resetView');
const sectionViewButton = document.querySelector('#sectionView');
const planViewButton = document.querySelector('#planView');
const toggleSectionButton = document.querySelector('#toggleSection');
const toggleExplodeButton = document.querySelector('#toggleExplode');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1016, 18, 52);
scene.background = new THREE.Color(0x0b1016);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(11.5, 7.8, 11.5);

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
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0.9, 1.1, 0.2);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 7;
controls.maxDistance = 28;

const ambient = new THREE.AmbientLight(0xffffff, 1.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff2d5, 2.8);
keyLight.position.set(9, 12, 8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8ec5ff, 1.15);
fillLight.position.set(-7, 4, -6);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffa06e, 0.95);
rimLight.position.set(0, 2, -10);
scene.add(rimLight);

const root = new THREE.Group();
scene.add(root);

const beamMaterial = new THREE.MeshStandardMaterial({
  color: 0xedc76d,
  metalness: 0.72,
  roughness: 0.28,
});

const slabMaterial = new THREE.MeshStandardMaterial({
  color: 0x90b7d6,
  metalness: 0.15,
  roughness: 0.82,
  transparent: true,
  opacity: 0.9,
});

const columnMaterial = new THREE.MeshStandardMaterial({
  color: 0x80d182,
  metalness: 0.12,
  roughness: 0.65,
});

const sectionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff7b4c,
  transparent: true,
  opacity: 0.32,
  side: THREE.DoubleSide,
});

const lineMaterial = new THREE.LineBasicMaterial({
  color: 0xffb599,
  transparent: true,
  opacity: 0.9,
});

const structure = new THREE.Group();
root.add(structure);

function createLabelSprite(text, textColor = '#f3f1ea', backgroundColor = 'rgba(11,16,22,0.72)') {
  const paddingX = 26;
  const paddingY = 16;
  const fontSize = 34;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
  const textWidth = context.measureText(text).width;
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontSize + paddingY * 2);
  context.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = backgroundColor;
  context.strokeStyle = 'rgba(255,255,255,0.16)';
  context.lineWidth = 4;
  const radius = 22;
  const width = canvas.width;
  const height = canvas.height;
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
  context.fillText(text, width / 2, height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const scaleX = 0.0085 * canvas.width;
  const scaleY = 0.0085 * canvas.height;
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

const beam = new THREE.Group();
beam.position.set(0, 1.8, 0);
structure.add(beam);

const topFlange = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.22, 0.55), beamMaterial);
topFlange.position.y = 0.38;
beam.add(topFlange);

const web = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.05, 0.22), beamMaterial);
beam.add(web);

const bottomFlange = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.22, 0.55), beamMaterial);
bottomFlange.position.y = -0.38;
beam.add(bottomFlange);

const beamOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(7.8, 1.0, 0.6)),
  new THREE.LineBasicMaterial({ color: 0x2b2112, transparent: true, opacity: 0.45 })
);
beamOutline.position.y = 0.02;
beam.add(beamOutline);

const beamLabel = createLabelSprite('W-Beam 600 x 300');
beamLabel.position.set(0, 1.2, 0.55);
beam.add(beamLabel);

const slab = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.48, 2.9), slabMaterial);
slab.position.set(-0.45, 2.55, 0);
structure.add(slab);

const slabEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(8.9, 0.48, 2.9)),
  new THREE.LineBasicMaterial({ color: 0xe6edf7, transparent: true, opacity: 0.28 })
);
slabEdges.position.copy(slab.position);
structure.add(slabEdges);

const slabLabel = createLabelSprite('Deck slab');
slabLabel.position.set(-3.0, 3.05, 0.95);
structure.add(slabLabel);

const column = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.8, 0.55), columnMaterial);
column.position.set(1.8, -0.2, -0.9);
structure.add(column);

const columnLabel = createLabelSprite('HSS Column');
columnLabel.position.set(2.45, 1.0, -0.65);
structure.add(columnLabel);

const columnCap = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.78), beamMaterial);
columnCap.position.set(1.8, 2.18, -0.9);
structure.add(columnCap);

const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.12, 0.82), beamMaterial);
basePlate.position.set(1.8, -2.58, -0.9);
structure.add(basePlate);

const diagonalBrace = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.12, 0.12), sectionMaterial);
diagonalBrace.rotation.z = -0.66;
diagonalBrace.position.set(-1.1, 0.6, 0.55);
structure.add(diagonalBrace);

const braceLabel = createLabelSprite('Section cut');
braceLabel.position.set(-2.4, 0.2, 1.35);
structure.add(braceLabel);

const sectionPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 3.1), sectionMaterial);
sectionPlane.rotation.y = Math.PI / 2;
sectionPlane.position.set(-0.65, 1.05, 0.28);
structure.add(sectionPlane);

const sectionFrame = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(0.08, 2.75, 0.08)),
  new THREE.LineBasicMaterial({ color: 0xff7b4c, transparent: true, opacity: 0.95 })
);
sectionFrame.position.set(-0.65, 1.05, 0.28);
structure.add(sectionFrame);

const sectionLabel = createLabelSprite('A - A');
sectionLabel.position.set(-0.15, 2.35, 0.9);
structure.add(sectionLabel);

const titleBadge = createLabelSprite('STRUCTURAL SECTION VIEW', '#0b1016', 'rgba(237,199,109,0.95)');
titleBadge.position.set(-4.0, 4.7, -2.2);
titleBadge.scale.set(0.26, 0.26, 1);
structure.add(titleBadge);

const secondaryBeam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 0.42), new THREE.MeshStandardMaterial({
  color: 0xcf7a8d,
  metalness: 0.4,
  roughness: 0.45,
}));
secondaryBeam.position.set(2.65, -0.75, 1.0);
structure.add(secondaryBeam);

const secondaryBeamOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(2.5, 0.18, 0.42)),
  new THREE.LineBasicMaterial({ color: 0x311117, transparent: true, opacity: 0.42 })
);
secondaryBeamOutline.position.copy(secondaryBeam.position);
structure.add(secondaryBeamOutline);

const secondaryBeamLabel = createLabelSprite('Secondary beam');
secondaryBeamLabel.position.set(3.05, -0.1, 1.45);
structure.add(secondaryBeamLabel);

const gridGroup = new THREE.Group();
scene.add(gridGroup);

const gridLineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
for (let index = -12; index <= 12; index += 1) {
  const lineX = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(index, -2.8, -8),
    new THREE.Vector3(index, -2.8, 8),
  ]);
  gridGroup.add(new THREE.Line(lineX, gridLineMaterial));

  const lineZ = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-8, -2.8, index),
    new THREE.Vector3(8, -2.8, index),
  ]);
  gridGroup.add(new THREE.Line(lineZ, gridLineMaterial));
}

const annotationGroup = new THREE.Group();
scene.add(annotationGroup);

function addMarker(text, position, scale = 0.18) {
  const marker = createLabelSprite(text, '#dfe8f5', 'rgba(9,13,18,0.56)');
  marker.position.copy(position);
  marker.scale.set(scale, scale, 1);
  annotationGroup.add(marker);
  return marker;
}

for (let index = 1; index <= 8; index += 1) {
  addMarker(String(index), new THREE.Vector3(-6.55 + index * 1.85, -2.25, 3.75), 0.14);
}

for (let index = 1; index <= 6; index += 1) {
  addMarker(String(index), new THREE.Vector3(5.95, -2.25, 5.6 - index * 1.45), 0.14);
}

const northArrow = createLabelSprite('N', '#0b1016', 'rgba(128,209,130,0.96)');
northArrow.position.set(6.4, 3.75, -4.8);
northArrow.scale.set(0.14, 0.14, 1);
annotationGroup.add(northArrow);

const westArrow = createLabelSprite('W', '#0b1016', 'rgba(144,183,214,0.96)');
westArrow.position.set(-6.7, 3.75, -4.8);
westArrow.scale.set(0.14, 0.14, 1);
annotationGroup.add(westArrow);

const sectionGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(4.9, 1.28),
  new THREE.MeshBasicMaterial({
    color: 0xff8d60,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
  })
);
sectionGlow.rotation.y = Math.PI / 2;
sectionGlow.position.set(-0.56, 1.02, 0.28);
structure.add(sectionGlow);

const beamShell = new THREE.Mesh(new THREE.BoxGeometry(7.85, 1.0, 0.58), new THREE.MeshStandardMaterial({
  color: 0x775f2a,
  metalness: 0.1,
  roughness: 0.65,
  transparent: true,
  opacity: 0.08,
}));
beamShell.position.y = 0.02;
beam.add(beamShell);

let sectionVisible = true;
let exploded = false;
const defaultCamera = { position: camera.position.clone(), target: controls.target.clone() };

const cameraPresets = {
  section: {
    position: new THREE.Vector3(11.2, 4.0, 0.8),
    target: new THREE.Vector3(0.2, 1.1, 0.25),
  },
  plan: {
    position: new THREE.Vector3(0.4, 16.4, 0.4),
    target: new THREE.Vector3(0.1, 0.35, 0.2),
  },
};

function setCameraPreset(preset) {
  camera.position.copy(preset.position);
  controls.target.copy(preset.target);
  controls.update();
}

function setExplodedView(nextExploded) {
  exploded = nextExploded;
  const beamOffset = exploded ? 0.62 : 0;
  const slabOffset = exploded ? 0.72 : 0;
  const columnOffset = exploded ? -0.58 : 0;

  beam.position.y = 1.8 + beamOffset;
  slab.position.y = 2.55 + slabOffset;
  slabEdges.position.y = slab.position.y;
  column.position.y = -0.2 + columnOffset;
  columnCap.position.y = 2.18 + beamOffset;
  basePlate.position.y = -2.58 + columnOffset;
  sectionPlane.position.x = -0.65 - (exploded ? 0.18 : 0);
  sectionGlow.position.x = -0.56 - (exploded ? 0.18 : 0);
  sectionFrame.position.x = -0.65 - (exploded ? 0.18 : 0);
  beam.rotation.y = exploded ? 0.06 : 0;
  slab.rotation.y = exploded ? -0.03 : 0;
}

setExplodedView(false);

resetViewButton.addEventListener('click', () => {
  camera.position.copy(defaultCamera.position);
  controls.target.copy(defaultCamera.target);
  controls.update();
});

sectionViewButton.addEventListener('click', () => {
  setCameraPreset(cameraPresets.section);
});

planViewButton.addEventListener('click', () => {
  setCameraPreset(cameraPresets.plan);
});

toggleSectionButton.addEventListener('click', () => {
  sectionVisible = !sectionVisible;
  sectionPlane.visible = sectionVisible;
  sectionGlow.visible = sectionVisible;
  sectionFrame.visible = sectionVisible;
});

toggleExplodeButton.addEventListener('click', () => {
  setExplodedView(!exploded);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

const clock = new THREE.Clock();

function animate() {
  const elapsed = clock.getElapsedTime();
  controls.update();
  root.rotation.y = Math.sin(elapsed * 0.14) * 0.08;
  root.rotation.x = Math.sin(elapsed * 0.08) * 0.01;
  beamLabel.material.rotation = 0;
  sectionPlane.material.opacity = 0.22 + Math.sin(elapsed * 2.1) * 0.045;
  sectionGlow.material.opacity = 0.05 + Math.sin(elapsed * 1.8) * 0.02;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
