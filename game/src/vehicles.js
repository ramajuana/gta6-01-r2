// vehicles.js — every car in Solmar Bay: how a car looks, the traffic that
// drives itself around the grid, the parked cars waiting to be stolen, and
// the arcade driving physics the player uses once they are behind a wheel.

import * as THREE from 'three';
import { WORLD, mulberry32 } from './city.js';

const rng = mulberry32(777001);
export const CAR_COLORS = [0xd8404f, 0x2e7fd9, 0xf2b134, 0x39b56b, 0xe8e6df, 0x30343c,
  0x8e5bd6, 0xff7d3c, 0x2fb3a6, 0xc0c6ce, 0x7a4a2b, 0xe56aa0];
const glassMat = new THREE.MeshPhongMaterial({ color: 0x18242f, shininess: 90 });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
const chromeMat = new THREE.MeshPhongMaterial({ color: 0xb9c2cc, shininess: 120 });

export function buildCarMesh(color, opts = {}) {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhongMaterial({ color, shininess: 70 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.58, 4.35), paint);
  body.position.y = 0.58; body.castShadow = true; car.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.3, 0.7), paint);
  nose.position.set(0, 0.44, 2.2); car.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.52, 2.1), glassMat);
  cabin.position.set(0, 1.1, -0.25); cabin.castShadow = true; car.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 12);
  const wheels = [];
  for (const [x, z] of [[-0.98, 1.42], [0.98, 1.42], [-0.98, -1.42], [0.98, -1.42]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.37, z); car.add(w); wheels.push(w);
  }
  const lightGeo = new THREE.BoxGeometry(0.42, 0.14, 0.06);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6cf });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(lightGeo, headMat); h.position.set(x, 0.62, 2.56); car.add(h);
    const t = new THREE.Mesh(lightGeo, tailMat); t.position.set(x, 0.66, -2.19); car.add(t);
  }
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.2, 0.18), chromeMat);
  bumperF.position.set(0, 0.3, 2.3); car.add(bumperF);
  const bumperB = bumperF.clone(); bumperB.position.z = -2.3; car.add(bumperB);
  car.userData.wheels = wheels;
  if (opts.police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.2, 4.0),
      new THREE.MeshLambertMaterial({ color: 0x14213d }));
    stripe.position.y = 0.6; car.add(stripe);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x22262c }));
    barBase.position.set(0, 1.42, -0.25); car.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
    red.position.set(-0.28, 1.54, -0.25); car.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x2d6bff }));
    blue.position.set(0.28, 1.54, -0.25); car.add(blue);
    car.userData.lightBar = { red, blue };
    const badge = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.34, 2.6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    badge.position.y = 0.92; badge.scale.set(0.99, 1, 0.99); car.add(badge);
  }
  return car;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const TRAFFIC_COUNT = 15;
const PARKED_COUNT = 20;

export function createVehicleFleet(scene, city) {
  const group = new THREE.Group(); scene.add(group);
  const traffic = [];
  const parked = [];
  const tmpV = new THREE.Vector3();

  function lanePoint(axis, street, dir, along) {
    // Right-hand traffic: your lane sits to the right of the street centre.
    const off = 3.7;
    if (axis === 'z') return { x: street + (dir > 0 ? off : -off), z: along };
    return { x: along, z: street + (dir > 0 ? -off : off) };
  }

  function spawnTrafficCar(nearPos) {
    const mesh = buildCarMesh(CAR_COLORS[(rng() * CAR_COLORS.length) | 0]);
    group.add(mesh);
    const axis = rng() < 0.5 ? 'z' : 'x';
    const street = (Math.floor(rng() * 9) - WORLD.GRID) * WORLD.PITCH;
    const dir = rng() < 0.5 ? 1 : -1;
    let along = (rng() * 2 - 1) * (WORLD.EXTENT - 10);
    if (nearPos) { // keep fresh spawns out of the player's face
      const p = lanePoint(axis, street, dir, along);
      if (Math.hypot(p.x - nearPos.x, p.z - nearPos.z) < 60) along = -along;
    }
    const p = lanePoint(axis, street, dir, along);
    mesh.position.set(p.x, 0, p.z);
    const car = {
      mesh, kind: 'traffic', axis, street, dir, along,
      heading: axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      speed: 0, cruise: 10 + rng() * 5, health: 100, turning: null,
    };
    mesh.rotation.y = car.heading;
    traffic.push(car);
    return car;
  }

  function spawnParkedCar() {
    const mesh = buildCarMesh(CAR_COLORS[(rng() * CAR_COLORS.length) | 0]);
    group.add(mesh);
    const vertical = rng() < 0.5;
    const street = (Math.floor(rng() * 9) - WORLD.GRID) * WORLD.PITCH;
    const along = (rng() * 2 - 1) * (WORLD.EXTENT - 16);
    const side = rng() < 0.5 ? 6.6 : -6.6;
    if (vertical) mesh.position.set(street + side, 0, along);
    else mesh.position.set(along, 0, street + side);
    const heading = vertical ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    mesh.rotation.y = heading;
    const car = { mesh, kind: 'parked', heading, speed: 0, health: 100, parkedVertical: vertical };
    parked.push(car);
    return car;
  }

  for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTrafficCar(null);
  for (let i = 0; i < PARKED_COUNT; i++) spawnParkedCar();

  function obstacleAhead(car, playerPos) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let nearest = Infinity;
    const test = (ox, oz, r) => {
      const dx = ox - car.mesh.position.x, dz = oz - car.mesh.position.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 9 && side < 2.1 + r) nearest = Math.min(nearest, ahead);
    };
    for (const o of traffic) if (o !== car) test(o.mesh.position.x, o.mesh.position.z, 1);
    for (const o of parked) test(o.mesh.position.x, o.mesh.position.z, 1);
    if (playerPos) test(playerPos.x, playerPos.z, 0.6);
    return nearest;
  }

  function updateTraffic(dt, playerPos) {
    for (const car of traffic) {
      const pos = car.mesh.position;
      // Choose where this car is heading: the next intersection, then beyond it.
      if (!car.turning) {
        const next = (Math.round(car.along / WORLD.PITCH) + (car.dir > 0 ? 1 : -1)) * WORLD.PITCH;
        car.targetAlong = next;
        if (Math.abs(car.along - next) < 7) {
          const crossStreet = next;
          const choice = rng();
          let nAxis = car.axis, nDir = car.dir;
          if (choice < 0.32) { nAxis = car.axis === 'z' ? 'x' : 'z'; nDir = rng() < 0.5 ? 1 : -1; }
          else if (choice < 0.45) { nDir = -car.dir; }
          car.turning = { axis: nAxis, dir: nDir, street: crossStreet, fromAxis: car.axis, fromStreet: car.street };
        }
      }
      let target;
      if (car.turning) {
        const t = car.turning;
        // Aim out of the intersection along the new street's lane.
        const alongNew = (t.axis === 'z' ? pos.z : pos.x) + t.dir * 26;
        const p = lanePoint(t.axis, t.axis === car.axis ? car.street : t.street, t.dir, alongNew);
        target = p;
        const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
        const aligned = Math.abs(wrapAngle(Math.atan2(p.x - pos.x, p.z - pos.z) - car.heading)) < 0.12;
        if (dist < 7 || (aligned && dist < 16)) {
          const newStreet = t.axis === car.axis ? car.street : t.street;
          car.axis = t.axis; car.dir = t.dir; car.street = newStreet;
          car.along = t.axis === 'z' ? pos.z : pos.x;
          car.turning = null;
        }
      } else {
        const ahead = car.along + car.dir * 30;
        target = lanePoint(car.axis, car.street, car.dir, ahead);
      }
      const desired = Math.atan2(target.x - pos.x, target.z - pos.z);
      const diff = wrapAngle(desired - car.heading);
      const turnRate = car.turning ? 1.5 : 0.7;
      car.heading += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);
      const blocked = obstacleAhead(car, playerPos);
      const want = blocked < 6 ? 0 : blocked < 10 ? car.cruise * 0.45 : car.cruise;
      car.speed += THREE.MathUtils.clamp(want - car.speed, -26 * dt, 7 * dt);
      pos.x += Math.sin(car.heading) * car.speed * dt;
      pos.z += Math.cos(car.heading) * car.speed * dt;
      car.along = car.axis === 'z' ? pos.z : pos.x;
      car.mesh.rotation.y = car.heading;
      spinWheels(car, dt);
      // Respawn far-away traffic near the action so the city never empties.
      if (playerPos && pos.distanceTo(playerPos) > 330) {
        const p = city.randomRoadPoint();
        pos.set(p.x, 0, p.z);
        car.axis = Math.abs(p.x % WORLD.PITCH) < 1 ? 'z' : 'x';
        car.street = car.axis === 'z' ? p.x : p.z;
        car.along = car.axis === 'z' ? p.z : p.x;
        car.dir = rng() < 0.5 ? 1 : -1;
        car.turning = null;
        const lp = lanePoint(car.axis, car.street, car.dir, car.along);
        pos.set(lp.x, 0, lp.z);
        car.heading = car.axis === 'z' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }

  function spinWheels(car, dt) {
    const w = car.mesh.userData.wheels;
    if (!w) return;
    const spin = (car.speed * dt) / 0.37;
    for (const wheel of w) wheel.rotation.x += spin;
  }

  // Arcade driving for the player's car. input: {throttle -1..1, steer -1..1, brake bool}
  function driveCar(car, input, dt) {
    const pos = car.mesh.position;
    const maxF = 37, maxR = 11;
    if (input.throttle > 0) car.speed += 21 * dt * input.throttle;
    else if (input.throttle < 0) car.speed -= (car.speed > 0.5 ? 30 : 9) * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 3.2 * dt);
    if (input.brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 34 * dt);
    car.speed *= (1 - 0.25 * dt);
    car.speed = THREE.MathUtils.clamp(car.speed, -maxR, maxF);
    const steerAuthority = THREE.MathUtils.clamp(Math.abs(car.speed) / 9, 0, 1) * Math.sign(car.speed);
    car.heading -= input.steer * 1.55 * steerAuthority * dt;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    pos.x += fx * car.speed * dt;
    pos.z += fz * car.speed * dt;
    // Collide as two circles, nose and tail, so the car slides along walls.
    for (const off of [1.45, -1.45]) {
      tmpV.set(pos.x + fx * off, 0, pos.z + fz * off);
      const before = tmpV.clone();
      city.collide(tmpV, 1.15);
      if (!tmpV.equals(before)) {
        pos.x += tmpV.x - before.x; pos.z += tmpV.z - before.z;
        if (Math.abs(car.speed) > 9) car.health -= 4;
        car.speed *= 0.55;
      }
    }
    car.mesh.rotation.y = car.heading;
    spinWheels(car, dt);
    return car.speed;
  }

  function nearestStealable(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const list of [parked, traffic])
      for (const car of list) {
        if (car.speed && Math.abs(car.speed) > 2) continue;
        const d = car.mesh.position.distanceTo(pos);
        if (d < bd) { bd = d; best = car; }
      }
    return best;
  }

  function claimCar(car) {
    let i = traffic.indexOf(car);
    if (i >= 0) { traffic.splice(i, 1); setTimeout(() => { if (traffic.length < TRAFFIC_COUNT) spawnTrafficCar(null); }, 4000); }
    i = parked.indexOf(car);
    if (i >= 0) parked.splice(i, 1);
    car.kind = 'player';
    return car;
  }

  function releaseCar(car) {
    car.kind = 'parked'; car.speed = 0;
    parked.push(car);
  }

  function allCars() { return [...traffic, ...parked]; }

  return {
    group, traffic, parked,
    update: updateTraffic,
    driveCar, nearestStealable, claimCar, releaseCar, allCars, buildCarMesh,
  };
}
