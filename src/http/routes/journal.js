// The tenant's journal, page by page, each refusal in the reader's language; filtered by application, kind and
// period when the query asks it (src/domain/journal-filter.js, ADR-0037).
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.
import { REFUSALS, refusal as refusalBody } from "../../domain/refusals/index.js";
import { forgeOfWorkload } from "../../domain/forge.js";
import { readJournalFilter } from "../../domain/journal-filter.js";

/** GET /api/v0/journal. */
export function journalRoutes(app) {
  const G = app.reading;
  return [
    ["GET", "/api/v0/journal", "session", async (q) => {
      // the filters (ADR-0037): additive query parameters; without them the answer is the one it always was
      const filter = readJournalFilter(q.url.searchParams);
      const page = await G.journal(q.session, q.url.searchParams.get("cursor"), filter);
      for (const e of page.entries) {
        const code = e.body.detail?.refusal;
        // the words of a workload's refusal are its forge's (ADR-0029 section 1)
        if (code && REFUSALS[code]) { const t = refusalBody(code, q.lang, e.body.who?.type === "workload" ? { forge: forgeOfWorkload(e.body.who.id) } : {}); e.text = { message: t.message, action: t.action }; }
      }
      return page;
    }],
  ];
}
