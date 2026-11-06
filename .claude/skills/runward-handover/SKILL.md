---
name: runward-handover
description: "Runward hand-over craft rules. Use when preparing or executing a succession: the recovery runbook, finalizing the agent charter as a leave-behind, the redone-task proof, or naming the owner who inherits the system."
---

# Runward — hand-over craft

Use this when preparing or executing a succession: the recovery runbook, finalizing the agent charter as a leave-behind, the redone-task proof, or naming the owner who inherits the system.

Confront the CRITICAL/HIGH craft rules mapped to the `handover` phase at the point of action, never from memory:

1. **Surface** — `runward rules --phase handover` lists them; `runward rules --for <paths>` narrows to the rules whose declared territory covers the files you are touching.
2. **Read** — `runward explain <rule>` prints a rule's why and full text. Naming a rule is not confronting it.
3. **Account** — every surfaced rule gets a row in the deliverable's `## Rule conformance` manifest (`runward manifest --sync` scaffolds the missing ones; `runward propose` pre-fills what a signature can corroborate). You fill it as a PROPOSAL, never a bare status: `proposed:applied` with a typed pointer the gate verifies (`file:PATH[:LINE][#SYMBOL]`, `test:PATH[::NAME]`), `proposed:deviated` with an ADR, or `proposed:n/a` with a real reason. You propose; you never ratify under a person's name. An agent ratifies only as itself: `runward ratify --agent <your-name> --for <person>`, never a row it or that person proposed (ADR-0082). A signed rule (frontmatter `signature:`) needs evidence whose content matches its signature.
4. **Verify** — run `runward check --strict` before you consider the work done. The gate is the sole authority and is deterministic: a rule surfaced here and left unaccounted fails it — under your hands now, or in CI later. This skill guides the application; the gate alone gives the verdict.
