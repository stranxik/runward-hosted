// The Log port: one JSON line per event on standard output (architecture §8). Never a body, a token, a
// name or a path: the callers pass only the fields of the schema below, and anything else is dropped.
const FIELDS = new Set(["level", "at", "event", "requestId", "route", "method", "status", "ms", "refusal", "tenant", "detail", "error"]);

export function jsonLog({ write = (s) => process.stdout.write(s), clock } = {}) {
  const emit = (level, event, fields = {}) => {
    const line = { level, at: new Date(clock ? clock.now() : Date.now()).toISOString(), event };
    for (const [k, v] of Object.entries(fields)) if (FIELDS.has(k) && v !== undefined) line[k] = v;
    write(`${JSON.stringify(line)}\n`);
  };
  return { info: (e, f) => emit("info", e, f), warn: (e, f) => emit("warn", e, f), error: (e, f) => emit("error", e, f) };
}

export const silentLog = { info() {}, warn() {}, error() {} };
