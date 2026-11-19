// main.js — Solmar Heat's boot and heartbeat: builds the world, runs the
// game loop, moves Lena on foot and behind the wheel, works the camera,
// owns the menu / pause / busted / wasted states, saves the story, and
// exposes the debug hooks the screenshots were staged with.

import * as THREE from 'three';
import { createCity, WORLD } from './city.js';
import { createVehicleFleet } from './vehicles.js';
import { createCrowd, buildPersonMesh, animateWalk } from './pedestrians.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const PROBE = params.has('probe');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('game-root').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1600);
camera.position.set(-90, 46, 120);

const city = createCity(scene);
const hud = createHud();
const audio = createAudio();
const fleet = createVehicleFleet(scene, city);
const crowd = createCrowd(scene, city);
const police = createPolice(scene, city, audio);

// ---------- Lena ----------
const SPAWN = new THREE.Vector3(-58, 0.36, 58);
const HOSPITAL = new THREE.Vector3(104, 0.36, -52);
const POLICE_STATION = new THREE.Vector3(12, 0.36, -14);
const playerMesh = buildPersonMesh({ shirt: 0x0e7c86, pants: 0x22223b, skin: 0xc68863, hair: 0x14100c });
scene.add(playerMesh);

const game = {
  scene, camera, city, fleet, crowd, police, hud, audio,
  state: 'menu',
  player: {
    pos: SPAWN.clone(), vel: new THREE.Vector3(), heading: 2.6,
    health: 100, money: 250, inCar: null, walkPhase: 0,
  },
  addMoney(n) { game.player.money += n; },
  damagePlayer(amount) {
    if (game.state !== 'playing') return;
    game.player.health -= amount;
    if (game.player.health <= 0) wasted();
  },
  onStoryComplete() {
    showOverlay('SOLMAR HEAT', 'good',
      'Lena and Mara Ortiz own the bay now — the garage is safe, the Syndicate is broken, and every street in Solmar Bay knows her name. The city is yours to roam.');
  },
};
const combat = createCombat(game);
const missions = createMissions(game);
game.missions = missions;
game.combat = combat;

// ---------- ground height (sidewalk pads, the pier deck, the lighthouse rock) ----------
function groundY(x, z) {
  if (x < -207 && x > -257 && Math.abs(z) < 7.6) return 1.42;               // pier deck
  if (Math.hypot(x + 222, z + 196) < 12.5) return 2.32;                    // lighthouse rock
  const bx = ((x % WORLD.PITCH) + WORLD.PITCH) % WORLD.PITCH;
  const bz = ((z % WORLD.PITCH) + WORLD.PITCH) % WORLD.PITCH;
  const inBlock = v => v > 8 && v < 40;
  return (inBlock(bx) && inBlock(bz)) ? 0.36 : 0.02;
}

// ---------- input ----------
const keys = {};
let camYaw = 2.6, camPitch = 0.24, pointerLocked = false;
let mouseDown = false, punchCd = 0, lastCarHitAt = -9, lastRamAt = -9, lastPropAt = -9;

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyP' && (game.state === 'playing' || game.state === 'paused')) togglePause();
  if (e.code === 'KeyM') { const m = audio.toggleMute(); hud.showToast(m ? 'Muted' : 'Sound on', ''); }
  if (e.code === 'KeyE' && game.state === 'playing') toggleCar();
  if (e.code === 'KeyF' && game.state === 'playing' && punchCd <= 0) { combat.punch(); punchCd = 0.35; }
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (!pointerLocked || game.state !== 'playing') return;
  camYaw -= e.movementX * 0.0026;
  camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * 0.0022, -0.12, 0.95);
});
addEventListener('mousedown', e => { if (e.button === 0) mouseDown = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
renderer.domElement.addEventListener('click', () => {
  audio.ensure();
  if (game.state === 'playing' && !SHOT) {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => { /* a too-eager re-lock is refused; the next click retries */ });
  }
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked && game.state === 'playing' && !SHOT) pauseGame();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- cars: stealing, driving, leaving ----------
function toggleCar() {
  const p = game.player;
  if (p.inCar) {
    const car = p.inCar;
    p.inCar = null;
    const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading));
    p.pos.copy(car.mesh.position).addScaledVector(side, 2.6);
    p.pos.y = groundY(p.pos.x, p.pos.z);
    city.collide(p.pos, 0.45);
    playerMesh.visible = true;
    fleet.releaseCar(car);
    audio.setEngine(false);
    return;
  }
  const car = fleet.nearestStealable(p.pos, 3.6);
  if (!car) return;
  fleet.claimCar(car);
  car.speed = 0;
  p.inCar = car;
  playerMesh.visible = false;
  camYaw = car.heading;
  const witnessed = police.nearestUnitDistance(p.pos) < 55 ||
    crowd.peds.some(ped => ped.state !== 'dead' && ped.mesh.position.distanceTo(p.pos) < 17);
  if (witnessed) police.reportCrime('carTheft');
  missions.notify('enterCar', { stolen: true });
  hud.setPrompt(null);
}

function updateDriving(dt, now) {
  const p = game.player, car = p.inCar;
  const input = {
    throttle: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
    brake: !!keys.Space,
  };
  const healthBefore = car.health;
  fleet.driveCar(car, input, dt);
  p.pos.copy(car.mesh.position);
  p.vel.set(Math.sin(car.heading) * car.speed, 0, Math.cos(car.heading) * car.speed);
  p.heading = car.heading;
  if (healthBefore - car.health >= 4 && now - lastPropAt > 1.2) {
    police.reportCrime('propertyDamage'); lastPropAt = now;
  }
  // Running people down is the loudest crime there is.
  if (Math.abs(car.speed) > 3) {
    for (const ped of crowd.peds) {
      if (ped.state === 'dead' || ped.state === 'down') continue;
      if (ped.mesh.position.distanceTo(car.mesh.position) < 2.1) {
        crowd.knockDown(ped, Math.abs(car.speed) > 10);
        police.reportCrime(Math.abs(car.speed) > 10 ? 'hitAndRun' : 'assault');
        audio.thud();
        car.speed *= 0.82;
      }
    }
  }
  // Shunting other cars — and patrol cars notice.
  const others = [...fleet.allCars(), ...police.units.map(u => ({ mesh: u.mesh, policeUnit: u }))];
  for (const other of others) {
    if (other.mesh === car.mesh) continue;
    const d = other.mesh.position.distanceTo(car.mesh.position);
    if (d < 3.1 && d > 0.01) {
      const push = other.mesh.position.clone().sub(car.mesh.position).normalize();
      other.mesh.position.addScaledVector(push, (3.1 - d) * 0.6);
      if (other.policeUnit) {
        other.policeUnit.speed *= 0.4;
        if (now - lastRamAt > 1) { police.reportCrime('ramPolice'); lastRamAt = now; }
      }
      if (Math.abs(car.speed) > 6) car.speed *= 0.86;
    }
  }
  audio.setEngine(true, Math.abs(car.speed) / 37);
  hud.setSpeed(car.speed * 3.6);
}

// ---------- on foot ----------
function updateOnFoot(dt, now) {
  const p = game.player;
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = sprint ? 12.5 : 8.2;
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  const mx = (sin * fwd + cos * str), mz = (cos * fwd - sin * str);
  const len = Math.hypot(mx, mz) || 1;
  const moving = (fwd !== 0 || str !== 0);
  p.vel.set(moving ? (mx / len) * speed : 0, 0, moving ? (mz / len) * speed : 0);
  p.pos.addScaledVector(p.vel, dt);
  city.collide(p.pos, 0.45);
  p.pos.y = groundY(p.pos.x, p.pos.z);
  if (moving) {
    p.heading = Math.atan2(p.vel.x, p.vel.z);
    p.walkPhase += dt * (sprint ? 13 : 10);
    animateWalk(playerMesh, p.walkPhase, 1);
  } else animateWalk(playerMesh, 0, 0);
  playerMesh.position.copy(p.pos);
  // Heading is the angle whose (sin, cos) is the facing vector; the camera
  // looks along (sin camYaw, cos camYaw), so a locked mouse means Lena
  // faces exactly where the camera faces.
  playerMesh.rotation.y = pointerLocked || SHOT ? camYaw : p.heading;
  if (pointerLocked || SHOT) p.heading = camYaw;
  // Traffic is not looking out for jaywalkers.
  if (now - lastCarHitAt > 1) {
    for (const car of fleet.traffic) {
      if (Math.abs(car.speed) > 5 && car.mesh.position.distanceTo(p.pos) < 2.0) {
        game.damagePlayer(11);
        const away = p.pos.clone().sub(car.mesh.position).normalize();
        p.pos.addScaledVector(away, 2.4);
        crowd.scare(p.pos, 10, car.mesh.position);
        lastCarHitAt = now;
        break;
      }
    }
  }
  if (mouseDown) combat.tryShoot(now);
  audio.setEngine(false);
  hud.setSpeed(null);
  // Interaction prompt.
  const car = fleet.nearestStealable(p.pos, 3.6);
  hud.setPrompt(car ? '<b>E</b> Steal this car' : null);
}

// ---------- camera ----------
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
function updateCamera(dt) {
  const p = game.player;
  if (game.state === 'menu') {
    const t = performance.now() * 0.00004;
    camera.position.set(Math.cos(t) * 130, 52, Math.sin(t) * 130);
    camera.lookAt(0, 8, 0);
    return;
  }
  if (SHOT && shotCamera) { shotCamera(camera); return; }
  if (p.inCar) {
    const car = p.inCar;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    camTarget.set(car.mesh.position.x - fx * 11, 4.4, car.mesh.position.z - fz * 11);
    camera.position.lerp(camTarget, 1 - Math.pow(0.0001, dt));
    camPos.copy(car.mesh.position); camPos.x += fx * 7; camPos.z += fz * 7; camPos.y = 1.4;
    camera.lookAt(camPos);
  } else {
    const dist = 7.6;
    camTarget.set(
      p.pos.x - Math.sin(camYaw) * Math.cos(camPitch) * dist,
      p.pos.y + 1.7 + Math.sin(camPitch) * dist,
      p.pos.z - Math.cos(camYaw) * Math.cos(camPitch) * dist);
    camera.position.lerp(camTarget, 1 - Math.pow(0.000001, dt));
    camPos.copy(p.pos); camPos.y += 1.55;
    camera.lookAt(camPos);
  }
}

// ---------- states ----------
const $ = id => document.getElementById(id);
function showOverlay(title, kind, text) {
  game.state = 'overlay';
  document.exitPointerLock?.();
  $('overlay-title').textContent = title;
  $('overlay-title').className = kind;
  $('overlay-text').textContent = text;
  $('overlay-screen').style.display = 'flex';
}
function busted() {
  const p = game.player;
  const fine = Math.min(p.money, 120 + police.stars() * 60);
  p.money -= fine;
  audio.bustedSting(); audio.setSiren(false); audio.setEngine(false);
  showOverlay('BUSTED', 'bad',
    `Solmar Bay PD cuffed Lena after the chase. The fine is $${fine}, the garage keeps its secrets, and the story picks up where it left off.`);
  p.pos.copy(POLICE_STATION); p.vel.set(0, 0, 0);
  if (p.inCar) { fleet.releaseCar(p.inCar); p.inCar = null; playerMesh.visible = true; }
  p.health = 100;
  police.reset();
  missions.restartMission();
}
function wasted() {
  const p = game.player;
  const bill = Math.round(p.money * 0.1);
  p.money -= bill;
  audio.setEngine(false);
  showOverlay('WASTED', 'bad',
    `Lena wakes up outside Solmar General with a $${bill} hospital bill and a headache. The bay, and the story, go on.`);
  p.pos.copy(HOSPITAL); p.vel.set(0, 0, 0);
  if (p.inCar) { fleet.releaseCar(p.inCar); p.inCar = null; playerMesh.visible = true; }
  p.health = 100;
  police.reset();
  missions.restartMission();
}
function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  $('pause-screen').style.display = 'flex';
  $('save-note').textContent = 'Progress saved just now.';
  saveGame();
}
function togglePause() {
  if (game.state === 'playing') pauseGame();
  else if (game.state === 'paused') resumeGame();
}
function resumeGame() {
  $('pause-screen').style.display = 'none';
  game.state = 'playing';
}
function startGame(loadSave) {
  audio.ensure(); audio.click();
  const save = loadSave ? readSave() : null;
  game.player.money = save?.money ?? 250;
  game.player.health = 100;
  if (save?.pos) game.player.pos.set(save.pos[0], 0.36, save.pos[1]);
  if (save?.tod) city.setTimeOfDay(save.tod);
  $('start-screen').style.display = 'none';
  $('overlay-screen').style.display = 'none';
  hud.show();
  game.state = 'playing';
  if (save) missions.setProgress(save.missionIndex ?? 0);
  else missions.start();
  hud.showToast('Solmar Heat', 'Follow the gold beacon — your next job is waiting.');
}
function saveGame() {
  try {
    localStorage.setItem('solmar-heat-save', JSON.stringify({
      money: game.player.money, missionIndex: missions.index(),
      tod: city.timeOfDay(), pos: [game.player.pos.x, game.player.pos.z],
    }));
  } catch { /* private mode: the story just will not persist */ }
}
function readSave() {
  try { return JSON.parse(localStorage.getItem('solmar-heat-save')); } catch { return null; }
}

$('btn-start').addEventListener('click', () => startGame(false));
$('btn-continue').addEventListener('click', () => startGame(true));
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart').addEventListener('click', () => {
  try { localStorage.removeItem('solmar-heat-save'); } catch { }
  location.reload();
});
$('btn-overlay').addEventListener('click', () => {
  $('overlay-screen').style.display = 'none';
  if (game.state === 'overlay') game.state = 'playing';
  saveGame();
});
if (readSave()) $('btn-continue').style.display = 'inline-block';

// ---------- screenshot staging (the maker's own debug hooks) ----------
let shotCamera = null;
function claimParkedAt(x, z, heading, color) {
  const car = fleet.parked[0];
  car.mesh.position.set(x, 0, z); car.heading = heading; car.mesh.rotation.y = heading;
  if (color) car.mesh.children[0].material.color.setHex(color); // body and nose share the paint
  fleet.claimCar(car);
  car.speed = 0;
  game.player.inCar = car;
  playerMesh.visible = false;
  game.player.pos.copy(car.mesh.position);
  return car;
}
function stageShot(name) {
  $('start-screen').style.display = 'none';
  hud.show();
  game.state = 'playing';
  const p = game.player;
  if (name === 'street') {
    city.setTimeOfDay(17.9);
    p.pos.set(10, 0.36, 10); camYaw = -1.15; camPitch = 0.16;
    // Residents on the sidewalks around the corner — none on Lena's spot.
    const spots = [[12, 12], [20, 30], [-12, 14], [-20, 30], [-30, 12], [34, 20]];
    crowd.peds.slice(0, 6).forEach((ped, i) => {
      ped.mesh.position.set(spots[i][0], 0.36, spots[i][1]);
      ped.target = null;
    });
    missions.setProgress(0);
    shotCamera = cam => {
      cam.position.set(p.pos.x - Math.sin(camYaw) * 7.6, p.pos.y + 2.6, p.pos.z - Math.cos(camYaw) * 7.6);
      cam.lookAt(p.pos.x + Math.sin(camYaw) * 8, 1.6, p.pos.z + Math.cos(camYaw) * 8);
    };
  } else if (name === 'drive') {
    city.setTimeOfDay(10.4);
    const car = claimParkedAt(-188.3, 60, Math.PI, 0x2e7fd9);
    car.speed = 23;
    missions.setProgress(0);
    fleet.traffic.slice(0, 3).forEach((t, i) => {
      t.mesh.position.set(-188.3, 0, 26 - i * 17);
      t.axis = 'z'; t.street = -192; t.dir = -1; t.along = t.mesh.position.z;
      t.heading = Math.PI; t.speed = 15;
    });
    shotCamera = cam => {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      cam.position.set(car.mesh.position.x - fx * 11.5, 4.6, car.mesh.position.z - fz * 11.5);
      cam.lookAt(car.mesh.position.x + fx * 8, 1.3, car.mesh.position.z + fz * 8);
    };
  } else if (name === 'chase') {
    city.setTimeOfDay(16.3);
    const car = claimParkedAt(3.7, 26, 0, 0xd8404f);
    car.speed = 19;
    police.setHeat(330);
    const formation = [[-3.4, -6.5], [3.6, -9.5], [-0.5, -13.5]];
    for (const [ox, oz] of formation) {
      const u = police.spawnUnit(p.pos);
      u.mesh.position.set(3.7 + ox, 0, 26 + oz);
      u.heading = 0; u.speed = 18;
    }
    missions.setProgress(1);
    shotCamera = cam => {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      cam.position.set(car.mesh.position.x - fx * 14.5 + 2.5, 5.4, car.mesh.position.z - fz * 14.5);
      cam.lookAt(car.mesh.position.x + fx * 10, 1.2, car.mesh.position.z + fz * 10);
    };
  } else if (name === 'mission') {
    city.setTimeOfDay(17.55);
    p.pos.set(-200, 0.36, 10); camYaw = -2.2; camPitch = 0.13;
    missions.setProgress(1);
    shotCamera = cam => {
      cam.position.set(p.pos.x - Math.sin(camYaw) * 7.6, p.pos.y + 2.7, p.pos.z - Math.cos(camYaw) * 7.6);
      cam.lookAt(p.pos.x + Math.sin(camYaw) * 10, 2.2, p.pos.z + Math.cos(camYaw) * 10);
    };
  }
}
if (SHOT) stageShot(SHOT);

window.__solmar = {
  game, missions, police, fleet, crowd,
  setWanted: n => police.setHeat(n * 100 + 10),
  teleport: (x, z) => { game.player.pos.set(x, groundY(x, z), z); },
  startMission: i => missions.setProgress(i),
  stageShot,
};

// ---------- the loop ----------
const clock = new THREE.Clock();
let elapsed = 0, saveTimer = 0, frames = 0, fpsTimer = 0, fps = 0;
const probeEl = $('probe-out');
if (PROBE) probeEl.style.display = 'block';

function tick() {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = game.state === 'playing' || game.state === 'menu' ? rawDt : 0;
  elapsed += dt;
  frames++; fpsTimer += rawDt;
  if (fpsTimer > 0.5) { fps = Math.round(frames / fpsTimer); frames = 0; fpsTimer = 0; }

  city.setFocus(game.player.pos);
  city.update(dt, elapsed);
  if (dt > 0) {
    const p = game.player;
    if (game.state === 'playing') {
      punchCd = Math.max(0, punchCd - dt);
      if (p.inCar) updateDriving(dt, elapsed); else updateOnFoot(dt, elapsed);
      fleet.update(dt, p.inCar ? p.inCar.mesh.position : p.pos);
      const dangerLevel = p.inCar ? Math.min(1, Math.abs(p.inCar.speed) / 18) : 0;
      crowd.update(dt, { pos: p.pos, level: dangerLevel });
      const pol = police.update(dt, {
        pos: p.pos, vel: p.vel, inCar: !!p.inCar,
      });
      if (pol.busted) busted();
      combat.update(dt);
      missions.update(dt);
      // HUD refresh.
      hud.setMoney(p.money);
      hud.setHealth(p.health);
      hud.setStars(pol.stars);
      hud.setClock(city.timeOfDay(), city.zoneNameAt(p.pos.x, p.pos.z));
      hud.setObjective(missions.objective());
      hud.setCrosshair(!p.inCar);
      if (pol.bustProgress > 0.04 && pol.stars > 0)
        hud.setPrompt(`⚠ The police are cuffing you — <b>MOVE!</b>`);
      hud.drawMinimap({
        playerPos: p.pos, heading: p.inCar ? p.inCar.heading : (pointerLocked || SHOT ? camYaw : p.heading),
        city, policeUnits: police.units,
        cars: [...fleet.traffic, ...fleet.parked],
        target: missions.objective().target, timeMs: performance.now(),
      });
      if (SHOT && game.player.inCar) // staged scenes hold their speed for the camera
        game.player.inCar.speed = Math.max(game.player.inCar.speed, SHOT === 'chase' ? 17 : 21);
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; saveGame(); }
    }
    audio.update(dt, !!game.player.inCar);
  }
  updateCamera(rawDt);
  renderer.render(scene, camera);
  if (PROBE) {
    probeEl.textContent = JSON.stringify({
      state: game.state, fps, errors: window.__errors,
      pos: [Math.round(game.player.pos.x), Math.round(game.player.pos.z)],
      stars: police.stars(), mission: missions.objective().text,
    });
  }
}
tick();
