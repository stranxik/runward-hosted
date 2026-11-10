#!/usr/bin/env node
// The client of the restore drill (runward/runbook.md §16), which calls it as `node scripts/drill-client.mjs`.
// The drill's browser and authenticator: it speaks to the service over HTTP as the web page does, and
// answers the WebAuthn ceremonies with ES256 keys made here (attestation "none", user verified). The
// service verifies them with the real @simplewebauthn/server. Keys and session cookies live in $R only,
// the run's throwaway directory; it prints {"status":…,"body":…} for each call. Never against production:
// DRILL_BASE defaults to the drill's local service.
//   open <session> <link token> <key>          redeem a link: a member, a first passkey, a session
//   signin <session> <key>                     a sign-in: another session
//   verify <session> <key> [gesture [object]]  a fresh, or per-gesture, verification
//   addkey <session> <key>                     a further passkey (after verify ... passkey-add)
//   call <session> <METHOD> <path> [json]      any other route, with the session's cookie
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.DRILL_BASE ?? "http://127.0.0.1:8787";
const ORIGIN = process.env.RW_ORIGIN ?? "http://localhost:8787";
if (!process.env.R) { console.error("drill: R (the run's throwaway directory) is required"); process.exit(2); }
const FILE = `${process.env.R}/drill-state.json`;
const st = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { keys: {}, sessions: {} };
const b64 = (b) => Buffer.from(b).toString("base64url");
const sha = (b) => createHash("sha256").update(b).digest();
const rpIdHash = sha(new URL(ORIGIN).hostname);

async function http(session, method, path, body) {
  const headers = { origin: ORIGIN, "accept-language": "en" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session && st.sessions[session]) headers.cookie = `__Host-rw_session=${st.sessions[session]}`;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = /__Host-rw_session=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
  if (set && session) { if (set[1]) st.sessions[session] = set[1]; else delete st.sessions[session]; }
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { bytes: text.length }; }
  return { status: r.status, body: json };
}
const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));

function register(name, challenge) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = Buffer.concat([Buffer.from("a5010203262001215820", "hex"), Buffer.from(jwk.x, "base64url"), Buffer.from("225820", "hex"), Buffer.from(jwk.y, "base64url")]);
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, 32]), id, cose]);
  const att = Buffer.concat([Buffer.from("a363666d74646e6f6e656761747453746d74a068617574684461746158", "hex"), Buffer.from([authData.length]), authData]);
  st.keys[name] = { id: b64(id), pem: privateKey.export({ type: "pkcs8", format: "pem" }) };
  return { id: b64(id), rawId: b64(id), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
    response: { clientDataJSON: b64(clientData("webauthn.create", challenge)), attestationObject: b64(att), transports: ["internal"] } };
}
function assert(name, challenge) {
  const k = st.keys[name];
  if (!k) throw new Error(`no key named ${name}`);
  const cd = clientData("webauthn.get", challenge);
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x05, 0, 0, 0, 0])]);
  const s = createSign("sha256"); s.update(Buffer.concat([authData, sha(cd)]));
  return { id: k.id, rawId: k.id, type: "public-key", clientExtensionResults: {},
    response: { clientDataJSON: b64(cd), authenticatorData: b64(authData), signature: b64(s.sign(k.pem)) } };
}

const [cmd, session, a, b, c] = process.argv.slice(2);
const sess = session === "-" ? null : session;
let out;
if (cmd === "open") {
  const o = await http(null, "POST", "/api/v0/links/options", { token: a });
  out = o.status === 200 ? await http(sess, "POST", "/api/v0/links/redeem", { token: a, challengeId: o.body.challengeId, response: register(b, o.body.options.challenge) }) : o;
} else if (cmd === "signin") {
  const o = await http(null, "POST", "/api/v0/auth/options", {});
  out = o.status === 200 ? await http(sess, "POST", "/api/v0/auth/verify", { challengeId: o.body.challengeId, response: assert(a, o.body.options.challenge) }) : o;
} else if (cmd === "verify") {
  const o = await http(sess, "POST", "/api/v0/auth/fresh/options", b ? { gesture: b, object: c ?? "" } : {});
  out = o.status === 200 ? await http(sess, "POST", "/api/v0/auth/fresh", { challengeId: o.body.challengeId, response: assert(a, o.body.options.challenge) }) : o;
} else if (cmd === "addkey") {
  const o = await http(sess, "POST", "/api/v0/passkeys/options");
  out = o.status === 200 ? await http(sess, "POST", "/api/v0/passkeys", { challengeId: o.body.challengeId, response: register(a, o.body.options.challenge) }) : o;
} else if (cmd === "call") {
  out = await http(sess, a, b, c === undefined ? undefined : JSON.parse(c));
} else { console.error("drill: open | signin | verify | addkey | call"); process.exit(2); }
writeFileSync(FILE, JSON.stringify(st), { mode: 0o600 });
console.log(JSON.stringify(out));
