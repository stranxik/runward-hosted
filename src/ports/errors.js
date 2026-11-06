// Part of the TenantStore contract: a unique constraint the store refused, named as the database names it.
export class StoreConflict extends Error {
  constructor(constraint) {
    super(`unique constraint: ${constraint}`);
    this.constraint = constraint;
  }
}
