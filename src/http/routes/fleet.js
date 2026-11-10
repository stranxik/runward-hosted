// The fleet as it is read: the index served as the pinned runward-fleet assembled it, and its status line.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { Refusal } from "../../domain/refusals/index.js";
import { id } from "./pattern.js";

/** The index of the session's tenant, byte for byte, and the status of its uploads. */
export function fleetRoutes(app) {
  const G = app.reading;
  return [
    ["GET", `/f/${id}/index.json`, "session", async (q, [t]) => {
      if (t !== q.session.tenantId) throw new Refusal("not-found");
      const idx = await G.index(t);
      if (!idx) throw new Refusal("not-found");
      return { status: 200, raw: idx.bytes, type: "application/json; charset=utf-8", headers: { etag: `"${idx.sha256}"` } };
    }],
    ["GET", "/api/v0/fleet/status", "session", (q) => G.status(q.session)],
  ];
}
