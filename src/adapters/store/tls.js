// TLS to PostgreSQL, verified (review finding of 2026-11-08). The client library turns `ssl: "require"`
// (and "prefer", "allow") into a connection that accepts any certificate: encrypted, but to whoever answers. So the
// service accepts two modes and no other:
//   verify-full  the certificate chains to the given authority (or the system roots when none is given)
//                AND names the host of the URL (an IP address is checked against the IP SANs);
//   disable      no TLS: refused in production unless the database is on the loopback interface (the CI
//                image smoke), where no network is crossed.
// The authority is the instance's certificate, public, given as DATABASE_CA (PEM) or DATABASE_CA_FILE.
import { checkServerIdentity } from "node:tls";
import { isIP } from "node:net";

export const DATABASE_TLS_MODES = ["verify-full", "disable"];
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };

/** What is wrong with a database TLS setting, as sentences that name variables, never a value. */
export function databaseTlsProblems({ url, mode, ca, production }) {
  const problems = [];
  if (!DATABASE_TLS_MODES.includes(mode)) {
    problems.push(`DATABASE_SSL must be verify-full or disable (${["require", "prefer", "allow"].includes(mode) ? "this mode encrypts without verifying the certificate" : "unknown mode"})`);
    return problems;
  }
  const host = hostOf(url);
  if (mode === "disable" && production && !LOOPBACK.has(host ?? "")) problems.push("DATABASE_SSL=disable is refused in production for a database that is not on the loopback interface");
  if (mode === "verify-full" && production && !ca) problems.push("DATABASE_CA or DATABASE_CA_FILE is required in production (the certificate authority of the database instance)");
  if (ca && !/-----BEGIN CERTIFICATE-----/.test(ca)) problems.push("DATABASE_CA is not a PEM certificate");
  return problems;
}

/** The `ssl` option of the client: false, or a verifying TLS configuration. It never accepts an unverified certificate. */
export function databaseTls(url, { mode, ca = null }) {
  if (mode === "disable") return false;
  if (mode !== "verify-full") throw new Error(`database TLS mode refused: ${mode}`);
  const host = hostOf(url);
  if (!host) throw new Error("database URL has no host");
  const bare = host.replace(/^\[|\]$/g, "");
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
    // The client passes no host to tls.connect when it hands over its own socket, and sets no servername
    // for an IP address; the identity is then checked against this host, the one the URL names.
    host: bare,
    ...(isIP(bare) ? {} : { servername: bare }),
    checkServerIdentity: (_name, cert) => checkServerIdentity(bare, cert),
  };
}
