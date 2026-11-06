// The Clock port: the service's time, in UTC, always labelled declared (PADR-0014 point 4).
export const systemClock = { now: () => Date.now(), source: "service clock (declared)" };

/** A clock for tests and the local witness: time moves only when told to. */
export function manualClock(start = Date.parse("2026-11-06T12:00:00Z")) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; }, source: "manual clock (test)" };
}
