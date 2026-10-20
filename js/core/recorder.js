// Drive recorder: keeps every reading from the current drive so it can be
// saved as a spreadsheet file (CSV) and sent to Claude for tuning
// (gear ratios, shift points, throttle range, g-meter direction).

const MAX_ROWS = 72000; // about 2 hours at 10 readings a second

const COLUMNS = ['time_s', 'rpm', 'speed_kmh', 'throttle_pct', 'throttle_raw', 'load_pct', 'coolant_c', 'g_long', 'g_lat', 'gear_est'];

export class Recorder {
  constructor() {
    this.rows = [];
    this.meta = {};
    this.t0 = null;
  }

  start(meta) {
    this.rows = [];
    this.meta = { ...meta, started: new Date().toISOString() };
    this.t0 = null;
  }

  add(f) {
    if (this.rows.length >= MAX_ROWS) return;
    this.t0 ??= f.t;
    this.rows.push([
      ((f.t - this.t0) / 1000).toFixed(2),
      Math.round(f.rpm),
      f.speedKmh.toFixed(1),
      f.throttle.toFixed(1),
      f.throttleRaw != null ? f.throttleRaw.toFixed(1) : '',
      Math.round(f.load),
      Math.round(f.coolantC),
      f.gLong.toFixed(3),
      f.gLat.toFixed(3),
      f.gear ?? '',
    ]);
  }

  get hasData() {
    return this.rows.length > 0;
  }

  toCsv() {
    const head = Object.entries(this.meta).map(([k, v]) => `# ${k}: ${v}`);
    return [...head, COLUMNS.join(','), ...this.rows.map((r) => r.join(','))].join('\n');
  }

  filename() {
    const d = new Date(this.meta.started || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `shiftgrid-drive-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
  }

  // Phones: opens the share sheet (Save to Files, Mail, AirDrop...).
  // Computers: downloads the file. Returns what happened.
  async save() {
    const file = new File([this.toCsv()], this.filename(), { type: 'text/csv' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Shiftgrid drive data' });
        return 'shared';
      }
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return 'downloaded';
    } catch {
      return 'failed';
    }
  }
}
