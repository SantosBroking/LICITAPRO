// server/emission/emitQuote.test.js
//
// LP-EMIT-004 — implementation tests for emitQuote.js / buildCommercialSnapshots.js
// / loadQuoteAggregate.js. Uses a FakeClient (dispatch by SQL prefix, same
// approach as transactionCoordinator.test.js) combined with the REAL
// quote-core/pricingEngine.js — no PostgreSQL connection, no DATABASE_URL,
// no network, but real financial computation (quote-core/engine are pure).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emitQuote } = require('./emitQuote.js');
const {
  buildIncludedPricingGroupIdsInEngineOrder,
  assertMainMappingCardinality,
  selectMaterialSupplemental,
  buildCommercialLinesSnapshot,
} = require('./buildCommercialSnapshots.js');
const { EmissionInternalInvariantFailureError, SupplementalCommercialInconsistencyError } = require('./emissionErrors.js');

// ── Fixtures ──────────────────────────────────────────────────────────────

const QUOTE_ID = 'quote-1';
const ISSUING_COMPANY_ID = 'issco-1';
const CLIENT_ID = 'client-1';
const SECTION_ID = 'sec-1';
const GROUP_INCLUDED_ID = 'pg-included';
const LINE_ID = 'line-1';

function makeQuoteRow(overrides = {}) {
  return {
    id: QUOTE_ID,
    folio: null,
    issuing_company_id: ISSUING_COMPANY_ID,
    client_third_party_id: CLIENT_ID,
    client_contact_id: null,
    client_address_id: null,
    reference_label: null,
    currency: 'MXN',
    valid_until: null,
    display_mode: 'CONSOLIDATED_PRICING',
    status: 'DRAFT',
    terms_text: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

const ISSUING_COMPANY_ROW = {
  id: ISSUING_COMPANY_ID,
  code: 'BROKING',
  legal_name: 'BROKING AND BRANDS GROUP, S.A. de C.V.',
  tax_id: 'BBG1007304K0',
  status: 'ACTIVE',
};

const CLIENT_ROW = { id: CLIENT_ID, kind: 'CLIENT', display_name: 'Cliente Uno', legal_name: null, tax_id: null, status: 'ACTIVE' };

const SECTION_ROW = { id: SECTION_ID, quote_id: QUOTE_ID, label: 'Sección 1', display_order: 1, status: 'ACTIVE' };

const GROUP_INCLUDED_ROW = {
  id: GROUP_INCLUDED_ID,
  quote_id: QUOTE_ID,
  quantity: null,
  pricing_mode: 'PRICE_DIRECT',
  amount_basis: 'TOTAL',
  profit_target_basis: null,
  pricing_value: 1000,
  sale_tax_treatment: 'IVA_ADDITIONAL',
  sale_tax_rate: null,
  quote_total_role: 'INCLUDED',
  currency: 'MXN',
  status: 'ACTIVE',
};

const LINE_ROW = {
  id: LINE_ID,
  quote_id: QUOTE_ID,
  quote_section_id: SECTION_ID,
  pricing_group_id: GROUP_INCLUDED_ID,
  origin_kind: 'SERVICE',
  catalog_item_id: null,
  catalog_item_variant_id: null,
  source_snapshot: null,
  commercial_description: 'Servicio X',
  technical_description: null,
  quantity: '1',
  unit_label: null,
  line_status: 'PRICED',
  display_order: 1,
  status: 'ACTIVE',
};

const ALL_CHECK_NAMES = [
  'issuer_present', 'client_present', 'client_role_valid', 'main_group_present', 'anchor_exactness',
  'active_line_group_active', 'priced_anchor_group_commercial', 'line_status_role_valid', 'optional_not_orphan',
  'currency_consistent', 'ownership_guard_final_target', 'emittable_lines_quantity_valid', 'catalog_origin_integrity',
];
function allPassedChecks() {
  return ALL_CHECK_NAMES.map((check_name) => ({ check_name, passed: true, detail: 'ok' }));
}

// ── FakeClient: dispatch by SQL prefix/regex ─────────────────────────────

class FakeClient {
  constructor(handlers) {
    this.handlers = handlers; // [{match: RegExp|string, respond: (sql,params)=>({rows})|throws}]
    this.calls = [];
    this.releaseCallCount = 0;
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    for (const h of this.handlers) {
      const matches = typeof h.match === 'string' ? sql === h.match || sql.startsWith(h.match) : h.match.test(sql);
      if (matches) {
        const result = typeof h.respond === 'function' ? h.respond(sql, params) : h.respond;
        if (result instanceof Error) throw result;
        return result;
      }
    }
    return { rows: [] }; // BEGIN / isolation / COMMIT / ROLLBACK / UPDATE quote / supersede default
  }

  async release() {
    this.releaseCallCount += 1;
  }
}

function makeDb(client) {
  return { acquireClient: async () => client };
}

function happyPathHandlers({ quoteStatus = 'DRAFT', newVersionId = 'qv-1', nextVersionNumber = 1 } = {}) {
  return [
    { match: /^SELECT id, status FROM quote WHERE id = \$1 FOR UPDATE NOWAIT$/, respond: { rows: [{ id: QUOTE_ID, status: quoteStatus }] } },
    { match: /^SELECT \* FROM quote WHERE id = \$1$/, respond: { rows: [makeQuoteRow({ status: quoteStatus })] } },
    { match: /^SELECT \* FROM issuing_company WHERE id = \$1$/, respond: { rows: [ISSUING_COMPANY_ROW] } },
    { match: /^SELECT \* FROM third_party WHERE id = \$1$/, respond: { rows: [CLIENT_ROW] } },
    { match: /^SELECT \* FROM quote_section WHERE quote_id/, respond: { rows: [SECTION_ROW] } },
    { match: /^SELECT \* FROM quote_line WHERE quote_id/, respond: { rows: [LINE_ROW] } },
    { match: /^SELECT \* FROM pricing_group WHERE quote_id/, respond: { rows: [GROUP_INCLUDED_ROW] } },
    { match: /^SELECT \* FROM pricing_group_cost_item WHERE pricing_group_id/, respond: { rows: [] } },
    { match: /^SELECT \* FROM quote_sale_based_cost_item WHERE quote_id/, respond: { rows: [] } },
    { match: /^SELECT \* FROM catalog_item WHERE id/, respond: { rows: [] } },
    { match: /^SELECT \* FROM validate_quote_for_emission/, respond: { rows: allPassedChecks() } },
    { match: /^SELECT fn_next_quote_version_number/, respond: { rows: [{ fn_next_quote_version_number: nextVersionNumber }] } },
    { match: /^INSERT INTO quote_version\b/, respond: { rows: [{ id: newVersionId }] } },
    { match: /^INSERT INTO quote_version_calculation/, respond: { rows: [] } },
    { match: /^SELECT fn_supersede_previous_quote_versions/, respond: { rows: [] } },
    { match: /^UPDATE quote SET status/, respond: { rows: [] } },
  ];
}

// ── A. happy path completo ────────────────────────────────────────────────

test('A. happy path: full emission succeeds, correct result shape', async () => {
  const client = new FakeClient(happyPathHandlers());
  const db = makeDb(client);

  const result = await emitQuote({ db, quoteId: QUOTE_ID, actorId: 'actor-1' });

  assert.equal(result.quote_id, QUOTE_ID);
  assert.equal(result.quote_version_id, 'qv-1');
  assert.equal(result.version_number, 1);
  assert.equal(result.status, 'ISSUED');
  assert.ok(result.issued_at);
  assert.deepEqual(Object.keys(result.engine).sort(), ['calculation_schema_version', 'engine_commit_sha', 'engine_contract_version']);

  const sqlSeq = client.calls.map((c) => c.sql);
  assert.equal(sqlSeq[0], 'BEGIN');
  assert.ok(sqlSeq.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
  assert.ok(sqlSeq.some((s) => s.startsWith('SELECT id, status FROM quote')));
  assert.equal(sqlSeq[sqlSeq.length - 1], 'COMMIT');
  assert.equal(client.releaseCallCount, 1);
});

// ── B. DRAFT -> ACTIVE ────────────────────────────────────────────────────

test('B. DRAFT -> ACTIVE: the UPDATE quote query carries the new status ACTIVE', async () => {
  const client = new FakeClient(happyPathHandlers({ quoteStatus: 'DRAFT' }));
  const db = makeDb(client);

  await emitQuote({ db, quoteId: QUOTE_ID });

  const updateCall = client.calls.find((c) => c.sql.startsWith('UPDATE quote SET status'));
  assert.ok(updateCall);
  assert.equal(updateCall.params[1], 'ACTIVE');
});

// ── C. Reemisión ACTIVE -> ACTIVE ─────────────────────────────────────────

test('C. reemisión ACTIVE -> ACTIVE: status stays ACTIVE, version_number/supersede called with new version', async () => {
  const client = new FakeClient(happyPathHandlers({ quoteStatus: 'ACTIVE', newVersionId: 'qv-2', nextVersionNumber: 2 }));
  const db = makeDb(client);

  const result = await emitQuote({ db, quoteId: QUOTE_ID });

  assert.equal(result.version_number, 2);
  assert.equal(result.quote_version_id, 'qv-2');

  const updateCall = client.calls.find((c) => c.sql.startsWith('UPDATE quote SET status'));
  assert.equal(updateCall.params[1], 'ACTIVE', 'reemission of an already-ACTIVE quote must stay ACTIVE, never regress');

  const supersedeCall = client.calls.find((c) => c.sql.startsWith('SELECT fn_supersede_previous_quote_versions'));
  assert.deepEqual(supersedeCall.params, [QUOTE_ID, 'qv-2']);
});

// ── D. lifecycle ARCHIVED/VOID ────────────────────────────────────────────

for (const status of ['ARCHIVED', 'VOID']) {
  test(`D. lifecycle rejection: quote.status=${status} -> QUOTE_NOT_EMITTABLE, no aggregate load, ROLLBACK`, async () => {
    const client = new FakeClient([
      { match: /^SELECT id, status FROM quote WHERE id = \$1 FOR UPDATE NOWAIT$/, respond: { rows: [{ id: QUOTE_ID, status }] } },
      { match: /^SELECT \* FROM quote WHERE id = \$1$/, respond: { rows: [makeQuoteRow({ status })] } },
    ]);
    const db = makeDb(client);

    await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
      assert.equal(err.code, 'QUOTE_NOT_EMITTABLE');
      assert.deepEqual(err.failedCheckNames, ['quote.status']);
      return true;
    });

    const sqlSeq = client.calls.map((c) => c.sql);
    assert.ok(!sqlSeq.some((s) => s.startsWith('SELECT * FROM issuing_company')), 'must not load the rest of the aggregate after a lifecycle rejection');
    assert.ok(sqlSeq.includes('ROLLBACK'));
  });
}

// ── E. validate_quote_for_emission falla ─────────────────────────────────

test('E. validate_quote_for_emission failure: QUOTE_NOT_EMITTABLE preserves failed check_names', async () => {
  const handlers = happyPathHandlers();
  const validateHandler = handlers.find((h) => h.match.test && h.match.test('SELECT * FROM validate_quote_for_emission($1)'));
  validateHandler.respond = { rows: [{ check_name: 'issuer_present', passed: false, detail: 'quote.issuing_company_id is NULL' }, ...allPassedChecks().slice(1)] };
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'QUOTE_NOT_EMITTABLE');
    assert.deepEqual(err.failedCheckNames, ['issuer_present']);
    return true;
  });

  assert.ok(client.calls.map((c) => c.sql).includes('ROLLBACK'));
});

// ── F. calculateQuoteDraft falla ─────────────────────────────────────────

test('F. calculateQuoteDraft failure (no INCLUDED group): FINANCIAL_CALCULATION_REJECTED, cause preserved', async () => {
  const handlers = happyPathHandlers();
  const groupsHandler = handlers.find((h) => h.match.test && h.match.test('SELECT * FROM pricing_group WHERE quote_id = $1'));
  groupsHandler.respond = { rows: [] }; // no pricing groups at all -> MAIN_INCLUDED_GROUP_REQUIRED
  const linesHandler = handlers.find((h) => h.match.test && h.match.test('SELECT * FROM quote_line WHERE quote_id = $1'));
  linesHandler.respond = { rows: [] };
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'FINANCIAL_CALCULATION_REJECTED');
    assert.ok(err.cause instanceof Error);
    assert.match(err.cause.message, /MAIN_INCLUDED_GROUP_REQUIRED/);
    return true;
  });
  assert.ok(client.calls.map((c) => c.sql).includes('ROLLBACK'));
});

// ── G. mapping cardinality mismatch (unit test on the helper) ────────────

test('G. mapping cardinality mismatch: assertMainMappingCardinality throws EmissionInternalInvariantFailureError', () => {
  assert.throws(
    () => assertMainMappingCardinality({ groups: [{}, {}] }, ['only-one-id']),
    (err) => err instanceof EmissionInternalInvariantFailureError && err.code === 'EMISSION_INTERNAL_INVARIANT_FAILURE',
  );
  // no mismatch -> does not throw
  assertMainMappingCardinality({ groups: [{}, {}] }, ['a', 'b']);
});

test('buildIncludedPricingGroupIdsInEngineOrder preserves relative order, ACTIVE+INCLUDED only', () => {
  const groups = [
    { id: 'g1', status: 'ACTIVE', quote_total_role: 'OPTIONAL' },
    { id: 'g2', status: 'ACTIVE', quote_total_role: 'INCLUDED' },
    { id: 'g3', status: 'ARCHIVED', quote_total_role: 'INCLUDED' },
    { id: 'g4', status: 'ACTIVE', quote_total_role: 'INCLUDED' },
  ];
  assert.deepEqual(buildIncludedPricingGroupIdsInEngineOrder(groups), ['g2', 'g4']);
});

// ── H. supplemental material vs no material ──────────────────────────────

test('H. selectMaterialSupplemental: only anchored groups are material; SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY for priced-without-anchor', () => {
  const anchoredOptional = { id: 'pg-opt', quote_total_role: 'OPTIONAL', pricing_mode: 'PRICE_DIRECT' };
  const unanchoredCostOnly = { id: 'pg-cost', quote_total_role: 'REFERENCE_ONLY', pricing_mode: null };
  const lines = [{ pricing_group_id: 'pg-opt', line_status: 'OPTIONAL' }];
  const supplementalCalculations = [
    { pricing_group_id: 'pg-opt', quote_total_role: 'OPTIONAL', engine_input: {}, engine_output: { groups: [{ ventaNet: 1, ventaGross: 1, currency: 'MXN' }] } },
  ];

  const material = selectMaterialSupplemental([anchoredOptional, unanchoredCostOnly], lines, supplementalCalculations);
  assert.equal(material.size, 1);
  assert.ok(material.has('pg-opt'));
  assert.ok(!material.has('pg-cost'), 'cost-only group with no anchor must never be material — not an error either');

  const priceWithoutAnchor = { id: 'pg-broken', quote_total_role: 'REFERENCE_ONLY', pricing_mode: 'PRICE_DIRECT' };
  assert.throws(
    () => selectMaterialSupplemental([priceWithoutAnchor], [], []),
    (err) => err instanceof SupplementalCommercialInconsistencyError && err.code === 'SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY',
  );
});

// ── I. commercial snapshot no filtra costos ──────────────────────────────

test('I. commercial_lines_snapshot never carries cost/utilidad/engine_output fields', async () => {
  const client = new FakeClient(happyPathHandlers());
  const db = makeDb(client);
  const insertCall1 = [];
  // Capture the exact JSON persisted for commercial_lines_snapshot by
  // intercepting the INSERT INTO quote_version call's params.
  const handlers = happyPathHandlers();
  const qvHandler = handlers.find((h) => h.match.test && h.match.test('INSERT INTO quote_version ('));
  const originalRespond = qvHandler.respond;
  qvHandler.respond = (sql, params) => {
    insertCall1.push(params);
    return originalRespond;
  };
  const client2 = new FakeClient(handlers);
  await emitQuote({ db: makeDb(client2), quoteId: QUOTE_ID });

  const commercialLinesSnapshotJson = insertCall1[0][5]; // 6th param = commercial_lines_snapshot
  const linesSnapshot = JSON.parse(commercialLinesSnapshotJson);
  const forbiddenKeys = ['costoNet', 'costoGross', 'utilidad', 'markupSobreCosto', 'margenSobreVenta', 'engine_input', 'engine_output'];
  const flat = JSON.stringify(linesSnapshot);
  for (const key of forbiddenKeys) {
    assert.ok(!flat.includes(key), `commercial_lines_snapshot must never contain "${key}"`);
  }
  assert.equal(linesSnapshot[0].line.presented_price.ventaNet, 1000);
  assert.deepEqual(Object.keys(linesSnapshot[0].line.presented_price).sort(), ['currency', 'pricing_group_id', 'ventaGross', 'ventaNet']);

  void client; void db; // unused fixture kept for readability of the two-pass setup above
});

// ── J. version_number helper ─────────────────────────────────────────────

test('J. version_number: fn_next_quote_version_number is invoked with quoteId, result used as version_number', async () => {
  const client = new FakeClient(happyPathHandlers({ nextVersionNumber: 7 }));
  const db = makeDb(client);
  const result = await emitQuote({ db, quoteId: QUOTE_ID });
  assert.equal(result.version_number, 7);
  const call = client.calls.find((c) => c.sql.startsWith('SELECT fn_next_quote_version_number'));
  assert.deepEqual(call.params, [QUOTE_ID]);
});

// ── K. supersede helper ──────────────────────────────────────────────────

test('K. supersede: fn_supersede_previous_quote_versions invoked with (quoteId, newVersionId) AFTER both INSERTs', async () => {
  const client = new FakeClient(happyPathHandlers({ newVersionId: 'qv-99' }));
  const db = makeDb(client);
  await emitQuote({ db, quoteId: QUOTE_ID });

  const sqlSeq = client.calls.map((c) => c.sql);
  const qvIdx = sqlSeq.findIndex((s) => s.startsWith('INSERT INTO quote_version ('));
  const qvcIdx = sqlSeq.findIndex((s) => s.startsWith('INSERT INTO quote_version_calculation'));
  const supersedeIdx = sqlSeq.findIndex((s) => s.startsWith('SELECT fn_supersede_previous_quote_versions'));
  assert.ok(qvIdx < qvcIdx && qvcIdx < supersedeIdx, 'order must be: INSERT quote_version -> INSERT quote_version_calculation -> supersede');
  assert.deepEqual(client.calls[supersedeIdx].params, [QUOTE_ID, 'qv-99']);
});

// ── L. insert qv + qvc ────────────────────────────────────────────────────

test('L. INSERT quote_version + INSERT quote_version_calculation: both sent, calculation is 1:1 (same new_version_id), internal_calculation_snapshot is [] when no supplemental', async () => {
  const client = new FakeClient(happyPathHandlers({ newVersionId: 'qv-42' }));
  const db = makeDb(client);
  await emitQuote({ db, quoteId: QUOTE_ID });

  const qvcCall = client.calls.find((c) => c.sql.startsWith('INSERT INTO quote_version_calculation'));
  assert.equal(qvcCall.params[0], 'qv-42', 'quote_version_calculation.quote_version_id must equal the captured new_version_id');
  const internalSnapshot = JSON.parse(qvcCall.params[3]);
  assert.deepEqual(internalSnapshot, [], 'no supplemental groups in this fixture -> internal_calculation_snapshot must be [] (never null/omitted)');
});

// ── M. rollback ante fallo de persistencia ────────────────────────────────

test('M. persistence failure (INSERT quote_version throws): PERSISTENCE_TRANSACTION_FAILURE, no commit_outcome field, ROLLBACK happened', async () => {
  const handlers = happyPathHandlers();
  const qvHandler = handlers.find((h) => h.match.test && h.match.test('INSERT INTO quote_version ('));
  qvHandler.respond = new Error('constraint violation on quote_version');
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'PERSISTENCE_TRANSACTION_FAILURE');
    assert.equal(err.commitOutcome, undefined, 'a pre-COMMIT infrastructure failure has an unambiguous outcome — never UNKNOWN');
    assert.match(err.cause.message, /constraint violation/);
    return true;
  });

  assert.ok(client.calls.map((c) => c.sql).includes('ROLLBACK'));
  assert.equal(client.releaseCallCount, 1);
});

// ── N. 55P03 concurrency ──────────────────────────────────────────────────

test('N. 55P03 lock conflict: EMISSION_CONCURRENCY_CONFLICT, no aggregate load at all', async () => {
  const lockErr = new Error('could not obtain lock');
  lockErr.code = '55P03';
  const client = new FakeClient([{ match: /^SELECT id, status FROM quote WHERE id = \$1 FOR UPDATE NOWAIT$/, respond: lockErr }]);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'EMISSION_CONCURRENCY_CONFLICT');
    return true;
  });
  const sqlSeq = client.calls.map((c) => c.sql);
  assert.ok(!sqlSeq.some((s) => s.startsWith('SELECT * FROM quote WHERE id')));
});

// ── O. commit outcome UNKNOWN mapping ────────────────────────────────────

test('O. COMMIT throws: PERSISTENCE_TRANSACTION_FAILURE with commit_outcome=UNKNOWN, cause and rollbackError preserved, no retry', async () => {
  const handlers = happyPathHandlers();
  const commitErr = new Error('connection lost awaiting COMMIT');
  handlers.push({ match: 'COMMIT', respond: commitErr });
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  let callCount = 0;
  const originalAcquire = db.acquireClient;
  db.acquireClient = async () => {
    callCount += 1;
    return originalAcquire();
  };

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'PERSISTENCE_TRANSACTION_FAILURE');
    assert.equal(err.commitOutcome, 'UNKNOWN');
    assert.match(err.cause.message, /connection lost awaiting COMMIT/);
    return true;
  });
  assert.equal(callCount, 1, 'no automatic retry — acquireClient/the whole operation runs exactly once');
});

// ── Q. reconciliationQuoteVersionId sobrevive un COMMIT UNKNOWN (LP-EMIT-004R corrección 1) ──

test('Q. COMMIT throws: PersistenceTransactionFailureError carries reconciliationQuoteVersionId captured right after the INSERT', async () => {
  const handlers = happyPathHandlers({ newVersionId: 'qv-reconcile-77' });
  const commitErr = new Error('connection lost awaiting COMMIT');
  handlers.push({ match: 'COMMIT', respond: commitErr });
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'PERSISTENCE_TRANSACTION_FAILURE');
    assert.equal(err.commitOutcome, 'UNKNOWN');
    assert.equal(err.reconciliationQuoteVersionId, 'qv-reconcile-77', 'the new_version_id captured before COMMIT must survive into the external error, as a reconciliation anchor');
    return true;
  });
});

test('Q2. pre-COMMIT failure (before INSERT quote_version runs): no reconciliationQuoteVersionId is ever invented', async () => {
  const handlers = happyPathHandlers();
  const validateHandler = handlers.find((h) => h.match.test && h.match.test('SELECT * FROM validate_quote_for_emission($1)'));
  validateHandler.respond = { rows: [{ check_name: 'issuer_present', passed: false, detail: 'x' }, ...allPassedChecks().slice(1)] };
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  await assert.rejects(emitQuote({ db, quoteId: QUOTE_ID }), (err) => {
    assert.equal(err.code, 'QUOTE_NOT_EMITTABLE');
    assert.equal(err.reconciliationQuoteVersionId, undefined);
    return true;
  });
});

// ── R4. supplemental material sin entrada calculada -> invariant failure (LP-EMIT-004R corrección 5) ──

test('R4. selectMaterialSupplemental: anchored group with pricing_mode set but NO matching supplementalCalculations entry -> EMISSION_INTERNAL_INVARIANT_FAILURE', () => {
  const anchoredOptional = { id: 'pg-opt', quote_total_role: 'OPTIONAL', pricing_mode: 'PRICE_DIRECT' };
  const lines = [{ pricing_group_id: 'pg-opt', line_status: 'OPTIONAL' }];
  assert.throws(
    () => selectMaterialSupplemental([anchoredOptional], lines, []), // no supplementalCalculations at all
    (err) => err instanceof EmissionInternalInvariantFailureError && err.code === 'EMISSION_INTERNAL_INVARIANT_FAILURE',
  );
});

test('R5. selectMaterialSupplemental: material supplemental with missing engine_output.groups[0] -> EMISSION_INTERNAL_INVARIANT_FAILURE', () => {
  const anchoredOptional = { id: 'pg-opt', quote_total_role: 'OPTIONAL', pricing_mode: 'PRICE_DIRECT' };
  const lines = [{ pricing_group_id: 'pg-opt', line_status: 'OPTIONAL' }];
  const supplementalCalculations = [{ pricing_group_id: 'pg-opt', quote_total_role: 'OPTIONAL', engine_input: {}, engine_output: { groups: [] } }];
  assert.throws(
    () => selectMaterialSupplemental([anchoredOptional], lines, supplementalCalculations),
    (err) => err instanceof EmissionInternalInvariantFailureError && err.code === 'EMISSION_INTERNAL_INVARIANT_FAILURE',
  );
});

// ── S. orden comercial sección -> línea (LP-EMIT-004R corrección 6) ──────

test('S. buildCommercialLinesSnapshot orders by section.display_order then line.display_order, ignoring input order and global display_order collisions', () => {
  const sections = [
    { id: 'sec-B', display_order: 2, label: 'Sección B' },
    { id: 'sec-A', display_order: 1, label: 'Sección A' },
  ];
  // display_order is only unique WITHIN a section: both sections have a
  // line with display_order=1 and a line with display_order=2. Input array
  // is deliberately interleaved and out of any useful order.
  const lines = [
    { id: 'l-B2', quote_section_id: 'sec-B', display_order: 2, pricing_group_id: null, origin_kind: 'SERVICE', catalog_item_id: null, commercial_description: 'B2', technical_description: null, quantity: '1', unit_label: null, line_status: 'INFORMATIONAL' },
    { id: 'l-A1', quote_section_id: 'sec-A', display_order: 1, pricing_group_id: null, origin_kind: 'SERVICE', catalog_item_id: null, commercial_description: 'A1', technical_description: null, quantity: '1', unit_label: null, line_status: 'INFORMATIONAL' },
    { id: 'l-B1', quote_section_id: 'sec-B', display_order: 1, pricing_group_id: null, origin_kind: 'SERVICE', catalog_item_id: null, commercial_description: 'B1', technical_description: null, quantity: '1', unit_label: null, line_status: 'INFORMATIONAL' },
    { id: 'l-A2', quote_section_id: 'sec-A', display_order: 2, pricing_group_id: null, origin_kind: 'SERVICE', catalog_item_id: null, commercial_description: 'A2', technical_description: null, quantity: '1', unit_label: null, line_status: 'INFORMATIONAL' },
  ];

  const snapshot = buildCommercialLinesSnapshot(lines, sections, {
    pricingGroupsById: new Map(),
    includedPricingGroupIdsInEngineOrder: [],
    mainEngineOutputGroups: [],
    materialSupplementalByGroupId: new Map(),
    catalogItemsById: new Map(),
  });

  assert.deepEqual(
    snapshot.map((s) => s.line.quote_line_id),
    ['l-A1', 'l-A2', 'l-B1', 'l-B2'],
    'must be ordered by section.display_order (A before B) then line.display_order within each section — never by raw input order or a global display_order sort',
  );
});

// ── T. LP-EMIT-DIAG-001 — diagnostic logging stays secret-free and never
// changes external behavior ──────────────────────────────────────────────

test('T1. persistence failure (M-style): diagnostic logs stage=INSERT_QV, no message/SQL leakage, external error unchanged', async () => {
  const handlers = happyPathHandlers();
  const qvHandler = handlers.find((h) => h.match.test && h.match.test('INSERT INTO quote_version ('));
  const sensitiveMessage = 'duplicate key value violates unique constraint "quote_version_pkey" DETAIL: Key (id)=(qv-1) already exists.';
  const boom = new Error(sensitiveMessage);
  boom.code = '23505';
  qvHandler.respond = boom;
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  let caught;
  try {
    await emitQuote({ db, quoteId: QUOTE_ID });
  } catch (err) {
    caught = err;
  } finally {
    console.error = original;
  }

  assert.equal(caught.code, 'PERSISTENCE_TRANSACTION_FAILURE', 'external code unchanged by instrumentation');
  assert.equal(caught.commitOutcome, undefined, 'pre-COMMIT outcome semantics unchanged');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, 'LP_EMIT_DIAGNOSTIC');
  assert.equal(parsed.external_code, 'PERSISTENCE_TRANSACTION_FAILURE');
  assert.equal(parsed.stage, 'INSERT_QV', 'the finest-known stage (set inside run()) must survive, not a generic RUN from the coordinator');
  assert.equal(parsed.error_code, '23505');
  assert.ok(!lines[0].includes('duplicate key'), 'diagnostic must never include err.message text');
  assert.ok(!lines[0].includes('quote_version_pkey'), 'diagnostic must never include SQL/constraint text');
  assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'message'));
  assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'stack'));
});

test('T2. COMMIT UNKNOWN (O-style): diagnostic logs stage=COMMIT, cause metadata safe, external error/commit_outcome unchanged', async () => {
  const handlers = happyPathHandlers();
  const sensitiveMessage = 'connection to postgres://postgres:hunter2@db.internal.example:6543/postgres lost';
  const commitErr = new Error(sensitiveMessage);
  commitErr.code = 'ECONNRESET';
  commitErr.errno = -104;
  commitErr.syscall = 'read';
  handlers.push({ match: 'COMMIT', respond: commitErr });
  const client = new FakeClient(handlers);
  const db = makeDb(client);

  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  let caught;
  try {
    await emitQuote({ db, quoteId: QUOTE_ID });
  } catch (err) {
    caught = err;
  } finally {
    console.error = original;
  }

  assert.equal(caught.code, 'PERSISTENCE_TRANSACTION_FAILURE');
  assert.equal(caught.commitOutcome, 'UNKNOWN', 'commit_outcome semantics unchanged by instrumentation');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.stage, 'COMMIT');
  // `err` here is the coordinator's own EmissionCommitOutcomeUnknownError
  // wrapper (code: EMISSION_COMMIT_OUTCOME_UNKNOWN) — the real driver-level
  // error is its `.cause`, which is what error_code/cause_code distinguish.
  assert.equal(parsed.error_code, 'EMISSION_COMMIT_OUTCOME_UNKNOWN');
  assert.equal(parsed.cause_code, 'ECONNRESET');
  assert.equal(parsed.cause_errno, -104);
  assert.equal(parsed.cause_syscall, 'read');
  assert.ok(!lines[0].includes('hunter2'), 'diagnostic must never leak a password');
  assert.ok(!lines[0].includes('postgres://'), 'diagnostic must never leak a connection string');
});

// ── P. endpoint no devuelve internal calculation ─────────────────────────

test('P. the emission result shape (what api/emit-quote.js spreads into its response) never contains internal-calculation fields', async () => {
  const client = new FakeClient(happyPathHandlers());
  const db = makeDb(client);
  const result = await emitQuote({ db, quoteId: QUOTE_ID });

  // This mirrors exactly what api/emit-quote.js does: `{ ok: true, ...result }`.
  const responseBody = { ok: true, ...result };
  const forbidden = ['engine_input', 'engine_output', 'internal_calculation_snapshot', 'quote_version_calculation'];
  for (const key of forbidden) {
    assert.ok(!Object.prototype.hasOwnProperty.call(responseBody, key), `response must never contain "${key}"`);
  }
  assert.deepEqual(Object.keys(responseBody).sort(), ['engine', 'issued_at', 'ok', 'quote_id', 'quote_version_id', 'status', 'version_number']);
});
