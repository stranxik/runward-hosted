// Part of the TenantStore contract: a unique constraint the store refused, named as the database names it.
export class StoreConflict extends Error {
  constructor(constraint) {
    super(`unique constraint: ${constraint}`);
    this.constraint = constraint;
  }
}

// Part of the WorkloadVerifier contract: the verifier could not do its work (the issuer's keys cannot be
// read). It is the service's failure, never the token's: the upload answers 503 `service-unavailable`,
// which the send workflow retries. Any other error a verifier throws without a refusal code is a token it
// could not read.
export class VerifierUnavailable extends Error {}
