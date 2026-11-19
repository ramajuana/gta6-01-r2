// police.js — the Solmar Bay PD: the wanted level, how crimes feed it, the
// patrol cars that answer it, and the bust that ends a chase.

import * as THREE from 'three';
import { buildCarMesh } from './vehicles.js';

export const CRIME_HEAT = {
  carTheft: 55,        // stealing a car in the open
  assault: 70,         // hurting a pedestrian
  hitAndRun: 110,      // running someone down
  gunfire: 45,         // shots fired in public
  shootPolice: 130,    // firing on an officer's car
  ramPolice: 90,       // ramming a patrol car
  propertyDamage: 22,  // smashing into the city at speed
};

export function createPolice(scene, city, audio) {
  const group = new THREE.Group(); scene.add(group);
  const units = [];
  let heat = 0;                 // 100 heat = one star
  let graceTimer = 0;           // time since the last crime or sighting
  let bustProgress = 0;
  let flashPhase = 0;
  const tmp = new THREE.Vector3();

  const stars = () => Math.min(5, Math.floor(heat / 100));

  function reportCrime(kind) {
    heat = Math.min(520, heat + (CRIME_HEAT[kind] ?? 20));
    graceTimer = 0;
  }

  function spawnUnit(playerPos) {
    let p = city.randomRoadPoint();
    for (let tries = 0; tries < 8; tries++) {
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (d > 80 && d < 170) break;
      p = city.randomRoadPoint();
    }
    const mesh = buildCarMesh(0xf2f3f5, { police: true });
    mesh.position.set(p.x, 0, p.z);
    group.add(mesh);
    const unit = {
      mesh, heading: Math.atan2(playerPos.x - p.x, playerPos.z - p.z),
      speed: 0, health: 160, stalled: 0,
    };
    mesh.rotation.y = unit.heading;
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    group.remove(unit.mesh);
    units.splice(units.indexOf(unit), 1);
  }

  function steerUnit(unit, dt, targetPos, targetVel) {
    const pos = unit.mesh.position;
    // Aim where the target will be, not where it was.
    tmp.copy(targetPos);
    if (targetVel) tmp.addScaledVector(targetVel, 0.45);
    const desired = Math.atan2(tmp.x - pos.x, tmp.z - pos.z);
    let diff = desired - unit.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    unit.heading += THREE.MathUtils.clamp(diff, -1.9 * dt, 1.9 * dt);
    const dist = pos.distanceTo(targetPos);
    const cruise = 30 + stars() * 2.2;
    const want = dist < 6 ? cruise * 0.4 : cruise;
    unit.speed += THREE.MathUtils.clamp(want - unit.speed, -30 * dt, 13 * dt);
    if (unit.stalled > 0) { unit.stalled -= dt; unit.speed = Math.min(unit.speed, 0); }
    const fx = Math.sin(unit.heading), fz = Math.cos(unit.heading);
    pos.x += fx * unit.speed * dt;
    pos.z += fz * unit.speed * dt;
    // Never merge into the target: tail it at four units, bumper to bumper.
    const gap = pos.distanceTo(targetPos);
    if (gap < 4.0 && gap > 0.01) {
      tmp.copy(pos).sub(targetPos).setLength(4.0).add(targetPos);
      pos.x = tmp.x; pos.z = tmp.z;
      unit.speed = Math.min(unit.speed, 16);
    }
    for (const off of [1.45, -1.45]) {
      tmp.set(pos.x + fx * off, 0, pos.z + fz * off);
      const bx = tmp.x, bz = tmp.z;
      city.collide(tmp, 1.2);
      if (tmp.x !== bx || tmp.z !== bz) {
        pos.x += tmp.x - bx; pos.z += tmp.z - bz;
        unit.speed *= 0.5;
      }
    }
    unit.mesh.rotation.y = unit.heading;
    const wheels = unit.mesh.userData.wheels;
    if (wheels) for (const w of wheels) w.rotation.x += (unit.speed * dt) / 0.37;
    // Keep some daylight between patrol cars.
    for (const other of units) {
      if (other === unit) continue;
      const d = pos.distanceTo(other.mesh.position);
      if (d > 0.01 && d < 4.4) {
        tmp.copy(pos).sub(other.mesh.position).normalize();
        pos.addScaledVector(tmp, (4.4 - d) * dt * 2.2);
      }
    }
  }

  function update(dt, player) {
    flashPhase += dt * 7;
    graceTimer += dt;
    const s = stars();
    // Decay only when nobody is watching: no unit close and no fresh crime.
    const nearest = nearestUnitDistance(player.pos);
    if (graceTimer > 10 && nearest > 60 && heat > 0) heat = Math.max(0, heat - 7.5 * dt);
    if (heat < 100 && units.length && nearest > 130) removeUnit(units[0]);

    const wanted = s;
    while (units.length < wanted) spawnUnit(player.pos);
    while (units.length > Math.max(wanted, 0) && nearestUnitDistance(player.pos) > 150) removeUnit(units[units.length - 1]);
    if (wanted === 0 && units.length) {
      // Stand down: units peel away and despawn once far off.
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        tmp.copy(u.mesh.position).sub(player.pos).setLength(60).add(player.pos);
        steerUnit(u, dt, tmp, null);
        if (u.mesh.position.distanceTo(player.pos) > 120) removeUnit(u);
      }
    } else {
      for (const u of units) steerUnit(u, dt, player.pos, player.vel);
    }
    // Flashing light bars.
    const on = Math.sin(flashPhase) > 0;
    for (const u of units) {
      const bar = u.mesh.userData.lightBar;
      if (!bar) continue;
      bar.red.material.color.setHex(on ? 0xff2d2d : 0x571010);
      bar.blue.material.color.setHex(on ? 0x10408f : 0x2d6bff);
    }
    if (audio) audio.setSiren(units.length > 0 && nearestUnitDistance(player.pos) < 85);

    // The bust: stay close to a slow or cornered player and the cuffs come out.
    const playerSpeed = player.vel ? Math.hypot(player.vel.x, player.vel.z) : 0;
    const close = nearest <= (player.inCar ? 10 : 8.5);
    if (wanted > 0 && close && playerSpeed < 2.6) bustProgress += dt / 2.4;
    else bustProgress = Math.max(0, bustProgress - dt * 0.8);
    return { stars: s, bustProgress: Math.min(1, bustProgress), busted: bustProgress >= 1 };
  }

  function nearestUnitDistance(pos) {
    let d = Infinity;
    for (const u of units) d = Math.min(d, u.mesh.position.distanceTo(pos));
    return d;
  }

  function damageUnit(unit, amount) {
    unit.health -= amount;
    if (unit.health <= 0 && unit.stalled <= 0) { unit.stalled = 6; unit.speed = 0; }
  }

  function reset() {
    heat = 0; bustProgress = 0; graceTimer = 0;
    for (let i = units.length - 1; i >= 0; i--) removeUnit(units[i]);
  }

  return {
    group, units, update, reportCrime, damageUnit, reset, spawnUnit,
    stars, heat: () => heat,
    setHeat(v) { heat = v; },
    nearestUnitDistance,
  };
}
