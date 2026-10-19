// Draws the live dashboard: shift-light bar, speed, gear, g-meter,
// bottom readouts, background and the big grade banner.

import { CAR, BANNER_MS } from '../config.js';

const SEGMENTS = 15;
const RPM_FLOOR = 1000;
const $ = (id) => document.getElementById(id);

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

export class Hud {
  constructor() {
    this.dash = $('dash');
    this.bar = $('shiftbar');
    this.segs = Array.from({ length: SEGMENTS }, () => {
      const b = document.createElement('b');
      this.bar.appendChild(b);
      return b;
    });
    this.el = {
      speed: $('speed'),
      unit: $('speed-unit'),
      gear: $('gear'),
      combo: $('combo'),
      score: $('score'),
      chip: $('mode-chip'),
      ideal: $('ideal-mark'),
      a: $('readout-a'),
      b: $('readout-b'),
      c: $('readout-c'),
      banner: $('banner'),
      bannerMain: $('banner-main'),
      bannerSub: $('banner-sub'),
      parked: $('parked'),
      simChip: $('sim-chip'),
    };
    this.gCanvas = $('gdot');
    this.bgCanvas = $('bg-canvas');
    this.trail = [];
    this.gridOffset = 0;
    this.cache = {};
    this.bannerTimer = null;
  }

  setMode(mode, skin) {
    this.mode = mode;
    this.dash.dataset.mode = mode;
    this.el.chip.textContent = { chill: 'CHILL', game: 'GAME', track: 'TRACK DAY' }[mode];
    this.readColors();
    this.segs.forEach((s, i) => {
      const k = i / (SEGMENTS - 1);
      s.style.setProperty('--seg', k < 0.6 ? this.colors.a : k < 0.85 ? this.colors.b : this.colors.bad);
    });
    this.skin = skin;
  }

  readColors() {
    const app = document.getElementById('app');
    this.colors = {
      a: css(app, '--a'),
      b: css(app, '--b'),
      hot: css(app, '--hot'),
      bad: css(app, '--bad'),
      line: css(app, '--line'),
      dim: css(app, '--dim'),
      bg2: css(app, '--bg-2'),
    };
  }

  // Only touch the page when a value actually changes.
  set(key, el, html) {
    if (this.cache[key] === html) return;
    this.cache[key] = html;
    el.innerHTML = html;
  }

  render(f, s) {
    const rpmK = clamp01((f.rpm - RPM_FLOOR) / (CAR.redlineRpm - RPM_FLOOR));
    const speed = s.units === 'mph' ? f.speedKmh / 1.609 : f.speedKmh;
    this.set('speed', this.el.speed, String(Math.round(speed)));
    this.set('unit', this.el.unit, s.units === 'mph' ? 'MPH' : 'KM/H');
    this.set('gear', this.el.gear, f.gear ?? '–');

    // shift-light bar, plus shift assist: gold marker at the ideal point, flash when it's time
    const lit = Math.round(rpmK * SEGMENTS);
    this.segs.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    const showIdeal = s.mode !== 'chill' && s.assistIdeal !== null;
    this.el.ideal.hidden = !showIdeal;
    if (showIdeal) {
      this.el.ideal.style.left = `${clamp01((s.assistIdeal - RPM_FLOOR) / (CAR.redlineRpm - RPM_FLOOR)) * 100}%`;
    }
    this.bar.classList.toggle('flash', s.assistFlash);
    this.dash.classList.toggle('shift-now', s.assistFlash);

    this.set('combo', this.el.combo, s.combo >= 2 ? `x${s.multiplier} · ${s.combo} COMBO` : '');
    this.set('score', this.el.score, s.grading ? s.score.toLocaleString() : '');
    this.renderReadouts(f, s);

    this.el.parked.hidden = !s.canFinish;
    this.el.simChip.hidden = !s.sim;
    this.set('sim', this.el.simChip, `SIM ×${s.simSpeed}`);

    if (s.mode !== 'chill') this.drawG(f);
    this.drawBg(f, rpmK, s);
  }

  renderReadouts(f, s) {
    const temp = `${Math.round(f.coolantC)}°<em>COOLANT</em>`;
    const fuel = `${Math.round(f.fuelPct)}%<em>FUEL</em>`;
    if (s.mode === 'chill') {
      this.set('a', this.el.a, temp);
      this.set('b', this.el.b, `${Math.round(s.smooth)}<em>SMOOTHNESS</em>`);
      this.set('c', this.el.c, fuel);
      return;
    }
    if (s.locked) {
      const k = clamp01((f.coolantC - 35) / (s.warmAt - 35));
      this.set('a', this.el.a, temp);
      this.set(
        'b',
        this.el.b,
        `<div class="bar warmbar"><i style="width:${Math.round(k * 100)}%"></i></div><em>WARMING UP · GAME AT ${s.warmAt}°</em>`
      );
      this.set('c', this.el.c, fuel);
      return;
    }
    if (s.mode === 'track') {
      const d = s.ghostDelta;
      const ghost =
        d === null
          ? `--<em>GHOST · SETTING LAP</em>`
          : `<span class="${d <= 0 ? 'ahead' : 'behind'}">${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}</span><em>GHOST</em>`;
      this.set('a', this.el.a, `${s.peakLat.toFixed(2)}g<em>PEAK CORNER</em>`);
      this.set('b', this.el.b, ghost);
      this.set('c', this.el.c, `${s.lapTime ?? '--'}<em>LAP ${s.lapNo}</em>`);
      return;
    }
    this.set('a', this.el.a, `${s.peakLat.toFixed(2)}g<em>PEAK CORNER</em>`);
    this.set('b', this.el.b, `${Math.round(s.smooth)}<em>SMOOTHNESS</em>`);
    this.set('c', this.el.c, s.best060 ? `${s.best060.toFixed(2)}s<em>BEST 0–60</em>` : fuel);
  }

  // g-meter: dot moves up when accelerating, down when braking, sideways in corners
  drawG(f) {
    const c = this.gCanvas;
    const size = c.clientWidth;
    if (!size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const r = size / 2 - 4;
    const cx = size / 2;
    const scale = r / 1.2; // outer ring = 1.2 g

    g.strokeStyle = this.colors.line;
    g.lineWidth = 2;
    for (const ring of [0.5, 1.0]) {
      g.beginPath();
      g.arc(cx, cx, ring * scale, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - r, cx);
    g.lineTo(cx + r, cx);
    g.moveTo(cx, cx - r);
    g.lineTo(cx, cx + r);
    g.stroke();

    const x = cx + f.gLatSmooth * scale;
    const y = cx - f.gLongSmooth * scale;
    this.trail.push([x, y]);
    if (this.trail.length > 24) this.trail.shift();
    g.strokeStyle = this.colors.b;
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.beginPath();
    this.trail.forEach(([tx, ty], i) => (i ? g.lineTo(tx, ty) : g.moveTo(tx, ty)));
    g.stroke();
    g.globalAlpha = 1;

    g.fillStyle = this.colors.a;
    g.shadowColor = this.colors.a;
    g.shadowBlur = 16;
    g.beginPath();
    g.arc(x, y, Math.max(7, size * 0.06), 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
  }

  // Background: rpm-coloured glow, plus a moving grid floor on the Outrun look.
  drawBg(f, rpmK, s) {
    const c = this.bgCanvas;
    const W = c.clientWidth;
    const H = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // glow: cool blue at low rpm, through green and amber, to red near the limiter
    const hue = 200 - rpmK * 200;
    const glow = `hsla(${hue}, 100%, 55%, ${s.mode === 'chill' ? 0.38 : 0.2})`;
    this.dash.style.setProperty('--glow', `hsl(${hue}, 100%, 60%)`);
    const grad = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.6);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    if (this.skin !== 'outrun' || s.mode === 'chill') return;
    const horizon = H * 0.62;
    this.gridOffset = (this.gridOffset + (f.speedKmh / 3.6) * f.dt * 0.08) % 1;
    g.strokeStyle = this.colors.b;
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const z = (i + 1 - this.gridOffset) / 14;
      const y = horizon + (H - horizon) * z * z;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * W * 0.02, horizon);
      g.lineTo(W / 2 + i * W * 0.16, H);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  banner(main, sub = '', tone = 'good') {
    const b = this.el.banner;
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    b.className = `banner ${tone}`;
    b.hidden = false;
    // restart the pop animation
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (b.hidden = true), BANNER_MS);
  }

  clearBanner() {
    clearTimeout(this.bannerTimer);
    this.el.banner.hidden = true;
  }
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
