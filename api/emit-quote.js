// api/emit-quote.js
//
// LP-EMIT-004 / LP-EMIT-004R — the SINGLE public endpoint for LP-EMIT-001
// emission. This handler is deliberately thin: it authenticates the caller,
// validates quote_id, calls `emitQuote`, and serializes the result/error. It
// contains NO SQL, NO financial calculation, and NO snapshot construction —
// all of that lives in `server/emission/*`, which this handler only calls
// into.
//
// Uses a real `pg` connection via `server/db/postgres.js` — never
// supabase-js, never PostgREST, for the emission itself — reading its
// connection string exclusively from `process.env.DATABASE_URL` (never
// hardcoded). This endpoint does not touch Supabase production for the
// emission transaction; DATABASE_URL is expected to be set by whoever
// deploys/tests this, and this file never logs its value.
//
// LP-EMIT-004R corrección 3 — authentication reuses the EXACT pattern
// already established by `api/save-project.js` (Supabase Auth token ->
// `user_profiles` lookup -> active/role gate), including its hardcoded
// SUPA_URL/SUPA_ANON_KEY (the anon key is public by design — it is the same
// value already shipped to every browser client of this app, not a secret).
// This endpoint does NOT use SUPABASE_SERVICE_ROLE_KEY and introduces no new
// secret. `api/save-project.js` itself is left untouched.

'use strict';

const { emitQuote } = require('../server/emission/emitQuote.js');
const { createPostgresDb } = require('../server/db/postgres.js');

const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// LP-EMIT-004R corrección 4 — one safe, generic HTTP-facing message per
// external canonical code. Never derived from err.message/cause.message —
// those can carry PostgreSQL/infra detail (constraint text, connection
// errors) even when this file never touches `err.cause` directly.
const SAFE_MESSAGE_BY_CODE = {
  QUOTE_NOT_EMITTABLE: 'La cotización no cumple las condiciones para emitirse.',
  EMISSION_CONCURRENCY_CONFLICT: 'La cotización está siendo emitida por otra operación en este momento. Intente de nuevo.',
  FINANCIAL_CALCULATION_REJECTED: 'El cálculo financiero de la cotización fue rechazado.',
  EMISSION_INTERNAL_INVARIANT_FAILURE: 'Ocurrió un error interno al validar la coherencia de la emisión.',
  // LP-EMIT-004R corrección 4 — COMMERCIAL_SNAPSHOT_INCOMPLETE is a bug/
  // invariante del sistema (falta un dato que el contrato exige que exista
  // en este punto), no un problema del caller -> 500, no 422.
  COMMERCIAL_SNAPSHOT_INCOMPLETE: 'Ocurrió un error interno al construir la información comercial de la emisión.',
  SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY: 'Ocurrió un error interno de consistencia comercial en la emisión.',
  PERSISTENCE_TRANSACTION_FAILURE: 'No se pudo confirmar la emisión. Verifique el estado de la cotización antes de reintentar.',
};

const HTTP_STATUS_BY_ERROR_CODE = {
  QUOTE_NOT_EMITTABLE: 409,
  EMISSION_CONCURRENCY_CONFLICT: 409,
  FINANCIAL_CALCULATION_REJECTED: 422,
  EMISSION_INTERNAL_INVARIANT_FAILURE: 500,
  COMMERCIAL_SNAPSHOT_INCOMPLETE: 500,
  SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY: 500,
  PERSISTENCE_TRANSACTION_FAILURE: 500,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  // ── Autenticación (LP-EMIT-004R corrección 3) — ANTES de abrir la
  // transacción de emisión, ANTES incluso de leer/validar el body. ──
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'Falta sesión' });

  let authUser;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ ok: false, error: 'Sesión inválida o expirada' });
    authUser = await r.json();
    if (!authUser || !authUser.id) return res.status(401).json({ ok: false, error: 'Sesión inválida o expirada' });
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'No se pudo verificar la sesión' });
  }

  let profile;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${authUser.id}&select=email,role,active`, {
      headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(403).json({ ok: false, error: 'No se pudo verificar el perfil' });
    const rows = await r.json();
    profile = rows && rows[0];
  } catch (e) {
    return res.status(403).json({ ok: false, error: 'No se pudo verificar el perfil' });
  }
  if (!profile) return res.status(403).json({ ok: false, error: 'No existe un perfil para este usuario' });
  if (!profile.active) return res.status(403).json({ ok: false, error: 'Cuenta inactiva' });
  if (profile.role !== 'admin' && profile.role !== 'empleado') {
    return res.status(403).json({ ok: false, error: 'Rol no reconocido' });
  }

  // ── Body ──
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

  // LP-EMIT-004R corrección 3 — el actor efectivo SIEMPRE es authUser.id;
  // body.actor_id nunca se usa, y si viene presente se rechaza explícitamente
  // (Control Tower prefiere rechazar antes que ignorar en silencio, para
  // evitar la ambigüedad de un caller que cree que puede suplantar actor).
  if (Object.prototype.hasOwnProperty.call(body, 'actor_id')) {
    return res.status(400).json({ ok: false, error: 'actor_id no es un campo válido en esta solicitud; el actor se determina por la sesión autenticada' });
  }

  const quoteId = body.quote_id;
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta quote_id' });
  }
  // LP-EMIT-004R corrección 7 — validación de shape UUID en el boundary
  // HTTP, antes de que quote_id llegue a PostgreSQL.
  if (!UUID_RE.test(quoteId)) {
    return res.status(400).json({ ok: false, error: 'quote_id no tiene un formato UUID válido' });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Never reveal *why* in detail beyond this — no secret, no connection
    // string, ever reaches a response or a log line.
    return res.status(500).json({ ok: false, error: 'No se puede procesar la solicitud' });
  }

  const db = createPostgresDb({ connectionString });

  try {
    const result = await emitQuote({ db, quoteId, actorId: authUser.id });
    // `result` (see emitQuote.js) already contains ONLY the §9.3 shape —
    // quote_id, quote_version_id, version_number, status, issued_at, engine
    // metadata. quote_version_calculation (engine_input/engine_output/
    // internal_calculation_snapshot) is never read back here and therefore
    // structurally cannot leak into this response.
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = (err && err.code) || 'UNKNOWN_ERROR';
    const status = HTTP_STATUS_BY_ERROR_CODE[code] || 500;
    // LP-EMIT-004R corrección 4 — a fixed, safe message per code. Never
    // err.message (some Error subclasses embed cause.message in their own
    // message string — see FinancialCalculationRejectedError/
    // PersistenceTransactionFailureError — so even avoiding `err.cause`
    // directly is not sufficient).
    const responseBody = { ok: false, code, error: SAFE_MESSAGE_BY_CODE[code] || 'Ocurrió un error al procesar la emisión.' };
    if (err && err.failedCheckNames) responseBody.failed_check_names = err.failedCheckNames;
    if (err && err.commitOutcome) responseBody.commit_outcome = err.commitOutcome;
    if (err && err.reconciliationQuoteVersionId) responseBody.reconciliation_quote_version_id = err.reconciliationQuoteVersionId;
    // Never include `err.cause`/`err.rollbackError`/`err.releaseError`/raw
    // stack traces/SQL/DATABASE_URL/host/constraint detail in the HTTP
    // response or in a log line here. A future mission may wire proper
    // server-side structured logging with redaction; this handler stays
    // silent rather than risk leaking anything.
    return res.status(status).json(responseBody);
  }
};
