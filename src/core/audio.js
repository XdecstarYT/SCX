/**
 * ---------------------------------------------------------------------------
 * SOUND
 * ---------------------------------------------------------------------------
 * Everything here is synthesised. No audio assets to download, no licensing
 * questions, and the whole game works with `enabled = false`.
 *
 * Two halves. Cues are the short things you fire at a moment - a block going
 * down, money arriving, a whistle. The bed is the sound the place makes when
 * nothing is happening: wind over an empty ground, traffic on the approach
 * road, and the murmur of however many people are actually out there. That
 * second half is most of the difference between a game and a model viewer,
 * and it is why `setAmbience` is driven by the same numbers that drive the
 * crowd you can see rather than by a timer.
 */

/** How long one cue has to wait before the same cue may sound again. */
const CUE_GAP_MS = 45;
/** Seconds for a bed to travel its whole range. Any faster and it pumps. */
const BED_GLIDE = 1.8;
/** Length of the shared noise loop. Long enough not to hear it repeat. */
const NOISE_SECONDS = 4;

class Audio {
  constructor() {
    this.enabled = true;
    this.ambient = true;
    this.ctx = null;
    this.master = null;
    this.cues = null;        // bus for one-shots
    this.beds = null;        // bus for the continuous layers
    this.lastPlay = new Map();
    this.layers = null;      // { wind, traffic, crowd }
    this.want = { wind: 0.12, traffic: 0, crowd: 0 };
    this.at = { wind: 0, traffic: 0, crowd: 0 };
    this.t = 0;
    this._noise = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return null; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16;
    this.master.connect(this.ctx.destination);
    // Cues and beds get their own bus so the bed can sit well under the
    // things you did on purpose.
    this.cues = this.ctx.createGain();
    this.cues.gain.value = 1;
    this.cues.connect(this.master);
    this.beds = this.ctx.createGain();
    this.beds.gain.value = 0.85;
    this.beds.connect(this.master);
    return this.ctx;
  }

  /** One buffer of white noise, shared by every layer that needs it. */
  noiseBuffer() {
    const ctx = this.ensure();
    if (!ctx) return null;
    if (this._noise) return this._noise;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Taper the join so the loop point is not an audible click.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[len - 1 - i] *= k;
    }
    this._noise = buf;
    return buf;
  }

  // ------------------------------------------------------------------- cues
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
    osc.connect(g).connect(this.cues);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, gain = 0.5, filterFreq = 900) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
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
    src.connect(filt).connect(g).connect(this.cues);
    src.start();
  }

  /** A little run of notes, used for the sounds that mean something good. */
  arp(notes, dur, type, gain, gap) {
    notes.forEach((f, i) => setTimeout(() => this.tone(f, dur, type, gain), i * gap));
  }

  play(name) {
    if (!this.enabled) return;
    // Rate limit so a 5,000-block fill does not fire 5,000 oscillators. Per
    // cue, not global: a global gate meant money arriving during a fill was
    // swallowed by the placement ticks and you never heard the thing you
    // actually cared about.
    const now = performance.now();
    if (now - (this.lastPlay.get(name) || 0) < CUE_GAP_MS) return;
    this.lastPlay.set(name, now);
    switch (name) {
      case 'place':       this.tone(320, 0.07, 'square', 0.28, 420); break;
      case 'remove':      this.tone(220, 0.09, 'sawtooth', 0.22, 120); break;
      case 'build':       this.tone(300, 0.14, 'triangle', 0.3, 640); break;
      case 'prop':        this.tone(440, 0.06, 'triangle', 0.24, 560); break;
      case 'ui':          this.tone(680, 0.04, 'sine', 0.22); break;
      case 'open':        this.tone(520, 0.06, 'sine', 0.2, 760); break;
      case 'close':       this.tone(560, 0.06, 'sine', 0.18, 380); break;
      case 'deny':        this.tone(180, 0.14, 'square', 0.24, 110); break;
      // Money arriving. This was being asked for and had no case to land in,
      // so every payday in the game was silent.
      case 'cash':        this.arp([784, 1175], 0.12, 'triangle', 0.26, 70); break;
      case 'spend':       this.tone(300, 0.1, 'sine', 0.2, 200); break;
      case 'achievement': this.arp([523, 659, 784, 1047], 0.24, 'triangle', 0.3, 90); break;
      case 'win':         this.arp([392, 523, 659], 0.3, 'triangle', 0.34, 120); break;
      case 'lose':        this.arp([330, 262], 0.35, 'sine', 0.28, 160); break;
      case 'whistle':     this.tone(2200, 0.22, 'square', 0.12, 2600); break;
      case 'crowd':       this.noise(1.6, 0.32, 620); break;
      case 'cheer':       this.noise(2.4, 0.4, 900); this.swell(1.4); break;
      default: break;
    }
  }

  // -------------------------------------------------------------- the bed
  /**
   * How busy the place sounds. Takes the same 0..1 numbers the visible crowd
   * runs on, so what you hear and what you see cannot drift apart.
   */
  setAmbience({ population = 0, stands = 0, night = 0, roads = 0 } = {}) {
    const day = 1 - night;
    this.want.crowd = Math.min(1, population * 0.55 + stands * 1.1);
    this.want.traffic = Math.min(0.7, roads * (0.25 + day * 0.75));
    // Wind is what is left when there is nothing else - loudest on an empty
    // plot at night, and buried once there is a crowd in.
    this.want.wind = 0.16 * (1 - Math.min(1, this.want.crowd * 1.4)) + night * 0.06;
  }

  /** A push on the crowd bed, for the moments the cues alone are too thin. */
  swell(amount = 1) {
    this.at.crowd = Math.min(1.6, this.at.crowd + amount);
  }

  startBeds() {
    const ctx = this.ensure();
    if (!ctx || this.layers) return;
    const buf = this.noiseBuffer();
    if (!buf) return;
    const layer = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = freq;
      if (q != null) filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g).connect(this.beds);
      // Start each layer at its own offset so three copies of one buffer do
      // not phase together into something obviously artificial.
      src.start(0, Math.random() * NOISE_SECONDS);
      return { src, filt, gain: g };
    };
    this.layers = {
      wind: layer('lowpass', 420),
      traffic: layer('lowpass', 150),
      crowd: layer('bandpass', 520, 0.7),
    };
  }

  stopBeds() {
    if (!this.layers) return;
    for (const l of Object.values(this.layers)) {
      try { l.src.stop(); } catch { /* already stopped */ }
      l.gain.disconnect();
    }
    this.layers = null;
    this.at.wind = this.at.traffic = this.at.crowd = 0;
  }

  /**
   * Glide the beds toward what the world is asking for. Jumping straight to
   * the target pumps audibly every time the analysis re-runs, so everything
   * moves at a fixed rate per second instead.
   */
  update(dt) {
    if (!this.enabled || !this.ambient) {
      if (this.layers) this.stopBeds();
      return;
    }
    const ctx = this.ctx;
    // Nothing can sound until the player has touched the page once; a cue
    // will have built the context by then.
    if (!ctx || ctx.state !== 'running') return;
    if (!this.layers) this.startBeds();
    if (!this.layers) return;

    this.t += dt;
    const step = dt / BED_GLIDE;
    for (const k of ['wind', 'traffic', 'crowd']) {
      const d = this.want[k] - this.at[k];
      this.at[k] += Math.abs(d) <= step ? d : Math.sign(d) * step;
    }
    // A crowd breathes. Two slow waves that do not share a period, so it
    // never settles into an obvious loop.
    const breathe = 1 + Math.sin(this.t * 0.23) * 0.18 + Math.sin(this.t * 0.41) * 0.1;
    this.layers.wind.gain.gain.value = this.at.wind * 0.5;
    this.layers.traffic.gain.gain.value = this.at.traffic * 0.32;
    this.layers.crowd.gain.gain.value = Math.max(0, this.at.crowd) * 0.2 * breathe;
    // Busier grounds sound brighter as well as louder - more voices up top.
    this.layers.crowd.filt.frequency.value = 470 + this.at.crowd * 260;
  }
}

export const audio = new Audio();
