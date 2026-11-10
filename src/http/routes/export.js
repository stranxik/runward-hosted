// Leaving with one's data: the archive prepared under a per-gesture verification, then downloaded.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { id } from "./pattern.js";

/** Prepare the archive, then download it. */
export function exportRoutes(app) {
  const G = app.reading;
  return [
    ["POST", "/api/v0/export", "session", async (q) => { const r = await G.prepareExport(q.session, { requestId: q.requestId }); return { id: r.id, size: r.size, sha256: r.sha256, expiresAt: r.expiresAt }; }],
    ["GET", `/api/v0/export/${id}`, "session", async (q, [a]) => {
      const r = await G.downloadExport(q.session, a);
      return { status: 200, raw: r.bytes, type: "application/x-tar", headers: { "content-disposition": 'attachment; filename="runward-hosted-export.tar"', "runward-archive-sha256": r.sha256 } };
    }],
  ];
}
