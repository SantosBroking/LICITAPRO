// api/emit-quote.js
//
// LP-EMIT-004 — the SINGLE public endpoint for LP-EMIT-001 emission. This
// handler is deliberately thin: it validates the HTTP method, resolves
// quote_id (and, when present, an actor id), calls `emitQuote`, and
// serializes the result/error. It contains NO SQL, NO financial
// calculation, and NO snapshot construction — all of that lives in
// `server/emission/*`, which this handler only calls into.
//
// Uses a real `pg` connection via `server/db/postgres.js` — never
// supabase-js, never PostgREST — reading its connection string exclusively
// from `process.env.DATABASE_URL` (never hardcoded). This endpoint does not
// touch Supabase production; DATABASE_URL is expected to be set by whoever
// deploys/tests this, and this file never logs its value.

'use strict';

const { emitQuote } = require('../server/emission/emitQuote.js');
const { createPostgresDb } = require('../server/db/postgres.js');

const HTTP_STATUS_BY_ERROR_CODE = {
  QUOTE_NOT_EMITTABLE: 409,
  EMISSION_CONCURRENCY_CONFLICT: 409,
  FINANCIAL_CALCULATION_REJECTED: 422,
  EMISSION_INTERNAL_INVARIANT_FAILURE: 500,
  COMMERCIAL_SNAPSHOT_INCOMPLETE: 422,
  SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY: 500,
  PERSISTENCE_TRANSACTION_FAILURE: 500,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok: false, error: 'Falta el cuerpo de la solicitud' });
  }

  const quoteId = body.quote_id;
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta quote_id' });
  }

  // Actor resolution: this vertical slice does not yet wire up the
  // Supabase-Auth-derived session used by the rest of this repo's `api/*.js`
  // handlers (that would mean this endpoint depends on supabase-js/
  // PostgREST for auth, which §4 explicitly keeps out of the emission path
  // itself — resolving that integration is left to a future mission). For
  // now, an already-authenticated caller may pass a known actor UUID
  // explicitly; absent that, `actorId` stays `null` (both `issued_by` and
  // `created_by` are nullable per LP-SCHEMA-002 §14/§15).
  const actorId = typeof body.actor_id === 'string' && body.actor_id ? body.actor_id : null;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Never reveal *why* in detail beyond this — no secret, no connection
    // string, ever reaches a response or a log line.
    return res.status(500).json({ ok: false, error: 'No se puede procesar la solicitud' });
  }

  const db = createPostgresDb({ connectionString });

  try {
    const result = await emitQuote({ db, quoteId, actorId });
    // `result` (see emitQuote.js) already contains ONLY the §9.3 shape —
    // quote_id, quote_version_id, version_number, status, issued_at, engine
    // metadata. quote_version_calculation (engine_input/engine_output/
    // internal_calculation_snapshot) is never read back here and therefore
    // structurally cannot leak into this response.
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = HTTP_STATUS_BY_ERROR_CODE[err && err.code] || 500;
    const responseBody = { ok: false, code: (err && err.code) || 'UNKNOWN_ERROR', error: (err && err.message) || 'Error desconocido' };
    if (err && err.failedCheckNames) responseBody.failed_check_names = err.failedCheckNames;
    if (err && err.commitOutcome) responseBody.commit_outcome = err.commitOutcome;
    // Never include `err.cause`/`err.rollbackError`/raw stack traces in the
    // HTTP response or in a log line here — those may carry infrastructure
    // detail (connection strings, internal error text) that does not
    // belong in a client-facing payload. A future mission may wire proper
    // server-side structured logging with redaction; this handler stays
    // silent rather than risk leaking anything.
    return res.status(status).json(responseBody);
  }
};
