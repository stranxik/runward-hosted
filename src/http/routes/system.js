// What anyone may read of the service itself: its version, its health, its security contact.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.

/** GET /api/version, /api/health, /.well-known/security.txt. */
export function systemRoutes(app) {
  return [
    ["GET", "/api/version", "public", (q) => q.version],
    ["GET", "/api/health", "public", async (q) => q.health()],
    ["GET", "/.well-known/security.txt", "public", (q) => ({ status: 200, raw: Buffer.from(q.config.securityTxt), type: "text/plain; charset=utf-8" })],
  ];
}
