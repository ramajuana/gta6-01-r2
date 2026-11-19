// audio.js — every sound in Solmar Bay is synthesised live with WebAudio:
// the engine under Lena's right foot, two-tone sirens, gunshots, pickups,
// mission jingles and a slow synthwave loop for the streets. No audio files.

export function createAudio() {
  let ctx = null, master = null, muted = false;
  let engineNodes = null, sirenNodes = null, sirenFlip = false, sirenTimer = 0;
  let musicTimer = 0, musicStep = 0;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, { vol = 0.3, freq = 1800, delay = 0 } = {}) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, (dur * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  function shot(distant = false) {
    noise(0.16, { vol: distant ? 0.10 : 0.32, freq: distant ? 900 : 2400 });
    tone(150, 0.1, { type: 'square', vol: distant ? 0.04 : 0.12, slide: -90 });
  }
  function thud() { tone(110, 0.12, { type: 'sine', vol: 0.3, slide: -50 }); noise(0.06, { vol: 0.12, freq: 700 }); }
  function pickup() { tone(660, 0.09, { type: 'sine', vol: 0.18 }); tone(990, 0.14, { type: 'sine', vol: 0.18, delay: 0.07 }); }
  function missionDone() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.11 })); }
  function click() { tone(1200, 0.04, { type: 'square', vol: 0.06 }); }
  function bustedSting() { tone(392, 0.3, { type: 'sawtooth', vol: 0.16 }); tone(311, 0.5, { type: 'sawtooth', vol: 0.16, delay: 0.25 }); }

  function setEngine(on, speed01 = 0) {
    if (!ensure()) return;
    if (on && !engineNodes) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square';
      f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0.0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      o1.start(); o2.start();
      engineNodes = { o1, o2, f, g };
    }
    if (engineNodes) {
      const n = engineNodes, t = ctx.currentTime;
      if (!on) { n.g.gain.setTargetAtTime(0, t, 0.08); return; }
      const rpm = 55 + speed01 * 165;
      n.o1.frequency.setTargetAtTime(rpm, t, 0.05);
      n.o2.frequency.setTargetAtTime(rpm * 1.5 + 3, t, 0.05);
      n.f.frequency.setTargetAtTime(320 + speed01 * 900, t, 0.05);
      n.g.gain.setTargetAtTime(0.05 + speed01 * 0.075, t, 0.06);
    }
  }

  function setSiren(on) {
    if (!ensure()) return;
    if (on && !sirenNodes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 720; g.gain.value = 0.028;
      o.connect(g); g.connect(master); o.start();
      sirenNodes = { o, g };
    } else if (!on && sirenNodes) {
      sirenNodes.o.stop(); sirenNodes = null;
    }
  }

  // A lazy synthwave figure: Am – F – C – G, bass pulse under a soft arp.
  const BASS = [55, 43.65, 32.7, 49];
  const ARP = [220, 261.6, 329.6, 174.6, 220, 261.6, 130.8, 164.8, 196, 246.9, 196, 146.8, 196, 293.7];
  function update(dt, driving) {
    if (!ctx) return;
    if (sirenNodes) {
      sirenTimer -= dt;
      if (sirenTimer <= 0) {
        sirenFlip = !sirenFlip; sirenTimer = 0.38;
        sirenNodes.o.frequency.setTargetAtTime(sirenFlip ? 950 : 700, ctx.currentTime, 0.03);
      }
    }
    musicTimer -= dt;
    if (musicTimer <= 0) {
      musicTimer = 0.46;
      const bar = (musicStep >> 2) % 4, beat = musicStep % 4;
      if (beat === 0) tone(BASS[bar], 1.6, { type: 'triangle', vol: 0.10 });
      tone(ARP[musicStep % ARP.length], 0.34, { type: 'sine', vol: driving ? 0.045 : 0.065 });
      musicStep++;
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return { ensure, shot, thud, pickup, missionDone, click, bustedSting, setEngine, setSiren, update, toggleMute };
}
