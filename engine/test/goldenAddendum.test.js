// engine/test/goldenAddendum.test.js
//
// LP-ENG-001R §3-4 — Golden addendum G09-G11: las 4 bases de Retorno/Fianza
// legacy. No modifica LP_GOLDEN_BASELINE_LEGACY_v1 (ZERO DELETE) — son
// fixtures NUEVOS, ejecutados en vivo contra el `calcCotizacion()` real
// (repo SantosBroking/LICITAPRO, commit a256ba9f6c4f0ce52ea7642c6394d9b6fed99fb8,
// src/lib/calc.js, MD5 1def8811a8ef726918527478abd12e05) por esta misma
// misión — ver LP-ENG-001R §1 (LEGACY SEQUENCE FINDING) para la secuencia
// confirmada: venta se fija PRIMERO (partidas/equipo/servicios); retornos y
// fianzas se calculan DESPUÉS, como función de esa venta ya fija (nunca la
// realimentan) — según la base declarada:
//   '% sobre venta c/IVA'   → PERCENT_OF_SALE_GROSS
//   '% sobre venta s/IVA'   → PERCENT_OF_SALE_NET
//   'Monto fijo total'      → DIRECT_AMOUNT + FIXED_TOTAL/PER_LOT (ya cubierto en G06)
//   'Monto fijo por unidad' → DIRECT_AMOUNT + PER_UNIT (G11)

import test from 'node:test';
import { computeQuoteWithSaleBasedCosts } from '../src/pricingEngine.js';
import { assertClose } from '../test-support/testUtils.js';

const IVA = 0.16;

test('G09 — PERCENT_OF_SALE_NET ("% sobre venta s/IVA", retorno llevaIVA:true)', () => {
  // LEGACY INPUT (ejecutado en vivo contra calc.js):
  // partidas: [{cantidad:4, costoMSMS:250000, modoPrecio:'Utilidad deseada $', utilidadDeseada:30000}]
  // retornos: [{base:'% sobre venta s/IVA', valor:5, llevaIVA:true}]
  const groups = [
    {
      quantity: 4,
      costItems: [
        { amount: 250000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 30000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];
  const saleBasedCostItems = [
    // retorno "% sobre venta s/IVA", valor=5 (%) → rate=0.05, sobre ventaNet
    // de TODA la cotización. llevaIVA:true → mismo mapeo IVA_INCLUDED que
    // vehículo/equipo (LP_GOLDEN_BASELINE_LEGACY_v1 §F).
    { costCalculationMode: 'PERCENT_OF_SALE_NET', rate: 0.05, taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
  ];

  const { saleBasedCosts, quote } = computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems });

  // EXPECTED OUTPUT (real, capturado de calcCotizacion() en vivo):
  assertClose(quote.operating.ventaOperacional, 982_068.9655172414, 'G09 ventaSIVA');
  assertClose(saleBasedCosts[0].costoGross, 49_103.448275862065, 'G09 totalRetornos (= ventaSIVA x 5%)');
  assertClose(saleBasedCosts[0].costoNet, 42_330.55885850178, 'G09 costoRetornosSIVA');
  assertClose(quote.operating.costoOperacional, 904_399.5243757432, 'G09 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 77_669.44114149816, 'G09 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.085879568761504, 'G09 legacy margen');
});

test('G10 — PERCENT_OF_SALE_GROSS ("% sobre venta c/IVA", retorno llevaIVA:true)', () => {
  const groups = [
    {
      quantity: 4,
      costItems: [
        { amount: 250000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 30000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];
  const saleBasedCostItems = [
    // retorno "% sobre venta c/IVA", valor=5 (%) → rate=0.05, sobre ventaGross.
    { costCalculationMode: 'PERCENT_OF_SALE_GROSS', rate: 0.05, taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
  ];

  const { saleBasedCosts, quote } = computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems });

  assertClose(quote.grossView.ventaGross, 1_139_200.00, 'G10 ventaTotal (c/IVA)');
  assertClose(saleBasedCosts[0].costoGross, 56_960.00, 'G10 totalRetornos (= ventaCIVA x 5%)');
  assertClose(saleBasedCosts[0].costoNet, 49_103.44827586207, 'G10 costoRetornosSIVA');
  assertClose(quote.operating.costoOperacional, 911_172.4137931034, 'G10 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 70_896.55172413797, 'G10 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.07780805328489257, 'G10 legacy margen');
});

test('G11 — FIXED_AMOUNT_PER_UNIT ("Monto fijo por unidad", fianza sobre 2 partidas)', () => {
  // LEGACY INPUT: P1 cantidad=6, P2 cantidad=4 (10 unidades totales);
  // fianza {base:'Monto fijo por unidad', valor:2000, llevaIVA:false}.
  const groups = [
    {
      quantity: 6,
      costItems: [
        { amount: 400000, quantity: 6, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 50000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    {
      quantity: 4,
      costItems: [
        { amount: 380000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 45000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];
  const saleBasedCostItems = [
    // "Monto fijo por unidad" = DIRECT_AMOUNT + PER_UNIT, con `quantity` =
    // total de unidades de TODA la cotización (10 = 6+4) — el caller la
    // resuelve explícitamente, igual que ya hacía G01 con el equipo
    // (cnts x cantidad). llevaIVA:false → NOT_DOCUMENTED (nunca ZERO_RATE/
    // EXEMPT automático).
    { costCalculationMode: 'DIRECT_AMOUNT', amount: 2000, quantity: 10, quantityMode: 'PER_UNIT', taxTreatment: 'UNKNOWN', documentationStatus: 'NOT_DOCUMENTED' },
  ];

  const { saleBasedCosts, quote } = computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems });

  assertClose(saleBasedCosts[0].costoGross, 20_000.00, 'G11 totalFianzas (= 2000 x 10 unidades, no un monto fijo único)');
  assertClose(saleBasedCosts[0].costoNet, 20_000.00, 'G11 costoFianzasSIVA (llevaIVA=false, sin conversión)');
  assertClose(quote.operating.utilidadOperacional, 459_999.99999999953, 'G11 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.1353215662406166, 'G11 legacy margen');
});
