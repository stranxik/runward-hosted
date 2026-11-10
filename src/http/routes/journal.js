// The tenant's journal, page by page, each refusal in the reader's language.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { REFUSALS, refusal as refusalBody } from "../../domain/refusals/index.js";

/** GET /api/v0/journal. */
export function journalRoutes(app) {
  const G = app.reading;
  return [
    ["GET", "/api/v0/journal", "session", async (q) => {
      const page = await G.journal(q.session, q.url.searchParams.get("cursor"));
      for (const e of page.entries) {
        const code = e.body.detail?.refusal;
        if (code && REFUSALS[code]) { const t = refusalBody(code, q.lang); e.text = { message: t.message, action: t.action }; }
      }
      return page;
    }],
  ];
}
