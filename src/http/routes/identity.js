// People: the session, the sign-in, the verification of a gesture, links, passkeys and sessions (PADR-0012).
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { id } from "./pattern.js";

/** The session, the passkey ceremonies, the links, the access view, passkeys and sessions. */
export function identityRoutes(app) {
  const I = app.identity;
  return [
    ["GET", "/api/v0/session", "session", async (q) => ({ ...(await I.sessionView(q.session)), sendWorkflow: q.config.sendWorkflow.published })],
    ["POST", "/api/v0/auth/options", "public", () => I.signInOptions()],
    ["POST", "/api/v0/auth/verify", "public", async (q) => {
      const r = await I.signIn({ challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId });
      return { status: 200, body: { signedIn: true }, cookie: r.token };
    }],
    ["POST", "/api/v0/auth/fresh/options", "session", (q) => I.freshOptions(q.session, { gesture: q.body.gesture ?? null, object: q.body.object ?? null })],
    ["POST", "/api/v0/auth/fresh", "session", (q) => I.fresh(q.session, { challengeId: q.body.challengeId, response: q.body.response, requestId: q.requestId })],
    ["POST", "/api/v0/auth/logout", "session", async (q) => { await I.signOut(q.session, { requestId: q.requestId }); return { status: 200, body: { signedOut: true }, cookie: "" }; }],
    ["POST", "/api/v0/links/inspect", "public", (q) => I.inspectLink({ token: q.body.token, session: q.session })],
    ["POST", "/api/v0/links/options", "public", (q) => I.linkOptions({ token: q.body.token, session: q.session })],
    ["POST", "/api/v0/links/redeem", "public", async (q) => {
      const r = await I.redeemLink({ token: q.body.token, challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId });
      return { status: 200, body: { redeemed: true, seq: r.entry.seq }, cookie: r.token };
    }],
    ["GET", "/api/v0/access", "session", (q) => I.accessView(q.session)],
    ["POST", "/api/v0/passkeys/options", "session", (q) => I.passkeyAddOptions(q.session)],
    ["POST", "/api/v0/passkeys", "session", (q) => I.passkeyAdd(q.session, { challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId })],
    ["POST", "/api/v0/passkeys/single", "session", (q) => I.passkeySingle(q.session, { requestId: q.requestId })],
    ["DELETE", `/api/v0/passkeys/${id}`, "session", async (q, [p]) => { const r = await I.passkeyRemove(q.session, p, { requestId: q.requestId }); return r.closedCurrent ? { status: 200, body: r, cookie: "" } : r; }],
    ["POST", `/api/v0/passkeys/${id}/restore`, "session", (q, [p]) => I.passkeyRestore(q.session, p, { requestId: q.requestId })],
    ["DELETE", `/api/v0/sessions/${id}`, "session", async (q, [s]) => { const r = await I.sessionClose(q.session, s, { requestId: q.requestId }); return r.closedCurrent ? { status: 200, body: r, cookie: "" } : r; }],
    ["POST", "/api/v0/sessions/close-others", "session", (q) => I.sessionsCloseOthers(q.session, { requestId: q.requestId })],
  ];
}

/** The cancellation of a recovery, by a session still open. */
export function recoveryRoutes(app) {
  const I = app.identity;
  return [
    ["POST", "/api/v0/recovery/cancel", "session", (q) => I.recoveryCancel(q.session, { requestId: q.requestId })],
  ];
}
