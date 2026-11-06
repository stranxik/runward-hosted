// The HumanAuthenticator port on @simplewebauthn/server, the one WebAuthn dependency (PADR-0016 point 2).
// Options: resident key required, user verification required, no attestation (PADR-0012 point 1).
// The challenge is generated here and stored by the application, which consumes it before verifying.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";

export function simpleWebAuthn({ rpID, rpName = "runward hébergé", origin }) {
  return {
    rpID,
    async registrationOptions({ memberId, label, exclude = [] }) {
      return generateRegistrationOptions({
        rpName, rpID,
        userID: new TextEncoder().encode(memberId),
        userName: label,
        userDisplayName: label,
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        excludeCredentials: exclude.map((p) => ({ id: p.credentialId, transports: p.transports ?? [] })),
        timeout: 300_000,
      });
    },
    async verifyRegistration({ response, expectedChallenge }) {
      const v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }).catch(() => null);
      if (!v?.verified || !v.registrationInfo) return null;
      const { credential, aaguid } = v.registrationInfo;
      return { credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter, transports: credential.transports ?? response?.response?.transports ?? [], aaguid: aaguid ?? null };
    },
    async authenticationOptions({ allow = [] } = {}) {
      return generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: allow.map((p) => ({ id: p.credentialId, transports: p.transports ?? [] })), timeout: 300_000 });
    },
    async verifyAuthentication({ response, expectedChallenge, credential }) {
      const v = await verifyAuthenticationResponse({
        response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [] },
      }).catch(() => null);
      if (!v?.verified) return null;
      return { newCounter: v.authenticationInfo.newCounter };
    },
  };
}
