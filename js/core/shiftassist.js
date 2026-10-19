// Shift assist: tells you when to pull the upshift paddle.
// It watches how fast the revs are climbing and cues a little early, because
// readings from the car arrive slightly late and you need a moment to react.
// While the engine is cold it cues early, at gentle revs.

import { SHIFT_ASSIST, CAR, DRIVING } from '../config.js';
import { idealShiftRpm } from './shifts.js';
import { emit } from '../util/bus.js';

export class ShiftAssist {
  constructor(telemetry) {
    this.tel = telemetry;
    this.reset();
  }

  reset() {
    this.armed = true;
    this.gear = null;
    this.flashUntil = 0;
    this.ideal = null;
    this.cueRpm = 0;
  }

  // throttle: smoothed throttle %. Returns { ideal, flashing }.
  update(f, { enabled, throttle }) {
    const top = CAR.gearRatios.length;
    if (!enabled || f.stopped || f.gear === null || f.gear >= top) {
      this.ideal = null;
      return { ideal: null, flashing: false };
    }

    let ideal = idealShiftRpm(throttle);
    if (f.coolantC < DRIVING.coldCoolantC) ideal = Math.min(ideal, SHIFT_ASSIST.coldMaxRpm);
    this.ideal = ideal;

    // ready again after a gear change, or if you backed off instead of shifting
    if (f.gear !== this.gear) {
      this.gear = f.gear;
      this.armed = true;
    }
    if (!this.armed && f.rpm < this.cueRpm - SHIFT_ASSIST.rearmBelow) this.armed = true;

    // how fast are the revs climbing in this gear? (rpm per second)
    const recent = this.tel.window(300, f.t).filter((x) => x.gear === f.gear);
    const first = recent[0];
    const rate = first && f.t > first.t ? ((f.rpm - first.rpm) / (f.t - first.t)) * 1000 : 0;
    const lead = Math.min(Math.max(0, rate) * SHIFT_ASSIST.leadS, SHIFT_ASSIST.maxLeadRpm);
    const predicted = f.rpm + lead;

    if (this.armed && throttle > SHIFT_ASSIST.minThrottle && predicted >= ideal) {
      this.armed = false;
      this.cueRpm = f.rpm;
      this.flashUntil = f.t + SHIFT_ASSIST.flashMs;
      emit('shiftCue', { gear: f.gear, ideal: Math.round(ideal) });
    }
    return { ideal, flashing: f.t < this.flashUntil };
  }
}
