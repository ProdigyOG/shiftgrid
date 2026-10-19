// G-force from the phone's motion sensors.
// Assumes the phone is mounted firmly, screen facing you, in landscape.
// calibrate() must run while the car is completely still: it learns which way
// is "down" so the reading works even if the phone is tilted back.
// NOTE: not yet checked in a real car. Signs (left/right, forward/back) may need flipping.

export class Motion {
  constructor() {
    this.acc = null; // latest acceleration without gravity, device axes, m/s^2
    this.grav = null; // latest acceleration including gravity
    this.down = null; // unit vector, device axes
    this.smooth = { gLong: 0, gLat: 0 };
    this.onEvent = (e) => {
      const a = e.acceleration;
      const g = e.accelerationIncludingGravity;
      if (g?.x != null) this.grav = [g.x, g.y, g.z];
      if (a?.x != null) this.acc = [a.x, a.y, a.z];
      else if (this.grav && this.down) {
        // no gravity-free reading: subtract the calibrated gravity instead
        this.acc = this.grav.map((v, i) => v + this.down[i] * 9.81);
      }
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
    await new Promise((r) => setTimeout(r, 400));
    if (!this.grav) throw new Error('Motion sensors are not sending data in this browser.');
  }

  calibrate() {
    if (!this.grav) return false;
    const n = Math.hypot(...this.grav);
    // accelerationIncludingGravity points "up" when still, so down is its opposite
    this.down = this.grav.map((v) => -v / n);
    return true;
  }

  read() {
    if (!this.acc || !this.down) return null;
    const d = this.down;
    // forward = out of the back of the phone (-z), flattened so it's level with the road
    const back = [0, 0, -1];
    const dot = back[0] * d[0] + back[1] * d[1] + back[2] * d[2];
    let f = back.map((v, i) => v - dot * d[i]);
    const fn = Math.hypot(...f) || 1;
    f = f.map((v) => v / fn);
    // right = down x forward
    const r = [d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], d[0] * f[1] - d[1] * f[0]];
    const a = this.acc;
    const gLong = (a[0] * f[0] + a[1] * f[1] + a[2] * f[2]) / 9.81;
    const gLat = (a[0] * r[0] + a[1] * r[1] + a[2] * r[2]) / 9.81;
    this.smooth.gLong += (gLong - this.smooth.gLong) * 0.3;
    this.smooth.gLat += (gLat - this.smooth.gLat) * 0.3;
    return { ...this.smooth };
  }

  disable() {
    window.removeEventListener('devicemotion', this.onEvent);
  }
}
