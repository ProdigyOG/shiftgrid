// G-force from the phone's motion sensors.
//
// 1. calibrate() runs while the car is still: it learns which way is "down",
//    so a tilted phone still reads correctly.
// 2. Which way is "forward" depends on how the phone sits in the mount, so
//    the app LEARNS it while you drive: whenever the car speeds up or slows
//    down (known from the speed readings), it checks which way the phone felt
//    the push. The answer is remembered for next time.
// 3. Engine vibration is smoothed out at the sensor's full rate (~60/s).
//
// Real-car check (2026-10-20): the first drive showed forward/back reversed
// with the old fixed assumption, which is why it now learns instead.

import { load, save } from '../util/store.js';

const SMOOTH_S = 0.3; // vibration filter time constant
const LEARN_MIN_G = 0.05; // only learn from real speed changes
const LEARN_ENOUGH = 0.6; // sum of g^2 needed before trusting the learned direction

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const n = Math.hypot(...a) || 1;
  return a.map((v) => v / n);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flatten = (v, down) => {
  const k = dot(v, down);
  return v.map((x, i) => x - k * down[i]);
};

export class Motion {
  constructor() {
    this.grav = null; // acceleration including gravity, smoothed (device axes, m/s^2)
    this.acc = [0, 0, 0]; // acceleration without gravity, smoothed
    this.down = null;
    this.lastT = null;
    const saved = load('motion', { down: null, forward: null });
    this.saved = saved;
    this.forward = null;
    this.learnSum = [0, 0, 0];
    this.learnWeight = 0;

    this.onEvent = (e) => {
      // use the sensor's own timestamp (ms) so the filter matches its real rate
      const now = e.timeStamp ?? performance.now();
      const dt = this.lastT !== null ? Math.min(0.2, Math.max(0, (now - this.lastT) / 1000)) : 0.016;
      this.lastT = now;
      const k = 1 - Math.exp(-dt / SMOOTH_S);
      const g = e.accelerationIncludingGravity;
      if (g?.x == null) return;
      const gv = [g.x, g.y, g.z];
      this.grav = this.grav ? this.grav.map((v, i) => v + (gv[i] - v) * k) : gv;
      const a = e.acceleration;
      // without a gravity-free reading, subtract the calibrated gravity instead
      const av = a?.x != null ? [a.x, a.y, a.z] : this.down ? gv.map((v, i) => v + this.down[i] * 9.81) : null;
      if (av) this.acc = this.acc.map((v, i) => v + (av[i] - v) * k);
    };
  }

  // Must be called from a tap on iPhone.
  async enable() {
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('No motion sensors in this browser.');
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion access was not allowed.');
    }
    window.addEventListener('devicemotion', this.onEvent);
    await new Promise((r) => setTimeout(r, 500));
    if (!this.grav) throw new Error('Motion sensors are not sending data in this browser.');
  }

  calibrate() {
    if (!this.grav) return false;
    // accelerationIncludingGravity points "up" when still, so down is its opposite
    this.down = norm(this.grav.map((v) => -v));
    // reuse the learned forward direction if the phone sits the same way as last time
    const s = this.saved;
    if (s.down && s.forward && dot(s.down, this.down) > 0.97) this.forward = norm(flatten(s.forward, this.down));
    this.learnSum = this.forward ? this.forward.map((v) => v * LEARN_ENOUGH) : [0, 0, 0];
    this.learnWeight = this.forward ? LEARN_ENOUGH : 0;
    return true;
  }

  get learned() {
    return this.learnWeight >= LEARN_ENOUGH;
  }

  // Called with the car's acceleration worked out from speed readings (in g).
  learn(gFromSpeed) {
    if (!this.down || Math.abs(gFromSpeed) < LEARN_MIN_G) return;
    const h = flatten(this.acc, this.down);
    this.learnSum = this.learnSum.map((v, i) => v + h[i] * gFromSpeed);
    this.learnWeight += gFromSpeed * gFromSpeed;
    const dir = flatten(this.learnSum, this.down);
    if (this.learned && Math.hypot(...dir) > 1e-6) {
      this.forward = norm(dir);
      if (!this.savedAt || performance.now() - this.savedAt > 10000) {
        this.savedAt = performance.now();
        save('motion', { down: this.down, forward: this.forward });
      }
    }
  }

  // { gLong, gLat }, or null until "forward" has been learned
  // (until then the app uses g-force worked out from speed instead).
  read() {
    if (!this.down || !this.forward) return null;
    const f = this.forward;
    const right = cross(this.down, f);
    return { gLong: dot(this.acc, f) / 9.81, gLat: dot(this.acc, right) / 9.81 };
  }

  disable() {
    window.removeEventListener('devicemotion', this.onEvent);
  }
}
