// The Log port: one JSON line per event on standard output (architecture §8). Never a body, a token, a
// name or a path: the callers pass only the fields of the schema below, and anything else is dropped.
// The two free fields are bounded and scrubbed here, whoever the caller (review finding of 2026-11-10:
// `detail` and `error` were written as given):
//   error   one line, at most ERROR_MAX characters;
//   detail  a string of at most STRING_MAX characters, or an object of at most KEYS_MAX keys and DEPTH_MAX
//           levels, each array cut to ITEMS_MAX items, the whole at most DETAIL_MAX characters once
//           written; a key that names a credential, a cookie, a body or an address is dropped;
// and in every string of both, control characters become spaces, and connection URLs, credentials in a
// URL, bearer tokens and JWTs, e-mail addresses, file paths and identifiers (UUIDs) become a mark.
const FIELDS = new Set(["level", "at", "event", "requestId", "route", "method", "status", "ms", "refusal", "tenant", "detail", "error"]);
export const LOG_BOUNDS = { ERROR_MAX: 300, STRING_MAX: 200, KEYS_MAX: 20, ITEMS_MAX: 20, DEPTH_MAX: 3, DETAIL_MAX: 2000 };

// each pattern has one level of repetition only (the security scan refuses nested quantifiers)
const MARKS = [
  [/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"],
  [/([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@]+@/gi, "$1[redacted]@"],
  [/\bbearer\s+\S+/gi, "Bearer [redacted]"],
  [/\beyJ[\w-]{6,}\.[\w.-]+/g, "[jwt]"],
  [/[\w.%+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/(?<![\w.:/~-])~?\/[\w.-]+\/[\w./-]*/g, "[path]"],
];
const SECRET_KEY = /token|secret|password|passwd|authori[sz]ation|cookie|credential|body|e-?mail/i;

/** A string as a log line may carry it: one line, its sensitive spans marked, cut to `max`. */
export function scrub(value, max = LOG_BOUNDS.STRING_MAX) {
  let s = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const [re, mark] of MARKS) s = s.replace(re, mark);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function bound(v, depth) {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return scrub(v);
  if (depth >= LOG_BOUNDS.DEPTH_MAX) return "[nested]";
  if (Array.isArray(v)) return v.slice(0, LOG_BOUNDS.ITEMS_MAX).map((x) => bound(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v).filter(([k]) => !SECRET_KEY.test(k)).slice(0, LOG_BOUNDS.KEYS_MAX)) if (x !== undefined) out[scrub(k, 40)] = bound(x, depth + 1);
    return out;
  }
  return scrub(String(v));
}

/** The `detail` field as written: bounded in shape and in size, scrubbed. */
export function boundDetail(detail) {
  const b = bound(detail, 0);
  return JSON.stringify(b).length > LOG_BOUNDS.DETAIL_MAX ? "[detail too large: cut]" : b;
}

export function jsonLog({ write = (s) => process.stdout.write(s), clock } = {}) {
  const emit = (level, event, fields = {}) => {
    const line = { level, at: new Date(clock ? clock.now() : Date.now()).toISOString(), event };
    for (const [k, v] of Object.entries(fields)) {
      if (!FIELDS.has(k) || v === undefined) continue;
      line[k] = k === "error" ? scrub(v, LOG_BOUNDS.ERROR_MAX) : k === "detail" ? boundDetail(v) : v;
    }
    write(`${JSON.stringify(line)}\n`);
  };
  return { info: (e, f) => emit("info", e, f), warn: (e, f) => emit("warn", e, f), error: (e, f) => emit("error", e, f) };
}

export const silentLog = { info() {}, warn() {}, error() {} };
