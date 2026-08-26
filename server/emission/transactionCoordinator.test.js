// server/emission/transactionCoordinator.test.js
//
// LP-EMIT-003 / LP-EMIT-003R — CAPABILITY SPIKE tests. All DB access is
// FAKE/MOCK — no real PostgreSQL connection, no DATABASE_URL, no network.
// Verifies the exact transactional lifecycle/ordering required by
// LP-EMIT-003 §5/§7/§8 and the commit-outcome-unknown / fixed-isolation
// corrections from LP-EMIT-003R §1/§2.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runEmissionTransaction,
  EmissionConcurrencyConflictError,
  EmissionCommitOutcomeUnknownError,
  isLockNotAvailable,
  PG_SQLSTATE_LOCK_NOT_AVAILABLE,
  ISOLATION_LEVEL_SQL,
} = require('./transactionCoordinator.js');

// ── Fake client / fake db ──────────────────────────────────────────────
//
// FakeClient records every `query(sql, params)` call (in order) into `calls`
// so tests can assert on the EXACT sequence, and lets a test script inject a
// failure at any specific SQL statement (by matching a prefix) or on
// `release()`.
class FakeClient {
  constructor({ failOn = {} } = {}) {
    this.calls = [];
    this.released = false;
    this.releaseCallCount = 0;
    this._failOn = failOn; // { [sqlPrefixOrExact]: Error }
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    const failure = this._matchFailure(sql);
    if (failure) throw failure;
    return { rows: [] };
  }

  async release() {
    this.releaseCallCount += 1;
    this.released = true;
  }

  _matchFailure(sql) {
    for (const key of Object.keys(this._failOn)) {
      if (sql === key || sql.startsWith(key)) return this._failOn[key];
    }
    return undefined;
  }
}

function makeFakeDb(client) {
  let acquireCallCount = 0;
  const db = {
    async acquireClient() {
      acquireCallCount += 1;
      return client;
    },
  };
  Object.defineProperty(db, 'acquireCallCount', { get: () => acquireCallCount });
  return db;
}

function lockNotAvailableError() {
  const err = new Error('could not obtain lock on row in relation "quote"');
  err.code = PG_SQLSTATE_LOCK_NOT_AVAILABLE;
  return err;
}

const LOCK = { sql: 'SELECT * FROM quote WHERE id = $1 FOR UPDATE NOWAIT', params: ['quote-1'] };

// ── T1: happy path ──────────────────────────────────────────────────────
test('T1 happy path: BEGIN -> fixed isolation -> lock -> JS -> writes -> COMMIT -> release, exact order, same client throughout', async () => {
  const client = new FakeClient();
  const db = makeFakeDb(client);

  let jsCalcRan = false;
  let jsCalcClientSeen = null;

  const result = await runEmissionTransaction(db, {
    lock: LOCK,
    run: async (c) => {
      // READ 1, READ 2
      await c.query('SELECT * FROM pricing_group WHERE quote_id = $1', ['quote-1']);
      await c.query('SELECT * FROM quote_line WHERE quote_id = $1', ['quote-1']);

      // JS CALCULATION CALLBACK (pure JS, no DB call — proves the coordinator
      // lets JS run mid-transaction without closing/reopening anything)
      jsCalcClientSeen = c;
      await Promise.resolve();
      jsCalcRan = true;
      const engineOutputTotal = 42; // stand-in for calculateQuoteDraft(...)

      // WRITE 1, WRITE 2
      await c.query('INSERT INTO quote_version (...) VALUES (...)', []);
      await c.query('INSERT INTO quote_version_calculation (...) VALUES (...)', []);

      return { engineOutputTotal };
    },
  });

  assert.equal(jsCalcRan, true);
  assert.equal(jsCalcClientSeen, client, 'T8: JS calculation callback must receive the SAME client instance');
  assert.deepEqual(result, { engineOutputTotal: 42 });

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, [
    'BEGIN',
    ISOLATION_LEVEL_SQL,
    LOCK.sql,
    'SELECT * FROM pricing_group WHERE quote_id = $1',
    'SELECT * FROM quote_line WHERE quote_id = $1',
    'INSERT INTO quote_version (...) VALUES (...)',
    'INSERT INTO quote_version_calculation (...) VALUES (...)',
    'COMMIT',
  ]);
  assert.equal(client.releaseCallCount, 1, 'release must be called exactly once');
  assert.equal(db.acquireCallCount, 1, 'exactly one client must be acquired for the whole operation');
});

// ── T2: JS calculation throws ────────────────────────────────────────────
test('T2 JS calculation throws: ROLLBACK -> release, no COMMIT', async () => {
  const client = new FakeClient();
  const db = makeFakeDb(client);
  const boom = new Error('calculateQuoteDraft rejected: MAIN_INCLUDED_GROUP_REQUIRED');

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => {
        throw boom;
      },
    }),
    (err) => err === boom,
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, 'ROLLBACK']);
  assert.ok(!sqlSeq.includes('COMMIT'), 'COMMIT must never be sent after an error');
  assert.equal(client.releaseCallCount, 1);
});

// ── T3: read/query throws ────────────────────────────────────────────────
test('T3 read query throws: ROLLBACK -> release, no COMMIT', async () => {
  const readSql = 'SELECT * FROM pricing_group WHERE quote_id = $1';
  const client = new FakeClient({ failOn: { [readSql]: new Error('connection reset') } });
  const db = makeFakeDb(client);

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async (c) => {
        await c.query(readSql, ['quote-1']);
        return 'unreachable';
      },
    }),
    /connection reset/,
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, readSql, 'ROLLBACK']);
  assert.equal(client.releaseCallCount, 1);
});

// ── T4: write throws ─────────────────────────────────────────────────────
test('T4 write throws: ROLLBACK -> release, no COMMIT', async () => {
  const writeSql = 'INSERT INTO quote_version (...) VALUES (...)';
  const client = new FakeClient({ failOn: { [writeSql]: new Error('constraint violation') } });
  const db = makeFakeDb(client);

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async (c) => {
        await c.query(writeSql, []);
        return 'unreachable';
      },
    }),
    /constraint violation/,
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, writeSql, 'ROLLBACK']);
  assert.equal(client.releaseCallCount, 1);
});

// ── T5: NOWAIT conflict maps to EMISSION_CONCURRENCY_CONFLICT ───────────
test('T5 NOWAIT conflict: maps to EmissionConcurrencyConflictError via SQLSTATE 55P03 -> ROLLBACK -> release', async () => {
  const client = new FakeClient({ failOn: { [LOCK.sql]: lockNotAvailableError() } });
  const db = makeFakeDb(client);
  let runCalled = false;

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => {
        runCalled = true;
      },
    }),
    (err) => {
      assert.ok(err instanceof EmissionConcurrencyConflictError);
      assert.equal(err.code, 'EMISSION_CONCURRENCY_CONFLICT');
      assert.ok(isLockNotAvailable(err.cause), 'original PG lock_not_available error preserved as .cause');
      assert.equal(err.cause.code, PG_SQLSTATE_LOCK_NOT_AVAILABLE);
      return true;
    },
  );

  assert.equal(runCalled, false, 'run(client) [reads/JS calc/writes] must never execute after a lock conflict');
  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, 'ROLLBACK']);
  assert.equal(client.releaseCallCount, 1);
});

test('isLockNotAvailable only matches SQLSTATE 55P03, never by message text', () => {
  assert.equal(isLockNotAvailable({ code: '55P03' }), true);
  assert.equal(isLockNotAvailable({ message: 'could not obtain lock' }), false, 'no code -> not matched, even with matching text');
  assert.equal(isLockNotAvailable({ code: '40001' }), false, 'a different real SQLSTATE (serialization_failure) must not match');
  assert.equal(isLockNotAvailable(null), false);
});

// ── T6: acquireClient throws ─────────────────────────────────────────────
test('T6 acquireClient throws: no BEGIN, no ROLLBACK, no release (there is no client)', async () => {
  const boom = new Error('could not acquire a connection from the pool');
  const db = {
    async acquireClient() {
      throw boom;
    },
  };

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => 'unreachable',
    }),
    (err) => err === boom,
  );
  // Nothing to assert on a client — none was ever created. The absence of a
  // throw from `release()`-on-undefined (which would be a TypeError masking
  // `boom`) is itself the assertion: assert.rejects above already confirms
  // the ORIGINAL acquireClient error surfaced unmodified.
});

// ── T7 / T7b / T7c: COMMIT throws — commit outcome is UNKNOWN, never
// "not committed", regardless of whether the best-effort ROLLBACK that
// follows succeeds or fails (LP-EMIT-003R, corrección 1) ──────────────────

test('T7 COMMIT throws: EmissionCommitOutcomeUnknownError, commitOutcome UNKNOWN, cause preserved, best-effort ROLLBACK attempted, release once', async () => {
  const commitErr = new Error('connection lost while awaiting COMMIT response');
  const client = new FakeClient({ failOn: { COMMIT: commitErr } });
  const db = makeFakeDb(client);

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => 'ok',
    }),
    (err) => {
      assert.ok(err instanceof EmissionCommitOutcomeUnknownError);
      assert.equal(err.code, 'EMISSION_COMMIT_OUTCOME_UNKNOWN');
      assert.equal(err.commitOutcome, 'UNKNOWN');
      assert.equal(err.cause, commitErr, 'original COMMIT error preserved as .cause');
      assert.equal(err.rollbackError, undefined, 'the best-effort rollback succeeded here, so no .rollbackError attached');
      return true;
    },
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, 'COMMIT', 'ROLLBACK'], 'best-effort ROLLBACK is still attempted after a COMMIT failure');
  assert.equal(client.releaseCallCount, 1);
});

test('T7b COMMIT throws AND the subsequent best-effort ROLLBACK also throws: EMISSION_COMMIT_OUTCOME_UNKNOWN still prevails, rollbackError attached, release exactly once', async () => {
  const commitErr = new Error('connection lost while awaiting COMMIT response');
  const rollbackErr = new Error('server closed the connection unexpectedly');
  const client = new FakeClient({ failOn: { COMMIT: commitErr, ROLLBACK: rollbackErr } });
  const db = makeFakeDb(client);

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => 'ok',
    }),
    (err) => {
      assert.ok(err instanceof EmissionCommitOutcomeUnknownError, 'EMISSION_COMMIT_OUTCOME_UNKNOWN prevails, it is not replaced by the rollback failure');
      assert.equal(err.code, 'EMISSION_COMMIT_OUTCOME_UNKNOWN');
      assert.equal(err.commitOutcome, 'UNKNOWN');
      assert.equal(err.cause, commitErr);
      assert.equal(err.rollbackError, rollbackErr, 'rollback failure attached, not swallowed');
      return true;
    },
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, 'COMMIT', 'ROLLBACK']);
  assert.equal(client.releaseCallCount, 1, 'release must still happen exactly once even when both COMMIT and the best-effort ROLLBACK fail');
});

test('T7c COMMIT throws but the best-effort ROLLBACK responds OK: commitOutcome STILL UNKNOWN — a clean rollback never downgrades it to a "known not committed" state', async () => {
  const commitErr = new Error('connection lost while awaiting COMMIT response');
  const client = new FakeClient({ failOn: { COMMIT: commitErr } }); // ROLLBACK is NOT in failOn -> succeeds
  const db = makeFakeDb(client);

  await assert.rejects(
    runEmissionTransaction(db, {
      lock: LOCK,
      run: async () => 'ok',
    }),
    (err) => {
      assert.ok(err instanceof EmissionCommitOutcomeUnknownError);
      assert.equal(err.commitOutcome, 'UNKNOWN', 'a successful best-effort ROLLBACK must NOT turn UNKNOWN into NOT_COMMITTED or any other value');
      assert.notEqual(err.commitOutcome, 'NOT_COMMITTED');
      return true;
    },
  );

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.deepEqual(sqlSeq, ['BEGIN', ISOLATION_LEVEL_SQL, LOCK.sql, 'COMMIT', 'ROLLBACK']);
  assert.equal(client.releaseCallCount, 1);
});

// ── T8: same client used throughout (also covered inline in T1) ─────────
test('T8 the run(client) callback receives and uses the SAME client instance the coordinator BEGAN/locked/will COMMIT on', async () => {
  const client = new FakeClient();
  const db = makeFakeDb(client);
  const seenClients = new Set();

  await runEmissionTransaction(db, {
    lock: LOCK,
    run: async (c) => {
      seenClients.add(c);
      await c.query('SELECT 1', []);
      seenClients.add(c);
      await c.query('INSERT INTO x VALUES (1)', []);
      seenClients.add(c);
    },
  });

  assert.equal(seenClients.size, 1, 'every use inside run() referenced the exact same client object');
  assert.ok(seenClients.has(client));
});

// ── Fixed isolation level (LP-EMIT-003R, corrección 2) ───────────────────
test('isolation level is the exact fixed literal "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ" — never interpolated', async () => {
  const client = new FakeClient();
  const db = makeFakeDb(client);

  await runEmissionTransaction(db, { lock: LOCK, run: async () => 'ok' });

  assert.equal(ISOLATION_LEVEL_SQL, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(client.calls[1].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(client.calls[1].params, undefined, 'the isolation statement is sent with no params — it is a literal, not a parameterized/interpolated query');
});

test('the public API accepts no isolationLevel option — a caller-supplied value is silently ignored, the fixed literal is always sent', async () => {
  const client = new FakeClient();
  const db = makeFakeDb(client);

  await runEmissionTransaction(db, {
    // Attempt to inject/override the isolation level via an opts field that
    // no longer exists in the public API (LP-EMIT-003R §2: "El API público
    // del coordinator no necesita recibir isolationLevel"). The coordinator
    // must not read this field at all.
    isolationLevel: 'READ COMMITTED',
    lock: LOCK,
    run: async () => 'ok',
  });

  const isolationCalls = client.calls.filter((c) => c.sql.startsWith('SET TRANSACTION ISOLATION LEVEL'));
  assert.equal(isolationCalls.length, 1);
  assert.equal(isolationCalls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'a caller-supplied isolationLevel must never reach the SQL sent to the client');
});
