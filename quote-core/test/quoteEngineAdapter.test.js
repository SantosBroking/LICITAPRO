// quote-core/test/quoteEngineAdapter.test.js
//
// LP-ORCH-001 §16 — cobertura obligatoria A-AD. node:test + node:assert.
// Ejecutar con: cd quote-core && npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUOTE_ENGINE_METADATA,
  ADAPTER_ERROR_CODES,
  mapCostItemRow,
  mapPricingGroupRow,
  buildMainEngineInput,
  calculateMainQuote,
  calculateSupplementalGroups,
  calculateQuoteDraft,
} from '../src/index.js';

import { computeQuoteCanonical } from '../../engine/src/pricingEngine.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

function costItemRow(overrides = {}) {
  return {
    id: 'ci-default',
    pricing_group_id: 'pg-default',
    cost_scope: 'GROUP_BASE_COST',
    cost_calculation_mode: 'DIRECT_AMOUNT',
    amount: 100,
    quantity: null,
    quantity_mode: 'FIXED_TOTAL',
    rate: null,
    cost_role: 'LINE_BACKING',
    tax_treatment: 'IVA_INCLUDED',
    tax_rate: null,
    documentation_status: 'DOCUMENTED',
    currency: 'MXN',
    status: 'ACTIVE',
    ...overrides,
  };
}

function pricingGroupRow(overrides = {}) {
  return {
    id: 'pg-default',
    quote_id: 'quote-1',
    quantity: null,
    pricing_mode: null,
    amount_basis: null,
    profit_target_basis: null,
    pricing_value: null,
    sale_tax_treatment: null,
    sale_tax_rate: null,
    quote_total_role: 'INCLUDED',
    currency: 'MXN',
    status: 'ACTIVE',
    ...overrides,
  };
}

function saleBasedCostItemRow(overrides = {}) {
  return {
    id: 'sbci-default',
    quote_id: 'quote-1',
    cost_calculation_mode: 'DIRECT_AMOUNT',
    amount: 10,
    quantity: null,
    quantity_mode: 'FIXED_TOTAL',
    rate: null,
    cost_role: 'LINE_BACKING',
    tax_treatment: 'IVA_INCLUDED',
    tax_rate: null,
    documentation_status: 'DOCUMENTED',
    currency: 'MXN',
    status: 'ACTIVE',
    ...overrides,
  };
}

function envelope({ quote, pricingGroups = [], pricingGroupCostItems = [], quoteSaleBasedCostItems = [] }) {
  return { quote, pricingGroups, pricingGroupCostItems, quoteSaleBasedCostItems };
}

// ── A/B/C/D — numeric -> Number ─────────────────────────────────────────

test('A. PostgreSQL numeric string "123.45" -> Number 123.45', () => {
  const mapped = mapCostItemRow(costItemRow({ amount: '123.45' }));
  assert.strictEqual(mapped.amount, 123.45);
});

test('B. "0" conserva cero real (no se confunde con ausencia)', () => {
  const mapped = mapCostItemRow(costItemRow({ amount: '0' }));
  assert.strictEqual(mapped.amount, 0);
  const mapped2 = mapCostItemRow(costItemRow({ amount: 0 }));
  assert.strictEqual(mapped2.amount, 0);
});

test('C. null en campo requerido NO se vuelve 0', () => {
  assert.throws(
    () => mapCostItemRow(costItemRow({ amount: null })),
    (err) => err.code === ADAPTER_ERROR_CODES.REQUIRED_NUMERIC_FIELD_MISSING
  );
  assert.throws(
    () => mapCostItemRow(costItemRow({ amount: undefined })),
    (err) => err.code === ADAPTER_ERROR_CODES.REQUIRED_NUMERIC_FIELD_MISSING
  );
});

test('D. NaN/Infinity/-Infinity rechazados (number y string)', () => {
  assert.throws(() => mapCostItemRow(costItemRow({ amount: NaN })), (err) => err.code === ADAPTER_ERROR_CODES.NON_FINITE_NUMERIC_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: Infinity })), (err) => err.code === ADAPTER_ERROR_CODES.NON_FINITE_NUMERIC_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: -Infinity })), (err) => err.code === ADAPTER_ERROR_CODES.NON_FINITE_NUMERIC_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: 'Infinity' })), (err) => err.code === ADAPTER_ERROR_CODES.NON_NUMERIC_STRING_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: 'not-a-number' })), (err) => err.code === ADAPTER_ERROR_CODES.NON_NUMERIC_STRING_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: '' })), (err) => err.code === ADAPTER_ERROR_CODES.EMPTY_NUMERIC_FIELD);
  assert.throws(() => mapCostItemRow(costItemRow({ amount: '   ' })), (err) => err.code === ADAPTER_ERROR_CODES.EMPTY_NUMERIC_FIELD);
});

// ── E/F/G — omisión de campos nullable de pricing ────────────────────────

test('E. MARKUP_ON_COST con amount_basis NULL produce pricing SIN amountBasis, y el motor lo acepta', () => {
  const group = pricingGroupRow({
    id: 'pg-e',
    pricing_mode: 'MARKUP_ON_COST',
    amount_basis: null,
    profit_target_basis: null,
    pricing_value: 0.2,
    sale_tax_treatment: 'IVA_INCLUDED',
    sale_tax_rate: null,
  });
  const costItems = [costItemRow({ id: 'ci-e', pricing_group_id: 'pg-e', amount: 100 })];
  const mapped = mapPricingGroupRow(group, costItems);

  assert.ok(mapped.pricing !== null);
  assert.ok(!Object.prototype.hasOwnProperty.call(mapped.pricing, 'amountBasis'));

  // El motor debe aceptarlo sin lanzar (validatePricing exige amountBasis
  // === undefined, no null, para MARKUP_ON_COST).
  assert.doesNotThrow(() => computeQuoteCanonical({ groups: [mapped], saleBasedCostItems: [] }));
});

test('F. profit_target_basis NULL se omite (no se envía null)', () => {
  const group = pricingGroupRow({
    id: 'pg-f',
    pricing_mode: 'TARGET_PROFIT_AMOUNT',
    amount_basis: 'TOTAL',
    profit_target_basis: null,
    pricing_value: 50,
    sale_tax_treatment: 'IVA_INCLUDED',
  });
  const mapped = mapPricingGroupRow(group, []);
  assert.ok(!Object.prototype.hasOwnProperty.call(mapped.pricing, 'profitTargetBasis'));
});

test('G. tax_rate NULL se omite en CostItem', () => {
  const mapped = mapCostItemRow(costItemRow({ tax_rate: null }));
  assert.ok(!Object.prototype.hasOwnProperty.call(mapped, 'taxRate'));

  const mapped2 = mapCostItemRow(costItemRow({ tax_rate: '0.16' }));
  assert.strictEqual(mapped2.taxRate, 0.16);
});

// ── H/I/J/K/L/M/N/O/P — main aggregate scoping ───────────────────────────

test('H. ACTIVE INCLUDED entra al main', () => {
  const q = { id: 'quote-h' };
  const groups = [pricingGroupRow({ id: 'pg-h1', quote_id: 'quote-h', quote_total_role: 'INCLUDED', status: 'ACTIVE' })];
  const input = buildMainEngineInput(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(input.groups.length, 1);
});

test('I. OPTIONAL no entra al main', () => {
  const q = { id: 'quote-i' };
  const groups = [
    pricingGroupRow({ id: 'pg-i1', quote_id: 'quote-i', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-i2', quote_id: 'quote-i', quote_total_role: 'OPTIONAL', status: 'ACTIVE' }),
  ];
  const input = buildMainEngineInput(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(input.groups.length, 1);

  // Solo OPTIONAL -> MAIN_INCLUDED_GROUP_REQUIRED.
  assert.throws(
    () => buildMainEngineInput(envelope({ quote: q, pricingGroups: [groups[1]] })),
    (err) => err.code === ADAPTER_ERROR_CODES.MAIN_INCLUDED_GROUP_REQUIRED
  );
});

test('J. REFERENCE_ONLY no entra al main', () => {
  const q = { id: 'quote-j' };
  const groups = [
    pricingGroupRow({ id: 'pg-j1', quote_id: 'quote-j', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-j2', quote_id: 'quote-j', quote_total_role: 'REFERENCE_ONLY', status: 'ACTIVE' }),
  ];
  const input = buildMainEngineInput(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(input.groups.length, 1);
});

test('K. ARCHIVED pricing_group no entra al main', () => {
  const q = { id: 'quote-k' };
  const groups = [
    pricingGroupRow({ id: 'pg-k1', quote_id: 'quote-k', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-k2', quote_id: 'quote-k', quote_total_role: 'INCLUDED', status: 'ARCHIVED' }),
  ];
  const input = buildMainEngineInput(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(input.groups.length, 1);
});

test('L. ARCHIVED cost item no entra', () => {
  const group = pricingGroupRow({ id: 'pg-l', quote_id: 'quote-l', quote_total_role: 'INCLUDED', status: 'ACTIVE' });
  const items = [
    costItemRow({ id: 'ci-l1', pricing_group_id: 'pg-l', status: 'ACTIVE' }),
    costItemRow({ id: 'ci-l2', pricing_group_id: 'pg-l', status: 'ARCHIVED' }),
  ];
  const mapped = mapPricingGroupRow(group, items);
  assert.strictEqual(mapped.costItems.length, 1);
});

test('M. GROUP_BASE_COST mapea a costItems', () => {
  const group = pricingGroupRow({ id: 'pg-m', quote_id: 'quote-m' });
  const items = [costItemRow({ id: 'ci-m', pricing_group_id: 'pg-m', cost_scope: 'GROUP_BASE_COST' })];
  const mapped = mapPricingGroupRow(group, items);
  assert.strictEqual(mapped.costItems.length, 1);
  assert.strictEqual(mapped.knownSaleBasedCosts.length, 0);
});

test('N. GROUP_KNOWN_SALE_BASED_COST mapea a knownSaleBasedCosts solo con TARGET+FINAL', () => {
  const group = pricingGroupRow({
    id: 'pg-n',
    quote_id: 'quote-n',
    pricing_mode: 'TARGET_PROFIT_AMOUNT',
    amount_basis: 'TOTAL',
    profit_target_basis: 'FINAL_AFTER_KNOWN_COSTS',
    pricing_value: 100,
    sale_tax_treatment: 'IVA_INCLUDED',
  });
  const items = [
    costItemRow({ id: 'ci-n', pricing_group_id: 'pg-n', cost_scope: 'GROUP_KNOWN_SALE_BASED_COST', cost_calculation_mode: 'PERCENT_OF_SALE_NET', amount: null, quantity_mode: null, rate: 0.05 }),
  ];
  const mapped = mapPricingGroupRow(group, items);
  assert.strictEqual(mapped.knownSaleBasedCosts.length, 1);
  assert.strictEqual(mapped.costItems.length, 0);
  assert.doesNotThrow(() => computeQuoteCanonical({ groups: [mapped], saleBasedCostItems: [] }));
});

test('O. GROUP_KNOWN_SALE_BASED_COST en PRICE_DIRECT -> reject', () => {
  const group = pricingGroupRow({
    id: 'pg-o',
    quote_id: 'quote-o',
    pricing_mode: 'PRICE_DIRECT',
    amount_basis: 'TOTAL',
    pricing_value: 100,
    sale_tax_treatment: 'IVA_INCLUDED',
  });
  const items = [
    costItemRow({ id: 'ci-o', pricing_group_id: 'pg-o', cost_scope: 'GROUP_KNOWN_SALE_BASED_COST', cost_calculation_mode: 'PERCENT_OF_SALE_NET', amount: null, quantity_mode: null, rate: 0.05 }),
  ];
  assert.throws(
    () => mapPricingGroupRow(group, items),
    (err) => err.code === ADAPTER_ERROR_CODES.GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET
  );
});

test('P. GROUP_KNOWN_SALE_BASED_COST en TARGET+BASE (BASE_COST_BEFORE_SALE_BASED_COSTS) -> reject', () => {
  const group = pricingGroupRow({
    id: 'pg-p',
    quote_id: 'quote-p',
    pricing_mode: 'TARGET_PROFIT_AMOUNT',
    amount_basis: 'TOTAL',
    profit_target_basis: 'BASE_COST_BEFORE_SALE_BASED_COSTS',
    pricing_value: 100,
    sale_tax_treatment: 'IVA_INCLUDED',
  });
  const items = [
    costItemRow({ id: 'ci-p', pricing_group_id: 'pg-p', cost_scope: 'GROUP_KNOWN_SALE_BASED_COST', cost_calculation_mode: 'PERCENT_OF_SALE_NET', amount: null, quantity_mode: null, rate: 0.05 }),
  ];
  assert.throws(
    () => mapPricingGroupRow(group, items),
    (err) => err.code === ADAPTER_ERROR_CODES.GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET
  );

  // También con profit_target_basis omitido (NULL) por completo.
  const group2 = pricingGroupRow({ ...group, id: 'pg-p2', profit_target_basis: null });
  const items2 = items.map((it) => ({ ...it, pricing_group_id: 'pg-p2' }));
  assert.throws(
    () => mapPricingGroupRow(group2, items2),
    (err) => err.code === ADAPTER_ERROR_CODES.GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET
  );
});

// ── Q/R — quote-level sale based costs ───────────────────────────────────

test('Q. quote-level sale based costs ACTIVE mapean a saleBasedCostItems', () => {
  const q = { id: 'quote-q' };
  const groups = [pricingGroupRow({ id: 'pg-q', quote_id: 'quote-q', quote_total_role: 'INCLUDED', status: 'ACTIVE' })];
  const sbci = [
    saleBasedCostItemRow({ id: 'sbci-q1', quote_id: 'quote-q', status: 'ACTIVE' }),
    saleBasedCostItemRow({ id: 'sbci-q2', quote_id: 'quote-q', status: 'ARCHIVED' }),
  ];
  const input = buildMainEngineInput(envelope({ quote: q, pricingGroups: groups, quoteSaleBasedCostItems: sbci }));
  assert.strictEqual(input.saleBasedCostItems.length, 1);
});

test('R. FINAL_AFTER_KNOWN_COSTS + quote-level saleBasedCostItems -> guard canónico del engine', () => {
  const q = { id: 'quote-r' };
  const groups = [
    pricingGroupRow({
      id: 'pg-r',
      quote_id: 'quote-r',
      quote_total_role: 'INCLUDED',
      status: 'ACTIVE',
      pricing_mode: 'TARGET_PROFIT_AMOUNT',
      amount_basis: 'TOTAL',
      profit_target_basis: 'FINAL_AFTER_KNOWN_COSTS',
      pricing_value: 100,
      sale_tax_treatment: 'IVA_INCLUDED',
    }),
  ];
  const sbci = [saleBasedCostItemRow({ id: 'sbci-r', quote_id: 'quote-r', status: 'ACTIVE' })];

  assert.throws(
    () => calculateMainQuote(envelope({ quote: q, pricingGroups: groups, quoteSaleBasedCostItems: sbci })),
    /FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS/
  );
});

// ── S/T — cost-only group / cero grupos ──────────────────────────────────

test('S. cost-only INCLUDED group: pricing_mode NULL -> pricing=null -> cálculo válido', () => {
  const q = { id: 'quote-s' };
  const groups = [pricingGroupRow({ id: 'pg-s', quote_id: 'quote-s', quote_total_role: 'INCLUDED', status: 'ACTIVE', pricing_mode: null })];
  const items = [costItemRow({ id: 'ci-s', pricing_group_id: 'pg-s' })];
  const result = calculateMainQuote(envelope({ quote: q, pricingGroups: groups, pricingGroupCostItems: items }));
  assert.strictEqual(result.engineInput.groups[0].pricing, null);
  assert.strictEqual(result.engineOutput.groups[0].isCostOnlyGroup, true);
});

test('T. cero ACTIVE INCLUDED groups -> MAIN_INCLUDED_GROUP_REQUIRED', () => {
  const q = { id: 'quote-t' };
  assert.throws(
    () => buildMainEngineInput(envelope({ quote: q, pricingGroups: [] })),
    (err) => err.code === ADAPTER_ERROR_CODES.MAIN_INCLUDED_GROUP_REQUIRED
  );
});

// ── U/V/W — scope / orphans ───────────────────────────────────────────────

test('U. pricing_group de otra quote -> reject', () => {
  const q = { id: 'quote-u' };
  const groups = [pricingGroupRow({ id: 'pg-u', quote_id: 'quote-OTHER', quote_total_role: 'INCLUDED', status: 'ACTIVE' })];
  assert.throws(
    () => buildMainEngineInput(envelope({ quote: q, pricingGroups: groups })),
    (err) => err.code === ADAPTER_ERROR_CODES.PRICING_GROUP_QUOTE_MISMATCH
  );
});

test('V. quote_sale_based_cost_item de otra quote -> reject', () => {
  const q = { id: 'quote-v' };
  const groups = [pricingGroupRow({ id: 'pg-v', quote_id: 'quote-v', quote_total_role: 'INCLUDED', status: 'ACTIVE' })];
  const sbci = [saleBasedCostItemRow({ id: 'sbci-v', quote_id: 'quote-OTHER' })];
  assert.throws(
    () => buildMainEngineInput(envelope({ quote: q, pricingGroups: groups, quoteSaleBasedCostItems: sbci })),
    (err) => err.code === ADAPTER_ERROR_CODES.SALE_BASED_COST_ITEM_QUOTE_MISMATCH
  );
});

test('W. pricing_group_cost_item huérfano -> reject', () => {
  const q = { id: 'quote-w' };
  const groups = [pricingGroupRow({ id: 'pg-w', quote_id: 'quote-w', quote_total_role: 'INCLUDED', status: 'ACTIVE' })];
  const items = [costItemRow({ id: 'ci-w', pricing_group_id: 'pg-NONEXISTENT' })];
  assert.throws(
    () => buildMainEngineInput(envelope({ quote: q, pricingGroups: groups, pricingGroupCostItems: items })),
    (err) => err.code === ADAPTER_ERROR_CODES.ORPHAN_PRICING_GROUP_COST_ITEM
  );
});

// ── X/Y/Z — supplemental ─────────────────────────────────────────────────

test('X. OPTIONAL se calcula separado', () => {
  const q = { id: 'quote-x' };
  const groups = [
    pricingGroupRow({ id: 'pg-x1', quote_id: 'quote-x', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-x2', quote_id: 'quote-x', quote_total_role: 'OPTIONAL', status: 'ACTIVE' }),
  ];
  const supplemental = calculateSupplementalGroups(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(supplemental.length, 1);
  assert.strictEqual(supplemental[0].pricing_group_id, 'pg-x2');
  assert.strictEqual(supplemental[0].quote_total_role, 'OPTIONAL');
});

test('Y. REFERENCE_ONLY se calcula separado', () => {
  const q = { id: 'quote-y' };
  const groups = [
    pricingGroupRow({ id: 'pg-y1', quote_id: 'quote-y', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-y2', quote_id: 'quote-y', quote_total_role: 'REFERENCE_ONLY', status: 'ACTIVE' }),
  ];
  const supplemental = calculateSupplementalGroups(envelope({ quote: q, pricingGroups: groups }));
  assert.strictEqual(supplemental.length, 1);
  assert.strictEqual(supplemental[0].pricing_group_id, 'pg-y2');
  assert.strictEqual(supplemental[0].quote_total_role, 'REFERENCE_ONLY');
});

test('Z. supplemental engine input usa saleBasedCostItems: []', () => {
  const q = { id: 'quote-z' };
  const groups = [pricingGroupRow({ id: 'pg-z', quote_id: 'quote-z', quote_total_role: 'OPTIONAL', status: 'ACTIVE' })];
  const sbci = [saleBasedCostItemRow({ id: 'sbci-z', quote_id: 'quote-z' })];
  const supplemental = calculateSupplementalGroups(envelope({ quote: q, pricingGroups: groups, quoteSaleBasedCostItems: sbci }));
  assert.deepStrictEqual(supplemental[0].engine_input.saleBasedCostItems, []);
});

// ── AA/AB/AC/AD ────────────────────────────────────────────────────────────

test('AA. calculateMainQuote.engineOutput es deepEqual a computeQuoteCanonical(engineInput) directo', () => {
  const q = { id: 'quote-aa' };
  const groups = [pricingGroupRow({
    id: 'pg-aa',
    quote_id: 'quote-aa',
    quote_total_role: 'INCLUDED',
    status: 'ACTIVE',
    pricing_mode: 'PRICE_DIRECT',
    amount_basis: 'TOTAL',
    pricing_value: 500,
    sale_tax_treatment: 'IVA_INCLUDED',
  })];
  const items = [costItemRow({ id: 'ci-aa', pricing_group_id: 'pg-aa' })];

  const result = calculateMainQuote(envelope({ quote: q, pricingGroups: groups, pricingGroupCostItems: items }));
  const direct = computeQuoteCanonical(result.engineInput);
  assert.deepStrictEqual(result.engineOutput, direct);
});

test('AB. No redondea: preserva precisión decimal real del engine', () => {
  const q = { id: 'quote-ab' };
  const groups = [pricingGroupRow({
    id: 'pg-ab',
    quote_id: 'quote-ab',
    quote_total_role: 'INCLUDED',
    status: 'ACTIVE',
    pricing_mode: 'PRICE_DIRECT',
    amount_basis: 'TOTAL',
    pricing_value: 100,
    sale_tax_treatment: 'IVA_ADDITIONAL',
    sale_tax_rate: '0.15',
  })];
  const items = [costItemRow({ id: 'ci-ab', pricing_group_id: 'pg-ab', amount: '33.333333', tax_treatment: 'ZERO_RATE', tax_rate: null })];

  const result = calculateMainQuote(envelope({ quote: q, pricingGroups: groups, pricingGroupCostItems: items }));
  const groupResult = result.engineOutput.groups[0];

  const expectedCostoNet = 33.333333;
  const expectedVentaNet = 100;
  const expectedUtilidad = expectedVentaNet - expectedCostoNet;
  const expectedMargen = expectedUtilidad / expectedVentaNet;

  assert.strictEqual(groupResult.costoNet, expectedCostoNet);
  assert.strictEqual(groupResult.utilidad, expectedUtilidad);
  assert.strictEqual(groupResult.margenSobreVenta, expectedMargen);
  assert.ok(!Number.isInteger(groupResult.margenSobreVenta));
});

test('AC. Las filas de input no son mutadas', () => {
  const group = pricingGroupRow({ id: 'pg-ac', quote_id: 'quote-ac' });
  const items = [costItemRow({ id: 'ci-ac', pricing_group_id: 'pg-ac' })];
  const groupClone = JSON.parse(JSON.stringify(group));
  const itemsClone = JSON.parse(JSON.stringify(items));

  mapPricingGroupRow(group, items);

  assert.deepStrictEqual(group, groupClone);
  assert.deepStrictEqual(items, itemsClone);
});

test('AD. QUOTE_ENGINE_METADATA coincide exactamente con el engine consumido', () => {
  assert.strictEqual(QUOTE_ENGINE_METADATA.engineCommitSha, '0421b8f28d075089320387d526c97d1f27adf764');
  assert.strictEqual(QUOTE_ENGINE_METADATA.engineContractVersion, 'LP-ENG-002T');
  assert.strictEqual(QUOTE_ENGINE_METADATA.calculationSchemaVersion, 'v1');
  assert.ok(Object.isFrozen(QUOTE_ENGINE_METADATA));
});

// ── Sanity adicional: calculateQuoteDraft de alto nivel ───────────────────

test('calculateQuoteDraft combina main + supplemental sin persistir nada', () => {
  const q = { id: 'quote-draft' };
  const groups = [
    pricingGroupRow({ id: 'pg-draft-main', quote_id: 'quote-draft', quote_total_role: 'INCLUDED', status: 'ACTIVE' }),
    pricingGroupRow({ id: 'pg-draft-opt', quote_id: 'quote-draft', quote_total_role: 'OPTIONAL', status: 'ACTIVE' }),
  ];
  const items = [
    costItemRow({ id: 'ci-draft-main', pricing_group_id: 'pg-draft-main' }),
    costItemRow({ id: 'ci-draft-opt', pricing_group_id: 'pg-draft-opt' }),
  ];
  const draft = calculateQuoteDraft(envelope({ quote: q, pricingGroups: groups, pricingGroupCostItems: items }));
  assert.ok(draft.main.engineOutput);
  assert.strictEqual(draft.supplementalCalculations.length, 1);
  assert.strictEqual(draft.supplementalCalculations[0].pricing_group_id, 'pg-draft-opt');
});
