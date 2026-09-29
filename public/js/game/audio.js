/** Procedural WebAudio sound effects — no asset files required. */
const PROFILES = {
  pistol: { dur: 0.16, freq: 2400, q: 0.8, thump: 140, gain: 0.55, tail: 0.25 },
  revolver: { dur: 0.22, freq: 1800, q: 0.7, thump: 90, gain: 0.7, tail: 0.4 },
  autorifle: { dur: 0.14, freq: 1600, q: 0.7, thump: 110, gain: 0.6, tail: 0.3 },
  goldar: { dur: 0.13, freq: 1700, q: 0.7, thump: 115, gain: 0.62, tail: 0.28 },
  machinegun: { dur: 0.16, freq: 1100, q: 0.6, thump: 85, gain: 0.7, tail: 0.35 },
  smg: { dur: 0.1, freq: 2100, q: 0.75, thump: 150, gain: 0.5, tail: 0.2 },
  vector: { dur: 0.08, freq: 2300, q: 0.8, thump: 160, gain: 0.48, tail: 0.18 },
  shotgun: { dur: 0.28, freq: 700, q: 0.45, thump: 55, gain: 0.95, tail: 0.7 },
  sniper: { dur: 0.45, freq: 900, q: 0.5, thump: 60, gain: 1.0, tail: 1.2 },
  dmr: { dur: 0.22, freq: 1200, q: 0.55, thump: 80, gain: 0.8, tail: 0.55 },
  antimaterial: { dur: 0.55, freq: 650, q: 0.4, thump: 40, gain: 1.15, tail: 1.5 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  out(vol = 1, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  noiseBurst(dest, t, dur, freq, q, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(env).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(dest, t, freq, dur, type = 'sine', vol = 1, endFreq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** distance in metres (0 = local player), pan -1..1 */
  shot(weapon, distance = 0, pan = 0) {
    if (!this.ensure()) return;
    const p = PROFILES[weapon] || PROFILES.pistol;
    const att = distance <= 0 ? 1 : Math.max(0.03, 1 / (1 + distance * 0.06));
    const far = Math.min(1, distance / 60);
    const t = this.ctx.currentTime;
    const dest = this.out(p.gain * att, pan * 0.8);
    this.noiseBurst(dest, t, p.dur, p.freq * (1 - far * 0.6), p.q);
    this.noiseBurst(dest, t, p.tail, 500 * (1 - far * 0.5), 0.4, 'lowpass');
    this.tone(dest, t, p.thump, 0.12 + p.tail * 0.2, 'triangle', 0.9, p.thump * 0.4);
  }

  reload(weapon) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.35);
    const len = weapon === 'machinegun' ? 1.6 : weapon === 'sniper' ? 1.1 : 0.6;
    this.noiseBurst(d, t + 0.05, 0.05, 3000, 3);
    this.noiseBurst(d, t + len * 0.5, 0.06, 2200, 3);
    this.noiseBurst(d, t + len, 0.07, 4000, 4);
  }

  click() {
    if (!this.ensure()) return;
    this.noiseBurst(this.out(0.3), this.ctx.currentTime, 0.03, 5000, 5);
  }

  hit(head = false, kill = false) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.35);
    this.tone(d, t, head ? 1900 : 1300, 0.06, 'square', 0.3);
    if (kill) this.tone(d, t + 0.05, 700, 0.18, 'triangle', 0.6, 400);
  }

  hurt() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.5);
    this.tone(d, t, 90, 0.2, 'sine', 1, 50);
    this.noiseBurst(d, t, 0.1, 400, 1, 'lowpass');
  }

  step(vol = 0.12) {
    if (!this.ensure()) return;
    this.noiseBurst(this.out(vol), this.ctx.currentTime, 0.07, 300 + Math.random() * 200, 1.2, 'lowpass');
  }

  ui() {
    if (!this.ensure()) return;
    this.tone(this.out(0.15), this.ctx.currentTime, 880, 0.05, 'sine', 0.4);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  explosion(distance = 0, pan = 0, big = false) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const att = Math.max(0.05, 1 / (1 + distance * 0.045));
    const far = Math.min(1, distance / 80);
    const d = this.out((big ? 1.2 : 1) * att, pan * 0.7);
    this.noiseBurst(d, t, big ? 1.9 : 1.4, 380 * (1 - far * 0.5), 0.5, 'lowpass');
    this.noiseBurst(d, t, 0.35, 1600 * (1 - far * 0.7), 0.6);
    this.tone(d, t, big ? 70 : 90, big ? 1.1 : 0.8, 'sine', 1.2, 28);
    this.noiseBurst(d, t + 0.08, 0.9, 220, 0.8, 'lowpass');
  }

  knife(hit) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.45);
    this.noiseBurst(d, t, 0.16, 2600, 1.4, 'highpass');
    if (hit) { this.tone(d, t + 0.08, 160, 0.12, 'triangle', 0.9, 70); this.noiseBurst(d, t + 0.08, 0.1, 500, 1, 'lowpass'); }
  }

  throwWhoosh() {
    if (!this.ensure()) return;
    this.noiseBurst(this.out(0.3), this.ctx.currentTime, 0.22, 1400, 0.9);
  }

  bounce(distance = 0) {
    if (!this.ensure()) return;
    const att = Math.max(0.05, 1 / (1 + distance * 0.15));
    const t = this.ctx.currentTime;
    const d = this.out(0.35 * att);
    this.tone(d, t, 1200 + Math.random() * 500, 0.05, 'square', 0.25);
    this.noiseBurst(d, t, 0.04, 3000, 2);
  }

  jet(duration = 3) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + duration * 0.5);
    f.frequency.exponentialRampToValueAtTime(300, t + duration);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.001, t);
    env.gain.exponentialRampToValueAtTime(1.1, t + duration * 0.5);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(env).connect(this.out(0.9));
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  radio() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.3);
    this.tone(d, t, 1320, 0.07, 'square', 0.3);
    this.tone(d, t + 0.1, 1760, 0.09, 'square', 0.3);
  }

  chat() {
    if (!this.ensure()) return;
    this.tone(this.out(0.12), this.ctx.currentTime, 1050, 0.05, 'sine', 0.5);
  }

  rocketLaunch(distance = 0, pan = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(Math.max(0.08, 1 / (1 + distance * 0.05)), pan * 0.7);
    this.noiseBurst(d, t, 0.25, 700, 0.6, 'lowpass');
    this.tone(d, t, 120, 0.3, 'triangle', 0.8, 45);
    this.noiseBurst(d, t + 0.03, 1.1, 1800, 0.5);
  }

  shatter(distance = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.5 * Math.max(0.08, 1 / (1 + distance * 0.08)));
    this.noiseBurst(d, t, 0.18, 5200, 3, 'highpass');
    this.noiseBurst(d, t + 0.02, 0.6, 600, 0.6, 'lowpass');
    this.tone(d, t + 0.05, 180, 0.5, 'sine', 0.6, 60);
  }

  crackle(distance = 0) {
    if (!this.ensure()) return;
    const d = this.out(0.18 * Math.max(0.05, 1 / (1 + distance * 0.15)));
    this.noiseBurst(d, this.ctx.currentTime, 0.05 + Math.random() * 0.06, 1400 + Math.random() * 2000, 2.5);
  }
}

export const audio = new Audio();
