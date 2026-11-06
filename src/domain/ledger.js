// The journal of a tenant: append only, chained by digest over a canonical encoding (PADR-0014).
//
// Encoding: runward's witness encoding (docs/spec/witness.md §3): keys sorted by UTF-16 code units at
// every depth, no insignificant whitespace, strings as JSON.stringify writes them, numbers as
// non-negative integers only. A value outside that grammar is refused, never coerced.
//
// The chain: entry n carries seq = n, prev = hash of entry n-1 (64 zeros for the first), and
// hash = sha256(canonical({ seq, prev, body })). Names and personal data never enter the body: it carries
// identifiers and digests (PADR-0014 point 5).
import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);

/** Canonical JSON text of a value, per the witness encoding. Throws on what the grammar refuses. */
export function canonical(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`canonical: ${value} is not a non-negative integer`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonical: ${typeof value} is not encodable`);
}

export const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The hash of an entry, from its seq, the previous hash and its body. */
export function entryHash(seq, prev, body) {
  return sha256hex(canonical({ seq, prev, body }));
}

/** The next entry after `head` ({ seq, hash } or null for an empty journal). */
export function nextEntry(head, body) {
  const seq = head ? head.seq + 1 : 1;
  const prev = head ? head.hash : GENESIS;
  canonical(body); // refuse a body outside the grammar before anything is written
  return { seq, prev, hash: entryHash(seq, prev, body), body };
}

/**
 * Verify a run of entries, in seq order, from `from` (the head before the first one, or null).
 * Returns { ok: true, head } or { ok: false, at, why }. A gap in seq is a break.
 */
export function verifyChain(entries, from = null) {
  let head = from;
  for (const e of entries) {
    const want = head ? head.seq + 1 : 1;
    if (e.seq !== want) return { ok: false, at: e.seq, why: `seq ${e.seq} where ${want} was expected` };
    const prev = head ? head.hash : GENESIS;
    if (e.prev !== prev) return { ok: false, at: e.seq, why: "prev is not the hash of the entry before" };
    if (e.hash !== entryHash(e.seq, e.prev, e.body)) return { ok: false, at: e.seq, why: "hash does not match the entry" };
    head = { seq: e.seq, hash: e.hash };
  }
  return { ok: true, head };
}

/** The kinds of entries (what), closed list; a new kind is an additive change of this list. */
export const ENTRY_KINDS = [
  "send-accepted", "send-historical", "send-pending", "send-not-accepted", "send-quarantined",
  "repository-declared", "repository-changed", "repository-confirmed", "repository-removed", "repository-restored", "repository-expired",
  "consent-given", "consent-withdrawn", "content-erased",
  "member-founded", "member-recovered", "signed-in", "signed-out", "session-closed", "sessions-closed-others",
  "passkey-added", "passkey-removed", "passkey-restored", "passkey-single-chosen",
  "recovery-opened", "recovery-cancelled", "access-reset", "bootstrap-opened",
  "export-prepared", "settings-changed", "reader-authorized", "reader-withdrawn", "reader-read",
  "restore-replayed", "invitation-created", "invitation-cancelled", "member-removed", "member-left",
];

/** Build an entry body: who, role, what, object digest, request id, dates with their source (point 3, 4). */
export function entryBody({ who, what, object = null, requestId = null, received, issued = null, commit = null, detail = {} }) {
  if (!ENTRY_KINDS.includes(what)) throw new TypeError(`unknown journal entry kind: ${what}`);
  if (!who || !["human", "workload", "operator", "reader"].includes(who.type)) throw new TypeError("entry: who.type is human, workload, operator or reader");
  return {
    who: { type: who.type, id: String(who.id ?? "") },
    what,
    object,
    requestId,
    dates: {
      received: { at: received, source: "service clock (declared)" },
      ...(issued ? { issued: { at: issued, source: "token" } } : {}),
      ...(commit ? { commit: { at: commit, source: "export" } } : {}),
    },
    detail,
  };
}
