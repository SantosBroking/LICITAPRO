// server/emission/transactionCoordinator.js
//
// LP-EMIT-003 / LP-EMIT-003R — CAPABILITY SPIKE (offline/mock only, no real
// DB connection).
//
// This module is the *boundary* a future LP-EMIT-001 implementation will use
// to run the atomic quote emission sequence (LP-EMIT-001 §7) inside a single
// PostgreSQL session/transaction, while still calling out to pure JavaScript
// (quote-core.calculateQuoteDraft) *without* leaving that transaction.
//
// It does NOT know about `quote`, `pricing_group`, `quote-core`, or the
// engine. It knows only:
//   - how to acquire/release a DB client from a `db` object
//     ({ acquireClient(): Promise<Client> }),
//   - how to BEGIN / SET ISOLATION LEVEL (fixed, see LP-EMIT-003R §2) /
//     attempt a fail-fast lock / run an arbitrary async callback with that
//     same client / COMMIT / ROLLBACK / always release.
//
// quote-core and pricingEngine.js are NEVER imported here (LP-EMIT-002/003
// canonical rule: engine and quote-core stay pure — no DB access is added to
// either). The JS calculation logic is the caller's `run(client)` callback;
// this module has no idea what runs inside it.
//
// Client contract expected of whatever `db.acquireClient()` resolves to:
//   client.query(sql, params) -> Promise<any>
//   client.release()          -> void | Promise<void>
// This is intentionally the same minimal shape `pg`'s Client/PoolClient
// exposes, but nothing here imports `pg` — see server/db/postgres.js for the
// real adapter that will eventually satisfy this same contract.

'use strict';

// PostgreSQL error code for "lock could not be acquired immediately"
// (what NOWAIT/lock_timeout=0 produces on a row already locked by another
// session). This is the *stable* SQLSTATE, not a heuristic on error text —
// LP-EMIT-003 §6 explicitly requires mapping by SQLSTATE, never by parsing
// error messages.
const PG_SQLSTATE_LOCK_NOT_AVAILABLE = '55P03';

// LP-EMIT-003R, corrección 2 — fixed, non-configurable isolation level for
// Standalone Quote v1. This is the ONLY isolation-level statement this
// coordinator will ever send; it is a literal, never built by interpolating
// caller-provided input. The public API of `runEmissionTransaction` does not
// accept an isolation level parameter — there is nothing for a caller to
// override.
const ISOLATION_LEVEL_SQL = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ';

class EmissionConcurrencyConflictError extends Error {
  constructor(cause) {
    super('EMISSION_CONCURRENCY_CONFLICT: could not acquire emission lock (NOWAIT)');
    this.name = 'EmissionConcurrencyConflictError';
    this.code = 'EMISSION_CONCURRENCY_CONFLICT';
    if (cause !== undefined) this.cause = cause;
  }
}

// LP-EMIT-003R, corrección 1 (nueva) — represents a COMMIT that itself threw.
// This is intentionally NOT modeled as "rolled back" / "not committed": a
// COMMIT that throws (e.g. connection lost while waiting for PostgreSQL's
// response) leaves the REAL outcome indeterminate from this generic
// boundary's point of view — PostgreSQL may have completed the commit before
// the failure occurred. `commitOutcome` is therefore always exactly
// `'UNKNOWN'` on this error class; there is no `'NOT_COMMITTED'` value, and a
// later successful best-effort ROLLBACK does NOT change that. Mapping this
// internal spike-level error to LP-EMIT-001's external canonical error codes
// (e.g. `PERSISTENCE_TRANSACTION_FAILURE`) is explicitly deferred to the
// future emission layer — this spike does not alter LP-EMIT-001's canonical
// codes.
class EmissionCommitOutcomeUnknownError extends Error {
  constructor(cause) {
    super(
      'EMISSION_COMMIT_OUTCOME_UNKNOWN: COMMIT itself threw — this boundary ' +
        'cannot determine whether PostgreSQL completed the commit before the ' +
        'failure occurred. Treat the transaction outcome as indeterminate, ' +
        'never as "rolled back".',
    );
    this.name = 'EmissionCommitOutcomeUnknownError';
    this.code = 'EMISSION_COMMIT_OUTCOME_UNKNOWN';
    this.commitOutcome = 'UNKNOWN';
    this.cause = cause;
    // Populated only if a best-effort ROLLBACK attempt (see below) also
    // throws. Its presence/absence never changes `commitOutcome` — it is
    // diagnostic information only, exactly like `.rollbackError` on the
    // pre-commit error path.
    this.rollbackError = undefined;
  }
}

/**
 * Returns true iff `err` is the specific PostgreSQL error that a NOWAIT (or
 * equivalent fail-fast) lock attempt produces when the row is already locked
 * by another session. Checked exclusively via `err.code` (the driver-level
 * SQLSTATE), never via `err.message` string matching.
 */
function isLockNotAvailable(err) {
  return !!err && err.code === PG_SQLSTATE_LOCK_NOT_AVAILABLE;
}

/**
 * runEmissionTransaction — the exact lifecycle LP-EMIT-003/003R §5/§7
 * requires:
 *
 *   acquireClient
 *   -> BEGIN
 *   -> SET TRANSACTION ISOLATION LEVEL REPEATABLE READ   (fixed, not caller-configurable)
 *   -> lock query (fail-fast; a lock_not_available SQLSTATE is translated to
 *      EmissionConcurrencyConflictError, any other error propagates as-is)
 *   -> run(client)   [reads, pure JS calculation, writes — all caller-defined,
 *                      all executed against the SAME client]
 *   -> COMMIT
 *   -> release (always, in finally)
 *
 * PRE-COMMIT failures (BEGIN succeeded, but the isolation statement, the
 * lock, or run() throws): ROLLBACK is attempted, its outcome is attached as
 * `.rollbackError` on the original error if it too throws (never replacing
 * the original error), the client is released, and the original error is
 * re-thrown. This path's outcome is unambiguous: the transaction is known
 * NOT to have committed, because COMMIT was never even sent.
 *
 * COMMIT failure (LP-EMIT-003R, corrección 1 — the transaction outcome is
 * genuinely INDETERMINATE, not "known not committed"):
 *   A. COMMIT resolves successfully -> the operation succeeds, no ROLLBACK
 *      is ever sent, `run()`'s result is returned.
 *   B. COMMIT itself throws -> this coordinator does NOT assume the
 *      transaction failed to persist. It wraps the original error in
 *      `EmissionCommitOutcomeUnknownError` (`code:
 *      'EMISSION_COMMIT_OUTCOME_UNKNOWN'`, `commitOutcome: 'UNKNOWN'`,
 *      `cause:` the original COMMIT error).
 *   C. A best-effort ROLLBACK is still attempted after a COMMIT failure (the
 *      client may still be responsive even though the COMMIT round-trip
 *      failed) — but:
 *        - a successful best-effort ROLLBACK does NOT downgrade
 *          `commitOutcome` from `'UNKNOWN'` to anything else (PostgreSQL may
 *          already have committed before the ROLLBACK was even sent — a
 *          ROLLBACK sent to an already-committed session is a no-op from
 *          PostgreSQL's perspective and proves nothing about the earlier
 *          COMMIT's real outcome);
 *        - a failed best-effort ROLLBACK does NOT replace
 *          `EmissionCommitOutcomeUnknownError` — it is attached as
 *          `.rollbackError` on it, exactly like the pre-commit path;
 *        - the client is always released exactly once;
 *        - there is NO automatic retry of COMMIT or of the whole operation.
 *   This spike does not introduce two-phase commit, `PREPARE TRANSACTION`,
 *   or any idempotency redesign — `EmissionCommitOutcomeUnknownError` is
 *   purely an honest signal for the future emission layer to decide how to
 *   map onto LP-EMIT-001's canonical `PERSISTENCE_TRANSACTION_FAILURE` (that
 *   mapping decision is explicitly NOT made here).
 *
 * Never:
 *   - COMMIT after an error,
 *   - a successful COMMIT silently downgraded/reinterpreted after the fact,
 *   - release before the commit/rollback attempt has settled,
 *   - more than one client acquired for a single call,
 *   - automatic retry of COMMIT.
 *
 * @param {{ acquireClient: () => Promise<any> }} db
 * @param {{
 *   lock: { sql: string, params?: any[] },
 *   run: (client: any) => Promise<any>,
 * }} opts
 * @returns {Promise<any>} whatever `run(client)` resolved to
 */
async function runEmissionTransaction(db, opts) {
  if (!opts || typeof opts.run !== 'function') {
    throw new TypeError('runEmissionTransaction: opts.run(client) callback is required');
  }
  if (!opts.lock || typeof opts.lock.sql !== 'string') {
    throw new TypeError('runEmissionTransaction: opts.lock.sql is required');
  }

  // Step 1: acquire a client. If this itself throws, there is nothing to
  // BEGIN, nothing to ROLLBACK, and no client object to release — the error
  // propagates untouched (T6).
  const client = await db.acquireClient();

  let began = false;
  try {
    // Step 2: BEGIN
    await client.query('BEGIN');
    began = true;

    // Step 3: SET TRANSACTION ISOLATION LEVEL REPEATABLE READ (fixed literal)
    await client.query(ISOLATION_LEVEL_SQL);

    // Step 4: fail-fast lock (equivalent to SELECT ... FOR UPDATE NOWAIT)
    try {
      await client.query(opts.lock.sql, opts.lock.params);
    } catch (lockErr) {
      if (isLockNotAvailable(lockErr)) {
        throw new EmissionConcurrencyConflictError(lockErr);
      }
      throw lockErr;
    }

    // Step 5/6: caller-defined reads, pure JS calculation, and writes — all
    // executed against this same `client`, while the transaction stays open.
    const result = await opts.run(client);

    // Step 7: COMMIT — isolated in its own try/catch so a COMMIT failure can
    // be given its own (indeterminate-outcome) handling, distinct from every
    // pre-commit failure path above.
    try {
      await client.query('COMMIT');
    } catch (commitErr) {
      const outcomeErr = new EmissionCommitOutcomeUnknownError(commitErr);
      // Best-effort ROLLBACK — see class doc: never changes commitOutcome,
      // never replaces outcomeErr, never retried.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        outcomeErr.rollbackError = rollbackErr;
      }
      throw outcomeErr;
    }

    return result;
  } catch (err) {
    if (err instanceof EmissionCommitOutcomeUnknownError) {
      // Already fully handled (best-effort ROLLBACK already attempted)
      // inside the COMMIT try/catch above — do not attempt a second
      // ROLLBACK here, and do not reinterpret/replace this error.
      throw err;
    }
    if (began) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Never let the rollback's own failure replace/hide the original
        // error — attach it for diagnostics and keep propagating the cause
        // that actually triggered this catch block.
        err.rollbackError = rollbackErr;
      }
    }
    throw err;
  } finally {
    // Step 8/9: always release, exactly once, only after commit/rollback has
    // settled (this `finally` only runs once the try/catch body above,
    // including any awaited ROLLBACK, has fully resolved).
    await client.release();
  }
}

module.exports = {
  runEmissionTransaction,
  EmissionConcurrencyConflictError,
  EmissionCommitOutcomeUnknownError,
  isLockNotAvailable,
  PG_SQLSTATE_LOCK_NOT_AVAILABLE,
  ISOLATION_LEVEL_SQL,
};
