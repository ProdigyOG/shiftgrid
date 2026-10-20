// Connection test page: connect to the adapter, show live readings and a log.

import { ObdSource } from './data/obd.js?v=2';
import { Motion } from './data/motion.js';
import { Telemetry } from './core/telemetry.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const status = (text) => ($('status').textContent = text);
const log = (line) => {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const tel = new Telemetry();
const motion = new Motion();
let motionOn = false;
let source = null;
let latest = null;

const stat = (value, label) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

function render() {
  const f = latest;
  const m = motionOn ? motion.read() : null;
  $('live').innerHTML = [
    stat(f ? Math.round(f.rpm) : '--', 'RPM'),
    stat(f ? Math.round(f.speedKmh / 1.609) : '--', 'MPH'),
    stat(f?.gear ?? '–', 'Gear (estimate)'),
    stat(f ? `${Math.round(f.throttle)}%` : '--', 'Throttle'),
    stat(f ? `${Math.round(f.load)}%` : '--', 'Engine load'),
    stat(f ? `${Math.round(f.coolantC)}°` : '--', 'Coolant'),
    stat(f ? `${Math.round(f.intakeC)}°` : '--', 'Intake air'),
    stat(f ? `${Math.round(f.fuelPct)}%` : '--', 'Fuel'),
    stat(source?.rateHz ? source.rateHz.toFixed(1) : '--', 'Updates / sec'),
    stat(m ? m.gLong.toFixed(2) : '--', 'G fwd/back'),
    stat(m ? m.gLat.toFixed(2) : '--', 'G left/right'),
  ].join('');
  requestAnimationFrame(render);
}
render();

if (!ObdSource.available()) {
  status('This browser has no Bluetooth. On iPhone, open this page in the Bluefy app.');
}

$('connect').addEventListener('click', async () => {
  source?.disconnect();
  source = new ObdSource({ log, motion: motionOn ? motion : null });
  status('Connecting…');
  try {
    await source.connect();
    status('Connected. Live readings below.');
    tel.reset();
    source.start((s) => (latest = tel.update(s)));
  } catch (err) {
    status(err.message || String(err));
    log(`ERROR: ${err.name || ''} ${err.message || err}`);
  }
});

$('motion').addEventListener('click', async () => {
  try {
    await motion.enable();
    motion.calibrate();
    motionOn = true;
    if (source) source.motion = motion;
    status('Motion sensor on. Keep the phone still: both G numbers should sit near 0.00.');
    log('Motion sensor calibrated.');
  } catch (err) {
    status(err.message || String(err));
    log(`MOTION: ${err.message || err}`);
  }
});
