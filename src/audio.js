// Web Audio API ile sentetik retro pinball sesleri. Dosyasız, tamamı osilatör + gürültü.

const MUTE_KEY = 'tilt.muted';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  /** İlk kullanıcı etkileşiminde çağrılmalı (mobil autoplay politikası). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = !!muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* yoksay */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _tone({ freq = 440, end = null, dur = 0.08, type = 'square', vol = 0.5, when = 0 }) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.06, vol = 0.5, low = 800, high = 6000, when = 0 }) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (low + high) / 2;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
  }

  flipper() {
    this._noise({ dur: 0.05, vol: 0.35, low: 1500, high: 5000 });
    this._tone({ freq: 220, end: 90, dur: 0.07, type: 'triangle', vol: 0.4 });
  }

  bumper() {
    this._tone({ freq: 180, end: 60, dur: 0.12, type: 'sine', vol: 0.8 });
    this._noise({ dur: 0.05, vol: 0.4, low: 2000, high: 7000 });
  }

  sling() {
    this._tone({ freq: 320, end: 140, dur: 0.08, type: 'sawtooth', vol: 0.35 });
  }

  target() {
    this._tone({ freq: 660, end: 990, dur: 0.09, type: 'square', vol: 0.3 });
  }

  mansion() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.4, when: i * 0.09 }),
    );
  }

  launch(power = 0.5) {
    this._noise({ dur: 0.12, vol: 0.3 + power * 0.4, low: 500, high: 3000 });
    this._tone({ freq: 120, end: 400 + power * 500, dur: 0.18, type: 'sawtooth', vol: 0.3 });
  }

  drain() {
    this._tone({ freq: 300, end: 60, dur: 0.4, type: 'sawtooth', vol: 0.35 });
  }

  multiball() {
    [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.14, type: 'square', vol: 0.3, when: i * 0.1 }),
    );
  }

  thing() {
    this._tone({ freq: 90, end: 45, dur: 0.5, type: 'sine', vol: 0.6 });
    this._noise({ dur: 0.3, vol: 0.2, low: 300, high: 1200, when: 0.1 });
  }

  magnet() {
    this._tone({ freq: 1200, end: 200, dur: 0.35, type: 'sawtooth', vol: 0.25 });
  }

  gameover() {
    [440, 349, 293, 220].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.4, when: i * 0.22 }),
    );
  }

  save() {
    this._tone({ freq: 880, end: 1320, dur: 0.15, type: 'sine', vol: 0.4 });
  }
}
