// Launch timer. Arms itself after the car has been stopped for a second,
// starts the moment the car moves, and reports 0-60 mph (and, on Track Day,
// the quarter mile). No countdown, no "go" prompt: it just quietly measures.

import { LAUNCH } from '../config.js';
import { emit } from '../util/bus.js';

export class LaunchTimer {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.stoppedSince = null;
    this.run = null;
  }

  update(frame, { enabled, quarterMile }) {
    if (!enabled) return this.reset();

    if (frame.stopped) {
      this.stoppedSince ??= frame.t;
      if (this.state === 'running') this.abort();
      if (frame.t - this.stoppedSince >= LAUNCH.armAfterStoppedMs) this.state = 'armed';
      return;
    }
    this.stoppedSince = null;

    if (this.state === 'armed') {
      this.state = 'running';
      this.run = { t0: frame.t - frame.dt * 1000, d0: frame.distM - (frame.speedKmh / 3.6) * frame.dt, peak: 0, early: [], zeroTo60: null };
    }
    if (this.state !== 'running') return;

    const r = this.run;
    const elapsed = (frame.t - r.t0) / 1000;
    if (elapsed < 1.5) r.early.push(frame.gLong);
    r.maxThrottle = Math.max(r.maxThrottle ?? 0, frame.throttle);
    r.peak = Math.max(r.peak, frame.speedKmh);

    if (frame.speedKmh < r.peak - 5 || elapsed > LAUNCH.maxRunS) return this.abort();

    if (r.zeroTo60 === null && frame.speedKmh >= LAUNCH.targetKmh) {
      r.zeroTo60 = elapsed;
      // only a real launch (hard throttle) gets a banner, not a gentle pull-away
      if (elapsed <= LAUNCH.showIfUnderS && r.maxThrottle >= 70) {
        emit('launch', { zeroTo60: elapsed, grade: this.gradeLaunch(r.early) });
      }
      if (!quarterMile || elapsed > LAUNCH.showIfUnderS) return this.finish();
    }
    if (quarterMile && frame.distM - r.d0 >= LAUNCH.quarterMileM) {
      emit('quarter', { time: elapsed, trapKmh: frame.speedKmh });
      this.finish();
    }
  }

  // Launch technique from the first 1.5 s of g-force:
  // CLEAN = strong and steady, BOGGED = weak start, SLIPPY = pull dropped away (likely wheelspin).
  // This is an estimate; OBD can't see wheelspin directly.
  gradeLaunch(early) {
    if (early.length < 4) return 'CLEAN';
    const peak = Math.max(...early);
    const tail = early.slice(Math.floor(early.length / 2));
    const tailAvg = tail.reduce((s, g) => s + g, 0) / tail.length;
    if (peak < 0.3) return 'BOGGED';
    if (tailAvg < peak * 0.65) return 'SLIPPY';
    return 'CLEAN';
  }

  abort() {
    this.state = 'idle';
    this.run = null;
  }

  finish() {
    this.state = 'idle';
    this.run = null;
  }
}
