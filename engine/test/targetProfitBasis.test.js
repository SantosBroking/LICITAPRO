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
