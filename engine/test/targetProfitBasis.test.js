// engine/test/targetProfitBasis.test.js
//
// LP-ENG-002: implementación de profitTargetBasis=FINAL_AFTER_KNOWN_COSTS
// (LP-ARCH-003 v1.2, fuente canónica cerrada por Control Tower). N12-N21 son
// las fixtures propuestas en LP-ARCH-003 v1.2 §8, ahora implementadas.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePricingGroup,
  computeQuote,
  computeQuoteWithSaleBasedCosts,
  computeQuoteCanonical,
  aggregateQuote,
  PROFIT_TARGET_BASIS,
  NUMERIC_ERRORS,
} from '../src/pricingEngine.js';
import { assertClose } from '../test-support/testUtils.js';

// ── N12-N19: fixtures del contrato ──────────────────────────────────────

test('N12 — FINAL target sin costos derivados de venta (degenera a BASE)', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [],
  });

  assertClose(result.ventaNet, 120000, 'N12 S = (100,000+0+20,000)/(1-0)');
  assertClose(result.ventaGross, 120000, 'N12 ZERO_RATE: gross=net');
  assertClose(result.utilidad, 20000, 'N12 utilidad = target profit exacto');
  assert.equal(result.profitTargetBasis, 'FINAL_AFTER_KNOWN_COSTS');
});

test('N13 — FINAL target + 5% sobre venta neta', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  const expectedS = (100000 + 0 + 20000) / (1 - 0.05);
  assertClose(result.ventaNet, expectedS, 'N13 S = 126,315.79');
  assertClose(result.utilidad, 20000, 'N13 utilidad real coincide con target profit');
  assert.equal(result.warnings.length, 0, 'N13 sin warnings degenerados');
});

test('N14 — FINAL target + % sobre venta bruta con IVA', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'IVA_ADDITIONAL',
      taxRate: 0.16,
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_GROSS', rate: 0.03, taxTreatment: 'IVA_INCLUDED', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
  });

  // k_1 = 0.03*(1.16) = 0.0348; a_1 = 0.0348/1.16 = 0.03 (coeficiente efectivo
  // = p_i cuando ambas tasas IVA coinciden — LP-ARCH-003 v1.2 N14).
  const expectedS = (100000 + 20000) / (1 - 0.03);
  assertClose(result.ventaNet, expectedS, 'N14 S = 123,711.34');
  assertClose(result.ventaGross, expectedS * 1.16, 'N14 ventaGross = S*(1+0.16), una sola vez');
  assertClose(result.utilidad, 20000, 'N14 utilidad real = target profit exacto');
});

test('N15 — FINAL target + costo fijo post-pricing', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'DIRECT_AMOUNT', amount: 5000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  const expectedS = (100000 + 5000 + 20000) / 1;
  assertClose(result.ventaNet, expectedS, 'N15 S = 125,000 (costo fijo va al numerador, a=0)');
  assertClose(result.utilidad, 20000, 'N15 utilidad real = target profit exacto');
});

test('N16 — FINAL target + varios costos derivados combinados (% + fijo)', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { costCalculationMode: 'DIRECT_AMOUNT', amount: 3000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  const expectedS = (100000 + 3000 + 20000) / (1 - 0.05);
  assertClose(result.ventaNet, expectedS, 'N16 S = 129,473.68');
  assertClose(result.utilidad, 20000, 'N16 utilidad real = target profit exacto');
});

test('N17 — denominador = 0 → IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION, nunca Infinity/NaN', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: {
        mode: 'TARGET_PROFIT_AMOUNT',
        profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
        amountBasis: 'TOTAL',
        value: 20000,
        taxTreatment: 'ZERO_RATE',
      },
      knownSaleBasedCosts: [
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.6, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.4, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
    }),
    /IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION/,
    'N17 debe rechazar explícitamente cuando Σa_i=1 (denominador=0)'
  );
});

test('N18 — denominador < 0 → se calcula, con warning DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.5, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.4, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.3, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  const expectedS = (100000 + 20000) / (1 - 1.2);
  assertClose(result.ventaNet, expectedS, 'N18 S se calcula igual, aunque degenerado (negativo)');
  assert.ok(Number.isFinite(result.ventaNet), 'N18 nunca Infinity/-Infinity/NaN');
  assert.ok(result.warnings.includes('DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE'), 'N18 debe incluir el warning exacto');
});

test('N19 — comparación BASE vs FINAL con los mismos inputs (misma erosión, distinto resultado)', () => {
  // BASE: venta fija primero (120,000); el costo derivado se resta DESPUÉS,
  // a nivel cotización (computeQuoteWithSaleBasedCosts) — erosión visible.
  const baseGroup = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 20000, taxTreatment: 'ZERO_RATE' },
  });
  const baseQuote = computeQuoteWithSaleBasedCosts({
    groups: [{
      costItems: [{ amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 20000, taxTreatment: 'ZERO_RATE' },
    }],
    saleBasedCostItems: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  assertClose(baseGroup.ventaNet, 120000, 'N19 BASE: S fijo primero = 120,000');
  assertClose(baseQuote.quote.operating.utilidadOperacional, 14000, 'N19 BASE: utilidad real erosionada = 20,000-6,000=14,000');

  // FINAL: el mismo costo se declara GROUP_FINAL — la venta se ajusta para
  // que la utilidad real, después de absorberlo, sea exactamente la objetivo.
  const finalGroup = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });

  const expectedS = (100000 + 20000) / (1 - 0.05);
  assertClose(finalGroup.ventaNet, expectedS, 'N19 FINAL: S=126,315.79 (distinto de BASE)');
  assertClose(finalGroup.utilidad, 20000, 'N19 FINAL: utilidad real EXACTA (protegida, no erosionada)');
  assert.notEqual(Math.round(baseGroup.ventaNet), Math.round(finalGroup.ventaNet), 'N19 mismos inputs, distinto resultado de venta');
});

// ── N20-N21: guard de ownership (LP-ARCH-003 v1.2 §2.4, computeQuoteCanonical) ──

test('N20 — FINAL group + saleBasedCostItems de alcance-cotización no absorbido → guard rechaza', () => {
  const finalGroup = {
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [],
  };

  assert.throws(
    () => computeQuoteCanonical({
      groups: [finalGroup],
      saleBasedCostItems: [
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
    }),
    /FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS/,
    'N20 debe rechazar: existe group FINAL y saleBasedCostItems.length>0, sin importar si "coincide" con algún knownSaleBasedCost'
  );
});

test('N21 — FINAL group con knownSaleBasedCosts propio + saleBasedCostItems de cotización → guard rechaza igual (doble ownership)', () => {
  const finalGroup = {
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  };

  // v1: no hay matching heurístico — la sola presencia de saleBasedCostItems
  // junto con un group FINAL ya rechaza, aunque el group ya tenga su propio
  // knownSaleBasedCosts declarado (posible doble ownership del mismo costo).
  assert.throws(
    () => computeQuoteCanonical({
      groups: [finalGroup],
      saleBasedCostItems: [
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
    }),
    /FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS/,
    'N21 debe rechazar igual — v1 no infiere si es el mismo costo o uno distinto, no prorratea, no decide por el usuario'
  );
});

// ── computeQuoteCanonical: casos B/C/D del contrato ──────────────────────

test('computeQuoteCanonical caso B — FINAL group, sin saleBasedCostItems → computeQuote', () => {
  const finalGroup = {
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [],
  };
  const result = computeQuoteCanonical({ groups: [finalGroup] });
  assertClose(result.quote.operating.utilidadOperacional, 20000, 'caso B: agrega igual que computeQuote');
});

test('computeQuoteCanonical caso C — sin FINAL group, con saleBasedCostItems → delega a computeQuoteWithSaleBasedCosts', () => {
  const plainGroup = {
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 20000, taxTreatment: 'ZERO_RATE' },
  };
  const result = computeQuoteCanonical({
    groups: [plainGroup],
    saleBasedCostItems: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
  });
  assert.ok('saleBasedCosts' in result, 'caso C: debe usar la forma de resultado de computeQuoteWithSaleBasedCosts');
  assertClose(result.quote.operating.utilidadOperacional, 14000, 'caso C: erosión visible, igual que el mecanismo clásico');
});

test('computeQuoteCanonical caso D — sin FINAL group, sin saleBasedCostItems → computeQuote', () => {
  const plainGroup = {
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' },
  };
  const result = computeQuoteCanonical({ groups: [plainGroup] });
  assertClose(result.quote.operating.utilidadOperacional, 30000, 'caso D: comportamiento equivalente a computeQuote');
});

// ── Regresión explícita: profitTargetBasis omitido / otros modos sin cambio ──

test('profitTargetBasis omitido conserva el comportamiento BASE legacy (byte-semántico)', () => {
  const withDefault = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'TOTAL', value: 20000, taxTreatment: 'ZERO_RATE' },
  });
  const withExplicitBase = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'BASE_COST_BEFORE_SALE_BASED_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
  });

  assert.deepEqual(withDefault, withExplicitBase, 'omitir el campo debe producir exactamente el mismo resultado que declararlo explícitamente en BASE');
  assertClose(withDefault.ventaNet, 120000, 'sin cambio: venta = costo + profit, sin resolver ecuación');
});

test('PRICE_DIRECT no cambia', () => {
  const result = computePricingGroup({
    costItems: [{ amount: 50000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 70000, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(result.ventaNet, 70000, 'PRICE_DIRECT: venta = valor declarado, sin cambio');
  assertClose(result.utilidad, 20000, 'PRICE_DIRECT: utilidad consecuencia, sin cambio');
});

test('MARKUP_ON_COST no cambia', () => {
  const result = computePricingGroup({
    costItems: [{ amount: 200000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'MARKUP_ON_COST', value: 0.2, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(result.ventaNet, 240000, 'MARKUP_ON_COST: venta = costo*(1+markup), sin cambio');
});

test('BUDGET_CEILING no cambia', () => {
  const result = computePricingGroup({
    costItems: [{ amount: 50000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'BUDGET_CEILING', amountBasis: 'TOTAL', value: 90000, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(result.ventaNet, 90000, 'BUDGET_CEILING: venta = techo declarado, sin cambio');
});

test('knownSaleBasedCosts con moneda distinta a la del grupo rechaza (sin FX)', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 100000, currency: 'MXN', quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: {
        mode: 'TARGET_PROFIT_AMOUNT',
        profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
        amountBasis: 'TOTAL',
        value: 20000,
        taxTreatment: 'ZERO_RATE',
        currency: 'MXN',
      },
      knownSaleBasedCosts: [
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, currency: 'USD', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
    }),
    /Mezcla de monedas no soportada/,
    'debe rechazar cuando knownSaleBasedCosts declara una moneda distinta a la del grupo, sin convertir'
  );
});

test('UNKNOWN en taxTreatment de venta conserva el monto operacional y la incertidumbre', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'UNKNOWN',
    },
    knownSaleBasedCosts: [],
  });

  assertClose(result.ventaNet, 120000, 'UNKNOWN: S se calcula igual que ZERO_RATE/EXEMPT (sin inventar tasa)');
  assertClose(result.ventaGross, 120000, 'UNKNOWN: gross=net, sin inventar tasa');
  assertClose(result.unknownSaleAmount, 120000, 'UNKNOWN: el monto completo se preserva como incertidumbre, no se excluye');
});

test('NOT_DOCUMENTED en un knownSaleBasedCost conserva el warning de documentación', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', documentationStatus: 'NOT_DOCUMENTED' },
    ],
  });

  const knownWarning = result.documentationWarnings.find((w) => w.source === 'knownSaleBasedCosts');
  assert.ok(knownWarning, 'debe registrar un documentationWarning proveniente de knownSaleBasedCosts');
  assert.equal(knownWarning.documentationStatus, 'NOT_DOCUMENTED');
});

test('FINAL con venta IVA_INCLUDED no divide S dos veces (grossFromResolvedNet != applySaleTax)', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'IVA_INCLUDED',
      taxRate: 0.16,
    },
    knownSaleBasedCosts: [],
  });

  // S=120,000 es el NETO ya resuelto — IVA_INCLUDED aquí NUNCA divide S entre
  // (1+0.16) otra vez (eso solo aplica cuando un humano declara un monto ya
  // bruto vía applySaleTax). ventaGross = S*(1+0.16).
  assertClose(result.ventaNet, 120000, 'ventaNet = S, sin volver a dividir');
  assertClose(result.ventaGross, 120000 * 1.16, 'ventaGross = S*(1+0.16), una sola vez');
  assertClose(result.utilidad, 20000, 'utilidad real = target profit exacto');
});

test('PROFIT_TARGET_BASIS expone los dos valores canónicos', () => {
  assert.deepEqual(PROFIT_TARGET_BASIS, ['BASE_COST_BEFORE_SALE_BASED_COSTS', 'FINAL_AFTER_KNOWN_COSTS']);
});

test('profitTargetBasis inválido rechaza explícitamente', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [{ amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', profitTargetBasis: 'ALGO_INVALIDO', amountBasis: 'TOTAL', value: 20000, taxTreatment: 'ZERO_RATE' },
    }),
    /pricing\.profitTargetBasis inválido/
  );
});

test('profitTargetBasis fuera de TARGET_PROFIT_AMOUNT rechaza explícitamente', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [{ amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
      pricing: { mode: 'PRICE_DIRECT', profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS', amountBasis: 'TOTAL', value: 70000, taxTreatment: 'ZERO_RATE' },
    }),
    /profitTargetBasis solo puede declararse cuando pricing\.mode = TARGET_PROFIT_AMOUNT/
  );
});

// ── LP-ENG-002R: QA Control Tower — hardening de inputs no finitos ──────
// El motor promete NUNCA NaN/Infinity/-Infinity. Estos tests cierran las
// dos brechas detectadas: taxRate no finito/negativo, y CostItem.quantity
// no finito bajo quantityMode=PER_UNIT.

test('A) knownSaleBasedCost IVA_INCLUDED con taxRate=-1 → rechaza explícitamente, nunca Infinity/NaN', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: {
        mode: 'TARGET_PROFIT_AMOUNT',
        profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
        amountBasis: 'TOTAL',
        value: 20000,
        taxTreatment: 'ZERO_RATE',
      },
      knownSaleBasedCosts: [
        { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'IVA_INCLUDED', taxRate: -1, documentationStatus: 'DOCUMENTED' },
      ],
    }),
    /knownSaleBasedCosts\[i\]\.taxRate debe ser un número finito >= 0/,
    'debe rechazar antes de dividir entre (1+taxRate)=0, nunca producir Infinity'
  );
});

test('B) pricing.taxRate=-1 en FINAL (venta IVA_INCLUDED) → rechaza explícitamente', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: {
        mode: 'TARGET_PROFIT_AMOUNT',
        profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
        amountBasis: 'TOTAL',
        value: 20000,
        taxTreatment: 'IVA_INCLUDED',
        taxRate: -1,
      },
      knownSaleBasedCosts: [],
    }),
    /pricing\.taxRate \(FINAL_AFTER_KNOWN_COSTS\) debe ser un número finito >= 0/,
    'debe rechazar antes de calcular ventaGross = S*(1+taxRate)'
  );
});

test('C) taxRate NaN / Infinity / -Infinity → rechaza en cada punto de uso, nunca produce NaN/Infinity', () => {
  const makeGroupWithTaxRate = (taxRate) => computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_INCLUDED', taxRate, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' },
  });

  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () => makeGroupWithTaxRate(invalid),
      /CostItem\.taxRate debe ser un número finito >= 0/,
      `CostItem.taxRate=${invalid} debe rechazar`
    );
  }

  const makeSaleWithTaxRate = (taxRate) => computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'IVA_ADDITIONAL', taxRate },
  });

  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () => makeSaleWithTaxRate(invalid),
      /pricing\.taxRate debe ser un número finito >= 0/,
      `pricing.taxRate=${invalid} debe rechazar`
    );
  }
});

test('D) CostItem PER_UNIT quantity=Infinity → rechaza explícitamente', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 1000, quantity: Infinity, quantityMode: 'PER_UNIT', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' },
    }),
    /CostItem\.quantity \(quantityMode=PER_UNIT\) debe ser un número finito/,
    'quantity=Infinity bajo PER_UNIT debe rechazar antes de multiplicar'
  );
});

test('E) CostItem PER_UNIT quantity=NaN → rechaza explícitamente', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 1000, quantity: NaN, quantityMode: 'PER_UNIT', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' },
    }),
    /CostItem\.quantity \(quantityMode=PER_UNIT\) debe ser un número finito/,
    'quantity=NaN bajo PER_UNIT debe rechazar'
  );
});

test('quantity=Infinity/NaN bajo PER_LOT/FIXED_TOTAL no afecta el resultado (no participa en la aritmética, sin cambio de semántica)', () => {
  // PER_LOT/FIXED_TOTAL: multiplier siempre 1, quantity nunca se usa —
  // LP-ENG-002R no introduce una validación nueva ahí (fuera de alcance).
  const perLot = computePricingGroup({
    costItems: [
      { amount: 1000, quantity: Infinity, quantityMode: 'PER_LOT', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 5000, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(perLot.costoNet, 1000, 'PER_LOT ignora quantity (multiplier=1 siempre) — sin cambio de semántica');
});

test('F) valores válidos existentes conservan exactamente su resultado (regresión explícita post-hardening)', () => {
  // CostItem PER_UNIT con quantity finito válido — debe seguir multiplicando
  // exactamente igual que antes del hardening.
  const costItemResult = computePricingGroup({
    costItems: [
      { amount: 500, quantity: 3, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 2000, taxTreatment: 'ZERO_RATE' },
  });
  // costoNet = (500/1.16)*3 = 1293.103448275862...
  assertClose(costItemResult.costoNet, (500 / 1.16) * 3, 'quantity=3 válido: mismo resultado que antes del hardening');

  // taxRate=0 explícito (frontera válida: >=0) debe seguir funcionando
  // exactamente igual que taxRate omitido.
  const explicitZero = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_ADDITIONAL', taxRate: 0, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(explicitZero.costoNet, 100000, 'taxRate=0 explícito: idéntico a taxRate omitido');

  // FINAL_AFTER_KNOWN_COSTS con taxRate/quantity válidos — debe seguir
  // resolviendo S exactamente igual que en N13.
  const finalResult = computePricingGroup({
    costItems: [
      { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: {
      mode: 'TARGET_PROFIT_AMOUNT',
      profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
      amountBasis: 'TOTAL',
      value: 20000,
      taxTreatment: 'ZERO_RATE',
    },
    knownSaleBasedCosts: [
      { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'ZERO_RATE', taxRate: 0, documentationStatus: 'DOCUMENTED' },
    ],
  });
  const expectedS = (100000 + 0 + 20000) / (1 - 0.05);
  assertClose(finalResult.ventaNet, expectedS, 'FINAL con taxRate=0 explícito: mismo resultado que N13');

  // Ninguno de los tres debe producir NaN/Infinity/-Infinity.
  for (const r of [costItemResult, explicitZero, finalResult]) {
    for (const key of ['costoNet', 'ventaNet', 'utilidad']) {
      assert.ok(Number.isFinite(r[key]), `${key} debe ser finito`);
    }
  }
});

// ── LP-ENG-002S: cierre global — inputs individualmente finitos que ──────
// producen overflow aritmético. El motor promete NUNCA NaN/Infinity/
// -Infinity en un resultado público; estos tests cubren el caso que
// LP-ENG-002R no cerraba (cada input por separado era finito y válido).

test('G) CostItem amount=1e308, PER_UNIT quantity=2 → rechaza NON_FINITE_FINANCIAL_RESULT (overflow de amount*quantity)', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 1e308, quantity: 2, quantityMode: 'PER_UNIT', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 5e307, taxTreatment: 'ZERO_RATE' },
    }),
    new RegExp(NUMERIC_ERRORS.NON_FINITE_FINANCIAL_RESULT),
    'amount=1e308 * quantity=2 excede Number.MAX_VALUE — debe rechazar, nunca devolver Infinity en CostItem.net'
  );
});

test('H) PRICE_DIRECT value=1e308, IVA_ADDITIONAL taxRate=1 → rechaza NON_FINITE_FINANCIAL_RESULT (overflow de ventaGross=value*(1+taxRate))', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1e308, taxTreatment: 'IVA_ADDITIONAL', taxRate: 1 },
    }),
    new RegExp(NUMERIC_ERRORS.NON_FINITE_FINANCIAL_RESULT),
    'ventaGross = 1e308*(1+1) = 2e308 excede Number.MAX_VALUE — debe rechazar en applySaleTax, sin cambiar la interpretación de IVA_ADDITIONAL'
  );
});

test('I) FINAL con knownSaleBasedCost cuyo net es finito pero gross hace overflow → rechaza NON_FINITE_FINANCIAL_RESULT', () => {
  assert.throws(
    () => computePricingGroup({
      costItems: [
        { amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
      ],
      pricing: {
        mode: 'TARGET_PROFIT_AMOUNT',
        profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
        amountBasis: 'TOTAL',
        value: 20000,
        taxTreatment: 'ZERO_RATE',
      },
      knownSaleBasedCosts: [
        // net = F_i = 1e308 (finito); gross = F_i*(1+taxRate) = 2e308 (overflow).
        { costCalculationMode: 'DIRECT_AMOUNT', amount: 1e308, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_ADDITIONAL', taxRate: 1, documentationStatus: 'DOCUMENTED' },
      ],
    }),
    new RegExp(NUMERIC_ERRORS.NON_FINITE_FINANCIAL_RESULT),
    'S y ventaGross del grupo son finitas, pero el knownSaleBasedCost individual produce gross no representable — debe rechazar antes de agregar al costo final del grupo'
  );
});

test('J) aggregateQuote de dos grupos individualmente finitos cuya suma hace overflow → rechaza NON_FINITE_FINANCIAL_RESULT', () => {
  const groupA = computePricingGroup({
    costItems: [{ amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1e308, taxTreatment: 'ZERO_RATE' },
  });
  const groupB = computePricingGroup({
    costItems: [{ amount: 1000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1e308, taxTreatment: 'ZERO_RATE' },
  });

  // Cada grupo por separado es perfectamente finito (ventaNet=1e308 < Number.MAX_VALUE).
  assert.ok(Number.isFinite(groupA.ventaNet) && Number.isFinite(groupB.ventaNet));

  assert.throws(
    () => aggregateQuote([groupA, groupB]),
    new RegExp(NUMERIC_ERRORS.NON_FINITE_FINANCIAL_RESULT),
    'la suma de ventaNet de ambos grupos (2e308) excede Number.MAX_VALUE — debe rechazar, no producir una cotización parcialmente válida'
  );
});

test('K) ratio cuyo cociente haría overflow → safeDivide no expone Infinity, el indicador resulta null (sin rechazar el grupo)', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 1e-300, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 1e300, taxTreatment: 'ZERO_RATE' },
  });

  // costoNet, ventaNet y utilidad son cada uno perfectamente finitos — el
  // grupo se calcula sin rechazo. Solo el COCIENTE utilidad/costoNet
  // (≈1e600) excede el rango representable.
  assert.ok(Number.isFinite(result.costoNet));
  assert.ok(Number.isFinite(result.ventaNet));
  assert.ok(Number.isFinite(result.utilidad));
  assert.equal(result.markupSobreCosto, null, 'el cociente no representable produce null, nunca Infinity');
});

test('L) valores normales siguen produciendo exactamente los mismos resultados (regresión post-LP-ENG-002S)', () => {
  const result = computePricingGroup({
    costItems: [
      { amount: 116000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'IVA_INCLUDED', taxRate: 0.16, documentationStatus: 'DOCUMENTED' },
    ],
    pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 150000, taxTreatment: 'ZERO_RATE' },
  });
  assertClose(result.costoNet, 100000, 'costoNet sin cambio: 116,000/1.16');
  assertClose(result.ventaNet, 150000, 'ventaNet sin cambio: PRICE_DIRECT declarado');
  assertClose(result.utilidad, 50000, 'utilidad sin cambio');
  assertClose(result.markupSobreCosto, 0.5, 'markup sin cambio');

  const quote = computeQuote([
    { costItems: [{ amount: 100000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'ZERO_RATE', documentationStatus: 'DOCUMENTED' }], pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 130000, taxTreatment: 'ZERO_RATE' } },
  ]);
  assertClose(quote.quote.operating.utilidadOperacional, 30000, 'aggregateQuote sin cambio para valores normales');
});
