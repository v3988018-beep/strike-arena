// полный адрес вместо import map — старые iPhone (до iOS 16.4) import map не понимают и игра не запускалась
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ================== НАСТРОЙКИ ==================
const WEAPONS = {
  // pen — сколько метров стены/бетона пробивает пуля (только углы и кромки)
  rifle:  { name: 'AKR', mag: 30, reserve: 90, rate: 100, auto: true,  reload: 2.2, spread: 0.010, recoil: 0.013, range: 250, pen: 0.45 },
  awp:    { name: 'AWP', mag: 5,  reserve: 30, rate: 1450, auto: false, reload: 3.4, spread: 0.0015, recoil: 0.07, range: 300, pen: 0.8,
            scopedOnly: true },  // без прицела (ПКМ) пули летят куда попало
  pistol: { name: 'USP', mag: 12, reserve: 36, rate: 160, auto: false, reload: 1.6, spread: 0.006, recoil: 0.022, range: 150, pen: 0.25 },
  deagle: { name: 'Desert Eagle', mag: 7, reserve: 35, rate: 260, auto: false, reload: 2.1, spread: 0.007, recoil: 0.055, range: 200, pen: 0.35 },
  m4:     { name: 'M4', mag: 30, reserve: 90, rate: 90, auto: true, reload: 2.6, spread: 0.008, recoil: 0.011, range: 250, pen: 0.4 },
  smg:    { name: 'MP5', mag: 30, reserve: 120, rate: 75, auto: true, reload: 2.3, spread: 0.012, recoil: 0.008, range: 120, pen: 0.2 },
  // дробовик: за выстрел 8 дробин с широким разбросом, бьёт только вблизи
  shotgun: { name: 'Nova', mag: 8, reserve: 32, rate: 900, auto: false, reload: 3.2, spread: 0.004, recoil: 0.06, range: 45, pen: 0.1,
             pellets: 8, pelletSpread: 0.055 },
};
const PRIMARY = ['rifle', 'm4', 'awp', 'smg', 'shotgun'];    // основное оружие (слот 1)
const GUN_LIST = [...PRIMARY, 'pistol', 'deagle'];
const NADE_KINDS = ['he', 'flash', 'smoke'];
const NADE_NAME = { he: 'Осколочная', flash: 'Флешка', smoke: 'Дымовая' };
const isNade = w => NADE_KINDS.includes(w);
const RUN_SPEED = 6.2, WALK_SPEED = 3.0, JUMP_SPEED = 7, GRAVITY = 20;
// Множители из правил игры (в лобби 1 на 1 их задаёт хозяин), сервер присылает их при входе
let rules = { speed: 1, jump: 1, gravity: 1 };
const EYE = 1.6, HEIGHT = 1.8, RADIUS = 0.35, STEP = 0.55;
const CROUCH_EYE = 1.15, CROUCH_HEIGHT = 1.35, CROUCH_SPEED = 2.4;
// плавное значение приседа 0..1 → высота глаз / роста
const eyeAt = c => EYE - (EYE - CROUCH_EYE) * c;
const heightAt = c => HEIGHT - (HEIGHT - CROUCH_HEIGHT) * c;
const SENS = 0.0022;

// Настройки игрока (окно «Настройки»), хранятся в браузере
const OPT_DEFAULT = {
  volume: 70, shotVolume: 100,                    // звук, %
  quality: 'high', fov: 75, showFps: false,       // графика
  sens: 1, adsSens: 0.6, invertY: false,          // управление
  leftHand: false,                                // оружие в левой руке (клавиша H)
  xhColor: '#3cff6e', xhSize: 8,                  // прицел
};
const opt = { ...OPT_DEFAULT };
// Телефон/планшет (палец вместо мыши) — экранное управление. ?touch в адресе включает его и на компьютере (для проверки)
const touchMode = location.search.includes('touch') || matchMedia('(pointer: coarse)').matches;
let touchMove = null;   // джойстик: { x, y } от -1 до 1 (y < 0 — вперёд)
// Ключ владельца для читов на сервере в интернете: один раз открыть адрес с ?owner=КЛЮЧ — дальше браузер его помнит.
// Сразу убираем ключ из адресной строки, чтобы он не попал в скриншот или в ссылку, которой делишься
let ownerKey = '';
try {
  // в адресе «+» читается как пробел, а ключ от Render содержит «+» — возвращаем его на место
  const k = (new URLSearchParams(location.search).get('owner') || '').trim().replace(/ /g, '+');
  if (k) {
    localStorage.setItem('sa_owner', k);
    const u = new URL(location.href); u.searchParams.delete('owner'); history.replaceState(null, '', u);
  }
  ownerKey = localStorage.getItem('sa_owner') || '';
} catch {}
// на iPhone нет ни захвата мыши, ни полного экрана — пустые заглушки, чтобы вызовы не роняли игру
if (!document.exitPointerLock) document.exitPointerLock = () => {};
if (!document.exitFullscreen) document.exitFullscreen = () => Promise.resolve();
try {
  const saved = localStorage.getItem('sa_options');
  if (touchMode && !saved) Object.assign(opt, { quality: 'low', sens: 1.4 });  // на телефоне по умолчанию — быстрее и отзывчивее
  Object.assign(opt, JSON.parse(saved || '{}'));
} catch {}

// Карты лежат в maps/*.json — их же читает сервер (для ботов и точек возрождения).
// Каждый ящик: [x, z, ширина, глубина, высота, материал, (высота основания)]
const MAP_LIST = await (await fetch('maps/index.json', { cache: 'no-store' })).json();  // [{ id, name, desc }]
let currentMapId = null;
let SITES = {};  // точки закладки бомбы текущей карты: { A: [x, z, радиус], B: ... }
const TEAM_COLOR = { ct: 0x3a78dc, t: 0xdc8c28 };
const TEAM_NAME = { ct: 'Спецназ', t: 'Террористы' };

// ================== СЦЕНА ==================
const renderer = new THREE.WebGLRenderer({ antialias: !touchMode, powerPreference: 'high-performance' });  // на телефоне сглаживание слишком дорогое
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
window.__log?.('3D запущен (WebGL ок)');
// телефон может отобрать у страницы видеокарту (нехватка памяти) — тогда экран чёрный
renderer.domElement.addEventListener('webglcontextlost', () => window.__log?.('WebGL ПОТЕРЯН — телефону не хватило памяти?'));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.fog = new THREE.Fog(0x9fc4e8, 60, 140);

const camera = new THREE.PerspectiveCamera(opt.fov, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 140 });
scene.add(sun);

// Качество графики: чёткость картинки (pixel ratio) и тени
const QUALITY = {
  low:    { ratio: 0.75, shadows: false, map: 512,  info: 'Без теней и чуть размытее — максимум FPS на слабом компьютере.' },
  medium: { ratio: 1,    shadows: true,  map: 1024, info: 'Тени попроще, обычная чёткость.' },
  high:   { ratio: Math.min(devicePixelRatio, 2), shadows: true, map: 2048, info: 'Чёткие тени и максимальная чёткость картинки.' },
};
function applyGraphics() {
  const q = QUALITY[opt.quality] || QUALITY.high;
  renderer.setPixelRatio(q.ratio);
  renderer.setSize(innerWidth, innerHeight);
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    // материалы надо пересобрать, чтобы они начали/перестали учитывать тени
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  if (sun.shadow.mapSize.x !== q.map) {
    sun.shadow.mapSize.set(q.map, q.map);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
}

// Процедурные текстуры (без внешних файлов)
function makeTexture(base, line, noise) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * noise})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Материалы карт
const TEX = {
  wall: makeTexture('#d2bb8e', 'rgba(120,95,60,.35)', 0.08),       // песчаник
  concrete: makeTexture('#a3a19c', 'rgba(60,60,60,.35)', 0.1),
  crate: makeTexture('#9a7444', 'rgba(60,35,10,.8)', 0.12),         // ящик (простреливается)
  metal: makeTexture('#7d8a96', 'rgba(30,40,50,.5)', 0.08),
  rack: makeTexture('#56626e', 'rgba(15,20,25,.8)', 0.1),            // стеллажи склада
  container: makeTexture('#2f5f9e', 'rgba(0,0,0,.45)', 0.1),
  container2: makeTexture('#9e3b2f', 'rgba(0,0,0,.45)', 0.1),
  brick: makeTexture('#8e4b3a', 'rgba(40,15,10,.55)', 0.12),
  stone: makeTexture('#8d8a84', 'rgba(50,50,50,.4)', 0.14),
  wood: makeTexture('#7a5530', 'rgba(40,20,5,.6)', 0.12),
  roof: makeTexture('#4b3226', 'rgba(20,10,5,.6)', 0.1),
  hay: makeTexture('#d8b55a', 'rgba(140,100,30,.5)', 0.15),          // сено (простреливается)
  pine: makeTexture('#3f5e43', 'rgba(230,240,245,.5)', 0.1),         // заснеженная ель
  rock: makeTexture('#9a5a3c', 'rgba(60,25,15,.35)', 0.2),
  cactus: makeTexture('#4f7a3a', 'rgba(20,40,10,.5)', 0.1),
};
const PENETRABLE = new Set(['crate', 'hay']);  // пробиваются насквозь
const FLOOR_TEX = {
  sand: makeTexture('#c7ae80', 'rgba(110,85,50,.3)', 0.1),
  concrete: makeTexture('#8b8d90', 'rgba(40,40,45,.35)', 0.1),
  snow: makeTexture('#eef3f7', 'rgba(170,190,205,.4)', 0.04),
  redsand: makeTexture('#c98a5a', 'rgba(120,60,30,.3)', 0.12),
};

const solidMeshes = [];   // всё, во что попадают пули
const colliders = [];     // AABB для столкновений
const mapGroup = new THREE.Group();  // всё, что относится к текущей карте
scene.add(mapGroup);

// Построить карту: пол, стены, небо и туман по теме карты
// Склеить несколько BoxGeometry (уже сдвинутых на свои места) в одну — одна отрисовка вместо сотни
function mergeBoxes(geos) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
    base += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  m.setIndex(idx);
  return m;
}

function buildMap(id, data) {
  for (const m of mapGroup.children) { m.geometry.dispose(); m.material.dispose(); }
  for (const m of solidMeshes) if (m.parent !== mapGroup) m.geometry.dispose();
  mapGroup.clear();
  solidMeshes.length = 0;
  colliders.length = 0;
  const th = data.theme || {};
  scene.background = new THREE.Color(th.sky || '#9fc4e8');
  scene.fog.color.copy(scene.background);
  [scene.fog.near, scene.fog.far] = th.fog || [60, 140];
  sun.position.set(...(th.sun || [30, 50, 20]));

  const floorTex = (FLOOR_TEX[th.floor] || FLOOR_TEX.sand).clone();
  floorTex.needsUpdate = true;
  floorTex.repeat.set(40, 40);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(82, 82), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  mapGroup.add(floor);
  solidMeshes.push(floor);

  // Рисуем склеенные по текстуре стены, а отдельные коробки (не в сцене) — только для попаданий пуль
  const byKind = {};
  for (const [x, z, w, d, h, kind, y0 = 0] of data.boxes) {
    const geo = new THREE.BoxGeometry(w, h, d);
    // UV по реальному размеру грани, чтобы текстура не растягивалась
    const uv = geo.attributes.uv, n = geo.attributes.normal;
    const scale = PENETRABLE.has(kind) ? 1 / Math.max(w, d, h) : 0.5;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
      uv.setXY(i, uv.getX(i) * su * scale, uv.getY(i) * sv * scale);
    }
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.updateMatrixWorld();
    mesh.userData.penetrable = PENETRABLE.has(kind);
    mesh.userData.box = new THREE.Box3(new THREE.Vector3(x - w / 2, y0, z - d / 2), new THREE.Vector3(x + w / 2, y0 + h, z + d / 2));
    solidMeshes.push(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2 });
    (byKind[kind] ||= []).push(geo.clone().translate(x, y0 + h / 2, z));
  }
  for (const [kind, geos] of Object.entries(byKind)) {
    const merged = new THREE.Mesh(mergeBoxes(geos), new THREE.MeshLambertMaterial({ map: TEX[kind] || TEX.concrete }));
    merged.castShadow = merged.receiveShadow = true;
    mapGroup.add(merged);
    geos.forEach(g => g.dispose());
  }
  SITES = data.sites || {};
  currentMapId = id;
  onMapBuilt(data);
}

async function loadMap(id) {
  if (!MAP_LIST.some(m => m.id === id)) id = 'desert';
  if (id === currentMapId) return;
  const data = await (await fetch(`maps/${id}.json`, { cache: 'no-store' })).json();
  buildMap(id, data);
}

// ================== ЗВУК ==================
let audio = null, noiseBuf = null, stepBuf = null;
function initAudio() {
  if (audio) return;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.createGain();  // общая громкость из настроек
  audio.master.gain.value = opt.volume / 100;
  audio.master.connect(audio.destination);
  noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.3, audio.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  // шаг: короткий удар с быстрым затуханием
  stepBuf = audio.createBuffer(1, audio.sampleRate * 0.12, audio.sampleRate);
  const s = stepBuf.getChannelData(0);
  for (let i = 0; i < s.length; i++) s[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / s.length, 5);
}
function playShot(volume = 1, freq = 1800, len = 0.18) {
  if (!audio || volume < 0.01) return;
  const src = audio.createBufferSource(); src.buffer = noiseBuf;
  const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = audio.createGain();
  g.gain.setValueAtTime(0.5 * volume * opt.shotVolume / 100 + 0.0001, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + len);
  src.connect(f).connect(g).connect(audio.master);
  src.start();
}
function playTone(freq, len = 0.08, vol = 0.15, type = 'square') {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + len);
  o.connect(g).connect(audio.master);
  o.start(); o.stop(audio.currentTime + len);
}

// ================== ОРУЖИЕ В РУКАХ ==================
const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
// Убрали модель со сцены — освободить её геометрию в видеопамяти (у каждой детали своя),
// иначе с каждым выброшенным стволом, сменой оружия у игроков и т. п. память копится и игра тормозит.
// Материалы общие (оружие, перчатки, скины) — их не трогаем.
function freeGeometry(obj) {
  obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
}
function box(w, h, d, mat, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  return m;
}
// цилиндр вдоль оси Z (стволы, трубки)
function cyl(r, len, mat, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Текстура дерева с волокнами для цевья и приклада
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8b4a1f'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(60,25,8,.35)' : 'rgba(190,110,55,.25)';
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * 64;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 32) g.lineTo(x + Math.sin(y / 40 + i) * 3, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const VM_MAT = {
  metal: new THREE.MeshPhongMaterial({ color: 0x2c2e31, specular: 0x666666, shininess: 70 }),
  black: new THREE.MeshPhongMaterial({ color: 0x18191b, specular: 0x333333, shininess: 30 }),
  wood: new THREE.MeshPhongMaterial({ map: woodTexture(), specular: 0x332211, shininess: 25 }),
  bakelite: new THREE.MeshPhongMaterial({ color: 0x6b2a12, specular: 0x442211, shininess: 45 }),
  glove: new THREE.MeshLambertMaterial({ color: 0x26292b }),
  sleeve: new THREE.MeshLambertMaterial({ color: TEAM_COLOR.ct }),
};

function buildAK(g) {
  const { metal, black, wood, bakelite } = VM_MAT;
  // ствольная коробка и крышка
  g.add(box(0.066, 0.075, 0.42, metal, 0, 0, 0));
  g.add(cyl(0.031, 0.40, metal, 0, 0.038, 0.005, 14));
  g.add(box(0.05, 0.02, 0.05, black, 0, 0.07, -0.19));                // прицельная планка
  g.userData.bolt = box(0.012, 0.012, 0.05, metal, 0.04, 0.012, -0.08);  // рукоятка затвора (двигается)
  g.add(g.userData.bolt);
  g.add(box(0.006, 0.03, 0.14, metal, 0.035, 0.0, 0.05));             // переводчик огня
  // цевьё (низ и верх) и газовая трубка
  g.add(box(0.074, 0.058, 0.22, wood, 0, -0.008, -0.32));
  g.add(box(0.058, 0.034, 0.18, wood, 0, 0.055, -0.31));
  g.add(cyl(0.015, 0.12, metal, 0, 0.055, -0.46));
  g.add(box(0.03, 0.035, 0.03, metal, 0, 0.04, -0.52));               // газовый блок
  // ствол, мушка и дульный тормоз
  g.add(cyl(0.012, 0.44, black, 0, 0.012, -0.62));
  g.add(box(0.026, 0.04, 0.035, metal, 0, 0.03, -0.75));
  g.add(box(0.006, 0.035, 0.006, black, 0, 0.065, -0.75));
  g.add(cyl(0.019, 0.07, black, 0, 0.012, -0.86, 8));
  // изогнутый магазин из сегментов
  // (отдельный узел — его вынимают и вставляют при перезарядке; начало узла — горловина)
  const mag = new THREE.Group();
  mag.position.set(0, -0.06, -0.1);
  for (let i = 0; i < 5; i++) {
    const a = i * 0.14;
    mag.add(box(0.042, 0.058, 0.07, bakelite, 0, -i * 0.052, -i * i * 0.007 - i * 0.012, a));
  }
  g.add(mag);
  g.userData.mag = mag;
  // спусковая скоба и пистолетная рукоять
  g.add(box(0.008, 0.008, 0.07, metal, 0, -0.06, 0.05));
  g.add(box(0.008, 0.03, 0.008, metal, 0, -0.045, 0.085));
  g.add(box(0.04, 0.11, 0.05, bakelite, 0, -0.085, 0.13, -0.32));
  // приклад: шейка, приклад, затыльник
  g.add(box(0.048, 0.055, 0.14, wood, 0, -0.012, 0.27, -0.08));
  g.add(box(0.05, 0.105, 0.16, wood, 0, -0.045, 0.41, -0.12));
  g.add(box(0.053, 0.11, 0.012, black, 0, -0.055, 0.495, -0.12));
}

function buildPistol(g) {
  const { metal, black } = VM_MAT;
  g.userData.bolt = box(0.05, 0.045, 0.24, metal, 0, 0.012, -0.08);  // затвор-кожух (двигается)
  g.add(g.userData.bolt);
  g.add(box(0.044, 0.035, 0.2, black, 0, -0.025, -0.07));   // рамка
  g.add(cyl(0.01, 0.03, black, 0, 0.012, -0.21, 8));
  g.add(box(0.044, 0.13, 0.06, black, 0, -0.09, 0.01, -0.22));
  g.add(box(0.008, 0.008, 0.05, metal, 0, -0.055, -0.04));
  addPistolMag(g, [0, -0.153, 0.024], -0.22, metal, black);
}
// Магазин пистолета: сидит в рукояти, снизу видна только пятка; узел — у низа рукояти
function addPistolMag(g, pos, tilt, plateMat, bodyMat) {
  const mag = new THREE.Group();
  mag.position.set(...pos);
  mag.rotation.x = tilt;
  mag.add(box(0.034, 0.11, 0.044, bodyMat, 0, 0.056, 0));    // корпус (внутри рукояти)
  mag.add(box(0.048, 0.013, 0.064, plateMat, 0, -0.004, 0)); // пятка
  g.add(mag);
  g.userData.mag = mag;
}

// AWP: длинная снайперская винтовка с оптическим прицелом и затвором
const AWP_MAT = {
  green: new THREE.MeshPhongMaterial({ color: 0x3d4a32, specular: 0x222222, shininess: 20 }),
  scope: new THREE.MeshPhongMaterial({ color: 0x141516, specular: 0x555555, shininess: 60 }),
  lens: new THREE.MeshPhongMaterial({ color: 0x2a6b8f, specular: 0xffffff, shininess: 120 }),
};
function buildAWP(g) {
  const { metal, black } = VM_MAT;
  const { green, scope, lens } = AWP_MAT;
  g.add(box(0.07, 0.09, 0.5, green, 0, 0, 0));                         // ложа
  g.add(box(0.06, 0.13, 0.3, green, 0, -0.025, 0.38, -0.08));          // приклад
  g.add(box(0.064, 0.02, 0.06, black, 0, -0.09, 0.52, -0.08));         // затыльник
  g.add(cyl(0.014, 0.64, black, 0, 0.02, -0.56));                      // ствол
  g.add(cyl(0.022, 0.09, black, 0, 0.02, -0.9, 10));                   // дульный тормоз
  g.add(cyl(0.028, 0.32, scope, 0, 0.1, -0.02, 14));                   // оптический прицел
  g.add(cyl(0.036, 0.07, scope, 0, 0.1, -0.2, 14), cyl(0.034, 0.06, scope, 0, 0.1, 0.15, 14));
  g.add(cyl(0.03, 0.005, lens, 0, 0.1, -0.236, 14));                   // линза
  g.add(box(0.02, 0.05, 0.02, black, 0, 0.06, -0.1), box(0.02, 0.05, 0.02, black, 0, 0.06, 0.07));  // крепления
  const mag = new THREE.Group();                                        // магазин (меняют при перезарядке)
  mag.position.set(0, -0.08, -0.03);
  mag.add(box(0.05, 0.09, 0.09, black, 0, 0, 0), box(0.054, 0.012, 0.094, metal, 0, -0.045, 0));
  g.add(mag);
  g.userData.mag = mag;
  g.add(box(0.04, 0.11, 0.05, green, 0, -0.09, 0.15, -0.3));           // рукоять
  g.add(box(0.008, 0.008, 0.06, metal, 0, -0.06, 0.07));               // спуск
  g.userData.bolt = box(0.05, 0.016, 0.016, metal, 0.05, 0.035, 0.12); // рукоятка затвора
  g.add(g.userData.bolt);
}

// M4: чёрная штурмовая винтовка — плоская верхняя планка с ручкой, прямой магазин, телескопический приклад
const M4_MAT = new THREE.MeshPhongMaterial({ color: 0x23262a, specular: 0x444444, shininess: 40 });
function buildM4(g) {
  const { metal, black } = VM_MAT;
  g.add(box(0.06, 0.07, 0.38, M4_MAT, 0, 0, 0));                      // ствольная коробка
  g.add(box(0.03, 0.022, 0.34, black, 0, 0.046, -0.02));              // планка сверху
  g.add(box(0.026, 0.05, 0.03, black, 0, 0.07, 0.08), box(0.026, 0.05, 0.03, black, 0, 0.07, -0.16));  // прицельные стойки
  g.add(box(0.07, 0.07, 0.26, M4_MAT, 0, 0.004, -0.31));              // цевьё
  for (let i = 0; i < 4; i++) g.add(box(0.074, 0.01, 0.03, black, 0, 0.0, -0.22 - i * 0.06));  // рёбра цевья
  g.add(cyl(0.012, 0.36, black, 0, 0.01, -0.6));                      // ствол
  g.add(box(0.012, 0.045, 0.012, black, 0, 0.04, -0.6));              // мушка
  g.add(cyl(0.018, 0.08, black, 0, 0.01, -0.8, 8));                   // пламегаситель
  // прямой магазин (меняют при перезарядке)
  const mag = new THREE.Group();
  mag.position.set(0, -0.04, -0.08);
  mag.add(box(0.034, 0.2, 0.06, black, 0, -0.1, 0, 0.12), box(0.038, 0.014, 0.066, metal, 0, -0.2, 0.012, 0.12));
  g.add(mag);
  g.userData.mag = mag;
  g.add(box(0.008, 0.008, 0.06, metal, 0, -0.05, 0.05));              // спуск
  g.add(box(0.04, 0.11, 0.05, black, 0, -0.085, 0.12, -0.3));         // рукоять
  g.add(box(0.03, 0.03, 0.16, black, 0, -0.005, 0.27));               // трубка приклада
  g.add(box(0.05, 0.1, 0.13, M4_MAT, 0, -0.03, 0.39, -0.05));         // приклад
  g.userData.bolt = box(0.03, 0.012, 0.03, metal, 0, 0.046, 0.17);    // рукоятка затвора сзади
  g.add(g.userData.bolt);
}
// MP5: компактный пистолет-пулемёт с изогнутым магазином и коротким прикладом
function buildSMG(g) {
  const { metal, black } = VM_MAT;
  g.add(box(0.05, 0.065, 0.32, M4_MAT, 0, 0, -0.04));                 // корпус
  g.add(cyl(0.022, 0.12, black, 0, 0.0, -0.26));                      // цевьё-труба
  g.add(cyl(0.01, 0.1, black, 0, 0.012, -0.36));                      // ствол
  g.add(box(0.03, 0.04, 0.03, black, 0, 0.045, -0.15), box(0.01, 0.03, 0.01, black, 0, 0.05, 0.08));  // мушка и целик
  const mag = new THREE.Group();                                      // изогнутый магазин впереди спуска
  mag.position.set(0, -0.035, -0.07);
  for (let i = 0; i < 4; i++) mag.add(box(0.03, 0.05, 0.05, black, 0, -0.025 - i * 0.045, -i * 0.012 - i * i * 0.004, i * 0.1));
  g.add(mag);
  g.userData.mag = mag;
  g.add(box(0.008, 0.008, 0.05, metal, 0, -0.045, 0.03));             // спуск
  g.add(box(0.04, 0.1, 0.05, black, 0, -0.075, 0.08, -0.25));         // рукоять
  g.add(box(0.02, 0.02, 0.14, metal, 0.022, 0.0, 0.2), box(0.02, 0.02, 0.14, metal, -0.022, 0.0, 0.2));  // складной приклад
  g.add(box(0.06, 0.06, 0.015, metal, 0, -0.01, 0.275));
  g.userData.bolt = box(0.012, 0.012, 0.04, metal, -0.03, 0.02, -0.2);   // взвод слева над цевьём
  g.add(g.userData.bolt);
}
// Nova: помповый дробовик — длинный ствол, трубчатый магазин снизу, подвижное цевьё (помпа)
const SHOTGUN_MAT = new THREE.MeshPhongMaterial({ color: 0x2b2d31, specular: 0x555555, shininess: 50 });
function buildShotgun(g) {
  const { metal, black, wood } = VM_MAT;
  g.add(box(0.055, 0.075, 0.26, SHOTGUN_MAT, 0, 0, 0));                // ствольная коробка
  g.add(cyl(0.017, 0.62, metal, 0, 0.02, -0.43));                     // ствол
  g.add(cyl(0.014, 0.5, black, 0, -0.022, -0.37));                    // трубчатый магазин
  g.add(box(0.008, 0.012, 0.008, metal, 0, 0.04, -0.72));             // мушка
  // помпа: двигается назад-вперёд после каждого выстрела
  const pump = new THREE.Group();
  pump.add(box(0.05, 0.05, 0.16, wood, 0, -0.022, 0));
  for (let i = 0; i < 4; i++) pump.add(box(0.054, 0.006, 0.012, black, 0, -0.022, -0.06 + i * 0.04));
  pump.position.z = -0.3;
  g.add(pump);
  g.userData.bolt = pump;                                             // для анимаций — это «затвор»
  g.add(box(0.008, 0.008, 0.05, metal, 0, -0.05, 0.05));              // спуск
  g.add(box(0.045, 0.12, 0.055, wood, 0, -0.08, 0.15, -0.35));        // рукоять
  g.add(box(0.05, 0.1, 0.24, wood, 0, -0.04, 0.32, -0.12));           // приклад
  g.add(box(0.054, 0.11, 0.015, black, 0, -0.056, 0.445, -0.12));     // затыльник
}

// Desert Eagle: массивный хромированный пистолет
const DEAGLE_MAT = new THREE.MeshPhongMaterial({ color: 0xb4b9bf, specular: 0xffffff, shininess: 110 });
function buildDeagle(g) {
  const { black } = VM_MAT;
  g.userData.bolt = box(0.054, 0.052, 0.27, DEAGLE_MAT, 0, 0.016, -0.09);  // затвор
  g.add(g.userData.bolt);
  g.add(box(0.048, 0.04, 0.22, DEAGLE_MAT, 0, -0.026, -0.08));             // рамка
  g.add(box(0.012, 0.012, 0.02, black, 0, 0.048, -0.21));                  // мушка
  g.add(box(0.05, 0.14, 0.065, black, 0, -0.1, 0.02, -0.2));               // рукоять
  g.add(box(0.008, 0.008, 0.05, DEAGLE_MAT, 0, -0.058, -0.04));
  addPistolMag(g, [0, -0.169, 0.034], -0.2, DEAGLE_MAT, black);
}

// Граната: корпус, запал с кольцом; цвет по типу
const NADE_COLOR = { he: 0x4b5a32, flash: 0xc4c9cf, smoke: 0x5f6f80 };
function buildNade(g, kind) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 14), new THREE.MeshPhongMaterial({ color: NADE_COLOR[kind], shininess: 40 }));
  g.add(body);
  g.add(box(0.026, 0.03, 0.026, VM_MAT.metal, 0, 0.058, 0));               // запал
  g.add(box(0.008, 0.07, 0.016, VM_MAT.metal, 0.024, 0.03, 0));            // скоба
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 12), VM_MAT.metal);
  ring.position.set(-0.02, 0.075, 0);
  g.add(ring);
  if (kind === 'smoke') g.add(cyl(0.035, 0.012, VM_MAT.black, 0, 0, 0, 14).rotateX(Math.PI / 2));  // полоса у дымовой
}

// Кисти: тактические перчатки без кончиков пальцев — видно пальцы, костяшки и манжету
const HAND_MAT = {
  glove: VM_MAT.glove,
  pad: new THREE.MeshPhongMaterial({ color: 0x3b4046, specular: 0x222222, shininess: 25 }),   // накладки на костяшках
  skin: new THREE.MeshPhongMaterial({ color: 0xd29a74, specular: 0x221510, shininess: 12 }),  // кончики пальцев
  strap: new THREE.MeshPhongMaterial({ color: 0x15171a, specular: 0x333333, shininess: 30 }), // липучка на запястье
};
// Палец из трёх фаланг: точки сгибов p0 → p1 → p2 → p3; последняя фаланга — открытая (кожа)
// Пальцы с суставами: каждая фаланга — свой узел, поэтому палец умеет сгибаться и разгибаться.
// pts — где сгибы в позе «держит рукоять»; из них считаются длины фаланг и углы сгибов.
// pose(open): 0 — как в pts (обхватил), 1 — палец выпрямлен и отведён, меньше 0 — стиснут сильнее.
function finger(parent, pts, thick) {
  const v = pts.map(p => new THREE.Vector3(...p));
  const dir = [0, 1, 2].map(i => v[i + 1].clone().sub(v[i]));
  const len = dir.map(d => d.length());
  dir.forEach(d => d.normalize());
  // ось сгиба — перпендикуляр к плоскости, в которой гнётся палец
  const axis = new THREE.Vector3().crossVectors(dir[0], dir[1]);
  if (axis.lengthSq() < 1e-8) axis.crossVectors(dir[0], new THREE.Vector3(0, 1, 0));
  axis.normalize();
  const angle = (a, b) => Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(axis), a.dot(b));
  const rest = [angle(dir[0], dir[1]), angle(dir[1], dir[2])];
  // узел фаланги: локальная ось y — вдоль фаланги, x — ось сгиба (поворот по x сгибает палец)
  const joints = [];
  let host = parent;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Group();
    if (i === 0) {
      j.position.copy(v[0]);
      j.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis, dir[0], new THREE.Vector3().crossVectors(axis, dir[0])));
    } else {
      j.position.y = len[i - 1];
      j.rotation.x = rest[i - 1];
    }
    const t = thick * (1 - i * 0.08), mat = i === 2 ? HAND_MAT.skin : HAND_MAT.glove;
    j.add(box(t, len[i], t, mat, 0, len[i] / 2, 0));
    if (i) j.add(box(t * 0.95, t * 0.95, t * 0.95, mat, 0, 0, 0));  // сустав — сгиб без щелей
    host.add(j);
    joints.push(j);
    host = j;
  }
  return {
    pose(open) {
      joints[0].rotation.x = -0.9 * Math.max(0, open) - 0.25 * Math.min(0, open);  // от ладони / к ладони
      joints[1].rotation.x = rest[0] * (1 - open);
      joints[2].rotation.x = rest[1] * (1 - open);
    },
  };
}
// Правая кисть держит рукоять: рукоять вертикальна (ось y) в начале координат,
// тыльная сторона ладони снаружи (+x), пальцы обхватывают рукоять спереди (-z) и заходят влево (-x).
// trigger — указательный палец лежит на спуске, иначе тоже сжат.
function buildGripHand(trigger = true) {
  const h = new THREE.Group();
  const { glove, pad, strap } = HAND_MAT;
  h.add(box(0.026, 0.085, 0.07, glove, 0.033, -0.005, 0.004));     // ладонь
  h.add(box(0.008, 0.07, 0.05, pad, 0.048, 0, -0.004));            // накладка на тыльной стороне
  h.add(box(0.062, 0.04, 0.062, strap, 0.022, -0.05, 0.042, -0.3)); // манжета-липучка
  // средний, безымянный, мизинец: от костяшек вперёд, вокруг рукояти, кончики слева
  const fingers = h.userData.fingers = {};
  const names = trigger ? ['middle', 'ring', 'pinky'] : ['index', 'middle', 'ring', 'pinky'];
  const rows = trigger ? [0.012, -0.012, -0.034] : [0.034, 0.012, -0.012, -0.034];
  rows.forEach((y, i) => {
    const s = 1 - Math.max(0, i - (trigger ? 1 : 2)) * 0.12;       // мизинец короче
    fingers[names[i]] = finger(h, [[0.034, y, -0.026], [0.012 * s, y, -0.044 * s], [-0.016 * s, y - 0.002, -0.036 * s], [-0.03 * s, y - 0.004, -0.014]], 0.019);
    h.add(box(0.012, 0.016, 0.014, pad, 0.04, y, -0.03));          // костяшка
  });
  if (trigger) {  // указательный — вытянут вперёд к спуску
    fingers.index = finger(h, [[0.034, 0.036, -0.026], [0.03, 0.044, -0.056], [0.02, 0.046, -0.078], [0.006, 0.04, -0.09]], 0.018);
    h.add(box(0.012, 0.016, 0.014, pad, 0.04, 0.036, -0.03));
  }
  // большой палец — по левой стороне вверх и вперёд
  fingers.thumb = finger(h, [[0.02, 0.0, 0.02], [-0.012, 0.022, 0.018], [-0.03, 0.036, 0.0], [-0.034, 0.042, -0.02]], 0.021);
  return h;
}
// Левая кисть поддерживает цевьё снизу: ладонь под ним, пальцы поднимаются по правому боку (+x),
// большой палец — по левому
function buildSupportHand() {
  const h = new THREE.Group();
  const { glove, pad, strap } = HAND_MAT;
  h.add(box(0.07, 0.022, 0.085, glove, 0.004, -0.004, 0));                 // ладонь
  h.add(box(0.07, 0.04, 0.05, strap, -0.006, -0.012, 0.062, 0.25));        // манжета
  const fingers = h.userData.fingers = {};
  ['pinky', 'ring', 'middle', 'index'].forEach((name, i) => {
    const z = -0.03 + i * 0.02;
    const s = i === 0 ? 0.85 : 1;                                           // мизинец ближе к стволу и короче
    fingers[name] = finger(h, [[0.03, -0.002, z], [0.046, 0.012, z], [0.048, 0.036 * s, z], [0.036, 0.052 * s, z]], 0.017);
    h.add(box(0.012, 0.014, 0.016, pad, 0.04, 0.0, z));
  });
  fingers.thumb = finger(h, [[-0.03, 0.0, 0.03], [-0.044, 0.016, 0.012], [-0.046, 0.03, -0.014], [-0.04, 0.038, -0.036]], 0.02);  // большой
  return h;
}

// Руки в перчатках; рукава — цвета команды (меняется в setTeam).
// gripAxis — как лежит рукоять: 'y' у оружия, 'z' у ножа (у него рукоять вдоль ножа)
// tilt — наклон рукояти (как у модели оружия), чтобы кисть легла вдоль неё
function addArms(g, right, left, { gripAxis = 'y', trigger = true, tilt = 0 } = {}) {
  const { sleeve } = VM_MAT;
  const r = new THREE.Group();
  const fist = new THREE.Group();
  const hand = buildGripHand(trigger);
  hand.rotation.x = gripAxis === 'z' ? -Math.PI / 2 : tilt;  // у ножа ось рукояти y → -z (к клинку), пальцы — под рукоятью
  hand.scale.setScalar(1.3);
  fist.add(hand);
  g.userData.rightGlove = fist;
  g.userData.fingers = hand.userData.fingers;  // правая рука — ей шевелят анимации
  r.add(fist);
  // краги перчатки — от кисти к запястью; поворачиваются вместе с кистью
  const cuff = d => limb(d.clone().multiplyScalar(0.02), d.clone().multiplyScalar(WRIST + 0.02), 0.066, HAND_MAT.strap);
  fist.add(cuff(ARM_DIR.right));
  r.position.set(...right);
  const l = new THREE.Group();
  g.add(r);
  // сама рука — две части: предплечье (от запястья до локтя) и плечо (от локтя к плечу у камеры);
  // их положение пересчитывает updateArms каждый кадр, чтобы рука шла за кистью, а не кисть уходила в рукав
  const part = thick => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(thick, 1, thick), sleeve);
    g.add(m);
    return m;
  };
  g.userData.arms = { right: { fore: part(0.085), upper: part(0.1), elbow: part(0.095) } };
  if (left) {  // с ножом левая рука не нужна
    const support = buildSupportHand();
    support.scale.setScalar(1.3);
    g.userData.leftFingers = support.userData.fingers;
    l.add(support, cuff(ARM_DIR.left));
    l.position.set(...left);
    g.userData.leftRest = l.position.clone();  // левая рука уходит за магазином и возвращается сюда
    g.add(l);
    g.userData.arms.left = { fore: part(0.085), upper: part(0.1), elbow: part(0.095) };
  }
  g.userData.leftArm = l;                          // при осмотре левая рука отпускает оружие
  g.userData.grip = new THREE.Vector3(...right);  // вокруг рукояти оружие вращается
}

// Куда от кисти идёт предплечье в обычной позе: правое — назад-вправо-вниз, левое — назад-влево-вниз
const ARM_DIR = { right: new THREE.Vector3(0.343, -0.232, 0.91), left: new THREE.Vector3(-0.435, -0.222, 0.872) };
const WRIST = 0.075, FOREARM = 0.34;  // от центра кисти до рукава; длина предплечья
// Плечи — у камеры (в координатах камеры): чуть ниже и в стороны
const SHOULDER = { right: new THREE.Vector3(0.2, -0.34, 0.12), left: new THREE.Vector3(-0.24, -0.34, 0.12) };
const _q = new THREE.Quaternion(), _I = new THREE.Quaternion(), _inv = new THREE.Matrix4();
const _b = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
// Брусок-деталь руки между точками a и b (геометрия длиной 1 растягивается)
function stretch(m, a, b) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  _b.copy(b).sub(a);
  m.scale.set(1, Math.max(0.001, _b.length()), 1);
  m.quaternion.setFromUnitVectors(_Y, _b.normalize());
}
// Рука следует за кистью: предплечье поворачивается наполовину вместе с кистью (остальное — сгиб запястья),
// от локтя плечо тянется к неподвижному плечевому суставу у камеры
function updateArms(vm) {
  const ud = vm.userData;
  if (!ud.arms) return;
  // плечи неподвижны относительно камеры — переводим их в координаты модели (она качается и вертится)
  vm.updateMatrix();
  _inv.copy(vm.matrix).invert();
  for (const side of ['right', 'left']) {
    const parts = ud.arms[side];
    if (!parts) continue;
    const group = side === 'right' ? ud.rightGlove.parent : ud.leftArm;
    const visible = side === 'right' || ud.leftArm.visible;
    for (const m of Object.values(parts)) m.visible = visible;
    if (!visible) continue;
    // поворот кисти относительно обычной позы
    if (side === 'right') _q.copy(ud.rightGlove.quaternion).multiply(ud.kqInv ?? _I);
    else _q.copy(ud.leftArm.quaternion);
    const turned = ARM_DIR[side].clone().applyQuaternion(_q);
    const dir = ARM_DIR[side].clone().lerp(turned, 0.5).normalize();
    const wrist = group.position.clone().addScaledVector(dir, WRIST);
    const elbow = wrist.clone().addScaledVector(dir, FOREARM);
    const shoulder = SHOULDER[side].clone().applyMatrix4(_inv);
    stretch(parts.fore, wrist, elbow);
    stretch(parts.upper, elbow, shoulder);
    parts.elbow.position.copy(elbow);
    parts.elbow.scale.set(1, 0.095, 1);
    parts.elbow.quaternion.copy(parts.fore.quaternion);
  }
}

function buildViewModel(kind) {
  const g = new THREE.Group();
  let muzzleZ = -0.23;
  if (kind === 'rifle') {
    buildAK(g);
    addArms(g, [0.005, -0.085, 0.14], [0, -0.05, -0.33], { tilt: -0.32 });
    muzzleZ = -0.9;
  } else if (kind === 'awp') {
    buildAWP(g);
    addArms(g, [0.005, -0.09, 0.17], [0, -0.04, -0.3], { tilt: -0.3 });
    muzzleZ = -0.95;
  } else if (kind === 'm4') {
    buildM4(g);
    addArms(g, [0.005, -0.09, 0.13], [0, -0.06, -0.34], { tilt: -0.3 });
    muzzleZ = -0.86;
  } else if (kind === 'smg') {
    buildSMG(g);
    addArms(g, [0.005, -0.085, 0.09], [0, -0.06, -0.24], { tilt: -0.25 });
    muzzleZ = -0.5;
  } else if (kind === 'shotgun') {
    buildShotgun(g);
    addArms(g, [0.005, -0.08, 0.16], [0, -0.055, -0.32], { tilt: -0.35 });
    muzzleZ = -0.92;
    // патрон в левой руке — виден, только пока заряжает
    const shell = new THREE.Group();
    shell.add(box(0.022, 0.022, 0.05, new THREE.MeshPhongMaterial({ color: 0xb3221b, shininess: 40 }), 0, 0, 0),
      box(0.024, 0.024, 0.014, new THREE.MeshPhongMaterial({ color: 0xc9a227, shininess: 90 }), 0, 0, 0.03));
    shell.position.set(0.035, 0.03, 0);
    shell.visible = false;
    g.userData.leftArm.add(shell);
    g.userData.shell = shell;
  } else if (kind === 'deagle') {
    buildDeagle(g);
    addArms(g, [0.005, -0.08, 0.04], [-0.02, -0.1, 0.01], { tilt: -0.2 });
    muzzleZ = -0.25;
  } else if (isNade(kind)) {
    buildNade(g, kind);
    addArms(g, [0.01, -0.03, 0.05], null, { trigger: false });  // граната в правой руке
    g.userData.hip = new THREE.Vector3(0.16, -0.17, -0.42);
  } else {
    buildPistol(g);
    addArms(g, [0.005, -0.07, 0.03], [-0.02, -0.09, 0.0], { tilt: -0.22 });
  }
  if (g.userData.bolt) g.userData.boltRest = g.userData.bolt.position.z;  // затвор в покое
  if (g.userData.mag) {  // где магазин стоит в оружии — к этому месту он возвращается после перезарядки
    g.userData.magRest = g.userData.mag.position.clone();
    g.userData.magRot = g.userData.mag.rotation.x;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, muzzleZ);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}
const viewModels = {};
for (const kind of [...GUN_LIST, ...NADE_KINDS]) viewModels[kind] = buildViewModel(kind);
const VM_HIP = new THREE.Vector3(0.2, -0.2, -0.62), VM_ADS = new THREE.Vector3(0, -0.105, -0.5);
// Всё оружие в руках лежит в группе hands: если отразить её по x, оружие перейдёт в левую руку
const hands = new THREE.Group();
camera.add(hands);
for (const vm of Object.values(viewModels)) { vm.position.copy(VM_HIP); vm.scale.setScalar(0.7); vm.visible = false; hands.add(vm); }

// ================== НОЖИ ==================
const KNIVES = {
  default:   'Обычный',
  karambit:  'Керамбит',
  butterfly: 'Бабочка',
  skeleton:  'Нож-скелет',
  stiletto:  'Стилет',
  m9:        'M9 Байонет',
};
// «Обычный» у ножа и у редкости переводятся по-разному — нож переименовываем здесь
if (window.I18N && I18N.lang !== 'ru') KNIVES.default = 'Default';
// ЛКМ — быстрый удар, ПКМ — сильный укол; rate — пауза между ударами (мс)
const KNIFE = { slash: { rate: 450 }, stab: { rate: 1000 }, range: 1.9 };
const KMAT = {
  steel: new THREE.MeshPhongMaterial({ color: 0xc3c9d1, specular: 0xffffff, shininess: 120 }),
  dark: new THREE.MeshPhongMaterial({ color: 0x45494f, specular: 0x888888, shininess: 80 }),
  black: VM_MAT.black,
  wood: VM_MAT.wood,
};

// Плоская деталь по контуру: точки [вперёд, вверх], толщина — поперёк (по x)
function profile(points, depth, mat, holes = []) {
  const shape = new THREE.Shape(points.map(([f, u]) => new THREE.Vector2(f, u)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([f, u]) => new THREE.Vector2(f, u))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI / 2;  // «вперёд» контура смотрит в -z, как ствол
  return m;
}
function ring(r, tube, mat, f, u) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24), mat);
  m.rotation.y = Math.PI / 2;
  m.position.set(0, u, -f);
  return m;
}

// Шарнир в начале клинка (f = 0): то, что в нём лежит, может складываться (поворот вокруг x)
function hinge(g, ...parts) {
  const h = new THREE.Group();
  h.add(...parts);
  g.add(h);
  return h;
}

// Собирает нож в группу g. Возвращает подвижные части для анимаций.
function buildKnife(type, g) {
  const { steel, dark, black, wood } = KMAT;
  const parts = {};
  if (type === 'karambit') {
    // изогнутый «коготь» и кольцо на рукояти
    g.add(profile([[-0.11, -0.013], [0, -0.014], [0.005, 0.013], [-0.11, 0.012]], 0.022, black));
    g.add(ring(0.02, 0.005, steel, -0.132, 0));
    g.add(profile([[0, 0.013], [0.05, 0.009], [0.09, -0.012], [0.115, -0.045], [0.12, -0.08],
                   [0.103, -0.052], [0.078, -0.028], [0.045, -0.014], [0, -0.013]], 0.006, steel));
  } else if (type === 'butterfly') {
    // две половинки рукояти с прорезями и тонкий клинок; клинок и одна половинка — на шарнире
    const half = side => {
      const m = profile([[-0.13, -0.013], [0, -0.013], [0, 0.013], [-0.13, 0.013]], 0.008, dark,
        [[[-0.112, -0.004], [-0.02, -0.004], [-0.02, 0.004], [-0.112, 0.004]]]);
      m.position.x = side * 0.0085;
      return m;
    };
    g.add(half(-1));
    parts.halfB = hinge(g, half(1), box(0.026, 0.008, 0.012, steel, 0, -0.01, 0.135));  // с защёлкой
    parts.blade = hinge(g, profile([[0, -0.01], [0.13, -0.008], [0.168, 0.004], [0.12, 0.013], [0, 0.013]], 0.006, steel));
  } else if (type === 'skeleton') {
    // рукоять-рамка с вырезом и кольцо
    g.add(profile([[-0.115, -0.016], [0, -0.016], [0, 0.018], [-0.115, 0.016]], 0.02, black,
      [[[-0.095, -0.006], [-0.015, -0.006], [-0.015, 0.008], [-0.095, 0.006]]]));
    g.add(ring(0.017, 0.005, black, -0.13, 0));
    g.add(profile([[0, -0.016], [0.14, -0.012], [0.205, 0.004], [0.17, 0.018], [0.13, 0.012], [0.1, 0.02], [0, 0.02]], 0.006, steel));
  } else if (type === 'm9') {
    // M9 Байонет: рукоять с насечками, гарда с кольцом под ствол, широкий клинок со скосом,
    // пилой на обухе и прорезью-кусачками
    g.add(profile([[-0.125, -0.015], [-0.01, -0.016], [-0.01, 0.017], [-0.125, 0.015], [-0.133, 0]], 0.026, black));
    for (let i = 0; i < 5; i++) g.add(box(0.028, 0.004, 0.006, dark, 0, -0.016, 0.03 + i * 0.019));  // насечки
    g.add(box(0.03, 0.03, 0.014, steel, 0, 0, 0.13));                          // затыльник
    g.add(box(0.024, 0.072, 0.008, steel, 0, 0.012, 0));                       // гарда
    g.add(ring(0.013, 0.004, steel, 0, 0.052));                                // кольцо гарды
    g.add(profile([[0, -0.016], [0.16, -0.014], [0.205, -0.002], [0.225, 0.012], [0.175, 0.016], [0.12, 0.021], [0, 0.021]], 0.007, steel,
      [[[0.03, 0.0], [0.07, 0.0], [0.07, 0.009], [0.03, 0.009]]]));
    for (let i = 0; i < 7; i++) g.add(box(0.008, 0.008, 0.008, steel, 0, 0.024, -0.024 - i * 0.012, Math.PI / 4));  // пила
  } else if (type === 'stiletto') {
    // длинный узкий клинок, деревянная рукоять с металлическими вставками
    g.add(profile([[-0.12, -0.012], [-0.01, -0.013], [-0.01, 0.013], [-0.12, 0.012]], 0.02, wood));
    g.add(box(0.022, 0.03, 0.012, steel, 0, 0, 0.122));
    g.add(box(0.022, 0.045, 0.006, steel, 0, 0, 0.005));
    // выкидной клинок — на шарнире, в сложенном виде прячется в рукояти
    parts.blade = hinge(g, profile([[0, -0.007], [0.21, -0.002], [0.245, 0.001], [0.21, 0.005], [0, 0.009]], 0.005, steel));
  } else {
    // обычный нож: рукоять, гарда, клинок со скосом
    g.add(profile([[-0.12, -0.015], [0, -0.016], [0, 0.018], [-0.12, 0.016], [-0.128, 0]], 0.024, black));
    g.add(box(0.03, 0.05, 0.008, steel, 0, 0.002, 0));
    g.add(profile([[0, -0.012], [0.13, -0.01], [0.2, 0.006], [0.16, 0.014], [0.13, 0.02], [0, 0.02]], 0.006, steel));
  }
  return parts;
}

// Как нож лежит в руке в покое: наклоны и место на экране
const KNIFE_POSE = { rx: 0.15, ry: 0.8, roll: -0.15, hip: [0.18, -0.15, -0.42] };
const HANDLE_Z = 0.06;  // середина рукояти (в координатах ножа) — там кулак

function buildKnifeViewModel(type) {
  const g = new THREE.Group();
  const k = new THREE.Group();
  // spin — точка, вокруг которой нож крутится: у керамбита это кольцо, у остальных середина рукояти
  // tilt — наклон всего ножа в кулаке (осмотр клинка), вращается вокруг середины рукояти
  const pivotZ = type === 'karambit' ? 0.132 : 0.06;
  const tilt = new THREE.Group();
  tilt.position.z = HANDLE_Z;
  const tiltInner = new THREE.Group();
  tiltInner.position.z = -HANDLE_Z;
  tilt.add(tiltInner);
  const spin = new THREE.Group();
  spin.position.z = pivotZ;
  const body = new THREE.Group();
  body.position.z = -pivotZ;
  spin.add(body);
  tiltInner.add(spin);
  k.add(tilt);
  Object.assign(g.userData, buildKnife(type, body), { spin, tilt, knifeType: type });
  k.scale.setScalar(1.5);
  // Порядок YXZ: нож чуть поворачивается вокруг своей длины, кончик — немного вверх (x)
  // и к центру экрана (y), так что плоская сторона клинка видна
  k.rotation.set(KNIFE_POSE.rx, KNIFE_POSE.ry, KNIFE_POSE.roll, 'YXZ');
  g.add(k);
  // кисть — точно на середине рукояти и повёрнута вместе с ножом, чтобы обхватывать его
  const handle = new THREE.Vector3(0, 0, HANDLE_Z * 1.5).applyEuler(k.rotation);
  addArms(g, handle.toArray(), null, { gripAxis: 'z', trigger: false });
  g.userData.rightGlove.rotation.copy(k.rotation);
  g.userData.kq = k.quaternion.clone();             // поворот ножа в покое
  g.userData.kqInv = k.quaternion.clone().invert();
  g.userData.muzzle = new THREE.Object3D();
  g.userData.hip = new THREE.Vector3(...KNIFE_POSE.hip);
  g.position.copy(g.userData.hip);
  g.scale.setScalar(0.85);
  g.visible = false;
  return g;
}
// ================== СКИНЫ ==================
// Редкость: название и цвет (как в CS)
const RARITY = {
  common:    { name: 'Обычный',     color: '#b0c3d9', price: 150 },
  rare:      { name: 'Редкий',      color: '#4b69ff', price: 400 },
  epic:      { name: 'Эпический',   color: '#a94bff', price: 900 },
  legendary: { name: 'Легендарный', color: '#eb4b4b', price: 2000 },
  knife:     { name: '★ Особый',    color: '#ffd700', price: 3500 },
};
// Каталог скинов. a — основная окраска, b — дополнительная (металл, рукоять).
// Узоры: solid, gradient, camo, stripes, tiger, fade, carbon, damascus
const SKINS = [
  { id: 'ak_desert',   weapon: 'rifle',  name: 'Пустынный камуфляж', rarity: 'common',    a: { type: 'camo', colors: ['#c2a676', '#8f7550', '#5e4b33', '#d8c49a'] } },
  { id: 'ak_ice',      weapon: 'rifle',  name: 'Синий лёд',          rarity: 'rare',      a: { type: 'gradient', colors: ['#e8f6ff', '#3a8fd8'], gloss: 0.8 }, b: { type: 'solid', colors: ['#cfe6f5'], gloss: 0.9, metal: true } },
  { id: 'ak_redline',  weapon: 'rifle',  name: 'Красная линия',      rarity: 'rare',      a: { type: 'stripes', colors: ['#141414', '#c4161c'], gloss: 0.4 }, b: { type: 'carbon', colors: ['#1a1a1a', '#2a2a2a'] } },
  { id: 'ak_tiger',    weapon: 'rifle',  name: 'Тигр',               rarity: 'epic',      a: { type: 'tiger', colors: ['#f08a1c', '#1a1208'], gloss: 0.5 } },
  { id: 'ak_fire',     weapon: 'rifle',  name: 'Огненный змей',      rarity: 'legendary', a: { type: 'fade', colors: ['#ffd23f', '#ff6a00', '#b3001b'], gloss: 0.9 }, b: { type: 'solid', colors: ['#c9a227'], gloss: 1, metal: true } },
  { id: 'awp_forest',  weapon: 'awp',    name: 'Лесной',             rarity: 'common',    a: { type: 'camo', colors: ['#4a5d36', '#2f3b24', '#6b7d48', '#1f2918'] } },
  { id: 'awp_neon',    weapon: 'awp',    name: 'Неон',               rarity: 'rare',      a: { type: 'gradient', colors: ['#ff4fd8', '#33e6ff'], gloss: 0.9 } },
  { id: 'awp_asimov',  weapon: 'awp',    name: 'Азимов',             rarity: 'epic',      a: { type: 'stripes', colors: ['#f2f2f2', '#e8442c', '#1a1a1a'], gloss: 0.6 } },
  { id: 'awp_dragon',  weapon: 'awp',    name: 'Драконья история',   rarity: 'legendary', a: { type: 'tiger', colors: ['#2e8b57', '#d4af37'], gloss: 0.8 }, b: { type: 'solid', colors: ['#d4af37'], gloss: 1, metal: true } },
  { id: 'usp_city',    weapon: 'pistol', name: 'Город',              rarity: 'common',    a: { type: 'camo', colors: ['#8a8d91', '#5b5e62', '#b4b7ba', '#3c3e41'] } },
  { id: 'usp_noir',    weapon: 'pistol', name: 'Неонуар',            rarity: 'rare',      a: { type: 'gradient', colors: ['#5b2a86', '#14d0c4'], gloss: 0.8 } },
  { id: 'usp_kill',    weapon: 'pistol', name: 'Подтверждённое',     rarity: 'epic',      a: { type: 'stripes', colors: ['#d9d9d9', '#b51d1d'], gloss: 0.6 }, b: { type: 'carbon', colors: ['#1c1c1c', '#303030'] } },
  { id: 'de_night',    weapon: 'deagle', name: 'Ночь',               rarity: 'common',    a: { type: 'solid', colors: ['#202226'], gloss: 0.3 } },
  { id: 'de_web',      weapon: 'deagle', name: 'Кровавая паутина',   rarity: 'epic',      a: { type: 'tiger', colors: ['#a3121c', '#140405'], gloss: 0.7 } },
  { id: 'de_gold',     weapon: 'deagle', name: 'Золото',             rarity: 'legendary', a: { type: 'solid', colors: ['#e3b23c'], gloss: 1, metal: true }, b: { type: 'solid', colors: ['#2a1d06'], gloss: 0.6 } },
  { id: 'm4_urban',    weapon: 'm4',     name: 'Городской камуфляж', rarity: 'common',    a: { type: 'camo', colors: ['#6f747a', '#4a4e53', '#9aa0a6', '#2f3236'] } },
  { id: 'm4_cyber',    weapon: 'm4',     name: 'Киберпанк',          rarity: 'epic',      a: { type: 'gradient', colors: ['#1b0f3a', '#00d2ff'], gloss: 0.8 }, b: { type: 'solid', colors: ['#ff2fd0'], gloss: 0.9 } },
  { id: 'm4_howl',     weapon: 'm4',     name: 'Вой',                rarity: 'legendary', a: { type: 'tiger', colors: ['#d1401c', '#2a0d05'], gloss: 0.6 }, b: { type: 'solid', colors: ['#e8b04a'], gloss: 1, metal: true } },
  { id: 'm4_night',    weapon: 'm4',     name: 'Ночной рейд',        rarity: 'rare',      a: { type: 'gradient', colors: ['#0f1a2e', '#5b7a99'], gloss: 0.7 }, b: { type: 'carbon', colors: ['#141414', '#262626'] } },
  { id: 'smg_neon',    weapon: 'smg',    name: 'Неоновая волна',     rarity: 'epic',      a: { type: 'fade', colors: ['#2b0a4f', '#a238ff', '#22e1ff'], gloss: 0.9 } },
  { id: 'smg_fire',    weapon: 'smg',    name: 'Пожар',              rarity: 'legendary', a: { type: 'tiger', colors: ['#ff7a1a', '#1a0a02'], gloss: 0.6 }, b: { type: 'solid', colors: ['#c9a227'], gloss: 1, metal: true } },
  { id: 'sg_chrome',   weapon: 'shotgun', name: 'Хром',              rarity: 'rare',      a: { type: 'solid', colors: ['#c7ccd2'], gloss: 1, metal: true }, b: { type: 'solid', colors: ['#2a2d31'] } },
  { id: 'sg_flame',    weapon: 'shotgun', name: 'Пламя',             rarity: 'legendary', a: { type: 'fade', colors: ['#ffe14d', '#ff6a00', '#a3001b'], gloss: 0.8 }, b: { type: 'solid', colors: ['#1a1a1a'] } },
  { id: 'smg_sand',    weapon: 'smg',    name: 'Песчаная буря',      rarity: 'common',    a: { type: 'camo', colors: ['#c9b48a', '#a38c62', '#e0d2b0', '#7d6a48'] } },
  { id: 'smg_toxic',   weapon: 'smg',    name: 'Токсин',             rarity: 'rare',      a: { type: 'stripes', colors: ['#1d1d1d', '#9cff2e'], gloss: 0.5 } },
  { id: 'sg_hunter',   weapon: 'shotgun', name: 'Охотник',           rarity: 'common',    a: { type: 'camo', colors: ['#5a4630', '#3a2d1f', '#7a6040', '#2a2016'] } },
  { id: 'sg_gold',     weapon: 'shotgun', name: 'Золотая дробь',     rarity: 'epic',      a: { type: 'solid', colors: ['#d9a53a'], gloss: 1, metal: true }, b: { type: 'carbon', colors: ['#1a1a1a', '#2a2a2a'] } },
  { id: 'kn_damascus', weapon: 'knife',  name: 'Дамасская сталь',    rarity: 'rare',      a: { type: 'damascus', colors: ['#9aa1a8', '#4d5257'], gloss: 0.9, metal: true } },
  { id: 'kn_ultra',    weapon: 'knife',  name: 'Ультрафиолет',       rarity: 'epic',      a: { type: 'solid', colors: ['#3d1f5c'], gloss: 0.7 }, b: { type: 'solid', colors: ['#1c0f2b'] } },
  { id: 'kn_web',      weapon: 'knife',  name: 'Кровавая паутина',   rarity: 'knife',     a: { type: 'tiger', colors: ['#9c0d17', '#0d0203'], gloss: 0.8 }, b: { type: 'solid', colors: ['#140405'] } },
  { id: 'kn_fade',     weapon: 'knife',  name: 'Градиент',           rarity: 'knife',     a: { type: 'fade', colors: ['#ffe14d', '#ff5fa2', '#7a3cff'], gloss: 1, metal: true } },
  { id: 'kn_doppler',  weapon: 'knife',  name: 'Допплер',            rarity: 'knife',     a: { type: 'fade', colors: ['#0b1d4f', '#7b2cbf', '#1fb5c9'], gloss: 1, metal: true }, b: { type: 'solid', colors: ['#111'] } },
  { id: 'kn_gold',     weapon: 'knife',  name: 'Золотой',            rarity: 'knife',     a: { type: 'solid', colors: ['#ffcf40'], gloss: 1, metal: true } },
  // Агенты — внешний вид персонажа (как он выглядит, задаёт AGENT_LOOKS); a — фон карточки
  { id: 'ag_swat',      weapon: 'agent_ct', name: 'Штурмовик SWAT',    rarity: 'common',    a: { type: 'gradient', colors: ['#2a3a5c', '#15181d'] } },
  { id: 'ag_seal',      weapon: 'agent_ct', name: 'Морской котик',     rarity: 'rare',      a: { type: 'camo', colors: ['#5b6a45', '#3b452d', '#7d8a5c', '#2a3120'] } },
  { id: 'ag_fbi',       weapon: 'agent_ct', name: 'Агент ФБР',         rarity: 'rare',      a: { type: 'stripes', colors: ['#111111', '#ffd400'] } },
  { id: 'ag_arctic',    weapon: 'agent_ct', name: 'Арктический отряд', rarity: 'epic',      a: { type: 'camo', colors: ['#e9eef1', '#b9c4cc', '#8d99a3', '#ffffff'] } },
  { id: 'ag_cyber',     weapon: 'agent_ct', name: 'Кибер-спецназ',     rarity: 'legendary', a: { type: 'gradient', colors: ['#0d0f14', '#00c8e0'] } },
  { id: 'ag_commander', weapon: 'agent_ct', name: 'Золотой командир',  rarity: 'knife',     a: { type: 'fade', colors: ['#b3121b', '#d9a53a', '#ffe08a'] } },
  { id: 'ag_street',    weapon: 'agent_t',  name: 'Уличный',           rarity: 'common',    a: { type: 'gradient', colors: ['#5a5d63', '#8e1b1b'] } },
  { id: 'ag_desert',    weapon: 'agent_t',  name: 'Пустынный',         rarity: 'common',    a: { type: 'gradient', colors: ['#d8c49a', '#9b8559'] } },
  { id: 'ag_pirate',    weapon: 'agent_t',  name: 'Пират',             rarity: 'rare',      a: { type: 'stripes', colors: ['#1c1c1c', '#b3121b'] } },
  { id: 'ag_jungle',    weapon: 'agent_t',  name: 'Партизан',          rarity: 'epic',      a: { type: 'camo', colors: ['#3d5a2a', '#25381a', '#5e7d3b', '#1a2612'] } },
  { id: 'ag_skull',     weapon: 'agent_t',  name: 'Череп',             rarity: 'epic',      a: { type: 'gradient', colors: ['#111111', '#e8e4d8'] } },
  { id: 'ag_demon',     weapon: 'agent_t',  name: 'Демон',             rarity: 'legendary', a: { type: 'fade', colors: ['#140303', '#a3121c', '#ff3b1f'] } },
  { id: 'ag_gold',      weapon: 'agent_t',  name: 'Золотая маска',     rarity: 'knife',     a: { type: 'solid', colors: ['#ffcf40'] } },
];
const isAgent = s => s.weapon.startsWith('agent');
// Окраски ножей выше — заготовки: каждая есть на каждом типе ножа отдельно ("kn_fade@karambit").
// Скин работает только на своём ноже, а нож сначала надо открыть убийствами.
const KNIFE_FINISHES = SKINS.filter(s => s.weapon === 'knife');
SKINS.splice(0, SKINS.length, ...SKINS.filter(s => s.weapon !== 'knife'),
  ...Object.keys(KNIVES).flatMap(type => KNIFE_FINISHES.map(f => ({ ...f, id: `${f.id}@${type}`, knife: type }))));
// Сколько убийств нужно, чтобы открыть нож (обычный есть у всех)
const KNIFE_UNLOCK = { default: 0, stiletto: 50, skeleton: 100, karambit: 150, butterfly: 200, m9: 250 };
const KNIFE_ORDER = ['default', 'stiletto', 'skeleton', 'karambit', 'butterfly', 'm9'];
// Подпись «чей скин»: у ножей — название ножа
const skinOwner = s => (s.knife ? KNIVES[s.knife] : SKIN_WEAPON_NAME[s.weapon]);
const SKIN_BY_ID = Object.fromEntries(SKINS.map(s => [s.id, s]));
const SKIN_WEAPON_NAME = { rifle: 'AKR', awp: 'AWP', pistol: 'USP-S', deagle: 'Desert Eagle', m4: 'M4', smg: 'MP5', shotgun: 'Nova', knife: 'Нож', agent_ct: 'Агент спецназа', agent_t: 'Агент террористов' };
// Силуэт человека — иконка на карточках агентов
const AGENT_ICON = '<svg class="gun" viewBox="0 0 40 40"><circle cx="20" cy="9" r="6"/><path d="M9 38V24c0-6 5-9 11-9s11 3 11 9v14z"/></svg>';

// Узор скина рисуется на холсте и становится текстурой
function paintTexture(spec) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const [c1, c2 = c1, c3 = c2, c4 = c1] = spec.colors;
  const lin = (cols, vertical) => {
    const gr = vertical ? g.createLinearGradient(0, 0, 0, 128) : g.createLinearGradient(0, 0, 128, 128);
    cols.forEach((col, i) => gr.addColorStop(i / Math.max(1, cols.length - 1), col));
    return gr;
  };
  switch (spec.type) {
    case 'gradient': g.fillStyle = lin([c1, c2]); g.fillRect(0, 0, 128, 128); break;
    case 'fade': g.fillStyle = lin(spec.colors, true); g.fillRect(0, 0, 128, 128); break;
    case 'camo':
      g.fillStyle = c1; g.fillRect(0, 0, 128, 128);
      for (const col of [c2, c3, c4]) for (let i = 0; i < 14; i++) {
        g.fillStyle = col; g.beginPath();
        g.ellipse(Math.random() * 128, Math.random() * 128, 8 + Math.random() * 16, 5 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'stripes':
      g.fillStyle = c1; g.fillRect(0, 0, 128, 128);
      g.fillStyle = c2; for (let x = -128; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 14, 0); g.lineTo(x + 142, 128); g.lineTo(x + 128, 128); g.fill(); }
      if (spec.colors[2]) { g.fillStyle = c3; g.fillRect(0, 56, 128, 16); }
      break;
    case 'tiger':
      g.fillStyle = c1; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = c2; g.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        g.lineWidth = 3 + Math.random() * 6;
        g.beginPath(); const x = Math.random() * 128;
        g.moveTo(x, -5); g.bezierCurveTo(x + 20, 40, x - 20, 80, x + 10, 133); g.stroke();
      }
      break;
    case 'carbon':
      for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) { g.fillStyle = (x + y) % 16 ? c1 : c2; g.fillRect(x, y, 8, 8); }
      break;
    case 'damascus':
      g.fillStyle = c1; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = c2; g.lineWidth = 2;
      for (let i = 0; i < 22; i++) { g.beginPath(); for (let x = 0; x <= 128; x += 8) g.lineTo(x, i * 6 + Math.sin(x / 12 + i) * 4); g.stroke(); }
      break;
    default: g.fillStyle = c1; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const paintCache = new Map();
function paintMaterial(spec, repeat = 1) {
  const key = JSON.stringify(spec) + repeat;
  if (!paintCache.has(key)) {
    const map = paintTexture(spec);
    map.repeat.set(repeat, repeat);
    paintCache.set(key, new THREE.MeshPhongMaterial({
      map, shininess: 10 + (spec.gloss ?? 0.3) * 110, specular: spec.metal ? 0xffffff : 0x333333,
    }));
  }
  return paintCache.get(key);
}
// Какие материалы оружия перекрашиваются: a — основная окраска, b — дополнительная
function skinTargets(weapon) {
  switch (weapon) {
    case 'rifle': return { a: [VM_MAT.wood, VM_MAT.bakelite], b: [VM_MAT.metal] };
    case 'awp': return { a: [AWP_MAT.green], b: [VM_MAT.metal] };
    case 'deagle': return { a: [DEAGLE_MAT], b: [VM_MAT.black] };
    case 'pistol': return { a: [VM_MAT.metal], b: [VM_MAT.black] };
    case 'm4': case 'smg': return { a: [M4_MAT], b: [VM_MAT.black] };
    case 'shotgun': return { a: [SHOTGUN_MAT, VM_MAT.wood], b: [VM_MAT.metal] };
    default: return { a: [KMAT.steel], b: [KMAT.black, KMAT.dark, KMAT.wood] };  // нож: клинок и рукоять
  }
}
// Надеть скин на уже собранную модель оружия (в руках, у персонажа, в превью)
function applySkin(group, weapon, skinId) {
  const skin = skinId && SKIN_BY_ID[skinId];
  if (!skin || (skin.weapon !== weapon && !(skin.weapon === 'knife' && KNIVES[weapon]))) return;
  if (skin.knife && weapon !== 'knife' && skin.knife !== weapon) return;  // скин керамбита не ляжет на бабочку
  const targets = skinTargets(skin.weapon === 'knife' ? 'knife' : weapon);
  const repeat = skin.weapon === 'knife' ? 12 : 1;  // у клинков текстурные координаты мелкие
  const swap = new Map();
  for (const m of targets.a) swap.set(m, paintMaterial(skin.a, repeat));
  if (skin.b) for (const m of targets.b) swap.set(m, paintMaterial(skin.b, repeat));
  group.traverse(o => { if (o.isMesh && swap.has(o.material)) o.material = swap.get(o.material); });
}

// Профиль игрока в браузере: золото, купленные и надетые скины
// knifeSkins — какой скин выбран на каждом типе ножа: { karambit: 'kn_fade@karambit', ... }
// freeCases — бесплатные кейсы за уровни { weapon: 1, knife: 0 }; rewardLevel — за какой уровень уже выдана награда;
// missions — задания дня { day, list: [{ id, p (прогресс), claimed }] }
const wallet = { gold: 1000, owned: [], equipped: {}, knifeSkins: {}, freeCases: {}, rewardLevel: null, missions: null };  // 1000 золота — подарок на старт
try { Object.assign(wallet, JSON.parse(localStorage.getItem('sa_profile') || '{}')); } catch {}
// раньше скин ножа подходил к любому ножу — такие переносим на обычный нож
const oldKnife = id => (KNIFE_FINISHES.some(f => f.id === id) ? `${id}@default` : id);
wallet.owned = [...new Set(wallet.owned.map(oldKnife))].filter(id => SKIN_BY_ID[id]);
for (const w in wallet.equipped) wallet.equipped[w] = oldKnife(wallet.equipped[w]);
if (wallet.equipped.knife) wallet.knifeSkins[SKIN_BY_ID[wallet.equipped.knife]?.knife || 'default'] ??= wallet.equipped.knife;
for (const [w, id] of Object.entries(wallet.equipped)) if (!wallet.owned.includes(id)) delete wallet.equipped[w];
// rev — номер версии кошелька: растёт с каждым изменением, по нему видно, где копия новее — в браузере или на сервере
function saveProfile(changed = true) {
  if (changed) { wallet.rev = (wallet.rev || 0) + 1; scheduleWalletUpload(); }
  try { localStorage.setItem('sa_profile', JSON.stringify(wallet)); } catch {}
  const el = document.getElementById('goldBalance');
  if (el) el.textContent = `🪙 ${wallet.gold}`;
}
// копия кошелька — в профиле на сервере (не чаще раза в пару секунд)
let walletUploadTimer = null;
function scheduleWalletUpload() {
  clearTimeout(walletUploadTimer);
  walletUploadTimer = setTimeout(() => socialSend({ type: 'wallet', wallet }), 1500);
}
// Какие скины надеты у меня — те же объекты, что в профиле
let mySkins = wallet.equipped;

function setKnifeModel(type) {
  if (viewModels.knife) { hands.remove(viewModels.knife); freeGeometry(viewModels.knife); }
  viewModels.knife = buildKnifeViewModel(type);
  applySkin(viewModels.knife, type, mySkins.knife);
  hands.add(viewModels.knife);
}
setKnifeModel('default');

// Пересобрать оружие в руках с надетыми скинами
function refreshMyWeapons() {
  for (const w of GUN_LIST) {
    const old = viewModels[w];
    const vm = buildViewModel(w);
    applySkin(vm, w, mySkins[w]);
    vm.position.copy(VM_HIP);
    vm.scale.setScalar(0.7);
    vm.visible = false;
    hands.remove(old);
    freeGeometry(old);
    hands.add(vm);
    viewModels[w] = vm;
  }
  setKnifeModel(viewModels.knife.userData.knifeType);
}

// ================== ПЕРСОНАЖ В ГЛАВНОМ МЕНЮ ==================
// Стоит у базы террористов, камера смотрит на него, а за ним — вид через всю карту к центру.
// Солнце светит с той же стороны, что и камера, поэтому персонаж освещён спереди.
// Где стоит персонаж и камера — у каждой карты своё место (поле "menu" в файле карты)
const AGENT_SPOT = new THREE.Vector3();
const MENU_DIR = new THREE.Vector3();    // от персонажа к камере
const MENU_CAM = new THREE.Vector3();
const MENU_LOOK = new THREE.Vector3();
function setMenuSpot(menu = { agent: [30, 29], toCamera: [0.725, 0.689] }) {
  AGENT_SPOT.set(menu.agent[0], 0, menu.agent[1]);
  MENU_DIR.set(menu.toCamera[0], 0, menu.toCamera[1]).normalize();
  const right = new THREE.Vector3(MENU_DIR.z, 0, -MENU_DIR.x);           // «вправо» на экране
  MENU_CAM.copy(AGENT_SPOT).addScaledVector(MENU_DIR, 4.4).setY(1.35);
  MENU_LOOK.copy(AGENT_SPOT).addScaledVector(right, -1.0).setY(1.1);      // персонаж — справа от центра
  if (menuAgent) {
    menuAgent.position.copy(AGENT_SPOT);
    menuAgent.rotation.y = Math.atan2(-MENU_DIR.x, -MENU_DIR.z) + 0.4;
  }
}
const lambert = color => new THREE.MeshLambertMaterial({ color });
const AG_MAT = { skin: lambert(0xd9a47c), boots: lambert(0x1b1b1b), black: lambert(0x222222), glove: VM_MAT.glove };
let menuAgent = null;

// Брусок от точки a до точки b (руки: плечо → локоть → кисть)
function limb(a, b, thick, mat) {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, dir.length(), thick), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// Персонаж: и в меню, и в игре (другие игроки и боты). Смотрит в -z, стоит на y = 0.
//   g ── hipL/hipR (бедро → колено → голень с ботинком)
//     └─ body (корпус, опускается при приседе) ── head (голова)
//                                              └─ aim (плечи: руки и оружие, наклон за взглядом)
const HIP_Y = 0.86, THIGH = 0.44, SHIN = 0.42;
const SHOULDER_Y = 1.36;

// Агенты (скины персонажа). Рубашка и рукава всегда цвета команды — свой/чужой видно сразу,
// а жилет, штаны, голова и детали у каждого агента свои — видно, кто именно.
// Цвет — число или узор { type, colors } (как у скинов оружия). head — что на голове.
const AGENT_LOOKS = {
  ct:            { vest: 0x2c3d55, pants: 0x2a3242, head: 'helmet', hat: 0x2c3d55 },
  t:             { vest: 0x5e4c2c, pants: 0x4d4535, head: 'balaclava' },
  ag_swat:       { vest: 0x15181d, pants: 0x1d2128, head: 'helmet', hat: 0x111111, goggles: 0x3fa9ff, stripe: 0xf2f2f2 },
  ag_seal:       { vest: 0x8a7a55, pants: { type: 'camo', colors: ['#5b6a45', '#3b452d', '#7d8a5c', '#2a3120'] }, head: 'cap', hat: 0x39432c, goggles: 0x111111 },
  ag_fbi:        { vest: 0x111111, pants: 0x23262d, head: 'cap', hat: 0x111111, goggles: 0x111111, stripe: 0xffd400 },
  ag_arctic:     { vest: 0xe8eef2, pants: { type: 'camo', colors: ['#e9eef1', '#b9c4cc', '#8d99a3', '#ffffff'] }, head: 'helmet', hat: 0xf4f7f9, goggles: 0x2fd0ff },
  ag_cyber:      { vest: 0x0d0f14, pants: 0x14171e, head: 'visor', hat: 0x0d0f14, glow: 0x00f0ff, stripe: 0x00f0ff },
  ag_commander:  { vest: { type: 'solid', colors: ['#d9a53a'], gloss: 1, metal: true }, pants: 0x1b2433, head: 'beret', hat: 0xb3121b, stripe: 0xffd84d },
  ag_street:     { vest: 0x5a5d63, pants: 0x2b3a55, head: 'bandana', hat: 0x8e1b1b, mask: 0x8e1b1b },
  ag_pirate:     { vest: 0x3a2a1c, pants: 0x1c1c1c, head: 'pirate', hat: 0xb3121b },
  ag_desert:     { vest: 0xc2a676, pants: 0x9b8559, head: 'shemagh', hat: 0xd8c49a },
  ag_jungle:     { vest: { type: 'camo', colors: ['#3d5a2a', '#25381a', '#5e7d3b', '#1a2612'] }, pants: { type: 'camo', colors: ['#3d5a2a', '#25381a', '#5e7d3b', '#1a2612'] }, head: 'bandana', hat: 0x2f4a22, mask: 0x1f2f17 },
  ag_skull:      { vest: 0x111111, pants: 0x161616, head: 'skull', stripe: 0xe8e8e8 },
  ag_demon:      { vest: 0x2a0606, pants: 0x140303, head: 'demon', hat: 0xa3121c, glow: 0xff3b1f, stripe: 0xff3b1f },
  ag_gold:       { vest: { type: 'solid', colors: ['#ffcf40'], gloss: 1, metal: true }, pants: 0x1a1a1a, head: 'goldmask', hat: 0x111111 },
};
const agentMat = c => (typeof c === 'object' ? paintMaterial(c, 1) : lambert(c));
const glowMat = c => new THREE.MeshBasicMaterial({ color: c });  // светится и в тени

function buildAgent(team, agentId = null) {
  const skin = agentId && SKIN_BY_ID[agentId];
  const look = AGENT_LOOKS[skin && skin.weapon === `agent_${team}` ? agentId : team];
  const shirt = lambert(TEAM_COLOR[team]);
  const vest = agentMat(look.vest);
  const pants = agentMat(look.pants);
  const hat = look.hat !== undefined ? agentMat(look.hat) : vest;
  const g = new THREE.Group();
  const hitBody = [], hitHead = [];  // части тела для попаданий
  const add = (parent, list, ...ms) => { for (const m of ms) { m.castShadow = true; parent.add(m); list?.push(m); } };

  // ноги: бедро вращается в тазу, голень — в колене
  const leg = side => {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, HIP_Y, 0);
    add(hip, hitBody, box(0.2, THIGH, 0.24, pants, 0, -THIGH / 2, 0));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    add(knee, hitBody, box(0.19, SHIN - 0.1, 0.22, pants, 0, -(SHIN - 0.1) / 2, 0));
    add(knee, null, box(0.22, 0.1, 0.3, AG_MAT.boots, 0, -SHIN + 0.05, -0.03));
    hip.add(knee);
    hip.userData.knee = knee;
    g.add(hip);
    return hip;
  };
  const hipL = leg(-1), hipR = leg(1);

  const body = new THREE.Group();
  g.add(body);
  add(body, hitBody,
    box(0.56, 0.62, 0.3, shirt, 0, 1.12, 0),            // туловище
    box(0.6, 0.44, 0.36, vest, 0, 1.14, 0),             // бронежилет
    box(0.58, 0.08, 0.34, AG_MAT.black, 0, 0.84, 0));   // ремень
  add(body, null,
    box(0.18, 0.12, 0.06, vest, -0.14, 1.06, -0.2),     // подсумки
    box(0.18, 0.12, 0.06, vest, 0.14, 1.06, -0.2),
    box(0.14, 0.1, 0.14, AG_MAT.skin, 0, 1.47, 0));     // шея
  const head = new THREE.Group();
  head.position.y = 1.62;
  body.add(head);
  if (look.stripe !== undefined) {  // полоса на жилете (надпись, неон)
    const stripe = look.glow ? glowMat(look.stripe) : lambert(look.stripe);
    add(body, null, box(0.62, 0.05, 0.38, stripe, 0, 1.24, 0), box(0.2, 0.05, 0.02, stripe, 0, 1.12, -0.19));
  }
  // голова: лицо/маска, потом головной убор
  const face = { balaclava: AG_MAT.black, shemagh: hat, skull: AG_MAT.black, demon: hat, goldmask: AG_MAT.black, visor: hat }[look.head] || AG_MAT.skin;
  add(head, hitHead, box(0.3, 0.32, 0.3, face, 0, 0, 0));
  const front = (w, h, mat, y, z = -0.155) => add(head, null, box(w, h, 0.02, mat, 0, y, z));
  const goggles = look.goggles !== undefined ? lambert(look.goggles) : AG_MAT.black;
  switch (look.head) {
    case 'helmet':
      add(head, hitHead, box(0.36, 0.14, 0.36, hat, 0, 0.17, 0), box(0.38, 0.04, 0.38, hat, 0, 0.11, 0));
      front(0.26, 0.06, goggles, 0.06, -0.165);
      break;
    case 'cap':  // кепка с козырьком и тёмные очки
      add(head, hitHead, box(0.32, 0.1, 0.32, hat, 0, 0.18, 0));
      add(head, null, box(0.3, 0.03, 0.14, hat, 0, 0.14, -0.2));
      front(0.24, 0.05, goggles, 0.04);
      break;
    case 'beret':
      add(head, hitHead, box(0.34, 0.07, 0.34, hat, 0.03, 0.18, 0));
      add(head, null, box(0.16, 0.06, 0.2, hat, 0.12, 0.2, 0.02));
      front(0.24, 0.03, AG_MAT.black, 0.05);
      break;
    case 'visor':  // закрытый шлем со светящимся забралом
      add(head, hitHead, box(0.36, 0.38, 0.36, hat, 0, 0.03, 0));
      front(0.3, 0.08, glowMat(look.glow), 0.04, -0.185);
      break;
    case 'balaclava':
      front(0.2, 0.06, AG_MAT.skin, 0.03);
      add(head, hitHead, box(0.32, 0.08, 0.32, shirt, 0, 0.17, 0));
      break;
    case 'bandana':  // бандана на голове и платок на лице
      add(head, hitHead, box(0.32, 0.08, 0.32, hat, 0, 0.17, 0));
      add(head, null, box(0.32, 0.13, 0.32, agentMat(look.mask), 0, -0.09, 0));
      front(0.2, 0.04, AG_MAT.black, 0.05);
      break;
    case 'pirate':
      add(head, hitHead, box(0.32, 0.09, 0.32, hat, 0, 0.17, 0));
      add(head, null, box(0.06, 0.06, 0.04, AG_MAT.black, -0.07, 0.04, -0.16), box(0.32, 0.02, 0.32, AG_MAT.black, 0, 0.06, 0));
      add(head, null, box(0.22, 0.08, 0.04, AG_MAT.black, 0, -0.1, -0.15));  // борода
      break;
    case 'shemagh':  // платок с прорезью для глаз
      add(head, hitHead, box(0.34, 0.1, 0.34, hat, 0, 0.16, 0));
      front(0.2, 0.05, AG_MAT.skin, 0.04);
      front(0.14, 0.03, AG_MAT.black, 0.04, -0.16);
      break;
    case 'skull': {  // белая маска-череп
      const bone = lambert(0xe8e4d8);
      front(0.26, 0.28, bone, 0);
      front(0.07, 0.07, AG_MAT.black, 0.04, -0.168);
      add(head, null, box(0.07, 0.07, 0.02, AG_MAT.black, -0.07, 0.04, -0.168), box(0.07, 0.07, 0.02, AG_MAT.black, 0.07, 0.04, -0.168));
      add(head, null, box(0.16, 0.03, 0.02, AG_MAT.black, 0, -0.08, -0.168));
      break;
    }
    case 'demon': {  // рога и светящиеся глаза
      const horn = lambert(0x1a1a1a);
      add(head, null, box(0.06, 0.16, 0.06, horn, -0.12, 0.22, 0), box(0.06, 0.16, 0.06, horn, 0.12, 0.22, 0));
      const eye = glowMat(look.glow);
      add(head, null, box(0.07, 0.04, 0.02, eye, -0.07, 0.04, -0.16), box(0.07, 0.04, 0.02, eye, 0.07, 0.04, -0.16));
      add(head, null, box(0.18, 0.03, 0.02, AG_MAT.black, 0, -0.08, -0.16));
      break;
    }
    case 'goldmask': {
      const gold = paintMaterial({ type: 'solid', colors: ['#ffcf40'], gloss: 1, metal: true }, 1);
      front(0.27, 0.3, gold, -0.01);
      add(head, null, box(0.07, 0.04, 0.02, AG_MAT.black, -0.07, 0.04, -0.168), box(0.07, 0.04, 0.02, AG_MAT.black, 0.07, 0.04, -0.168));
      add(head, hitHead, box(0.32, 0.08, 0.32, hat, 0, 0.17, 0));
      break;
    }
  }
  const bombPack = box(0.32, 0.36, 0.14, lambert(0x4b5a32), 0, 1.16, 0.24);  // бомба за спиной у носителя
  bombPack.visible = false;
  body.add(bombPack);
  const aim = new THREE.Group();   // плечевой пояс: наклоняется вверх-вниз за взглядом
  aim.position.y = SHOULDER_Y;
  const hold = new THREE.Group();  // то, что в руках
  const arms = new THREE.Group();
  aim.add(hold, arms);
  body.add(aim);
  g.userData = { body, head, aim, hold, arms, hipL, hipR, shirt, team, hitBody, hitHead, bombPack };
  return g;
}

// Как держать предмет (координаты — от середины плеч): позиция, поворот, масштаб, где кисти
const STANCES = {
  rifleLow: { pos: [0.08, -0.34, -0.36], rot: [-0.45, 0.65, 0.25], scale: 0.66 },  // меню: низкая стойка
  rifle:    { pos: [0.14, -0.12, -0.3],  rot: [0, 0.05, 0],        scale: 0.66 },  // в игре: у плеча
  pistol:   { pos: [0.03, -0.1, -0.5],   rot: [0, 0, 0],           scale: 0.9 },   // двумя руками перед собой
  knife:    { pos: [0.24, -0.36, -0.26], rot: [0.5, 0.25, 0],      scale: 1.7 },
};

// Что персонаж держит: 'rifle', 'pistol' или тип ножа; low — низкая стойка (для меню)
function setAgentItem(agent, item, low = false, skin = null) {
  const u = agent.userData;
  freeGeometry(u.hold); u.hold.clear();   // старое оружие и руки — убрать и освободить память
  freeGeometry(u.arms); u.arms.clear();
  const inner = new THREE.Group();
  u.hold.add(inner);
  let st, right, left;
  if (PRIMARY.includes(item)) {
    GUN_BUILDERS[item](inner);
    st = low ? STANCES.rifleLow : STANCES.rifle;
    right = new THREE.Vector3(0.005, -0.085, 0.14);   // пистолетная рукоять
    left = new THREE.Vector3(0, -0.05, item === 'smg' ? -0.24 : -0.33);  // цевьё
  } else if (item === 'pistol' || item === 'deagle') {
    (item === 'deagle' ? buildDeagle : buildPistol)(inner);
    st = STANCES.pistol;
    right = new THREE.Vector3(0.01, -0.07, 0.03);
    left = new THREE.Vector3(-0.05, -0.08, 0.02);     // левая поддерживает снизу
  } else if (isNade(item)) {
    buildNade(inner, item);
    st = STANCES.knife;
    right = new THREE.Vector3(0, -0.02, 0);
  } else {
    buildKnife(item, inner);
    st = STANCES.knife;
    right = new THREE.Vector3(0, 0, 0.06);
  }
  inner.scale.setScalar(st.scale);
  applySkin(inner, item, skin);
  u.hold.position.set(...st.pos);
  u.hold.rotation.set(...st.rot);
  u.holdZ = st.pos[2];
  inner.traverse(o => { o.castShadow = true; });
  u.hold.updateMatrix();
  inner.updateMatrix();
  const toAim = p => p.clone().applyMatrix4(inner.matrix).applyMatrix4(u.hold.matrix);
  const arm = (shoulder, hand, side) => {
    const elbow = shoulder.clone().lerp(hand, 0.5).add(new THREE.Vector3(0.12 * side, -0.16, 0.06));
    u.arms.add(limb(shoulder, elbow, 0.13, u.shirt), limb(elbow, hand, 0.12, u.shirt));
    u.arms.add(agentHand(elbow, hand, side));
  };
  arm(new THREE.Vector3(0.31, 0, 0), toAim(right), 1);
  // левая рука — на цевье/рукояти или опущена вдоль тела, если в руке нож
  arm(new THREE.Vector3(-0.31, 0, 0), left ? toAim(left) : new THREE.Vector3(-0.36, -0.44, -0.04), -1);
}

// Кисть персонажа: продолжает предплечье (ось y — от локтя к кисти), пальцы согнуты вперёд в кулак,
// большой палец сбоку; кончики пальцев — кожа (перчатки без пальцев, как у вида от первого лица)
function agentHand(elbow, hand, side) {
  const h = new THREE.Group();
  h.position.copy(hand);
  h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hand.clone().sub(elbow).normalize());
  const { glove, skin, strap, pad } = HAND_MAT;
  h.add(box(0.11, 0.05, 0.11, strap, 0, -0.045, 0));        // манжета
  h.add(box(0.1, 0.08, 0.075, glove, 0, 0.01, 0));          // ладонь
  h.add(box(0.1, 0.03, 0.02, pad, 0, 0.04, 0.04));          // костяшки
  for (let i = 0; i < 4; i++) {
    const x = -0.036 + i * 0.024;
    h.add(box(0.021, 0.035, 0.03, glove, x, 0.06, 0.005));   // первые фаланги
    h.add(box(0.02, 0.022, 0.035, skin, x, 0.062, -0.03));   // согнутые кончики
  }
  h.add(box(0.028, 0.06, 0.028, glove, 0.055 * side, 0.015, -0.03, 0, 0));  // большой палец
  h.add(box(0.026, 0.022, 0.026, skin, 0.055 * side, 0.052, -0.035));
  h.traverse(o => { o.castShadow = true; });
  return h;
}

// Поставить ногу: угол бедра и колена → на какой высоте при этом таз
function legPose(hip, thigh, knee) {
  hip.rotation.x = thigh;
  hip.userData.knee.rotation.x = knee;
  return THIGH * Math.cos(thigh) + SHIN * Math.cos(thigh + knee);
}

// Анимация персонажа в игре. s: speed (м/с), walk (фаза шага), crouch (0..1), air (в прыжке),
// pitch (куда смотрит), kick (отдача 0..1), swing ({ kind, t } — удар ножом)
function animateAgent(agent, s) {
  const u = agent.userData;
  const amp = Math.min(1, s.speed / 5);
  let tl, tr, kl, kr;
  if (s.air) {
    tl = 0.7; tr = 0.35; kl = -1.1; kr = -0.8;  // в прыжке ноги поджаты
  } else {
    const sw = Math.sin(s.walk);
    tl = sw * 0.6 * amp;
    tr = -sw * 0.6 * amp;
    // колено сгибается, когда нога проходит вперёд
    kl = -Math.max(0, Math.cos(s.walk)) * 0.9 * amp;
    kr = -Math.max(0, -Math.cos(s.walk)) * 0.9 * amp;
  }
  const c = s.crouch;
  tl += 1.25 * c; tr += 1.25 * c; kl -= 2.1 * c; kr -= 2.1 * c;
  // таз опускается так, чтобы более длинная (прямая) нога стояла на земле
  const legH = s.air ? HIP_Y : Math.max(legPose(u.hipL, tl, kl), legPose(u.hipR, tr, kr));
  if (s.air) { legPose(u.hipL, tl, kl); legPose(u.hipR, tr, kr); }
  const drop = HIP_Y - legH;
  u.hipL.position.y = u.hipR.position.y = HIP_Y - drop;
  u.body.position.y = -drop + Math.abs(Math.sin(s.walk)) * 0.035 * amp;  // покачивание при шаге
  u.body.rotation.y = Math.sin(s.walk) * 0.06 * amp;
  const pitch = Math.max(-0.9, Math.min(0.9, s.pitch));
  u.aim.rotation.set(pitch + s.kick * 0.12, 0, 0);
  u.head.rotation.x = pitch * 0.5;
  u.hold.position.z = u.holdZ + s.kick * 0.05;
  if (s.swing) {
    const k = Math.sin(Math.PI * s.swing.t);
    if (s.swing.kind === 'slash') { u.aim.rotation.y = 0.8 * k; u.aim.rotation.z = -0.5 * k; }
    else u.hold.position.z = u.holdZ - 0.25 * (s.swing.t < 0.3 ? s.swing.t / 0.3 : 1 - (s.swing.t - 0.3) / 0.7);
  }
}

function showMenuAgent(team, item, agentId = mySkins[`agent_${team}`]) {
  if (menuAgent) { scene.remove(menuAgent); freeGeometry(menuAgent); }
  menuAgent = buildAgent(team, agentId);
  menuAgent.position.copy(AGENT_SPOT);
  menuAgent.rotation.y = Math.atan2(-MENU_DIR.x, -MENU_DIR.z) + 0.4;  // лицом к камере, вполоборота
  scene.add(menuAgent);
  menuHold(item);
}
// Что персонаж держит в меню; без скина — надетый у игрока
function menuHold(item, skin = mySkins[KNIVES[item] ? 'knife' : item]) {
  setAgentItem(menuAgent, item, true, skin);
}

// Камера и «дыхание» персонажа в меню
function updateMenuScene(now) {
  const t = now / 1000;
  const { body, head } = menuAgent.userData;
  body.position.y = Math.sin(t * 1.6) * 0.008;
  body.rotation.y = Math.sin(t * 0.5) * 0.04;
  head.rotation.y = Math.sin(t * 0.37) * 0.12;
  camera.position.copy(MENU_CAM).add(new THREE.Vector3(Math.sin(t * 0.2) * 0.1, Math.sin(t * 0.31) * 0.03, 0));
  camera.lookAt(MENU_LOOK);
  if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
}

const flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
const flashLight = new THREE.PointLight(0xffaa44, 0, 6);
flash.add(flashLight);
flash.visible = false;

// ================== СОСТОЯНИЕ ИГРОКА ==================
const me = {
  id: null, team: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, onGround: false, alive: false, hp: 100,
  weapon: 'pistol', ammo: {}, reloadEnd: 0, nextShot: 0, heat: 0, ads: false, crouch: 0,
  spray: 0, kickP: 0, kickY: 0, lastShotAt: 0,   // узор отдачи: номер пули в очереди и подброс камеры
};
function refillAmmo() {
  for (const [k, w] of Object.entries(WEAPONS)) me.ammo[k] = { mag: w.mag, reserve: w.reserve };
}
refillAmmo();

// Снаряжение — его присылает сервер: деньги, основное оружие, пистолет, броня, гранаты
const inv = { money: 800, primary: null, secondary: 'pistol', armor: 0, nades: { he: 0, flash: 0, smoke: 0 } };
const owns = w => w === 'knife' || w === inv.primary || w === inv.secondary || (isNade(w) && inv.nades[w] > 0);
const bestWeapon = () => inv.primary || inv.secondary || 'knife';
const ownedList = () => [inv.primary, inv.secondary, 'knife', ...NADE_KINDS.filter(n => inv.nades[n] > 0)].filter(Boolean);
let scope = 0;  // прицел AWP: 0 — нет, 1 — приближение, 2 — сильное приближение

const keys = {};
let mouseDown = false, triggerLatched = false, inGame = false, chatOpen = false;
let lastSnapshot = { players: [], score: { ct: 0, t: 0 } };

// ================== DOM ==================
const $ = id => document.getElementById(id);
const ui = {
  menu: $('menu'), hud: $('hud'), name: $('nameInput'), play: $('playBtn'), status: $('status'),
  hp: $('hp'), ammo: $('ammo'), reserve: $('reserve'), weapon: $('weaponName'), reloadBar: $('reloadBar'),
  scoreCT: $('scoreCT'), scoreT: $('scoreT'), killfeed: $('killfeed'), hit: $('hitmarker'),
  dmg: $('damageFlash'), death: $('deathScreen'), deathText: $('deathText'), respawnText: $('respawnText'),
  banner: $('banner'), sb: $('scoreboard'), sbCT: $('sbCT'), sbT: $('sbT'), pause: $('pauseHint'),
  chatLog: $('chatLog'), chatInput: $('chatInput'), team: $('teamBadge'),
  timer: $('roundTimer'), killNotice: $('killNotice'),
  bombHint: $('bombHint'), actionBar: $('actionBar'), actionLabel: $('actionLabel'), actionFill: $('actionFill'),
  money: $('money'), moneyDelta: $('moneyDelta'), armor: $('armorIcon'), buyHint: $('buyHint'),
  scope: $('scope'), crosshair: $('crosshair'), flash: $('flashOverlay'),
};
try { ui.name.value = localStorage.getItem('sa_name') || ''; } catch {}

// ================== МЕНЮ: РЕЖИМ, СЛОЖНОСТЬ, РАЗМЕР КОМАНД ==================
const DIFF_NAME = { easy: 'Лёгкий', normal: 'Средний', hard: 'Сложный', expert: 'Эксперт' };
const DIFF_INFO = {
  easy: 'Медленно реагируют и часто мажут — для разминки.',
  normal: 'Обычные соперники: реагируют за полсекунды.',
  hard: 'Быстрая реакция, метко стреляют, чаще в голову.',
  expert: 'Почти мгновенная реакция и много хедшотов. Удачи!',
};
const settings = { mode: 'online', diff: 'normal', size: 5, knife: 'default', agent: 'ct', gameMode: 'bomb', map: 'desert' };
let myKnife = 'default';
try { Object.assign(settings, JSON.parse(localStorage.getItem('sa_settings') || '{}')); } catch {}
// Профиль на сервере (соединение /social): ключ профиля, я, друзья, лобби
let socialToken = null;
try { socialToken = localStorage.getItem('sa_token'); } catch {}
let socialWs = null, profileMe = null, friendsData = { friends: [], incoming: [], outgoing: [] }, lobbyState = null;

// Ножи открываются убийствами (считает сервер в профиле). Пока профиль не пришёл — последнее известное число
let knownKills = 0;
try { knownKills = +(localStorage.getItem('sa_kills') || 0); } catch {}
const myKills = () => profileMe?.stats.kills ?? knownKills;
const knifeOpen = type => myKills() >= (KNIFE_UNLOCK[type] ?? Infinity);
// надетый скин ножа — тот, что выбран для текущего типа ножа
function syncKnifeSkin() {
  const id = wallet.knifeSkins[settings.knife];
  if (id && wallet.owned.includes(id)) wallet.equipped.knife = id;
  else delete wallet.equipped.knife;
}
// выбранный нож закрыт (например, профиль новый) — берём обычный
function validateKnife() {
  if (!knifeOpen(settings.knife)) settings.knife = 'default';
  syncKnifeSkin();
  saveProfile();
}

// Большая кнопка: в лобби — «Создать лобби» / «Начать» / ожидание
function updatePlayButton() {
  const play = $('playBtn');
  if (inGame) return;
  play.classList.toggle('long', settings.mode === 'lobby');
  if (settings.mode !== 'lobby') { play.textContent = 'ИГРАТЬ'; play.disabled = false; return; }
  const host = lobbyState && profileMe && lobbyState.host === profileMe.id;
  if (!lobbyState) { play.textContent = 'СОЗДАТЬ ЛОББИ'; play.disabled = !profileMe; }
  else if (lobbyState.inGame) { play.textContent = 'ИДЁТ ИГРА'; play.disabled = true; }
  else if (!host) { play.textContent = 'ЖДЁМ ХОЗЯИНА'; play.disabled = true; }
  else if (lobbyState.members.length < 2) { play.textContent = 'ЖДЁМ СОПЕРНИКА'; play.disabled = true; }
  else { play.textContent = 'НАЧАТЬ'; play.disabled = false; }
}

function renderMenu() {
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('active', b.dataset.mode === settings.mode);
  for (const b of document.querySelectorAll('#gameModeSeg button')) b.classList.toggle('active', b.dataset.gm === settings.gameMode);
  for (const b of document.querySelectorAll('#mapGrid button')) b.classList.toggle('active', b.dataset.map === settings.map);
  for (const b of document.querySelectorAll('#diffSeg button')) b.classList.toggle('active', b.dataset.diff === settings.diff);
  for (const b of document.querySelectorAll('#sizeSeg button')) b.classList.toggle('active', +b.dataset.size === settings.size);
  for (const b of document.querySelectorAll('#knifeSeg button')) b.classList.toggle('active', b.dataset.knife === settings.knife);
  $('knifeName').textContent = KNIVES[settings.knife] || '';
  for (const b of document.querySelectorAll('#agentSeg button')) b.classList.toggle('active', b.dataset.team === settings.agent);
  $('soloOptions').classList.toggle('hidden', settings.mode !== 'solo');
  $('commonOptions').classList.toggle('hidden', settings.mode === 'lobby');  // в лобби карта и режим — в правилах лобби
  $('lobbyOptions').classList.toggle('hidden', settings.mode !== 'lobby');
  updatePlayButton();
  $('diffInfo').textContent = DIFF_INFO[settings.diff];
  try { localStorage.setItem('sa_settings', JSON.stringify(settings)); } catch {}
}
for (const [seg, key, read] of [['modeSeg', 'mode', b => b.dataset.mode], ['gameModeSeg', 'gameMode', b => b.dataset.gm], ['diffSeg', 'diff', b => b.dataset.diff], ['sizeSeg', 'size', b => +b.dataset.size]]) {
  for (const b of document.querySelectorAll(`#${seg} button`)) b.addEventListener('click', () => { settings[key] = read(b); renderMenu(); });
}
renderMenu();

// ================== СЕТЬ ==================
let ws = null;
function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

// Выход в меню (клавиша K дважды): отключаемся и чистим всё, что осталось от игры
let leaving = false, leaveArmedUntil = 0;
function leaveGame() {
  if (performance.now() > leaveArmedUntil) {
    leaveArmedUntil = performance.now() + 2500;
    addChat('Нажми K ещё раз, чтобы выйти в меню');
    return;
  }
  leaving = true;
  ws.close();
}
function backToMenu(status) {
  inGame = false;
  leaving = false;
  bomb = null;
  usingE = false;
  loadMap(settings.map);  // фон меню — карта, выбранная в меню
  me.alive = false;
  for (const id of [...remotes.keys()]) removeRemote(id);
  lastSnapshot = { players: [], score: { ct: 0, t: 0 } };
  clearInterval(deathTimer);
  for (const el of [ui.death, ui.banner, ui.sb, teamMenu, $('cheatPanel'), $('matchSummary')]) el.classList.add('hidden');
  cheatPanelOpen = false;
  teamMenuOpen = false;
  ui.killfeed.replaceChildren();
  ui.chatLog.replaceChildren();
  ui.hud.classList.add('hidden'); ui.menu.classList.remove('hidden');
  ui.play.disabled = false; ui.status.textContent = status;
  updatePlayButton();
  document.exitPointerLock();
}

function connect(name, room = null) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => send({ type: 'join', name, mode: settings.mode, difficulty: settings.diff, botFill: settings.size, knife: settings.knife, gameMode: settings.gameMode, map: settings.map, skins: mySkins, token: socialToken, room, ownerKey });
  ws.onclose = () => { if (inGame || !denied) backToMenu(leaving ? '' : 'Соединение с сервером потеряно'); denied = false; };
  ws.onmessage = e => handle(JSON.parse(e.data));
}

let denied = false;
function handle(m) {
  switch (m.type) {
    case 'denied':  // в игру лобби пускают только его участников
      denied = true;
      backToMenu(m.text);
      break;
    case 'welcome':
      me.id = m.id;
      gameMode = m.mode || 'tdm';
      if (m.map) loadMap(m.map);  // карта этой игры (в онлайне её мог выбрать другой игрок)
      $('winScore2').textContent = m.roundsToWin;
      modeLabel = m.solo ? `Оффлайн · ${DIFF_NAME[m.difficulty]} · ${m.botFill}×${m.botFill}`
        : m.lobby ? `Лобби 1 на 1 · ${m.lobby}` : '';
      rules = { speed: 1, jump: 1, gravity: 1, ...(m.rules || {}) };
      cheatsAllowed = !!m.cheatsAllowed;
      Object.assign(cheat, CHEAT_OFF);  // новая игра — всё выключено
      cheatsOn = false;
      $('cheatBadge').classList.add('hidden');
      if (cheatsAllowed) addChat('🛠 F6 — панель читов (все увидят метку 🛠 у твоего ника)');
      myKnife = KNIVES[settings.knife] ? settings.knife : 'default';
      setKnifeModel(myKnife);
      me.weapon = 'pistol';
      setTeam(m.team);
      respawn(m.pos, m.yaw);
      if (!m.alive) setDead('Раунд уже идёт', 'Ждём следующего раунда...');
      inGame = true;
      ui.menu.classList.add('hidden'); ui.hud.classList.remove('hidden');
      updatePauseHint();
      break;
    case 'teamChanged':
      setTeam(m.team);
      // пересоздаём модели игроков: ники видны только над союзниками
      for (const id of [...remotes.keys()]) removeRemote(id);
      respawn(m.pos, m.yaw);
      if (!m.alive) setDead('Ты сменил команду', 'Ждём следующего раунда...');
      break;
    case 'roundStart':
      $('matchSummary').classList.add('hidden');     // итоги прошлого матча — убрать
      if (m.round === 1) { matchGold = 0; matchAch = []; }  // новый матч — копим заново
      showBanner(m.mode === 'bomb' ? `РАУНД ${m.round} · ЗАКЛАДКА БОМБЫ` : `РАУНД ${m.round}`, 0xffffff, 1800);
      usingE = false;
      playTone(660, 0.15, 0.1, 'sine');
      break;
    case 'inventory': {
      Object.assign(inv, { money: m.money, primary: m.primary, secondary: m.secondary, armor: m.armor, nades: m.nades, sellable: m.sellable || [] });
      if (m.sold) playTone(520, 0.06, 0.08, 'sine');
      if (m.delta) showMoneyDelta(m.delta, m.reason);
      if (m.picked && WEAPONS[m.picked]) {
        // подобрал с земли — с теми патронами, что в нём остались
        const full = WEAPONS[m.picked], a = m.ammo;
        me.ammo[m.picked] = a && Number.isFinite(a.mag) && Number.isFinite(a.reserve)
          ? { mag: Math.min(full.mag, Math.max(0, a.mag)), reserve: Math.min(full.reserve, Math.max(0, a.reserve)) }
          : { mag: full.mag, reserve: full.reserve };
        playTone(620, 0.06, 0.08, 'sine');
        // основное оружие — сразу в руки; пистолет — если в руках был нож
        // (и если старое оружие из рук ушло на землю при обмене)
        if (m.picked === inv.primary && me.weapon !== m.picked || me.weapon === 'knife' || !owns(me.weapon)) switchWeapon(m.picked);
      } else if (m.bought && WEAPONS[m.bought]) {
        // купил оружие — сразу в руки, с полным магазином
        me.ammo[m.bought] = { mag: WEAPONS[m.bought].mag, reserve: WEAPONS[m.bought].reserve };
        switchWeapon(m.bought);
      } else if (m.bought) {
        playTone(900, 0.06, 0.08, 'sine');
      } else if (!owns(me.weapon)) {
        // бросил последнюю гранату или потерял оружие — берём лучшее, что есть
        setTimeout(() => { if (!owns(me.weapon)) switchWeapon(bestWeapon()); }, isNade(me.weapon) ? 350 : 0);
      }
      renderBuyMenu();
      break;
    }
    case 'gunDrop':  // кто-то выбросил оружие — глухой стук
      if (m.id !== me.id) playShot(Math.max(0, 0.25 - new THREE.Vector3(...m.pos).distanceTo(camera.position) / 120), 700, 0.08);
      break;
    case 'throw':
      if (m.id !== me.id) playShot(0.2, 500, 0.15);
      break;
    case 'detonate':
      detonateEffect(m.kind, m.pos);
      break;
    case 'flashed':
      flashMe(m.duration);
      break;
    case 'mapChange':
      loadMap(m.map).then(() => showBanner(`КАРТА: ${(MAP_LIST.find(x => x.id === m.map)?.name || m.map).toUpperCase()}`, 0xffffff, 2500));
      break;
    case 'bombPlanted':
      showBanner(`БОМБА ЗАЛОЖЕНА НА ТОЧКЕ ${m.site}`, 0xff4d4d, 2500);
      addChat(`💣 ${m.by} заложил бомбу на точке ${m.site}`);
      playTone(880, 0.12, 0.15, 'square');
      setTimeout(() => playTone(660, 0.18, 0.15, 'square'), 140);
      break;
    case 'bombDefused':
      addChat(`✂ ${m.by} разминировал бомбу`);
      playTone(1200, 0.25, 0.12, 'sine');
      break;
    case 'explode':
      explodeEffect(m.pos);
      break;
    case 'roundEnd': {
      const REASON = {
        bomb: 'БОМБА ВЗОРВАНА — ПОБЕДА ТЕРРОРИСТОВ',
        defuse: 'БОМБА ОБЕЗВРЕЖЕНА — ПОБЕДА СПЕЦНАЗА',
        time: gameMode === 'bomb' ? 'ВРЕМЯ ВЫШЛО — ПОБЕДА СПЕЦНАЗА' : null,
      };
      const text = !m.winner ? 'НИЧЬЯ' : REASON[m.reason] || `${TEAM_NAME[m.winner].toUpperCase()} ВЫИГРАЛИ РАУНД`;
      // MVP раунда: сапёр, тот, кто заложил бомбу, или лучший по убийствам в победившей команде
      let sub = '';
      if (m.mvp) {
        const n = m.mvp.kills;
        const kills = `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'убийство' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'убийства' : 'убийств'}`;
        const why = { defuse: 'разминировал бомбу', bomb: 'заложил бомбу' }[m.mvp.why] || `больше всех убийств (${kills})`;
        sub = `★ MVP раунда: ${m.mvp.name} — ${why}`;
      }
      const mineMvp = m.mvp?.id === me.id;
      if (m.winner && m.winner === me.team) { addGold(5, 'победа в раунде'); missionEvent('round'); }
      if (mineMvp) { addGold(10, 'MVP'); missionEvent('mvp'); }
      showBanner(text, m.winner ? TEAM_COLOR[m.winner] : 0xffffff, 3500, sub, mineMvp);
      playTone(m.winner === me.team ? 880 : 220, 0.4, 0.12, 'sine');
      if (mineMvp) setTimeout(() => { playTone(1046, 0.15, 0.1, 'sine'); setTimeout(() => playTone(1568, 0.3, 0.1, 'sine'), 150); }, 400);
      break;
    }
    case 'snapshot': applySnapshot(m); break;
    case 'respawn': respawn(m.pos, m.yaw); break;
    case 'damaged':
      me.hp = m.hp;
      ui.dmg.style.transition = 'none'; ui.dmg.style.opacity = 1;
      requestAnimationFrame(() => { ui.dmg.style.transition = 'opacity .5s'; ui.dmg.style.opacity = 0; });
      playTone(140, 0.12, 0.2, 'sawtooth');
      break;
    case 'hitConfirm':
      ui.hit.className = 'show' + (m.head ? ' head' : '');
      setTimeout(() => ui.hit.className = '', 60);
      playTone(m.head ? 1400 : 900, m.kill ? 0.2 : 0.05, 0.12);
      break;
    case 'kill': onKill(m); break;
    case 'shot': {
      const from = new THREE.Vector3(...m.from), to = new THREE.Vector3(...m.to);
      if (watching && m.id === watching.data.id) {
        // стреляет тот, за кем наблюдаем: отдача, вспышка и звук как от своего выстрела
        const w = shownWeapon();
        vmKick = 1;
        const muzzle = shownVM().userData.muzzle;
        muzzle.add(flash);
        flash.visible = true; flashLight.intensity = 3;
        setTimeout(() => { flash.visible = false; flashLight.intensity = 0; }, 40);
        spawnTracer(muzzle.getWorldPosition(new THREE.Vector3()), to);
        playShot(1, w === 'pistol' ? 3000 : 2200, w === 'pistol' ? 0.15 : 0.22);
        break;
      }
      spawnTracer(from, to);
      const dist = from.distanceTo(camera.position);
      playShot(Math.max(0, 1 - dist / 70) * 0.8, 1200);
      const shooter = remotes.get(m.id);
      if (shooter) {
        shooter.kick = 1;  // оружие в руках у стрелявшего дёргается
        if (shooter.team !== me.team && dist < 45) shooter.radarUntil = performance.now() + 1000;  // выстрел слышно — видно на радаре
      }
      break;
    }
    case 'swing': {
      // кто-то ударил ножом: анимация у его модели, а если наблюдаем за ним — от первого лица
      const r = remotes.get(m.id);
      if (r && KNIFE_SWING_TIME[m.kind]) r.swing = { kind: m.kind, start: performance.now() };
      if (watching && m.id === watching.data.id) playAnim(m.kind);
      playShot(0.15, 700, 0.1);
      break;
    }
    case 'leave': removeRemote(m.id); break;
    case 'chat': addChat(m.text); break;
    case 'matchEnd':
      if (m.winner === me.team) addGold(25, 'победа в матче');
      if (m.summary) showMatchSummary(m);
      else showBanner(m.winner === me.team ? 'ПОБЕДА В МАТЧЕ!' : 'ПОРАЖЕНИЕ В МАТЧЕ', TEAM_COLOR[m.winner], 6000);
      break;
  }
}

let modeLabel = '';
function setTeam(team) {
  me.team = team;
  VM_MAT.sleeve.color.set(TEAM_COLOR[team]);
  ui.team.textContent = TEAM_NAME[team] + (modeLabel.startsWith('Лобби') ? '' : ' · M — сменить');
  if (modeLabel) {
    const small = document.createElement('small');
    small.textContent = modeLabel;
    ui.team.append(small);
  }
  ui.team.style.background = team === 'ct' ? 'rgba(56,120,220,.85)' : 'rgba(220,140,40,.85)';
}

function respawn(pos, yaw) {
  me.pos.set(...pos); me.vel.set(0, 0, 0);
  me.yaw = yaw; me.pitch = 0; me.hp = 100; me.alive = true;
  me.reloadEnd = 0; me.heat = 0; me.crouch = 0;
  me.spray = 0; me.kickP = 0; me.kickY = 0;
  refillAmmo();
  watching = null;  // снова своё оружие, а не того, за кем наблюдали
  scope = 0;
  if (!owns(me.weapon)) me.weapon = bestWeapon();
  drawWeapon();
  spectateId = null;
  ui.death.classList.add('hidden');
  ui.reloadBar.style.visibility = 'hidden';
}

// Смерть: в разминке — отсчёт до возрождения, в раунде — наблюдение за союзниками
let deathTimer = null, myDeathAt = 0, spectateId = null;
function setDead(title, sub, countdown = 0) {
  me.alive = false;
  me.ads = false;
  myDeathAt = performance.now();
  ui.deathText.textContent = title;
  ui.respawnText.textContent = sub;
  ui.death.classList.remove('hidden');
  clearInterval(deathTimer);
  if (countdown) {
    let t = countdown;
    ui.respawnText.textContent = `Возрождение через ${t}...`;
    deathTimer = setInterval(() => {
      t--;
      if (t <= 0 || me.alive) { clearInterval(deathTimer); return; }
      ui.respawnText.textContent = `Возрождение через ${t}...`;
    }, 1000);
  }
}

// Иконки для килфида (простые SVG-картинки, цвет берут из CSS)
const ICONS = {
  // силуэт АК: приклад, коробка с крышкой, цевьё, газовая трубка, ствол, мушка,
  // дульный тормоз, рукоять, спусковая скоба и изогнутый магазин
  rifle: '<svg viewBox="0 0 100 30" class="gun">'
    + '<path d="M2 7L6 7L23 9.5L23 13.5L6 19L2 19Z"/>'
    + '<path d="M22 7Q22 5 25 5L48 5L48 3.5L52 3.5L52 6.5L74 6.5L74 9L91 9L91 8L98 8L98 12L91 12L91 11L68 11L68 14L22 14Z"/>'
    + '<path d="M83 9L83 4.5L85.5 4.5L85.5 9Z"/>'
    + '<path d="M31 13.5L37 13.5L34.5 25L27.5 24Z"/>'
    + '<path d="M37 13.5L38 17.5L43 17.5L43 13.5L41.5 13.5L41.5 16L39.3 16L38.6 13.5Z"/>'
    + '<path d="M43 13.5L51 13.5Q52.5 21 58 26.5L50.5 29Q45 22 43 13.5Z"/>'
    + '</svg>',
  pistol: '<svg viewBox="0 0 34 20" class="gun"><path d="M2 3h30v6H16l-1 2h-3l-2 8H3l3-10H2z"/></svg>',
  // M4: приклад, коробка с ручкой-планкой, цевьё с рёбрами, ствол, прямой магазин
  m4: '<svg viewBox="0 0 100 30" class="gun"><path d="M2 8L18 8L18 11L22 11L22 15L18 15L2 18Z"/>'
    + '<path d="M22 7L48 7L48 4L52 4L52 7L72 7L72 9L92 9L92 7.5L98 7.5L98 12.5L92 12.5L92 11L72 11L72 14L22 14Z"/>'
    + '<path d="M85 9L85 4.5L87 4.5L87 9Z"/><path d="M30 13.5L36 13.5L33.5 24L27 23Z"/>'
    + '<path d="M42 13.5L49 13.5L51 27L44 27.5Z"/></svg>',
  // MP5: короткий корпус, изогнутый магазин, складной приклад
  smg: '<svg viewBox="0 0 70 30" class="gun"><path d="M2 8L14 8L14 10L2 10Z"/><path d="M2 8L4 8L4 18L2 18Z"/>'
    + '<path d="M14 6L50 6L50 8L64 8L64 11L50 11L50 13L14 13Z"/><path d="M22 12.5L28 12.5L25.5 23L19 22Z"/>'
    + '<path d="M32 12.5L38 12.5Q39 20 43 25L37 27Q33 21 32 12.5Z"/></svg>',
  // Nova: длинный ствол, трубчатый магазин, помпа, приклад
  shotgun: '<svg viewBox="0 0 110 26" class="gun"><path d="M2 9L8 8L28 10L28 15L8 18L2 18Z"/>'
    + '<path d="M28 7L46 7L46 14L28 14Z"/><path d="M46 8L106 8L106 11L46 11Z"/><path d="M46 11.5L84 11.5L84 14L46 14Z"/>'
    + '<path d="M60 10.5L76 10.5L76 16L60 16Z"/><path d="M34 13.5L40 13.5L37 23L31 22Z"/></svg>',
  bomb: '<svg viewBox="0 0 30 20" class="gun"><path d="M3 7h24v10H3z"/><path d="M6 3h5v4H6z"/><path d="M15 9h7v3h-7z" fill="#ff4d4d"/></svg>',
  awp: '<svg viewBox="0 0 110 26" class="gun"><path d="M2 9L8 8L26 10L26 15L8 17L2 18Z"/><path d="M26 9L60 9L60 15L26 15Z"/>'
    + '<path d="M60 11L100 11L100 13L60 13Z"/><path d="M100 10L108 10L108 14L100 14Z"/><path d="M32 3L58 3L58 7L32 7Z"/>'
    + '<path d="M36 7L39 7L39 9L36 9ZM51 7L54 7L54 9L51 9Z"/><path d="M33 15L39 15L36 25L30 24Z"/><path d="M42 15L48 15L48 20L42 20Z"/></svg>',
  deagle: '<svg viewBox="0 0 40 22" class="gun"><path d="M2 3L37 3L37 10L18 10L16 13L13 13L11 21L3 21L6 10L2 10Z"/></svg>',
  he: '<svg viewBox="0 0 20 24" class="gun"><path d="M5 9h10v13H5z"/><path d="M7 4h6v5H7z"/><path d="M13 5l5 4-1 1-5-3z"/></svg>',
  flash: '<svg viewBox="0 0 20 24" class="gun"><path d="M5 8h10v15H5z"/><path d="M7 3h6v5H7z"/><path d="M2 2l3 3M18 2l-3 3M10 0v2" stroke="currentColor" stroke-width="1.5"/></svg>',
  smoke: '<svg viewBox="0 0 20 24" class="gun"><path d="M5 9h10v13H5z"/><path d="M7 4h6v5H7z"/><path d="M5 14h10v2H5z" fill="#777"/></svg>',
  kevlar: '<svg viewBox="0 0 24 24" class="gun"><path d="M4 4l5-2h6l5 2v16l-8 3-8-3z"/></svg>',
  helmet: '<svg viewBox="0 0 30 24" class="gun"><path d="M3 4l5-2h6l5 2v16l-8 3-8-3z"/><path d="M19 9a6 5 0 0 1 10 0v4H19z"/></svg>',
  head: '<svg viewBox="0 0 20 20" class="ic head"><circle cx="10" cy="9" r="7"/><path d="M6 15h8v4H6z"/><circle cx="7" cy="8" r="1.8" class="hole"/><circle cx="13" cy="8" r="1.8" class="hole"/></svg>',
  wallbang: '<svg viewBox="0 0 24 20" class="ic wb"><path d="M9 1h6v18H9z"/><path d="M0 10h7M17 10h5" class="line"/><path d="M19 7l4 3-4 3z"/></svg>',
  // без прицела: круг оптики, перечёркнутый
  noscope: '<svg viewBox="0 0 20 20" class="ic ns"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="1.2"/><path d="M3 17L17 3" stroke="#ff4d4d" stroke-width="2.4"/></svg>',
  jump: '<svg viewBox="0 0 20 20" class="ic jump"><path d="M10 1l6 7h-4v6H8V8H4z"/><path d="M2 17h16v2H2z"/></svg>',
};
const ICON_TITLE = { head: 'в голову', wallbang: 'прострел', jump: 'в прыжке', noscope: 'без прицела' };

// Силуэты ножей (клинок смотрит вправо)
const knifeSvg = paths => `<svg viewBox="0 0 60 20" class="gun" fill-rule="evenodd">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
const KNIFE_ICONS = {
  default: knifeSvg(['M2 8L19 8L19 13L4 13L2 11Z', 'M19 5.5L22 5.5L22 15L19 15Z', 'M22 7L44 7L50 9L58 10.5L48 13L22 13Z']),
  karambit: knifeSvg(['M6 5.5A4.5 4.5 0 1 1 5.99 5.5ZM6 7.8A2.2 2.2 0 1 0 6.01 7.8Z', 'M10 8L26 7L27 12L10 12Z',
    'M26 7Q40 5 49 9Q55 13 55 19Q50 14 43 12.5Q35 11.5 27 12Z']),
  butterfly: knifeSvg(['M2 6.5L24 6.5L24 9.3L2 9.3Z', 'M2 11.2L24 11.2L24 14L2 14Z', 'M24 7.5L46 7.5L58 10.5L46 13L24 13Z']),
  skeleton: knifeSvg(['M5 6.5A4 4 0 1 1 4.99 6.5ZM5 8.5A2 2 0 1 0 5.01 8.5Z', 'M8 7L22 7L22 14L8 14ZM11 9L19 9L19 12L11 12Z',
    'M22 6.5L44 6.5L50 8L58 10.5L46 14L22 14Z']),
  stiletto: knifeSvg(['M2 8.5L19 8L19 12.5L2 12Z', 'M19 6.5L22 6.5L22 14L19 14Z', 'M22 8.5L50 9.5L59 10.5L50 11.5L22 12.5Z']),
  m9: knifeSvg(['M2 8L19 7.5L19 13.5L3 13L1 10.5Z', 'M19 2.5L22 2.5L22 15L19 15Z', 'M20.5 0.4A1.6 1.6 0 1 1 20.49 0.4Z',
    'M22 6.5L45 6.5L52 8.5L59 11L49 14L22 14ZM27 9.5L34 9.5L34 11L27 11Z']),
};
const weaponIcon = m => (m.weapon === 'knife' ? KNIFE_ICONS[m.knife] || KNIFE_ICONS.default : ICONS[m.weapon]) || '';

function onKill(m) {
  const flags = ['noscope', 'jump', 'wallbang', 'head'].filter(f => m[f]);
  const el = document.createElement('div');
  const a = m.assist;  // помощь в убийстве: союзник убийцы, ранивший или ослепивший жертву
  el.className = 'kf' + (m.victimId === me.id || m.killerId === me.id || a?.id === me.id ? ' mine' : '');
  const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
  el.append(span(m.killerTeam, m.cheats ? `🛠 ${m.killer}` : m.killer));  // 🛠 — убил с включёнными читами
  if (a) {
    el.append(span('plus', '+'));
    if (a.flash) el.insertAdjacentHTML('beforeend', ICONS.flash.replace('class="gun"', 'class="gun assistFlash"'));
    el.append(span(a.team, a.name));
  }
  const w = span('w', '');
  w.innerHTML = weaponIcon(m) + flags.map(f => ICONS[f]).join('');
  el.append(w, span(m.victimTeam, m.victim));
  ui.killfeed.prepend(el);
  setTimeout(() => el.remove(), 6000);
  while (ui.killfeed.children.length > 5) ui.killfeed.lastChild.remove();

  if (m.killerId === me.id) showKillNotice(m, flags);
  else if (a?.id === me.id) showAssistNotice(m, a.flash);
  if (m.killerTeam !== m.victimTeam) {  // за своих золото не даём
    if (m.killerId === me.id) {
      addGold(2, 'убийство');
      missionEvent('kill', `kill:${m.weapon}`, m.head && 'head', m.jump && 'jump', m.wallbang && 'wallbang');
    }
    else if (a?.id === me.id) addGold(1, 'помощь');
  }
  if (m.victimId === me.id) {
    const how = flags.map(f => ICON_TITLE[f]).join(', ');
    const title = `Тебя убил ${m.killer}${a ? ` с помощью ${a.name}` : ''}${how ? ` (${how})` : ''}`;
    if (m.respawn) setDead(title, '', 3);
    else setDead(title, 'Ждём конца раунда...');
  }
  const r = remotes.get(m.victimId);
  if (r) r.deathTime = performance.now();
}

// Золото за игру: копится в профиле, в игре — короткая надпись у денег
let goldToast = 0, goldTimer = 0;
let matchGold = 0;   // сколько золота набрано за текущий матч (для итогов)
function addGold(n, why) {
  wallet.gold += n;
  matchGold += n;
  saveProfile();
  goldToast += n;
  const el = $('goldDelta');
  el.textContent = `🪙 +${goldToast} ${why}`;
  el.classList.add('show');
  clearTimeout(goldTimer);
  goldTimer = setTimeout(() => { goldToast = 0; el.classList.remove('show'); }, 2200);
}

// Итоги матча: победа/поражение, счёт, таблица игроков, MVP матча и твои награды
function showMatchSummary(m) {
  const s = m.summary, won = m.winner === me.team;
  const title = $('msTitle');
  title.textContent = won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  title.className = won ? 'win' : 'lose';
  $('msScore').innerHTML = `<span class="ct">${s.score.ct}</span> : <span class="t">${s.score.t}</span>`;
  const mvp = s.players.find(p => p.id === s.mvp);
  $('msMvp').textContent = mvp ? `★ MVP матча: ${mvp.name} — ${mvp.kills} убийств, ${mvp.mvps} раз MVP раунда` : '';
  // сначала моя команда, внутри — по убийствам
  const rows = [...s.players].sort((a, b) => (a.team !== me.team) - (b.team !== me.team) || b.kills - a.kills || a.deaths - b.deaths);
  const body = $('msBody');
  body.textContent = '';
  for (const p of rows) {
    const tr = document.createElement('tr');
    tr.className = p.team + (p.id === me.id ? ' me' : '');
    for (const v of [(p.id === s.mvp ? '★ ' : '') + p.name, p.kills, p.assists, p.deaths, p.mvps || '', p.kills ? `${p.hs}%` : '—', p.bot ? '' : `+${p.xp}`]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    body.append(tr);
  }
  // мои награды за матч
  const mine = s.players.find(p => p.id === me.id);
  const rewards = [];
  if (mine) rewards.push(`⭐ +${mine.xp} XP`);
  rewards.push(`🪙 +${matchGold}`);
  if (mine?.elo != null) rewards.push(`${mine.elo >= 0 ? '📈' : '📉'} Рейтинг ${mine.elo >= 0 ? '+' : ''}${mine.elo} · ${RANK_ICON[mine.rank] || ''} ${mine.rank}`);
  for (const a of matchAch) rewards.push(`🏆 ${a.name}`);
  const box = $('msRewards');
  box.textContent = '';
  for (const r of rewards) { const sp = document.createElement('span'); sp.textContent = r; box.append(sp); }
  $('matchSummary').classList.remove('hidden');
  playTone(won ? 1046 : 330, 0.4, 0.12, 'sine');
}

// Помог союзнику убить — короткая надпись в центре экрана
function showAssistNotice(m, flash) {
  ui.killNotice.innerHTML = `<div class="kn-text assist">${flash ? 'ПОМОЩЬ ФЛЕШКОЙ' : 'ПОМОЩЬ'}</div>`;
  const who = document.createElement('div');
  who.className = 'kn-assist-who';
  who.textContent = `${m.killer} добил ${m.victim}`;
  ui.killNotice.append(who);
  ui.killNotice.classList.remove('show');
  void ui.killNotice.offsetWidth;
  ui.killNotice.classList.add('show');
  clearTimeout(killNoticeTimer);
  killNoticeTimer = setTimeout(() => ui.killNotice.classList.remove('show'), 1600);
  playTone(700, 0.08, 0.08, 'sine');
}

// Большая картинка в центре экрана, когда убиваешь ты
let killStreak = 0, killStreakAt = 0, killNoticeTimer = null;
function showKillNotice(m, flags) {
  const now = performance.now();
  killStreak = now - killStreakAt < 4000 ? killStreak + 1 : 1;
  killStreakAt = now;
  const label = ['', 'УБИЙСТВО', 'ДВОЙНОЕ УБИЙСТВО', 'ТРОЙНОЕ УБИЙСТВО', 'УЛЬТРА УБИЙСТВО'][Math.min(killStreak, 4)];
  const extra = flags.map(f => `<div class="kn-flag ${f}">${ICONS[f]}<span>${ICON_TITLE[f]}</span></div>`).join('');
  ui.killNotice.innerHTML = `<div class="kn-icons">${weaponIcon(m)}</div><div class="kn-flags">${extra}</div><div class="kn-text">${label}</div>`;
  ui.killNotice.classList.remove('show');
  void ui.killNotice.offsetWidth;  // перезапуск анимации
  ui.killNotice.classList.add('show');
  clearTimeout(killNoticeTimer);
  killNoticeTimer = setTimeout(() => ui.killNotice.classList.remove('show'), 1800);
}

function addChat(text) {
  const el = document.createElement('div');
  el.textContent = text;
  ui.chatLog.appendChild(el);
  setTimeout(() => el.classList.add('old'), 8000);
  while (ui.chatLog.children.length > 8) ui.chatLog.firstChild.remove();
}

let bannerTimer = null;
function showBanner(text, color, ms = 4000, sub = '', subMine = false) {
  ui.banner.textContent = text;
  ui.banner.style.color = '#' + color.toString(16).padStart(6, '0');
  if (sub) {  // вторая строка — например, MVP раунда
    const el = document.createElement('div');
    el.className = 'bannerSub' + (subMine ? ' mine' : '');
    el.textContent = sub;
    ui.banner.append(el);
  }
  ui.banner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.add('hidden'), ms);
}

// ================== ДРУГИЕ ИГРОКИ ==================
const remotes = new Map();

function makeNameTag(text) {
  text = I18N.tr(text);  // ник рисуется на холсте — переводчик страницы его не видит (боты — латиницей)
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 32px Segoe UI, Arial'; g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 42);
  g.fillStyle = '#fff'; g.fillText(text, 128, 42);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.6, 0.4, 1);
  s.position.y = 2.15;
  return s;
}

// Что у игрока в руках: 'rifle', 'pistol' или тип его ножа
const itemOf = p => (p.weapon === 'knife' ? (KNIVES[p.knife] ? p.knife : 'default')
  : (WEAPONS[p.weapon] || isNade(p.weapon)) ? p.weapon : 'pistol');

function createRemote(p) {
  const group = buildAgent(p.team, p.skins?.[`agent_${p.team}`]);
  const { hitBody, hitHead, body } = group.userData;
  // части тела, по которым засчитываются попадания (голова — отдельно)
  for (const m of hitBody) m.userData = { pid: p.id, head: false };
  for (const m of hitHead) m.userData = { pid: p.id, head: true };
  const r = {
    group, team: p.team, data: p, hitboxes: [...hitBody, ...hitHead],
    target: new THREE.Vector3(...p.pos), yaw: p.yaw, deathTime: 0,
    crouch: 0, speed: 0, walk: 0, kick: 0, swing: null, item: null,
  };
  if (p.team === me.team) body.add(makeNameTag(p.name));
  group.position.copy(r.target);
  group.rotation.y = p.yaw;
  scene.add(group);
  remotes.set(p.id, r);
  return r;
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (r) { scene.remove(r.group); freeGeometry(r.group); remotes.delete(id); }
}

// Фаза раунда и таймер (приходят с сервера в каждом снимке)
let phase = 'warmup', phaseTimeLeft = 0, phaseSyncAt = 0;

function updateTimer() {
  if (phase === 'warmup') { ui.timer.textContent = 'РАЗМИНКА'; ui.timer.className = 'warmup'; return; }
  if (bomb?.state === 'planted' && phase === 'live') {
    // после закладки вместо времени раунда — отсчёт до взрыва
    const s = Math.ceil(bombTimeLeft(performance.now()));
    ui.timer.textContent = `💣 0:${String(s).padStart(2, '0')}`;
    ui.timer.className = 'bomb';
    return;
  }
  const left = Math.max(0, phaseTimeLeft - (performance.now() - phaseSyncAt) / 1000);
  const s = Math.ceil(left);
  ui.timer.textContent = phase === 'freeze' ? `Старт через ${s}`
    : phase === 'end' ? `Новый раунд: ${s}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  ui.timer.className = phase === 'live' && s <= 10 ? 'urgent' : '';
}

// Иконки игроков у счёта: живые яркие, убитые тусклые, рядом — «сколько живых»
const PERSON_SVG = '<svg viewBox="0 0 10 16"><circle cx="5" cy="3.2" r="2.6"/><path d="M1.5 7h7v9h-7z"/></svg>';
let aliveKey = '';
// носитель бомбы — его знают только террористы
const bombCarrierForMe = () => (bomb?.state === 'carried' && me.team === 't' ? bomb.carrier : null);
function renderAlive(players) {
  const carrier = bombCarrierForMe();
  const key = players.map(p => `${p.team}${p.alive ? 1 : 0}`).sort().join() + `|${carrier}`;
  if (key === aliveKey) return;
  aliveKey = key;
  for (const team of ['ct', 't']) {
    const list = players.filter(p => p.team === team);
    const alive = list.filter(p => p.alive).length;
    const icons = [...list].sort((a, b) => b.alive - a.alive)  // живые ближе к счёту
      .map(p => PERSON_SVG.replace('<svg', !p.alive ? '<svg class="dead"' : p.id === carrier ? '<svg class="carrier"' : '<svg'))
      .join('');
    $(team === 'ct' ? 'aliveCT' : 'aliveT').innerHTML = icons + `<span class="count">${alive}</span>`;
  }
}

function applySnapshot(m) {
  lastSnapshot = m;
  ui.scoreCT.textContent = m.score.ct;
  ui.scoreT.textContent = m.score.t;
  phase = m.phase;
  phaseTimeLeft = m.timeLeft;
  phaseSyncAt = performance.now();
  gameMode = m.mode || 'tdm';
  bomb = m.bomb;
  bombSyncAt = phaseSyncAt;
  renderAlive(m.players);
  const seen = new Set();
  for (const p of m.players) {
    seen.add(p.id);
    if (p.id === me.id) { me.hp = p.hp; continue; }
    let r = remotes.get(p.id);
    if (!r || r.team !== p.team) { removeRemote(p.id); r = createRemote(p); }
    if (p.alive && !r.data.alive) { r.group.position.set(...p.pos); r.group.rotation.set(0, p.yaw, 0); }
    r.data = p;
    // скорость по снимкам сервера (для шагов): сколько прошёл с прошлого снимка
    const nowS = performance.now() / 1000;
    if (r.snapAt) {
      const span = nowS - r.snapAt;
      if (span > 0.02) r.netSpeed = Math.min(10, Math.hypot(p.pos[0] - r.target.x, p.pos[2] - r.target.z) / span);
    }
    r.snapAt = nowS;
    r.target.set(...p.pos);
    r.yaw = p.yaw;
  }
  for (const id of [...remotes.keys()]) if (!seen.has(id)) removeRemote(id);
  if (!ui.sb.classList.contains('hidden')) renderScoreboard();
}

// За кем наблюдать после смерти: сначала живые союзники, если их нет — любые живые
function pickSpectate(next = false) {
  const alive = [...remotes.values()].filter(r => r.data.alive);
  const mates = alive.filter(r => r.team === me.team);
  const list = mates.length ? mates : alive;
  if (!list.length) { spectateId = null; return null; }
  let i = list.findIndex(r => r.data.id === spectateId);
  if (i === -1 || next) i = (i + 1) % list.length;
  spectateId = list[i].data.id;
  return list[i];
}

const KNIFE_SWING_TIME = { slash: 0.3, stab: 0.55 };

function updateRemotes(dt) {
  const k = Math.min(1, dt * 15);
  const now = performance.now();
  for (const r of remotes.values()) {
    if (r.data.alive) {
      r.group.visible = r.data.id !== spectateId;  // за кем наблюдаем — смотрим его глазами
      const prevX = r.group.position.x, prevY = r.group.position.y, prevZ = r.group.position.z;
      r.group.position.lerp(r.target, k);
      remoteSteps(r, dt, Math.hypot(r.group.position.x - prevX, r.group.position.z - prevZ), r.group.position.y - prevY);
      let dy = r.yaw - r.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.group.rotation.y += dy * k;
      r.group.rotation.x = 0;
      // скорость — по тому, насколько сдвинулся за кадр (для шага)
      const v = dt > 0 ? Math.min(8, Math.hypot(r.group.position.x - prevX, r.group.position.z - prevZ) / dt) : 0;
      r.speed += (v - r.speed) * Math.min(1, dt * 8);
      r.walk += dt * r.speed * 2.1;
      r.crouch += ((r.data.crouch ? 1 : 0) - r.crouch) * k;
      r.kick = Math.max(0, r.kick - dt * 8);
      // сменил оружие — в руках другой предмет
      const item = itemOf(r.data);
      // скин того, что у него в руках (ножи — общей окраской «knife»)
      const skin = (r.data.skins || {})[KNIVES[item] ? 'knife' : item] || null;
      if (item !== r.item || skin !== r.skin) { r.item = item; r.skin = skin; setAgentItem(r.group, item, false, skin); }
      let swing = null;
      if (r.swing) {
        const t = (now - r.swing.start) / 1000 / KNIFE_SWING_TIME[r.swing.kind];
        if (t >= 1) r.swing = null; else swing = { kind: r.swing.kind, t };
      }
      animateAgent(r.group, {
        speed: r.speed, walk: r.walk, crouch: r.crouch, air: r.target.y > 0.05,
        pitch: r.data.pitch || 0, kick: r.kick, swing,
      });
    } else {
      // падение после смерти, потом исчезновение
      const t = (performance.now() - r.deathTime) / 1000;
      r.group.rotation.x = Math.max(-Math.PI / 2, -t * 6);
      r.group.visible = t < 2.5;
    }
  }
}

// ================== ЭФФЕКТЫ ==================
const effects = [];
function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  scene.add(line);
  effects.push({ obj: line, life: 0.06, max: 0.06 });
}
function spawnImpact(point, normal) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true }));
  s.position.copy(point).addScaledVector(normal, 0.01);
  scene.add(s);
  effects.push({ obj: s, life: 4, max: 4 });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    e.obj.material.opacity = Math.max(0, e.life / e.max);
    if (e.grow) e.obj.scale.setScalar(1 + e.grow * (1 - e.life / e.max));  // взрыв — растущий шар
    if (e.life <= 0) {
      scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ================== РЕЖИМ «ЗАКЛАДКА БОМБЫ» ==================
let gameMode = 'bomb';
let bomb = null;          // с сервера: { state, carrier, pos, site, timeLeft, action }
let bombSyncAt = 0;
let usingE = false;       // зажата E (закладка / разминирование)
let shake = 0;            // тряска камеры от взрыва
let nextBeep = 0, lastBeep = 0;

// Метки точек A и B: буква над точкой и круг на земле
const siteMarkers = new THREE.Group();
scene.add(siteMarkers);
function letterSprite(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 96px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, 64, 68);
  g.fillStyle = '#f5a623'; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.85, depthTest: false }));
  s.scale.set(2.2, 2.2, 1);
  return s;
}
function buildSiteMarkers() {
  siteMarkers.clear();
  for (const [name, [x, z, r]] of Object.entries(SITES)) {
    const flat = (geo, opacity) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.03, z);
      return m;
    };
    const letter = letterSprite(name);
    letter.position.set(x, 5.5, z);
    siteMarkers.add(flat(new THREE.RingGeometry(r - 0.25, r, 64), 0.45), flat(new THREE.CircleGeometry(r, 64), 0.08), letter);
  }
}

// После построения новой карты: метки точек, место персонажа в меню, тени по-новому
function onMapBuilt(data) {
  buildSiteMarkers();
  buildRadarMap(data);
  setMenuSpot(data.menu);
  effects.forEach(e => scene.remove(e.obj));
  effects.length = 0;
}
const siteAt = pos => {
  for (const [name, [x, z, r]] of Object.entries(SITES)) if (Math.hypot(pos.x - x, pos.z - z) <= r) return name;
  return null;
};

// Модель бомбы: лежит на земле, когда выронена или заложена
const bombModel = new THREE.Group();
bombModel.add(box(0.34, 0.12, 0.22, lambert(0x4b5a32), 0, 0.06, 0));      // корпус
bombModel.add(box(0.12, 0.02, 0.08, lambert(0x111111), -0.06, 0.13, 0));  // экран
bombModel.add(box(0.3, 0.03, 0.03, lambert(0xaa2222), 0, 0.1, 0.1));      // провода
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
bombLight.position.set(0.1, 0.14, 0);
bombModel.add(bombLight);
bombModel.traverse(o => { o.castShadow = true; });
bombModel.visible = false;
scene.add(bombModel);

const bombTimeLeft = now => Math.max(0, bomb.timeLeft - (now - bombSyncAt) / 1000);
const nearBomb = (pos, range) => bomb && Math.hypot(pos.x - bomb.pos[0], pos.z - bomb.pos[2]) <= range;
const iCarryBomb = () => !!(bomb && bomb.state === 'carried' && bomb.carrier === me.id && me.alive);
// Бомба в руках (клавиша 5): так её можно выбросить на G — например, отдать союзнику
let bombInHands = false;
const bombVM = bombModel.clone();
bombVM.visible = true;
bombVM.position.set(0.2, -0.3, -0.62);
bombVM.rotation.set(0.6, -0.5, 0.1);
bombVM.scale.setScalar(0.55);
function toggleBombInHands() {
  if (!iCarryBomb()) return;
  bombInHands = !bombInHands;
  me.ads = false;
  scope = 0;
  playTone(420, 0.05, 0.06, 'sine');
}
function throwBomb() {
  if (!bombInHands || !iCarryBomb() || chatOpen) return;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const pos = camera.position.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.25, 0));
  const vel = fwd.multiplyScalar(6).add(new THREE.Vector3(me.vel.x, 2, me.vel.z));
  send({ type: 'dropBomb', pos: pos.toArray(), vel: vel.toArray() });
  bombInHands = false;
  playShot(0.12, 600, 0.1);
}
// стоишь там, где можно заложить или разминировать — пока держишь E, двигаться нельзя
function busyWithBomb() {
  if (!usingE || !me.alive) return false;
  if (iCarryBomb()) return !!siteAt(me.pos);
  return me.team === 'ct' && bomb?.state === 'planted' && nearBomb(me.pos, 2);
}
function setUsing(active) {
  if (usingE === active) return;
  usingE = active;
  send({ type: 'use', active });
}

function updateBomb(now, dt) {
  siteMarkers.visible = inGame && gameMode === 'bomb';
  const b = bomb;
  const onGround = !!b && (b.state === 'dropped' || b.state === 'planted');
  bombModel.visible = inGame && onGround;
  if (onGround) {
    bombModel.position.set(b.pos[0], b.pos[1], b.pos[2]);
    if (b.state === 'planted') {
      // пищит всё чаще, чем меньше осталось до взрыва
      const left = bombTimeLeft(now);
      if (now >= nextBeep && left > 0) {
        nextBeep = now + Math.max(0.12, Math.min(1, left / 40)) * 1000;
        lastBeep = now;
        const dist = bombModel.position.distanceTo(camera.position);
        playTone(left < 5 ? 2400 : 1900, 0.07, 0.12 * Math.max(0.15, 1 - dist / 50));
      }
      bombLight.visible = now - lastBeep < 120;
    } else {
      bombLight.visible = Math.floor(now / 600) % 2 === 0;
    }
  }
  // рюкзак с бомбой — у того, кто её несёт (видят все), значок C4 над головой — только свои
  for (const r of remotes.values()) {
    const carries = !!(b && b.state === 'carried' && b.carrier === r.data.id);
    r.group.userData.bombPack.visible = carries;
    if (!r.c4) {
      r.c4 = makeC4Sprite(0.32);
      r.c4.position.y = 2.5;
      r.group.userData.body.add(r.c4);
    }
    r.c4.visible = carries && me.team === 't';
  }
  // над бомбой на земле: выпавшую видят террористы, заложенную — все
  bombMarker.visible = inGame && !!b && ((b.state === 'dropped' && me.team === 't') || b.state === 'planted');
  if (bombMarker.visible) bombMarker.position.set(b.pos[0], b.pos[1] + 1.1 + Math.sin(now / 300) * 0.08, b.pos[2]);
  shake = Math.max(0, shake - dt * 1.5);

  // подсказка внизу экрана
  let hint = '';
  if (inGame && me.alive && b) {
    if (iCarryBomb()) {
      const site = siteAt(me.pos);
      hint = site ? `Ты на точке ${site} — зажми E, чтобы заложить бомбу`
        : bombInHands ? (touchMode ? 'Бомба в руках — G, чтобы выбросить (союзник подберёт)' : 'Бомба в руках — G, чтобы выбросить (союзник подберёт), 1–3 — убрать')
        : touchMode ? 'У тебя бомба — отнеси её на точку A или B (C4 — взять в руки)' : 'У тебя бомба — отнеси её на точку A или B (5 — взять в руки)';
    } else if (b.state === 'planted' && me.team === 'ct') {
      hint = nearBomb(me.pos, 2) ? 'Зажми E, чтобы разминировать' : `Бомба заложена на ${b.site} — разминируй её!`;
    } else if (b.state === 'dropped' && me.team === 't') {
      hint = 'Бомба выпала — подбери её';
    }
  }
  ui.bombHint.textContent = hint;
  ui.bombHint.classList.toggle('hidden', !hint);
  if (touchMode) $('tbC4').classList.toggle('hidden', !(inGame && iCarryBomb()));
  updatePickHint();

  // полоска закладки/разминирования — у себя или у того, за кем наблюдаем
  const a = b?.action;
  const whoId = watching ? watching.data.id : me.id;
  const showBar = !!a && a.id === whoId;
  ui.actionBar.classList.toggle('hidden', !showBar);
  if (showBar) {
    ui.actionLabel.textContent = a.kind === 'plant' ? 'Закладка бомбы…' : 'Разминирование…';
    ui.actionFill.style.width = `${Math.round(a.frac * 100)}%`;
    ui.actionBar.classList.toggle('defuse', a.kind === 'defuse');
  }
}

// Слоты оружия справа внизу: 1 — основное (если куплено), 2 — пистолет, 3 — нож, 4 — гранаты, 5 — бомба
let slotsKey = '';
function renderSlots() {
  const carry = iCarryBomb();
  const show = me.alive && !watching;
  const key = `${show}:${me.weapon}:${myKnife}:${carry}:${JSON.stringify(inv)}`;
  if (key === slotsKey) return;
  slotsKey = key;
  const el = $('slots');
  el.replaceChildren();
  if (!show) return;
  const slots = [];
  if (inv.primary) slots.push([inv.primary, '1', ICONS[inv.primary], WEAPONS[inv.primary].name]);
  if (inv.secondary) slots.push([inv.secondary, '2', ICONS[inv.secondary], WEAPONS[inv.secondary].name]);
  slots.push(['knife', '3', KNIFE_ICONS[myKnife], KNIVES[myKnife]]);
  for (const n of NADE_KINDS) if (inv.nades[n] > 0) slots.push([n, '4', ICONS[n], NADE_NAME[n]]);
  if (carry) slots.push(['bomb', '5', ICONS.bomb, 'Бомба (C4) · зажми E на точке']);
  for (const [id, keyName, icon, name] of slots) {
    const row = document.createElement('div');
    row.className = 'slot' + (id === me.weapon ? ' active' : '') + (id === 'bomb' ? ' bomb' : '');
    const label = document.createElement('span');
    label.textContent = name;
    const kbd = document.createElement('kbd');
    kbd.textContent = keyName;
    row.innerHTML = icon;
    row.prepend(label);
    row.append(kbd);
    el.append(row);
  }
}

// Значок «C4»: над союзником с бомбой (видят только террористы) и над бомбой на земле
const c4Texture = (() => {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#3f4d2a'; g.strokeStyle = '#000'; g.lineWidth = 4;
  g.beginPath(); g.roundRect(4, 8, 88, 48, 10); g.fill(); g.stroke();
  g.font = '900 32px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ff4d4d'; g.fillText('C4', 48, 34);
  return new THREE.CanvasTexture(c);
})();
function makeC4Sprite(size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: c4Texture, depthTest: false, transparent: true }));
  s.scale.set(size * 1.5, size, 1);
  s.renderOrder = 10;
  return s;
}
const bombMarker = makeC4Sprite(0.5);
bombMarker.visible = false;
scene.add(bombMarker);

function explodeEffect(pos) {
  const p = new THREE.Vector3(...pos);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
  ball.position.copy(p).y += 1;
  scene.add(ball);
  effects.push({ obj: ball, life: 0.9, max: 0.9, grow: 14 });
  const light = new THREE.PointLight(0xffaa55, 30, 60);
  light.position.copy(p).y += 3;
  scene.add(light);
  setTimeout(() => scene.remove(light), 400);
  const dist = p.distanceTo(camera.position);
  shake = dist < 40 ? 1 : 0.4;
  playShot(Math.max(0.4, 1.6 - dist / 40), 350, 1.4);
  playTone(55, 1.2, 0.35 * Math.max(0.3, 1 - dist / 60), 'sawtooth');
}

// ================== ГРАНАТЫ ==================
// Летящие гранаты рисуем по позициям из снимков сервера
const nadeMeshes = new Map();
// Оружие на земле: сервер считает полёт и отскоки, здесь — модель, которая кувыркается в воздухе
// и ложится на бок, когда упала
const groundGuns = new Map();
const GUN_BUILDERS = { rifle: buildAK, awp: buildAWP, pistol: buildPistol, deagle: buildDeagle, m4: buildM4, smg: buildSMG, shotgun: buildShotgun };
const turnTo = (a, b, k) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * k;  // поворот по кратчайшей
function updateGroundGuns(dt) {
  const list = inGame ? lastSnapshot.guns || [] : [];
  const seen = new Set();
  for (const g of list) {
    seen.add(g.id);
    let m = groundGuns.get(g.id);
    if (!m) {
      m = new THREE.Group();
      const inner = new THREE.Group();
      GUN_BUILDERS[g.item]?.(inner);
      applySkin(inner, g.item, g.skin);
      inner.scale.setScalar(0.66);  // как в руках у персонажей
      inner.traverse(o => { o.castShadow = true; });
      m.add(inner);
      m.position.set(...g.pos);
      m.rotation.set(0, g.yaw, 0);
      m.userData.spin = 6 + Math.random() * 4;
      scene.add(m);
      groundGuns.set(g.id, m);
    }
    m.position.lerp(new THREE.Vector3(...g.pos), Math.min(1, dt * 20));
    if (g.rest) {  // лежит на боку
      const k = Math.min(1, dt * 12);
      m.rotation.set(turnTo(m.rotation.x, 0, k), turnTo(m.rotation.y, g.yaw, k), turnTo(m.rotation.z, Math.PI / 2, k));
    } else {       // кувыркается в полёте
      m.rotation.x += m.userData.spin * dt;
      m.rotation.z += m.userData.spin * 0.4 * dt;
    }
  }
  for (const [id, m] of groundGuns) if (!seen.has(id)) { scene.remove(m); freeGeometry(m); groundGuns.delete(id); }
}
// E — подобрать ствол, на который смотришь (до 2 м); если такой слот уже занят — обмен:
// своё оружие падает на землю, найденное — в руки
function gunToPick() {
  if (!inGame || !me.alive) return null;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  let best = null, bestScore = Infinity;
  for (const g of lastSnapshot.guns || []) {
    const dx = g.pos[0] - me.pos.x, dz = g.pos[2] - me.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 2 || Math.abs(g.pos[1] - me.pos.y) > 1.8) continue;
    const facing = d < 0.8 ? 1 : (dx * fwd.x + dz * fwd.z) / d;   // совсем под ногами — неважно, куда смотришь
    if (facing < 0.5) continue;
    const score = d - facing;  // ближе и прямее перед собой — лучше
    if (score < bestScore) { best = g; bestScore = score; }
  }
  return best;
}
const slotWeapon = item => (PRIMARY.includes(item) ? inv.primary : inv.secondary);
function pickUpGun(g) {
  const old = slotWeapon(g.item);
  me.reloadEnd = 0;
  ui.reloadBar.style.visibility = 'hidden';
  send({ type: 'pickup', id: g.id, ammo: old ? me.ammo[old] : null });
}
// подсказка «E — подобрать …» внизу экрана
function updatePickHint() {
  const g = !bombActionHere() && gunToPick();
  const el = $('pickHint');
  if (!g) { el.classList.add('hidden'); return; }
  const old = slotWeapon(g.item);
  el.textContent = old && old !== g.item
    ? `E — поменять ${WEAPONS[old].name} на ${WEAPONS[g.item].name}`
    : `E — подобрать ${WEAPONS[g.item].name}`;
  el.classList.remove('hidden');
}
// можно ли прямо сейчас закладывать / разминировать (тогда E — для бомбы)
function bombActionHere() {
  if (!bomb || !me.alive) return false;
  return (iCarryBomb() && !!siteAt(me.pos)) || (bomb.state === 'planted' && me.team === 'ct' && nearBomb(me.pos, 2));
}

// G — выбросить оружие из рук вперёд (летит по дуге, его может подобрать любой, у кого этот слот пуст)
function dropWeapon() {
  const w = me.weapon;
  if (!me.alive || chatOpen || !WEAPONS[w] || !owns(w)) return;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const pos = camera.position.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.25, 0));
  const vel = fwd.multiplyScalar(5).add(new THREE.Vector3(me.vel.x, 1.6, me.vel.z));
  me.reloadEnd = 0;
  ui.reloadBar.style.visibility = 'hidden';
  if (anim?.name === 'reload') anim = null;
  send({ type: 'drop', pos: pos.toArray(), vel: vel.toArray(), ammo: me.ammo[w] });
  playShot(0.12, 900, 0.1);
}

function updateNades(dt) {
  const list = inGame ? lastSnapshot.nades || [] : [];
  const seen = new Set();
  for (const n of list) {
    seen.add(n.id);
    let m = nadeMeshes.get(n.id);
    if (!m) {
      m = new THREE.Group();
      buildNade(m, n.kind);
      m.scale.setScalar(1.6);
      m.position.set(...n.pos);
      scene.add(m);
      nadeMeshes.set(n.id, m);
    }
    m.position.lerp(new THREE.Vector3(...n.pos), Math.min(1, dt * 20));
    m.rotation.x += dt * 8;
  }
  for (const [id, m] of nadeMeshes) if (!seen.has(id)) { scene.remove(m); freeGeometry(m); nadeMeshes.delete(id); }
}

// Дымовые облака: шары серого дыма, которые сервер держит 15 секунд
const smokeClouds = new Map();
const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
function addSmoke(pos, left) {
  const key = pos.map(v => Math.round(v * 2)).join(',');
  if (smokeClouds.has(key)) return;
  const mat = new THREE.MeshLambertMaterial({ color: 0xb9bdc3, transparent: true, opacity: 0, depthWrite: false });
  const g = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Mesh(smokeGeo, mat);
    const a = Math.random() * Math.PI * 2, r = Math.random() * 2.6;
    s.position.set(pos[0] + Math.cos(a) * r, 0.4 + Math.random() * 2.6, pos[2] + Math.sin(a) * r);
    s.scale.setScalar(1.1 + Math.random() * 0.7);
    g.add(s);
  }
  scene.add(g);
  smokeClouds.set(key, { g, mat, born: performance.now(), until: performance.now() + left * 1000 });
}
function updateSmokes(now) {
  if (inGame) for (const s of lastSnapshot.smokes || []) addSmoke(s.pos, s.left);
  for (const [key, c] of smokeClouds) {
    // плавно густеет за 1 с и тает за последние 2 с
    const appear = Math.min(1, (now - c.born) / 1000), fade = Math.min(1, (c.until - now) / 2000);
    c.mat.opacity = 0.92 * Math.max(0, Math.min(appear, fade));
    if (now > c.until || !inGame) { scene.remove(c.g); c.mat.dispose(); smokeClouds.delete(key); }
  }
}

function detonateEffect(kind, pos) {
  const p = new THREE.Vector3(...pos);
  const dist = p.distanceTo(camera.position);
  if (kind === 'smoke') {
    addSmoke(pos, 15);
    playShot(Math.max(0.1, 0.6 - dist / 60), 900, 1.2);  // шипение
    return;
  }
  const flashy = kind === 'flash';
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: flashy ? 0xffffff : 0xffa040, transparent: true, opacity: 0.95 }));
  ball.position.copy(p);
  scene.add(ball);
  effects.push({ obj: ball, life: flashy ? 0.18 : 0.45, max: flashy ? 0.18 : 0.45, grow: flashy ? 2 : 5 });
  const light = new THREE.PointLight(flashy ? 0xffffff : 0xffaa55, flashy ? 40 : 18, 30);
  light.position.copy(p).y += 0.5;
  scene.add(light);
  setTimeout(() => scene.remove(light), flashy ? 120 : 250);
  if (kind === 'he') {
    shake = Math.max(shake, dist < 12 ? 0.6 : 0.15);
    playShot(Math.max(0.3, 1.3 - dist / 40), 600, 0.8);
  } else {
    playShot(Math.max(0.2, 0.9 - dist / 50), 4000, 0.15);
  }
}

// Ослепление: белый экран, который постепенно гаснет, и звон в ушах
function flashMe(duration) {
  ui.flash.style.transition = 'none';
  ui.flash.style.opacity = 1;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ui.flash.style.transition = `opacity ${duration}s cubic-bezier(.6,0,.9,.5)`;
    ui.flash.style.opacity = 0;
  }));
  playTone(3200, Math.min(2.5, duration * 0.7), 0.05, 'sine');
}

let moneyTimer = null;
function showMoneyDelta(delta, reason) {
  ui.moneyDelta.textContent = `+$${delta} ${reason || ''}`;
  ui.moneyDelta.classList.add('show');
  clearTimeout(moneyTimer);
  moneyTimer = setTimeout(() => ui.moneyDelta.classList.remove('show'), 1600);
}

// ================== РАДАР ==================
// Карта сверху рисуется один раз при загрузке карты, а каждый кадр — поворачивается
// вокруг игрока (вперёд — всегда вверх) и поверх рисуются союзники, враги и бомба.
const RADAR_ZOOM = 2.6;            // пикселей на метр
const radarMap = document.createElement('canvas');
radarMap.width = radarMap.height = 400;  // 5 пикселей на метр, карта от -40 до 40
function buildRadarMap(data) {
  const g = radarMap.getContext('2d');
  const px = v => (v + 40) * 5;
  g.fillStyle = '#2a2f36';
  g.fillRect(0, 0, 400, 400);
  for (const [name, [x, z, r]] of Object.entries(data.sites || {})) {
    g.fillStyle = 'rgba(245,166,35,.25)';
    g.beginPath(); g.arc(px(x), px(z), r * 5, 0, Math.PI * 2); g.fill();
  }
  for (const [x, z, w, d, h, kind, y0 = 0] of data.boxes) {
    if (y0 > 1.5) continue;  // крыши и перемычки не мешают ходить — на радаре их нет
    g.fillStyle = h < 1.5 ? '#5d646d' : PENETRABLE.has(kind) ? '#7a6a52' : '#8d949c';
    g.fillRect(px(x - w / 2), px(z - d / 2), w * 5, d * 5);
  }
}
const radarCtx = $('radar').getContext('2d');
let nextSpot = 0;
function spotEnemies(now) {
  // кого из врагов я сейчас вижу: в поле зрения и без стен/дыма между нами
  if (!me.alive || now < nextSpot) return;
  nextSpot = now + 120;
  const eye = camera.position;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  for (const r of remotes.values()) {
    if (!r.data.alive || r.team === me.team) continue;
    const head = r.group.position.clone().setY(r.group.position.y + 1.4);
    const to = head.clone().sub(eye);
    const dist = to.length();
    if (dist > 80 || to.normalize().dot(fwd) < 0.35) continue;
    raycaster.set(eye, to);
    raycaster.far = dist;
    if (raycaster.intersectObjects(solidMeshes, false).length) continue;
    const smoked = [...smokeClouds.keys()].some(k => {
      const [sx, sy, sz] = k.split(',').map(v => v / 2);
      return segSphere(eye, head, new THREE.Vector3(sx, Math.max(sy, 1.2), sz), 3.2);
    });
    if (!smoked) r.radarUntil = now + 800;
  }
}
function segSphere(a, b, c, rad) {
  const d = b.clone().sub(a), f = a.clone().sub(c);
  const t = Math.max(0, Math.min(1, -f.dot(d) / d.lengthSq()));
  return a.clone().addScaledVector(d, t).distanceTo(c) < rad;
}
function updateRadar(now, spec) {
  const cv = $('radar');
  cv.style.display = inGame ? 'block' : 'none';
  if (!inGame) return;
  spotEnemies(now);
  const g = radarCtx, W = cv.width, c = W / 2;
  const center = spec ? spec.group.position : me.pos;
  const yaw = spec ? spec.group.rotation.y : me.yaw;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // точка мира → точка на радаре (с поворотом: куда смотришь — вверх)
  const toR = (x, z) => {
    const dx = x - center.x, dz = z - center.z;
    return [c + (dx * cos - dz * sin) * RADAR_ZOOM, c + (dx * sin + dz * cos) * RADAR_ZOOM];
  };
  g.clearRect(0, 0, W, W);
  g.save();
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(10,14,22,.85)'; g.fillRect(0, 0, W, W);
  g.save();
  g.translate(c, c); g.rotate(yaw); g.scale(RADAR_ZOOM, RADAR_ZOOM); g.translate(-center.x, -center.z);
  g.globalAlpha = 0.9;
  g.drawImage(radarMap, -40, -40, 80, 80);
  g.restore();
  // дым
  g.fillStyle = 'rgba(200,200,205,.55)';
  for (const k of smokeClouds.keys()) {
    const [sx, , sz] = k.split(',').map(v => v / 2);
    const [x, y] = toR(sx, sz);
    g.beginPath(); g.arc(x, y, 3.4 * RADAR_ZOOM, 0, Math.PI * 2); g.fill();
  }
  // буквы точек — всегда ровно, не поворачиваются
  g.font = '900 15px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [name, [x, z]] of Object.entries(SITES)) {
    const [rx, ry] = toR(x, z);
    g.fillStyle = '#f5a623'; g.fillText(name, rx, ry);
  }
  // бомба: заложенную видят все, выпавшую — террористы
  if (bomb && (bomb.state === 'planted' || (bomb.state === 'dropped' && me.team === 't'))) {
    const [x, y] = toR(bomb.pos[0], bomb.pos[2]);
    g.fillStyle = Math.floor(now / 300) % 2 ? '#ff4d4d' : '#ffb3b3';
    g.fillRect(x - 5, y - 4, 10, 8);
  }
  // игроки
  const carrier = bombCarrierForMe();
  for (const r of remotes.values()) {
    if (!r.data.alive) continue;
    const mate = r.team === me.team;
    if (!mate && !(r.radarUntil > now)) continue;
    const [x, y] = toR(r.group.position.x, r.group.position.z);
    if (mate) {  // союзник: точка и куда смотрит
      const a = r.group.rotation.y - yaw;
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(a) * 9, y - Math.cos(a) * 9); g.stroke();
    }
    g.fillStyle = mate ? (r.data.id === carrier ? '#ff4d4d' : r.team === 'ct' ? '#6aa8ff' : '#ffb347') : '#ff3030';
    g.beginPath(); g.arc(x, y, mate ? 4 : 4.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
  }
  // я — стрелка в центре, всегда смотрит вверх
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c + 5, c + 5); g.lineTo(c, c + 2); g.lineTo(c - 5, c + 5); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2;
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.stroke();
}

// ================== СТРЕЛЬБА ==================
const raycaster = new THREE.Raycaster();
let vmKick = 0;

// Удар ножом: луч на короткую дистанцию из центра экрана
function knifeAttack(kind, now = performance.now()) {
  if (!me.alive || chatOpen || phase === 'freeze' || now < me.nextShot) return;
  me.nextShot = now + KNIFE[kind].rate;
  playAnim(kind);  // у каждого ножа свой взмах и укол
  send({ type: 'swing', kind });  // чтобы другие видели удар
  playShot(0.3, 700, kind === 'stab' ? 0.18 : 0.12);  // свист клинка

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  raycaster.set(camera.position, dir);
  raycaster.far = KNIFE.range;
  const targets = [...solidMeshes];
  for (const r of remotes.values()) if (r.data.alive) targets.push(...r.hitboxes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return;
  const ud = hit.object.userData;
  if (ud.pid) {
    send({ type: 'hit', target: ud.pid, head: ud.head, melee: kind, jump: !me.onGround });
    playTone(160, 0.08, 0.2, 'triangle');
  } else {
    if (hit.face) spawnImpact(hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
    playTone(1800, 0.05, 0.06, 'triangle');  // клинок по стене
  }
}
function shoot(now) {
  if (bombInHands) return;   // с бомбой в руках не стреляют
  if (me.weapon === 'knife') return knifeAttack('slash', now);
  if (isNade(me.weapon)) {
    if (!triggerLatched) { triggerLatched = true; throwNade(false); }
    return;
  }
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  if (!me.alive || chatOpen || phase === 'freeze' || now < me.nextShot || me.reloadEnd) return;
  // с читами любое оружие стреляет очередью, очень быстро и без конца патронов
  if (!w.auto && triggerLatched && !cheat.rapid) return;
  triggerLatched = true;
  if (a.mag <= 0 && !cheat.rapid) { playTone(300, 0.04, 0.1); if (a.reserve > 0) startReload(); return; }

  if (!cheat.rapid) a.mag--;
  me.nextShot = now + (cheat.rapid ? CHEAT_RATE : w.rate);

  // разброс: растёт в движении, в прыжке и при зажатой стрельбе
  const speed = Math.hypot(me.vel.x, me.vel.z);
  // (сама очередь уходит по узору отдачи — см. sprayOffset; случайный разброс — только небольшой)
  let spread = w.spread + Math.min(me.spray, 20) * 0.0003 + (speed > 3.5 ? 0.03 : speed > 0.5 ? 0.01 : 0) + (me.onGround ? 0 : 0.08);
  if (me.ads) spread *= 0.5;
  if (me.crouch > 0.5) spread *= 0.6;  // сидя точнее
  if (w.scopedOnly && !scope) spread += 0.1;  // AWP без прицела почти не попадает
  if (cheat.aim) spread = 0;                  // с аимом — без разброса
  // узор: пуля уходит от прицела на «свою» точку узора (часть его уже ушла в подброс камеры)
  const [sy, sp] = cheat.aim ? [0, 0] : sprayOffset(me.weapon, me.spray);
  const kick = recoilKick(me.weapon, me.spray);
  const aim = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
    me.pitch + (sp - me.kickP) , me.yaw - (sy - me.kickY), 0, 'YXZ'));
  aim.x += (Math.random() - 0.5) * spread * 2;
  aim.y += (Math.random() - 0.5) * spread * 2;
  aim.z += (Math.random() - 0.5) * spread * 2;
  aim.normalize();

  // союзники тоже загораживают пули (урон по своим сервер не засчитывает).
  // Чит «сквозь стены» — пуля видит только врагов: стены, ящики и свои её не держат
  const targets = cheat.wallshot ? [] : [...solidMeshes];
  for (const r of remotes.values()) if (r.data.alive && (!cheat.wallshot || r.team !== me.team)) targets.push(...r.hitboxes);
  const muzzle = viewModels[me.weapon].userData.muzzle;
  const from = muzzle.getWorldPosition(new THREE.Vector3());
  // у дробовика — несколько дробин, каждая со своим разбросом вокруг точки прицела
  let firstEnd = null;
  for (let i = 0; i < (w.pellets || 1); i++) {
    const dir = aim.clone();
    if (w.pellets) {
      dir.x += (Math.random() - 0.5) * w.pelletSpread * 2;
      dir.y += (Math.random() - 0.5) * w.pelletSpread * 2;
      dir.z += (Math.random() - 0.5) * w.pelletSpread * 2;
      dir.normalize();
    }
    const end = fireBullet(w, dir, targets);
    firstEnd ??= end;
    spawnTracer(from, end);
  }
  send({ type: 'shoot', from: from.toArray(), to: firstEnd.toArray() });

  // отдача (с аимом — нет): камеру подбрасывает на часть узора (RECOIL_VIEW), остальное — разлёт пуль.
  // Тянешь мышь вниз и против змейки — очередь ложится в одну точку, как в CS2
  if (!cheat.aim) {
    const [dy, dp] = kick;
    me.pitch = Math.min(1.5, me.pitch + dp);
    me.yaw -= dy;
    me.kickP += dp;
    me.kickY += dy;
    me.spray += 1;
    me.lastShotAt = now;
  }
  vmKick = 1;

  muzzle.add(flash);
  flash.visible = true; flashLight.intensity = 3;
  setTimeout(() => { flash.visible = false; flashLight.intensity = 0; }, 40);
  const SOUND = { rifle: [2200, 0.22], awp: [1300, 0.45], pistol: [3000, 0.15], deagle: [1700, 0.28],
    m4: [2600, 0.2], smg: [3300, 0.14], shotgun: [900, 0.5] };
  playShot(me.weapon === 'awp' || me.weapon === 'shotgun' ? 1.4 : me.weapon === 'smg' ? 0.8 : 1, ...SOUND[me.weapon]);
  if (cheat.rapid) return;  // ни затвора, ни помпы, ни перезарядки
  if (me.weapon === 'awp') {
    // после выстрела AWP — передёрнуть затвор; прицел возвращается после этого
    const was = scope;
    scope = 0;
    playAnim('bolt');
    setTimeout(() => { if (me.weapon === 'awp' && me.alive && a.mag > 0) scope = was; }, 1150);
  }
  if (me.weapon === 'shotgun' && a.mag > 0) setTimeout(() => { if (me.weapon === 'shotgun' && !me.reloadEnd) playAnim('pump'); }, 120);
  if (a.mag === 0 && a.reserve > 0) setTimeout(startReload, 250);
}

// ---------- Узор отдачи (в стиле CS2: свой для каждого оружия, одинаковый каждый раз) ----------
// Точки узора: [номер пули, вправо(°), вверх(°)] — между точками плавно. Первые пули идут вверх,
// дальше очередь «змейкой» уходит влево-вправо. Узор можно выучить и гасить мышью.
const SPRAY = {
  rifle:   [[0, 0, 0], [1, 0, 0.3], [4, 0.2, 2.3], [9, -0.3, 5.3], [13, -2.7, 6.1], [17, -1.0, 6.4], [21, 2.5, 6.2], [25, 0.8, 6.5], [29, -2.1, 6.3]],
  m4:      [[0, 0, 0], [1, 0, 0.25], [5, 0.3, 2.0], [10, -0.2, 3.8], [15, -1.9, 4.3], [20, 1.5, 4.5], [25, -0.6, 4.6], [29, 1.1, 4.5]],
  smg:     [[0, 0, 0], [3, 0.1, 1.0], [8, -0.5, 2.2], [14, 0.9, 2.7], [20, -0.9, 2.9], [29, 0.7, 3.0]],
  pistol:  [[0, 0, 0], [1, 0.1, 0.5], [4, -0.2, 1.6], [11, 0.3, 2.4]],
  deagle:  [[0, 0, 0], [1, 0, 1.4], [3, 0.3, 3.0], [6, -0.4, 4.0]],
  awp:     [[0, 0, 0], [1, 0, 2.5]],
  shotgun: [[0, 0, 0], [1, 0, 2.2], [3, 0.2, 3.5]],
};
const RECOIL_VIEW = 0.45;   // какая доля узора уходит в подброс камеры (остальное — куда летит пуля относительно прицела)
const DEG = Math.PI / 180;
function sprayPoint(weapon, n) {
  const keys = SPRAY[weapon] || SPRAY.rifle;
  if (n >= keys[keys.length - 1][0]) return [keys[keys.length - 1][1] * DEG, keys[keys.length - 1][2] * DEG];
  for (let i = 1; i < keys.length; i++) {
    const [n1, y1, p1] = keys[i];
    if (n > n1) continue;
    const [n0, y0, p0] = keys[i - 1];
    const k = (n - n0) / (n1 - n0);
    return [(y0 + (y1 - y0) * k) * DEG, (p0 + (p1 - p0) * k) * DEG];
  }
  return [0, 0];
}
// где по узору окажется пуля номер n (вправо, вверх) — в радианах от точки, где начал очередь
const sprayOffset = (weapon, n) => sprayPoint(weapon, Math.round(n));
// на сколько подбросит камеру этот выстрел
function recoilKick(weapon, n) {
  const [y1, p1] = sprayPoint(weapon, Math.round(n) + 1), [y0, p0] = sprayPoint(weapon, Math.round(n));
  return [(y1 - y0) * RECOIL_VIEW, (p1 - p0) * RECOIL_VIEW];
}
// перестал стрелять — узор «сбрасывается», камера плавно возвращается (как в CS2)
function sprayRecover(now, dt) {
  const w = WEAPONS[me.weapon];
  if (!w || now - (me.lastShotAt || 0) < w.rate + 120) return;
  me.spray = Math.max(0, me.spray - dt * 22);
  const k = Math.min(1, dt * 7);
  const p = me.kickP * k, y = me.kickY * k;
  me.pitch -= p; me.yaw += y;
  me.kickP -= p; me.kickY -= y;
}

// Одна пуля (или дробина): луч от глаз, прострел ящиков и кромок, попадание по игроку → сообщение серверу.
// Возвращает, где пуля остановилась (для трассера)
function fireBullet(w, dir, targets) {
  raycaster.set(camera.position, dir);
  raycaster.far = w.range;
  // Прострел как в CS2: считаем, сколько материала пуля проходит внутри препятствия.
  // Ящики пробиваются целиком, стены и бетон — только если путь короткий (углы, кромки).
  let end = camera.position.clone().addScaledVector(dir, w.range);
  let pens = 0, mult = 1;
  for (const hit of raycaster.intersectObjects(targets, false)) {
    const ud = hit.object.userData;
    if (ud.pid) {
      // чит «сквозь стены»: стены пуле не мешали, но если враг был за стеной — это прострел (иконка в килфиде)
      if (cheat.wallshot && !pens) {
        const wallRay = new THREE.Raycaster(camera.position, dir, 0, hit.distance);
        if (wallRay.intersectObjects(solidMeshes, false).length) pens = 1;  // урон не режем: mult остаётся 1
      }
      // с читами любое попадание засчитывается в голову
      send({ type: 'hit', target: ud.pid, head: ud.head || cheat.aim, wallbang: pens > 0, pen: +mult.toFixed(2), jump: !me.onGround, weapon: me.weapon,
        noscope: me.weapon === 'awp' && !scope });   // AWP без прицела — особая иконка в килфиде
      end = hit.point;
      break;
    }
    if (hit.face) spawnImpact(hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
    const exit = ud.box ? rayExit(raycaster.ray, ud.box) : null;
    const thickness = exit === null ? Infinity : exit - hit.distance;
    const canPen = ud.penetrable ? thickness < 3 : thickness <= w.pen;
    if (pens < 2 && canPen) {
      pens++;
      mult *= ud.penetrable ? 0.6 : Math.max(0.3, 0.65 - thickness);
      spawnImpact(raycaster.ray.at(exit, new THREE.Vector3()), dir);  // выходное отверстие
      continue;
    }
    end = hit.point;
    break;
  }
  return end;
}

// Расстояние вдоль луча до точки выхода из коробки (или null, если луч её не задевает)
function rayExit(ray, box) {
  let tmin = -Infinity, tmax = Infinity;
  for (const a of ['x', 'y', 'z']) {
    const o = ray.origin[a], d = ray.direction[a];
    if (Math.abs(d) < 1e-9) {
      if (o < box.min[a] || o > box.max[a]) return null;
      continue;
    }
    let t1 = (box.min[a] - o) / d, t2 = (box.max[a] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmax;
}

// ================== АНИМАЦИИ ОРУЖИЯ ==================
// Анимация — функция fn(t, части модели), где t идёт от 0 до 1. Она возвращает позу
// { rx, ry, rz — поворот; px, py, pz — сдвиг } и может двигать детали: затвор,
// клинок на шарнире, половинку рукояти бабочки, весь нож (spin).
const POSE_KEYS = ['rx', 'ry', 'rz', 'px', 'py', 'pz'];
const ease = k => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));  // прогресс внутри [a, b]
const bump = (t, a, b) => Math.sin(Math.PI * seg(t, a, b));            // 0 → 1 → 0 на [a, b]
const TAU = Math.PI * 2;
function add(...poses) {
  const r = {};
  for (const key of POSE_KEYS) r[key] = poses.reduce((s, p) => s + (p[key] || 0), 0);
  return r;
}
function scalePose(p, k) {
  const r = {};
  for (const key of POSE_KEYS) r[key] = (p[key] || 0) * k;
  return r;
}
function keyframes(keys) {
  return t => {
    let i = 0;
    while (keys[i + 1].t < t) i++;
    const a = keys[i], b = keys[i + 1], s = ease((t - a.t) / (b.t - a.t));
    const pose = {};
    for (const key of POSE_KEYS) pose[key] = (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * s;
    return pose;
  };
}
// Оружие поднимается снизу (k: 0 → 1)
function raise(k) {
  const u = 1 - ease(k);
  return { rx: -0.9 * u, ry: 0.2 * u, rz: 0.5 * u, px: 0.05 * u, py: -0.3 * u, pz: 0.05 * u };
}
// Сложить/раскрыть клинок на шарнире: open 0 — сложен, 1 — раскрыт
const setBlade = (p, open) => { p.blade.rotation.x = Math.PI * (1 - open); };

// Осмотр автомата и пистолета: правый бок, потом наклон стволом вверх
const GUN_INSPECT = keyframes([
  { t: 0 },
  { t: 0.16, rx: 0.12, ry: 0.85,  rz: 0.55,  px: -0.09, py: 0.06 },
  { t: 0.45, rx: 0.05, ry: 0.95,  rz: 0.45,  px: -0.09, py: 0.07 },
  { t: 0.62, rx: 0.35, ry: -0.3,  rz: -0.55, px: -0.04, py: 0.05 },
  { t: 0.86, rx: 0.3,  ry: -0.25, rz: -0.5,  px: -0.04, py: 0.05 },
  { t: 1 },
]);
// Удары ножом: взмах справа налево и выпад вперёд (общая основа, ножи меняют размах)
const slashPose = (t, size = 1) => {
  const s = Math.sin(Math.PI * t);
  return { rx: -0.2 * s, ry: 0.5 * s * size, rz: -0.9 * s * size, px: (0.06 - 0.18 * t) * size, py: 0.03 * s, pz: -0.08 * s };
};
const thrust = t => (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7);
const stabPose = (t, reach = 1) => {
  const k = thrust(t);
  return { rx: -0.3 * k, px: -0.04 * k, py: 0.02 * k, pz: -0.2 * k * reach };
};

const GUN_ANIMS = {
  rifle: {
    // поднять и передёрнуть затвор
    draw: { time: 1.0, fn: (t, p) => {
      const s = bump(t, 0.55, 0.9);
      p.bolt.position.z = p.boltRest + 0.07 * s;
      return add(raise(seg(t, 0, 0.5)), { rz: -0.18 * s, rx: 0.05 * s, px: -0.02 * s });
    } },
    inspect: { time: 2.8, fn: GUN_INSPECT },
  },
  pistol: {
    // поднять и передёрнуть кожух
    draw: { time: 0.7, fn: (t, p) => {
      const s = bump(t, 0.5, 0.85);
      p.bolt.position.z = p.boltRest + 0.05 * s;
      return add(raise(seg(t, 0, 0.45)), { rz: -0.25 * s, rx: 0.08 * s });
    } },
    inspect: { time: 2.2, fn: GUN_INSPECT },
  },
  awp: {
    draw: { time: 1.2, fn: (t, p) => {
      const s = bump(t, 0.55, 0.95);
      p.bolt.position.z = p.boltRest + 0.08 * s;
      return add(raise(seg(t, 0, 0.5)), { rz: -0.2 * s, rx: 0.05 * s });
    } },
    inspect: { time: 2.8, fn: GUN_INSPECT },
    // после выстрела — передёрнуть затвор
    bolt: { time: 1.1, fn: (t, p) => {
      const s = bump(t, 0.25, 0.8);
      p.bolt.position.z = p.boltRest + 0.09 * s;
      return { rz: -0.3 * s, rx: 0.08 * s, py: -0.03 * s };
    } },
  },
  deagle: {
    draw: { time: 0.75, fn: (t, p) => {
      const s = bump(t, 0.5, 0.85);
      p.bolt.position.z = p.boltRest + 0.06 * s;
      return add(raise(seg(t, 0, 0.45)), { rz: -0.25 * s, rx: 0.08 * s });
    } },
    inspect: { time: 2.2, fn: GUN_INSPECT },
  },
};
// Гранаты: достать и бросок (замах назад, бросок вперёд)
const NADE_ANIMS = {
  draw: { time: 0.5, fn: t => raise(seg(t, 0, 1)) },
  throw: { time: 0.45, fn: t => {
    const back = bump(t, 0, 0.45), fwd = seg(t, 0.4, 0.75);
    return { rx: 0.6 * back - 0.9 * fwd, py: 0.08 * back - 0.25 * fwd, pz: 0.05 * back - 0.35 * fwd };
  } },
};
for (const k of NADE_KINDS) GUN_ANIMS[k] = NADE_ANIMS;

// ---------- Перезарядка: левая рука меняет магазин ----------
// Путь по ключевым точкам: keys — [[момент 0..1, [dx, dy, dz]], ...], между точками — плавно
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i][0]) continue;
    const [t0, a] = keys[i - 1], [t1, b] = keys[i];
    const k = ease((t - t0) / (t1 - t0));
    return a.map((v, j) => v + (b[j] - v) * k);
  }
  return keys[keys.length - 1][1];
}
const addV = (a, b) => a.map((v, i) => v + b[i]);
function placeLeft(p, off, rot = 0) {
  p.leftArm.position.copy(p.leftRest).add(new THREE.Vector3(...off));
  p.leftArm.rotation.x = rot;
}
function placeMag(p, off, rot = 0, visible = true) {
  p.mag.position.copy(p.magRest).add(new THREE.Vector3(...off));
  p.mag.rotation.x = p.magRot + rot;
  p.mag.visible = visible;
}

// Винтовки (AKR, AWP). Наклонить оружие → левая рука берёт магазин → вынимает и уводит вниз →
// приносит новый → вставляет (оружие вздрагивает) → рука идёт к затвору и передёргивает его → обратно на цевьё.
// grab — где левая рука держит магазин (сдвиг от её места на цевье); bolt — где ручка затвора; pull — ход затвора
function rifleReload({ grab, bolt, pull = 0.07 }) {
  return (t, p) => {
    // магазин: на месте → потянули вниз → ушёл за кадр (там подменяется) → новый снизу → вошёл
    const out = [-0.06, -0.55, 0.12];
    const magOff = track(t, [[0.28, [0, 0, 0]], [0.4, [0, -0.13, -0.02]], [0.5, out], [0.52, out], [0.64, [0, -0.13, -0.02]], [0.71, [0, 0, 0]]]);
    const magRot = 0.5 * bump(t, 0.3, 0.68);
    placeMag(p, magOff, magRot, t < 0.5 || t > 0.52);
    // левая рука: к магазину → вместе с ним → снова на цевьё → к затвору → дёрнуть назад → на цевьё
    let hand;
    if (t < 0.28) hand = track(t, [[0.02, [0, 0, 0]], [0.2, grab]]);
    else if (t < 0.71) hand = addV(grab, magOff);
    else if (t < 0.78) hand = track(t, [[0.71, grab], [0.78, [0, 0, 0]]]);
    else hand = track(t, [[0.78, [0, 0, 0]], [0.85, bolt], [0.88, bolt], [0.92, addV(bolt, [0, 0, pull])], [0.94, addV(bolt, [0, 0, pull])], [1, [0, 0, 0]]]);
    placeLeft(p, hand, -0.4 * bump(t, 0.2, 0.72));
    p.bolt.position.z = p.boltRest + pull * bump(t, 0.87, 0.97);
    // рука держит магазин — пальцы сжаты; тянется к нему и к затвору — раскрыты
    const reach = bump(t, 0.05, 0.22) + bump(t, 0.76, 0.88);
    if (p.leftFingers) for (const f of Object.values(p.leftFingers)) f.pose(0.8 * reach);
    // оружие: наклон набок, чтобы было видно горловину магазина; толчок, когда магазин встал
    const tilt = ease(seg(t, 0, 0.15)) * (1 - ease(seg(t, 0.88, 1)));
    const jolt = bump(t, 0.69, 0.76), rack = bump(t, 0.88, 0.96);
    return { rz: -0.45 * tilt - 0.12 * rack, rx: 0.12 * tilt + 0.06 * jolt, px: -0.03 * tilt, py: 0.02 * tilt + 0.015 * jolt };
  };
}
// Пистолеты: магазин выпадает сам, затвор встаёт назад → левая рука уходит вниз и приносит новый →
// вставляет в рукоять снизу (толчок) → затвор с щелчком возвращается вперёд
function pistolReload({ grab, slide = 0.05 }) {
  return (t, p) => {
    const magOff = track(t, [[0.08, [0, 0, 0]], [0.3, [0.02, -0.55, 0.08]], [0.38, [0.02, -0.55, 0.08]], [0.56, [0, -0.07, 0.015]], [0.64, [0, 0, 0]]]);
    placeMag(p, magOff, 0.3 * bump(t, 0.1, 0.6), t < 0.3 || t > 0.38);
    let hand;
    if (t < 0.38) hand = track(t, [[0.05, [0, 0, 0]], [0.25, [-0.03, -0.42, 0.1]], [0.38, addV(grab, [0.02, -0.55, 0.08])]]);
    else if (t < 0.64) hand = addV(grab, magOff);
    else hand = track(t, [[0.64, grab], [0.78, [0, 0, 0]]]);
    placeLeft(p, hand, 0.3 * bump(t, 0.05, 0.78));
    const reach = bump(t, 0.6, 0.8);
    if (p.leftFingers) for (const f of Object.values(p.leftFingers)) f.pose(0.6 * reach);
    // пустой пистолет — затвор назад; новый магазин вставлен — затвор щёлкает вперёд
    p.bolt.position.z = p.boltRest + slide * ease(seg(t, 0.02, 0.1)) * (1 - seg(t, 0.82, 0.86));
    const tilt = ease(seg(t, 0, 0.12)) * (1 - ease(seg(t, 0.85, 1)));
    const jolt = bump(t, 0.62, 0.7), snap = bump(t, 0.82, 0.92);
    return { rz: 0.35 * tilt, rx: 0.18 * tilt + 0.07 * jolt + 0.08 * snap, py: 0.02 * tilt + 0.012 * jolt, px: -0.02 * tilt };
  };
}
// Дробовик: оружие наклонено окном вниз, левая рука 4 раза приносит патрон снизу и вталкивает его,
// в конце — передёргивает помпу
const PORT = [0, -0.02, 0.3];   // окно заряжания (сдвиг от места левой руки на помпе)
function shellReload(t, p) {
  let hand = [0, 0, 0], holding = false;
  const k = seg(t, 0.08, 0.8);
  if (k > 0 && k < 1) {
    const u = (k * 4) % 1;   // какой по счёту патрон и где сейчас рука в этом цикле
    const below = addV(PORT, [0.05, -0.28, 0.06]), push = addV(PORT, [0, 0.035, -0.02]);
    hand = track(u, [[0, below], [0.42, PORT], [0.58, push], [1, below]]);
    holding = u < 0.55;
    if (t < 0.15) hand = track(t, [[0.08, [0, 0, 0]], [0.15, hand]]);
  } else if (t >= 0.8) {
    const pump = 0.08 * bump(t, 0.84, 0.97);
    hand = track(t, [[0.8, addV(PORT, [0.05, -0.28, 0.06])], [0.84, [0, 0, 0]]]);
    hand = addV(hand, [0, 0, pump]);
    p.bolt.position.z = p.boltRest + pump;
  }
  placeLeft(p, hand, 0.3 * bump(t, 0.08, 0.8));
  p.shell.visible = holding;
  if (p.leftFingers) for (const f of Object.values(p.leftFingers)) f.pose(holding ? -0.1 : 0.5);
  const tilt = ease(seg(t, 0, 0.1)) * (1 - ease(seg(t, 0.82, 0.95)));
  const push = bump((k * 4) % 1, 0.45, 0.65) * (k > 0 && k < 1 ? 1 : 0);
  return { rz: 0.5 * tilt, rx: 0.1 * tilt + 0.03 * push, py: 0.02 * tilt, px: -0.02 * tilt };
}
// Помпа после выстрела дробовика: левая рука тянет цевьё назад и возвращает
function pumpAction(t, p) {
  const pump = 0.08 * bump(t, 0.1, 0.75);
  p.bolt.position.z = p.boltRest + pump;
  placeLeft(p, [0, 0, pump]);
  return { rz: -0.08 * bump(t, 0.1, 0.75), rx: 0.04 * bump(t, 0.1, 0.5) };
}
const rifleDraw = (time, pull) => ({ time, fn: (t, p) => {
  const s = bump(t, 0.55, 0.9);
  p.bolt.position.z = p.boltRest + pull * s;
  return add(raise(seg(t, 0, 0.5)), { rz: -0.18 * s, rx: 0.05 * s });
} });
GUN_ANIMS.m4 = {
  draw: rifleDraw(1.0, 0.06),
  inspect: { time: 2.8, fn: GUN_INSPECT },
  reload: { time: WEAPONS.m4.reload, fn: rifleReload({ grab: [0, -0.12, 0.27], bolt: [0.02, 0.13, 0.5], pull: 0.06 }) },
};
GUN_ANIMS.smg = {
  draw: rifleDraw(0.8, 0.06),
  inspect: { time: 2.4, fn: GUN_INSPECT },
  reload: { time: WEAPONS.smg.reload, fn: rifleReload({ grab: [0, -0.1, 0.15], bolt: [-0.04, 0.09, 0.04], pull: 0.06 }) },
};
GUN_ANIMS.shotgun = {
  draw: { time: 0.9, fn: (t, p) => add(raise(seg(t, 0, 0.5)), pumpAction(seg(t, 0.45, 1), p)) },
  inspect: { time: 2.8, fn: GUN_INSPECT },
  reload: { time: WEAPONS.shotgun.reload, fn: shellReload },
  pump: { time: 0.55, fn: pumpAction },
};
GUN_ANIMS.rifle.reload = { time: WEAPONS.rifle.reload, fn: rifleReload({ grab: [0, -0.15, 0.17], bolt: [0.07, 0.1, 0.25] }) };
GUN_ANIMS.awp.reload = { time: WEAPONS.awp.reload, fn: rifleReload({ grab: [0, -0.09, 0.27], bolt: [0.07, 0.1, 0.42], pull: 0.09 }) };
GUN_ANIMS.pistol.reload = { time: WEAPONS.pistol.reload, fn: pistolReload({ grab: [0.02, -0.09, 0.03] }) };
GUN_ANIMS.deagle.reload = { time: WEAPONS.deagle.reload, fn: pistolReload({ grab: [0.02, -0.1, 0.03], slide: 0.06 }) };

// Пальцы в анимациях: 0 — сжаты на рукояти, 1 — разжаты, меньше 0 — стиснуты сильнее
function fingers(p, v) {
  if (!p.fingers) return;
  for (const k in v) p.fingers[k]?.pose(v[k]);
}
const all4 = v => ({ index: v, middle: v, ring: v, pinky: v });
// «Волна»: пальцы по очереди (от указательного к мизинцу) приподнимаются и снова ложатся на рукоять
function ripple(p, t, a, b, amount = 0.6) {
  const d = (b - a) / 2.2;
  ['index', 'middle', 'ring', 'pinky'].forEach((n, i) => fingers(p, { [n]: amount * bump(t, a + i * d * 0.4, a + i * d * 0.4 + d) }));
}
// Перебор пальцами во время трюка (бабочка): пальцы быстро и вразнобой шевелятся, k — сила
function flick(p, t, k, speed = 38) {
  fingers(p, {
    index: k * (0.55 + 0.45 * Math.sin(t * speed)), middle: k * (0.55 + 0.45 * Math.sin(t * speed - 1.2)),
    ring: k * (0.5 + 0.4 * Math.sin(t * speed - 2.4)), pinky: k * 0.6, thumb: k * (0.5 + 0.5 * Math.sin(t * speed + 1.6)),
  });
}
// Удар: кулак сжимается
const squeeze = (p, k) => fingers(p, { ...all4(-0.25 * k), thumb: -0.2 * k });

// Осмотр клинка: нож встаёт в кулаке вертикально, клинком вверх (как ложка в кружке),
// и медленно поворачивается — сначала одной стороной клинка к игроку, потом другой.
// Поворачиваются только нож и кулак, рукав остаётся на месте.
const BLADE_DIR = new THREE.Vector3(0, 0, -1);                  // куда смотрит клинок в координатах ножа
const INSPECT_UP = new THREE.Vector3(-0.15, 1, 0.12).normalize(); // «вверх», чуть к центру и к игроку
const _qUp = new THREE.Quaternion(), _qTurn = new THREE.Quaternion();
function standUp(p, amount, turn) {
  const up = INSPECT_UP.clone().applyQuaternion(p.kqInv);  // «вверх» в координатах ножа
  _qUp.setFromUnitVectors(BLADE_DIR, up);
  _qTurn.setFromAxisAngle(up, turn).multiply(_qUp);
  p.tilt.quaternion.identity().slerp(_qTurn, amount);
  p.rightGlove.quaternion.copy(p.kq).multiply(p.tilt.quaternion);  // кулак поворачивается с ножом
  return { px: -0.1 * amount, py: -0.01 * amount, pz: -0.1 * amount };  // к центру и чуть дальше, чтобы клинок целиком в кадре
}
// t: 0–0.18 поднять, 0.2–0.72 разглядывать (поворот от -50° до +50°), 0.78–0.95 вернуть
// Пальцы при осмотре: большой проводит по клинку туда-обратно, потом остальные перебирают рукоять волной
function bladeView(t, p) {
  const pose = standUp(p,
    ease(seg(t, 0, 0.18)) * (1 - ease(seg(t, 0.78, 0.95))),
    -0.9 + 1.8 * ease(seg(t, 0.2, 0.72)));
  fingers(p, { thumb: 0.55 * Math.abs(Math.sin(Math.PI * 2 * seg(t, 0.22, 0.5))) });
  ripple(p, t, 0.5, 0.74, 0.55);
  return pose;
}

const KNIFE_ANIMS = {
  default: {
    // поднимается, прокручиваясь вокруг своей оси
    // нож прокручивается в разжатых пальцах, и кулак снова смыкается
    draw: { time: 0.6, fn: (t, p) => {
      p.spin.rotation.z = (1 - ease(seg(t, 0, 0.85))) * TAU;
      const open = 0.8 * (1 - ease(seg(t, 0.45, 0.85)));
      fingers(p, { ...all4(open), thumb: 0.7 * open });
      return raise(seg(t, 0, 0.7));
    } },
    // осмотр: клинок вертикально, разглядывает обе стороны, большой палец гладит клинок
    inspect: { time: 3.0, fn: bladeView },
    slash: { time: 0.3, fn: (t, p) => { squeeze(p, Math.sin(Math.PI * t)); return slashPose(t); } },
    stab: { time: 0.55, fn: (t, p) => { squeeze(p, thrust(t)); return stabPose(t); } },
  },
  karambit: {
    // два оборота на указательном пальце (он в кольце) — остальные пальцы отпускают рукоять
    draw: { time: 0.9, fn: (t, p) => {
      p.spin.rotation.x = -ease(seg(t, 0.1, 0.9)) * TAU * 2;
      const open = bump(t, 0.05, 0.95);
      fingers(p, { index: -0.15 * open, middle: 0.85 * open, ring: 0.9 * open, pinky: 0.95 * open, thumb: 0.8 * open });
      return raise(seg(t, 0, 0.4));
    } },
    // разглядывает клинок, потом крутит на кольце, возвращая в руку
    inspect: { time: 3.2, fn: (t, p) => {
      p.spin.rotation.x = -ease(seg(t, 0.8, 0.98)) * TAU;
      const pose = bladeView(t, p);
      const open = bump(t, 0.77, 0.99);
      if (open > 0) fingers(p, { index: -0.15 * open, middle: 0.85 * open, ring: 0.9 * open, pinky: 0.95 * open, thumb: 0.8 * open });
      return pose;
    } },
    // удар крюком снизу вверх
    slash: { time: 0.32, fn: (t, p) => {
      const s = Math.sin(Math.PI * t);
      p.spin.rotation.x = 0.6 * s;
      squeeze(p, s);
      return { rx: -0.7 * s, ry: 0.3 * s, rz: -0.4 * s, px: 0.05 - 0.15 * t, py: 0.06 * s, pz: -0.06 * s };
    } },
    stab: { time: 0.55, fn: (t, p) => {
      p.spin.rotation.x = -0.8 * thrust(t);
      squeeze(p, thrust(t));
      return stabPose(t, 0.9);
    } },
  },
  butterfly: {
    // раскрытие: пальцы перебирают, отпуская и ловя половинки, вторая половинка делает полный оборот
    draw: { time: 1.1, fn: (t, p) => {
      const u = ease(seg(t, 0.2, 0.9));
      setBlade(p, u);
      p.halfB.rotation.x = -TAU * u;
      flick(p, t, bump(t, 0.15, 0.95));
      return add(raise(seg(t, 0, 0.35)), { rz: 0.15 * bump(t, 0.2, 0.9) });
    } },
    // разглядывает клинок, посередине пальцами складывает и снова раскрывает
    inspect: { time: 3.2, fn: (t, p) => {
      const close = ease(seg(t, 0.4, 0.5)), open = ease(seg(t, 0.52, 0.64));
      setBlade(p, 1 - close + open);
      p.halfB.rotation.x = TAU * close - TAU * open;
      const pose = bladeView(t, p);
      const k = bump(t, 0.37, 0.67);
      if (k > 0) flick(p, t * 3.2, k, 24);  // в секундах — чтобы скорость пальцев не зависела от длины анимации
      return pose;
    } },
    slash: { time: 0.28, fn: (t, p) => { squeeze(p, Math.sin(Math.PI * t)); return slashPose(t, 1.1); } },
    // два быстрых тычка
    stab: { time: 0.5, fn: (t, p) => {
      const k = bump(t, 0, 0.5) + bump(t, 0.5, 1);
      squeeze(p, k);
      return scalePose({ rx: -0.25, px: -0.03, pz: -0.16 }, k);
    } },
  },
  skeleton: {
    // подбрасывает (пальцы раскрываются) и ловит с переворотом (кулак резко сжимается)
    draw: { time: 0.8, fn: (t, p) => {
      p.spin.rotation.x = -ease(seg(t, 0.2, 0.8)) * TAU;
      const air = bump(t, 0.15, 0.78), catchIt = bump(t, 0.75, 0.95);
      fingers(p, { ...all4(0.95 * air - 0.3 * catchIt), thumb: 0.85 * air - 0.2 * catchIt });
      return add(raise(seg(t, 0, 0.3)), { py: 0.12 * bump(t, 0.2, 0.8) });
    } },
    // разглядывает клинок, потом подбрасывает с переворотом и ловит
    inspect: { time: 3.2, fn: (t, p) => {
      p.spin.rotation.x = -ease(seg(t, 0.8, 0.98)) * TAU;
      const pose = bladeView(t, p);
      const air = bump(t, 0.78, 0.96), catchIt = bump(t, 0.95, 1);
      if (air + catchIt > 0) fingers(p, { ...all4(0.95 * air - 0.3 * catchIt), thumb: 0.85 * air - 0.2 * catchIt });
      return add(pose, { py: 0.1 * bump(t, 0.8, 0.98) });
    } },
    // широкий размашистый взмах
    slash: { time: 0.34, fn: (t, p) => { squeeze(p, Math.sin(Math.PI * t)); return slashPose(t, 1.3); } },
    stab: { time: 0.55, fn: (t, p) => { squeeze(p, thrust(t)); return stabPose(t); } },
  },
  stiletto: {
    // большой палец поднимается к кнопке и жмёт — клинок выкидывается с щелчком
    draw: { time: 0.8, fn: (t, p) => {
      setBlade(p, ease(seg(t, 0.45, 0.72)));
      fingers(p, { thumb: 0.7 * bump(t, 0.2, 0.45) - 0.35 * bump(t, 0.42, 0.7), index: 0.2 * bump(t, 0.4, 0.75) });
      return add(raise(seg(t, 0, 0.45)), { rz: -0.15 * bump(t, 0.7, 0.85) });
    } },
    // разглядывает клинок, потом складывает и с щелчком выкидывает снова (два нажатия большим пальцем)
    inspect: { time: 3.2, fn: (t, p) => {
      setBlade(p, 1 - ease(seg(t, 0.74, 0.82)) + ease(seg(t, 0.88, 0.95)));
      const pose = bladeView(t, p);
      const press = bump(t, 0.72, 0.84) + bump(t, 0.86, 0.97);
      if (press > 0) fingers(p, { thumb: 0.6 * bump(t, 0.7, 0.76) + 0.6 * bump(t, 0.84, 0.89) - 0.35 * press });
      return add(pose, { rz: -0.1 * bump(t, 0.88, 0.97) });
    } },
    // быстрый косой удар и длинный выпад
    slash: { time: 0.28, fn: (t, p) => {
      const s = Math.sin(Math.PI * t);
      squeeze(p, s);
      return { rx: -0.35 * s, ry: 0.35 * s, rz: -0.6 * s, px: 0.04 - 0.12 * t, pz: -0.1 * s };
    } },
    stab: { time: 0.5, fn: (t, p) => { squeeze(p, thrust(t)); return stabPose(t, 1.3); } },
  },
  m9: {
    // доставание: пальцы раскрываются, нож делает оборот назад через себя с перекатом вокруг клинка,
    // и кулак ловит его за рукоять
    draw: { time: 1.0, fn: (t, p) => {
      const u = ease(seg(t, 0.12, 0.78));
      p.spin.rotation.x = u * TAU;
      p.spin.rotation.z = u * TAU;
      const air = bump(t, 0.08, 0.8), grab = bump(t, 0.76, 0.94);
      fingers(p, { ...all4(0.9 * air - 0.3 * grab), thumb: 0.85 * air - 0.2 * grab });
      return add(raise(seg(t, 0, 0.3)), { py: 0.06 * bump(t, 0.12, 0.78), rz: -0.12 * grab, rx: 0.08 * grab });
    } },
    // осмотр: разглядывает клинок с обеих сторон → крутит «пропеллером» вокруг клинка, перебирая пальцами →
    // перехватывает обратным хватом (клинок вниз) и возвращает обратно
    inspect: { time: 4.2, fn: (t, p) => {
      const look = t < 0.55 ? bladeView(t / 0.55, p) : {};
      const twirl = ease(seg(t, 0.56, 0.78));
      p.spin.rotation.z = twirl * TAU * 2;
      if (t >= 0.55 && t < 0.8) flick(p, t * 4.2, bump(t, 0.55, 0.8), 30);
      const rev = bump(t, 0.8, 1);
      p.spin.rotation.x = -Math.PI * ease(rev);
      if (t >= 0.8) fingers(p, { ...all4(0.7 * bump(t, 0.8, 0.88) + 0.7 * bump(t, 0.92, 1)), thumb: 0.5 * bump(t, 0.82, 0.98) });
      const k = bump(t, 0.55, 1);
      return add(look, { px: -0.05 * k, py: 0.03 * k, rz: -0.15 * bump(t, 0.56, 0.78) });
    } },
    slash: { time: 0.3, fn: (t, p) => { squeeze(p, Math.sin(Math.PI * t)); return slashPose(t, 1.15); } },
    stab: { time: 0.55, fn: (t, p) => { squeeze(p, thrust(t)); return stabPose(t, 1.1); } },
  },
};

// Текущая анимация в руках (одна за раз): { name, start, def }
let anim = null;
// Что сейчас в руках на экране: своё оружие или (при наблюдении) оружие того, за кем смотрим
let watching = null;      // игрок, глазами которого смотрим после смерти
let lastShownKey = '';    // кого и с каким оружием показывали в прошлом кадре
const specKnives = {};    // модели чужих ножей для наблюдения (строятся по запросу)
function shownWeapon() {
  if (!watching) return me.weapon;
  const w = watching.data.weapon;
  return (WEAPONS[w] || w === 'knife') ? w : 'rifle';
}
function shownVM() {
  const w = shownWeapon();
  if (w !== 'knife') return viewModels[w];
  const type = watching ? (KNIVES[watching.data.knife] ? watching.data.knife : 'default') : myKnife;
  if (type === viewModels.knife.userData.knifeType) return viewModels.knife;
  if (!specKnives[type]) {
    specKnives[type] = buildKnifeViewModel(type);
    hands.add(specKnives[type]);
  }
  return specKnives[type];
}
function animSet() {
  const vm = shownVM();
  return vm.userData.knifeType ? KNIFE_ANIMS[vm.userData.knifeType] : GUN_ANIMS[shownWeapon()];
}
function playAnim(name) {
  const def = animSet()?.[name];
  anim = def ? { name, start: performance.now(), def } : null;
  return def;
}
function startInspect() {
  if (!me.alive || me.reloadEnd || me.ads || anim) return;
  playAnim('inspect');
}
function cancelInspect() { if (anim?.name === 'inspect') anim = null; }
// Доставание: анимация и короткая пауза, пока оружие не готово
function drawWeapon() {
  const def = playAnim('draw');
  if (def) me.nextShot = performance.now() + def.time * 800;
}
// Вернуть подвижные детали на место; активная анимация потом сдвинет их заново
function restParts(ud) {
  if (ud.bolt) ud.bolt.position.z = ud.boltRest;
  if (ud.spin) ud.spin.rotation.set(0, 0, 0);
  if (ud.tilt) { ud.tilt.quaternion.identity(); ud.rightGlove.quaternion.copy(ud.kq); }
  if (ud.blade) ud.blade.rotation.x = 0;
  if (ud.halfB) ud.halfB.rotation.x = 0;
  if (ud.mag) { ud.mag.position.copy(ud.magRest); ud.mag.rotation.set(ud.magRot, 0, 0); ud.mag.visible = true; }
  if (ud.leftRest) { ud.leftArm.position.copy(ud.leftRest); ud.leftArm.rotation.set(0, 0, 0); }
  if (ud.shell) ud.shell.visible = false;
  // пальцы — в обычный хват, чуть «дышат», чтобы рука не выглядела застывшей
  const now = performance.now() / 1000;
  for (const set of [ud.fingers, ud.leftFingers]) {
    if (!set) continue;
    let i = 0;
    for (const f of Object.values(set)) f.pose(0.035 * Math.sin(now * 1.3 + i++ * 1.1));
  }
}
function animPose(now, vm) {
  restParts(vm.userData);
  if (!anim) return null;
  const t = (now - anim.start) / 1000 / anim.def.time;
  if (t >= 1) { anim = null; return null; }
  return anim.def.fn(t, vm.userData);
}

function startReload() {
  if (me.weapon === 'knife') return;
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  if (me.reloadEnd || a.mag === w.mag || a.reserve <= 0 || !me.alive) return;
  cancelInspect();
  me.reloadEnd = performance.now() + w.reload * 1000;
  ui.reloadBar.style.visibility = 'visible';
  playAnim('reload');
  // звуки по ходу анимации: магазин вынут, вставлен, затвор (если перезарядку не прервали)
  const end = me.reloadEnd, pistol = me.weapon === 'pistol' || me.weapon === 'deagle';
  const at = (k, fn) => setTimeout(() => { if (me.reloadEnd === end) fn(); }, k * w.reload * 1000);
  at(pistol ? 0.1 : 0.32, () => { playShot(0.12, 2500, 0.05); playTone(420, 0.04, 0.06); });   // защёлка, магазин вышел
  at(pistol ? 0.62 : 0.7, () => { playShot(0.2, 3000, 0.05); playTone(700, 0.05, 0.08); });   // магазин встал
  at(pistol ? 0.83 : 0.89, () => { playShot(0.25, 3500, 0.06); playTone(950, 0.04, 0.07); }); // затвор
}
function finishReload() {
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  const take = Math.min(w.mag - a.mag, a.reserve);
  a.mag += take; a.reserve -= take;
  me.reloadEnd = 0;
  ui.reloadBar.style.visibility = 'hidden';
  playTone(700, 0.05, 0.08);
}
function switchWeapon(kind) {
  if (bombInHands && kind && owns(kind)) { bombInHands = false; if (kind === me.weapon) { drawWeapon(); return; } }  // убрать бомбу
  if (!kind || kind === me.weapon || !viewModels[kind] || !owns(kind)) return;
  me.ads = false;
  scope = 0;
  me.weapon = kind; me.reloadEnd = 0;
  drawWeapon();
  ui.reloadBar.style.visibility = 'hidden';
}
// 4 — следующая граната из тех, что есть
function nextNade() {
  const have = NADE_KINDS.filter(n => inv.nades[n] > 0);
  if (!have.length) return;
  const i = have.indexOf(me.weapon);
  switchWeapon(have[(i + 1) % have.length]);
}

// Бросок гранаты: ЛКМ — далеко, ПКМ — недалеко, навесом
function throwNade(lob) {
  const now = performance.now();
  if (!me.alive || chatOpen || phase === 'freeze' || now < me.nextShot || !isNade(me.weapon)) return;
  me.nextShot = now + 900;
  const kind = me.weapon;
  playAnim('throw');
  setTimeout(() => {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone().addScaledVector(dir, 0.4);
    const vel = dir.multiplyScalar(lob ? 8 : 17).add(new THREE.Vector3(me.vel.x * 0.5, lob ? 3 : 2.5, me.vel.z * 0.5));
    send({ type: 'throw', kind, pos: pos.toArray(), vel: vel.toArray() });
    playShot(0.25, 600, 0.12);
  }, 180);
}

// ================== ДВИЖЕНИЕ И СТОЛКНОВЕНИЯ ==================
function overlaps(b, p) {
  return p.x + RADIUS > b.minX && p.x - RADIUS < b.maxX &&
         p.z + RADIUS > b.minZ && p.z - RADIUS < b.maxZ &&
         p.y + heightAt(me.crouch) > b.minY && p.y < b.maxY;
}
function blocked(p) { return colliders.some(b => overlaps(b, p)); }

function moveAxis(axis, delta) {
  if (!delta) return;
  me.pos[axis] += delta;
  for (const b of colliders) {
    if (!overlaps(b, me.pos)) continue;
    // невысокие препятствия перешагиваем
    const up = b.maxY - me.pos.y;
    if (me.onGround && up > 0 && up <= STEP) {
      const test = me.pos.clone(); test.y = b.maxY + 0.001;
      if (!blocked(test)) { me.pos.y = test.y; continue; }
    }
    const min = axis === 'x' ? b.minX : b.minZ, max = axis === 'x' ? b.maxX : b.maxZ;
    me.pos[axis] = delta > 0 ? min - RADIUS - 0.001 : max + RADIUS + 0.001;
  }
}

function updateMovement(dt) {
  // в заморозке и пока закладываешь/разминируешь — можно только осматриваться
  const frozen = phase === 'freeze' || busyWithBomb();
  let fwd = frozen ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  let side = frozen ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let analog = 1;  // джойстик на телефоне: чуть отклонил — идёшь медленно (и тихо)
  if (touchMove && !frozen) {
    fwd = -touchMove.y;
    side = touchMove.x;
    analog = Math.min(1, Math.hypot(touchMove.x, touchMove.y));
  }
  const crouchHeld = keys.ControlLeft || keys.ControlRight || keys.KeyC;
  me.crouch += ((crouchHeld ? 1 : 0) - me.crouch) * Math.min(1, dt * 12);
  const speed = me.crouch > 0.5 ? CROUCH_SPEED
    : (keys.ShiftLeft || me.ads) ? WALK_SPEED
    : scope ? WALK_SPEED  // в прицеле AWP — медленно
    : me.weapon === 'knife' || isNade(me.weapon) ? RUN_SPEED * 1.12
    : me.weapon === 'awp' ? RUN_SPEED * 0.85
    : me.weapon === 'pistol' || me.weapon === 'deagle' ? RUN_SPEED * 1.05
    : me.weapon === 'smg' ? RUN_SPEED * 1.08 : me.weapon === 'shotgun' ? RUN_SPEED * 0.95 : RUN_SPEED;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let wx = -sin * fwd + cos * side, wz = -cos * fwd - sin * side;
  const len = Math.hypot(wx, wz);
  const wishSpeed = speed * rules.speed * cheat.speed * analog;  // cheat.speed — множитель из панели читов (обычно 1)
  if (len > 0) { wx = wx / len * wishSpeed; wz = wz / len * wishSpeed; }

  // Прыжок — до трения о землю: если держать пробел, игрок отталкивается в тот же кадр,
  // когда приземлился, и не теряет скорость (бхоп).
  // Высота прыжка растёт как квадрат скорости, поэтому множитель прыжка — под корнем
  if (keys.Space && me.onGround && !frozen && !cheat.fly) {
    me.vel.y = JUMP_SPEED * Math.sqrt(rules.jump * rules.gravity);
    me.onGround = false;
    playStep(null, 0.18, 0.8);
  }
  if (me.onGround || cheat.fly) {  // в полёте управление как на земле
    // на земле — быстро разгоняемся до нужной скорости и тормозим (трение)
    me.vel.x += (wx - me.vel.x) * Math.min(1, 12 * dt);
    me.vel.z += (wz - me.vel.z) * Math.min(1, 12 * dt);
  } else if (len > 0) {
    // В воздухе — как в CS: в сторону нажатой клавиши можно добавить лишь чуть-чуть скорости (AIR_CAP),
    // зато если вести мышью вслед за стрейфом (A + мышь влево, D + мышь вправо), направление постоянно
    // меняется и каждый кадр добавляет ещё — так бхоп набирает скорость. Без клавиш скорость сохраняется.
    const ux = wx / wishSpeed, uz = wz / wishSpeed;
    const add = AIR_CAP - (me.vel.x * ux + me.vel.z * uz);
    if (add > 0) {
      const acc = Math.min(AIR_ACCEL * wishSpeed * dt, add);
      me.vel.x += ux * acc;
      me.vel.z += uz * acc;
    }
  }
  // предел скорости, чтобы бхоп не превращался в телепорт
  const hs = Math.hypot(me.vel.x, me.vel.z), maxHs = BHOP_MAX * rules.speed * cheat.speed;
  if (hs > maxHs) { me.vel.x *= maxHs / hs; me.vel.z *= maxHs / hs; }
  if (!cheat.fly) stepSounds(dt, hs);

  if (cheat.noclip) {  // сквозь стены — просто двигаемся, без столкновений (но за край карты не уходим)
    me.pos.x = Math.max(-39.5, Math.min(39.5, me.pos.x + me.vel.x * dt));
    me.pos.z = Math.max(-39.5, Math.min(39.5, me.pos.z + me.vel.z * dt));
  } else {
    moveAxis('x', me.vel.x * dt);
    moveAxis('z', me.vel.z * dt);
  }

  // полёт: без гравитации, пробел — вверх, Ctrl/C — вниз
  if (cheat.fly) me.vel.y = ((keys.Space ? 1 : 0) - (crouchHeld ? 1 : 0)) * 7 * cheat.speed;
  else me.vel.y -= GRAVITY * rules.gravity * dt;
  me.pos.y += me.vel.y * dt;
  const fallSpeed = -me.vel.y, wasOnGround = me.onGround;
  me.onGround = false;
  if (me.pos.y <= 0) { me.pos.y = 0; me.vel.y = Math.max(0, me.vel.y); me.onGround = !cheat.fly; }
  if (cheat.noclip) return;  // сквозь стены — и по вертикали тоже (крыши, ящики)
  for (const b of colliders) {
    if (!overlaps(b, me.pos)) continue;
    if (me.vel.y <= 0) { me.pos.y = b.maxY; me.onGround = true; }
    else me.pos.y = b.minY - heightAt(me.crouch) - 0.001;
    me.vel.y = 0;
  }
  if (me.onGround && !wasOnGround && fallSpeed > 3) playStep(null, Math.min(0.45, fallSpeed * 0.04), 0.7);  // приземление
}

// ================== ШАГИ ==================
const AIR_CAP = 0.9, AIR_ACCEL = 12, BHOP_MAX = 14;  // бхоп: прибавка в воздухе, разгон, предел скорости
const STEP_LEN = 1.9;     // шаг — каждые 1.9 м
const LOUD_SPEED = 3.6;   // быстрее этого — бег, его слышно; тихий шаг (Shift, 3 м/с) и присед — бесшумны
let myStepDist = 0;
function stepSounds(dt, hs) {
  if (!me.onGround || hs < LOUD_SPEED) { myStepDist = Math.min(myStepDist, STEP_LEN * 0.6); return; }
  myStepDist += hs * dt;
  if (myStepDist >= STEP_LEN) { myStepDist -= STEP_LEN; playStep(null, 0.12, 0.9 + Math.random() * 0.25); }
}
// Звук шага: короткий глухой шорох. pos — откуда (у чужих шагов: слышно с какой стороны и как далеко), null — свои
function playStep(pos, vol, pitch = 1) {
  if (!audio || !stepBuf || vol < 0.005) return;
  const src = audio.createBufferSource();
  src.buffer = stepBuf;
  src.playbackRate.value = pitch;
  const f = audio.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 520 * pitch; f.Q.value = 0.9;
  const g = audio.createGain();
  g.gain.value = vol * (opt.shotVolume ?? 100) / 100;
  let node = src.connect(f).connect(g);
  if (pos) {
    const p = audio.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = 2;
    p.maxDistance = 38;   // дальше — не слышно
    p.rolloffFactor = 1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y + 0.1; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y + 0.1, pos.z);
    node = node.connect(p);
  }
  node.connect(audio.master);
  src.start();
}
// «Уши» игрока — там, где камера, и смотрят туда же
function updateListener() {
  if (!audio) return;
  const L = audio.listener, c = camera.position;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  if (L.positionX) {
    L.positionX.value = c.x; L.positionY.value = c.y; L.positionZ.value = c.z;
    L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
    L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
  } else {
    L.setPosition(c.x, c.y, c.z);
    L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
  }
}
// Чужие шаги: бегущий по земле игрок (или бот) топает; прыжок и приземление тоже слышно
function remoteSteps(r, dt, moved, dy) {
  const grounded = Math.abs(dy) < 0.01;
  if (r.wasAir && grounded && r.airTime > 0.25) playStep(r.group.position, 0.7, 0.75);   // приземлился
  r.airTime = grounded ? 0 : (r.airTime || 0) + dt;
  r.wasAir = !grounded;
  if (!grounded || (r.netSpeed ?? r.speed) < LOUD_SPEED || r.data.crouch) { r.stepDist = Math.min(r.stepDist || 0, STEP_LEN * 0.6); return; }
  r.stepDist = (r.stepDist || 0) + moved;
  if (r.stepDist >= STEP_LEN) {
    r.stepDist -= STEP_LEN;
    playStep(r.group.position, 0.85, 0.85 + Math.random() * 0.3);
  }
}

// ================== УПРАВЛЕНИЕ ==================
let myName = '';
ui.play.onclick = () => {
  initAudio();
  lockMouse();  // захват мыши разрешён только прямо в обработчике клика
  if (settings.mode === 'lobby') {  // в лобби кнопка — «Начать» у хозяина; игру запустит сервер
    if (lobbyState) socialSend({ type: 'lobbyStart' });
    else socialSend({ type: 'lobbyCreate' });
    return;
  }
  startGame();
};
function startGame(room = null) {
  myName = ui.name.value.trim() || 'Игрок' + Math.floor(Math.random() * 1000);
  try { localStorage.setItem('sa_name', myName); } catch {}
  ui.play.disabled = true;
  ui.status.textContent = '';
  connect(myName, room);
}
ui.name.addEventListener('keydown', e => { if (e.key === 'Enter') ui.play.click(); });

// Захват мыши. Если браузер его не поддерживает (например, встроенное окно),
// включается запасной режим: обзор — с зажатой правой кнопкой мыши.
let lockWorked = false, dragLook = false, rightHeld = false;
const isLocked = () => document.pointerLockElement === renderer.domElement;
const mouseActive = () => isLocked() || dragLook || touchMode;

function lockMouse() {
  if (touchMode) { goFullscreenLandscape(); return; }  // на телефоне мыши нет — полный экран и горизонтально
  if (dragLook) return;
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(onLockFail);
  } catch { onLockFail(); }
}
function onLockFail() {
  // после Esc Chrome секунду не даёт захватить мышь снова — это не повод для запасного режима
  if (lockWorked || dragLook) { updatePauseHint(); return; }
  dragLook = true;
  addChat('Захват мыши недоступен в этом браузере: смотри по сторонам, зажав правую кнопку мыши');
  updatePauseHint();
}
function updatePauseHint() {
  ui.pause.classList.toggle('hidden', mouseActive() || !inGame || chatOpen || teamMenuOpen || optionsOpen || buyOpen || cheatPanelOpen);
  if (!ui.pause.classList.contains('hidden')) renderPausePlayers();
}
// На паузе — все игроки матча: у людей с профилем можно открыть карточку и добавить в друзья
let pausePlayersKey = '';
function renderPausePlayers() {
  const players = [...(lastSnapshot.players || [])].sort((a, b) =>
    (a.id !== me.id) - (b.id !== me.id) || a.team.localeCompare(b.team) || a.bot - b.bot);
  const friendIds = new Set(friendsData.friends.map(f => f.id));
  const key = JSON.stringify([players.map(p => [p.id, p.name, p.team, p.profile]), [...friendIds]]);
  if (key === pausePlayersKey) return;
  pausePlayersKey = key;
  const box = $('pausePlayers');
  box.textContent = '';
  for (const p of players) {
    const b = document.createElement('button');
    const dot = document.createElement('span');
    dot.className = 'teamDot';
    dot.style.background = p.team === 'ct' ? '#4b8bf5' : '#f5a623';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = p.id === me.id ? `${p.name} (ты)` : p.name;
    const note = document.createElement('small');
    if (p.bot) note.textContent = 'бот';
    else if (!p.profile) note.textContent = 'без профиля';
    else if (friendIds.has(p.profile)) { note.textContent = '✓ друг'; note.className = 'fr'; }
    else note.textContent = `#${p.profile}`;
    b.append(dot, nm, note);
    b.disabled = p.bot || !p.profile;
    b.addEventListener('click', () => openPlayerCard(p.profile));
    box.append(b);
  }
}
setInterval(() => { if (!ui.pause.classList.contains('hidden')) renderPausePlayers(); }, 1000);

// ================== МАГАЗИН (клавиша B) ==================
let buyOpen = false;
// сколько ещё можно покупать: сервер присылает в снимке (в разминке — без ограничения)
const buyLeft = () => Math.max(0, (lastSnapshot.buyLeft ?? 0) - (performance.now() - phaseSyncAt) / 1000);
const canBuy = () => inGame && me.alive && buyLeft() > 0 && (rules.weapons || 'buy') === 'buy';  // в лобби оружие может быть выдано правилами
function openBuy() {
  if (!canBuy()) { addChat('Покупать можно только в начале раунда'); return; }
  buyOpen = true;
  mouseDown = false;
  for (const k in keys) keys[k] = false;
  renderBuyMenu();
  $('buyMenu').classList.remove('hidden');
  document.exitPointerLock();
  updatePauseHint();
}
function closeBuy() {
  if (!buyOpen) return;
  buyOpen = false;
  $('buyMenu').classList.add('hidden');
  lockMouse();
  updatePauseHint();
}
$('buyClose').addEventListener('click', closeBuy);   // на телефоне нет клавиш B и Esc — закрываем крестиком
// цена с учётом разминки (бесплатно) и шлема, если жилет уже есть
function priceOf(item, base) {
  if (phase === 'warmup') return 0;
  return item === 'helmet' && inv.armor === 1 ? 350 : base;
}
function alreadyHas(item) {
  if (item === 'kevlar') return inv.armor >= 1;
  if (item === 'helmet') return inv.armor >= 2;
  if (isNade(item)) return inv.nades[item] > 0;
  return item === inv.primary || item === inv.secondary;
}
// сколько вернут при обмене: ствол того же слота, купленный в этом раунде, сдаётся за полную цену
function swapRefund(item) {
  const old = PRIMARY.includes(item) ? inv.primary : GUN_LIST.includes(item) ? inv.secondary : null;
  if (!old || !(inv.sellable || []).includes(old)) return 0;
  const btn = document.querySelector(`#buyGrid button[data-item="${old}"]`);
  return btn ? priceOf(old, +btn.dataset.price) : 0;
}
function renderBuyMenu() {
  $('buyMoney').textContent = `$ ${inv.money}`;
  for (const b of document.querySelectorAll('#buyGrid button')) {
    const item = b.dataset.item;
    const price = priceOf(item, +b.dataset.price);
    const has = alreadyHas(item);
    const sell = has && (inv.sellable || []).includes(item);
    b.querySelector('.price').textContent = sell ? `↩ продать${price ? ` +$${price}` : ''}` : has ? 'есть' : price ? `$${price}` : 'бесплатно';
    b.classList.toggle('owned', has && !sell);
    b.classList.toggle('sell', sell);
    b.disabled = (has && !sell) || (!has && price > inv.money + swapRefund(item));
  }
}

// Меню выбора команды (клавиша M)
let teamMenuOpen = false;
const teamMenu = $('teamMenu');
function openTeamMenu() {
  teamMenuOpen = true;
  mouseDown = false;
  for (const k in keys) keys[k] = false;
  for (const b of teamMenu.querySelectorAll('button')) b.classList.toggle('current', b.dataset.team === me.team);
  teamMenu.classList.remove('hidden');
  document.exitPointerLock();
  updatePauseHint();
}
function closeTeamMenu() {
  teamMenuOpen = false;
  teamMenu.classList.add('hidden');
  lockMouse();
  updatePauseHint();
}
for (const b of teamMenu.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (b.dataset.team !== me.team) send({ type: 'team', team: b.dataset.team });
    closeTeamMenu();
  });
}

renderer.domElement.addEventListener('click', () => { if (inGame && !chatOpen) lockMouse(); });
$('resumeBtn').addEventListener('click', lockMouse);
$('pauseOptionsBtn').addEventListener('click', () => openOptions());
$('menuOptionsBtn').addEventListener('click', () => openOptions());
document.addEventListener('pointerlockerror', onLockFail);
document.addEventListener('pointerlockchange', () => {
  if (isLocked()) lockWorked = true;
  else { mouseDown = false; for (const k in keys) keys[k] = false; }
  updatePauseHint();
});
document.addEventListener('mousemove', e => {
  if (!mouseActive() || !me.alive || chatOpen) return;
  if (dragLook && !rightHeld) return;
  // в прицеле AWP мышь медленнее — пропорционально приближению
  const s = SENS * opt.sens * (scope ? (scope === 1 ? 0.45 : 0.18) * opt.adsSens / 0.6 : me.ads ? opt.adsSens : 1);
  me.yaw -= e.movementX * s;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * s * (opt.invertY ? -1 : 1)));
});
document.addEventListener('mousedown', e => {
  if (!mouseActive() || !inGame || chatOpen || teamMenuOpen || optionsOpen || buyOpen || cheatPanelOpen) return;
  if (!me.alive) { if (e.button === 0) pickSpectate(true); return; }
  if (e.button === 0) { mouseDown = true; triggerLatched = false; }
  if (e.button === 0) cancelInspect();
  if (e.button === 2) {
    if (dragLook) rightHeld = true;
    else if (bombInHands) { /* с бомбой в руках правая кнопка ничего не делает */ }
    else if (me.weapon === 'knife') knifeAttack('stab');
    else if (isNade(me.weapon)) throwNade(true);
    else if (me.weapon === 'awp') { scope = (scope + 1) % 3; playTone(1500, 0.03, 0.05); cancelInspect(); }
    else { me.ads = true; cancelInspect(); }
  }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { mouseDown = false; triggerLatched = false; }
  if (e.button === 2) { rightHeld = false; me.ads = false; }
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!inGame) return;
  if (e.ctrlKey) e.preventDefault();  // Ctrl+колесо иначе масштабирует страницу
  if (buyOpen) return;
  const order = ownedList();
  switchWeapon(order[(order.indexOf(me.weapon) + (e.deltaY < 0 ? order.length - 1 : 1)) % order.length]);
}, { passive: false });

// Полный экран (F). В нём браузер позволяет перехватить Ctrl+W и другие
// сочетания, поэтому присед с движением вперёд не закроет вкладку.
const LOCKED_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyN', 'KeyF',
  'KeyC', 'KeyM', 'KeyK', 'KeyH', 'Tab', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyB', 'ControlLeft', 'ControlRight', 'F11'];
async function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  try {
    await document.documentElement.requestFullscreen();
    await navigator.keyboard?.lock?.(LOCKED_KEYS);
  } catch {}
  lockMouse();
}

// Защита от случайного закрытия вкладки (например, Ctrl+W вне полного экрана)
addEventListener('beforeunload', e => { if (inGame) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; if (inGame) setUsing(false); });

document.addEventListener('keydown', e => {
  if (optionsOpen) { if (e.key === 'Escape') closeOptions(); return; }
  if (!inGame) return;
  if (chatOpen) {
    if (e.key === 'Enter') {
      const text = ui.chatInput.value.trim();
      if (text) send({ type: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
    return;
  }
  if (teamMenuOpen) {
    if (e.code === 'KeyM' || e.key === 'Escape') closeTeamMenu();
    return;
  }
  if (buyOpen) {
    if (e.code === 'KeyB' || e.key === 'Escape') closeBuy();
    return;
  }
  if (cheatPanelOpen) {  // открыта панель читов: F6 или Esc — закрыть, остальные клавиши не мешают
    if (e.code === 'F6' || e.key === 'Escape') { e.preventDefault(); toggleCheatPanel(false); }
    return;
  }
  if (e.code === 'KeyB' && !e.repeat) { openBuy(); return; }
  if (e.ctrlKey || e.code.startsWith('Control')) e.preventDefault();  // Ctrl — присед, не сочетания браузера
  if (e.code === 'F11') { e.preventDefault(); if (!e.repeat) toggleFullscreen(); return; }
  if (e.code === 'KeyF' && !e.repeat) { startInspect(); return; }
  if (e.code === 'KeyG' && !e.repeat) { if (bombInHands) throwBomb(); else dropWeapon(); return; }
  if (e.code === 'Digit5' && !e.repeat) { toggleBombInHands(); return; }
  if (e.code === 'F6' && !e.repeat && cheatsAllowed) { e.preventDefault(); toggleCheatPanel(); return; }
  if (e.code === 'KeyK' && !e.repeat) { leaveGame(); return; }
  if (e.code === 'KeyH' && !e.repeat) { switchHands(); return; }
  if (e.code === 'KeyM') { openTeamMenu(); return; }
  if (e.code === 'Tab') { e.preventDefault(); renderScoreboard(); ui.sb.classList.remove('hidden'); return; }
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); return; }  // preventDefault — чтобы «т» не попала в поле
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyE' && !e.repeat) {
    // E: рядом бомба (закладка/разминирование) — она важнее; иначе — взять ствол с земли
    const g = !bombActionHere() && gunToPick();
    if (g) pickUpGun(g);
    else setUsing(true);  // закладка / разминирование, пока держишь
  }
  if (e.code === 'Digit1') switchWeapon(inv.primary);
  if (e.code === 'Digit2') switchWeapon(inv.secondary);
  if (e.code === 'Digit3') switchWeapon('knife');
  if (e.code === 'Digit4') nextNade();
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') ui.sb.classList.add('hidden');
  if (e.code === 'KeyE' && inGame) setUsing(false);
});

function openChat() {
  chatOpen = true;
  for (const k in keys) keys[k] = false;
  setUsing(false);
  mouseDown = false;
  ui.chatInput.classList.remove('hidden');
  ui.chatInput.value = '';
  ui.chatInput.focus();
  ui.chatLog.querySelectorAll('.old').forEach(el => el.classList.remove('old'));
}
function closeChat() {
  chatOpen = false;
  ui.chatInput.blur();
  ui.chatInput.classList.add('hidden');
  lockMouse();
  updatePauseHint();
}

function renderScoreboard() {
  const rows = { ct: [], t: [] };
  const sorted = [...lastSnapshot.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const p of sorted) {
    const tr = document.createElement('tr');
    if (p.id === me.id) tr.className = 'me';
    else if (!p.alive) tr.className = 'dead';
    const name = (p.cheats ? '🛠 ' : '') + (p.id === bombCarrierForMe() ? `💣 ${p.name}` : p.name);
    for (const v of [name, p.kills, p.assists ?? 0, p.deaths, p.mvps ? `★${p.mvps}` : '']) {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    }
    rows[p.team].push(tr);
  }
  ui.sbCT.replaceChildren(...rows.ct);
  ui.sbT.replaceChildren(...rows.t);
}

// ================== ОКНО НАСТРОЕК ==================
let optionsOpen = false;
const OPT_FORMAT = {
  volume: v => `${v}%`, shotVolume: v => `${v}%`, fov: v => `${v}°`,
  sens: v => v.toFixed(2), adsSens: v => `×${v.toFixed(2)}`, xhSize: v => `${v}`,
};

// Применить все настройки к игре
function applyOptions() {
  if (audio) audio.master.gain.value = opt.volume / 100;
  applyGraphics();
  hands.scale.x = opt.leftHand ? -1 : 1;  // зеркально — оружие в левой руке
  $('fps').classList.toggle('hidden', !opt.showFps);
  const root = document.documentElement.style;
  root.setProperty('--xh-color', opt.xhColor);
  root.setProperty('--xh-len', `${opt.xhSize}px`);
  root.setProperty('--xh-gap', `${Math.max(3, Math.round(opt.xhSize * 0.5))}px`);
  try { localStorage.setItem('sa_options', JSON.stringify(opt)); } catch {}
}

// Показать текущие значения в элементах окна
function renderOptions() {
  for (const [key, fmt] of Object.entries(OPT_FORMAT)) {
    const input = $(`o_${key}`);
    input.value = opt[key];
    input.nextElementSibling.textContent = fmt(opt[key]);
  }
  for (const key of ['showFps', 'invertY', 'leftHand']) $(`o_${key}`).checked = opt[key];
  for (const key of ['quality', 'xhColor']) {
    for (const b of $(`o_${key}`).querySelectorAll('button')) b.classList.toggle('active', b.dataset.v === opt[key]);
  }
  $('qualityInfo').textContent = (QUALITY[opt.quality] || QUALITY.high).info;
}

function onOptionChange(key, value) {
  opt[key] = value;
  applyOptions();
  renderOptions();
}
for (const key of Object.keys(OPT_FORMAT)) {
  $(`o_${key}`).addEventListener('input', e => onOptionChange(key, parseFloat(e.target.value)));
}
for (const key of ['showFps', 'invertY', 'leftHand']) {
  $(`o_${key}`).addEventListener('change', e => onOptionChange(key, e.target.checked));
}

// H — перекинуть оружие в другую руку: убрать и достать уже с другой стороны
function switchHands() {
  opt.leftHand = !opt.leftHand;
  applyOptions();
  if (me.alive) drawWeapon();
}
for (const key of ['quality', 'xhColor']) {
  for (const b of $(`o_${key}`).querySelectorAll('button')) b.addEventListener('click', () => onOptionChange(key, b.dataset.v));
}

function openOptions() {
  optionsOpen = true;
  mouseDown = false;
  for (const k in keys) keys[k] = false;
  document.exitPointerLock();
  renderOptions();
  $('options').classList.remove('hidden');
  updatePauseHint();
}
function closeOptions() {
  optionsOpen = false;
  $('options').classList.add('hidden');
  updatePauseHint();  // в игре снова покажется пауза: «Продолжить» вернёт управление
}
$('optDoneBtn').addEventListener('click', closeOptions);
// Язык: кнопка на каждый язык из i18n.js, выбор перезагружает страницу
for (const [code, name] of Object.entries(I18N.langs)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.classList.toggle('active', code === I18N.lang);
  b.addEventListener('click', () => { if (code !== I18N.lang) I18N.setLang(code); });
  $('o_lang').append(b);
}
$('optResetBtn').addEventListener('click', () => {
  Object.assign(opt, OPT_DEFAULT);
  applyOptions();
  renderOptions();
});
$('options').addEventListener('mousedown', e => { if (e.target.id === 'options') closeOptions(); });  // клик мимо окна
applyOptions();

// ================== ГЛАВНОЕ МЕНЮ: ВКЛАДКИ И ИНВЕНТАРЬ ==================
// (собирается здесь — когда иконки оружия уже объявлены)
function invCard(tag, icon, name, note) {
  const el = document.createElement(tag);
  el.innerHTML = icon;
  const label = document.createElement('span');
  label.textContent = name;
  const small = document.createElement('small');
  small.textContent = note;
  el.append(label, small);
  return el;
}
// Оружие: выбираешь карточку — персонаж берёт его, а ниже — скины, которые на него есть
let invWeapon = 'rifle';
const GUN_CARDS = [['rifle', 'AKR', 'Винтовка'], ['m4', 'M4', 'Винтовка'], ['awp', 'AWP', 'Снайперская'], ['smg', 'MP5', 'Пистолет-пулемёт'],
  ['shotgun', 'Nova', 'Дробовик'], ['pistol', 'USP-S', 'Пистолет'], ['deagle', 'Deagle', 'Пистолет']];
for (const [w, name, note] of GUN_CARDS) {
  const b = invCard('button', ICONS[w], name, note);
  b.dataset.weapon = w;
  b.addEventListener('click', () => { invWeapon = w; menuHold(w); renderInventory(); });
  $('gunGrid').append(b);
}
// ножи: выбор — сразу в руках у персонажа; закрытые — с замком и сколько убийств осталось
function renderKnives() {
  const seg = $('knifeSeg');
  seg.textContent = '';
  for (const type of KNIFE_ORDER) {
    const open = knifeOpen(type);
    const need = KNIFE_UNLOCK[type];
    const note = !need ? 'Есть у всех' : open ? `Открыт · ${need} убийств` : `🔒 ${Math.min(myKills(), need)} / ${need} убийств`;
    const b = invCard('button', KNIFE_ICONS[type], type === 'skeleton' ? 'Скелет' : KNIVES[type], note);
    b.dataset.knife = type;
    b.classList.toggle('locked', !open);
    b.classList.toggle('active', type === settings.knife);
    b.addEventListener('click', () => {
      if (!open) { toast(`${KNIVES[type]} откроется за ${need} убийств — осталось ${need - myKills()}`, null, 3000); menuHold(type); return; }
      settings.knife = type;
      syncKnifeSkin();
      saveProfile();
      renderMenu();
      refreshMyWeapons();
      menuHold(type);
      renderInventory();
      renderShop();
    });
    seg.append(b);
  }
}
renderKnives();
for (const b of document.querySelectorAll('#agentSeg button')) {
  b.addEventListener('click', () => {
    settings.agent = b.dataset.team;
    renderMenu();
    showMenuAgent(settings.agent, menuTab === 'inventory' ? settings.knife : 'rifle');
    renderInventory();  // агенты другой команды
  });
}

// Вкладки: в инвентаре персонаж показывает выбранный нож, в остальных — держит автомат
let menuTab = 'play';
for (const b of document.querySelectorAll('.tabs button[data-tab]')) {
  b.addEventListener('click', () => {
    menuTab = b.dataset.tab;
    for (const t of document.querySelectorAll('.tabs button[data-tab]')) t.classList.toggle('active', t === b);
    for (const p of document.querySelectorAll('.sidePanel')) p.classList.toggle('hidden', p.id !== `tab-${menuTab}`);
    shopPreview = null;
    showMenuAgent(settings.agent, menuTab === 'inventory' ? settings.knife : 'rifle');  // и снять примерку агента
    if (menuTab === 'shop') renderShop();
    if (menuTab === 'inventory') renderInventory();
    if (menuTab === 'profile') { socialSend({ type: 'leaders' }); renderRankAndAch(); }  // свежая таблица лидеров
  });
}

// ================== МАГАЗИН СКИНОВ И КЕЙСЫ ==================
// Картинка узора для карточки — тот же холст, что идёт в текстуру
const swatchCache = new Map();
function swatchUrl(s) {
  if (!swatchCache.has(s.id)) swatchCache.set(s.id, paintTexture(s.a).image.toDataURL());
  return swatchCache.get(s.id);
}
function skinCard(s) {
  const card = document.createElement('div');
  card.className = 'skinCard';
  card.style.setProperty('--rar', RARITY[s.rarity].color);
  const sw = document.createElement('div');
  sw.className = 'swatch';
  sw.style.background = `url(${swatchUrl(s)}) center/cover`;
  sw.innerHTML = s.knife ? KNIFE_ICONS[s.knife] : isAgent(s) ? AGENT_ICON : ICONS[s.weapon];
  const name = document.createElement('b');
  name.textContent = s.name;
  const sub = document.createElement('small');
  sub.textContent = `${skinOwner(s)} · ${RARITY[s.rarity].name}`;
  if (s.knife && !knifeOpen(s.knife)) {  // нож ещё не открыт — скин можно иметь, но не надеть
    sub.textContent += ' · 🔒';
    card.classList.add('lockedKnife');
  }
  if (!isAgent(s)) {  // 🔍 — осмотреть в 3D
    const look = document.createElement('button');
    look.className = 'insBtn';
    look.title = 'Осмотреть в 3D';
    look.textContent = '🔍';
    look.addEventListener('click', e => { e.stopPropagation(); openInspect(s.knife || s.weapon, s.id); });
    sw.append(look);
  }
  card.append(sw, name, sub);
  return card;
}
// Персонаж в меню примеряет скин (нож — того типа, что выбран)
// агента — показываем целиком (персонаж его команды)
function previewSkin(s) {
  if (isAgent(s)) showMenuAgent(s.weapon.slice(6), 'rifle', s.id);
  else menuHold(s.knife || s.weapon, s.id);
}
function equipSkin(weapon, id) {
  if (weapon === 'knife') {
    // скин ножа запоминается за своим типом ножа; надеваешь — берёшь этот нож в руки
    const type = SKIN_BY_ID[id]?.knife || settings.knife;
    if (!knifeOpen(type)) { toast(`Сначала открой нож «${KNIVES[type]}» — ${KNIFE_UNLOCK[type]} убийств`, null, 3500); return; }
    if (id) wallet.knifeSkins[type] = id;
    else delete wallet.knifeSkins[type];
    settings.knife = type;
    syncKnifeSkin();
    saveProfile();
    renderMenu();
    renderKnives();
    refreshMyWeapons();
    return;
  }
  if (id) wallet.equipped[weapon] = id;
  else delete wallet.equipped[weapon];
  saveProfile();
  if (weapon.startsWith('agent')) {
    settings.agent = weapon.slice(6);  // надел агента — в меню стоит он
    renderMenu();
  } else refreshMyWeapons();
}
function buySkin(s) {
  const price = RARITY[s.rarity].price;
  if (wallet.gold < price || wallet.owned.includes(s.id)) return;
  wallet.gold -= price;
  wallet.owned.push(s.id);
  if (!s.knife || knifeOpen(s.knife)) equipSkin(s.weapon, s.id);  // купил — сразу надел (если нож уже открыт)
  playTone(1046, 0.12, 0.1, 'sine');
  renderShop();
}

let shopFilter = 'all', shopPreview = null;
for (const b of $('shopFilter').children) b.addEventListener('click', () => { shopFilter = b.dataset.w; renderShop(); });
function renderShop() {
  saveProfile();
  for (const b of $('shopFilter').children) b.classList.toggle('active', b.dataset.w === shopFilter);
  // кейс можно открыть и посмотреть всегда; без золота заблокирована только сама прокрутка
  for (const b of document.querySelectorAll('#caseGrid button')) {
    const free = wallet.freeCases[b.dataset.case] || 0;
    b.classList.toggle('poor', !free && wallet.gold < +b.dataset.price);
    // бесплатные кейсы за уровни — подпись над кнопкой
    let tag = b.parentElement.querySelector('.free');
    if (free && !tag) { tag = document.createElement('span'); tag.className = 'free'; b.before(tag); }
    if (tag) tag.textContent = free ? `🎁 Бесплатных: ${free}` : '';
  }
  const grid = $('skinGrid');
  grid.textContent = '';
  for (const s of SKINS) {
    if (shopFilter !== 'all' && s.weapon !== shopFilter && !(shopFilter === 'agent' && isAgent(s))) continue;
    const card = skinCard(s);
    card.classList.toggle('previewing', s.id === shopPreview);
    card.addEventListener('click', () => { shopPreview = s.id; previewSkin(s); renderShop(); });
    const btn = document.createElement('button');
    btn.className = 'buy';
    if (wallet.owned.includes(s.id) && s.knife && !knifeOpen(s.knife)) {
      btn.classList.add('owned');
      btn.textContent = `Есть · 🔒 ${KNIFE_UNLOCK[s.knife]} убийств`;
      btn.disabled = true;
    } else if (wallet.owned.includes(s.id)) {
      const on = s.knife ? wallet.knifeSkins[s.knife] === s.id : mySkins[s.weapon] === s.id;
      btn.classList.add('owned');
      btn.textContent = on ? '✓ Надет' : 'Есть · надеть';
      btn.disabled = on;
      btn.addEventListener('click', e => { e.stopPropagation(); equipSkin(s.weapon, s.id); previewSkin(s); renderShop(); });
    } else {
      const price = RARITY[s.rarity].price;
      btn.textContent = `Купить · 🪙 ${price}`;
      btn.disabled = wallet.gold < price;
      btn.addEventListener('click', e => { e.stopPropagation(); shopPreview = s.id; buySkin(s); previewSkin(s); });
    }
    card.append(btn);
    grid.append(card);
  }
}

// Инвентарь: «Стандарт» или один из своих скинов на выбранное оружие и на нож
function renderInventory() {
  for (const b of $('gunGrid').children) b.classList.toggle('selected', b.dataset.weapon === invWeapon);
  const agentSlot = `agent_${settings.agent}`;
  for (const [box, weapon, item] of [['gunSkinPick', invWeapon, invWeapon], ['knifeSkinPick', 'knife', settings.knife], ['agentSkinPick', agentSlot, null]]) {
    const el = $(box);
    el.textContent = '';
    // у ножа — только скины выбранного типа ножа
    const mine = SKINS.filter(s => s.weapon === weapon && (!s.knife || s.knife === settings.knife) && wallet.owned.includes(s.id));
    for (const s of [null, ...mine]) {
      const b = document.createElement('button');
      b.textContent = s ? s.name : 'Стандарт';
      if (s) b.style.setProperty('--rar', RARITY[s.rarity].color);
      b.classList.toggle('active', (mySkins[weapon] || null) === (s?.id || null));
      b.addEventListener('click', () => {
        equipSkin(weapon, s?.id);
        if (item) menuHold(item);
        else showMenuAgent(settings.agent, settings.knife);
        renderInventory();
      });
      el.append(b);
    }
    if (item) {  // оружие и нож можно осмотреть в 3D с надетым скином
      const look = document.createElement('button');
      look.className = 'insOpen';
      look.textContent = '🔍 Осмотреть в 3D';
      look.addEventListener('click', () => openInspect(item, mySkins[weapon] || null));
      el.append(look);
    }
    if (!mine.length) {
      const hint = document.createElement('span');
      hint.className = 'empty';
      hint.textContent = 'Скинов пока нет — загляни в магазин';
      el.append(hint);
    }
  }
}

// Кейсы: сначала выпадает редкость (по весам), потом случайный скин этой редкости
const CASES = [
  { id: 'weapon', name: 'Оружейный кейс', icon: '📦', price: 300, note: 'Скины на всё огнестрельное оружие',
    pool: SKINS.filter(s => s.weapon !== 'knife' && !isAgent(s)), weights: { common: 60, rare: 25, epic: 11, legendary: 4 } },
  { id: 'knife', name: 'Ножевой кейс', icon: '🔪', price: 900, note: 'Всё подряд и шанс 15% на редкий нож',
    pool: SKINS.filter(s => !isAgent(s)), weights: { common: 35, rare: 30, epic: 15, legendary: 5, knife: 15 } },
  { id: 'agent', name: 'Кейс агентов', icon: '🕵️', price: 500, note: 'Персонажи за спецназ и террористов',
    pool: SKINS.filter(isAgent), weights: { common: 45, rare: 28, epic: 16, legendary: 8, knife: 3 } },
];
function rollCase(c) {
  const rars = Object.keys(c.weights).filter(r => c.pool.some(s => s.rarity === r));
  let x = Math.random() * rars.reduce((sum, r) => sum + c.weights[r], 0);
  const rar = rars.find(r => (x -= c.weights[r]) < 0) || rars[0];
  const list = c.pool.filter(s => s.rarity === rar);
  return list[Math.floor(Math.random() * list.length)];
}
for (const c of CASES) {
  const card = document.createElement('div');
  card.className = 'caseCard';
  card.innerHTML = `<div class="caseIcon">${c.icon}</div><b></b><small></small><button data-price="${c.price}" data-case="${c.id}">Смотреть · 🪙 ${c.price}</button>`;
  card.querySelector('b').textContent = c.name;
  card.querySelector('small').textContent = c.note;
  card.querySelector('button').addEventListener('click', () => showCaseInfo(c));
  $('caseGrid').append(card);
}

// Шанс каждой редкости в кейсе (в процентах) — те же веса, что у rollCase
function caseOdds(c) {
  const rars = Object.keys(c.weights).filter(r => c.pool.some(s => s.rarity === r));
  const total = rars.reduce((sum, r) => sum + c.weights[r], 0);
  return rars.map(r => [r, c.weights[r] / total * 100]);
}
const pct = x => (x >= 10 ? x.toFixed(0) : x.toFixed(1)).replace('.', ',') + '%';

// Перед открытием — что лежит в кейсе и с каким шансом выпадает
let infoCase = null;
function showCaseInfo(c) {
  if (caseWon) return;
  infoCase = c;
  $('caseTitle').textContent = c.name;
  const odds = $('caseOdds'), items = $('caseItems');
  odds.textContent = '';
  items.textContent = '';
  for (const [r, p] of caseOdds(c)) {
    const tag = document.createElement('span');
    tag.style.setProperty('--rar', RARITY[r].color);
    tag.textContent = RARITY[r].name;
    const b = document.createElement('b');
    b.textContent = pct(p);
    tag.append(b);
    odds.append(tag);
    // скины этой редкости делят её шанс поровну
    const list = c.pool.filter(s => s.rarity === r);
    for (const s of list) {
      const card = skinCard(s);
      const ch = document.createElement('span');
      ch.className = 'chance';
      ch.textContent = pct(p / list.length);
      card.append(ch);
      if (wallet.owned.includes(s.id)) {
        const have = document.createElement('span');
        have.className = 'have';
        have.textContent = 'Есть';
        card.append(have);
      }
      // оружие — осмотреть в 3D, агента — примерить на персонаже
      card.addEventListener('click', () => (isAgent(s) ? previewSkin(s) : openInspect(s.knife || s.weapon, s.id)));
      items.append(card);
    }
  }
  const lack = c.price - wallet.gold, free = wallet.freeCases[c.id] || 0;
  $('caseSpin').textContent = free ? `Открыть бесплатно (${free})` : lack > 0 ? `Не хватает 🪙 ${lack}` : `Открыть · 🪙 ${c.price}`;
  $('caseSpin').disabled = !free && lack > 0;
  $('caseClose').classList.add('hidden');
  $('caseOpen').classList.add('info');
  $('caseOpen').classList.remove('hidden');
}
$('caseSpin').addEventListener('click', () => openCase(infoCase));
$('caseCancel').addEventListener('click', () => {
  $('caseOpen').classList.add('hidden');
  menuHold(menuTab === 'inventory' ? settings.knife : 'rifle');
});
$('caseOpen').addEventListener('mousedown', e => { if (e.target.id === 'caseOpen' && !caseWon) $('caseCancel').click(); });

// Лента-рулетка: 45 карточек едут влево и останавливаются выигрышной под жёлтой чертой
const REEL_STEP = 116, REEL_WIN = 38;
let caseWon = null;
function openCase(c) {
  const free = (wallet.freeCases[c.id] || 0) > 0;
  if ((!free && wallet.gold < c.price) || caseWon) return;
  const won = rollCase(c);
  if (free) wallet.freeCases[c.id]--;   // кейс за уровень — без золота
  else wallet.gold -= c.price;
  const dupe = wallet.owned.includes(won.id);
  const refund = dupe ? Math.round(RARITY[won.rarity].price * 0.3) : 0;
  if (dupe) wallet.gold += refund;   // повтор — часть цены возвращается золотом
  else wallet.owned.push(won.id);
  saveProfile();   // сохраняем сразу, чтобы закрытие вкладки во время рулетки ничего не меняло
  caseWon = won;

  $('caseTitle').textContent = c.name;
  $('caseResult').textContent = '';
  $('caseClose').classList.add('hidden');
  const strip = $('reelStrip');
  strip.textContent = '';
  for (let i = 0; i < 45; i++) strip.append(skinCard(i === REEL_WIN ? won : rollCase(c)));
  $('caseOpen').classList.remove('hidden', 'info');
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  const reelW = strip.parentElement.clientWidth;
  const end = 6 + REEL_WIN * REEL_STEP + 55 - reelW / 2 + (Math.random() - 0.5) * 90;
  void strip.offsetWidth;
  strip.style.transition = 'transform 5.5s cubic-bezier(.08,.75,.18,1)';
  strip.style.transform = `translateX(${-end}px)`;

  // щелчки, когда под чертой проезжает новая карточка
  let last = 0;
  const tick = () => {
    if (!caseWon) return;
    const x = -new DOMMatrix(getComputedStyle(strip).transform).m41 + reelW / 2 - 6;
    const idx = Math.floor(x / REEL_STEP);
    if (idx !== last) { last = idx; playTone(1800, 0.02, 0.05, 'square'); }
    if (!$('caseClose').classList.contains('hidden')) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  strip.addEventListener('transitionend', () => {
    const rar = RARITY[won.rarity];
    const res = $('caseResult');
    res.style.color = rar.color;
    res.textContent = `${skinOwner(won)} | ${won.name}`;
    const small = document.createElement('small');
    small.textContent = dupe ? `${rar.name} · уже был — вернули 🪙 ${refund}` : `${rar.name} · добавлен в инвентарь`;
    if (!dupe && won.knife && !knifeOpen(won.knife)) small.textContent += ` · 🔒 нож откроется за ${KNIFE_UNLOCK[won.knife]} убийств`;
    res.append(small);
    $('caseClose').classList.remove('hidden');
    playTone(won.rarity === 'knife' || won.rarity === 'legendary' ? 1568 : 1046, 0.35, 0.12, 'sine');
  }, { once: true });
}
$('caseClose').addEventListener('click', () => {
  $('caseOpen').classList.add('hidden');
  shopPreview = caseWon.id;
  previewSkin(caseWon);
  caseWon = null;
  renderShop();
});

// Ежедневная награда: раз в календарный день. Заходишь подряд — серия растёт:
// 1-й день 100, дальше +50 за каждый день подряд, максимум 400 (с 7-го дня)
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const dailyAmount = streak => Math.min(400, 100 + 50 * (streak - 1));
function dailyStreak() {  // какой по счёту день серии будет при получении сегодня
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return wallet.dailyDay === dayKey(yesterday) ? (wallet.streak || 0) + 1 : 1;
}
function renderDaily() {
  const ready = wallet.dailyDay !== dayKey();
  const btn = $('dailyBtn');
  btn.disabled = !ready;
  $('dailyCard').classList.toggle('ready', ready);
  document.querySelector('.tabs button[data-tab=shop]').classList.toggle('gift', ready);
  if (ready) {
    const s = dailyStreak();
    btn.textContent = `Забрать 🪙 ${dailyAmount(s)}`;
    $('dailyInfo').textContent = s > 1 ? `Серия: ${s}-й день подряд 🔥` : 'Заходи каждый день — награда растёт';
  } else {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const min = Math.ceil((midnight - new Date()) / 60000);
    btn.textContent = `Через ${Math.floor(min / 60)} ч ${min % 60} мин`;
    const next = dailyAmount((wallet.streak || 0) + 1);
    $('dailyInfo').textContent = `Серия: ${wallet.streak} д. · завтра будет 🪙 ${next}`;
  }
}
$('dailyBtn').addEventListener('click', () => {
  if (wallet.dailyDay === dayKey()) return;
  wallet.streak = dailyStreak();
  wallet.dailyDay = dayKey();
  wallet.gold += dailyAmount(wallet.streak);
  playTone(1046, 0.12, 0.1, 'sine');
  setTimeout(() => playTone(1568, 0.25, 0.1, 'sine'), 120);
  renderShop();
  renderDaily();
});
setInterval(renderDaily, 30000);  // таймер и появление награды после полуночи

// ================== УРОВНИ И ЗАДАНИЯ ==================
// Опыт считает сервер (в профиле); награды за уровни — золото, а каждый 5-й уровень ещё и бесплатный кейс
const levelReward = L => ({ gold: 100 + 25 * L, case: L % 10 === 0 ? 'knife' : L % 5 === 0 ? 'weapon' : null });
let levelData = null;
function onLevel(m) {
  levelData = m;
  // впервые видим уровень (или профиль новый) — выдаём награды за все уровни, набранные раньше
  if (wallet.rewardLevel == null) wallet.rewardLevel = 1;
  while (wallet.rewardLevel < m.level) {
    const L = ++wallet.rewardLevel, r = levelReward(L);
    wallet.gold += r.gold;
    if (r.case) wallet.freeCases[r.case] = (wallet.freeCases[r.case] || 0) + 1;
    const caseName = r.case && CASES.find(c => c.id === r.case).name;
    toast(`⭐ Уровень ${L}! Награда: 🪙 ${r.gold}${caseName ? ` + ${caseName}` : ''}`, null, 7000);
    if (inGame) addChat(`⭐ Новый уровень ${L}! 🪙 +${r.gold}${caseName ? ` и бесплатный кейс` : ''}`);
    playTone(1318, 0.25, 0.12, 'sine');
    setTimeout(() => playTone(1760, 0.3, 0.1, 'sine'), 180);
  }
  saveProfile();
  renderLevel();
  renderShop();
}
function renderLevel() {
  if (!levelData) return;
  const { level, xpHave, xpNeed } = levelData;
  $('levelChip').textContent = `⭐ ${level}`;
  $('profLevel').textContent = `Уровень ${level}`;
  $('profXp').textContent = `${xpHave} / ${xpNeed} XP`;
  $('xpFill').style.width = `${Math.min(100, xpHave / xpNeed * 100)}%`;
  const r = levelReward(level + 1);
  $('nextReward').textContent = `За уровень ${level + 1}: 🪙 ${r.gold}${r.case ? ` + ${CASES.find(c => c.id === r.case).name}` : ''}`;
}
// «+20 XP убийство» рядом с деньгами в игре
let xpToast = 0, xpTimer = 0;
function showXp(amount, reason) {
  xpToast += amount;
  const el = $('xpDelta');
  el.textContent = `+${xpToast} XP ${reason}`;
  el.classList.add('show');
  clearTimeout(xpTimer);
  xpTimer = setTimeout(() => { xpToast = 0; el.classList.remove('show'); }, 2200);
}

// Задания дня: каждый день — 3 случайных из списка; прогресс копится в игре, награду забираешь в профиле
const MISSIONS = [
  { id: 'kills',    icon: '🎯', text: 'Убей {n} врагов',            n: 12, gold: 150, ev: 'kill' },
  { id: 'head',     icon: '💀', text: '{n} убийств в голову',        n: 5,  gold: 200, ev: 'head' },
  { id: 'rounds',   icon: '🏆', text: 'Выиграй {n} раундов',         n: 5,  gold: 150, ev: 'round' },
  { id: 'mvp',      icon: '⭐', text: 'Стань MVP {n} раза',          n: 2,  gold: 200, ev: 'mvp' },
  { id: 'awp',      icon: '🔭', text: '{n} убийства с AWP',          n: 3,  gold: 250, ev: 'kill:awp' },
  { id: 'knife',    icon: '🔪', text: 'Убей врага ножом',            n: 1,  gold: 300, ev: 'kill:knife' },
  { id: 'smg',      icon: '💨', text: '{n} убийств из MP5',          n: 5,  gold: 200, ev: 'kill:smg' },
  { id: 'shotgun',  icon: '💥', text: '{n} убийства из дробовика',   n: 4,  gold: 200, ev: 'kill:shotgun' },
  { id: 'm4',       icon: '🔫', text: '{n} убийств из M4',           n: 6,  gold: 200, ev: 'kill:m4' },
  { id: 'jump',     icon: '🦘', text: 'Убийство в прыжке',           n: 1,  gold: 250, ev: 'jump' },
  { id: 'wallbang', icon: '🧱', text: '{n} убийства сквозь стену',   n: 2,  gold: 250, ev: 'wallbang' },
];
const MISSION_BY_ID = Object.fromEntries(MISSIONS.map(m => [m.id, m]));
const missionText = d => d.text.replace('{n}', d.n);
function ensureMissions() {
  const day = dayKey();
  if (wallet.missions?.day === day) return;
  // выбор зависит только от даты — у всех в один день одни и те же задания
  let seed = [...day].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const pool = MISSIONS.map(m => m.id);
  const list = [];
  while (list.length < 3) list.push({ id: pool.splice(Math.floor(rnd() * pool.length), 1)[0], p: 0, claimed: false });
  wallet.missions = { day, list };
  saveProfile();
}
// событие из игры: 'kill', 'kill:awp', 'head', 'round', 'mvp', 'jump', 'wallbang'
function missionEvent(...events) {
  ensureMissions();
  for (const m of wallet.missions.list) {
    const d = MISSION_BY_ID[m.id];
    if (!events.includes(d.ev) || m.p >= d.n) continue;
    m.p++;
    if (m.p === d.n) {
      toast(`✅ Задание выполнено: ${missionText(d)} — забери 🪙 ${d.gold} в профиле`, null, 6000);
      if (inGame) addChat(`✅ Задание выполнено: ${missionText(d)}`);
      playTone(1046, 0.15, 0.1, 'sine');
    }
  }
  saveProfile();
  renderMissions();
}
function renderMissions() {
  ensureMissions();
  const box = $('missionList');
  box.textContent = '';
  for (const m of wallet.missions.list) {
    const d = MISSION_BY_ID[m.id];
    const row = document.createElement('div');
    row.className = 'mission' + (m.p >= d.n ? ' done' : '');
    row.innerHTML = '<span class="mi"></span><div class="mt"><b></b><small></small><div class="bar"><div></div></div></div><button></button>';
    row.querySelector('.mi').textContent = d.icon;
    row.querySelector('b').textContent = missionText(d);
    row.querySelector('small').textContent = `${Math.min(m.p, d.n)} / ${d.n}`;
    row.querySelector('.bar div').style.width = `${Math.min(100, m.p / d.n * 100)}%`;
    const btn = row.querySelector('button');
    btn.textContent = m.claimed ? '✓ Получено' : `🪙 ${d.gold}`;
    btn.disabled = m.claimed || m.p < d.n;
    btn.addEventListener('click', () => {
      if (m.claimed || m.p < d.n) return;
      m.claimed = true;
      wallet.gold += d.gold;
      saveProfile();
      playTone(1046, 0.12, 0.1, 'sine');
      renderMissions();
      renderShop();
    });
    box.append(row);
  }
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const h = Math.ceil((midnight - new Date()) / 3600000);
  $('missionsReset').textContent = `· новые через ${h} ч`;
}
renderMissions();
setInterval(renderMissions, 60000);

// ================== ОСМОТР ОРУЖИЯ В 3D ==================
// Своё маленькое окно со своей сценой: модель по центру, крутится мышью, колёсико — ближе/дальше
let ins = null;
function initInspect() {
  const canvas = $('insCanvas');
  const renderer3 = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer3.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene3 = new THREE.Scene();
  scene3.add(new THREE.HemisphereLight(0xdde6ff, 0x30281c, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 3, 4);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.4);
  rim.position.set(-3, 1, -3);
  scene3.add(key, rim);
  const camera3 = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  const pivot = new THREE.Group();
  scene3.add(pivot);
  ins = { renderer: renderer3, scene: scene3, camera: camera3, pivot, yaw: 0.5, pitch: 0.2, dist: 2.3, drag: null, touched: 0, open: false };
  const reset = () => { ins.yaw = 0.5; ins.pitch = 0.2; ins.dist = 2.3; ins.touched = 0; };
  ins.reset = reset;
  canvas.addEventListener('pointerdown', e => {
    ins.drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!ins.drag) return;
    ins.yaw += (e.clientX - ins.drag.x) * 0.01;
    ins.pitch = Math.max(-1.4, Math.min(1.4, ins.pitch + (e.clientY - ins.drag.y) * 0.01));
    ins.drag = { x: e.clientX, y: e.clientY };
    ins.touched = performance.now();
  });
  const up = () => { ins.drag = null; canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    ins.dist = Math.max(0.8, Math.min(4, ins.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });
  canvas.addEventListener('dblclick', reset);
}

// item — 'rifle' / 'awp' / 'pistol' / 'deagle' или тип ножа; skinId — скин или null (стандарт)
function openInspect(item, skinId = null) {
  if (!ins) initInspect();
  const knife = !!KNIVES[item];
  const skin = skinId && SKIN_BY_ID[skinId];
  // модель: пушки смотрят стволом в -z, ножи лежат в плоскости xy — разворачиваем боком к камере
  ins.pivot.clear();
  const inner = new THREE.Group();
  if (knife) buildKnife(item, inner);
  else GUN_BUILDERS[item](inner);
  applySkin(inner, item, skinId);
  if (!knife) inner.rotation.y = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(inner);
  const bbox = new THREE.Box3().setFromObject(holder);
  const size = bbox.getSize(new THREE.Vector3());
  const s = 1.8 / Math.max(size.x, size.y, size.z);   // любой предмет — примерно одного размера в окне
  holder.scale.setScalar(s);
  holder.position.copy(bbox.getCenter(new THREE.Vector3())).multiplyScalar(-s);
  ins.pivot.add(holder);

  // заголовок и цвет редкости
  const name = knife ? KNIVES[item] : SKIN_WEAPON_NAME[item];
  $('insName').textContent = `${name} | ${skin ? skin.name : 'Стандарт'}`;
  $('insSub').textContent = skin ? RARITY[skin.rarity].name + (wallet.owned.includes(skin.id) ? ' · есть у тебя' : '') : 'Без скина';
  $('inspect3d').style.setProperty('--rar', skin ? RARITY[skin.rarity].color : '#3a4a66');
  // все скины этого оружия — переключать прямо здесь
  const chips = $('insSkins');
  chips.textContent = '';
  for (const s2 of [null, ...SKINS.filter(x => knife ? x.knife === item : x.weapon === item)]) {
    const b = document.createElement('button');
    b.textContent = (s2 ? s2.name : 'Стандарт') + (s2 && wallet.owned.includes(s2.id) ? ' ✓' : '');
    if (s2) b.style.setProperty('--rar', RARITY[s2.rarity].color);
    b.classList.toggle('active', (s2?.id || null) === (skinId || null));
    b.addEventListener('click', () => openInspect(item, s2?.id || null));
    chips.append(b);
  }
  $('inspect3d').classList.remove('hidden');
  if (!ins.open) {
    ins.open = true;
    ins.reset();
    requestAnimationFrame(inspectFrame);
  }
}
function inspectFrame() {
  if (!ins.open) return;
  requestAnimationFrame(inspectFrame);
  renderInspect();
}
function renderInspect() {
  const canvas = ins.renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ins.renderer.getPixelRatio())) {
    ins.renderer.setSize(w, h, false);
    ins.camera.aspect = w / h;
    ins.camera.updateProjectionMatrix();
  }
  // пока не трогают — медленно вращается сам
  if (!ins.drag && performance.now() - ins.touched > 2500) ins.yaw += 0.006;
  ins.pivot.rotation.set(ins.pitch, ins.yaw, 0, 'YXZ');
  ins.camera.position.set(0, 0, ins.dist);
  ins.camera.lookAt(0, 0, 0);
  ins.renderer.render(ins.scene, ins.camera);
}
function closeInspect() {
  if (!ins?.open) return;
  ins.open = false;
  $('inspect3d').classList.add('hidden');
}
$('insClose').addEventListener('click', closeInspect);
$('inspect3d').addEventListener('mousedown', e => { if (e.target.id === 'inspect3d') closeInspect(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInspect(); });

saveProfile(false);
refreshMyWeapons();
renderShop();
renderDaily();

// ================== ВХОД ЧЕРЕЗ GOOGLE ==================
// Кнопку рисует сама Google (скрипт accounts.google.com/gsi/client). Google присылает подписанный «пропуск»,
// сервер проверяет его у Google и привязывает профиль к аккаунту — на другом устройстве профиль найдётся по нему
const GOOGLE_CLIENT_ID = document.querySelector('meta[name="google-client-id"]')?.content || '';
let googleReady = false;
function initGoogle() {
  if (!GOOGLE_CLIENT_ID || googleReady) return;
  const s = document.createElement('script');
  let lang = 'ru';
  try { lang = localStorage.getItem('sa_lang') || 'ru'; } catch {}
  s.src = `https://accounts.google.com/gsi/client?hl=${lang}`;   // язык кнопки — как в игре, а не как в системе
  s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: r => socialSend({ type: 'google', credential: r.credential }),
    });
    google.accounts.id.renderButton($('googleBtn'), {
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: lang,
    });
    googleReady = true;
  };
  document.head.append(s);
}
function renderGoogle() {
  // на адресе вида 192.168.x.x Google вход не разрешает — там кнопку не показываем
  const allowed = GOOGLE_CLIENT_ID && (location.protocol === 'https:' || location.hostname === 'localhost');
  $('googleBox').classList.toggle('hidden', !allowed || !profileMe);
  if (!allowed || !profileMe) return;
  $('googleOut').classList.toggle('hidden', !!profileMe.google);
  $('googleIn').classList.toggle('hidden', !profileMe.google);
  if (!profileMe.google) initGoogle();
}
$('googleLogout').addEventListener('click', () => {
  if (!confirm('Выйти из профиля на этом устройстве? Прогресс останется в Google-аккаунте — войдёшь снова, и он вернётся.')) return;
  try { for (const k of ['sa_token', 'sa_profile', 'sa_kills']) localStorage.removeItem(k); } catch {}
  location.reload();
});

// ================== ПРОФИЛЬ, ДРУЗЬЯ, ЛОББИ ==================
// Отдельное соединение /social живёт всё время, пока открыта страница (и в меню, и в игре)
function socialSend(msg) { if (socialWs && socialWs.readyState === 1) socialWs.send(JSON.stringify(msg)); }
function connectSocial() {
  socialWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/social`);
  socialWs.onopen = () => {
    $('socialOffline').textContent = '';
    socialSend({ type: 'hello', token: socialToken, name: ui.name.value.trim() });
  };
  socialWs.onmessage = e => handleSocial(JSON.parse(e.data));
  socialWs.onclose = () => {
    profileMe = null; lobbyState = null;
    $('socialOffline').textContent = 'Нет связи с сервером — переподключаемся…';
    renderLobby(); updatePlayButton();
    setTimeout(connectSocial, 3000);
  };
}

function handleSocial(m) {
  switch (m.type) {
    case 'token':  // новый профиль: ключ храним в браузере
      socialToken = m.token;
      try { localStorage.setItem('sa_token', m.token); } catch {}
      break;
    case 'wallet': {
      // кошелёк из профиля на сервере. После входа через Google (force) берём серверный целиком —
      // это прогресс аккаунта; иначе — тот, что новее. Если новее наш — отправляем его на сервер
      let force = false;
      try { force = localStorage.getItem('sa_wallet_force') === '1'; localStorage.removeItem('sa_wallet_force'); } catch {}
      const w = m.wallet;
      if (force || (w && (w.rev || 0) > (wallet.rev || 0))) {
        try {
          if (w) localStorage.setItem('sa_profile', JSON.stringify(w));
          else localStorage.removeItem('sa_profile');   // у аккаунта ещё нет кошелька — начинаем с нуля
        } catch {}
        if (!inGame) location.reload();   // проще всего перерисовать всё заново
        break;
      }
      if (!w || (wallet.rev || 0) > (w.rev || 0)) socialSend({ type: 'wallet', wallet });
      break;
    }
    case 'google':
      if (m.switch) {
        // этот Google-аккаунт уже привязан к другому профилю — переходим на него (вместе с его кошельком)
        try {
          localStorage.setItem('sa_token', m.switch);
          localStorage.setItem('sa_wallet_force', '1');
          localStorage.removeItem('sa_kills');
        } catch {}
        location.reload();
      } else if (m.ok) {
        toast('✓ Профиль привязан к Google — прогресс сохранится', null, 4000);
      } else {
        toast('Не получилось войти через Google — попробуй ещё раз', null, 4000);
      }
      break;
    case 'me': {
      const before = knownKills;
      profileMe = m;
      knownKills = m.stats.kills;
      try { localStorage.setItem('sa_kills', knownKills); } catch {}
      // перешагнул порог — новый нож открыт
      for (const type of KNIFE_ORDER) {
        if (before < KNIFE_UNLOCK[type] && knownKills >= KNIFE_UNLOCK[type]) {
          toast(`🔓 Открыт нож: ${KNIVES[type]}! Выбери его в инвентаре`, null, 7000);
          if (inGame) addChat(`🔓 Открыт нож: ${KNIVES[type]} (${KNIFE_UNLOCK[type]} убийств)`);
          playTone(1318, 0.3, 0.12, 'sine');
        }
      }
      if (!inGame) { validateKnife(); renderMenu(); refreshMyWeapons(); }
      onLevel(m);
      renderProfile();
      renderGoogle();
      renderRankAndAch();
      renderKnives();
      renderInventory();
      break;
    }
    case 'friends':
      friendsData = m;
      renderFriends();
      renderLobby();
      if (cardId) socialSend({ type: 'profileGet', id: cardId });  // обновить «в друзьях / заявка» в открытой карточке
      break;
    case 'profile':
      if (m.id === cardId) renderPlayerCard(m);
      break;
    case 'lobby': {
      const was = lobbyState;
      lobbyState = m.lobby;
      if (lobbyState && !was && !inGame) {  // попал в лобби — показываем его
        settings.mode = 'lobby';
        renderMenu();
        openMenuTab('play');
      }
      renderLobby();
      updatePlayButton();
      break;
    }
    case 'lobbyStart':
      if (!inGame) startGame(m.room);
      break;
    case 'invite':
      showInvite(m);
      break;
    case 'xp':
      showXp(m.amount, m.reason);
      break;
    case 'achievement':
      onAchievement(m);
      break;
    case 'leaders':
      leaderData = m;
      renderLeaders();
      break;
    case 'notice':
      toast(m.text);
      if (inGame) addChat(m.text);
      break;
  }
}

// Уведомление в углу экрана; buttons — [[текст, класс, действие], ...]
function toast(text, buttons = null, ms = 5000, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = text;
  if (buttons) {
    const row = document.createElement('div');
    row.className = 'btns';
    for (const [label, bcls, fn] of buttons) {
      const b = document.createElement('button');
      b.className = bcls;
      b.textContent = label;
      b.addEventListener('click', () => { el.remove(); fn?.(); });
      row.append(b);
    }
    el.append(row);
  }
  $('toasts').append(el);
  setTimeout(() => el.remove(), ms);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
function showInvite(m) {
  const who = `${m.from.name}#${m.from.tag}`;
  if (inGame) addChat(`✉ ${who} зовёт тебя в лобби 1 на 1 (код ${m.code}) — выйди в меню: K K`);
  toast(`✉ ${who} зовёт тебя в лобби 1 на 1`, [
    ['Принять', 'yes', () => { if (!inGame) socialSend({ type: 'lobbyJoin', code: m.code }); }],
    ['Нет', 'no'],
  ], 30000, 'invite');
  playTone(988, 0.12, 0.1, 'sine');
}

function openMenuTab(tab) {
  document.querySelector(`.tabs button[data-tab="${tab}"]`)?.click();
}
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} скопирован: ${text}`, null, 2500); }
  catch { toast(`${what}: ${text}`, null, 4000); }
}

// --- Профиль ---
const STATUS_TEXT = { menu: 'в сети', lobby: 'в лобби', game: 'в игре', offline: 'не в сети' };
function renderProfile() {
  if (!profileMe) return;
  const code = `${profileMe.name}#${profileMe.tag}`;
  $('profName').textContent = profileMe.name;
  $('profCode').textContent = code;
  $('profAvatar').textContent = profileMe.name[0]?.toUpperCase() || '?';
  const s = profileMe.stats;
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  const winRate = s.matches ? Math.round(s.wins / s.matches * 100) + '%' : '—';
  $('statGrid').innerHTML = '';
  for (const [v, label] of [[s.kills, 'Убийств'], [s.deaths, 'Смертей'], [kd, 'У/С'], [s.matches, 'Матчей'], [s.wins, 'Побед'], [winRate, '% побед']]) {
    const d = document.createElement('div');
    d.innerHTML = '<b></b><small></small>';
    d.querySelector('b').textContent = v;
    d.querySelector('small').textContent = label;
    $('statGrid').append(d);
  }
}
$('profCopyBtn').addEventListener('click', () => profileMe && copyText(`${profileMe.name}#${profileMe.tag}`, 'Код'));

// --- Ранг 1 на 1 и достижения ---
const RANK_ICON = { 'Новичок': '🔰', 'Боец': '🥉', 'Ветеран': '🥈', 'Мастер': '🥇', 'Элита': '💎', 'Легенда': '👑' };
const ACH_ICON = { first_blood: '🩸', kills_100: '💯', kills_1000: '⚙️', head_50: '🎯', knife_10: '🔪', awp_25: '🦅', wall_10: '🧱', noscope_10: '👀',
  jump_5: '🤸', ace: '🂡', mvp_10: '⭐', plant_10: '💣', defuse_5: '✂️', win_10: '🏆', level_10: '🎖', friend_1: '🤝',
  duel_1: '⚔️', duel_legend: '👑' };
function renderRankAndAch() {
  if (!profileMe) return;
  const s = profileMe.stats;
  $('rankIcon').textContent = RANK_ICON[profileMe.rank] || '🎖';
  $('profRank').textContent = `Ранг 1 на 1: ${profileMe.rank}`;
  $('profElo').textContent = `Рейтинг ${s.elo ?? 1000} · матчей 1 на 1: ${s.duels || 0}, побед: ${s.duel_wins || 0}`;
  const box = $('achGrid');
  box.textContent = '';
  const list = profileMe.achList || [];
  for (const a of list) {
    const done = profileMe.ach.includes(a.id);
    const have = a.key === 'level' ? profileMe.level : a.key === 'friends' ? friendsData.friends.length
      : a.key === 'elo' ? (s.elo ?? 1000) : (s[a.key] || 0);
    const el = document.createElement('div');
    el.className = 'ach' + (done ? ' done' : '');
    el.title = done ? `Получено · награда 🪙 ${a.gold}` : `Награда: 🪙 ${a.gold}`;
    el.innerHTML = '<div class="ai"></div><b></b><small></small><div class="bar"><div></div></div>';
    el.querySelector('.ai').textContent = done ? ACH_ICON[a.id] || '🏆' : '🔒';
    el.querySelector('b').textContent = a.name;
    el.querySelector('small').textContent = done ? a.desc : `${a.desc} · ${Math.min(have, a.need)}/${a.need}`;
    el.querySelector('.bar div').style.width = `${done ? 100 : Math.min(100, have / a.need * 100)}%`;
    box.append(el);
  }
  $('achCount').textContent = `· ${profileMe.ach.length} из ${list.length}`;
}
// новое достижение — уведомление и награда золотом
let matchAch = [];
function onAchievement(m) {
  wallet.gold += m.gold;
  saveProfile();
  renderShop();
  matchAch.push(m);
  toast(`🏆 Достижение «${m.name}»: ${m.desc} · 🪙 +${m.gold}`, null, 7000);
  if (inGame) addChat(`🏆 Достижение: ${m.name} (🪙 +${m.gold})`);
  playTone(1046, 0.15, 0.1, 'sine');
  setTimeout(() => playTone(1568, 0.25, 0.1, 'sine'), 160);
}

// --- Таблица лидеров ---
let leaderTab = 'duel', leaderData = null;
for (const b of $('leaderSeg').children) b.addEventListener('click', () => { leaderTab = b.dataset.l; renderLeaders(); });
function renderLeaders() {
  for (const b of $('leaderSeg').children) b.classList.toggle('active', b.dataset.l === leaderTab);
  const box = $('leaderList');
  box.textContent = '';
  const rows = leaderData?.[leaderTab] || [];
  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'leaderRow' + (profileMe && r.id === profileMe.id ? ' me' : '');
    el.innerHTML = '<span class="pos"></span><span class="nm"></span><span class="val"></span>';
    el.querySelector('.pos').textContent = ['🥇', '🥈', '🥉'][i] || i + 1;
    el.querySelector('.nm').textContent = `${r.name}#${r.tag}`;
    el.querySelector('.val').textContent = leaderTab === 'duel' ? `${RANK_ICON[r.rank] || ''} ${r.elo}` : `⭐ ${r.level}`;
    el.addEventListener('click', () => openPlayerCard(r.id));
    box.append(el);
  });
  if (!rows.length) {
    const note = document.createElement('div');
    note.className = 'emptyNote';
    note.textContent = leaderTab === 'duel' ? 'Пока никто не сыграл 1 на 1 — сыграй первым!' : 'Пока пусто';
    box.append(note);
  }
}
// ник из поля сверху — это и имя профиля
ui.name.addEventListener('change', () => {
  const name = ui.name.value.trim();
  if (!name) return;
  try { localStorage.setItem('sa_name', name); } catch {}
  socialSend({ type: 'setName', name });
});

// --- Друзья ---
function friendRow(f, buttons, cls = '') {
  const row = document.createElement('div');
  row.className = 'friendRow ' + cls;
  const dot = document.createElement('span');
  dot.className = 'dot ' + f.status;
  const who = document.createElement('div');
  who.className = 'who';
  const b = document.createElement('b');
  b.textContent = f.name;
  const tag = document.createElement('i');
  tag.textContent = `#${f.tag}`;
  b.append(tag);
  const small = document.createElement('small');
  small.textContent = cls === 'request' ? 'хочет в друзья' : cls === 'sent' ? 'заявка отправлена'
    : `${STATUS_TEXT[f.status]} · ⭐ ${f.level ?? 1} · ${f.stats.kills} убийств`;
  who.append(b, small);
  who.addEventListener('click', () => openPlayerCard(f.id));
  row.append(dot, who);
  for (const [label, bcls, fn] of buttons) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = bcls;
    btn.addEventListener('click', fn);
    row.append(btn);
  }
  return row;
}
function renderFriends() {
  const { friends, incoming, outgoing } = friendsData;
  const req = $('requestsBox');
  req.textContent = '';
  if (incoming.length || outgoing.length) {
    const label = document.createElement('div');
    label.className = 'optLabel';
    label.textContent = 'Заявки';
    req.append(label);
  }
  for (const f of incoming) req.append(friendRow(f, [
    ['Принять', 'ok', () => socialSend({ type: 'friendAccept', id: f.id })],
    ['✕', '', () => socialSend({ type: 'friendRemove', id: f.id })],
  ], 'request'));
  for (const f of outgoing) req.append(friendRow(f, [['Отменить', '', () => socialSend({ type: 'friendRemove', id: f.id })]], 'sent'));

  // сначала те, кто в сети
  const order = { menu: 0, lobby: 1, game: 2, offline: 3 };
  const list = $('friendList');
  list.textContent = '';
  $('friendsCount').textContent = friends.length ? `· в сети ${friends.filter(f => f.status !== 'offline').length} из ${friends.length}` : '';
  for (const f of [...friends].sort((a, b) => order[a.status] - order[b.status])) {
    const btns = [];
    if (f.status === 'menu' || f.status === 'lobby') btns.push(['Позвать 1×1', 'ok', () => socialSend({ type: 'lobbyInvite', id: f.id })]);
    btns.push(['✕', '', () => { if (confirm(I18N.tr(`Удалить ${f.name} из друзей?`))) socialSend({ type: 'friendRemove', id: f.id }); }]);
    list.append(friendRow(f, btns));
  }
  if (!friends.length) {
    const note = document.createElement('div');
    note.className = 'emptyNote';
    note.textContent = 'Пока никого. Отправь другу свой код — пусть добавит тебя, или впиши его код выше.';
    list.append(note);
  }
  // точка на вкладке, если есть новые заявки
  document.querySelector('.tabs button[data-tab=profile]').classList.toggle('gift', incoming.length > 0);
}
// --- Карточка чужого профиля ---
let cardId = null;
function openPlayerCard(id) {
  if (!id) return;
  cardId = id;
  $('pcName').textContent = 'Загрузка…';
  $('pcStatus').textContent = '';
  $('pcAvatar').textContent = '?';
  $('pcStats').textContent = '';
  $('pcAction').classList.add('hidden');
  $('playerCard').classList.remove('hidden');
  socialSend({ type: 'profileGet', id });
}
function closePlayerCard() {
  cardId = null;
  $('playerCard').classList.add('hidden');
}
function renderPlayerCard(p) {
  $('pcName').textContent = `${p.name}#${p.tag}`;
  $('pcStatus').textContent = `⭐ Уровень ${p.level ?? 1} · ${STATUS_TEXT[p.status]}`;
  $('pcAvatar').textContent = p.name[0]?.toUpperCase() || '?';
  const s = p.stats;
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  const box = $('pcStats');
  box.textContent = '';
  for (const [v, label] of [[s.kills, 'Убийств'], [s.deaths, 'Смертей'], [kd, 'У/С'], [s.matches, 'Матчей'], [s.wins, 'Побед'],
    [s.matches ? Math.round(s.wins / s.matches * 100) + '%' : '—', '% побед']]) {
    const d = document.createElement('div');
    d.innerHTML = '<b></b><small></small>';
    d.querySelector('b').textContent = v;
    d.querySelector('small').textContent = label;
    box.append(d);
  }
  const btn = $('pcAction');
  btn.classList.remove('hidden');
  const [text, enabled] = {
    none: ['＋ Добавить в друзья', true], incoming: ['Принять заявку', true],
    outgoing: ['Заявка отправлена', false], friend: ['✓ В друзьях', false], self: ['Это ты', false],
  }[p.relation];
  btn.textContent = text;
  btn.disabled = !enabled;
  btn.onclick = () => socialSend(p.relation === 'incoming' ? { type: 'friendAccept', id: p.id } : { type: 'friendAdd', code: String(p.tag) });
}
$('pcClose').addEventListener('click', closePlayerCard);
$('playerCard').addEventListener('mousedown', e => { if (e.target.id === 'playerCard') closePlayerCard(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && cardId) closePlayerCard(); });

function addFriend() {
  const code = $('friendCodeInput').value.trim();
  if (!code) return;
  socialSend({ type: 'friendAdd', code });
  $('friendCodeInput').value = '';
}
$('friendAddBtn').addEventListener('click', addFriend);
$('friendCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFriend(); });

// --- Лобби ---
// Правила: [ключ, название, [[значение, подпись], ...]]
const LOBBY_RULES = [
  ['mode', 'Режим', [['tdm', 'Бой'], ['bomb', '💣 Бомба']]],
  ['weapons', 'Оружие', [['buy', 'Закупка'], ['rifle', 'AKR'], ['m4', 'M4'], ['awp', 'AWP'], ['smg', 'MP5'], ['shotgun', 'Nova'], ['pistol', 'USP'], ['deagle', 'Deagle'], ['knife', 'Ножи']]],
  ['speed', 'Скорость бега', [[0.75, '×0.75'], [1, '×1'], [1.25, '×1.25'], [1.5, '×1.5'], [2, '×2']]],
  ['jump', 'Высота прыжка', [[0.75, '×0.75'], [1, '×1'], [1.5, '×1.5'], [2, '×2']]],
  ['gravity', 'Гравитация', [[0.5, '🌙 Луна'], [1, 'Обычная'], [1.5, 'Тяжёлая']]],
  ['hp', 'Здоровье', [[50, '50'], [100, '100'], [200, '200']]],
  ['rounds', 'Раундов до победы', [[3, '3'], [5, '5'], [8, '8']]],
  ['headshot', 'Только в голову', [[false, 'Нет'], [true, 'Да']]],
  ['money', 'Деньги', [['normal', 'Обычные'], ['unlimited', 'Без лимита']]],
  ['nades', 'Гранаты', [[true, 'Есть'], [false, 'Нет']]],
];
function lobbySlot(el, member, isHost, team) {
  el.textContent = '';
  el.classList.toggle('empty', !member);
  if (!member) { el.textContent = 'Ждём соперника…'; return; }
  const b = document.createElement('b');
  b.textContent = `${isHost ? '★ ' : ''}${member.name}`;
  const small = document.createElement('small');
  small.textContent = `#${member.tag} · ${team}`;
  el.append(b, small);
}
function renderLobby() {
  $('lobbyNone').classList.toggle('hidden', !!lobbyState);
  $('lobbyIn').classList.toggle('hidden', !lobbyState);
  if (!lobbyState) return;
  const L = lobbyState, s = L.settings;
  const host = profileMe && L.host === profileMe.id;
  $('lobbyCode').textContent = L.code;
  lobbySlot($('lobbySlot0'), L.members[0], L.members[0]?.id === L.host, 'Спецназ');
  lobbySlot($('lobbySlot1'), L.members[1], L.members[1]?.id === L.host, 'Террористы');
  // позвать друга — пока в лобби есть место
  $('lobbyInviteBox').classList.toggle('hidden', L.members.length >= 2);
  const inv = $('lobbyInviteList');
  inv.textContent = '';
  const online = friendsData.friends.filter(f => f.status === 'menu' || f.status === 'lobby');
  for (const f of online) {
    const b = document.createElement('button');
    b.textContent = `＋ ${f.name}`;
    b.addEventListener('click', () => socialSend({ type: 'lobbyInvite', id: f.id }));
    inv.append(b);
  }
  if (!online.length) inv.textContent = 'Нет друзей в сети. Скажи другу код лобби — он введёт его в «1 на 1».';

  $('lobbyHostNote').textContent = host ? '· меняешь ты' : '· меняет хозяин ★';
  const box = $('lobbyRules');
  box.textContent = '';
  const rows = [['map', 'Карта', MAP_LIST.map(m => [m.id, m.name])], ...LOBBY_RULES];
  for (const [key, label, options] of rows) {
    // деньги и гранаты имеют смысл только с закупкой
    if ((key === 'money' || key === 'nades') && s.weapons !== 'buy') continue;
    const row = document.createElement('div');
    row.className = 'ruleRow';
    const name = document.createElement('span');
    name.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const [v, text] of options) {
      const b = document.createElement('button');
      b.textContent = text;
      b.classList.toggle('active', s[key] === v);
      b.disabled = !host || L.inGame;
      b.addEventListener('click', () => socialSend({ type: 'lobbySettings', settings: { [key]: v } }));
      seg.append(b);
    }
    row.append(name, seg);
    box.append(row);
  }
  // фон меню — карта лобби
  if (s.map !== settings.map && MAP_LIST.some(m => m.id === s.map) && !inGame) {
    settings.map = s.map;
    loadMap(s.map);
    renderMenu();
  }
}
$('lobbyCreateBtn').addEventListener('click', () => socialSend({ type: 'lobbyCreate' }));
function joinLobbyByCode() {
  const code = $('lobbyCodeInput').value.trim().toUpperCase();
  if (code) socialSend({ type: 'lobbyJoin', code });
}
$('lobbyJoinBtn').addEventListener('click', joinLobbyByCode);
$('lobbyCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinLobbyByCode(); });
$('lobbyLeaveBtn').addEventListener('click', () => socialSend({ type: 'lobbyLeave' }));
$('lobbyCopyBtn').addEventListener('click', () => lobbyState && copyText(lobbyState.code, 'Код лобби'));

connectSocial();
renderInventory();

// Магазин: разделы и товары [id, название, цена]
const BUY_ITEMS = [
  ['Пистолеты', [['pistol', 'USP-S', 200], ['deagle', 'Desert Eagle', 700]]],
  ['ПП и дробовики', [['smg', 'MP5', 1500], ['shotgun', 'Nova', 1200]]],
  ['Винтовки', [['rifle', 'AKR', 2700], ['m4', 'M4', 3100], ['awp', 'AWP', 4750]]],
  ['Снаряжение', [['kevlar', 'Бронежилет', 650], ['helmet', 'Жилет + шлем', 1000]]],
  ['Гранаты', [['he', 'Осколочная', 300], ['flash', 'Флешка', 200], ['smoke', 'Дымовая', 300]]],
];
for (const [cat, items] of BUY_ITEMS) {
  const col = document.createElement('div');
  col.className = 'buyCat';
  const h = document.createElement('h4');
  h.textContent = cat;
  col.append(h);
  for (const [id, name, price] of items) {
    const b = document.createElement('button');
    b.dataset.item = id;
    b.dataset.price = price;
    b.innerHTML = ICONS[id] || '';
    const label = document.createElement('span');
    label.textContent = name;
    const pr = document.createElement('span');
    pr.className = 'price';
    b.append(label, pr);
    // купленное в этом раунде — повторный клик продаёт обратно (пока идёт закупка)
    b.addEventListener('click', () => send({ type: (inv.sellable || []).includes(id) ? 'sell' : 'buy', item: id }));
    b.addEventListener('contextmenu', e => { e.preventDefault(); send({ type: 'sell', item: id }); });
    col.append(b);
  }
  $('buyGrid').append(col);
}

// карты: карточка с цветами темы, по клику фон меню сразу переключается на эту карту
const MAP_COLORS = { desert: ['#9fc4e8', '#c7ae80'], warehouse: ['#8fa3b8', '#56626e'], village: ['#c9d6e3', '#eef3f7'], canyon: ['#f0a070', '#9a5a3c'] };
for (const m of MAP_LIST) {
  const b = document.createElement('button');
  b.dataset.map = m.id;
  const [sky, ground] = MAP_COLORS[m.id] || ['#445', '#776'];
  b.style.setProperty('--sky', sky);
  b.style.setProperty('--ground', ground);
  const name = document.createElement('b');
  name.textContent = m.name;
  const desc = document.createElement('small');
  desc.textContent = m.desc;
  b.append(name, desc);
  b.addEventListener('click', () => { settings.map = m.id; renderMenu(); loadMap(m.id); });
  $('mapGrid').append(b);
}

if (!KNIVES[settings.knife]) settings.knife = 'default';
validateKnife();
if (settings.agent !== 't') settings.agent = 'ct';
if (!MAP_LIST.some(m => m.id === settings.map)) settings.map = 'desert';
renderMenu();
await loadMap(settings.map);
showMenuAgent(settings.agent, 'rifle');

// Для отладки: http://localhost:8080/?debug — доступ к игроку и стрельбе из консоли
if (location.search.includes('debug')) window.dbg = { me, shoot, remotes, startInspect, viewModels, knifeAttack, switchWeapon, setKnifeModel, playAnim, KNIFE_POSE, tick,
  setScope: v => { scope = v; }, throwNade, inv, aimbot, showMatchSummary, renderer, scene, socialSend, wallet,
  // показать модель «оружие + руки» крупно в окне 3D-осмотра (для проверки кистей)
  // name, t — показать кадр анимации (например 'reload', 0.4)
  showVM(kind, name, t) {
    openInspect('rifle');
    const vm = (KNIVES[kind] ? buildKnifeViewModel(kind) : buildViewModel(kind));
    vm.visible = true;
    vm.position.set(0, 0, 0);
    ins.pivot.clear();
    ins.pivot.add(vm);
    vm.scale.setScalar(2.2);
    if (name) {
      restParts(vm.userData);
      const pose = (KNIVES[kind] ? KNIFE_ANIMS[kind] : GUN_ANIMS[kind])[name].fn(t, vm.userData) || {};
      vm.rotation.set(pose.rx || 0, pose.ry || 0, pose.rz || 0);
    }
    updateArms(vm);
  },
  // поставить камеру осмотра: dbg.view(поворот, наклон, расстояние) — модель перестаёт крутиться
  view(yaw, pitch, dist) { Object.assign(ins, { yaw, pitch, dist, touched: Infinity }); renderInspect(); },
  // нарисовать кадр анимации name в момент t (0..1) — для проверки без живой отрисовки
  snapAnim(weapon, name, t) {
    me.weapon = weapon;
    const def = playAnim(name);
    anim.start = performance.now() - t * def.time * 1000;
    for (let i = 0; i < 30; i++) tick();  // догнать плавные переходы позиции
    anim.start = performance.now() - t * def.time * 1000;
    tick();
  } };

// Отправка своего положения серверу 20 раз в секунду
setInterval(() => {
  if (inGame && me.alive) send({ type: 'state', pos: me.pos.toArray(), yaw: me.yaw, pitch: me.pitch, weapon: me.weapon, crouch: me.crouch > 0.5 });
}, 50);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================== ИГРОВОЙ ЦИКЛ ==================
const clock = new THREE.Clock();
let bobT = 0;

function frame() {
  requestAnimationFrame(frame);
  tick();
}
// Счётчик кадров в секунду (включается в настройках)
let fpsFrames = 0, fpsSince = performance.now();
function countFps(now) {
  fpsFrames++;
  if (now - fpsSince < 500) return;
  $('fps').textContent = `${Math.round(fpsFrames * 1000 / (now - fpsSince))} FPS`;
  fpsFrames = 0;
  fpsSince = now;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  if (opt.showFps) countFps(now);

  // главное меню: персонаж на фоне карты
  if (menuAgent) menuAgent.visible = !inGame;
  hands.visible = inGame;
  if (!inGame && menuAgent) {
    siteMarkers.visible = bombModel.visible = bombMarker.visible = false;
    updateMenuScene(now);
    updateEffects(dt);
    renderer.render(scene, camera);
    return;
  }

  if (inGame && me.alive) {
    updateMovement(dt);
    if (cheat.aim && mouseDown) aimbot();
    if (mouseDown) shoot(now);
    if (me.reloadEnd) {
      const w = WEAPONS[me.weapon];
      const p = 1 - (me.reloadEnd - now) / (w.reload * 1000);
      ui.reloadBar.firstElementChild.style.width = Math.min(100, p * 100) + '%';
      if (now >= me.reloadEnd) finishReload();
    }
  }
  me.heat = Math.max(0, me.heat - dt * (mouseDown ? 2 : 12));
  sprayRecover(now, dt);

  // камера: своими глазами или (после смерти в раунде) глазами живого союзника
  const spec = !me.alive && inGame && phase !== 'warmup' && now - myDeathAt > 1500 ? pickSpectate() : null;
  ui.death.classList.toggle('spectating', !!spec);
  if (spec) {
    camera.position.copy(spec.group.position).y += eyeAt(spec.crouch);
    camera.rotation.set(spec.data.pitch, spec.group.rotation.y, 0);
    const text = `Наблюдение: ${spec.data.name} · ЛКМ — следующий`;
    if (ui.respawnText.textContent !== text) ui.respawnText.textContent = text;
  } else {
    spectateId = null;
  }
  // сменился тот, за кем смотрим, или его оружие — достаём оружие с анимацией
  const shownKey = spec ? `${spec.data.id}:${spec.data.weapon}:${spec.data.knife}` : '';
  watching = spec;
  if (spec && shownKey !== lastShownKey) { anim = null; vmKick = 0; playAnim('draw'); }
  lastShownKey = shownKey;
  if (!spec) {
    camera.position.set(me.pos.x, me.pos.y + (me.alive ? eyeAt(me.crouch) : 0.4), me.pos.z);
    camera.rotation.set(me.pitch, me.yaw, 0);
  }
  if (shake > 0) {  // тряска от взрыва
    camera.position.x += (Math.random() - 0.5) * 0.25 * shake;
    camera.position.y += (Math.random() - 0.5) * 0.25 * shake;
    camera.rotation.z = (Math.random() - 0.5) * 0.05 * shake;
  }
  if (inGame) updateTimer();
  if (scope && (me.weapon !== 'awp' || !me.alive || watching)) scope = 0;
  // в прицеле — приближение; у AWP два уровня
  const targetFov = scope === 1 ? 40 : scope === 2 ? 15 : me.ads && me.alive ? opt.fov * 0.73 : opt.fov;
  ui.scope.classList.toggle('hidden', !scope);
  ui.crosshair.classList.toggle('hidden', !!scope || ((me.weapon === 'awp') && me.alive && !watching));
  if (scope) { camera.fov = targetFov; camera.updateProjectionMatrix(); }
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }

  // оружие в руках: покачивание при ходьбе и отдача
  const vm = shownVM();
  const showHands = inGame && (me.alive || !!spec) && !scope;  // в прицеле AWP рук не видно
  // остальные модели снимаем с камеры: даже скрытые, они пересчитывали бы сотни матриц (пальцы, детали) каждый кадр
  if (bombInHands && !iCarryBomb()) bombInHands = false;   // бомбу выбросили, подобрали другие или погиб
  const bombShown = bombInHands && !watching;
  for (const v of [...Object.values(viewModels), ...Object.values(specKnives)]) {
    v.visible = showHands && v === vm && !bombShown;
    if (v === vm) { if (v.parent !== hands) hands.add(v); } else if (v.parent === hands) hands.remove(v);
  }
  if (bombShown && showHands) { if (bombVM.parent !== hands) hands.add(bombVM); }
  else if (bombVM.parent) hands.remove(bombVM);
  const moving = me.alive ? Math.hypot(me.vel.x, me.vel.z) : 0;
  if (me.onGround) bobT += dt * moving * 1.6;
  const base = vm.userData.hip ?? (me.ads ? VM_ADS : VM_HIP);
  vmKick = Math.max(0, vmKick - dt * 12);
  const pose = animPose(now, vm) || {};
  // выстрел — указательный палец дожимает спуск
  if (vmKick > 0 && !vm.userData.knifeType) vm.userData.fingers?.index?.pose(-0.9 * vmKick);
  vm.userData.base ??= vm.position.clone();
  vm.userData.base.lerp(new THREE.Vector3(
    base.x + Math.sin(bobT) * 0.012 * (me.ads ? 0.2 : 1),
    base.y + Math.abs(Math.cos(bobT)) * 0.012 * (me.ads ? 0.2 : 1),
    base.z + vmKick * 0.06), Math.min(1, dt * 18));
  vm.rotation.set(
    vmKick * 0.08 + (pose.rx || 0),
    pose.ry || 0,
    pose.rz || 0);
  // поворачиваем вокруг рукояти, а не вокруг середины оружия; сдвиг анимации — сразу
  const grip = vm.userData.grip;
  vm.position.copy(vm.userData.base)
    .add(grip.clone().sub(grip.clone().applyEuler(vm.rotation)).multiplyScalar(vm.scale.x))
    .add(new THREE.Vector3(pose.px || 0, pose.py || 0, pose.pz || 0));
  vm.userData.leftArm.visible = anim?.name !== 'inspect';
  updateArms(vm);

  updateRemotes(dt);
  updateListener();
  updateEffects(dt);
  updateBomb(now, dt);
  updateNades(dt);
  updateGroundGuns(dt);
  updateSmokes(now);
  updateRadar(now, spec);

  // HUD
  if (inGame) {
    ui.hp.textContent = me.hp;
    ui.hp.style.color = me.hp <= 25 ? '#ff5555' : '#fff';
    ui.money.textContent = `$ ${inv.money}`;
    ui.armor.textContent = inv.armor === 2 ? '🛡⛑' : inv.armor === 1 ? '🛡' : '';
    ui.armor.title = inv.armor === 2 ? 'Бронежилет и шлем' : inv.armor === 1 ? 'Бронежилет' : '';
    const left = buyLeft();
    ui.buyHint.textContent = canBuy() ? `B — магазин${left < 900 ? ` · ${Math.ceil(left)} с` : ''}` : '';
    if (buyOpen && !canBuy()) closeBuy();  // время покупки вышло
    renderSlots();
    if (watching) {
      // при наблюдении — название оружия того, за кем смотрим (его патронов мы не знаем)
      const w = shownWeapon();
      ui.ammo.textContent = '—';
      ui.ammo.style.color = '#fff';
      ui.reserve.parentElement.style.visibility = 'hidden';
      ui.weapon.textContent = w === 'knife' ? KNIVES[shownVM().userData.knifeType].toUpperCase()
        : isNade(w) ? NADE_NAME[w] : WEAPONS[w].name;
    } else if (isNade(me.weapon)) {
      ui.ammo.textContent = inv.nades[me.weapon];
      ui.ammo.style.color = '#fff';
      ui.reserve.parentElement.style.visibility = 'hidden';
      ui.weapon.textContent = NADE_NAME[me.weapon].toUpperCase();
    } else if (me.weapon === 'knife') {
      ui.ammo.textContent = '—';
      ui.ammo.style.color = '#fff';
      ui.reserve.parentElement.style.visibility = 'hidden';
      ui.weapon.textContent = KNIVES[myKnife].toUpperCase();
    } else {
      const a = me.ammo[me.weapon];
      ui.ammo.textContent = a.mag;
      ui.ammo.style.color = a.mag <= WEAPONS[me.weapon].mag * 0.2 ? '#ff5555' : '#fff';
      ui.reserve.parentElement.style.visibility = 'visible';
      ui.reserve.textContent = a.reserve;
      ui.weapon.textContent = WEAPONS[me.weapon].name;
    }
  }

  renderer.render(scene, camera);
  drawESP();
  updateTouchUI();
}

// ================== «ЧИТЫ» ВЛАДЕЛЬЦА СЕРВЕРА ==================
// Только для профиля из CHEAT_PROFILES на сервере. F6 — панель инструментов (мышь освобождается),
// там включается каждая функция отдельно. Пока включена хоть одна — всем видна метка 🛠.
let cheatsAllowed = false, cheatsOn = false, cheatPanelOpen = false;
const CHEAT_OFF = { aim: false, esp: false, rapid: false, wallshot: false, fly: false, noclip: false, speed: 1 };
const cheat = { ...CHEAT_OFF };
const CHEAT_RATE = 50;  // мс между выстрелами со «скорострельностью» — 20 выстрелов в секунду из чего угодно
const espCanvas = document.createElement('canvas');
espCanvas.id = 'esp';
ui.hud.prepend(espCanvas);
const espCtx = espCanvas.getContext('2d');
// Переключатели панели: [ключ, название, подсказка]
const CHEAT_TOGGLES = [
  ['aim', '🎯 Аим', 'наводка на голову, без отдачи и разброса'],
  ['esp', '👁 ВХ', 'враги видны сквозь стены'],
  ['rapid', '⚡ Скорострельность', 'очередью из любого оружия, бесконечные патроны'],
  ['wallshot', '🧱 Стрельба сквозь стены', 'пули проходят через стены и ящики'],
  ['fly', '🕊 Полёт', 'пробел — вверх, Ctrl/C — вниз'],
  ['noclip', '👻 Сквозь стены', 'ходить через стены и ящики'],
];
function renderCheatPanel() {
  const box = $('cheatToggles');
  box.textContent = '';
  for (const [key, name, hint] of CHEAT_TOGGLES) {
    const b = document.createElement('button');
    b.className = 'cheatToggle' + (cheat[key] ? ' on' : '');
    b.innerHTML = '<b></b><small></small><span></span>';
    b.querySelector('b').textContent = name;
    b.querySelector('small').textContent = hint;
    b.querySelector('span').textContent = cheat[key] ? 'ВКЛ' : 'выкл';
    b.addEventListener('click', () => { cheat[key] = !cheat[key]; applyCheats(); });
    box.append(b);
  }
  $('cheatSpeed').value = cheat.speed;
  $('cheatSpeedVal').textContent = `×${cheat.speed}`;
}
// после любого переключения: метка на сервере (видна всем), плашка, панель
function applyCheats() {
  const on = Object.keys(CHEAT_OFF).some(k => (k === 'speed' ? cheat.speed !== 1 : cheat[k]));
  if (on !== cheatsOn) send({ type: 'cheats', on });
  cheatsOn = on;
  const active = CHEAT_TOGGLES.filter(([k]) => cheat[k]).map(([, n]) => n.split(' ').slice(1).join(' '));
  if (cheat.speed !== 1) active.push(`скорость ×${cheat.speed}`);
  $('cheatBadge').textContent = `🛠 ${active.join(' · ')} · F6 — панель`;
  $('cheatBadge').classList.toggle('hidden', !on);
  if (!cheat.esp) espCtx.clearRect(0, 0, espCanvas.width, espCanvas.height);
  renderCheatPanel();
}
function toggleCheatPanel(open = !cheatPanelOpen) {
  if (!cheatsAllowed) return;
  cheatPanelOpen = open;
  $('cheatPanel').classList.toggle('hidden', !open);
  if (open) {
    mouseDown = false;
    for (const k in keys) keys[k] = false;
    renderCheatPanel();
    document.exitPointerLock();
  } else lockMouse();
  updatePauseHint();
}
$('cheatSpeed').addEventListener('input', e => { cheat.speed = +e.target.value; applyCheats(); });
$('cheatAllOff').addEventListener('click', () => { Object.assign(cheat, CHEAT_OFF); applyCheats(); });
$('cheatClose').addEventListener('click', () => toggleCheatPanel(false));

// ================== УПРАВЛЕНИЕ НА ТЕЛЕФОНЕ ==================
// Левая часть экрана — джойстик (появляется там, куда поставил палец), правая — обзор пальцем,
// кнопки — стрельба, прицел, прыжок, присед, перезарядка, смена оружия, E, граната и верхний ряд.
async function goFullscreenLandscape() {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
}
if (touchMode) {
  document.body.classList.add('touch');
  // подсказка «поверни телефон» не должна запирать игру: если автоповорот выключен (или это iPhone,
  // где полный экран для сайтов недоступен) — можно повернуть кнопкой, играть вертикально или выйти
  $('rhRotate').addEventListener('click', goFullscreenLandscape);
  // iPhone не даёт сайтам ни полный экран, ни поворот — кнопка там бесполезна, вместо неё подсказка
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    $('rhRotate').remove();
    document.querySelector('#rotateHint .rhSub').textContent = 'iPhone: открой Пункт управления (свайп из правого верхнего угла) и выключи замок поворота 🔒';
  }
  $('rhPortrait').addEventListener('click', () => document.body.classList.add('portraitOk'));
  $('rhLeave').addEventListener('click', () => { if (inGame) { leaving = true; ws.close(); } });
  const press = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  const tap = code => { press(code, true); press(code, false); };
  const mouse = (button, down) => document.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button, bubbles: true }));
  // палец «прилипает» к элементу, даже если съехал с него; если браузер не даёт — не страшно
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };

  // обзор: двигаешь палец по правой части — поворачиваешься
  let lookId = null, lx = 0, ly = 0;
  const pad = $('lookPad');
  // preventDefault — чтобы касание не превращалось в «клик мышью» (иначе каждый жест стрелял бы)
  pad.addEventListener('pointerdown', e => { e.preventDefault(); lookId = e.pointerId; lx = e.clientX; ly = e.clientY; capture(pad, e); });
  pad.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId || !me.alive) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    const s = 0.0042 * opt.sens * (scope ? (scope === 1 ? 0.45 : 0.18) * opt.adsSens / 0.6 : me.ads ? opt.adsSens : 1);
    me.yaw -= dx * s;
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - dy * s * (opt.invertY ? -1 : 1)));
  });
  const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
  pad.addEventListener('pointerup', lookEnd);
  pad.addEventListener('pointercancel', lookEnd);

  // джойстик: центр — где коснулся, отклонение до 55 px = полная скорость
  let joyId = null, jx = 0, jy = 0;
  const zone = $('joyZone'), base = $('joyBase'), knob = $('joyKnob');
  const R = 55;
  const placeBase = (x, y) => { base.style.left = `${x}px`; base.style.top = `${y}px`; base.style.bottom = 'auto'; };
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    joyId = e.pointerId; jx = e.clientX; jy = e.clientY;
    capture(zone, e);
    placeBase(jx, jy);
    touchMove = { x: 0, y: 0 };
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - jx, dy = e.clientY - jy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touchMove = { x: dx / R, y: dy / R };
  });
  const joyEnd = e => {
    if (e.pointerId !== joyId) return;
    joyId = null; touchMove = null;
    knob.style.transform = '';
    applyTouchLayout();   // джойстик возвращается на своё место (своё — если игрок его передвинул)
  };
  zone.addEventListener('pointerup', joyEnd);
  zone.addEventListener('pointercancel', joyEnd);

  // кнопки: что делать при нажатии (down) и отпускании (up)
  const ACTIONS = {
    fire: { down: () => mouse(0, true), up: () => mouse(0, false) },
    aim: { down: () => mouse(2, true), up: () => mouse(2, false) },          // прицел / оптика AWP / укол ножом
    jump: { down: () => { keys.Space = true; }, up: () => { keys.Space = false; } },
    crouch: { down: (b) => { keys.KeyC = !keys.KeyC; b.classList.toggle('held', keys.KeyC); } },  // присед — переключателем
    reload: { down: () => tap('KeyR') },
    switch: { down: () => {   // следующее оружие по кругу: основное → пистолет → нож → гранаты
      const list = ownedList();
      switchWeapon(list[(list.indexOf(me.weapon) + 1) % list.length]);
    } },
    use: { down: () => press('KeyE', true), up: () => press('KeyE', false) },
    nade: { down: () => tap('Digit4') },
    c4: { down: () => tap('Digit5') },
    buy: { down: () => tap('KeyB') },
    score: { down: () => press('Tab', true), up: () => press('Tab', false) },
    drop: { down: () => tap('KeyG') },
    inspect: { down: () => tap('KeyF') },
    menu: { down: () => tap('KeyK') },   // дважды — выйти в меню
  };
  for (const b of document.querySelectorAll('#touchUI [data-t]')) {
    const act = ACTIONS[b.dataset.t];
    b.addEventListener('pointerdown', e => { e.preventDefault(); capture(b, e); act.down?.(b); });
    const up = e => { e.preventDefault(); act.up?.(b); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  addEventListener('contextmenu', e => e.preventDefault());
}

// ================== РАСПОЛОЖЕНИЕ КНОПОК (как в Standoff 2) ==================
// Для каждой кнопки игрок может задать место (x, y — центр в долях экрана), размер s и прозрачность o.
// Хранится в этом браузере: { fire: { x, y, s, o }, ... }. Нет записи — кнопка стоит как в style.css
const LAYOUT_KEY = 'sa_touch_layout';
const LAYOUT_NAMES = {
  fire: 'Огонь (справа)', fire2: 'Огонь (слева)', aim: 'Прицел', jump: 'Прыжок', crouch: 'Присед',
  reload: 'Перезарядка', switch: 'Смена оружия', use: 'Действие (E)', nade: 'Гранаты', c4: 'Бомба (C4)',
  ttop: 'Верхний ряд', joy: 'Джойстик',
};
let touchLayout = {};
try { touchLayout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch {}
let layoutEditing = false;

const layoutItems = () => [...document.querySelectorAll('#touchUI [data-li]')];
function applyTouchLayout(layout = touchLayout) {
  for (const el of layoutItems()) {
    const L = layout[el.dataset.li];
    const isJoy = el.dataset.li === 'joy';   // у джойстика центр задаёт отступ margin в CSS, а не translate
    Object.assign(el.style, { left: '', top: '', right: '', bottom: '', transform: '', opacity: '' });
    if (!L) continue;
    Object.assign(el.style, {
      left: `${L.x * 100}%`, top: `${L.y * 100}%`, right: 'auto', bottom: 'auto',
      transform: `${isJoy ? '' : 'translate(-50%, -50%) '}scale(${L.s ?? 1})`, opacity: String(L.o ?? 1),
    });
  }
}

function initLayoutEditor() {
  const ui = $('touchUI'), editor = $('layoutEditor'), stage = $('layoutStage'), panel = editor.querySelector('.lePanel');
  for (const b of ui.querySelectorAll('.tb')) b.dataset.li = b.classList[1];
  ui.querySelector('.ttop').dataset.li = 'ttop';
  $('joyBase').dataset.li = 'joy';

  let draft = {}, sel = null, drag = null;
  const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // запись для кнопки: если её ещё не двигали — берём текущее место на экране
  const entry = el => {
    const k = el.dataset.li;
    if (!draft[k]) {
      const r = stage.getBoundingClientRect(), c = center(el);
      draft[k] = { x: (c.x - r.left) / r.width, y: (c.y - r.top) / r.height, s: 1, o: 1 };
    }
    return draft[k];
  };
  function renderPanel() {
    for (const el of layoutItems()) el.classList.toggle('leSel', el === sel);
    const L = sel && entry(sel);
    $('leName').textContent = sel ? LAYOUT_NAMES[sel.dataset.li] || sel.dataset.li : 'Выбери кнопку';
    for (const [id, v] of [['leSize', L ? Math.round(L.s * 100) : 100], ['leAlpha', L ? Math.round(L.o * 100) : 100]]) {
      $(id).value = v;
      $(id).disabled = !sel;
      $(`${id}Out`).textContent = `${v}%`;
    }
    // выбранная кнопка в верхней части экрана — панель уходит вниз, чтобы её не закрывать
    panel.classList.toggle('low', !!L && L.y < 0.35);
  }

  function open() {
    layoutEditing = true;
    draft = JSON.parse(JSON.stringify(touchLayout));
    sel = null;
    stage.append(ui);              // те же кнопки, что в игре — переносим их в редактор
    ui.classList.remove('hidden');
    ui.classList.add('editing');
    editor.classList.remove('hidden');
    applyTouchLayout(draft);
    renderPanel();
  }
  function close(save) {
    if (save) {
      touchLayout = draft;
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(touchLayout)); } catch {}
    }
    layoutEditing = false;
    for (const el of layoutItems()) el.classList.remove('leSel');
    ui.classList.remove('editing');
    $('hud').insertBefore(ui, $('rotateHint'));   // кнопки — обратно в интерфейс игры
    editor.classList.add('hidden');
    applyTouchLayout();
    updateTouchUI();
  }

  // Перетаскивание. Ловим касание раньше самих кнопок (capture) — в редакторе они не должны стрелять и прыгать
  stage.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-li]');
    e.stopPropagation();
    e.preventDefault();
    if (!el) { sel = null; renderPanel(); return; }
    sel = el;
    const L = entry(el), r = stage.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - (r.left + L.x * r.width), dy: e.clientY - (r.top + L.y * r.height) };
    try { stage.setPointerCapture(e.pointerId); } catch {}
    renderPanel();
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = stage.getBoundingClientRect(), L = entry(sel);
    L.x = Math.min(0.98, Math.max(0.02, (e.clientX - drag.dx - r.left) / r.width));
    L.y = Math.min(0.98, Math.max(0.02, (e.clientY - drag.dy - r.top) / r.height));
    applyTouchLayout(draft);
    panel.classList.toggle('low', L.y < 0.35);
  }, true);
  const dragEnd = e => { if (drag && e.pointerId === drag.id) drag = null; };
  stage.addEventListener('pointerup', dragEnd, true);
  stage.addEventListener('pointercancel', dragEnd, true);

  $('leSize').addEventListener('input', e => {
    if (!sel) return;
    entry(sel).s = +e.target.value / 100;
    $('leSizeOut').textContent = `${e.target.value}%`;
    applyTouchLayout(draft);
  });
  $('leAlpha').addEventListener('input', e => {
    if (!sel) return;
    entry(sel).o = +e.target.value / 100;
    $('leAlphaOut').textContent = `${e.target.value}%`;
    applyTouchLayout(draft);
  });
  $('leReset').addEventListener('click', () => { draft = {}; sel = null; applyTouchLayout(draft); renderPanel(); });
  $('leCancel').addEventListener('click', () => close(false));
  $('leSave').addEventListener('click', () => close(true));
  $('o_layoutBtn').addEventListener('click', open);
}
if (touchMode) {
  initLayoutEditor();
  applyTouchLayout();
}
// экранные кнопки видны только в матче и когда не открыт магазин/меню
function updateTouchUI() {
  if (!touchMode || layoutEditing) return;   // в редакторе кнопки видны всегда
  $('touchUI').classList.toggle('hidden', !inGame || buyOpen || teamMenuOpen || optionsOpen || cheatPanelOpen);
}

const enemyHead = r => r.group.position.clone().setY(r.group.position.y + (r.data.crouch ? 1.2 : 1.66));
// ВХ: рамка, ник, здоровье и расстояние у каждого живого врага — сквозь стены
function drawESP() {
  if (!cheat.esp || !inGame) return;
  const w = innerWidth, h = innerHeight;
  if (espCanvas.width !== w || espCanvas.height !== h) { espCanvas.width = w; espCanvas.height = h; }
  espCtx.clearRect(0, 0, w, h);
  camera.updateMatrixWorld();
  for (const r of remotes.values()) {
    if (!r.data.alive || r.team === me.team) continue;
    const top = enemyHead(r).setY(r.group.position.y + (r.data.crouch ? 1.35 : 1.85)).project(camera);
    const foot = r.group.position.clone().project(camera);
    if (top.z > 1 || foot.z > 1) continue;  // позади камеры
    const x = (foot.x + 1) / 2 * w, y1 = (1 - top.y) / 2 * h, y2 = (1 - foot.y) / 2 * h;
    const bh = Math.max(8, y2 - y1), bw = bh * 0.45;
    espCtx.strokeStyle = '#ff3b3b'; espCtx.lineWidth = 2;
    espCtx.strokeRect(x - bw / 2, y1, bw, bh);
    // здоровье — полоска слева
    const hp = Math.max(0, Math.min(1, r.data.hp / (rules.hp || 100)));
    espCtx.fillStyle = 'rgba(0,0,0,.6)'; espCtx.fillRect(x - bw / 2 - 6, y1, 4, bh);
    espCtx.fillStyle = hp > 0.5 ? '#4cd964' : hp > 0.25 ? '#ffd84d' : '#ff3b3b';
    espCtx.fillRect(x - bw / 2 - 6, y1 + bh * (1 - hp), 4, bh * hp);
    const dist = Math.round(r.group.position.distanceTo(camera.position));
    espCtx.font = 'bold 12px Segoe UI, Arial'; espCtx.textAlign = 'center';
    espCtx.fillStyle = '#fff'; espCtx.strokeStyle = '#000'; espCtx.lineWidth = 3;
    const label = `${I18N.tr(r.data.name)} · ${dist} м`;
    espCtx.strokeText(label, x, y1 - 5); espCtx.fillText(label, x, y1 - 5);
  }
}
// Аим: пока зажата стрельба — прицел сам встаёт на голову ближайшего к перекрестию врага, которого видно
// (в любую сторону, даже за спиной); вместе с нулевым разбросом и без отдачи — каждая пуля в голову
function aimbot() {
  if (me.weapon === 'knife' || isNade(me.weapon)) return;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  let best = null, bestDot = -2;
  for (const r of remotes.values()) {
    if (!r.data.alive || r.team === me.team) continue;
    const head = enemyHead(r);
    const to = head.clone().sub(camera.position);
    const dist = to.length();
    const dot = to.normalize().dot(fwd);
    if (dot < bestDot) continue;
    raycaster.set(camera.position, to);
    raycaster.far = dist - 0.3;
    // за стеной — не наводимся (если только пули и так не летят сквозь стены)
    if (!cheat.wallshot && raycaster.intersectObjects(solidMeshes, false).length) continue;
    best = head; bestDot = dot;
  }
  if (!best) return;
  const d = best.sub(camera.position);
  me.yaw = Math.atan2(-d.x, -d.z);
  me.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  camera.rotation.set(me.pitch, me.yaw, 0);  // выстрел в этом же кадре — уже туда
  camera.updateMatrixWorld();
}

frame();
window.__saReady = true;  // для проверки в index.html: скрипт игры запустился
window.__log?.(`игра готова, качество ${opt.quality}, сглаживание ${renderer.getContextAttributes()?.antialias}`);
// что сейчас на экране — для отчётов с телефона
window.__state = () => {
  const c = renderer.domElement, vis = id => $(id) && !$(id).classList.contains('hidden') ? id : '';
  const shown = ['menu', 'hud', 'matchSummary', 'teamMenu', 'death'].map(vis).filter(Boolean).join(',');
  return `${inGame ? 'в матче' : 'в меню'}, видно: ${shown || '—'}, окно ${innerWidth}x${innerHeight}, ` +
    `холст ${c.width}x${c.height}, WebGL ${renderer.getContext().isContextLost() ? 'ПОТЕРЯН' : 'ок'}, ` +
    `вкладка ${document.visibilityState}`;
};
