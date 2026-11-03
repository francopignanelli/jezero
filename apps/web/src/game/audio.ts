/**
 * Procedural sound (Web Audio, no files): a low wind, the motors' whine rising with speed, the
 * drill's percussion while coring, a chime when a sample is sealed, the laser's clicks (SuperCam's
 * microphone recorded its zaps), warnings and a shutter. Everything is low-passed:
 * Mars's thin CO₂ air carries high frequencies poorly, as Perseverance's microphones recorded.
 * Starts on the first user gesture (browsers block audio before one); mutable.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private motor: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private drillGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private time = 0;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;
    const mars = ctx.createBiquadFilter();
    mars.type = 'lowpass';
    mars.frequency.value = 1800;
    master.connect(mars).connect(ctx.destination);
    this.master = master;

    // Noise source shared by the wind and the drill (brown-ish noise in a looping buffer).
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.noiseBuf = buf;
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * 3);
      return s;
    };
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 320;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise().connect(this.windFilter).connect(this.windGain).connect(master);

    this.motor = ctx.createOscillator();
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 70;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 600;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motor.connect(motorFilter).connect(this.motorGain).connect(master);
    this.motor.start();

    const drillFilter = ctx.createBiquadFilter();
    drillFilter.type = 'bandpass';
    drillFilter.frequency.value = 900;
    drillFilter.Q.value = 1.4;
    this.drillGain = ctx.createGain();
    this.drillGain.gain.value = 0;
    noise().connect(drillFilter).connect(this.drillGain).connect(master);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  update(dt: number, s: { speed: number; drilling: boolean; wind: number }): void {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.windGain ||
      !this.motor ||
      !this.motorGain ||
      !this.drillGain ||
      !this.windFilter
    )
      return;
    this.time += dt;
    const t = ctx.currentTime;
    // Gusts: slow, irregular swells.
    const gust = 0.5 + 0.3 * Math.sin(this.time * 0.37) + 0.2 * Math.sin(this.time * 1.13 + 2);
    this.windGain.gain.setTargetAtTime(0.22 * gust * s.wind, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(240 + 160 * gust, t, 0.5);
    const v = Math.min(1, s.speed / 12);
    this.motor.frequency.setTargetAtTime(62 + 150 * v, t, 0.15);
    this.motorGain.gain.setTargetAtTime(s.speed > 0.05 ? 0.05 + 0.08 * v : 0, t, 0.12);
    // Percussive drill: ~9 hammer blows per second.
    const hammer = s.drilling ? 0.12 + 0.12 * Math.max(0, Math.sin(this.time * Math.PI * 18)) : 0;
    this.drillGain.gain.setTargetAtTime(hammer, t, 0.01);
  }

  /** A short two-note chime (sample sealed); a rising three-note one when `final`. */
  chime(final: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const notes = final ? [523, 659, 784] : [659, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.16, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      o.connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + 0.65);
    });
  }

  /** A short burst of filtered noise (a click). */
  private burst(at: number, freq: number, gain: number, len: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 3);
    src.stop(at + len + 0.02);
  }

  /** One laser pulse: the sharp tick of the plasma, as SuperCam's microphone heard it. */
  zap(): void {
    if (this.ctx) this.burst(this.ctx.currentTime, 1500, 0.5, 0.05);
  }

  /** A camera shutter. */
  shutter(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 1200, 0.45, 0.04);
    this.burst(t + 0.07, 900, 0.35, 0.05);
  }

  /** A low two-tone warning (hazards). */
  warn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    [330, 262].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.12, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + 0.32);
    });
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
