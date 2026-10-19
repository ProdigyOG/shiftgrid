// Grades every gear change.
// Upshifts: how close the rpm was to the ideal shift point for the throttle used.
// Downshifts: how big the g-force jolt was afterwards.
// NOTE: OBD can't see the paddles, only gear changes. Grading is only switched on
// when the driver says they're shifting manually (the "Paddle shifting" setting).

import { GRADING, CAR } from '../config.js';
import { emit } from '../util/bus.js';

const CLEAN = new Set(['PERFECT', 'GOOD', 'SMOOTH']);
const NEUTRAL = new Set(['OK']);

export function idealShiftRpm(throttle) {
  const u = GRADING.upshift;
  const k = Math.min(1, Math.max(0, (throttle - 20) / 70));
  return u.idealLightThrottle + k * (u.idealFullThrottle - u.idealLightThrottle);
}

export class ShiftGrader {
  constructor(telemetry) {
    this.tel = telemetry;
    this.reset();
  }

  reset() {
    this.prevGear = null;
    this.pendingDown = null;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfectStreak = 0;
    this.score = 0;
    this.counts = {};
  }

  get multiplier() {
    return Math.min(GRADING.maxMultiplier, 1 + Math.floor(this.combo / GRADING.comboPerMultiplier));
  }

  update(frame, active) {
    const gear = frame.gear;
    if (active && this.pendingDown && frame.t - this.pendingDown.t >= GRADING.downshift.windowMs) {
      this.finishDownshift();
    }
    if (this.pendingDown) {
      const spike = Math.abs(frame.gLong - this.pendingDown.baseline);
      this.pendingDown.spike = Math.max(this.pendingDown.spike, spike);
    }

    if (gear !== null && this.prevGear !== null && gear !== this.prevGear && active) {
      if (gear > this.prevGear) this.gradeUpshift(frame, this.prevGear, gear);
      else this.startDownshift(frame, this.prevGear, gear);
    }
    if (gear !== null) this.prevGear = gear;
    if (frame.stopped) this.prevGear = null;
  }

  gradeUpshift(frame, from, to) {
    const u = GRADING.upshift;
    // only look at time spent in the gear we just left
    const before = this.tel.window(600, frame.t).filter((f) => f.gear === from);
    if (!before.length) return;
    const rpm = Math.max(...before.map((f) => f.rpm));
    const throttle = before.reduce((s, f) => s + f.throttle, 0) / before.length;
    if (throttle < u.minThrottle) return; // coasting shift, not graded

    const ideal = idealShiftRpm(throttle);
    const delta = rpm - ideal;
    let grade;
    if (rpm >= CAR.redlineRpm - 150) grade = 'LATE';
    else if (Math.abs(delta) <= u.perfectWindow) grade = 'PERFECT';
    else if (Math.abs(delta) <= u.goodWindow) grade = 'GOOD';
    else grade = delta < 0 ? 'EARLY' : 'LATE';
    if (frame.rpm < u.lugRpm && throttle > u.lugThrottle) grade = 'LUGGED';

    this.record({ dir: 'up', from, to, grade, rpm: Math.round(rpm), ideal: Math.round(ideal), delta: Math.round(delta) });
  }

  startDownshift(frame, from, to) {
    if (this.pendingDown) this.finishDownshift();
    const before = this.tel.window(300, frame.t);
    const baseline = before.reduce((s, f) => s + f.gLong, 0) / Math.max(1, before.length);
    this.pendingDown = { t: frame.t, from, to, baseline, spike: 0 };
  }

  finishDownshift() {
    const d = GRADING.downshift;
    const { from, to, spike } = this.pendingDown;
    this.pendingDown = null;
    const grade = spike < d.smoothSpike ? 'SMOOTH' : spike < d.okSpike ? 'OK' : 'ROUGH';
    this.record({ dir: 'down', from, to, grade, spike: Math.round(spike * 100) / 100 });
  }

  record(shift) {
    const { grade } = shift;
    this.counts[grade] = (this.counts[grade] ?? 0) + 1;

    if (CLEAN.has(grade)) this.combo++;
    else if (!NEUTRAL.has(grade)) this.combo = 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    if (grade === 'PERFECT' || grade === 'SMOOTH') this.perfectStreak++;
    else this.perfectStreak = 0;

    const multiplier = this.multiplier;
    const points = (GRADING.points[grade] ?? 0) * multiplier;
    this.score += points;
    emit('shift', { ...shift, points, combo: this.combo, multiplier, perfectStreak: this.perfectStreak });
  }
}
