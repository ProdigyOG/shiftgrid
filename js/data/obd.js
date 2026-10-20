// Live data from a Bluetooth LE OBD-II adapter (OBDLink CX), via Web Bluetooth.
// On iPhone this needs the Bluefy browser; Safari has no Web Bluetooth.
//
// Same shape as the simulator:
//   source.start(onSample)  ->  onSample({ t, rpm, speedKmh, throttle, load,
//                                          coolantC, intakeC, fuelPct, gLong, gLat })
// connect() must be called straight from a tap (browser rule).
//
// Adapters speak the ELM327 command language over a Bluetooth "serial" link.
// Makers use different Bluetooth service codes for that link, so we try the
// common ones. If the CX uses another, the test page shows what it reports.

import { load, save } from '../util/store.js';

const SERIAL_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
];

// Standard OBD-II readings (mode 01). `fast` ones are read every cycle,
// the rest every Nth cycle.
export const PIDS = {
  rpm: { pid: '0C', bytes: 2, fast: true, decode: (a, b) => (a * 256 + b) / 4 },
  speedKmh: { pid: '0D', bytes: 1, fast: true, decode: (a) => a },
  throttleRaw: { pid: '11', bytes: 1, fast: true, decode: (a) => (a * 100) / 255 },
  load: { pid: '04', bytes: 1, every: 4, decode: (a) => (a * 100) / 255 },
  coolantC: { pid: '05', bytes: 1, every: 25, decode: (a) => a - 40 },
  intakeC: { pid: '0F', bytes: 1, every: 25, decode: (a) => a - 40 },
  fuelPct: { pid: '2F', bytes: 1, every: 50, decode: (a) => (a * 100) / 255 },
};
const BY_PID = Object.fromEntries(Object.entries(PIDS).map(([name, p]) => [p.pid, { name, ...p }]));

// The throttle sensor doesn't read 0% with your foot off (on this car about 13%)
// or 100% flat out, so we learn the real range and rescale it to 0-100%.
// Until full throttle has been seen, assume the range is about 70% wide.
const THROTTLE_SPAN_GUESS = 70;

const INIT = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT2', 'ATSP0'];

export class ObdSource {
  constructor({ log = () => {}, motion = null } = {}) {
    this.log = log;
    this.motion = motion; // optional phone g-force (motion.js)
    this.label = 'CAR';
    this.values = { rpm: 0, speedKmh: 0, throttle: 0, throttleRaw: 0, load: 0, coolantC: 20, intakeC: 20, fuelPct: 0 };
    this.cal = load('car', { thrMin: null, thrMax: null });
    this.calSavedAt = 0;
    this.supported = null;
    this.multi = false;
    this.buffer = '';
    this.pending = null;
    this.running = false;
    this.rateHz = 0;
  }

  static available() {
    return !!navigator.bluetooth;
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error('This browser has no Bluetooth. On iPhone, open the page in the Bluefy app.');
    this.log('Asking for the adapter…');
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERIAL_SERVICES,
    });
    this.log(`Chosen: ${this.device.name || 'unnamed device'}`);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.log('Adapter disconnected.');
      this.running = false;
    });
    const server = await this.device.gatt.connect();
    const services = await server.getPrimaryServices();
    this.log(`Services: ${services.map((s) => short(s.uuid)).join(', ') || 'none'}`);

    // Only ever use a known serial (data) channel, in our preferred order.
    // Adapters also offer other channels, e.g. FEF5 on the CX is for firmware
    // updates. Never send commands to those.
    for (const wanted of SERIAL_SERVICES) {
      const service = services.find((s) => full(s.uuid) === wanted);
      if (!service) continue;
      const chars = await service.getCharacteristics();
      this.log(`  using ${short(service.uuid)}: ${chars.map((c) => `${short(c.uuid)}[${props(c)}]`).join(' ')}`);
      const notify = chars.find((c) => c.properties.notify || c.properties.indicate);
      const write = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (notify && write) {
        this.rx = notify;
        this.tx = write;
        break;
      }
    }
    if (!this.rx) throw new Error('Connected, but found no serial link. Send Claude a screenshot of this log.');
    await this.rx.startNotifications();
    this.rx.addEventListener('characteristicvaluechanged', (e) => this.onData(e.target.value));
    this.log('Serial link open. Setting up adapter…');

    for (const cmd of INIT) {
      const reply = await this.send(cmd, cmd === 'ATZ' ? 3000 : 2000);
      this.log(`${cmd} → ${reply || '(no reply)'}`);
      if (cmd === 'ATZ' && !reply) throw new Error('The adapter did not answer. Unplug it for 10 seconds, plug it back in and try again.');
    }

    // which readings does this car offer? (asked in ranges of 32)
    const sup = await this.send('0100', 6000);
    this.log(`0100 → ${sup}`);
    this.supported = parseSupported(sup, 0x00);
    if (!this.supported) throw new Error('The car did not answer. Is the ignition on?');
    for (const base of [0x20, 0x40]) {
      if (!this.supported.has(hex(base))) break;
      const cmd = `01${hex(base)}`;
      const more = await this.send(cmd, 3000);
      this.log(`${cmd} → ${more || '(no reply)'}`);
      parseSupported(more, base)?.forEach((pid) => this.supported.add(pid));
    }
    for (const [name, p] of Object.entries(PIDS)) {
      if (!this.supported.has(p.pid)) this.log(`Not available on this car: ${name}`);
    }

    // Talk to the engine computer only. Otherwise the gearbox computer answers
    // too, and the adapter waits for both. (Standard 11-bit CAN cars only.)
    const proto = await this.send('ATDPN');
    this.log(`Protocol: ${proto}`);
    if (/[68]$/.test(proto.trim())) {
      await this.send('ATSH7E0');
      if ((await this.readOne('rpm')) === null) {
        await this.send('ATSH7DF');
        this.log('Engine-only addressing did not work; asking all computers.');
      } else {
        this.log('Talking to the engine computer only.');
      }
    }

    // Ask for rpm, speed and throttle in one go, if the adapter allows it.
    const fast = this.fastPids();
    if (fast.length > 1) {
      const got = await this.readMany(fast);
      this.multi = got !== null && fast.every((n) => got[n] !== undefined);
      this.log(this.multi ? `Reading ${fast.join(', ')} together.` : 'Reading one value at a time.');
    }
    this.log('Ready.');
  }

  onData(view) {
    this.buffer += new TextDecoder().decode(view);
    const end = this.buffer.indexOf('>');
    if (end === -1 || !this.pending) return;
    const reply = this.buffer.slice(0, end).replace(/\s+/g, ' ').trim();
    this.buffer = this.buffer.slice(end + 1);
    const { resolve, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    resolve(reply);
  }

  // Send one command, wait for the ">" prompt that ends the reply.
  async send(cmd, timeoutMs = 1500) {
    const reply = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.buffer = '';
        resolve('');
      }, timeoutMs);
      this.pending = { resolve, timer };
    });
    const bytes = new TextEncoder().encode(`${cmd}\r`);
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
      else await this.tx.writeValue(chunk);
    }
    return reply;
  }

  fastPids() {
    return Object.keys(PIDS).filter((n) => PIDS[n].fast && this.supported?.has(PIDS[n].pid));
  }

  // Send a mode 01 request. The trailing "1" tells the adapter to stop after
  // the first answer (faster). Some adapters don't understand it; then we drop it.
  async request(pids) {
    let reply = await this.send(`01${pids.join('')}${this.noCount ? '' : '1'}`);
    if (!this.noCount && reply.includes('?')) {
      this.noCount = true;
      reply = await this.send(`01${pids.join('')}`);
    }
    return parseMode01(reply);
  }

  async readOne(name) {
    const got = await this.request([PIDS[name].pid]);
    return got?.[name] ?? null;
  }

  async readMany(names) {
    return this.request(names.map((n) => PIDS[n].pid));
  }

  setValues(got) {
    if (!got) return;
    for (const [k, v] of Object.entries(got)) if (v !== null && v !== undefined) this.values[k] = v;
    if (got.throttleRaw != null) this.values.throttle = this.scaleThrottle(got.throttleRaw);
  }

  scaleThrottle(raw) {
    const c = this.cal;
    let changed = false;
    if (c.thrMin === null || raw < c.thrMin) {
      c.thrMin = raw;
      changed = true;
    }
    if (c.thrMax === null || raw > c.thrMax) {
      c.thrMax = raw;
      changed = true;
    }
    if (changed && performance.now() - this.calSavedAt > 5000) {
      this.calSavedAt = performance.now();
      save('car', c);
    }
    const span = Math.max(c.thrMax - c.thrMin, THROTTLE_SPAN_GUESS);
    return Math.min(100, Math.max(0, ((raw - c.thrMin) / span) * 100));
  }

  start(onSample) {
    this.running = true;
    this.loop(onSample);
  }

  stop() {
    this.running = false;
    save('car', this.cal);
  }

  disconnect() {
    this.stop();
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* already gone */
    }
  }

  async loop(onSample) {
    let cycle = 0;
    let lastSpeed = null;
    let lastT = null;
    let gFromSpeed = 0;
    let count = 0;
    let rateStart = performance.now();
    while (this.running) {
      const fast = this.fastPids();
      if (this.multi) {
        this.setValues(await this.readMany(fast));
      } else {
        for (const name of fast) {
          if (!this.running) return;
          this.setValues({ [name]: await this.readOne(name) });
        }
      }
      for (const [name, p] of Object.entries(PIDS)) {
        if (!this.running) return;
        if (p.fast || cycle % p.every !== 0) continue;
        if (this.supported && !this.supported.has(p.pid)) continue;
        this.setValues({ [name]: await this.readOne(name) });
      }
      cycle++;

      const t = performance.now();
      // g-force: phone sensors if available, otherwise estimated from speed changes
      if (lastT !== null) {
        const dt = (t - lastT) / 1000;
        const raw = ((this.values.speedKmh - lastSpeed) / 3.6 / dt) / 9.81;
        gFromSpeed += (raw - gFromSpeed) * 0.4;
      }
      lastSpeed = this.values.speedKmh;
      lastT = t;
      const m = this.motion?.read();
      onSample({
        t,
        ...this.values,
        gLong: m ? m.gLong : gFromSpeed,
        gLat: m ? m.gLat : 0,
      });

      count++;
      if (t - rateStart > 2000) {
        this.rateHz = (count * 1000) / (t - rateStart);
        count = 0;
        rateStart = t;
      }
    }
  }
}

// Some browsers (Bluefy) report short codes like "FFF0"; make them all full and lowercase.
function full(uuid) {
  const u = String(uuid).toLowerCase();
  return /^[0-9a-f]{4}$/.test(u) ? `0000${u}-0000-1000-8000-00805f9b34fb` : u;
}

function short(uuid) {
  const u = full(uuid);
  return u.endsWith('-0000-1000-8000-00805f9b34fb') ? u.slice(4, 8).toUpperCase() : u;
}

function props(c) {
  const p = c.properties;
  return [p.read && 'r', p.write && 'w', p.writeWithoutResponse && 'wn', p.notify && 'n', p.indicate && 'i'].filter(Boolean).join('');
}

const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

// "4100BE3EB811" -> set of supported PIDs (base+1 .. base+32)
function parseSupported(reply, base) {
  const clean = reply.replace(/ /g, '');
  const at = clean.indexOf(`41${hex(base)}`);
  if (at === -1) return null;
  const bits = parseInt(clean.slice(at + 4, at + 12), 16);
  if (Number.isNaN(bits)) return null;
  const set = new Set();
  for (let i = 0; i < 32; i++) {
    if (bits & (1 << (31 - i))) set.add(hex(base + i + 1));
  }
  return set;
}

// Turn a mode 01 reply into { rpm: 1726, speedKmh: 60, ... }.
// Handles single answers ("410C1AF8") and the multi-line form the adapter
// uses for longer answers ("00A 0:410C1AF80D3C 1:1166...").
export function parseMode01(reply) {
  const data = reply
    .toUpperCase()
    .split(' ')
    .filter((tok) => !/^[0-9A-F]{3}$/.test(tok) && !tok.includes('SEARCHING'))
    .map((tok) => tok.replace(/^[0-9A-F]:/, ''))
    .join('');
  let i = data.indexOf('41');
  if (i === -1) return null;
  i += 2;
  const out = {};
  while (i + 2 <= data.length) {
    const p = BY_PID[data.slice(i, i + 2)];
    if (!p || i + 2 + p.bytes * 2 > data.length) break;
    const a = parseInt(data.slice(i + 2, i + 4), 16);
    const b = parseInt(data.slice(i + 4, i + 6), 16);
    out[p.name] = p.decode(a, b);
    i += 2 + p.bytes * 2;
  }
  return Object.keys(out).length ? out : null;
}
