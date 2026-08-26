// server/emission/emissionErrors.js
//
// LP-EMIT-004 — external canonical error categories from LP-EMIT-001 §9.1,
// as concrete Error subclasses `emitQuote.js` throws. Every class carries a
// stable `.code` (the LP-EMIT-001 canonical code) plus whatever contextual
// fields §9.1 specifies for that category. `EmissionConcurrencyConflictError`
// is NOT redefined here — it already exists, correctly shaped, in
// `transactionCoordinator.js` (LP-EMIT-003/003R) and is re-exported below so
// callers only need one module to import from.

'use strict';

const { EmissionConcurrencyConflictError } = require('./transactionCoordinator.js');

class QuoteNotEmittableError extends Error {
  /**
   * @param {string[]} failedCheckNames - check_name values from
   *   validate_quote_for_emission() with passed=false, OR a single
   *   synthetic name (e.g. 'quote.status') for the lifecycle precondition
   *   that validate_quote_for_emission() itself does not contain
   *   (LP-EMIT-001 §2.3/§7 paso 1, LP-EMIT-001S corrección 2).
   * @param {Array<{check_name:string,passed:boolean,detail:string}>} [checks]
   *   the full row set from validate_quote_for_emission(), when available,
   *   for diagnostics — never required to interpret the error itself.
   */
  constructor(failedCheckNames, checks) {
    super(`QUOTE_NOT_EMITTABLE: ${failedCheckNames.join(', ')}`);
    this.name = 'QuoteNotEmittableError';
    this.code = 'QUOTE_NOT_EMITTABLE';
    this.failedCheckNames = failedCheckNames;
    if (checks !== undefined) this.checks = checks;
  }
}

class FinancialCalculationRejectedError extends Error {
  /** @param {Error} cause - the original error thrown by quote-core/pricingEngine.js */
  constructor(cause) {
    super(`FINANCIAL_CALCULATION_REJECTED: ${cause && cause.message}`);
    this.name = 'FinancialCalculationRejectedError';
    this.code = 'FINANCIAL_CALCULATION_REJECTED';
    this.cause = cause;
    // LP-EMIT-001R §9.2 — preserve the original code when the cause exposes
    // a structured one (QuoteEngineAdapterError.code); never invent one when
    // it doesn't (a plain pricingEngine.js Error has none).
    if (cause && cause.code !== undefined) this.engineErrorCode = cause.code;
  }
}

class EmissionInternalInvariantFailureError extends Error {
  constructor(message, cause) {
    super(`EMISSION_INTERNAL_INVARIANT_FAILURE: ${message}`);
    this.name = 'EmissionInternalInvariantFailureError';
    this.code = 'EMISSION_INTERNAL_INVARIANT_FAILURE';
    if (cause !== undefined) this.cause = cause;
  }
}

class CommercialSnapshotIncompleteError extends Error {
  constructor(missingField) {
    super(`COMMERCIAL_SNAPSHOT_INCOMPLETE: ${missingField}`);
    this.name = 'CommercialSnapshotIncompleteError';
    this.code = 'COMMERCIAL_SNAPSHOT_INCOMPLETE';
    this.missingField = missingField;
  }
}

class SupplementalCommercialInconsistencyError extends Error {
  constructor(pricingGroupId) {
    super(`SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY: pricing_group ${pricingGroupId} has pricing_mode set but no valid commercial anchor`);
    this.name = 'SupplementalCommercialInconsistencyError';
    this.code = 'SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY';
    this.pricingGroupId = pricingGroupId;
  }
}

class PersistenceTransactionFailureError extends Error {
  /**
   * @param {{ cause: Error, commitOutcome?: 'UNKNOWN', rollbackError?: Error }} opts
   *   `commitOutcome` is set to 'UNKNOWN' ONLY when this wraps a
   *   transactionCoordinator EmissionCommitOutcomeUnknownError
   *   (LP-EMIT-001C §9.2A) — otherwise omitted entirely (a pre-COMMIT
   *   infrastructure failure has an unambiguous outcome: not committed).
   */
  constructor({ cause, commitOutcome, rollbackError } = {}) {
    super(`PERSISTENCE_TRANSACTION_FAILURE${commitOutcome ? ` (commit_outcome=${commitOutcome})` : ''}: ${cause && cause.message}`);
    this.name = 'PersistenceTransactionFailureError';
    this.code = 'PERSISTENCE_TRANSACTION_FAILURE';
    this.cause = cause;
    if (commitOutcome !== undefined) this.commitOutcome = commitOutcome;
    if (rollbackError !== undefined) this.rollbackError = rollbackError;
  }
}

module.exports = {
  QuoteNotEmittableError,
  EmissionConcurrencyConflictError,
  FinancialCalculationRejectedError,
  EmissionInternalInvariantFailureError,
  CommercialSnapshotIncompleteError,
  SupplementalCommercialInconsistencyError,
  PersistenceTransactionFailureError,
};
