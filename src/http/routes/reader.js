// The witness reader (S1, S2): two machine routes, a workload identity token instead of a session.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.

/** The index and the export archive, read by the authorized workflow. */
export function readerRoutes(app) {
  return [
    ["GET", "/api/v0/reader/index", "reader", async (q) => {
      const r = await app.reader.readIndex({ authorization: q.headers.authorization, fleet: q.headers["runward-fleet"], requestId: q.requestId });
      return { index: r.index ? { sha256: r.index.sha256, version: r.index.version, json: JSON.parse(r.index.bytes.toString("utf8")) } : null, status: r.status };
    }],
    ["POST", "/api/v0/reader/export", "reader", async (q) => {
      const r = await app.reader.readExport({ authorization: q.headers.authorization, fleet: q.headers["runward-fleet"], requestId: q.requestId });
      return { status: 200, raw: r.bytes, type: "application/x-tar", headers: { "runward-archive-sha256": r.sha256 } };
    }],
  ];
}
