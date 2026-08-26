// server/db/postgres.js
//
// LP-EMIT-003 — CAPABILITY SPIKE. Real (not-yet-used) PostgreSQL adapter
// shape for `server/emission/transactionCoordinator.js`'s `db` interface.
//
// This file is NOT exercised by the spike's tests, does NOT open any real
// connection at import time, and does NOT require DATABASE_URL to exist for
// `node --test` to run — `pg` is only `require()`d lazily, inside
// `createPostgresDb()`, the first time a caller actually asks for a real
// client. Importing this module with no DATABASE_URL set and never calling
// `createPostgresDb(...).acquireClient()` is always safe.
//
// Per LP-EMIT-002/003 canonical direction: Vercel Node Function + `pg` +
// Supavisor in TRANSACTION MODE + one pg client held for the entire emission.
// This adapter intentionally does NOT use a shared/module-level Pool reused
// across serverless invocations — each `acquireClient()` call here opens one
// dedicated `pg.Client` and the caller is responsible for the coordinator's
// `release()` closing it. Pool-vs-single-client and any Supavisor-specific
// connection-string requirements are exactly the kind of infra decision
// LP-EMIT-002 §6 already flagged as DECISION_REQUIRED — not resolved here.
//
// No connection string is hardcoded anywhere in this file. No secret is
// created. Nothing here uses SUPABASE_SERVICE_ROLE_KEY (that key only
// authenticates against PostgREST/Auth, never against the Postgres wire
// protocol `pg` speaks) — the real adapter, when actually implemented, is
// expected to read its connection string from an as-yet-undecided env var
// (see LP-EMIT-002 §6, DECISION_REQUIRED 1).

'use strict';

/**
 * Creates a `db` object satisfying the minimal contract
 * `transactionCoordinator.js` expects: `{ acquireClient(): Promise<Client> }`,
 * where `Client` exposes `query(sql, params)` and `release()`.
 *
 * `connectionString` is accepted as an explicit parameter (never read from
 * `process.env` inside this module) so that:
 *   (a) no DATABASE_URL is required merely to `require()` this file, and
 *   (b) the caller (a future api/emit-quote.js) stays in control of exactly
 *       which env var name is authoritative — a decision LP-EMIT-002 §6
 *       left open.
 *
 * @param {{ connectionString: string }} config
 * @returns {{ acquireClient: () => Promise<{ query: Function, release: Function }> }}
 */
function createPostgresDb(config) {
  if (!config || typeof config.connectionString !== 'string' || !config.connectionString) {
    throw new TypeError('createPostgresDb: config.connectionString is required');
  }

  return {
    async acquireClient() {
      // Lazy require: `pg` is only ever loaded when a real client is
      // actually requested — never merely by importing this module.
      // eslint-disable-next-line global-require
      const { Client } = require('pg');
      const client = new Client({ connectionString: config.connectionString });
      try {
        await client.connect();
      } catch (connectErr) {
        // LP-EMIT-DIAG-001 — TEMPORARY: tag the stage so a caller's
        // diagnostic log can distinguish "never connected" from a failure
        // inside the transaction itself, without reading/logging the error's
        // own message (which for a `pg` connect failure can embed the
        // connection string). Does not change what is thrown.
        if (connectErr && !connectErr.stage) connectErr.stage = 'DB_ACQUIRE';
        throw connectErr;
      }
      return {
        query: (sql, params) => client.query(sql, params),
        release: () => client.end(),
      };
    },
  };
}

module.exports = { createPostgresDb };
