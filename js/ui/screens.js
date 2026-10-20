// The screens you use while parked: garage (home), report card,
// weekly stats and badges. Each one just fills in HTML.

import { settings, getProfile, rankFor, dailyChallenge, weeklyStats, BADGES } from '../core/progress.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
}

const MODE_NOTES = {
  chill: 'Clean and calm: speed, gear, a glow that follows the revs, and a quiet smoothness score.',
  game: 'Shift grading, combos, launch and 0–60 timer. Locks until the engine is warm.',
  track: 'Everything in Game, plus quarter-mile timer and ghost laps. For closed circuits only, never public roads.',
};

let carNote = '';
export const setCarNote = (text) => (carNote = text);

export function renderHome() {
  const p = getProfile();
  const rank = rankFor();
  $('home-rank').innerHTML = `
    <div class="rank-name">${rank.name}</div>
    <div class="bar"><i style="width:${Math.round(rank.progress * 100)}%"></i></div>
    <div class="rank-sub">${p.xp.toLocaleString()} XP${rank.next ? ` · ${rank.toNext.toLocaleString()} to ${rank.next}` : ' · top rank'}</div>`;

  const d = dailyChallenge();
  const daily = $('home-daily');
  daily.classList.toggle('done', d.done);
  daily.innerHTML = `
    <div class="daily-top"><span>Daily challenge</span><span>${d.done ? 'Done · +150 XP' : `${d.progress} / ${d.target}`}</span></div>
    <div class="daily-text">${esc(d.text)}</div>
    <div class="bar"><i style="width:${Math.round((d.progress / d.target) * 100)}%"></i></div>`;

  for (const b of document.querySelectorAll('[data-set]')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings[b.dataset.set] === b.dataset.value));
  }
  for (const b of document.querySelectorAll('[data-toggle]')) {
    const key = b.dataset.toggle;
    b.setAttribute('aria-pressed', key === 'units' ? 'true' : String(settings[key]));
  }
  $('units-label').textContent = settings.units === 'mph' ? 'Units: mph' : 'Units: km/h';
  const note = $('mode-note');
  note.textContent = MODE_NOTES[settings.mode];
  note.classList.toggle('warn', settings.mode === 'track');
  document.getElementById('app').dataset.skin = settings.skin;
  $('car-note').textContent =
    settings.source === 'car'
      ? carNote || 'Plug in the adapter, turn the ignition on, then tap Start drive to connect. Use the Bluefy app on iPhone.'
      : 'Simulated driving data, for trying things out.';
  $('car-note').classList.toggle('warn', settings.source === 'car' && !!carNote);
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const stat = (value, label) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

// hasRecording: show the "Save drive data" button
export function renderReport(result, { hasRecording = false } = {}) {
  const r = result.record;
  const dist = settings.units === 'mph' ? `${(r.distKm / 1.609).toFixed(1)} mi` : `${r.distKm} km`;
  const highlights = [];
  if (result.rankUp) highlights.push(`Rank up! You're now <b>${result.rankAfter.name}</b>`);
  result.newBadges.forEach((b) => highlights.push(`Badge unlocked: <b>${esc(b.name)}</b>`));
  result.newPBs.forEach((pb) => highlights.push(`New personal best: ${esc(pb)}`));
  if (r.bestCombo >= 3) highlights.push(`Longest combo: x${r.bestCombo}`);
  if (r.harshBrakes === 0 && r.movingS > 60) highlights.push('No harsh braking all drive');
  if (r.startedCold && r.coldRevs === 0) highlights.push('Gentle warm-up, engine thanks you');
  if (r.coldRevs) highlights.push(`High revs on a cold engine ×${r.coldRevs} (−${r.coldRevs * 25} XP)`);
  if (!highlights.length) highlights.push('Steady drive. Keep stacking clean shifts to climb the ranks.');

  const shiftStats = r.graded
    ? stat(`${r.cleanPct}%`, 'Clean shifts') + stat(r.perfects, 'Perfect') + stat(`x${r.bestCombo}`, 'Best combo') + stat(r.score.toLocaleString(), 'Score')
    : '';
  const speedStats =
    (r.bestZeroTo60 ? stat(`${r.bestZeroTo60.toFixed(2)}s`, '0–60') : '') +
    (r.quarter ? stat(`${r.quarter.time.toFixed(2)}s`, 'Quarter mile') : '') +
    (r.bestLap ? stat(`${r.bestLap.toFixed(2)}s`, 'Best lap') : '') +
    (r.mode !== 'chill' ? stat(`${r.peakLatG.toFixed(2)}g`, 'Peak corner') : '');

  $('panel').innerHTML = `
    <div class="report-top">
      <div class="letter" aria-label="Drive grade">${r.grade}</div>
      <div>
        <h2>Report card</h2>
        <p class="note">${fmtTime(r.durationS)} · ${dist} · ${{ chill: 'Chill', game: 'Game', track: 'Track Day' }[r.mode]}${r.sim ? ' · simulated' : ''}</p>
        <p class="note">+${result.xpGained} XP · ${result.rankAfter.name}</p>
      </div>
    </div>
    <h3>Highlights</h3>
    <ul class="list">${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>
    <h3>Drive</h3>
    <div class="stats">
      ${stat(r.avgSmooth, 'Smoothness')}
      ${stat(r.harshBrakes, 'Harsh brakes')}
      ${stat(`${r.peakBrakeG.toFixed(2)}g`, 'Hardest brake')}
      ${shiftStats}${speedStats}
    </div>
    ${
      hasRecording
        ? `<p class="note">Save this drive's data and send it to Claude to tune the app to your car.</p>
    <p class="note warn" id="save-status" role="status"></p>`
        : ''
    }
    <div class="panel-actions">
      ${hasRecording ? '<button data-action="save-data">Save drive data</button>' : ''}
      <button class="primary" data-action="home">Back to garage</button>
    </div>`;
  showScreen('panel');
}

export function renderStats() {
  const weeks = weeklyStats();
  const p = getProfile();
  const label = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const now = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const trend = (a, b, betterHigh = true) => {
    if (a === null || b === null) return '';
    if (a === b) return ' (same as last week)';
    const up = a > b;
    return up === betterHigh ? ' ▲ better than last week' : ' ▼ down on last week';
  };
  const pb = p.pbs;
  const hasData = weeks.some((w) => w.drives);

  $('panel').innerHTML = `
    <h2>Weekly stats</h2>
    ${
      hasData
        ? `<h3>Smoothness by week</h3>
    <div class="weeks">${weeks
      .map(
        (w, i) => `<div class="week${i === weeks.length - 1 ? ' now' : ''}">
          <div class="col${w.smooth === null ? ' empty' : ''}" style="height:${w.smooth ?? 2}%">${w.smooth !== null ? `<b>${w.smooth}</b>` : ''}</div>
          <span>${label(w.from)}</span></div>`
      )
      .join('')}</div>
    <h3>This week</h3>
    <ul class="list">
      <li>${now.drives} drives · ${settings.units === 'mph' ? `${(now.km / 1.609).toFixed(0)} mi` : `${now.km.toFixed(0)} km`} · +${now.xp} XP</li>
      <li>Smoothness ${now.smooth ?? '--'}${trend(now.smooth, prev.smooth)}</li>
      <li>Clean shifts ${now.cleanPct ?? '--'}%${trend(now.cleanPct, prev.cleanPct)}</li>
      <li>Harsh braking ${now.harshPerHour ?? '--'} per hour${trend(now.harshPerHour, prev.harshPerHour, false)}</li>
    </ul>`
        : `<p class="note">Finish a drive and your trends will show up here.</p>`
    }
    <h3>Personal bests</h3>
    <div class="stats">
      ${stat(pb.zeroTo60 ? `${pb.zeroTo60.toFixed(2)}s` : '--', '0–60')}
      ${stat(pb.quarter ? `${pb.quarter.toFixed(2)}s` : '--', 'Quarter mile')}
      ${stat(pb.bestCombo ? `x${pb.bestCombo}` : '--', 'Best combo')}
      ${stat(pb.bestSmooth || '--', 'Smoothest drive')}
      ${stat(pb.bestLap ? `${pb.bestLap.toFixed(2)}s` : '--', 'Best lap')}
      ${stat(p.counters.drives, 'Drives')}
    </div>
    <div class="panel-actions"><button class="primary" data-action="home">Back to garage</button></div>`;
  showScreen('panel');
}

export function renderBadges() {
  const got = getProfile().badges;
  const count = Object.keys(got).length;
  $('panel').innerHTML = `
    <h2>Badges</h2>
    <p class="note">${count} of ${BADGES.length} unlocked</p>
    <div class="badges">${BADGES.map(
      (b) => `<div class="badge${got[b.id] ? ' got' : ''}"><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>${
        got[b.id] ? `<span>Unlocked ${new Date(got[b.id]).toLocaleDateString()}</span>` : ''
      }</div>`
    ).join('')}</div>
    <div class="panel-actions"><button class="primary" data-action="home">Back to garage</button></div>`;
  showScreen('panel');
}

export function renderResetConfirm() {
  $('panel').innerHTML = `
    <h2>Reset progress</h2>
    <div class="confirm">
      <p class="note">This deletes your XP, rank, badges, personal bests and drive history on this device. Settings are kept. It can't be undone.</p>
      <div class="panel-actions">
        <button data-action="home">Keep everything</button>
        <button data-action="reset-confirm">Delete progress</button>
      </div>
    </div>`;
  showScreen('panel');
}

export function renderTrackWarning() {
  $('panel').innerHTML = `
    <h2>Track Day</h2>
    <div class="confirm">
      <p class="note">Track Day adds the quarter-mile timer and ghost laps. Use it only on a closed circuit or at a track event, never on public roads.</p>
      <div class="panel-actions">
        <button data-action="home">Back</button>
        <button class="primary" data-action="track-ok">I'm at a track</button>
      </div>
    </div>`;
  showScreen('panel');
}
