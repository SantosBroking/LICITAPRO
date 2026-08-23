// engine/test/newCasesAddendum.test.js
//
// LP-ENG-001R §5-8: N09-N11 (IVA + pricing derivado), división entre cero
// determinista, pérdida (utilidad negativa) y rechazo de moneda mixta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computePricingGroup, aggregateQuote, ZERO_DENOMINATOR_WARNINGS } from '../src/pricingEngine.js';
import { assertClose } from '../test-support/testUtils.js';

test('N09 — TARGET_PROFIT_AMOUNT con CostItem IVA_INCLUDED (no hay doble IVA, no desaparece costo)', () => {
  const result = computePricingGroup({
    quantity: 2,
    costItems: [
      { amount: 116000, quantity: 2, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 10000, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });

  // costoNet = (116000/1.16) x 2 = 200,000 — el IVA del costo se extrae una
  // sola vez (no desaparece, no se duplica).
  assertClose(result.costoNet, 200000, 'N09 costoNet extraído una sola vez de IVA_INCLUDED');
  // ventaNet = costoNet + profit(10000 x 2) = 220,000; ventaGross = ventaNet x 1.16 (IVA_ADDITIONAL) — no se vuelve a aplicar IVA sobre un monto ya bruto.
  assertClose(result.ventaNet, 220000, 'N09 ventaNet = costo + profit, sin IVA duplicado');
  assertClose(result.ventaGross, 220000 * 1.16, 'N09 ventaGross = ventaNet x 1.16 (una sola vez)');
  assertClose(result.utilidad, 20000, 'N09 utilidad coherente');

  const { taxReference } = aggregateQuote([result]);
  assertClose(taxReference.ivaCostoIdentificado, 232000 - 200000, 'N09 taxReference.ivaCostoIdentificado consistente con el costo IVA_INCLUDED');
});

test('N10 — MARKUP_ON_COST con CostItem IVA_INCLUDED', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 232000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_INCLUDED', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'MARKUP_ON_COST', value: 0.20, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });

  assertClose(result.costoNet, 200000, 'N10 costoNet extraído de IVA_INCLUDED');
  assertClose(result.ventaNet, 240000, 'N10 ventaNet = costo x 1.20');
  assertClose(result.ventaGross, 240000 * 1.16, 'N10 ventaGross = ventaNet x 1.16, una sola vez');
  assertClose(result.utilidad, 40000, 'N10 utilidad = 240,000 - 200,000');
  assert.equal(result.warnings.length, 0, 'N10 sin warnings de división entre cero');
});

test('N11 — TARGET_PROFIT_AMOUNT/MARKUP_ON_COST con IVA_ADDITIONAL de venta (taxReference consistente)', () => {
  const target = computePricingGroup({
    quantity: 1,
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 50000, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });
  const markup = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'MARKUP_ON_COST', value: 0.5, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });

  assertClose(target.costoNet, 100000, 'N11 costoNet no desaparece (IVA_ADDITIONAL: amount ya es neto)');
  assertClose(target.ventaNet, 150000, 'N11 ventaNet = costo + profit');
  assertClose(target.ventaGross, 150000 * 1.16, 'N11 ventaGross = ventaNet x 1.16');

  const { taxReference } = aggregateQuote([target, markup]);
  assertClose(taxReference.ivaCostoIdentificado, (100000 * 0.16) * 2, 'N11 IVA de costo identificado consistente (2 grupos, mismo costo base)');
  assert.equal(taxReference.unknownTaxAmounts.total, 0, 'N11 sin montos de IVA desconocido');
});

test('División entre cero — costoOperacional=0 → markupSobreCosto=null + UNDEFINED_ZERO_COST', () => {
  const result = computePricingGroup({
    costItems: [],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1000, taxTreatment: 'ZERO_RATE' },
  });

  assert.equal(result.markupSobreCosto, null, 'markupSobreCosto debe ser null, no Infinity/NaN');
  assert.notEqual(result.margenSobreVenta, null, 'margenSobreVenta sí es calculable (venta != 0)');
  assert.ok(!Number.isNaN(result.utilidad) && Number.isFinite(result.utilidad), 'utilidad sigue siendo un número finito');
  assert.ok(result.warnings.includes(ZERO_DENOMINATOR_WARNINGS.ZERO_COST), 'debe incluir UNDEFINED_ZERO_COST');
  assert.ok(!result.warnings.includes(ZERO_DENOMINATOR_WARNINGS.ZERO_SALE), 'no debe incluir UNDEFINED_ZERO_SALE (venta != 0)');
});

test('División entre cero — ventaOperacional=0 → margenSobreVenta=null + UNDEFINED_ZERO_SALE', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 500, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: null, // grupo de solo costo: ventaNet siempre 0
  });

  assert.equal(result.margenSobreVenta, null, 'margenSobreVenta debe ser null, no Infinity/NaN');
  assert.ok(result.warnings.includes(ZERO_DENOMINATOR_WARNINGS.ZERO_SALE), 'debe incluir UNDEFINED_ZERO_SALE');
  assert.notEqual(result.utilidad, Infinity);
  assert.notEqual(result.utilidad, -Infinity);
  assert.ok(!Number.isNaN(result.utilidad));
});

test('División entre cero a nivel agregado (aggregateQuote) — sin Infinity/NaN', () => {
  const a = computePricingGroup({
    costItems: [],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 0, taxTreatment: 'ZERO_RATE' },
  });
  const { operating } = aggregateQuote([a]);
  assert.equal(operating.markupSobreCosto, null);
  assert.equal(operating.margenSobreVenta, null);
  assert.ok(operating.warnings.includes(ZERO_DENOMINATOR_WARNINGS.ZERO_COST));
  assert.ok(operating.warnings.includes(ZERO_DENOMINATOR_WARNINGS.ZERO_SALE));
});

test('Pérdida — venta < costo: utilidad/markup/margen negativos, sin ajustar ni bloquear', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 60000, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(result.utilidad, -40000, 'utilidad negativa (60,000 - 100,000)');
  assert.ok(result.utilidad < 0);
  assert.ok(result.markupSobreCosto < 0, 'markup negativo');
  assert.ok(result.margenSobreVenta < 0, 'margen negativo');
  assertClose(result.ventaNet, 60000, 'el motor NO ajustó la venta capturada');
  assertClose(result.costoNet, 100000, 'el motor NO ajustó el costo');

  const { operating } = aggregateQuote([result]);
  assertClose(operating.utilidadOperacional, -40000, 'la pérdida se refleja igual a nivel de cotización agregada');
});

test('Moneda mixta — el motor rechaza explícitamente MXN + USD en el mismo cálculo', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 1000, currency: 'MXN', quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
        { amount: 50, currency: 'USD', quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 2000, currency: 'MXN', taxTreatment: 'ZERO_RATE' },
    }),
    /Mezcla de monedas no soportada/,
    'debe rechazar el cálculo cuando aparecen monedas distintas, sin sumar ni convertir silenciosamente'
  );
});

test('Moneda mixta a nivel de cotización — dos grupos, cada uno consistente por separado, pero distintos entre sí', () => {
  const groupMXN = computePricingGroup({
    costItems: [{ amount: 1000, currency: 'MXN', quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1500, currency: 'MXN', taxTreatment: 'ZERO_RATE' },
  });
  const groupUSD = computePricingGroup({
    costItems: [{ amount: 100, currency: 'USD', quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 150, currency: 'USD', taxTreatment: 'ZERO_RATE' },
  });

  assert.throws(
    () => aggregateQuote([groupMXN, groupUSD]),
    /Mezcla de monedas no soportada/,
    'el agregado de cotización rechaza combinar grupos en monedas distintas — ninguna conversión implícita'
  );
});
