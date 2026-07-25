/**
 * Procedural audio. Every sound is synthesised at runtime with WebAudio -- no
 * sample files anywhere. Positional sounds are panned and attenuated manually
 * against the listener transform, which is cheaper and more predictable than
 * wiring up PannerNodes for hundreds of one-shots.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterVol = 0.7;
    this.musicVol = 0.4;
    this.sfxVol = 0.85;
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1, rx: 1, rz: 0 };
    this.noiseBuf = null;
    this.started = false;
    this.music = null;
    this.musicIntensity = 0;
    this._lastPlay = new Map();
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // Shared white-noise buffer.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // A short reverb so the village feels like an outdoor space.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.5, 2.6);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.16;
    this.reverbGain.connect(this.master);
    this.reverb.connect(this.reverbGain);

    this.started = true;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  setListener(pos, forward) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.listener.fx = forward.x; this.listener.fz = forward.z;
    // right = forward x up
    this.listener.rx = -forward.z;
    this.listener.rz = forward.x;
  }

  /** Returns {gain, pan} for a world position, or null if inaudible. */
  _spatial(pos, maxDist = 70) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dy = (pos.y ?? 0) - this.listener.y;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return null;
    const gain = clamp(1 - d / maxDist, 0, 1) ** 1.7;
    const len = Math.hypot(dx, dz) || 1;
    const pan = clamp(((dx / len) * this.listener.rx + (dz / len) * this.listener.rz) * clamp(d / 4, 0, 1), -1, 1);
    return { gain, pan };
  }

  _out(pos, extraGain = 1, reverbSend = 0.25) {
    const g = this.ctx.createGain();
    const sp = this._spatial(pos);
    if (!sp) return null;
    g.gain.value = sp.gain * extraGain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = sp.pan;
      g.connect(p);
      p.connect(this.sfxBus);
      if (reverbSend > 0) {
        const rs = this.ctx.createGain();
        rs.gain.value = reverbSend;
        p.connect(rs);
        rs.connect(this.reverb);
      }
    } else {
      g.connect(this.sfxBus);
    }
    return g;
  }

  _noise(dest, { dur = 0.2, type = 'lowpass', freq = 2000, q = 1, gain = 1, sweep = null }) {
    // exponentialRampToValueAtTime throws on a zero target, and a zero-gain
    // voice is inaudible anyway, so drop it rather than special-casing later.
    if (!(gain > 1e-4) || !(dur > 0)) return null;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
    return { src, f, g };
  }

  _tone(dest, { freq = 440, endFreq = null, dur = 0.2, type = 'sine', gain = 0.4, delay = 0, attack = 0.004 }) {
    if (!(gain > 1e-4) || !(dur > 0) || !(freq > 0)) return null;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    return { o, g };
  }

  /** Bell cluster used for sleigh bells and pickup chimes. */
  _bells(dest, { n = 5, base = 1400, dur = 0.5, gain = 0.09, spread = 700 }) {
    for (let i = 0; i < n; i++) {
      this._tone(dest, {
        freq: base + Math.random() * spread,
        dur: dur * (0.5 + Math.random() * 0.8),
        type: 'triangle',
        gain: gain * (0.5 + Math.random() * 0.6),
        delay: Math.random() * 0.05,
      });
    }
  }

  play(name, pos = null, opts = {}) {
    if (!this.enabled || !this.started) return;
    if (this.ctx.state === 'suspended') return;

    // Throttle rapid duplicates (a shotgun's 12 pellets must not fire 12 sounds).
    const now = this.ctx.currentTime;
    const min = THROTTLE[name];
    if (min !== undefined) {
      const last = this._lastPlay.get(name) ?? -1;
      if (now - last < min) return;
      this._lastPlay.set(name, now);
    }

    const out = this._out(pos, opts.gain ?? 1, opts.reverb ?? 0.22);
    if (!out) return;
    const S = SOUNDS[name];
    if (!S) throw new Error(`Audio.play: no such sound "${name}"`);
    try {
      S(this, out, opts);
    } catch (err) {
      // A bad WebAudio parameter must never take the game loop down with it,
      // but it is still a bug: report it loudly, once per sound.
      if (!this._reported) this._reported = new Set();
      if (!this._reported.has(name)) {
        this._reported.add(name);
        console.error(`[audio] sound "${name}" failed and is now degraded:`, err);
      }
    }
  }

  /* ---------------- music ---------------- */

  startMusic() {
    if (!this.started || this.music) return;
    const ctx = this.ctx;
    this.music = { nodes: [], step: 0, timer: null };
    this.musicBus.gain.setTargetAtTime(this.musicVol, ctx.currentTime, 1.5);

    // "Carol of the Bells" style ostinato in E minor -- three notes, endlessly
    // cycling, which is exactly the right amount of menace for Christmas.
    const OSTINATO = [0, -1, -2, 0];      // semitone offsets from the root
    const ROOT = 329.63;                   // E4
    const BASS = [82.41, 82.41, 87.31, 73.42]; // E2 E2 F2 D2, one per bar
    const stepDur = 0.24;
    let step = 0;

    const tick = () => {
      if (!this.music) return;
      const t = ctx.currentTime;
      const bar = Math.floor(step / 12) % 4;
      const inBar = step % 12;
      const intensity = this.musicIntensity;

      // Ostinato voice
      const semi = OSTINATO[inBar % 3 === 0 ? 0 : (inBar % 3)];
      const freq = ROOT * Math.pow(2, semi / 12);
      this._tone(this.musicBus, {
        freq, dur: stepDur * 1.6, type: 'triangle',
        gain: 0.055 + intensity * 0.03,
      });

      // Bass every bar
      if (inBar === 0) {
        this._tone(this.musicBus, {
          freq: BASS[bar], dur: 12 * stepDur * 0.9, type: 'sawtooth',
          gain: 0.035 + intensity * 0.035, attack: 0.02,
        });
      }
      // Sleigh bells on the offbeat, busier when the fight heats up
      if (inBar % 3 === 1 && Math.random() < 0.4 + intensity * 0.5) {
        this._bells(this.musicBus, { n: 3, base: 2100, dur: 0.22, gain: 0.02 + intensity * 0.02, spread: 900 });
      }
      // A low drum when things are hot
      if (intensity > 0.35 && inBar % 6 === 0) {
        this._tone(this.musicBus, { freq: 62, endFreq: 38, dur: 0.28, type: 'sine', gain: 0.16 * intensity });
      }
      step++;
      this.music.timer = setTimeout(tick, stepDur * 1000);
    };
    tick();
  }

  stopMusic() {
    if (!this.music) return;
    clearTimeout(this.music.timer);
    this.music = null;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  setMusicIntensity(v) { this.musicIntensity = clamp(v, 0, 1); }

  setVolume(master, sfx, music) {
    this.masterVol = master;
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.started) return;
    this.master.gain.value = master;
    this.sfxBus.gain.value = sfx;
    if (this.music) this.musicBus.gain.value = music;
  }
}

/** Minimum seconds between repeats of the same sound. */
const THROTTLE = {
  chaingun: 0.05,
  block: 0.06,
  snowhit: 0.05,
  step: 0.16,
  hurt: 0.18,
  gib: 0.05,
  headshot: 0.08,
};

const SOUNDS = {
  chaingun(A, out) {
    A._noise(out, { dur: 0.09, type: 'bandpass', freq: 1700, q: 1.1, gain: 0.4, sweep: 700 });
    A._tone(out, { freq: 180, endFreq: 90, dur: 0.07, type: 'square', gain: 0.16 });
  },
  shotgun(A, out) {
    A._noise(out, { dur: 0.34, type: 'lowpass', freq: 3200, gain: 0.85, sweep: 250 });
    A._tone(out, { freq: 120, endFreq: 42, dur: 0.26, type: 'square', gain: 0.4 });
    A._bells(out, { n: 3, base: 2600, dur: 0.3, gain: 0.05 });
  },
  launcher(A, out) {
    A._noise(out, { dur: 0.4, type: 'lowpass', freq: 1400, gain: 0.5, sweep: 180 });
    A._tone(out, { freq: 320, endFreq: 90, dur: 0.32, type: 'sawtooth', gain: 0.3 });
  },
  rail(A, out) {
    A._tone(out, { freq: 2400, endFreq: 260, dur: 0.5, type: 'sawtooth', gain: 0.28 });
    A._tone(out, { freq: 3600, endFreq: 700, dur: 0.35, type: 'sine', gain: 0.18 });
    A._noise(out, { dur: 0.55, type: 'highpass', freq: 2000, gain: 0.3, sweep: 6000 });
  },
  explode(A, out) {
    A._noise(out, { dur: 0.85, type: 'lowpass', freq: 1800, gain: 1.0, sweep: 90 });
    A._tone(out, { freq: 140, endFreq: 32, dur: 0.6, type: 'sine', gain: 0.7 });
    A._tone(out, { freq: 70, endFreq: 24, dur: 0.9, type: 'sine', gain: 0.5 });
    A._bells(out, { n: 6, base: 1800, dur: 0.7, gain: 0.05, spread: 1600 });
  },
  snowhit(A, out) {
    A._noise(out, { dur: 0.22, type: 'lowpass', freq: 900, gain: 0.5, sweep: 200 });
  },
  gib(A, out) {
    A._noise(out, { dur: 0.24, type: 'bandpass', freq: 900, q: 0.7, gain: 0.7, sweep: 260 });
    A._tone(out, { freq: 200, endFreq: 60, dur: 0.18, type: 'square', gain: 0.22 });
  },
  bossdie(A, out) {
    A._noise(out, { dur: 2.2, type: 'lowpass', freq: 1400, gain: 1.0, sweep: 60 });
    A._tone(out, { freq: 90, endFreq: 22, dur: 2.0, type: 'sine', gain: 0.7 });
    A._tone(out, { freq: 300, endFreq: 40, dur: 1.4, type: 'sawtooth', gain: 0.3 });
  },
  headshot(A, out) {
    A._tone(out, { freq: 2100, dur: 0.16, type: 'sine', gain: 0.22 });
    A._tone(out, { freq: 3150, dur: 0.13, type: 'sine', gain: 0.14, delay: 0.03 });
  },
  block(A, out) {
    A._tone(out, { freq: 1500, endFreq: 900, dur: 0.2, type: 'square', gain: 0.16 });
    A._noise(out, { dur: 0.14, type: 'highpass', freq: 3000, gain: 0.3 });
  },
  swing(A, out) {
    A._noise(out, { dur: 0.26, type: 'bandpass', freq: 700, q: 1.4, gain: 0.35, sweep: 2200 });
  },
  throw(A, out) {
    A._noise(out, { dur: 0.3, type: 'bandpass', freq: 500, q: 1.2, gain: 0.3, sweep: 1600 });
  },
  throwup(A, out) {
    A._tone(out, { freq: 200, endFreq: 420, dur: 0.3, type: 'triangle', gain: 0.14 });
  },
  summon(A, out) {
    A._tone(out, { freq: 120, endFreq: 380, dur: 0.7, type: 'sawtooth', gain: 0.3 });
    A._bells(out, { n: 8, base: 900, dur: 0.8, gain: 0.05, spread: 1400 });
  },
  dryfire(A, out) {
    A._noise(out, { dur: 0.05, type: 'highpass', freq: 3000, gain: 0.25 });
    A._tone(out, { freq: 900, dur: 0.04, type: 'square', gain: 0.08 });
  },
  switch(A, out) {
    A._noise(out, { dur: 0.09, type: 'bandpass', freq: 1800, q: 2, gain: 0.22 });
    A._tone(out, { freq: 420, endFreq: 700, dur: 0.09, type: 'square', gain: 0.09 });
  },
  jump(A, out) {
    A._noise(out, { dur: 0.11, type: 'lowpass', freq: 1200, gain: 0.16, sweep: 500 });
  },
  land(A, out, o = {}) {
    const p = Math.max(0.2, o.power ?? 1);
    A._noise(out, { dur: 0.16, type: 'lowpass', freq: 700, gain: 0.24 * p, sweep: 180 });
    A._tone(out, { freq: 90, endFreq: 45, dur: 0.12, type: 'sine', gain: 0.12 * p });
  },
  step(A, out) {
    A._noise(out, { dur: 0.075, type: 'lowpass', freq: 900, gain: 0.09, sweep: 300 });
  },
  jumppad(A, out) {
    A._tone(out, { freq: 180, endFreq: 1300, dur: 0.34, type: 'triangle', gain: 0.32 });
    A._bells(out, { n: 5, base: 1600, dur: 0.4, gain: 0.06, spread: 1200 });
  },
  hurt(A, out) {
    A._tone(out, { freq: 220, endFreq: 120, dur: 0.24, type: 'sawtooth', gain: 0.24 });
    A._noise(out, { dur: 0.2, type: 'lowpass', freq: 700, gain: 0.24 });
  },
  die(A, out) {
    A._tone(out, { freq: 300, endFreq: 60, dur: 1.4, type: 'sawtooth', gain: 0.35 });
    A._noise(out, { dur: 1.2, type: 'lowpass', freq: 900, gain: 0.4, sweep: 90 });
  },
  pickup(A, out) {
    A._tone(out, { freq: 880, dur: 0.11, type: 'triangle', gain: 0.2 });
    A._tone(out, { freq: 1320, dur: 0.14, type: 'triangle', gain: 0.16, delay: 0.05 });
  },
  weapon(A, out) {
    A._tone(out, { freq: 440, dur: 0.12, type: 'square', gain: 0.16 });
    A._tone(out, { freq: 660, dur: 0.12, type: 'square', gain: 0.14, delay: 0.06 });
    A._tone(out, { freq: 880, dur: 0.2, type: 'triangle', gain: 0.18, delay: 0.12 });
  },
  powerup(A, out) {
    for (let i = 0; i < 6; i++) {
      A._tone(out, { freq: 440 * Math.pow(2, i / 6), dur: 0.5, type: 'triangle', gain: 0.14, delay: i * 0.06 });
    }
    A._bells(out, { n: 10, base: 2000, dur: 1.0, gain: 0.05, spread: 2000 });
  },
  respawn(A, out) {
    A._tone(out, { freq: 660, dur: 0.12, type: 'sine', gain: 0.1 });
  },
  wave(A, out) {
    A._bells(out, { n: 12, base: 900, dur: 1.1, gain: 0.07, spread: 1800 });
    A._tone(out, { freq: 130, endFreq: 196, dur: 0.9, type: 'sawtooth', gain: 0.16 });
  },
  victory(A, out) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => A._tone(out, { freq: f, dur: 0.9, type: 'triangle', gain: 0.2, delay: i * 0.13 }));
    A._bells(out, { n: 16, base: 1500, dur: 1.6, gain: 0.06, spread: 2500 });
  },
  hitmark(A, out) {
    A._tone(out, { freq: 1700, dur: 0.05, type: 'square', gain: 0.07 });
  },
  flagpole(A, out) {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => A._tone(out, { freq: f, dur: 0.6, type: 'triangle', gain: 0.22, delay: i * 0.1 }));
  },
};
