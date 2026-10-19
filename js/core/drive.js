// One drive, from Start to Finish. Tracks smoothness, harsh braking,
// cornering g, engine warm-up and (Track Day only) ghost laps, and
// produces the summary used for the report card and weekly stats.

import { DRIVING, TRACK } from '../config.js';
import { emit } from '../util/bus.js';

export class DriveSession {
  constructor({ mode, sim, bestLapTrace }) {
    this.mode = mode;
    this.sim = sim;
    this.startedAt = new Date();
    this.firstT = null;
    this.lastT = null;
    this.movingS = 0;
    this.smoothSum = 0;
    this.smoothLive = 100;
    this.prevG = 0;
    this.harshBrakes = 0;
    this.harshSince = null;
    this.peakBrakeG = 0;
    this.peakLatG = 0;
    this.lastHarshMovingS = 0;
    this.coldRevs = 0;
    this.lastColdRevT = -Infinity;
    this.startedCold = null;
    this.warm = false;
    this.fuelStart = null;
    this.fuelNow = null;
    this.distStart = null;
    this.distNow = 0;
    this.shifts = [];
    this.launches = [];
    this.quarter = null;
    // ghost laps
    this.bestLapTrace = bestLapTrace ?? null;
    this.lap = null;
    this.laps = [];
    this.ghostDelta = null;
    this.newBestLapTrace = null;
  }

  update(f) {
    this.firstT ??= f.t;
    this.lastT = f.t;
    this.fuelStart ??= f.fuelPct;
    this.fuelNow = f.fuelPct;
    this.distStart ??= f.distM;
    this.distNow = f.distM;

    this.updateWarmUp(f);
    if (f.stopped || f.dt === 0) {
      this.prevG = f.gLongSmooth;
      return;
    }

    // smoothness: penalise sudden changes in g-force (jerk) and harsh braking
    this.movingS += f.dt;
    const jerk = Math.abs(f.gLongSmooth - this.prevG) / f.dt;
    this.prevG = f.gLongSmooth;
    let inst = 100 - Math.min(100, Math.max(0, (jerk - 0.4) * 35));

    const braking = -f.gLongSmooth;
    this.peakBrakeG = Math.max(this.peakBrakeG, braking);
    if (braking > DRIVING.harshBrakeG) {
      inst = Math.min(inst, 40);
      this.harshSince ??= f.t;
      if (f.t - this.harshSince >= DRIVING.harshBrakeMs && !this.harshCounted) {
        this.harshCounted = true;
        this.harshBrakes++;
        this.lastHarshMovingS = this.movingS;
        emit('harshBrake', { g: braking });
      }
    } else {
      this.harshSince = null;
      this.harshCounted = false;
    }
    this.smoothSum += inst * f.dt;
    this.smoothLive += (inst - this.smoothLive) * Math.min(1, f.dt / 15);

    this.peakLatG = Math.max(this.peakLatG, Math.abs(f.gLatSmooth));
    if (this.mode === 'track') this.updateGhost(f);
  }

  updateWarmUp(f) {
    const warm = f.coolantC >= DRIVING.coldCoolantC;
    if (this.startedCold === null) this.startedCold = !warm;
    if (warm && !this.warm && this.startedCold) emit('warm', { coldRevs: this.coldRevs });
    this.warm = warm;
    if (!warm && f.rpm > DRIVING.coldRevLimit && f.t - this.lastColdRevT > 10000) {
      this.lastColdRevT = f.t;
      this.coldRevs++;
      emit('coldRev', { rpm: f.rpm });
    }
  }

  // Phase 1: a "lap" is every TRACK.lapLengthM of distance.
  // Phase 2 will replace this with a GPS start/finish line.
  updateGhost(f) {
    const d = f.distM - this.distStart;
    if (!this.lap) this.lap = { startD: this.distStart, startT: f.t, trace: [0] };
    const lapD = f.distM - this.lap.startD;
    const elapsed = (f.t - this.lap.startT) / 1000;
    const idx = Math.floor(lapD / TRACK.traceStepM);
    while (this.lap.trace.length <= idx) this.lap.trace.push(elapsed);

    const best = this.bestLapTrace;
    this.ghostDelta = best && idx < best.length ? elapsed - best[idx] : null;

    if (lapD >= TRACK.lapLengthM) {
      const time = elapsed;
      const prevBest = best ? best[best.length - 1] : null;
      const isBest = prevBest === null || time < prevBest;
      if (isBest) {
        this.bestLapTrace = this.lap.trace;
        this.newBestLapTrace = this.lap.trace;
      }
      this.laps.push(time);
      emit('lap', { time, prevBest, isBest, number: this.laps.length });
      this.lap = { startD: f.distM, startT: f.t, trace: [0] };
    }
    return d;
  }

  addShift(e) {
    this.shifts.push(e.grade);
  }

  addLaunch(e) {
    this.launches.push(e);
  }

  // minutes since the last harsh brake, for the daily challenge
  get minutesSinceHarsh() {
    return (this.movingS - this.lastHarshMovingS) / 60;
  }

  get avgSmooth() {
    return this.movingS > 0 ? this.smoothSum / this.movingS : 100;
  }

  summary(shiftGrader) {
    const counts = shiftGrader.counts;
    const graded = this.shifts.length;
    const clean = this.shifts.filter((g) => ['PERFECT', 'GOOD', 'SMOOTH'].includes(g)).length;
    const upshifts = this.shifts.filter((g) => ['PERFECT', 'GOOD', 'EARLY', 'LATE', 'LUGGED'].includes(g)).length;
    return {
      date: this.startedAt.toISOString(),
      hour: this.startedAt.getHours(),
      mode: this.mode,
      sim: this.sim,
      durationS: Math.round(((this.lastT ?? 0) - (this.firstT ?? 0)) / 1000),
      movingS: Math.round(this.movingS),
      distKm: Math.round(((this.distNow - (this.distStart ?? 0)) / 1000) * 10) / 10,
      avgSmooth: Math.round(this.avgSmooth),
      harshBrakes: this.harshBrakes,
      peakBrakeG: round2(this.peakBrakeG),
      peakLatG: round2(this.peakLatG),
      shiftCounts: { ...counts },
      graded,
      upshifts,
      cleanPct: graded ? Math.round((clean / graded) * 100) : null,
      perfects: counts.PERFECT ?? 0,
      lugged: counts.LUGGED ?? 0,
      bestCombo: shiftGrader.bestCombo,
      score: shiftGrader.score,
      bestZeroTo60: this.launches.length ? Math.min(...this.launches.map((l) => l.zeroTo60)) : null,
      quarter: this.quarter,
      laps: this.laps,
      bestLap: this.laps.length ? Math.min(...this.laps) : null,
      coldRevs: this.coldRevs,
      startedCold: !!this.startedCold,
      fuelUsedPct: Math.max(0, round2((this.fuelStart ?? 0) - (this.fuelNow ?? 0))),
    };
  }
}

const round2 = (x) => Math.round(x * 100) / 100;
