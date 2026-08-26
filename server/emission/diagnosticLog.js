// server/emission/diagnosticLog.js
//
// LP-EMIT-DIAG-001 — TEMPORARY server-side diagnostic instrumentation for the
// real-runtime emission path. This module exists ONLY to help distinguish
// CONNECT/transport failures from failures inside the transaction/domain
// logic while diagnosing a live Preview issue; it changes NO external
// behavior (HTTP contract, error codes, commit_outcome semantics all stay
// exactly as LP-EMIT-001/LP-EMIT-004/LP-EMIT-004R defined them) and adds no
// new architecture — it only reads a handful of already-safe driver-level
// fields off an error object and writes one structured line to
// console.error (Vercel captures stdout/stderr from serverless functions as
// server logs; nothing here opens a new log sink).
//
// STRICT extraction whitelist — NEVER read/log anything else off an error:
//   name, code, errno, syscall
// Explicitly NEVER read/log: message, stack, cause.message, SQL text, query
// params, PostgreSQL detail/hint/where, connection strings, DATABASE_URL,
// passwords, tokens/JWTs, Authorization headers, or any full URL. This is
// deliberately narrower than "redact the obvious secrets" — it is an
// allowlist of four fields, not a denylist of everything unsafe.

'use strict';

/**
 * Extracts ONLY the four safe driver-level fields from an error-like value.
 * Every other property (including `.message`, which on Node/`pg` errors can
 * legitimately embed a connection string, SQL snippet, or DETAIL/HINT/WHERE
 * text) is deliberately never touched here.
 *
 * @param {any} err
 * @returns {{ name?: string, code?: string, errno?: string|number, syscall?: string }}
 */
function safeErrorMeta(err) {
  if (!err || typeof err !== 'object') return {};
  const meta = {};
  if (typeof err.name === 'string') meta.name = err.name;
  if (typeof err.code === 'string' || typeof err.code === 'number') meta.code = err.code;
  if (typeof err.errno === 'string' || typeof err.errno === 'number') meta.errno = err.errno;
  if (typeof err.syscall === 'string') meta.syscall = err.syscall;
  return meta;
}

/**
 * Logs ONE structured, secret-free diagnostic line for a failed emission
 * attempt. Never throws (a logging failure must never affect the emission
 * outcome or its HTTP contract) — any internal error here is swallowed.
 *
 * @param {{ externalCode: string, stage?: string, err: any }} params
 */
function logEmissionDiagnostic({ externalCode, stage, err }) {
  try {
    const meta = safeErrorMeta(err);
    const causeMeta = err && err.cause ? safeErrorMeta(err.cause) : {};
    // Every field is always present (defaulted to `null`, never omitted) so
    // the shape is consistent for whoever reads Vercel's server logs — a
    // plain `undefined` value would otherwise be silently dropped by
    // JSON.stringify, making the log line's shape depend on which fields
    // happened to be set on a given error.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'LP_EMIT_DIAGNOSTIC',
        external_code: externalCode,
        stage: stage || 'UNKNOWN',
        error_name: meta.name ?? null,
        error_code: meta.code ?? null,
        errno: meta.errno ?? null,
        syscall: meta.syscall ?? null,
        cause_name: causeMeta.name ?? null,
        cause_code: causeMeta.code ?? null,
        cause_errno: causeMeta.errno ?? null,
        cause_syscall: causeMeta.syscall ?? null,
      }),
    );
  } catch (loggingErr) {
    // Never let diagnostic logging itself break emission — swallow silently.
  }
}

module.exports = { safeErrorMeta, logEmissionDiagnostic };
