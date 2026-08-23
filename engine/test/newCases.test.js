// engine/test/newCases.test.js
//
// Casos canónicos nuevos N01-N08 (LP-ENG-001 §13). No requieren paridad
// legacy — validan el contrato LP-ARCH-002 / LP-ARCH-001_v1.1 directamente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computePricingGroup, computeQuote } from '../src/pricingEngine.js';
import { assertClose } from '../test-support/testUtils.js';

test('N01 — PRICE_DIRECT + PER_UNIT', () => {
  const result = computePricingGroup({
    quantity: 4,
    costItems: [
      { amount: 2000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'PER_UNIT', value: 1000, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });

  assertClose(result.ventaNet, 4000, 'N01 ventaNet = 1000 x 4');
  assertClose(result.ventaGross, 4640, 'N01 ventaGross = 4000 x 1.16');
  assertClose(result.costoNet, 2000, 'N01 costoNet');
  assertClose(result.utilidad, 2000, 'N01 utilidad');
});

test('N02 — PRICE_DIRECT + TOTAL', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 5000, taxTreatment: 'IVA_INCLUDED', taxRate: 0.16 },
  });

  assertClose(result.ventaGross, 5000, 'N02 ventaGross = value (IVA_INCLUDED → value ya es bruto)');
  assertClose(result.ventaNet, 5000 / 1.16, 'N02 ventaNet extraído de bruto');
});

test('N03 — TARGET_PROFIT_AMOUNT + TOTAL (no se multiplica por cantidad)', () => {
  const resultQty1 = computePricingGroup({
    quantity: 1,
    costItems: [
      { amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 500, taxTreatment: 'ZERO_RATE' },
  });
  const resultQty7 = computePricingGroup({
    quantity: 7,
    costItems: [
      { amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 500, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(resultQty1.ventaNet, 1500, 'N03 ventaNet = costo(1000) + profit TOTAL(500)');
  assertClose(resultQty7.ventaNet, 1500, 'N03 amountBasis=TOTAL ignora quantity (no se multiplica por 7)');
});

test('N04 — markupSobreCosto y margenSobreVenta no se confunden', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 600, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1000, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(result.utilidad, 400, 'N04 utilidad = 1000 - 600');
  assertClose(result.markupSobreCosto, 400 / 600, 'N04 markup sobre costo = utilidad/costo');
  assertClose(result.margenSobreVenta, 400 / 1000, 'N04 margen sobre venta = utilidad/venta');
  assert.notEqual(result.markupSobreCosto, result.margenSobreVenta, 'N04 markup y margen deben diferir — nunca llamar "margen" al markup');
});

test('N05 — UNKNOWN + NOT_DOCUMENTED conserva el monto operacional completo', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 10000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'UNKNOWN', documentationStatus: 'NOT_DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 15000, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(result.costoNet, 10000, 'N05 los 10,000 completos entran al costo operacional');
  assertClose(result.costoGross, 10000, 'N05 UNKNOWN no inventa una base fiscal: gross === net');
  assertClose(result.unknownCostAmount, 10000, 'N05 el monto se señala como incierto, no se excluye');
  assert.equal(result.documentationWarnings.length, 1, 'N05 debe generar una advertencia de documentación');
  assert.equal(result.documentationWarnings[0].documentationStatus, 'NOT_DOCUMENTED');
});

test('N06 — INTERNAL_ONLY afecta rentabilidad sin ser una QuoteLine cliente', () => {
  const withoutInternal = computePricingGroup({
    costItems: [
      { amount: 1000, quantityMode: 'FIXED_TOTAL', costRole: 'LINE_BACKING', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 2000, taxTreatment: 'ZERO_RATE' },
  });
  const withInternal = computePricingGroup({
    costItems: [
      { amount: 1000, quantityMode: 'FIXED_TOTAL', costRole: 'LINE_BACKING', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { amount: 150, quantityMode: 'FIXED_TOTAL', costRole: 'INTERNAL_ONLY', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 2000, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(withInternal.costoNet - withoutInternal.costoNet, 150, 'N06 el costo INTERNAL_ONLY se suma al costo operacional');
  assertClose(withoutInternal.utilidad - withInternal.utilidad, 150, 'N06 reduce la utilidad exactamente en su monto');
});

test('N07 — consolidated pricing 110,000 / 67,000 (sin inventar venta por línea INCLUDED)', () => {
  const result = computePricingGroup({
    // Torreta + Sirena + Radio + Instalación, todas INCLUDED bajo el precio
    // consolidado de la partida — el motor solo ve el costo total que las
    // respalda (67,000), nunca un precio individual por línea.
    costItems: [
      { amount: 20000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { amount: 15000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { amount: 22000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { amount: 10000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 110000, taxTreatment: 'ZERO_RATE' },
  });

  assertClose(result.costoNet, 67000, 'N07 costo total de las líneas INCLUDED');
  assertClose(result.ventaNet, 110000, 'N07 venta consolidada de la partida');
  assertClose(result.utilidad, 43000, 'N07 utilidad = 110,000 - 67,000');
  assertClose(result.markupSobreCosto, 43000 / 67000, 'N07 markup');
  assertClose(result.margenSobreVenta, 43000 / 110000, 'N07 margen');
});

test('N08 — IVA incluido vs IVA adicional en precio de venta (LP_ARCH_002 §B)', () => {
  const included = computePricingGroup({
    costItems: [{ amount: 1, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 170000, taxTreatment: 'IVA_INCLUDED', taxRate: 0.16 },
  });
  const additional = computePricingGroup({
    costItems: [{ amount: 1, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 146551.72, taxTreatment: 'IVA_ADDITIONAL', taxRate: 0.16 },
  });

  assertClose(included.ventaGross, 170000, 'N08 IVA_INCLUDED: el valor capturado ya es el bruto');
  assertClose(included.ventaNet, 146551.7241379310, 'N08 IVA_INCLUDED: neto extraído');
  assertClose(additional.ventaNet, 146551.72, 'N08 IVA_ADDITIONAL: el valor capturado es el neto');
  assertClose(additional.ventaGross, 170000.00, 'N08 IVA_ADDITIONAL: bruto = neto x 1.16');
  assert.notEqual(included.ventaNet, additional.ventaNet, 'N08 el motor distingue correctamente 170,000 IVA incluido de 146,551.72 + IVA');
});
