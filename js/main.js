// Wires everything together:
//   data source -> telemetry -> graders/timers/session -> events -> screen, sound, progress
// To use the real car later, only the data source changes (see startDrive).

import { APP_NAME, DRIVING } from './config.js';
import { on } from './util/bus.js';
import { Simulator } from './data/simulator.js';
import { ObdSource } from './data/obd.js';
import { Motion } from './data/motion.js';
import { Telemetry } from './core/telemetry.js';
import { ShiftGrader } from './core/shifts.js';
import { ShiftAssist } from './core/shiftassist.js';
import { LaunchTimer } from './core/launch.js';
import { DriveSession } from './core/drive.js';
import * as progress from './core/progress.js';
import { settings, saveSettings } from './core/progress.js';
import { Hud } from './ui/hud.js';
import { sfx, unlock as unlockAudio } from './ui/audio.js';
import * as voice from './ui/voice.js';
import { playBoot } from './ui/boot.js';
import * as screens from './ui/screens.js';
import { openMyVoice } from './ui/myvoice.js';

const tel = new Telemetry();
const grader = new ShiftGrader(tel);
const launch = new LaunchTimer();
const assist = new ShiftAssist(tel);
let assistState = { ideal: null, flashing: false };
const hud = new Hud();

let source = null;
let car = null; // stays connected between drives
let session = null;
let latest = null;
let liveBadges = [];
let stoppedSince = null;
let throttleSmooth = 0;
let lastDailyTick = 0;
let trackAcknowledged = false;
let wakeLock = null;

const MODES = ['chill', 'game', 'track'];
const SIM_SPEEDS = [1, 2, 4];

// ---- boot ------------------------------------------------------------------

function boot() {
  voice.loadLines();
  const app = document.getElementById('app');
  app.dataset.skin = settings.skin;
  const v = (n) => getComputedStyle(app).getPropertyValue(n).trim();
  playBoot(document.getElementById('boot-canvas'), {
    title: APP_NAME,
    colors: { a: v('--a'), b: v('--b'), grid: v('--line'), text: v('--text') },
    onDone: goHome,
  });
}

function goHome() {
  screens.renderHome();
  screens.showScreen('home');
}

// ---- buttons ---------------------------------------------------------------

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { set, value, toggle, action } = btn.dataset;

  if (set) {
    settings[set] = value;
    saveSettings();
    screens.renderHome();
  } else if (toggle) {
    if (toggle === 'units') settings.units = settings.units === 'mph' ? 'kmh' : 'mph';
    else settings[toggle] = !settings[toggle];
    saveSettings();
    screens.renderHome();
  } else if (action) {
    actions[action]?.();
  }
});

const actions = {
  start: startDrive,
  home: goHome,
  stats: screens.renderStats,
  badges: screens.renderBadges,
  myvoice: openMyVoice,
  reset: screens.renderResetConfirm,
  'reset-confirm': () => {
    progress.resetProgress();
    goHome();
  },
  'track-ok': () => {
    trackAcknowledged = true;
    startDrive();
  },
  finish: finishDrive,
  'cycle-mode': () => {
    if (!session) return;
    const allowed = trackAcknowledged ? MODES : MODES.filter((m) => m !== 'track');
    const next = allowed[(allowed.indexOf(session.mode) + 1) % allowed.length];
    session.mode = next;
    settings.mode = next;
    saveSettings();
    if (source) source.style = next === 'track' ? 'track' : 'road';
    hud.setMode(next, settings.skin);
  },
  'sim-speed': () => {
    if (!(source instanceof Simulator)) return;
    source.speedMult = SIM_SPEEDS[(SIM_SPEEDS.indexOf(source.speedMult) + 1) % SIM_SPEEDS.length];
  },
};

// ---- a drive ---------------------------------------------------------------

async function connectCar() {
  car?.disconnect();
  car = new ObdSource({ log: (line) => console.log('[obd]', line) });
  screens.setCarNote('Connecting…');
  screens.renderHome();
  try {
    await car.connect();
    screens.setCarNote('Car connected. Keep the phone still in its mount and tap Start drive.');
  } catch (err) {
    car = null;
    screens.setCarNote(`${err.message || err} Try the Adapter connection test for details.`);
  }
  screens.renderHome();
}

async function startDrive() {
  if (settings.mode === 'track' && !trackAcknowledged) return screens.renderTrackWarning();

  // Car: the first tap connects Bluetooth (the browser needs a tap for that),
  // the second tap starts the drive.
  if (settings.source === 'car' && !car?.device?.gatt?.connected) return connectCar();

  unlockAudio();
  voice.preload().then(() => session && voice.announce(['start'], { priority: true }));
  navigator.wakeLock?.request('screen').then((l) => (wakeLock = l), () => {});

  tel.reset();
  grader.reset();
  launch.reset();
  assist.reset();
  liveBadges = [];
  stoppedSince = null;
  latest = null;
  session = new DriveSession({
    mode: settings.mode,
    sim: settings.source !== 'car',
    bestLapTrace: progress.getProfile().pbs.bestLapTrace,
  });

  if (settings.source === 'car') {
    // phone g-force: calibrated now, while parked and still
    const motion = new Motion();
    try {
      await motion.enable();
      motion.calibrate();
      car.motion = motion;
    } catch {
      car.motion = null; // falls back to g-force estimated from speed
    }
    source = car;
  } else {
    source = new Simulator({ paddle: settings.paddle, style: settings.mode === 'track' ? 'track' : 'road' });
  }

  hud.setMode(settings.mode, settings.skin);
  hud.clearBanner();
  screens.showScreen('drive');
  source.start(onSample);
}

function onSample(sample) {
  if (!session) return;
  const f = tel.update(sample);
  const gamey = session.mode !== 'chill';
  const locked = gamey && f.coolantC < DRIVING.coldCoolantC;

  grader.update(f, gamey && !locked && settings.paddle);
  launch.update(f, { enabled: gamey && !locked, quarterMile: session.mode === 'track' });

  const peakBefore = session.peakLatG;
  session.update(f);
  if (session.peakLatG > peakBefore) progress.liveCheck('peakLat', { g: session.peakLatG }, session.mode);
  if (f.t - lastDailyTick > 5000 || f.t < lastDailyTick) {
    lastDailyTick = f.t;
    progress.dailyEvent('tick', {}, session);
  }

  throttleSmooth += (f.throttle - throttleSmooth) * 0.1;
  // shift assist only makes sense when you're the one shifting (paddles)
  assistState = assist.update(f, { enabled: settings.shiftAssist && settings.paddle, throttle: throttleSmooth });
  stoppedSince = f.stopped ? (stoppedSince ?? f.t) : null;
  latest = { f, locked };
}

function finishDrive() {
  if (!session) return;
  source.stop();
  const summary = session.summary(grader);
  const trace = session.newBestLapTrace;
  const badges = liveBadges.map((b) => b.id);
  session = null;
  source = null;
  hud.clearBanner();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  const result = progress.finishDrive(summary, trace, badges);
  screens.renderReport(result);
}

// ---- what happens on each event ---------------------------------------------

const BAD = new Set(['EARLY', 'LATE', 'LUGGED', 'ROUGH']);

on('shift', (e) => {
  if (!session) return;
  session.addShift(e);
  progress.liveCheck('shift', e, session.mode);
  progress.dailyEvent('shift', e, session);

  let sub = e.points ? `+${e.points}${e.multiplier > 1 ? `  x${e.multiplier}` : ''}` : '';
  if (e.grade === 'EARLY') sub = `${Math.abs(e.delta)} rpm early`;
  if (e.grade === 'LATE') sub = `${Math.abs(e.delta)} rpm late`;
  if (e.grade === 'LUGGED') sub = 'Revs too low';
  if (e.grade === 'ROUGH') sub = `${e.spike} g jolt`;
  const tone = e.grade === 'PERFECT' ? 'great' : BAD.has(e.grade) ? 'bad' : 'good';
  hud.banner(e.grade, sub, tone);

  if (e.grade === 'LUGGED') sfx.lugged();
  else if (BAD.has(e.grade)) sfx.miss();
  else if (e.grade === 'OK') sfx.ok();
  else sfx.clean(e.combo);

  const combo = e.combo > 0 ? voice.comboKey(e.combo) : null;
  if (combo) voice.announce([combo]);
  else if (e.grade !== 'OK') voice.announce([e.grade.toLowerCase()]);
});

on('shiftCue', () => session && sfx.shiftCue());

on('launch', (e) => {
  if (!session) return;
  session.addLaunch(e);
  progress.liveCheck('launch', e, session.mode);
  hud.banner(`${e.zeroTo60.toFixed(2)}s`, `0–60 · ${e.grade} launch`, 'great');
  sfx.launch();
  const t = voice.numberKeys(e.zeroTo60);
  voice.announce(t ? ['launch', ...t, 'seconds'] : ['launch'], { priority: true });
});

on('quarter', (e) => {
  if (!session) return;
  session.quarter = e;
  const trap = settings.units === 'mph' ? `${Math.round(e.trapKmh / 1.609)} mph` : `${Math.round(e.trapKmh)} km/h`;
  hud.banner(`${e.time.toFixed(2)}s`, `Quarter mile · ${trap}`, 'great');
  sfx.launch();
  const t = voice.numberKeys(e.time);
  voice.announce(t ? ['quarter', ...t, 'seconds'] : ['quarter'], { priority: true });
});

on('lap', (e) => {
  if (!session) return;
  progress.liveCheck('lap', e, session.mode);
  hud.banner(e.isBest ? 'NEW BEST' : `LAP ${e.number}`, `${e.time.toFixed(2)}s`, e.isBest ? 'great' : 'good');
  sfx.badge();
  voice.announce(e.isBest ? ['new_best'] : e.number <= 20 ? ['lap', `n${e.number}`] : ['lap'], { priority: true });
});

on('harshBrake', () => {
  if (!session) return;
  sfx.soft();
  if (session.mode !== 'chill') hud.banner('HARSH BRAKE', 'Smoothness hit', 'bad');
});

on('warm', () => {
  if (!session || session.mode === 'chill') return;
  hud.banner('GAME ON', 'Engine warm', 'great');
  sfx.warm();
  voice.announce(['game_on'], { priority: true });
});

on('coldRev', () => {
  if (!session) return;
  hud.banner('EASY', 'Engine still cold', 'bad');
  sfx.soft();
  voice.announce(['cold']);
});

on('warm', (e) => session && progress.dailyEvent('warm', e, session));

on('badge', (b) => {
  if (!session) return; // badges earned at the end show on the report card
  liveBadges.push(b);
  setTimeout(() => {
    if (!session) return;
    hud.banner('BADGE', b.name, 'great');
    sfx.badge();
    voice.announce(['badge', `badge_${b.id}`], { priority: true });
  }, 1600);
});

on('daily', (e) => {
  if (!session) return;
  setTimeout(() => {
    if (!session) return;
    hud.banner('DAILY DONE', e.text, 'great');
    sfx.badge();
    voice.announce(['daily'], { priority: true });
  }, 1600);
});

// ---- drawing loop -------------------------------------------------------------

function frame() {
  if (latest && session) {
    const { f, locked } = latest;
    const lap = session.lap;
    hud.render(f, {
      mode: session.mode,
      units: settings.units,
      grading: settings.paddle && !locked && session.mode !== 'chill',
      assistIdeal: assistState.ideal,
      assistFlash: assistState.flashing,
      combo: grader.combo,
      multiplier: grader.multiplier,
      score: grader.score,
      smooth: session.smoothLive,
      locked,
      warmAt: DRIVING.coldCoolantC,
      ghostDelta: session.ghostDelta,
      lapTime: lap ? ((f.t - lap.startT) / 1000).toFixed(1) : null,
      lapNo: session.laps.length + 1,
      peakLat: session.peakLatG,
      best060: progress.getProfile().pbs.zeroTo60 ?? (session.launches[0]?.zeroTo60 || null),
      canFinish: stoppedSince !== null && f.t - stoppedSince > 2000,
      sim: source instanceof Simulator,
      simSpeed: source?.speedMult ?? 1,
    });
  }
  requestAnimationFrame(frame);
}

boot();
requestAnimationFrame(frame);
