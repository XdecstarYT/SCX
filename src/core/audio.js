/**
 * Tiny synthesised sound effects. No audio assets to download, no licensing
 * questions, and the whole game works with `enabled = false`.
 */
class Audio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.lastPlay = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return null; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  tone(freq, dur, type = 'sine', gain = 1, slideTo = null) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, gain = 0.5, filterFreq = 900) {
    const ctx = this.ensure();
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(this.master);
    src.start();
  }

  play(name) {
    if (!this.enabled) return;
    // Rate limit so a 5,000-block fill does not fire 5,000 oscillators.
    const now = performance.now();
    if (now - this.lastPlay < 45) return;
    this.lastPlay = now;
    switch (name) {
      case 'place':       this.tone(320, 0.07, 'square', 0.28, 420); break;
      case 'remove':      this.tone(220, 0.09, 'sawtooth', 0.22, 120); break;
      case 'build':       this.tone(300, 0.14, 'triangle', 0.3, 640); break;
      case 'ui':          this.tone(680, 0.04, 'sine', 0.22); break;
      case 'deny':        this.tone(180, 0.14, 'square', 0.24, 110); break;
      case 'achievement': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.24, 'triangle', 0.3), i * 90)); break;
      case 'win':         [392, 523, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.34), i * 120)); break;
      case 'lose':        [330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sine', 0.28), i * 160)); break;
      case 'crowd':       this.noise(1.6, 0.32, 620); break;
      default: break;
    }
  }
}

export const audio = new Audio();
