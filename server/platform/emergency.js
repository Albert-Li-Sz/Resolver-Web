import { clone } from "./model.js";

export function contentOf(d) {
  return {
    program: clone(d.program),
    startedAt: d.startedAt,
    paused: !!d.paused,
    offset: d.offset || 0,
    mode: d.mode || "program",
  };
}
export function currentContent(d, now = Date.now()) {
  return clone(
    d.effectiveAt > now && d.pendingFrom ? d.pendingFrom : contentOf(d),
  );
}
export function previousContent(d, now = Date.now()) {
  return clone(
    d.effectiveAt > now && d.pendingFrom ? d.pendingHistory : d.previousProgram,
  );
}
export function scheduleContent(
  d,
  next,
  previous,
  now,
  effectiveAt = now + 750,
) {
  const current = currentContent(d, now);
  d.pendingFrom = current;
  d.pendingHistory = clone(previous);
  Object.assign(d, next, { effectiveAt });
}
