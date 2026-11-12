// Human identity as pure rules (PADR-0012, its accepted amendment and its note of 2026-11-06):
// links that open an access, sessions, fresh and per-gesture verification, passkeys.
import { Refusal } from "./refusals/index.js";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const CHALLENGE_TTL = 5 * MIN;
export const FRESH_WINDOW = 5 * MIN;
export const SESSION_IDLE = 12 * HOUR;
export const SESSION_ABSOLUTE = 7 * DAY;
export const PASSKEY_RESTORE_WINDOW = DAY;
export const MAX_PASSKEYS = 10;

/** Link durations, fixed at activation (5 bis). Recovery: usable 24 h after it opens, for 24 h. */
export const LINK_DURATIONS = {
  bootstrap: { delay: 0, life: DAY },
  recovery: { delay: DAY, life: DAY },
  invitation: { delay: 0, life: 3 * DAY },
};
export const LINK_KINDS = Object.keys(LINK_DURATIONS);

/**
 * The state of a link (seven states, the complement of the note): `link-live`, `link-not-yet`,
 * `link-signed-in`, `link-used`, `link-expired`, `link-cancelled`, `link-invalid`. A token that matches
 * nothing gets `link-invalid`, whatever the reason (no oracle).
 */
export function linkState(link, nowMs, { signedInTenant = null } = {}) {
  if (!link) return "link-invalid";
  if (link.cancelledAt) return "link-cancelled";
  if (link.usedAt) return "link-used";
  if (nowMs >= link.expiresAt) return "link-expired";
  if (signedInTenant && signedInTenant === link.tenantId) return "link-signed-in";
  if (nowMs < link.usableFrom) return "link-not-yet";
  return "link-live";
}

/** The two dates of a link opened now (the database writes them; this is the same rule, for tests). */
export function linkWindow(kind, nowMs) {
  const d = LINK_DURATIONS[kind];
  if (!d) throw new TypeError(`unknown link kind: ${kind}`);
  return { usableFrom: nowMs + d.delay, expiresAt: nowMs + d.delay + d.life };
}

/** Is a session still open? Idle 12 h, absolute 7 days, closed by a gesture. */
export function sessionOpen(s, nowMs) {
  if (!s || s.closedAt) return false;
  if (nowMs - s.lastSeenAt >= SESSION_IDLE) return false;
  if (nowMs - s.createdAt >= SESSION_ABSOLUTE) return false;
  return true;
}

/** Gestures that need a verification bound to the gesture and its object (4 bis, T16, T27). */
export const GESTURES = [
  "consent", "consent-withdraw", "content-erase", "export", "passkey-add", "passkey-remove",
  "passkey-single", "repository-confirm", "recovery-cancel", "reader-authorize", "reader-withdraw",
  "declare-with-consent", "invitation-create",
  // the forge port (ADR-0029): a registered instance and its keys, each bound to the digest of what the
  // screen shows; the protected-branch requirement and the order epoch of a GitLab repository
  "issuer-register", "issuer-key-add", "issuer-key-retire", "issuer-remove",
  "protection-lift", "protection-restore", "order-epoch-open",
];

/** A fresh verification (less than 5 minutes) is required; throws `fresh-required` otherwise. */
export function requireFresh(s, nowMs) {
  if (!s.freshAt || nowMs - s.freshAt >= FRESH_WINDOW) throw new Refusal("fresh-required");
}

/**
 * A per-gesture verification is required: the session holds a grant for exactly this gesture and
 * object, less than 5 minutes old. The caller consumes the grant (single use).
 */
export function requireGesture(s, gesture, object, nowMs) {
  if (!GESTURES.includes(gesture)) throw new TypeError(`unknown gesture: ${gesture}`);
  const g = s.grant;
  if (!g || g.gesture !== gesture || String(g.object ?? "") !== String(object ?? "") || nowMs - g.at >= FRESH_WINDOW) {
    throw new Refusal("gesture-required", { gesture, object: object ?? null });
  }
}

// ------------------------------------------------------------------ passkeys (2 bis)

/** Known passkey providers by AAGUID (community list passkey-authenticator-aaguids, an extract, as Hitpoint keeps it). */
export const AAGUIDS = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Trousseau iCloud",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Gestionnaire de mots de passe Google",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome sur Mac",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};
/** An AAGUID is kept only when it says something (attestation "none" often gives zeros). */
export const meaningfulAaguid = (a) => (a && !/^[0-]+$/.test(a.replace(/-/g, "")) ? a.toLowerCase() : null);
export const providerOf = (aaguid) => (aaguid ? AAGUIDS[aaguid] ?? null : null);

/** Two live passkeys from the same known provider: losing that account closes both (A9, not blocking). */
export function sameProvider(passkeys) {
  const live = passkeys.filter((p) => !p.removedAt);
  if (live.length < 2) return false;
  const providers = live.map((p) => providerOf(p.aaguid));
  return providers.every((x) => x && x === providers[0]);
}

/** May this passkey be removed? Never the last live one (atomic guard in the store too). */
export function checkRemovable(passkeys, id) {
  const live = passkeys.filter((p) => !p.removedAt);
  const target = live.find((p) => p.id === id);
  if (!target) throw new Refusal("not-found");
  if (live.length <= 1) throw new Refusal("last-passkey");
  return target;
}

/** May this removed passkey be restored? Within 24 h, from a session verified by another passkey. */
export function checkRestorable(p, nowMs, { freshBy }) {
  if (!p || !p.removedAt || p.lost) throw new Refusal("not-found");
  if (nowMs - p.removedAt >= PASSKEY_RESTORE_WINDOW) throw new Refusal("restore-window-closed");
  if (freshBy === p.id) throw new Refusal("fresh-required");
}

/** The first arrival stays closed until two passkeys exist, or the single-passkey choice is written (C5, 2 ter). */
export function arrivalOpen(passkeys, singleChosen) {
  return singleChosen || passkeys.filter((p) => !p.removedAt).length >= 2;
}

/** A device label from the user agent at the time of the ceremony; nothing else is kept (Hitpoint deviceFromUserAgent). */
export function deviceFromUserAgent(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /(Chrome|CriOS)\//.test(ua) ? "Chrome" : /Version\/.*Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (!browser && !os) return null;
  return [browser, os].filter(Boolean).join(" sur ");
}
