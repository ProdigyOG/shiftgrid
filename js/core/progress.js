// Everything that's remembered between drives: XP and rank, badges,
// personal bests, daily challenge, drive history and settings.
// XP only ever comes from smooth, clean driving. Never from speed.

import { load, save, clear } from '../util/store.js';
import { emit } from '../util/bus.js';
import { DRIVING } from '../config.js';

export const RANKS = [
  { name: 'Rookie', xp: 0 },
  { name: 'Club Racer', xp: 500 },
  { name: 'Apex Hunter', xp: 1500 },
  { name: 'Pro', xp: 4000 },
  { name: 'GT Driver', xp: 9000 },
  { name: 'Endurance Ace', xp: 18000 },
  { name: 'Le Mans Legend', xp: 35000 },
];

export const BADGES = [
  { id: 'butter', name: 'Butter Hands', desc: '10 perfect shifts in a row' },
  { id: 'smoothop', name: 'Smooth Operator', desc: 'A 10+ minute drive with no harsh braking' },
  { id: 'gentle', name: 'Gentle Giant', desc: 'A 10+ minute drive, never braking past 0.3 g' },
  { id: 'coldstart', name: 'Cold Start Discipline', desc: '5 cold starts in a row without high revs' },
  { id: 'comboking', name: 'Combo King', desc: 'Reach a 10-shift combo' },
  { id: 'torque', name: 'Torque Respect', desc: '20+ graded upshifts in one drive, none lugged' },
  { id: 'lightsout', name: 'Lights Out', desc: 'Log your first 0–60' },
  { id: 'subfive', name: 'Sub-Five', desc: '0–60 in under 5.0 seconds' },
  { id: 'nightowl', name: 'Night Owl', desc: 'Start a drive between 10 pm and 4 am' },
  { id: 'tank', name: 'Tank to Tank', desc: 'Use a full tank of fuel across your drives' },
  { id: 'century', name: 'Century', desc: 'Finish 100 drives' },
  { id: 'daily7', name: 'Seven Up', desc: 'Complete 7 daily challenges' },
  { id: 'apex', name: 'Apex Predator', desc: 'Pull 1.0 g in a corner on Track Day' },
  { id: 'ghost', name: 'Ghost Buster', desc: 'Beat your ghost lap on Track Day' },
];

const CHALLENGES = [
  { id: 'perfect6', text: 'Land 6 PERFECT shifts', target: 6, paddle: true },
  { id: 'combo5', text: 'Build a 5-shift combo', target: 5, paddle: true },
  { id: 'down5', text: '5 SMOOTH downshifts', target: 5, paddle: true },
  { id: 'noharsh15', text: '15 minutes without harsh braking', target: 15 },
  { id: 'smooth90', text: 'Finish a 5+ min drive with smoothness 90+', target: 1 },
  { id: 'coldclean', text: 'Warm up gently: no high revs until warm', target: 1 },
];

const DEFAULTS = {
  xp: 0,
  badges: {},
  pbs: { zeroTo60: null, quarter: null, bestCombo: 0, bestLap: null, bestLapTrace: null, peakLatG: 0, bestSmooth: 0 },
  history: [],
  counters: { drives: 0, coldCleanStreak: 0, fuelUsed: 0, dailiesDone: 0 },
  daily: null,
};

const SETTINGS_DEFAULTS = {
  mode: 'game',
  source: 'sim', // 'sim' or 'car'
  skin: 'outrun',
  units: 'mph',
  paddle: true,
  sound: true,
  voice: true,
  voicePack: 'arcade', // 'arcade' or 'mine'
  voiceFx: true, // arcade effect on your own recordings too
  seenTrackWarning: false,
};

let profile = load('profile', DEFAULTS);
export const settings = load('settings', SETTINGS_DEFAULTS);

export const getProfile = () => profile;
export const saveSettings = () => save('settings', settings);
const persist = () => save('profile', profile);

export function resetProgress() {
  clear('profile');
  profile = structuredClone(DEFAULTS);
}

// ---- ranks ---------------------------------------------------------------

export function rankFor(xp = profile.xp) {
  let idx = 0;
  RANKS.forEach((r, i) => {
    if (xp >= r.xp) idx = i;
  });
  const next = RANKS[idx + 1];
  const floor = RANKS[idx].xp;
  return {
    idx,
    name: RANKS[idx].name,
    next: next?.name ?? null,
    progress: next ? (xp - floor) / (next.xp - floor) : 1,
    toNext: next ? next.xp - xp : 0,
  };
}

// ---- badges --------------------------------------------------------------

export function unlock(id) {
  if (profile.badges[id]) return false;
  profile.badges[id] = new Date().toISOString();
  persist();
  emit('badge', BADGES.find((b) => b.id === id));
  return true;
}

// ---- daily challenge -----------------------------------------------------

const todayKey = () => new Date().toLocaleDateString('en-CA');

export function dailyChallenge() {
  const key = todayKey();
  const pool = CHALLENGES.filter((c) => settings.paddle || !c.paddle);
  if (!profile.daily || profile.daily.date !== key || !pool.some((c) => c.id === profile.daily.id)) {
    const hash = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const pick = pool[hash % pool.length];
    profile.daily = { date: key, id: pick.id, progress: 0, done: false };
    persist();
  }
  const def = CHALLENGES.find((c) => c.id === profile.daily.id);
  return { ...def, ...profile.daily };
}

// Called from main.js as things happen during a drive.
export function dailyEvent(type, data, session) {
  const d = dailyChallenge();
  if (d.done) return;
  let progress = d.progress;
  if (d.id === 'perfect6' && type === 'shift' && data.grade === 'PERFECT') progress++;
  if (d.id === 'down5' && type === 'shift' && data.grade === 'SMOOTH') progress++;
  if (d.id === 'combo5' && type === 'shift') progress = Math.max(progress, data.combo);
  if (d.id === 'noharsh15' && type === 'tick') progress = Math.max(progress, Math.floor(session.minutesSinceHarsh));
  if (d.id === 'coldclean' && type === 'warm' && data.coldRevs === 0) progress = 1;
  if (d.id === 'smooth90' && type === 'end' && data.movingS >= 300 && data.avgSmooth >= 90) progress = 1;
  if (progress === d.progress) return;

  profile.daily.progress = Math.min(progress, d.target);
  if (profile.daily.progress >= d.target) {
    profile.daily.done = true;
    profile.counters.dailiesDone++;
    emit('daily', { text: d.text });
    if (profile.counters.dailiesDone >= 7) unlock('daily7');
  }
  persist();
}

// ---- live checks during a drive -----------------------------------------

export function liveCheck(type, data, mode) {
  if (type === 'shift') {
    if (data.perfectStreak >= 10) unlock('butter');
    if (data.combo >= 10) unlock('comboking');
  }
  if (type === 'launch') {
    unlock('lightsout');
    if (data.zeroTo60 < 5) unlock('subfive');
  }
  if (type === 'lap' && data.isBest && data.prevBest !== null) unlock('ghost');
  if (type === 'peakLat' && mode === 'track' && data.g >= 1.0) unlock('apex');
}

// ---- end of drive --------------------------------------------------------

// liveBadges: ids unlocked during the drive (they count towards this drive's XP)
export function finishDrive(s, bestLapTrace, liveBadges = []) {
  const rankBefore = rankFor();
  const badgesBefore = new Set(Object.keys(profile.badges));
  const pbs = profile.pbs;
  const newPBs = [];

  dailyEvent('end', s);

  if (s.bestZeroTo60 && (!pbs.zeroTo60 || s.bestZeroTo60 < pbs.zeroTo60)) {
    pbs.zeroTo60 = s.bestZeroTo60;
    newPBs.push(`0–60 in ${s.bestZeroTo60.toFixed(2)} s`);
  }
  if (s.quarter && (!pbs.quarter || s.quarter.time < pbs.quarter)) {
    pbs.quarter = s.quarter.time;
    newPBs.push(`Quarter mile in ${s.quarter.time.toFixed(2)} s`);
  }
  if (s.bestCombo > pbs.bestCombo) {
    pbs.bestCombo = s.bestCombo;
    newPBs.push(`Best combo x${s.bestCombo}`);
  }
  if (s.bestLap && (!pbs.bestLap || s.bestLap < pbs.bestLap)) {
    pbs.bestLap = s.bestLap;
    pbs.bestLapTrace = bestLapTrace;
    newPBs.push(`Best lap ${s.bestLap.toFixed(2)} s`);
  }
  if (s.mode === 'track' && s.peakLatG > pbs.peakLatG) pbs.peakLatG = s.peakLatG;
  if (s.movingS >= 300 && s.avgSmooth > pbs.bestSmooth) {
    pbs.bestSmooth = s.avgSmooth;
    newPBs.push(`Smoothest drive: ${s.avgSmooth}`);
  }

  const c = profile.counters;
  c.drives++;
  c.fuelUsed += s.fuelUsedPct;
  if (s.startedCold) c.coldCleanStreak = s.coldRevs === 0 ? c.coldCleanStreak + 1 : 0;

  const long = s.movingS >= 600;
  if (long && s.harshBrakes === 0) unlock('smoothop');
  if (long && s.peakBrakeG < DRIVING.gentleBrakeG) unlock('gentle');
  if (c.coldCleanStreak >= 5) unlock('coldstart');
  if (s.upshifts >= 20 && s.lugged === 0) unlock('torque');
  if (s.hour >= 22 || s.hour < 4) unlock('nightowl');
  if (c.fuelUsed >= 100) unlock('tank');
  if (c.drives >= 100) unlock('century');

  const newBadges = [...liveBadges, ...Object.keys(profile.badges).filter((id) => !badgesBefore.has(id))];
  const xp = {
    shifts: Math.round(s.score / 25),
    smooth: Math.max(0, Math.round((s.movingS / 60) * ((s.avgSmooth - 60) / 4))),
    daily: profile.daily?.done && profile.daily.awarded !== true ? 150 : 0,
    badges: newBadges.length * 100,
    coldRevs: -s.coldRevs * DRIVING.coldRevXpPenalty,
  };
  if (xp.daily) profile.daily.awarded = true;
  const xpGained = Math.max(0, Object.values(xp).reduce((a, b) => a + b, 0));
  profile.xp += xpGained;

  const record = { ...s, xpGained, grade: driveGrade(s) };
  profile.history.push(record);
  if (profile.history.length > 400) profile.history.shift();
  persist();

  const rankAfter = rankFor();
  return {
    record,
    xp,
    xpGained,
    newBadges: newBadges.map((id) => BADGES.find((b) => b.id === id)),
    newPBs,
    rankBefore,
    rankAfter,
    rankUp: rankAfter.idx > rankBefore.idx,
  };
}

// A to F report-card grade: mostly smoothness, plus shift quality and braking.
export function driveGrade(s) {
  let pts = s.avgSmooth * 0.6 + (s.cleanPct ?? s.avgSmooth) * 0.4;
  pts -= s.harshBrakes * 4 + s.coldRevs * 3;
  if (pts >= 90) return 'A';
  if (pts >= 80) return 'B';
  if (pts >= 70) return 'C';
  if (pts >= 60) return 'D';
  return 'F';
}

// ---- weekly trends -------------------------------------------------------

export function weeklyStats(weeks = 8) {
  const startOfWeek = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
    return x;
  };
  const thisWeek = startOfWeek(new Date());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(thisWeek);
    from.setDate(from.getDate() - i * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const drives = profile.history.filter((h) => {
      const d = new Date(h.date);
      return d >= from && d < to;
    });
    const moving = drives.reduce((a, h) => a + h.movingS, 0);
    const graded = drives.reduce((a, h) => a + h.graded, 0);
    const clean = drives.reduce((a, h) => a + (h.cleanPct ?? 0) * h.graded, 0);
    out.push({
      from,
      drives: drives.length,
      km: drives.reduce((a, h) => a + h.distKm, 0),
      smooth: moving ? Math.round(drives.reduce((a, h) => a + h.avgSmooth * h.movingS, 0) / moving) : null,
      cleanPct: graded ? Math.round(clean / graded) : null,
      harshPerHour: moving ? Math.round((drives.reduce((a, h) => a + h.harshBrakes, 0) / (moving / 3600)) * 10) / 10 : null,
      xp: drives.reduce((a, h) => a + h.xpGained, 0),
    });
  }
  return out;
}
