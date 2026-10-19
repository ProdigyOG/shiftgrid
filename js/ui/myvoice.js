// "My voice": replace any announcer line with your own recording.
// Upload works everywhere (e.g. a Voice Memo saved to Files).
// Record uses the microphone where the browser allows it; the private
// claude.ai page doesn't, so there it explains and points to Upload.

import { settings, saveSettings } from '../core/progress.js';
import { putClip, deleteClip } from '../util/clipstore.js';
import { unlock } from './audio.js';
import * as voice from './voice.js';
import { showScreen } from './screens.js';

const GROUPS = [
  ['Shift calls', (k) => ['perfect', 'good', 'smooth', 'early', 'late', 'lugged', 'rough'].includes(k)],
  ['Combos', (k) => k.startsWith('combo')],
  ['Messages', (k) => ['start', 'game_on', 'cold', 'badge', 'daily', 'launch', 'quarter', 'lap', 'new_best'].includes(k)],
  ['Badge names', (k) => k.startsWith('badge_')],
  ['Numbers for times', (k) => /^n\d+$/.test(k) || k === 'point' || k === 'seconds'],
];
const MAX_RECORD_MS = 4000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let recorder = null;
let message = '';

export async function openMyVoice() {
  unlock(); // this screen plays audio, and opening it was a tap
  await voice.preload();
  render();
  showScreen('panel');
}

function row(key) {
  const mine = voice.hasCustom(key);
  const recording = recorder?.key === key;
  return `<div class="vrow" data-key="${key}">
    <div class="vtext"><b>${esc(voice.lineText(key))}</b><span>${mine ? 'Your recording' : 'Arcade voice'}</span></div>
    <div class="vbtns">
      <button data-voice="play">Play</button>
      <button data-voice="record" class="${recording ? 'rec' : ''}">${recording ? 'Stop' : 'Record'}</button>
      <label class="vupload">Upload<input type="file" accept="audio/*" data-voice="upload" id="up-${key}"></label>
      ${mine ? '<button data-voice="remove">Remove</button>' : ''}
    </div>
  </div>`;
}

function render() {
  const keys = voice.lineKeys();
  const mineCount = keys.filter(voice.hasCustom).length;
  $('panel').innerHTML = `
    <h2>My voice</h2>
    <p class="note">Swap any line for your own recording. Lines you haven't recorded stay in the arcade voice.
      Recordings are kept on this phone only. ${mineCount} of ${keys.length} recorded.</p>
    <p class="note">Tip: in Voice Memos, record one line, tap ··· then <b>Save to Files</b>, then tap <b>Upload</b> here.
      Keep each one short and say it with energy!</p>
    ${message ? `<p class="note warn" role="status">${esc(message)}</p>` : ''}
    <div class="toggles two">
      <button class="toggle" data-voice="fx" aria-pressed="${settings.voiceFx}">Arcade effect on my voice</button>
      <button class="toggle" data-voice="pack" aria-pressed="${settings.voicePack === 'mine'}">Use my voice</button>
    </div>
    ${GROUPS.map(([title, test]) => `<h3>${title}</h3><div class="vlist">${keys.filter(test).map(row).join('')}</div>`).join('')}
    <div class="panel-actions"><button class="primary" data-action="home">Back to garage</button></div>`;
}

async function saveRecording(key, blob) {
  try {
    const buf = await voice.decode(await blob.arrayBuffer());
    if (!buf || buf.duration < 0.1) throw new Error('empty');
    await putClip(key, blob);
    voice.setCustom(key, buf);
    if (settings.voicePack !== 'mine') {
      settings.voicePack = 'mine';
      saveSettings();
    }
    message = `Saved "${voice.lineText(key)}".`;
  } catch {
    message = "Couldn't read that file. Try a Voice Memo (.m4a) or an .mp3.";
  }
  render();
}

async function toggleRecord(key) {
  if (recorder) {
    const same = recorder.key === key;
    recorder.stop();
    if (same) return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.key = key;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      saveRecording(key, new Blob(chunks, { type: rec.mimeType }));
    };
    rec.start();
    recorder = rec;
    setTimeout(() => recorder === rec && rec.stop(), MAX_RECORD_MS);
    message = `Recording "${voice.lineText(key)}"… tap Stop when done.`;
  } catch {
    message = "The microphone isn't available on this page. Record a Voice Memo and use Upload instead.";
  }
  render();
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-voice]');
  if (!btn || btn.tagName === 'INPUT') return;
  const key = btn.closest('[data-key]')?.dataset.key;
  const what = btn.dataset.voice;
  if (what === 'fx' || what === 'pack') {
    if (what === 'fx') settings.voiceFx = !settings.voiceFx;
    else settings.voicePack = settings.voicePack === 'mine' ? 'arcade' : 'mine';
    saveSettings();
    return render();
  }
  if (what === 'play') voice.preview(key, { mine: voice.hasCustom(key) });
  if (what === 'record') toggleRecord(key);
  if (what === 'remove') {
    await deleteClip(key);
    voice.setCustom(key, null);
    message = `Back to the arcade voice for "${voice.lineText(key)}".`;
    render();
  }
});

document.addEventListener('change', (e) => {
  const input = e.target;
  if (input.dataset?.voice !== 'upload' || !input.files?.length) return;
  const key = input.closest('[data-key]').dataset.key;
  saveRecording(key, input.files[0]);
});
