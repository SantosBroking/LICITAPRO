// api/emit-quote.test.js
//
// LP-EMIT-004R corrección 9 — HTTP-boundary tests for api/emit-quote.js:
// authentication, actor_id rejection, quote_id UUID validation, and safe
// error serialization. Auth/Profile are mocked via a stubbed global fetch;
// `emitQuote` itself and `createPostgresDb` are stubbed via require.cache so
// these tests never touch PostgreSQL/DATABASE_URL/real network — exactly the
// "mocks de Auth/Profile permitidos, NO red real" the mission requires.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const emitQuoteModulePath = require.resolve('../server/emission/emitQuote.js');
const postgresModulePath = require.resolve('../server/db/postgres.js');
const handlerModulePath = require.resolve('./emit-quote.js');

/**
 * Loads api/emit-quote.js with `emitQuote` and `createPostgresDb` replaced
 * by test doubles (via require.cache), so the handler under test never loads
 * the real `pg` driver or attempts a real DB call.
 */
function loadHandlerWithStubs({ emitQuoteStub }) {
  // `createPostgresDb` is stubbed below (never dials real PostgreSQL), but
  // api/emit-quote.js still gates on `process.env.DATABASE_URL` being
  // *present* before it even calls createPostgresDb — a dummy value is
  // sufficient and never actually used to open a connection in these tests.
  process.env.DATABASE_URL = 'postgres://test-stub-never-connected/db';

  delete require.cache[handlerModulePath];
  delete require.cache[emitQuoteModulePath];
  delete require.cache[postgresModulePath];

  require.cache[emitQuoteModulePath] = {
    id: emitQuoteModulePath,
    filename: emitQuoteModulePath,
    loaded: true,
    exports: { emitQuote: emitQuoteStub },
  };
  require.cache[postgresModulePath] = {
    id: postgresModulePath,
    filename: postgresModulePath,
    loaded: true,
    exports: { createPostgresDb: () => ({ acquireClient: async () => { throw new Error('unreachable in these tests'); } }) },
  };

  return require('./emit-quote.js');
}

function makeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const VALID_TOKEN = 'valid-token';
const AUTH_USER_ID = '11111111-1111-1111-1111-111111111111';
const VALID_QUOTE_ID = '22222222-2222-2222-2222-222222222222';

function makeReq({ token = VALID_TOKEN, body = { quote_id: VALID_QUOTE_ID } } = {}) {
  return {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

/** Installs a fetch stub for the auth/profile calls this handler makes. */
function stubFetch({ authOk = true, authBody = { id: AUTH_USER_ID }, profileOk = true, profileRows = [{ email: 'x@x.com', role: 'admin', active: true }] } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: authOk, json: async () => authBody };
    }
    if (String(url).includes('/rest/v1/user_profiles')) {
      return { ok: profileOk, json: async () => profileRows };
    }
    throw new Error(`unexpected fetch url in test: ${url}`);
  };
  return () => {
    globalThis.fetch = original;
  };
}

const DEFAULT_SUCCESS_RESULT = {
  quote_id: VALID_QUOTE_ID,
  quote_version_id: 'qv-1',
  version_number: 1,
  status: 'ISSUED',
  issued_at: '2026-08-01T00:00:00.000Z',
  engine: { engine_commit_sha: 'abc', engine_contract_version: 'v1', calculation_schema_version: 'v1' },
};

// ── sin Bearer → 401 ────────────────────────────────────────────────────

test('sin Authorization header -> 401, emitQuote never called', async () => {
  let called = false;
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => { called = true; return DEFAULT_SUCCESS_RESULT; } });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq({ token: null }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
    assert.equal(called, false);
  } finally {
    restoreFetch();
  }
});

// ── token inválido → 401 ────────────────────────────────────────────────

test('token inválido (Supabase Auth responde !ok) -> 401, emitQuote never called', async () => {
  let called = false;
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => { called = true; return DEFAULT_SUCCESS_RESULT; } });
  const restoreFetch = stubFetch({ authOk: false });
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 401);
    assert.equal(called, false);
  } finally {
    restoreFetch();
  }
});

// ── perfil inexistente/inactivo/rol inválido → 403 ──────────────────────

test('perfil inexistente -> 403', async () => {
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => DEFAULT_SUCCESS_RESULT });
  const restoreFetch = stubFetch({ profileRows: [] });
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 403);
  } finally {
    restoreFetch();
  }
});

test('perfil inactivo -> 403', async () => {
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => DEFAULT_SUCCESS_RESULT });
  const restoreFetch = stubFetch({ profileRows: [{ email: 'x@x.com', role: 'admin', active: false }] });
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 403);
  } finally {
    restoreFetch();
  }
});

test('rol inválido -> 403', async () => {
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => DEFAULT_SUCCESS_RESULT });
  const restoreFetch = stubFetch({ profileRows: [{ email: 'x@x.com', role: 'cliente_externo', active: true }] });
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 403);
  } finally {
    restoreFetch();
  }
});

// ── body.actor_id rechazado ──────────────────────────────────────────────

test('body.actor_id presente -> 400, sin importar el valor', async () => {
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => DEFAULT_SUCCESS_RESULT });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq({ body: { quote_id: VALID_QUOTE_ID, actor_id: 'someone-elses-id' } }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    restoreFetch();
  }
});

// ── quote_id no UUID → 400 ───────────────────────────────────────────────

test('quote_id no tiene shape UUID -> 400, emitQuote never called', async () => {
  let called = false;
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => { called = true; return DEFAULT_SUCCESS_RESULT; } });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq({ body: { quote_id: 'not-a-uuid' } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    restoreFetch();
  }
});

// ── actor efectivo proviene de authUser.id ───────────────────────────────

test('actor efectivo pasado a emitQuote es siempre authUser.id', async () => {
  let receivedActorId;
  const handler = loadHandlerWithStubs({
    emitQuoteStub: async ({ actorId }) => {
      receivedActorId = actorId;
      return DEFAULT_SUCCESS_RESULT;
    },
  });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(receivedActorId, AUTH_USER_ID);
  } finally {
    restoreFetch();
  }
});

// ── error 500 no filtra cause.message ────────────────────────────────────

test('PERSISTENCE_TRANSACTION_FAILURE: la respuesta 500 nunca expone cause.message/rollbackError/releaseError/stack', async () => {
  const sensitive = 'password=hunter2 host=internal-db.prod.example';
  const err = new Error(`PERSISTENCE_TRANSACTION_FAILURE: ${sensitive}`);
  err.code = 'PERSISTENCE_TRANSACTION_FAILURE';
  err.cause = new Error(sensitive);
  err.rollbackError = new Error(sensitive);
  const handler = loadHandlerWithStubs({
    emitQuoteStub: async () => {
      throw err;
    },
  });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 500);
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('hunter2'), 'must never leak sensitive cause/rollbackError text into the HTTP response');
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, 'cause'));
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, 'rollbackError'));
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, 'releaseError'));
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, 'stack'));
    assert.equal(res.body.code, 'PERSISTENCE_TRANSACTION_FAILURE');
  } finally {
    restoreFetch();
  }
});

// ── COMMERCIAL_SNAPSHOT_INCOMPLETE → 500 ─────────────────────────────────

test('COMMERCIAL_SNAPSHOT_INCOMPLETE -> HTTP 500 (bug/invariante, no 422)', async () => {
  const err = new Error('COMMERCIAL_SNAPSHOT_INCOMPLETE: issuer_snapshot: issuing_company row missing');
  err.code = 'COMMERCIAL_SNAPSHOT_INCOMPLETE';
  const handler = loadHandlerWithStubs({
    emitQuoteStub: async () => {
      throw err;
    },
  });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'COMMERCIAL_SNAPSHOT_INCOMPLETE');
  } finally {
    restoreFetch();
  }
});

// ── UNKNOWN puede incluir reconciliation_quote_version_id ───────────────

test('commit_outcome UNKNOWN con reconciliationQuoteVersionId -> se incluye reconciliation_quote_version_id en la respuesta', async () => {
  const err = new Error('PERSISTENCE_TRANSACTION_FAILURE (commit_outcome=UNKNOWN): connection lost');
  err.code = 'PERSISTENCE_TRANSACTION_FAILURE';
  err.commitOutcome = 'UNKNOWN';
  err.reconciliationQuoteVersionId = 'qv-reconcile-1';
  const handler = loadHandlerWithStubs({
    emitQuoteStub: async () => {
      throw err;
    },
  });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.commit_outcome, 'UNKNOWN');
    assert.equal(res.body.reconciliation_quote_version_id, 'qv-reconcile-1');
  } finally {
    restoreFetch();
  }
});

// ── nunca se devuelve contenido de quote_version_calculation ────────────

test('happy path: la respuesta HTTP nunca contiene campos de quote_version_calculation', async () => {
  const handler = loadHandlerWithStubs({ emitQuoteStub: async () => DEFAULT_SUCCESS_RESULT });
  const restoreFetch = stubFetch();
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 200);
    const forbidden = ['engine_input', 'engine_output', 'internal_calculation_snapshot', 'quote_version_calculation'];
    for (const key of forbidden) {
      assert.ok(!Object.prototype.hasOwnProperty.call(res.body, key), `response must never contain "${key}"`);
    }
    assert.deepEqual(Object.keys(res.body).sort(), ['engine', 'issued_at', 'ok', 'quote_id', 'quote_version_id', 'status', 'version_number']);
  } finally {
    restoreFetch();
  }
});

// Restore the real modules in require.cache once this file's tests are done,
// so any test file running afterward in the same process sees the real
// emitQuote.js/postgres.js again (node --test may run multiple files in one
// process).
test('cleanup: restore real emitQuote.js/postgres.js in require.cache', () => {
  delete require.cache[handlerModulePath];
  delete require.cache[emitQuoteModulePath];
  delete require.cache[postgresModulePath];
  require(emitQuoteModulePath);
  require(postgresModulePath);
  assert.ok(true);
});
