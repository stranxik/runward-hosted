// The forge port (ADR-0029): the GitLab instances a tenant registers, their keys, and the two gestures of
// a GitLab repository (the protected-branch requirement, the order epoch). Every write is a passkey gesture.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { id } from "./pattern.js";

/** A registration's identifier: 128 random bits in hexadecimal, matched whole. */
const rid = "([0-9a-f]{32})";

/** Register an instance, add or retire a key, remove a registration. The previews write nothing. */
export function issuerRoutes(app) {
  const I = app.issuers;
  return [
    ["POST", "/api/v0/issuers/preview", "session", (q) => I.preview(q.session, q.body)],
    ["POST", "/api/v0/issuers", "session", async (q) => ({ status: 201, body: await I.register(q.session, q.body, { requestId: q.requestId }) })],
    ["POST", `/api/v0/issuers/${rid}/keys/preview`, "session", (q, [i]) => I.keyPreview(q.session, i, q.body)],
    ["POST", `/api/v0/issuers/${rid}/keys`, "session", (q, [i]) => I.keyAdd(q.session, i, q.body, { requestId: q.requestId })],
    ["DELETE", `/api/v0/issuers/${rid}/keys/${id}`, "session", (q, [i, k]) => I.keyRetire(q.session, i, k, { requestId: q.requestId })],
    ["DELETE", `/api/v0/issuers/${rid}`, "session", (q, [i]) => I.remove(q.session, i, { requestId: q.requestId })],
  ];
}

/** A GitLab repository: lift or require again the protection of its branch; open a new order epoch. */
export function forgeRepositoryRoutes(app) {
  const R = app.repositories;
  return [
    ["POST", `/api/v0/repositories/${id}/protection/lift`, "session", (q, [r]) => R.protection(q.session, r, true, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/protection/restore`, "session", (q, [r]) => R.protection(q.session, r, false, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/epoch`, "session", (q, [r]) => R.openEpoch(q.session, r, { requestId: q.requestId })],
  ];
}
