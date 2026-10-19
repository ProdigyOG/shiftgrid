// The announcer. Plays recorded clips (the arcade voice, or your own recordings)
// through an arcade-style effect: a little pitch lift, some crunch, and a
// short echo. Lines can be chained, e.g. "Zero to sixty!" + "four" + "point" + "five" + "seconds".
// If a clip is missing, it falls back to the phone's built-in voice.

import { settings } from '../core/progress.js';
import { getClip } from '../util/clipstore.js';
import { getCtx } from './audio.js';

let lines = {}; // key -> text, from voice/lines.json
const arcade = new Map(); // key -> AudioBuffer
const custom = new Map(); // key -> AudioBuffer (your recordings)
let busyUntil = 0;
let current = [];

export async function loadLines() {
  try {
    lines = await (await fetch('voice/lines.json')).json();
  } catch {
    lines = {};
  }
  return lines;
}

export const lineText = (key) => lines[key] ?? key;
export const lineKeys = () => Object.keys(lines);

// Cut the silence the voice service leaves at the start and end of each clip,
// so chained clips run together naturally.
function trim(ctx, buf) {
  const data = buf.getChannelData(0);
  const limit = 0.02;
  let a = 0;
  let b = data.length - 1;
  while (a < b && Math.abs(data[a]) < limit) a++;
  while (b > a && Math.abs(data[b]) < limit) b--;
  const pad = Math.round(buf.sampleRate * 0.03);
  a = Math.max(0, a - pad);
  b = Math.min(data.length - 1, b + pad);
  const out = ctx.createBuffer(buf.numberOfChannels, b - a + 1, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b + 1), c);
  return out;
}

export async function decode(arrayBuffer) {
  const ctx = getCtx();
  if (!ctx) return null;
  const buf = await new Promise((res, rej) => ctx.decodeAudioData(arrayBuffer, res, rej));
  return trim(ctx, buf);
}

// Called after the first tap (audio is allowed from then on).
export async function preload() {
  if (!getCtx()) return;
  await Promise.all(
    lineKeys().map(async (key) => {
      try {
        if (!arcade.has(key)) {
          const res = await fetch(`voice/arcade/${key}.mp3`);
          if (res.ok) arcade.set(key, await decode(await res.arrayBuffer()));
        }
        const blob = await getClip(key);
        if (blob) custom.set(key, await decode(await blob.arrayBuffer()));
        else custom.delete(key);
      } catch {
        /* a broken clip just falls back to the built-in voice */
      }
    })
  );
}

export function setCustom(key, buffer) {
  if (buffer) custom.set(key, buffer);
  else custom.delete(key);
}

export const hasCustom = (key) => custom.has(key);

function bufferFor(key) {
  if (settings.voicePack === 'mine' && custom.has(key)) return { buf: custom.get(key), mine: true };
  return arcade.has(key) ? { buf: arcade.get(key), mine: false } : null;
}

// The arcade sound: crunch + echo. Built once per phrase.
function arcadeChain(ctx, fx) {
  const input = ctx.createGain();
  const out = ctx.createDynamicsCompressor();
  out.connect(ctx.destination);
  if (!fx) {
    input.connect(out);
    return input;
  }
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 170;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.gain.value = 5;

  // crunch: a stepped curve, like an old sound chip
  const crush = ctx.createWaveShaper();
  const steps = 20;
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  crush.curve = curve;
  const dry = ctx.createGain();
  dry.gain.value = 0.75;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;

  // short echo
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.11;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.25;
  const echo = ctx.createGain();
  echo.gain.value = 0.28;

  input.connect(hp).connect(presence);
  presence.connect(dry).connect(out);
  presence.connect(crush).connect(wet).connect(out);
  presence.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(echo).connect(out);
  return input;
}

// Play a list of clip keys back to back.
// priority: interrupt whatever is playing (launch times, badges).
export function announce(keys, { priority = false } = {}) {
  if (!settings.voice) return;
  const ctx = getCtx();
  const now = performance.now();
  if (!priority && now < busyUntil + 600) return;
  if (priority) stop();

  const clips = keys.map(bufferFor);
  if (!ctx || clips.some((c) => !c)) return speak(keys.map(lineText).join(' '));

  const mine = clips.every((c) => c.mine);
  const chain = arcadeChain(ctx, mine ? settings.voiceFx : true);
  const rate = mine ? 1 : 1.05;
  let t = ctx.currentTime + 0.02;
  current = clips.map(({ buf }) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(chain);
    src.start(t);
    t += buf.duration / rate;
    return src;
  });
  busyUntil = now + (t - ctx.currentTime) * 1000;
}

function stop() {
  current.forEach((s) => {
    try {
      s.stop();
    } catch {
      /* already finished */
    }
  });
  current = [];
  busyUntil = 0;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  u.pitch = 1.3;
  speechSynthesis.speak(u);
  busyUntil = performance.now() + 1500;
}

// "4.45" -> ['n4', 'point', 'n5'] (one decimal place). null if out of range.
export function numberKeys(value) {
  const r = Math.round(value * 10) / 10;
  const whole = Math.floor(r);
  const tenth = Math.round((r - whole) * 10);
  if (whole > 20) return null;
  return [`n${whole}`, 'point', `n${tenth}`];
}

export function comboKey(combo) {
  if (combo >= 35) return 'combo_max';
  return combo % 5 === 0 ? `combo_${combo}` : null;
}

// Preview one line (used on the My voice screen).
export function preview(key, { mine }) {
  const ctx = getCtx();
  const buf = mine ? custom.get(key) : arcade.get(key);
  if (!ctx || !buf) return;
  stop();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = mine ? 1 : 1.05;
  src.connect(arcadeChain(ctx, mine ? settings.voiceFx : true));
  src.start();
  current = [src];
}
