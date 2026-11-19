// pedestrians.js — the people of Solmar Bay: residents strolling the
// sidewalks, rivals with grudges, and how they walk, flee, fall and get up.

import * as THREE from 'three';
import { mulberry32 } from './city.js';

const rng = mulberry32(4451);
const SKIN = [0xf2c49b, 0xc68863, 0x8a5a3b, 0x6e4530, 0xffdbac];
const SHIRTS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0xf4f1e6, 0x9a6ae0, 0xff8c42, 0x4cc9f0];
const PANTS = [0x2b2d42, 0x3a506b, 0x5c374c, 0x22223b, 0x6c5849];

export function buildPersonMesh({ shirt, pants, skin, hair = 0x2a1c12, rival = false }) {
  const person = new THREE.Group();
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(shirt));
  torso.position.y = 1.06; torso.castShadow = true; person.add(torso);
  if (rival) { // a syndicate bandana marks Lena's enemies
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.44), mat(0xd90429));
    band.position.y = 1.62; person.add(band);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.4), mat(skin));
  head.position.y = 1.66; head.castShadow = true; person.add(head);
  const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.44), mat(hair));
  hairM.position.y = 1.9; person.add(hairM);
  // Each limb gets its own geometry, pre-translated so its pivot sits at the
  // hip or shoulder and the swing reads as walking.
  const legGeo = () => { const g = new THREE.BoxGeometry(0.2, 0.72, 0.2); g.translate(0, -0.3, 0); return g; };
  const armGeo = () => { const g = new THREE.BoxGeometry(0.16, 0.66, 0.16); g.translate(0, -0.28, 0); return g; };
  const legL = new THREE.Mesh(legGeo(), mat(pants)); legL.position.set(-0.17, 0.68, 0); person.add(legL);
  const legR = new THREE.Mesh(legGeo(), mat(pants)); legR.position.set(0.17, 0.68, 0); person.add(legR);
  const armL = new THREE.Mesh(armGeo(), mat(shirt)); armL.position.set(-0.42, 1.36, 0); person.add(armL);
  const armR = new THREE.Mesh(armGeo(), mat(shirt)); armR.position.set(0.42, 1.36, 0); person.add(armR);
  person.userData.limbs = { legL, legR, armL, armR };
  return person;
}

export function animateWalk(person, phase, amount) {
  const { legL, legR, armL, armR } = person.userData.limbs;
  const s = Math.sin(phase) * 0.55 * amount;
  legL.rotation.x = s; legR.rotation.x = -s;
  armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
}

const CROWD_COUNT = 42;

export function createCrowd(scene, city) {
  const group = new THREE.Group(); scene.add(group);
  const peds = [];

  function makePed(pos, opts = {}) {
    const mesh = buildPersonMesh({
      shirt: opts.shirt ?? SHIRTS[(rng() * SHIRTS.length) | 0],
      pants: PANTS[(rng() * PANTS.length) | 0],
      skin: SKIN[(rng() * SKIN.length) | 0],
      rival: !!opts.rival,
    });
    mesh.position.copy(pos);
    group.add(mesh);
    const ped = {
      mesh, rival: !!opts.rival, health: opts.health ?? 100,
      state: 'walk',           // walk | flee | down | dead | fight
      target: null, speed: 1.1 + rng() * 0.9, phase: rng() * 9,
      heading: rng() * Math.PI * 2, downTimer: 0, home: pos.clone(),
    };
    peds.push(ped);
    return ped;
  }

  for (let i = 0; i < CROWD_COUNT; i++) {
    const p = city.randomSidewalkPoint();
    makePed(new THREE.Vector3(p.x, 0.36, p.z));
  }

  function pickWalkTarget(ped) {
    const p = city.randomSidewalkPoint();
    ped.target = new THREE.Vector3(p.x, 0.36, p.z);
  }

  function scare(pos, radius, sourcePos) {
    for (const ped of peds) {
      if (ped.state === 'down' || ped.state === 'dead' || ped.rival) continue;
      if (ped.mesh.position.distanceTo(pos) < radius) {
        ped.state = 'flee';
        ped.fleeFrom = sourcePos ? sourcePos.clone() : pos.clone();
        ped.fleeTimer = 2.5 + rng() * 2;
      }
    }
  }

  function knockDown(ped, lethal) {
    if (ped.state === 'dead') return;
    ped.state = lethal ? 'dead' : 'down';
    ped.downTimer = lethal ? 1e9 : 5 + rng() * 4;
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.y = 0.25;
  }

  function update(dt, danger) {
    for (const ped of peds) {
      const pos = ped.mesh.position;
      if (ped.state === 'dead') continue;
      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.state = 'flee'; ped.fleeTimer = 3;
          ped.fleeFrom = pos.clone().add(new THREE.Vector3(1, 0, 0));
          ped.mesh.rotation.x = 0; pos.y = 0.36; ped.health = Math.max(30, ped.health);
        }
        continue;
      }
      if (ped.state === 'fight') continue; // combat.js steers fighting rivals
      let speed = ped.speed;
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const away = pos.clone().sub(ped.fleeFrom || pos); away.y = 0;
        if (away.lengthSq() < 0.01) away.set(1, 0, 0); away.normalize();
        ped.target = pos.clone().add(away.multiplyScalar(10));
        speed = 4.6;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else if (!ped.target || pos.distanceTo(ped.target) < 1.2) pickWalkTarget(ped);
      if (danger && danger.pos && pos.distanceTo(danger.pos) < 7 && danger.level > 0.6) {
        ped.state = 'flee'; ped.fleeTimer = 1.6; ped.fleeFrom = danger.pos.clone();
      }
      if (ped.target) {
        const dx = ped.target.x - pos.x, dz = ped.target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          const want = Math.atan2(dx, dz);
          let diff = want - ped.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          ped.heading += THREE.MathUtils.clamp(diff, -4 * dt, 4 * dt);
          pos.x += Math.sin(ped.heading) * speed * dt;
          pos.z += Math.cos(ped.heading) * speed * dt;
          city.collide(pos, 0.42);
          pos.y = 0.36;
          ped.phase += dt * speed * 3.4;
          animateWalk(ped.mesh, ped.phase, 1);
        }
      }
      ped.mesh.rotation.y = ped.heading;
      // Keep the crowd near the player so the streets always feel lived in.
      if (danger && danger.pos && pos.distanceTo(danger.pos) > 300) {
        const p = city.randomSidewalkPoint();
        pos.set(p.x, 0.36, p.z); ped.target = null;
      }
    }
  }

  return { group, peds, makePed, scare, knockDown, update };
}
