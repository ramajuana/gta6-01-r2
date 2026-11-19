// combat.js — Lena's pistol, her fists, and the Coral Syndicate gunmen who
// shoot back. Hitscan with tracers, muzzle flash and honest consequences:
// every shot is a crime the police module hears about.

import * as THREE from 'three';

export function createCombat(game) {
  const { scene, crowd, police, audio } = game;
  const raycaster = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  const flash = new THREE.PointLight(0xffc266, 0, 11);
  scene.add(flash);
  let cooldown = 0;
  let gunfireReportAt = -10;

  // A small pool of tracer lines, recycled per shot.
  const tracers = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0,
    }));
    line.frustumCulled = false; scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;
  function tracer(from, to, color) {
    const t = tracers[tracerIdx++ % tracers.length];
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z); p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.line.material.color.setHex(color ?? 0xffe9a8);
    t.line.material.opacity = 0.9; t.life = 0.07;
  }

  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  function entityAtRay(origin, dir) {
    // Nearest living person or vehicle along the ray, tested as spheres.
    let best = null, bestT = 95;
    const testSphere = (centrePos, r, payload) => {
      tmpV.copy(centrePos).sub(origin);
      const t = tmpV.dot(dir);
      if (t < 0.5 || t > bestT) return;
      tmpV2.copy(dir).multiplyScalar(t).add(origin);
      if (tmpV2.distanceTo(centrePos) < r) { bestT = t; best = payload; }
    };
    for (const ped of crowd.peds) {
      if (ped.state === 'dead') continue;
      tmpV.copy(ped.mesh.position); tmpV.y += 1.15;
      testSphere(tmpV, 0.62, { kind: 'ped', ped });
    }
    for (const unit of police.units) {
      tmpV.copy(unit.mesh.position); tmpV.y += 0.75;
      testSphere(tmpV, 2.5, { kind: 'police', unit });
    }
    for (const car of game.fleet.allCars()) {
      tmpV.copy(car.mesh.position); tmpV.y += 0.7;
      testSphere(tmpV, 2.5, { kind: 'car', car });
    }
    if (best) best.point = origin.clone().addScaledVector(dir, bestT);
    return best;
  }

  function tryShoot(now) {
    if (cooldown > 0 || game.player.inCar || game.state !== 'playing') return false;
    cooldown = 0.16;
    const cam = game.camera;
    raycaster.setFromCamera(centre, cam);
    const origin = raycaster.ray.origin, dir = raycaster.ray.direction;
    const muzzle = tmpV.copy(game.player.pos); muzzle.y += 1.45;
    muzzle.addScaledVector(dir, 0.7);
    flash.position.copy(muzzle); flash.intensity = 3;
    audio.shot();
    if (now - gunfireReportAt > 2.5) { police.reportCrime('gunfire'); gunfireReportAt = now; }
    crowd.scare(game.player.pos, 16, game.player.pos);
    const hit = entityAtRay(origin, dir);
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 95);
    tracer(muzzle.clone(), end, 0xffe9a8);
    if (!hit) return true;
    if (hit.kind === 'ped') {
      const ped = hit.ped;
      ped.health -= 34;
      if (ped.health <= 0) { crowd.knockDown(ped, true); police.reportCrime('assault'); }
      else {
        if (ped.rival) ped.state = 'fight';
        else { crowd.scare(ped.mesh.position, 8, game.player.pos); ped.state = 'flee'; ped.fleeTimer = 3; ped.fleeFrom = game.player.pos.clone(); }
        police.reportCrime('assault');
      }
    } else if (hit.kind === 'police') {
      police.damageUnit(hit.unit, 26);
      police.reportCrime('shootPolice');
    } else if (hit.kind === 'car') {
      hit.car.health -= 18;
    }
    return true;
  }

  function punch() {
    if (game.player.inCar || game.state !== 'playing') return;
    const facing = game.player.heading;
    for (const ped of crowd.peds) {
      if (ped.state === 'dead' || ped.state === 'down') continue;
      const d = ped.mesh.position.distanceTo(game.player.pos);
      if (d > 2.1) continue;
      const ang = Math.atan2(ped.mesh.position.x - game.player.pos.x, ped.mesh.position.z - game.player.pos.z);
      let diff = Math.abs(ang - facing);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < 0.8) {
        ped.health -= 26;
        audio.thud();
        if (ped.health <= 0) crowd.knockDown(ped, ped.rival);
        else if (ped.rival) ped.state = 'fight';
        else { ped.state = 'flee'; ped.fleeTimer = 3; ped.fleeFrom = game.player.pos.clone(); }
        police.reportCrime('assault');
        return;
      }
    }
  }

  // Rival gunmen: keep their distance, strafe, and fire on a timer.
  function updateRivals(dt) {
    for (const ped of crowd.peds) {
      if (!ped.rival || ped.state !== 'fight') continue;
      const pos = ped.mesh.position;
      const toPlayer = tmpV.copy(game.player.pos).sub(pos); toPlayer.y = 0;
      const dist = toPlayer.length(); toPlayer.normalize();
      ped.heading = Math.atan2(toPlayer.x, toPlayer.z);
      ped.mesh.rotation.y = ped.heading;
      let move = 0;
      if (dist > 15) move = 1; else if (dist < 7) move = -1;
      const strafe = Math.sin(performance.now() * 0.001 + ped.phase) * 0.7;
      pos.x += (toPlayer.x * move + -toPlayer.z * strafe) * dt * 2.6;
      pos.z += (toPlayer.z * move + toPlayer.x * strafe) * dt * 2.6;
      game.city.collide(pos, 0.42); pos.y = 0.36;
      ped.shootTimer = (ped.shootTimer ?? 1 + Math.random()) - dt;
      if (ped.shootTimer <= 0 && dist < 30) {
        ped.shootTimer = 1.1 + Math.random() * 1.3;
        const from = pos.clone(); from.y += 1.45;
        const to = game.player.pos.clone(); to.y += 1.2;
        const chance = THREE.MathUtils.clamp(0.52 - dist * 0.014, 0.08, 0.5);
        if (Math.random() < chance) {
          game.damagePlayer(5 + Math.random() * 6);
          tracer(from, to, 0xff9a7a);
        } else {
          to.x += (Math.random() - 0.5) * 3; to.z += (Math.random() - 0.5) * 3;
          tracer(from, to, 0xff9a7a);
        }
        audio.shot(true);
      }
    }
  }

  function update(dt) {
    cooldown = Math.max(0, cooldown - dt);
    flash.intensity = Math.max(0, flash.intensity - dt * 26);
    for (const t of tracers) {
      if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9; }
    }
    updateRivals(dt);
  }

  return { tryShoot, punch, update };
}
