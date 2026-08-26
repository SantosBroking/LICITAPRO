// server/emission/diagnosticLog.test.js
//
// LP-EMIT-DIAG-001 — proves the diagnostic logger's extraction is a strict
// four-field allowlist (name/code/errno/syscall) and NEVER leaks message,
// stack, cause.message, connection strings, DATABASE_URL, SQL text, query
// params, or tokens — even when those are present on the error object.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeErrorMeta, logEmissionDiagnostic } = require('./diagnosticLog.js');

function withCapturedConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test('safeErrorMeta: extracts ONLY name/code/errno/syscall, never message/stack/other fields', () => {
  const err = new Error('connection to postgres://user:hunter2@internal-db.prod.example:5432/postgres failed');
  err.code = 'ECONNREFUSED';
  err.errno = -111;
  err.syscall = 'connect';
  err.stack = 'Error: ...\n at fake stack trace';
  err.detail = 'Key (id)=(abc) already exists.';
  err.hint = 'some hint text';
  err.where = 'PL/pgSQL function validate_quote_for_emission';
  err.connectionString = 'postgres://user:hunter2@internal-db.prod.example:5432/postgres';

  const meta = safeErrorMeta(err);

  assert.deepEqual(Object.keys(meta).sort(), ['code', 'errno', 'name', 'syscall']);
  assert.equal(meta.name, 'Error');
  assert.equal(meta.code, 'ECONNREFUSED');
  assert.equal(meta.errno, -111);
  assert.equal(meta.syscall, 'connect');
});

test('safeErrorMeta: non-object / null / undefined -> {}', () => {
  assert.deepEqual(safeErrorMeta(null), {});
  assert.deepEqual(safeErrorMeta(undefined), {});
  assert.deepEqual(safeErrorMeta('a string error'), {});
});

test('logEmissionDiagnostic: emits exactly the documented shape, one JSON line, no forbidden substrings', () => {
  const sensitive = 'hunter2';
  const dbUrl = 'postgres://postgres:hunter2@db.internal.example:6543/postgres?sslmode=require';
  const err = new Error(`connect failed for ${dbUrl}`);
  err.name = 'Error';
  err.code = 'ECONNREFUSED';
  err.errno = -111;
  err.syscall = 'connect';
  err.stack = `Error: connect failed for ${dbUrl}\n    at Object.<anonymous>`;
  err.cause = new Error(`nested cause referencing ${dbUrl}`);
  err.cause.name = 'AggregateError';
  err.cause.code = '28P01';

  const lines = withCapturedConsoleError(() => {
    logEmissionDiagnostic({ externalCode: 'PERSISTENCE_TRANSACTION_FAILURE', stage: 'DB_ACQUIRE', err });
  });

  assert.equal(lines.length, 1, 'exactly one log line');
  const parsed = JSON.parse(lines[0]);

  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['cause_code', 'cause_errno', 'cause_name', 'cause_syscall', 'error_code', 'error_name', 'errno', 'event', 'external_code', 'stage', 'syscall'].sort(),
  );
  assert.equal(parsed.event, 'LP_EMIT_DIAGNOSTIC');
  assert.equal(parsed.external_code, 'PERSISTENCE_TRANSACTION_FAILURE');
  assert.equal(parsed.stage, 'DB_ACQUIRE');
  assert.equal(parsed.error_code, 'ECONNREFUSED');
  assert.equal(parsed.errno, -111);
  assert.equal(parsed.syscall, 'connect');
  assert.equal(parsed.cause_name, 'AggregateError');
  assert.equal(parsed.cause_code, '28P01');

  const serialized = lines[0];
  assert.ok(!serialized.includes(sensitive), 'must never leak the password');
  assert.ok(!serialized.includes('postgres://'), 'must never leak any connection string / DATABASE_URL');
  assert.ok(!serialized.includes('at Object'), 'must never leak stack trace text');
  assert.ok(!serialized.toLowerCase().includes('sslmode'), 'must never leak connection string query params');
});

test('logEmissionDiagnostic: never throws, even if err is malformed/null/undefined', () => {
  assert.doesNotThrow(() => logEmissionDiagnostic({ externalCode: 'QUOTE_NOT_EMITTABLE', stage: 'LOAD_QUOTE', err: null }));
  assert.doesNotThrow(() => logEmissionDiagnostic({ externalCode: 'QUOTE_NOT_EMITTABLE', stage: undefined, err: undefined }));
});

test('logEmissionDiagnostic: missing stage falls back to "UNKNOWN"', () => {
  const lines = withCapturedConsoleError(() => {
    logEmissionDiagnostic({ externalCode: 'EMISSION_CONCURRENCY_CONFLICT', err: { name: 'Error', code: '55P03' } });
  });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'UNKNOWN');
});
