// hud.js — everything drawn over the 3D world: money, health, wanted stars,
// the objective banner, prompts, subtitles, toasts, the speedometer and the
// canvas minimap that keeps Lena oriented in Solmar Bay.

export function createHud() {
  const el = id => document.getElementById(id);
  const root = el('hud'), money = el('hud-money'), health = el('hud-health'),
    stars = el('hud-stars'), clock = el('hud-clock'), zone = el('hud-zone'),
    objBox = el('hud-objective'), objMission = objBox.querySelector('.mission'),
    objText = objBox.querySelector('.text'), objDist = objBox.querySelector('.dist'),
    timer = el('hud-timer'), prompt = el('hud-prompt'), subtitle = el('hud-subtitle'),
    toast = el('hud-toast'), speed = el('hud-speed'), crosshair = el('crosshair'),
    mapCanvas = el('minimap');
  const mapCtx = mapCanvas.getContext('2d');
  let subtitleTimer = null, toastTimer = null;

  function showSubtitle(who, text) {
    subtitle.innerHTML = `<span class="who">${who}:</span> ${text}`;
    subtitle.style.display = 'block';
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => { subtitle.style.display = 'none'; }, Math.max(2800, text.length * 55));
  }

  function showToast(title, sub) {
    toast.innerHTML = `${title}${sub ? `<div class="sub">${sub}</div>` : ''}`;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }

  function setObjective(o) {
    if (!o) { objBox.style.display = 'none'; return; }
    objBox.style.display = 'block';
    objMission.textContent = o.name;
    objText.textContent = o.text;
    objDist.textContent = o.target ? `${Math.round(o.dist)} m` : '';
    if (o.timer !== null && o.timer !== undefined) {
      timer.style.display = 'block';
      const t = Math.max(0, o.timer);
      timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      timer.style.color = t < 20 ? '#ff5f6d' : '#ffb3b3';
    } else timer.style.display = 'none';
  }

  function drawMinimap(view) {
    const { playerPos, heading, city, policeUnits, cars, target, timeMs } = view;
    const S = 190, C = S / 2, scale = S / 340; // 340 world units across
    const px = x => C + (x - playerPos.x) * scale;
    const pz = z => C + (z - playerPos.z) * scale;
    mapCtx.clearRect(0, 0, S, S);
    mapCtx.save();
    mapCtx.beginPath(); mapCtx.arc(C, C, C - 2, 0, Math.PI * 2); mapCtx.clip();
    mapCtx.fillStyle = '#232a33'; mapCtx.fillRect(0, 0, S, S);
    // Sea to the west.
    mapCtx.fillStyle = '#14425e';
    mapCtx.fillRect(0, 0, Math.max(0, px(-214)), S);
    mapCtx.fillStyle = '#c9ae76';
    const sandX = px(-214);
    if (sandX > 0) mapCtx.fillRect(Math.max(0, px(-238)), 0, Math.min(S, sandX) - Math.max(0, px(-238)), S);
    // Blocks.
    mapCtx.fillStyle = '#39424e';
    for (let bx = -4; bx < 4; bx++) for (let bz = -4; bz < 4; bz++) {
      const x = px((bx + 0.5) * 48 - 16), y = pz((bz + 0.5) * 48 - 16);
      if (x > -20 && y > -20 && x < S + 20 && y < S + 20) mapCtx.fillRect(x, y, 32 * scale, 32 * scale);
    }
    // Roads.
    mapCtx.strokeStyle = '#59636f'; mapCtx.lineWidth = Math.max(2, 16 * scale);
    for (let i = -4; i <= 4; i++) {
      mapCtx.beginPath(); mapCtx.moveTo(px(i * 48), 0); mapCtx.lineTo(px(i * 48), S); mapCtx.stroke();
      mapCtx.beginPath(); mapCtx.moveTo(0, pz(i * 48)); mapCtx.lineTo(S, pz(i * 48)); mapCtx.stroke();
    }
    // Landmarks.
    mapCtx.fillStyle = '#ffd94d';
    for (const l of city.landmarks) {
      const x = px(l.x), y = pz(l.z);
      if (x < -6 || y < -6 || x > S + 6 || y > S + 6) continue;
      mapCtx.fillRect(x - 2, y - 2, 4, 4);
    }
    // Traffic.
    mapCtx.fillStyle = '#aab4c0';
    for (const car of cars) {
      const x = px(car.mesh.position.x), y = pz(car.mesh.position.z);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      mapCtx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // Police — flashing blue/red.
    for (const u of policeUnits) {
      const x = px(u.mesh.position.x), y = pz(u.mesh.position.z);
      if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue;
      mapCtx.fillStyle = Math.sin(timeMs * 0.012) > 0 ? '#3d8bff' : '#ff4040';
      mapCtx.beginPath(); mapCtx.arc(x, y, 3.4, 0, Math.PI * 2); mapCtx.fill();
    }
    // Mission target — a pulsing gold ring.
    if (target) {
      const x = px(target.x), y = pz(target.z);
      const r = 6 + Math.sin(timeMs * 0.006) * 2;
      mapCtx.strokeStyle = '#ffd94d'; mapCtx.lineWidth = 2.4;
      mapCtx.beginPath(); mapCtx.arc(x, y, r, 0, Math.PI * 2); mapCtx.stroke();
      mapCtx.fillStyle = '#ffd94d';
      mapCtx.beginPath(); mapCtx.arc(x, y, 2.4, 0, Math.PI * 2); mapCtx.fill();
    }
    // Player arrow. Heading 0 faces +z (south, down-map), so the up-drawn
    // arrow turns by PI - heading to point the way Lena faces.
    mapCtx.translate(C, C); mapCtx.rotate(Math.PI - heading);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -8); mapCtx.lineTo(5.4, 6); mapCtx.lineTo(0, 3); mapCtx.lineTo(-5.4, 6);
    mapCtx.closePath(); mapCtx.fill();
    mapCtx.restore();
  }

  return {
    show: () => { root.style.display = 'block'; },
    hide: () => { root.style.display = 'none'; },
    setMoney: n => { money.textContent = '$' + Math.max(0, Math.round(n)).toLocaleString('en-US'); },
    setHealth: v => { health.style.width = `${Math.max(0, Math.min(100, v))}%`; },
    setStars: n => {
      stars.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
    },
    setClock(hours, zoneName) {
      const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
      clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      zone.textContent = zoneName;
    },
    setObjective, drawMinimap, showSubtitle, showToast,
    setPrompt(html) {
      if (!html) { prompt.style.display = 'none'; return; }
      prompt.innerHTML = html; prompt.style.display = 'block';
    },
    setSpeed(kmh) {
      if (kmh === null) { speed.style.display = 'none'; return; }
      speed.style.display = 'block';
      speed.querySelector('.num').textContent = Math.round(Math.abs(kmh));
    },
    setCrosshair: on => { crosshair.style.display = on ? 'block' : 'none'; },
  };
}
