// missions.js — Lena Ortiz's story: six jobs that take her from broke
// runaway to the driver every crew in Solmar Bay calls. Each mission is a
// list of steps; this module walks the steps, plants the gold beacon, and
// tells the HUD what the current objective is.

import * as THREE from 'three';

const L = (name, x, z) => ({ name, x, z });
const SPOTS = {
  garage: L('Ortiz Garage', -72, 72),
  pier: L('Solmar Pier', -226, 0),
  casino: L('Coral Casino', 72, 72),
  downtown: L('Downtown Solmar', 0, 0),
  lighthouse: L('Harbor Lighthouse', -214, -188),
  palmCourt: L('Palm Court', 24, 120),
  hotel: L('Neon Palms Hotel', -24, 24),
  mall: L('Sunset Mall', 120, -72),
};

export const MISSION_DEFS = [
  {
    id: 'homecoming', title: 'Homecoming', reward: 300,
    intro: [['Lena', 'Uncle Ray kept the garage. Barely. Time to see what is left of it.']],
    steps: [
      { type: 'goto', text: 'Go to Ortiz Garage', target: SPOTS.garage, radius: 9 },
      { type: 'steal', text: 'Steal a car — any car. Ray needs wheels to move.',
        say: [['Ray', 'Lena! You came back. The Syndicate wants this garage, so I need a car they cannot trace. Bring me anything with four wheels.']] },
      { type: 'deliver', text: 'Deliver the car to Ortiz Garage', target: SPOTS.garage, radius: 10 },
    ],
    outro: [['Ray', 'She runs. Barely legal, fully ours. There is work all over this bay for a driver like you.']],
  },
  {
    id: 'package-run', title: 'Package Run', reward: 450,
    intro: [['Ray', 'A package washed up at the pier. The Casino pays cash, no questions. Move.']],
    steps: [
      { type: 'goto', text: 'Pick up the package at Solmar Pier', target: SPOTS.pier, radius: 7 },
      { type: 'goto', text: 'Deliver the package to the Coral Casino', target: SPOTS.casino, radius: 10, timer: 170 },
    ],
    outro: [['Lena', 'Cash in hand, salt in the air. This city pays the bold.']],
  },
  {
    id: 'heat-check', title: 'Heat Check', reward: 600,
    intro: [['Ray', 'Cops have been circling the garage all week. Draw them off, lose them, and lie low at the lighthouse.']],
    steps: [
      { type: 'gotoCar', text: 'Drive through Downtown and make some noise', target: SPOTS.downtown, radius: 16 },
      { type: 'escape', text: 'Lose the police, then reach the Harbor Lighthouse', target: SPOTS.lighthouse, radius: 12 },
    ],
    outro: [['Lena', 'Gone like a rumour. The bay is big when you know its corners.']],
  },
  {
    id: 'syndicate-tax', title: 'Syndicate Tax', reward: 750,
    intro: [['Ray', 'The Coral Syndicate is collecting "tax" at Palm Court. Three of their collectors. Send them home empty.']],
    steps: [
      { type: 'fight', text: 'Take down the Syndicate collectors at Palm Court', target: SPOTS.palmCourt, radius: 30, count: 3 },
    ],
    outro: [['Lena', 'Palm Court is free again. Word travels fast in Solmar Bay.']],
  },
  {
    id: 'night-deposit', title: 'Night Deposit', reward: 900,
    intro: [['Ray', 'Three friends owe the garage. Collect in person: the casino dock, the mall bay, the pier kiosk. On foot, stay at each door until they pay.']],
    steps: [
      { type: 'collect', text: 'Collect at the Coral Casino dock door', target: SPOTS.casino, radius: 6, hold: 2.5 },
      { type: 'collect', text: 'Collect at the Sunset Mall loading bay', target: SPOTS.mall, radius: 6, hold: 2.5 },
      { type: 'collect', text: 'Collect at the Solmar Pier kiosk', target: SPOTS.pier, radius: 6, hold: 2.5 },
    ],
    outro: [['Ray', 'Every debt paid. The garage breathes again, Lena.']],
  },
  {
    id: 'sunset-getaway', title: 'Sunset Getaway', reward: 1500,
    intro: [['Lena', 'My sister Mara is done running tables at the Neon Palms. Tonight we both leave the Syndicate behind.']],
    steps: [
      { type: 'goto', text: 'Pick up Mara at the Neon Palms Hotel', target: SPOTS.hotel, radius: 9,
        say: [['Mara', 'Lena? You actually came. The whole bay will be after us — drive like you mean it.']] },
      { type: 'deliver', text: 'Get Mara to the Harbor Lighthouse — lose the heat on the way', target: SPOTS.lighthouse, radius: 12, timer: 240, heat: 4 },
    ],
    outro: [['Mara', 'We made it. Solmar Bay is ours now — every street of it.']],
  },
];

export function createMissions(game) {
  const { scene, hud, audio } = game;
  let nextIndex = 0;          // the mission the player is on
  let active = null;          // { def, stepIdx, step, timerLeft, spawned }
  let completedAll = false;

  // The gold beacon of light on the current objective.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.7, 70, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd94d, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  beacon.position.y = 35; beacon.visible = false; scene.add(beacon);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.1, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; ring.visible = false; scene.add(ring);

  function say(lines) {
    if (!lines) return;
    let delay = 0;
    for (const [who, text] of lines) {
      setTimeout(() => hud.showSubtitle(who, text), delay);
      delay += Math.max(2600, text.length * 55);
    }
  }

  function startMission(i) {
    nextIndex = i;
    const def = MISSION_DEFS[i];
    active = { def, stepIdx: 0, timerLeft: null, spawned: false, holdProgress: 0 };
    say(def.intro);
    armStep();
  }

  function armStep() {
    const step = active.def.steps[active.stepIdx];
    active.timerLeft = step.timer ?? null;
    active.spawned = false; active.holdProgress = 0;
    if (step.say) say(step.say);
    if (step.heat) game.police.setHeat(step.heat * 100 + 20);
  }

  function completeStep() {
    audio.pickup();
    active.stepIdx++;
    if (active.stepIdx >= active.def.steps.length) completeMission();
    else armStep();
  }

  function completeMission() {
    const def = active.def;
    game.addMoney(def.reward);
    hud.showToast('Mission complete', `${def.title} — +$${def.reward}`);
    audio.missionDone();
    say(def.outro);
    active = null;
    if (nextIndex + 1 < MISSION_DEFS.length) startMission(nextIndex + 1);
    else { completedAll = true; game.onStoryComplete(); }
  }

  function restartMission() {
    if (active) { const i = nextIndex; active = null; startMission(i); }
  }

  function currentTarget() {
    if (!active) return null;
    const step = active.def.steps[active.stepIdx];
    return step.target ?? null;
  }

  function notify(event, data) {
    if (!active) return;
    const step = active.def.steps[active.stepIdx];
    if (event === 'enterCar' && step.type === 'steal' && data.stolen) completeStep();
  }

  function update(dt) {
    const target = currentTarget();
    beacon.visible = ring.visible = !!target && !!active;
    if (target) {
      beacon.position.x = target.x; beacon.position.z = target.z;
      ring.position.x = target.x; ring.position.z = target.z;
      ring.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.12);
    }
    if (!active) return;
    const step = active.def.steps[active.stepIdx];
    const p = game.player.pos;
    if (active.timerLeft !== null) {
      active.timerLeft -= dt;
      if (active.timerLeft <= 0) {
        hud.showToast('Mission failed', 'Out of time — the job resets.');
        restartMission();
        return;
      }
    }
    const dist = step.target ? Math.hypot(p.x - step.target.x, p.z - step.target.z) : 0;
    switch (step.type) {
      case 'goto':
        if (dist < step.radius) completeStep();
        break;
      case 'gotoCar':
        if (game.player.inCar && dist < step.radius) {
          // Lena makes her noise: the whole downtown precinct answers.
          game.police.setHeat(230);
          completeStep();
        }
        break;
      case 'deliver':
        if (game.player.inCar && dist < step.radius) completeStep();
        break;
      case 'escape':
        if (dist < step.radius && game.police.stars() === 0) completeStep();
        break;
      case 'collect': {
        const still = !game.player.inCar && Math.hypot(game.player.vel.x, game.player.vel.z) < 0.6;
        if (dist < step.radius && still) {
          active.holdProgress += dt;
          hud.setPrompt(`Collecting… ${Math.min(100, Math.round(active.holdProgress / step.hold * 100))}%`);
          if (active.holdProgress >= step.hold) { hud.setPrompt(null); completeStep(); }
        } else active.holdProgress = Math.max(0, active.holdProgress - dt);
        break;
      }
      case 'fight': {
        if (!active.spawned && dist < 48) {
          active.spawned = true;
          active.rivals = [];
          for (let i = 0; i < step.count; i++) {
            const a = (i / step.count) * Math.PI * 2;
            const ped = game.crowd.makePed(new THREE.Vector3(
              step.target.x + Math.sin(a) * 9, 0.36, step.target.z + Math.cos(a) * 9),
              { rival: true, shirt: 0x8d0801, health: 100 });
            ped.state = 'fight';
            active.rivals.push(ped);
          }
          say([['Collector', 'Wrong court, Ortiz. Walk away or fall down.']]);
        }
        if (active.spawned && active.rivals.every(r => r.state === 'dead' || r.state === 'down')) completeStep();
        break;
      }
    }
  }

  function objective() {
    if (completedAll) return { name: 'Story complete', text: 'Solmar Bay is yours. Free roam — the city never sleeps.', target: null, dist: 0, timer: null };
    if (!active) return { name: 'Free roam', text: 'Explore Solmar Bay', target: null, dist: 0, timer: null };
    const step = active.def.steps[active.stepIdx];
    const t = currentTarget();
    const dist = t ? Math.hypot(game.player.pos.x - t.x, game.player.pos.z - t.z) : 0;
    let text = step.text;
    if (step.type === 'escape' && game.police.stars() > 0) text = `Lose the police (${game.police.stars()}★) — then reach the lighthouse`;
    return { name: active.def.title, text, target: t, dist, timer: active.timerLeft };
  }

  return {
    update, notify, objective, restartMission,
    start: () => { if (!active && !completedAll) startMission(nextIndex); },
    setProgress(i) { nextIndex = i; completedAll = i >= MISSION_DEFS.length; if (!completedAll) startMission(i); },
    index: () => nextIndex,
    completedAll: () => completedAll,
    activeDef: () => active?.def ?? null,
  };
}
