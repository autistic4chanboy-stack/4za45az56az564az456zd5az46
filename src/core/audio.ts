/**
 * Audio 100 % procédural (WebAudio) : aucun fichier son, tout est synthétisé.
 */

export type SfxId =
  | 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'cannon' | 'explosion' | 'tesla' | 'flame' | 'melee'
  | 'hit' | 'hitMetal' | 'monsterDie' | 'humanDie' | 'growl' | 'reload' | 'empty' | 'pickup' | 'ui'
  | 'uiOpen' | 'door' | 'locked' | 'unlock' | 'geiger' | 'whistle' | 'chuff' | 'clack' | 'shovel'
  | 'alarm' | 'shield' | 'repair' | 'cough' | 'coin' | 'step' | 'heartbeat' | 'pick' | 'pickFail'
  | 'beep' | 'error' | 'success' | 'spit' | 'lever' | 'detach' | 'thunder' | 'bite' | 'arcade' | 'build';

interface PlayOpts {
  x?: number;
  z?: number;
  volume?: number;
  pitch?: number;
}

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private lastPlay = new Map<SfxId, number>();
  private active = 0;
  listenerX = 0;
  listenerZ = 0;
  volumes = { master: 0.8, sfx: 0.9, ambient: 0.6, music: 0.45 };
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private musicTimer: number | null = null;
  private musicMood: 'calm' | 'tense' | 'none' = 'none';

  /** À appeler sur une interaction utilisateur (politique autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.ambient = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambient.connect(this.master);
    this.music.connect(this.master);
    this.applyVolumes();
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startWind();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.ambient.gain.value = this.volumes.ambient;
    this.music.gain.value = this.volumes.music;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseSrc(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private env(gain: GainNode, t: number, attack: number, peak: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Crée la chaîne de sortie (gain + panoramique) pour un son positionné. */
  private out(opts: PlayOpts): { node: GainNode; vol: number } | null {
    const ctx = this.ctx!;
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.x !== undefined && opts.z !== undefined) {
      const dx = opts.x - this.listenerX;
      const dz = opts.z - this.listenerZ;
      const d = Math.hypot(dx, dz);
      const att = 1 / (1 + Math.max(0, d - 6) * 0.08);
      vol *= att;
      if (d > 70) return null;
      pan = Math.max(-0.8, Math.min(0.8, dx / 25));
    }
    if (vol < 0.01) return null;
    const g = ctx.createGain();
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    return { node: g, vol };
  }

  play(id: SfxId, opts: PlayOpts = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.now();
    const minGap: Partial<Record<SfxId, number>> = { smg: 0.045, step: 0.12, geiger: 0.01, hit: 0.03, hitMetal: 0.05, flame: 0.08, tesla: 0.06, chuff: 0.05, clack: 0.05 };
    const last = this.lastPlay.get(id) ?? -1;
    if (t - last < (minGap[id] ?? 0.02)) return;
    if (this.active > 28) return;
    this.lastPlay.set(id, t);
    const o = this.out(opts);
    if (!o) return;
    this.active++;
    const done = (dur: number) => window.setTimeout(() => this.active--, dur * 1000 + 50);
    const p = opts.pitch ?? 1;
    const v = o.vol;
    const ctx = this.ctx;
    const n = o.node;

    const noiseBurst = (dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, freqEnd?: number, attack = 0.002) => {
      const src = this.noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq * p, t);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd * p, t + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      this.env(g, t, attack, peak * v, dur);
      src.connect(f);
      f.connect(g);
      g.connect(n);
      src.start(t, Math.random() * 1.5);
      src.stop(t + dur + attack + 0.05);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, attack = 0.005) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0 * p, t + delay);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * p), t + delay + dur);
      const g = ctx.createGain();
      this.env(g, t + delay, attack, peak * v, dur);
      osc.connect(g);
      g.connect(n);
      osc.start(t + delay);
      osc.stop(t + delay + dur + attack + 0.05);
    };

    switch (id) {
      case 'pistol':
        noiseBurst(0.14, 'bandpass', 1400, 0.8, 0.9, 500);
        tone('sine', 160, 45, 0.12, 0.6);
        done(0.2);
        break;
      case 'rifle':
        noiseBurst(0.3, 'lowpass', 3000, 0.7, 1.0, 300);
        tone('sine', 120, 35, 0.2, 0.8);
        done(0.35);
        break;
      case 'smg':
        noiseBurst(0.07, 'bandpass', 1800, 0.9, 0.55, 700);
        tone('square', 110, 60, 0.04, 0.15);
        done(0.1);
        break;
      case 'shotgun':
        noiseBurst(0.38, 'lowpass', 2600, 0.6, 1.0, 200);
        tone('sine', 90, 30, 0.25, 0.9);
        done(0.45);
        break;
      case 'cannon':
        noiseBurst(0.9, 'lowpass', 900, 0.8, 1.0, 80);
        tone('sine', 70, 25, 0.7, 1.0);
        done(1);
        break;
      case 'explosion':
        noiseBurst(1.4, 'lowpass', 1600, 0.5, 1.0, 60, 0.01);
        tone('sine', 55, 20, 1.1, 1.0);
        done(1.5);
        break;
      case 'tesla':
        tone('sawtooth', 900 + Math.random() * 600, 2400, 0.12, 0.25);
        noiseBurst(0.15, 'highpass', 3000, 0.5, 0.4);
        done(0.2);
        break;
      case 'flame':
        noiseBurst(0.25, 'lowpass', 700, 0.4, 0.5, 400, 0.03);
        done(0.3);
        break;
      case 'melee':
        noiseBurst(0.16, 'bandpass', 600, 1.5, 0.5, 2200, 0.02);
        done(0.2);
        break;
      case 'hit':
        tone('sine', 220, 70, 0.09, 0.5);
        noiseBurst(0.05, 'lowpass', 1200, 0.5, 0.3);
        done(0.12);
        break;
      case 'hitMetal':
        tone('triangle', 620, 600, 0.25, 0.22);
        tone('triangle', 1480, 1450, 0.18, 0.12);
        tone('sine', 2150, 2100, 0.12, 0.08);
        done(0.3);
        break;
      case 'monsterDie':
        tone('sawtooth', 220, 50, 0.5, 0.35);
        noiseBurst(0.4, 'lowpass', 500, 1, 0.3, 120);
        done(0.6);
        break;
      case 'humanDie':
        tone('sawtooth', 300, 120, 0.35, 0.18);
        noiseBurst(0.2, 'bandpass', 500, 1, 0.2);
        done(0.4);
        break;
      case 'growl': {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(70 * p, t);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 18;
        const lg = ctx.createGain();
        lg.gain.value = 25;
        lfo.connect(lg);
        lg.connect(osc.frequency);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        const g = ctx.createGain();
        this.env(g, t, 0.05, 0.3 * v, 0.6);
        osc.connect(f);
        f.connect(g);
        g.connect(n);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.7);
        lfo.stop(t + 0.7);
        done(0.7);
        break;
      }
      case 'reload':
        noiseBurst(0.03, 'highpass', 2500, 0.5, 0.5);
        window.setTimeout(() => this.play('pick', { ...opts, volume: (opts.volume ?? 1) * 0.8 }), 180);
        done(0.05);
        break;
      case 'empty':
        noiseBurst(0.02, 'highpass', 3500, 0.5, 0.35);
        done(0.05);
        break;
      case 'pick':
        noiseBurst(0.025, 'bandpass', 4000, 2, 0.4);
        done(0.05);
        break;
      case 'pickFail':
        tone('square', 180, 120, 0.12, 0.15);
        done(0.15);
        break;
      case 'pickup':
        tone('sine', 620, 640, 0.07, 0.25);
        tone('sine', 930, 960, 0.1, 0.25, 0.07);
        done(0.2);
        break;
      case 'coin':
        tone('triangle', 1320, 1320, 0.08, 0.2);
        tone('triangle', 1760, 1760, 0.2, 0.2, 0.06);
        done(0.3);
        break;
      case 'ui':
        tone('sine', 880, 700, 0.04, 0.12);
        done(0.06);
        break;
      case 'uiOpen':
        tone('sine', 520, 780, 0.08, 0.12);
        done(0.1);
        break;
      case 'beep':
        tone('square', 1000, 1000, 0.06, 0.1);
        done(0.08);
        break;
      case 'error':
        tone('square', 220, 200, 0.12, 0.15);
        tone('square', 180, 160, 0.15, 0.15, 0.12);
        done(0.3);
        break;
      case 'success':
        tone('triangle', 523, 523, 0.1, 0.2);
        tone('triangle', 659, 659, 0.1, 0.2, 0.09);
        tone('triangle', 784, 784, 0.25, 0.2, 0.18);
        done(0.45);
        break;
      case 'door':
        tone('sawtooth', 110, 90, 0.35, 0.08);
        noiseBurst(0.3, 'bandpass', 400, 4, 0.25, 900, 0.05);
        done(0.4);
        break;
      case 'locked':
        tone('square', 140, 100, 0.08, 0.2);
        noiseBurst(0.06, 'lowpass', 800, 1, 0.4);
        done(0.1);
        break;
      case 'unlock':
        noiseBurst(0.03, 'highpass', 3000, 0.5, 0.5);
        tone('triangle', 1200, 1200, 0.15, 0.12, 0.05);
        done(0.25);
        break;
      case 'lever':
        noiseBurst(0.12, 'bandpass', 900, 2, 0.6, 300);
        tone('triangle', 300, 200, 0.2, 0.2, 0.08);
        done(0.3);
        break;
      case 'geiger':
        noiseBurst(0.004, 'highpass', 4000, 0.5, 0.8 + Math.random() * 0.4);
        done(0.01);
        break;
      case 'whistle':
        tone('sine', 466, 466, 1.4, 0.18, 0, 0.08);
        tone('sine', 587, 587, 1.4, 0.14, 0, 0.08);
        tone('sine', 698, 698, 1.4, 0.1, 0, 0.08);
        noiseBurst(1.4, 'bandpass', 2400, 3, 0.12, undefined, 0.1);
        done(1.6);
        break;
      case 'chuff':
        noiseBurst(0.16, 'bandpass', 420, 1.2, 0.35, 220, 0.01);
        done(0.2);
        break;
      case 'clack':
        noiseBurst(0.03, 'bandpass', 1800, 3, 0.25);
        noiseBurst(0.03, 'bandpass', 1500, 3, 0.2);
        done(0.05);
        break;
      case 'shovel':
        noiseBurst(0.25, 'bandpass', 1200, 1, 0.4, 600, 0.03);
        tone('sine', 120, 60, 0.12, 0.3, 0.2);
        done(0.4);
        break;
      case 'alarm':
        tone('square', 780, 780, 0.25, 0.12);
        tone('square', 590, 590, 0.25, 0.12, 0.28);
        done(0.6);
        break;
      case 'shield':
        tone('sine', 300, 900, 0.3, 0.2);
        done(0.35);
        break;
      case 'repair':
        for (let i = 0; i < 3; i++) noiseBurst(0.03, 'bandpass', 2500 + i * 300, 3, 0.35);
        tone('triangle', 900, 900, 0.05, 0.1, 0.1);
        done(0.2);
        break;
      case 'cough':
        noiseBurst(0.12, 'bandpass', 500, 1.5, 0.5, 300);
        window.setTimeout(() => {
          if (this.ctx) this.play('hit', { ...opts, volume: 0.01 });
        }, 10);
        done(0.15);
        break;
      case 'step':
        noiseBurst(0.04, 'lowpass', 500, 1, 0.12);
        done(0.05);
        break;
      case 'heartbeat':
        tone('sine', 60, 40, 0.12, 0.6);
        tone('sine', 55, 35, 0.12, 0.45, 0.18);
        done(0.35);
        break;
      case 'spit':
        noiseBurst(0.2, 'bandpass', 900, 2, 0.4, 2400);
        done(0.25);
        break;
      case 'bite':
        noiseBurst(0.08, 'bandpass', 1500, 1, 0.5);
        tone('sawtooth', 160, 90, 0.1, 0.2);
        done(0.12);
        break;
      case 'detach':
        tone('triangle', 260, 80, 1.0, 0.4);
        noiseBurst(0.9, 'lowpass', 1200, 0.5, 0.6, 200, 0.02);
        done(1.1);
        break;
      case 'thunder':
        noiseBurst(2.5, 'lowpass', 500, 0.4, 0.8, 50, 0.05);
        done(2.6);
        break;
      case 'arcade':
        tone('square', 660, 660, 0.05, 0.08);
        tone('square', 990, 990, 0.05, 0.08, 0.05);
        done(0.12);
        break;
      case 'build':
        noiseBurst(0.08, 'bandpass', 1600, 2, 0.5);
        tone('triangle', 400, 600, 0.15, 0.2, 0.08);
        done(0.25);
        break;
    }
  }

  // ---------------------------------------------------------------- ambiance
  private startWind(): void {
    const ctx = this.ctx!;
    const src = this.noiseSrc();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(this.windFilter.frequency);
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.ambient);
    src.start();
    lfo.start();
  }

  /** intensité 0..1 du vent (hiver, toundra, vitesse du train). */
  setWind(intensity: number, bright = 0): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.now();
    this.windGain.gain.setTargetAtTime(Math.min(1, intensity) * 0.35, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + bright * 900, t, 0.5);
  }

  // ---------------------------------------------------------------- musique générative
  setMusic(mood: 'calm' | 'tense' | 'none'): void {
    if (mood === this.musicMood) return;
    this.musicMood = mood;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (mood !== 'none') this.musicStep(0);
  }

  private musicStep(step: number): void {
    if (!this.ctx || this.musicMood === 'none') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const calm = this.musicMood === 'calm';
    // gamme mineure pentatonique (la)
    const scale = calm ? [220, 261.6, 293.7, 329.6, 392, 440, 523.3] : [110, 130.8, 146.8, 155.6, 196, 220, 233.1];
    const play = (freq: number, dur: number, vol: number, type: OscillatorType) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = calm ? 1400 : 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.4, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(f);
      f.connect(g);
      g.connect(this.music);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    };
    if (step % 8 === 0) play(scale[0] / 2, 6, 0.09, 'triangle');
    if (step % 8 === 4) play(scale[calm ? 2 : 1] / 2, 6, 0.07, 'triangle');
    if (Math.random() < (calm ? 0.55 : 0.75)) {
      const note = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      play(note, calm ? 2.4 : 0.9, calm ? 0.05 : 0.04, calm ? 'sine' : 'sawtooth');
    }
    const interval = calm ? 750 : 420;
    this.musicTimer = window.setTimeout(() => this.musicStep(step + 1), interval);
  }
}
