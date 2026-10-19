// Turns raw readings into a "frame" the rest of the app uses:
// adds the calculated gear, distance travelled and smoothed g-force.

import { RPM_PER_KMH, GEAR_DETECT } from '../config.js';

export class Telemetry {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.gear = null;
    this.candidate = null;
    this.candidateCount = 0;
    this.distM = 0;
    this.gLongSmooth = 0;
    this.gLatSmooth = 0;
    this.history = []; // the last ~2 seconds of frames
  }

  // Which gear matches this rpm/speed pair? null if none (e.g. mid-shift).
  matchGear(rpm, kmh) {
    if (kmh < GEAR_DETECT.minSpeedKmh) return null;
    const ratio = rpm / kmh;
    let best = null;
    let bestErr = Infinity;
    RPM_PER_KMH.forEach((r, i) => {
      const err = Math.abs(ratio - r) / r;
      if (err < bestErr) {
        bestErr = err;
        best = i + 1;
      }
    });
    return bestErr <= GEAR_DETECT.tolerance ? best : null;
  }

  update(sample) {
    const dt = this.last ? Math.max(0, (sample.t - this.last.t) / 1000) : 0;
    this.distM += (sample.speedKmh / 3.6) * dt;

    const match = this.matchGear(sample.rpm, sample.speedKmh);
    if (sample.speedKmh < GEAR_DETECT.minSpeedKmh) {
      if (sample.speedKmh < 1) this.gear = null;
    } else if (match !== null && match !== this.gear) {
      this.candidateCount = match === this.candidate ? this.candidateCount + 1 : 1;
      this.candidate = match;
      if (this.candidateCount >= GEAR_DETECT.stableSamples) this.gear = match;
    }

    const a = dt > 0 ? Math.min(1, dt / 0.25) : 1;
    this.gLongSmooth += (sample.gLong - this.gLongSmooth) * a;
    this.gLatSmooth += (sample.gLat - this.gLatSmooth) * a;

    const frame = {
      ...sample,
      dt,
      gear: this.gear,
      distM: this.distM,
      gLongSmooth: this.gLongSmooth,
      gLatSmooth: this.gLatSmooth,
      stopped: sample.speedKmh < 0.5,
    };
    this.history.push(frame);
    while (this.history.length && frame.t - this.history[0].t > 2000) this.history.shift();
    this.last = frame;
    return frame;
  }

  // Frames from the last `ms` milliseconds before time t.
  window(ms, t = this.last?.t ?? 0) {
    return this.history.filter((f) => f.t > t - ms && f.t <= t);
  }
}
