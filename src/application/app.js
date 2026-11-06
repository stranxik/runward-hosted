// The application: every use case, built from the ports. Nothing here knows HTTP or a vendor.
import { context } from "./context.js";
import { identityCases } from "./identity.js";
import { repositoryCases } from "./repositories.js";
import { ingestCases } from "./ingest.js";
import { readingCases } from "./reading.js";
import { operatorCases, readerCases } from "./operator.js";

/** Ports the application needs; a missing one stops the start (fail closed, never half served). */
export const PORTS = ["store", "objects", "verifier", "authn", "assembler", "archive", "clock", "log", "ulid"];

export function createApp(ports, config) {
  for (const p of PORTS) if (!ports[p]) throw new Error(`port missing: ${p}`);
  for (const k of ["origin", "sendWorkflow"]) if (!config[k]) throw new Error(`config missing: ${k}`);
  const ctx = context(ports, config);
  const identity = identityCases(ctx);
  const repositories = repositoryCases(ctx, identity);
  const ingest = ingestCases(ctx);
  const reading = readingCases(ctx, identity);
  const operator = operatorCases(ctx);
  const reader = readerCases(ctx, ingest, reading);
  return { ctx, identity, repositories, ingest, reading, operator, reader };
}
