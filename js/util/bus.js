// A tiny message board: one part of the app posts an event ("shift graded"),
// any other part can listen for it. Keeps the modules independent.

const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function emit(type, detail = {}) {
  for (const fn of listeners.get(type) ?? []) fn(detail);
  for (const fn of listeners.get('*') ?? []) fn({ type, ...detail });
}
