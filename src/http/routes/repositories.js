// What may write into a fleet: the declared repositories, their consent and content; the tenant's settings
// and its automatic reader.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { id } from "./pattern.js";

/** Declare, change, confirm, remove and restore a repository; its consent and its content. */
export function repositoryRoutes(app) {
  const R = app.repositories;
  return [
    ["POST", "/api/v0/repositories", "session", async (q) => ({ status: 201, body: await R.declare(q.session, q.body, { requestId: q.requestId }) })],
    ["PATCH", `/api/v0/repositories/${id}`, "session", (q, [r]) => R.patch(q.session, r, q.body, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/confirm`, "session", (q, [r]) => R.confirm(q.session, r, q.body, { requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}`, "session", (q, [r]) => R.remove(q.session, r, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/restore`, "session", (q, [r]) => R.restore(q.session, r, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/consent`, "session", (q, [r]) => R.consent(q.session, r, { requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}/consent`, "session", (q, [r]) => R.withdrawConsent(q.session, r, { erase: q.body.erase === true, requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}/content`, "session", (q, [r]) => R.eraseContent(q.session, r, { requestId: q.requestId })],
  ];
}

/** The tenant's settings, and the automatic reader allowed or withdrawn. */
export function tenantRoutes(app) {
  const R = app.repositories;
  return [
    ["POST", "/api/v0/tenant/settings", "session", (q) => R.settings(q.session, q.body, { requestId: q.requestId })],
    ["POST", "/api/v0/reader", "session", (q) => R.reader(q.session, true, { requestId: q.requestId })],
    ["DELETE", "/api/v0/reader", "session", (q) => R.reader(q.session, false, { requestId: q.requestId })],
  ];
}
