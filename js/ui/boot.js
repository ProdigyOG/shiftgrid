// Startup animation: a wireframe sports coupe spins up over a neon grid.
// The car is a generic long-bonnet coupe built from cross-sections, no logos.

// Cross-sections from nose (x = +2.23 m) to tail (x = -2.23 m):
// [x, half-width, beltline height, roof height, roof half-width]
const SECTIONS = [
  [2.23, 0.7, 0.55, 0.55, 0.55],
  [2.05, 0.86, 0.62, 0.62, 0.7],
  [1.6, 0.93, 0.72, 0.72, 0.78],
  [1.35, 0.95, 0.75, 0.75, 0.8],
  [0.9, 0.94, 0.8, 0.8, 0.8],
  [0.45, 0.94, 0.84, 0.86, 0.72],
  [0.0, 0.95, 0.86, 1.2, 0.56],
  [-0.6, 0.96, 0.88, 1.26, 0.55],
  [-1.1, 0.98, 0.92, 1.1, 0.6],
  [-1.35, 0.99, 0.94, 1.02, 0.7],
  [-1.75, 0.95, 0.96, 0.98, 0.78],
  [-2.1, 0.86, 0.92, 0.92, 0.72],
  [-2.23, 0.72, 0.82, 0.82, 0.6],
];
const WHEELS = [1.35, -1.35];

function ring([x, w, belt, roof, rw]) {
  const side = (s) => [
    [x, 0.16, s * w * 0.86],
    [x, 0.34, s * w],
    [x, belt, s * w],
    [x, roof, s * rw],
  ];
  const right = side(1);
  const left = side(-1).reverse();
  return [...right, ...left];
}

function wheel(x, z, r = 0.34, n = 14) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [x + Math.cos(a) * r, 0.34 + Math.sin(a) * r, z];
  });
}

export function playBoot(canvas, { title, colors, onDone }) {
  const g = canvas.getContext('2d');
  const rings = SECTIONS.map(ring);
  const wheels = WHEELS.flatMap((x) => [wheel(x, 0.92), wheel(x, -0.92)]);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const total = reduce ? 900 : 3400;
  let start = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    canvas.removeEventListener('pointerdown', finish);
    onDone();
  };
  canvas.addEventListener('pointerdown', finish);

  function frame(now) {
    if (done) return;
    start ??= now;
    const t = (now - start) / total;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // spin: fast at first, easing to a 3/4 hero angle
    const ease = 1 - Math.pow(1 - Math.min(1, t), 3);
    const angle = -0.6 + (1 - ease) * Math.PI * 4;
    const scale = Math.min(W, H * 1.8) * 0.12;
    const cx = W / 2;
    const cy = H * 0.62;
    const project = ([x, y, z]) => {
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const rx = x * ca - z * sa;
      const rz = x * sa + z * ca;
      // tilt camera down a little
      const ty = y - 0.5;
      const py = ty * 0.9 + rz * 0.44;
      const pz = rz * 0.9 - ty * 0.44 + 7;
      const f = 7 / pz;
      return [cx + rx * scale * f, cy - py * scale * f];
    };

    // grid floor
    g.lineWidth = 1;
    g.strokeStyle = colors.grid;
    g.globalAlpha = Math.min(1, t * 2) * 0.6;
    for (let i = -6; i <= 6; i++) {
      line(g, project([i * 0.8, -0.02, -5]), project([i * 0.8, -0.02, 5]));
      line(g, project([-5, -0.02, i * 0.8]), project([5, -0.02, i * 0.8]));
    }
    g.globalAlpha = 1;

    // car: draw progressively as it spins up
    const reveal = Math.min(1, t * 1.6);
    g.shadowBlur = 14;
    g.shadowColor = colors.a;
    g.strokeStyle = colors.a;
    g.lineWidth = 1.6;
    const shown = Math.ceil(rings.length * reveal);
    rings.slice(0, shown).forEach((r) => poly(g, r.map(project), true));
    g.strokeStyle = colors.b;
    g.shadowColor = colors.b;
    for (let k = 0; k < rings[0].length; k++) {
      g.beginPath();
      rings.slice(0, shown).forEach((r, i) => {
        const [px, py] = project(r[k]);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
    if (reveal >= 1) wheels.forEach((w) => poly(g, w.map(project), true));
    g.shadowBlur = 0;

    // title
    if (t > 0.55) {
      const a = Math.min(1, (t - 0.55) * 4);
      g.globalAlpha = a;
      g.fillStyle = colors.text;
      g.textAlign = 'center';
      g.font = `400 ${Math.round(Math.min(W, 900) * 0.07)}px Michroma, "Chakra Petch", sans-serif`;
      g.fillText(title, cx, H * 0.22);
      g.globalAlpha = 1;
    }

    if (t >= 1.25) finish();
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function line(g, [x1, y1], [x2, y2]) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function poly(g, pts, close) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
  g.stroke();
}
