// Sound effects so you don't need to look at the screen (the announcer is in voice.js).
// All sounds are generated in code (no audio files), so they work offline.
// Browsers only allow sound after a tap, so unlock() runs on "Start drive".

import { settings } from '../core/progress.js';

let ctx = null;

// Notes for the combo ladder: each clean shift in a row climbs one step.
const LADDER = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // a silent utterance unlocks the built-in voice used as a fallback
    if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch {
    ctx = null;
  }
}

function tone(freq, { at = 0, dur = 0.18, type = 'triangle', vol = 0.25, slideTo = null } = {}) {
  if (!ctx || !settings.sound) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  clean(combo) {
    const f = LADDER[Math.min(LADDER.length - 1, Math.max(0, combo - 1))];
    tone(f, { dur: 0.22 });
    tone(f * 1.5, { at: 0.07, dur: 0.3, vol: 0.18 });
  },
  ok() {
    tone(440, { dur: 0.12, vol: 0.12 });
  },
  miss() {
    tone(220, { dur: 0.2, type: 'square', vol: 0.08, slideTo: 160 });
  },
  lugged() {
    tone(90, { dur: 0.35, type: 'sawtooth', vol: 0.1 });
  },
  launch() {
    tone(330, { dur: 0.5, slideTo: 1320, vol: 0.2 });
  },
  badge() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.3, vol: 0.2 }));
  },
  warm() {
    [392, 523.25, 659.25].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.25, vol: 0.18 }));
  },
  // shift assist: two quick high beeps, easy to hear over the engine
  shiftCue() {
    tone(1568, { dur: 0.07, type: 'square', vol: 0.12 });
    tone(2093, { at: 0.09, dur: 0.09, type: 'square', vol: 0.12 });
  },
  soft() {
    tone(180, { dur: 0.25, vol: 0.12 });
  },
};

export const getCtx = () => ctx;
