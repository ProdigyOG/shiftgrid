// Fake car for Phase 1. It produces the same readings the real car will
// (rpm, speed, throttle, temps, fuel, g-force) 20 times a second.
//
// Every data source (this simulator, the Phase 2 Bluetooth OBD reader,
// the Phase 3 in-car computer) follows the same shape:
//   source.start(onSample)   onSample({ t, rpm, speedKmh, throttle, load,
//                                       coolantC, intakeC, fuelPct, gLong, gLat })
//   source.stop()
// t is milliseconds. gLong is + when accelerating, - when braking. gLat is + to the right.

import { CAR, RPM_PER_KMH } from '../config.js';

const G = 9.81;
const STEP_S = 0.05; // one sample every 50 ms of simulated time

const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Simulator {
  constructor({ paddle = true, style = 'road' } = {}) {
    this.paddle = paddle; // true: a human-ish driver picks shift points (and makes mistakes)
    this.style = style; // 'road' or 'track'
    this.speedMult = 1;
    this.label = 'SIM';
    this.reset();
  }

  reset() {
    this.t = 0;
    this.v = 0; // m/s
    this.gear = 0; // index into gearRatios
    this.shift = null; // { from, to, left }
    this.thr = 0;
    this.brake = 0; // m/s^2
    this.coolant = 35;
    this.fuel = 78;
    this.cycle = 0;
    this.plan = [];
    this.seg = null;
    this.jolt = null; // short g-force spike after a downshift
    this.corner = null;
    this.nextCornerIn = rand(4, 8);
    this.shiftError = this.pickShiftError();
    this.lastAccel = 0;
  }

  start(onSample) {
    this.onSample = onSample;
    this.timer = setInterval(() => {
      for (let i = 0; i < this.speedMult; i++) this.onSample(this.step());
    }, STEP_S * 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  // ---- the pretend driver -------------------------------------------------

  buildCycle() {
    const track = this.style === 'track';
    const launch = this.cycle % 3 === 1;
    const harsh = Math.random() < 0.15;
    const cruise = track ? rand(110, 160) : rand(45, 75);
    this.cycle++;
    return [
      { kind: 'idle', dur: rand(3, 6) },
      launch
        ? { kind: 'accel', target: track ? 170 : 105, cap: 100 }
        : { kind: 'accel', target: cruise, cap: rand(28, 55) },
      { kind: 'cruise', target: launch ? cruise : cruise, dur: rand(10, 18) },
      { kind: 'accel', target: cruise + (track ? 40 : 30), cap: track ? 90 : rand(35, 55) },
      { kind: 'cruise', target: cruise + (track ? 40 : 30), dur: rand(8, 14) },
      { kind: 'brake', target: track ? 70 : 35, g: harsh ? 0.55 : rand(0.18, 0.32) },
      { kind: 'cruise', target: track ? 70 : 35, dur: rand(5, 8) },
      { kind: 'brake', target: 0, g: rand(0.15, 0.28) },
    ];
  }

  drive(dt) {
    if (!this.seg) {
      if (!this.plan.length) this.plan = this.buildCycle();
      this.seg = { ...this.plan.shift(), age: 0 };
    }
    const s = this.seg;
    s.age += dt;
    const kmh = this.v * 3.6;
    let want = 0;
    this.brake = 0;

    if (s.kind === 'idle') {
      if (s.age > s.dur) this.seg = null;
    } else if (s.kind === 'accel') {
      want = s.cap;
      if (kmh >= s.target) this.seg = null;
    } else if (s.kind === 'cruise') {
      const wobble = Math.sin(this.t / 2300) * 3;
      want = clamp(18 + (s.target + wobble - kmh) * 4, 0, 60);
      if (s.age > s.dur) this.seg = null;
    } else if (s.kind === 'brake') {
      // brake pressure builds up over half a second (harsh stops build faster)
      const ramp = s.g > 0.4 ? 0.25 : 0.6;
      this.brake = s.g * G * Math.min(1, s.age / ramp);
      if (kmh <= s.target + 0.5) {
        if (s.target === 0) this.v = 0;
        this.seg = null;
      }
    }
    const rate = want > this.thr ? 220 : 300; // % per second
    this.thr += clamp(want - this.thr, -rate * dt, rate * dt);
  }

  pickShiftError() {
    if (Math.random() < 0.1) return -rand(900, 1500); // occasionally shifts way too early
    if (Math.random() < 0.1) return rand(500, 900); // or holds it too long
    return gauss() * 280;
  }

  idealShiftRpm() {
    const k = clamp((this.thr - 20) / 70, 0, 1);
    return 2400 + k * (6200 - 2400);
  }

  gearbox(rpm) {
    if (this.shift) return;
    const top = CAR.gearRatios.length - 1;
    const braking = this.brake > 0;
    let to = null;

    if (this.gear < top && !braking && this.thr > 8) {
      const target = this.paddle ? this.idealShiftRpm() + this.shiftError : this.idealShiftRpm();
      if (rpm >= Math.min(target, CAR.redlineRpm)) to = this.gear + 1;
    }
    if (this.gear > 0 && rpm < (braking ? 1500 : 1150)) to = this.gear - 1;
    if (to === null) return;

    this.shift = { from: this.gear, to, left: to > this.gear ? 0.15 : 0.2 };
    if (to < this.gear) {
      // downshift: most are smooth, some are not
      const r = Math.random();
      const size = r < 0.7 ? rand(0.02, 0.06) : r < 0.9 ? rand(0.1, 0.16) : rand(0.22, 0.3);
      this.jolt = { size, age: 0 };
    }
    this.shiftError = this.pickShiftError();
  }

  // ---- physics ------------------------------------------------------------

  torqueCurve(rpm) {
    if (rpm < 1500) return 0.6 + (rpm / 1500) * 0.2;
    if (rpm < 3500) return 0.8 + ((rpm - 1500) / 2000) * 0.2;
    if (rpm < 5500) return 1;
    return 1 - ((rpm - 5500) / 1000) * 0.15;
  }

  engineRpm() {
    const kmh = this.v * 3.6;
    const wheelRpm = (g) => RPM_PER_KMH[g] * kmh;
    let rpm;
    if (this.shift) {
      const total = this.shift.to > this.shift.from ? 0.15 : 0.2;
      const k = 1 - this.shift.left / total;
      rpm = wheelRpm(this.shift.from) + (wheelRpm(this.shift.to) - wheelRpm(this.shift.from)) * k;
    } else {
      rpm = wheelRpm(this.gear);
    }
    // torque converter lets the engine rev above wheel speed when pulling away
    if (kmh < 25) rpm = Math.max(rpm, CAR.idleRpm + this.thr * 18 * (1 - kmh / 25));
    return clamp(Math.max(rpm, CAR.idleRpm), 0, CAR.redlineRpm + 80);
  }

  step() {
    const dt = STEP_S;
    this.t += dt * 1000;
    this.drive(dt);

    let rpm = this.engineRpm();
    this.gearbox(rpm);
    if (this.shift) {
      this.shift.left -= dt;
      if (this.shift.left <= 0) {
        this.gear = this.shift.to;
        this.shift = null;
      }
    }
    rpm = this.engineRpm();

    const ratio = CAR.gearRatios[this.shift ? this.shift.from : this.gear];
    let drive = (this.thr / 100) * G * 0.95 * Math.pow(ratio / 4.714, 0.85) * this.torqueCurve(rpm);
    drive = Math.min(drive, 0.78 * G); // traction limit
    if (rpm >= CAR.redlineRpm) drive *= 0.2; // rev limiter
    if (this.shift && this.shift.to > this.shift.from) drive *= 0.55;
    const drag = this.v > 0.1 ? 0.12 + 0.00035 * this.v * this.v + (this.thr < 3 ? 0.25 : 0) : 0;
    const accel = drive - drag - this.brake;
    this.v = Math.max(0, this.v + accel * dt);
    const realAccel = this.v > 0 ? accel : 0;

    // downshift jolt: a quick dip then a bounce
    let jolt = 0;
    if (this.jolt) {
      this.jolt.age += dt;
      const p = this.jolt.age / 0.3;
      jolt = p < 1 ? -this.jolt.size * Math.sin(p * Math.PI) : 0;
      if (p >= 1) this.jolt = null;
    }

    // corners while cruising
    let gLat = 0;
    const kmh = this.v * 3.6;
    if (this.corner) {
      this.corner.age += dt;
      const p = this.corner.age / this.corner.dur;
      gLat = this.corner.dir * ((this.v * this.v) / this.corner.radius / G) * Math.sin(p * Math.PI);
      if (p >= 1) this.corner = null;
    } else if (kmh > 25 && this.seg?.kind === 'cruise') {
      this.nextCornerIn -= dt;
      if (this.nextCornerIn <= 0) {
        const peakG = this.style === 'track' ? rand(0.6, 1.05) : rand(0.15, 0.4);
        this.corner = {
          age: 0,
          dur: rand(3, 6),
          dir: Math.random() < 0.5 ? -1 : 1,
          radius: (this.v * this.v) / (peakG * G),
        };
        this.nextCornerIn = rand(4, 9);
      }
    }

    this.coolant += (92 - this.coolant) * 0.015 * dt;
    this.fuel = Math.max(0, this.fuel - dt * (0.0008 + this.thr * 0.00003));
    const noise = () => (Math.random() - 0.5) * 0.03;

    return {
      t: this.t,
      rpm: Math.round(rpm + (Math.random() - 0.5) * 30),
      speedKmh: kmh,
      throttle: this.thr,
      load: clamp(this.thr * 0.85 + (rpm / CAR.redlineRpm) * 15, 0, 100),
      coolantC: this.coolant,
      intakeC: 31 + Math.sin(this.t / 60000) * 3,
      fuelPct: this.fuel,
      gLong: realAccel / G + jolt + noise(),
      gLat: gLat + noise(),
    };
  }
}
