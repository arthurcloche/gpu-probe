// frame.js
// Drives per-frame stats. Runs our OWN requestAnimationFrame loop so we don't
// depend on the app calling rAF a particular way. Subscribers are called once
// per display refresh with { now, dt, fps }.

const subs = new Set();
let started = false;
let last = 0;
let smoothedDt = 16.666;
const EMA = 0.1;

function tick(now) {
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(tick);
  }
  const dt = last === 0 ? 16.666 : now - last;
  last = now;
  // ignore unreasonable gaps (tab backgrounded, etc.)
  if (dt < 200) smoothedDt = smoothedDt * (1 - EMA) + dt * EMA;
  const fps = 1000 / smoothedDt;
  for (const fn of subs) {
    try { fn({ now, dt: smoothedDt, fps }); } catch (e) { /* never break loop */ }
  }
}

function start() {
  if (started || typeof requestAnimationFrame === "undefined") return;
  started = true;
  requestAnimationFrame(tick);
}

/** Subscribe to per-frame ticks. Returns an unsubscribe function. */
export function onFrame(fn) {
  subs.add(fn);
  start();
  return () => subs.delete(fn);
}
