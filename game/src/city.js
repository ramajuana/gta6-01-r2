// city.js — Solmar Bay itself: the street grid, buildings, landmarks, palms,
// streetlights, the shore, and the day/night cycle that lights all of it.
// Other modules ask this one where things are and what is solid.

import * as THREE from 'three';

export const WORLD = {
  PITCH: 48,          // distance between neighbouring street centrelines
  ROAD_W: 16,         // road width
  GRID: 4,            // streets run from -GRID..GRID on both axes (9 x 9)
  EXTENT: 200,        // street grid spans -EXTENT..EXTENT
  WATER_X: -214,      // west of this line is sand, then sea
  WORLD_EDGE: 252,
};

// Deterministic RNG so the city is the same city on every visit.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261117);

function makeFacadeTextures(baseColor, floors, cols) {
  const w = 128, h = 256;
  const day = document.createElement('canvas'); day.width = w; day.height = h;
  const d = day.getContext('2d');
  const grad = d.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, baseColor); grad.addColorStop(1, shade(baseColor, -18));
  d.fillStyle = grad; d.fillRect(0, 0, w, h);
  const night = document.createElement('canvas'); night.width = w; night.height = h;
  const n = night.getContext('2d');
  n.fillStyle = '#000'; n.fillRect(0, 0, w, h);
  const ww = w / cols, hh = h / floors;
  for (let y = 0; y < floors; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * ww + ww * 0.22, py = y * hh + hh * 0.22, pw = ww * 0.56, ph = hh * 0.52;
      d.fillStyle = 'rgba(24,42,66,0.85)'; d.fillRect(px, py, pw, ph);
      d.fillStyle = 'rgba(255,255,255,0.20)'; d.fillRect(px, py, pw, ph * 0.35);
      if (rng() < 0.42) { n.fillStyle = rng() < 0.8 ? '#ffca7a' : '#bfe3ff'; n.fillRect(px, py, pw, ph); }
    }
  }
  const map = new THREE.CanvasTexture(day); map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(night);
  return { map, emissiveMap };
}

function shade(hex, amt) {
  const c = new THREE.Color(hex); c.offsetHSL(0, 0, amt / 255); return '#' + c.getHexString();
}

function makeAsphaltTexture(dashesAlongU) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#33373d'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(${20 + rng() * 40},${20 + rng() * 40},${24 + rng() * 40},0.25)`;
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  g.fillStyle = '#e8c95a';
  if (dashesAlongU) { g.fillRect(0, 62, 40, 4); g.fillRect(88, 62, 40, 4); }
  else { g.fillRect(62, 0, 4, 40); g.fillRect(62, 88, 4, 40); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSignTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.fillStyle = fg; g.font = '900 56px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const LANDMARK_SPOTS = [
  { name: 'Neon Palms Hotel', kind: 'hotel', block: [-1, 0], color: '#ff7d9c', sign: '#2b0a1e' },
  { name: 'Bayview Tower', kind: 'tower', block: [0, -1], color: '#7fb6d9', sign: '#0a1c2b' },
  { name: 'Ortiz Garage', kind: 'garage', block: [-2, 1], color: '#e8a34c', sign: '#241203' },
  { name: 'Coral Casino', kind: 'casino', block: [1, 1], color: '#9a6ae0', sign: '#170b2e' },
  { name: 'Sunset Mall', kind: 'mall', block: [2, -2], color: '#f2e3c6', sign: '#33270e' },
  { name: 'Palm Court', kind: 'plaza', block: [0, 2], color: '#8fd0a0', sign: '#0d2413' },
  { name: 'Solmar Pier', kind: 'pier', at: [-232, 0], color: '#c98d5f', sign: '#2b1603' },
  { name: 'Harbor Lighthouse', kind: 'lighthouse', at: [-222, -196], color: '#f4f1e6', sign: '#3d0a0a' },
];

export function createCity(scene) {
  const group = new THREE.Group(); scene.add(group);
  const colliders = [];           // {x0,z0,x1,z1} solid footprints
  const landmarks = [];
  const nightEmissives = [];      // materials whose emissiveIntensity follows darkness
  const lampHeads = [];
  let timeHours = 17.66;          // the bay opens at golden hour, 17:40
  let darkness = 0;

  const addCollider = (cx, cz, w, d) =>
    colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });

  // ----- ground, shore and sea -----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshLambertMaterial({ color: 0x9aa0a3 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(-10, -0.05, 0);
  ground.receiveShadow = true; group.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 560),
    new THREE.MeshLambertMaterial({ color: 0xe6cf9e }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(-226, 0.0, 0);
  sand.receiveShadow = true; group.add(sand);

  const waterMat = new THREE.MeshPhongMaterial({ color: 0x1d6f8e, shininess: 120, transparent: true, opacity: 0.94 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 560), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set(-390, 0.12, 0);
  group.add(water);

  // ----- roads -----
  const roadLen = WORLD.EXTENT * 2 + WORLD.ROAD_W;
  const geoAlongX = new THREE.PlaneGeometry(roadLen, WORLD.ROAD_W); geoAlongX.rotateX(-Math.PI / 2);
  const geoAlongZ = new THREE.PlaneGeometry(WORLD.ROAD_W, roadLen); geoAlongZ.rotateX(-Math.PI / 2);
  for (let i = -WORLD.GRID; i <= WORLD.GRID; i++) {
    const at = i * WORLD.PITCH;
    const texX = makeAsphaltTexture(true); texX.repeat.set(roadLen / WORLD.ROAD_W, 1);
    const alongX = new THREE.Mesh(geoAlongX, new THREE.MeshLambertMaterial({ map: texX }));
    alongX.position.set(0, 0.02, at); alongX.receiveShadow = true; group.add(alongX);
    const texZ = makeAsphaltTexture(false); texZ.repeat.set(1, roadLen / WORLD.ROAD_W);
    const alongZ = new THREE.Mesh(geoAlongZ, new THREE.MeshLambertMaterial({ map: texZ }));
    alongZ.position.set(at, 0.02, 0); alongZ.receiveShadow = true; group.add(alongZ);
  }

  // ----- blocks: sidewalk pads, then buildings -----
  const facadePalette = ['#f2d5b8', '#f7b1a1', '#a8d5ba', '#a9cdea', '#f9e29c', '#d9b8e6', '#f4f1e6', '#ffb27d'];
  const facadeSets = facadePalette.map((c, i) =>
    makeFacadeTextures(c, 8 + (i % 4) * 3, 5 + (i % 3)));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6d6a66 });
  const padMat = new THREE.MeshLambertMaterial({ color: 0xb9bcbe });

  function buildBlock(bx, bz, cx, cz) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(32, 0.36, 32), padMat);
    pad.position.set(cx, 0.18, cz); pad.receiveShadow = true; group.add(pad);

    const spot = LANDMARK_SPOTS.find(s => s.block && s.block[0] === bx && s.block[1] === bz);
    if (spot) { buildLandmark(spot, cx, cz); return; }

    const pattern = rng();
    const plots = pattern < 0.34 ? [[0, 0, 20, 20]]
      : pattern < 0.67 ? [[-8, 0, 13, 22], [8, 0, 13, 22]]
      : [[-8, -8, 13, 13], [8, -8, 13, 13], [-8, 8, 13, 13], [8, 8, 13, 13]];
    for (const [ox, oz, w, d] of plots) {
      const h = 9 + rng() * rng() * 38;
      const set = facadeSets[(rng() * facadeSets.length) | 0];
      const side = new THREE.MeshLambertMaterial({
        map: set.map, emissive: 0xffc98a, emissiveMap: set.emissiveMap, emissiveIntensity: 0,
      });
      nightEmissives.push(side);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        [side, side, roofMat, roofMat, side, side]);
      b.position.set(cx + ox, 0.36 + h / 2, cz + oz);
      b.castShadow = true; b.receiveShadow = true; group.add(b);
      addCollider(cx + ox, cz + oz, w, d);
      if (rng() < 0.3) { // rooftop clutter: a water tank or plant box
        const t = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3),
          new THREE.MeshLambertMaterial({ color: 0x8a7f72 }));
        t.position.set(cx + ox + (rng() - 0.5) * 6, 0.36 + h + 1.1, cz + oz + (rng() - 0.5) * 6);
        t.castShadow = true; group.add(t);
      }
    }
  }

  function buildLandmark(spot, cx, cz) {
    const signTex = makeSignTexture(spot.name.toUpperCase(), spot.sign, '#ffd94d');
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const addSign = (w, h, x, y, z, ry) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMat);
      s.position.set(x, y, z); s.rotation.y = ry; group.add(s);
    };
    let height = 20;
    if (spot.kind === 'plaza') {
      // Palm Court: an open plaza — pavilion, fountain, palms, no tower.
      const pav = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 3.4, 8),
        new THREE.MeshLambertMaterial({ color: spot.color }));
      pav.position.set(cx, 2, cz); pav.castShadow = true; group.add(pav);
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.5, 20),
        new THREE.MeshPhongMaterial({ color: 0x2f9db8, shininess: 90 }));
      pool.position.set(cx, 0.6, cz); group.add(pool);
      addSign(13, 3.2, cx, 5.4, cz + 7.2, 0);
      landmarks.push({ name: spot.name, kind: spot.kind, x: cx, z: cz, radius: 15 });
      return;
    }
    if (spot.kind === 'tower') height = 74;
    else if (spot.kind === 'hotel') height = 52;
    else if (spot.kind === 'casino') height = 26;
    else if (spot.kind === 'mall') height = 15;
    else if (spot.kind === 'garage') height = 9;
    const w = spot.kind === 'mall' ? 27 : spot.kind === 'garage' ? 24 : 19;
    const d = spot.kind === 'garage' ? 20 : 19;
    const set = makeFacadeTextures(spot.color, Math.max(6, (height / 3) | 0), 6);
    const side = new THREE.MeshLambertMaterial({
      map: set.map, emissive: 0xffc98a, emissiveMap: set.emissiveMap, emissiveIntensity: 0,
    });
    nightEmissives.push(side);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, height, d),
      [side, side, roofMat, roofMat, side, side]);
    b.position.set(cx, 0.36 + height / 2, cz); b.castShadow = true; b.receiveShadow = true;
    group.add(b); addCollider(cx, cz, w, d);
    addSign(Math.min(17, w + 2), 3.4, cx, height * 0.72, cz + d / 2 + 0.15, 0);
    addSign(Math.min(17, w + 2), 3.4, cx, height * 0.72, cz - d / 2 - 0.15, Math.PI);
    landmarks.push({ name: spot.name, kind: spot.kind, x: cx, z: cz, radius: 16 });
  }

  for (let bx = -WORLD.GRID; bx < WORLD.GRID; bx++)
    for (let bz = -WORLD.GRID; bz < WORLD.GRID; bz++)
      buildBlock(bx, bz, (bx + 0.5) * WORLD.PITCH, (bz + 0.5) * WORLD.PITCH);

  // ----- the pier and the lighthouse, out on the shore -----
  {
    const wood = new THREE.MeshLambertMaterial({ color: 0x9a6b43 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 14), wood);
    deck.position.set(-232, 0.8, 0); deck.castShadow = true; group.add(deck);
    const signTex = makeSignTexture('SOLMAR PIER', '#2b1603', '#ffd94d');
    const arch = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.6),
      new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    arch.position.set(-212, 6.4, 0); group.add(arch);
    for (const dz of [-6.4, 6.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 6.4), wood);
      post.position.set(-212, 3.2, dz); group.add(post);
    }
    landmarks.push({ name: 'Solmar Pier', kind: 'pier', x: -228, z: 0, radius: 16 });

    const rock = new THREE.Mesh(new THREE.CylinderGeometry(13, 17, 3, 9),
      new THREE.MeshLambertMaterial({ color: 0x77726c }));
    rock.position.set(-222, 0.8, -196); group.add(rock);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xf4f1e6 });
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xd84040 });
    const tower = new THREE.Group();
    const t1 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 9, 12), towerMat);
    t1.position.y = 4.5; tower.add(t1);
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 5, 12), bandMat);
    t2.position.y = 11.5; tower.add(t2);
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.6, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    lampRoom.position.y = 15.2; tower.add(lampRoom);
    tower.position.set(-222, 2.2, -196); tower.traverse(o => { o.castShadow = true; });
    group.add(tower);
    addCollider(-222, -196, 8, 8);
    landmarks.push({ name: 'Harbor Lighthouse', kind: 'lighthouse', x: -222, z: -196, radius: 14 });
    var lighthouseLamp = lampRoom;
  }

  // ----- palms and streetlights -----
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  function plantPalm(x, z, s) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 5.6, 6), trunkMat);
    trunk.position.y = 2.8; trunk.rotation.z = 0.07; trunk.castShadow = true; palm.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.5, 8), frondMat);
    crown.position.y = 6.1; crown.castShadow = true; palm.add(crown);
    palm.position.set(x, 0.3, z); palm.scale.setScalar(s);
    palm.rotation.y = rng() * Math.PI * 2;
    group.add(palm);
  }
  for (let i = -WORLD.GRID; i <= WORLD.GRID; i++)
    for (let j = -WORLD.GRID; j <= WORLD.GRID; j++) {
      if (rng() < 0.75) plantPalm(i * WORLD.PITCH + 10.5, j * WORLD.PITCH + 10.5, 0.9 + rng() * 0.4);
      if (rng() < 0.75) plantPalm(i * WORLD.PITCH - 10.5, j * WORLD.PITCH - 10.5, 0.9 + rng() * 0.4);
    }
  for (let k = 0; k < 14; k++) plantPalm(-206 + rng() * 6, -210 + k * 30 + rng() * 8, 1 + rng() * 0.5);

  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x554d33 });
  for (let i = -WORLD.GRID; i <= WORLD.GRID; i++)
    for (let j = -WORLD.GRID; j < WORLD.GRID; j++) {
      for (const [x, z] of [[i * WORLD.PITCH + 9, (j + 0.5) * WORLD.PITCH], [(j + 0.5) * WORLD.PITCH, i * WORLD.PITCH - 9]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.6, 5), poleMat);
        pole.position.set(x, 2.8, z); group.add(pole);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), lampMat.clone());
        head.position.set(x, 5.7, z); group.add(head); lampHeads.push(head);
      }
    }

  // ----- sky: sun, moon, stars -----
  const sun = new THREE.DirectionalLight(0xffe3b3, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 700; sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbdd8ff, 0x8a6a4d, 0.9); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.12); scene.add(amb);

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 500; i++) {
    const th = rng() * Math.PI * 2, ph = rng() * Math.PI * 0.45;
    starPos.push(Math.cos(th) * Math.cos(ph) * 900, Math.sin(ph) * 900 + 30, Math.sin(th) * Math.cos(ph) * 900);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 });
  const stars = new THREE.Points(starGeo, starMat); scene.add(stars);

  scene.fog = new THREE.Fog(0xf2b183, 240, 720);

  const SKY_KEYS = [ // [hour, sky, fog, sunColor, sunI, hemiI]
    [0, 0x0b1026, 0x0b1026, 0x8fb4ff, 0.12, 0.22],
    [5, 0x0e1430, 0x141a38, 0x8fb4ff, 0.12, 0.25],
    [7, 0xffb37a, 0xffc490, 0xffd9a0, 1.5, 0.55],
    [10, 0x87c5eb, 0xaad4f5, 0xfff2d8, 2.7, 0.95],
    [16, 0x7fb8e8, 0xa8cdf2, 0xffeec9, 2.5, 0.9],
    [18.2, 0xff9a5a, 0xf2a56f, 0xffb066, 1.7, 0.6],
    [19.6, 0x35355e, 0x2c2c50, 0xff9a7a, 0.35, 0.35],
    [21, 0x0b1026, 0x0b1026, 0x8fb4ff, 0.12, 0.22],
    [24, 0x0b1026, 0x0b1026, 0x8fb4ff, 0.12, 0.22],
  ];
  const cA = new THREE.Color(), cB = new THREE.Color();
  function lerpKey(h, idx) {
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++)
      if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    const f = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
    cA.setHex(a[idx]); cB.setHex(b[idx]); return cA.lerp(cB, f).clone();
  }
  function lerpNum(h, idx) {
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++)
      if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    const f = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
    return a[idx] + (b[idx] - a[idx]) * f;
  }

  let focus = new THREE.Vector3();
  function update(dt, elapsed) {
    timeHours = (timeHours + dt * 24 / 300) % 24; // a full day every 5 minutes
    const h = timeHours;
    const sunAng = ((h - 6) / 12) * Math.PI;      // sunrise 6, sunset 18
    const elev = Math.sin(sunAng);
    darkness = THREE.MathUtils.clamp(1 - (elev + 0.25) / 0.65, 0, 1);
    const sky = lerpKey(h, 1);
    scene.background = sky;
    scene.fog.color.copy(lerpKey(h, 2));
    sun.color.copy(lerpKey(h, 3));
    sun.intensity = lerpNum(h, 4);
    hemi.intensity = lerpNum(h, 5);
    const night = darkness > 0.55;
    sun.position.set(
      focus.x + Math.cos(sunAng) * 260,
      Math.max(18, elev * 300),
      focus.z + 120);
    sun.target.position.copy(focus);
    for (const m of nightEmissives) m.emissiveIntensity = darkness * 0.95;
    for (const m of lampHeads) m.material.color.setHex(night ? 0xffd9a0 : 0x554d33);
    starMat.opacity = darkness * 0.9;
    stars.position.set(focus.x, 0, focus.z);
    waterMat.color.setHex(night ? 0x0d3350 : 0x1d6f8e);
    if (lighthouseLamp) lighthouseLamp.material.color.setHex(night ? 0xfff3b0 : 0xffe9a8);
  }

  function collide(pos, radius) {
    for (const c of colliders) {
      if (pos.x > c.x0 - radius && pos.x < c.x1 + radius && pos.z > c.z0 - radius && pos.z < c.z1 + radius) {
        const dxl = pos.x - (c.x0 - radius), dxr = (c.x1 + radius) - pos.x;
        const dzl = pos.z - (c.z0 - radius), dzr = (c.z1 + radius) - pos.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) pos.x = c.x0 - radius; else if (m === dxr) pos.x = c.x1 + radius;
        else if (m === dzl) pos.z = c.z0 - radius; else pos.z = c.z1 + radius;
      }
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -248, 236);
    pos.z = THREE.MathUtils.clamp(pos.z, -236, 236);
    return pos;
  }

  return {
    group, colliders, landmarks,
    update,
    setFocus(v) { focus.copy(v); },
    setTimeOfDay(h) { timeHours = h; },
    timeOfDay: () => timeHours,
    darkness: () => darkness,
    collide,
    isRoad(x, z) {
      if (x < WORLD.WATER_X - 4 || Math.abs(z) > WORLD.EXTENT + 12) return false;
      const mx = Math.abs(((x % WORLD.PITCH) + WORLD.PITCH) % WORLD.PITCH);
      const mz = Math.abs(((z % WORLD.PITCH) + WORLD.PITCH) % WORLD.PITCH);
      const near = v => Math.min(v, WORLD.PITCH - v) < WORLD.ROAD_W / 2;
      return near(mx) || near(mz);
    },
    zoneNameAt(x, z) {
      let best = null, bd = 1e9;
      for (const l of landmarks) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; best = l; } }
      if (bd < 42 * 42) return best.name;
      if (x < -150) return 'The Shore';
      if (z < -120) return 'Harbor District';
      if (z > 120) return 'Palm Court Quarter';
      if (x > 120) return 'Coral Heights';
      return 'Downtown Solmar';
    },
    randomRoadPoint() {
      const vertical = rng() < 0.5;
      const line = (Math.floor(rng() * 9) - WORLD.GRID) * WORLD.PITCH;
      const along = (rng() * 2 - 1) * (WORLD.EXTENT - 8);
      return vertical ? { x: line, z: along } : { x: along, z: line };
    },
    randomSidewalkPoint() {
      const bx = Math.floor(rng() * 8) - WORLD.GRID, bz = Math.floor(rng() * 8) - WORLD.GRID;
      const cx = (bx + 0.5) * WORLD.PITCH, cz = (bz + 0.5) * WORLD.PITCH;
      const side = (rng() * 4) | 0, t = (rng() * 2 - 1) * 15;
      const off = 18.5;
      return [
        { x: cx + t, z: cz - off }, { x: cx + t, z: cz + off },
        { x: cx - off, z: cz + t }, { x: cx + off, z: cz + t },
      ][side];
    },
  };
}
