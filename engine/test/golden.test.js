// engine/test/golden.test.js
//
// Batería golden/parity — LP-ENG-001 §10-12, sobre LP_GOLDEN_BASELINE_LEGACY_v1
// (G01-G08), aprobado por Control Tower. Fuente: legacy `calcCotizacion()`,
// repo SantosBroking/LICITAPRO, commit a256ba9f6c4f0ce52ea7642c6394d9b6fed99fb8,
// src/lib/calc.js (MD5 1def8811a8ef726918527478abd12e05).
//
// Este archivo NO modifica el documento golden original (ZERO DELETE) — es
// una reproducción del mapeo canónico ya documentado ahí, con fixtures
// reproducibles propias del nuevo motor.
//
// Cada caso mapea el input legacy (partidas/equipo/servicios/fianzas) al
// input canónico del motor: un arreglo de "grupos de pricing"
// (costItems + pricing, o costItems + pricing:null para conceptos de solo
// costo como fianzas/retornos). Ver notas CANONICAL MAPPING de cada caso en
// LP_GOLDEN_BASELINE_LEGACY_v1 para la justificación de cada mapeo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../src/pricingEngine.js';
import { assertClose } from '../test-support/testUtils.js';

const IVA = 0.16;

test('G01 — vehículo + equipo / TARGET_PROFIT_AMOUNT', () => {
  const groups = [
    // Partida vehículo: costoMSMS=450000 (IVA_INCLUDED), cantidad=5,
    // utilidadDeseada=60000 → TARGET_PROFIT_AMOUNT + PER_UNIT (LP_ARCH_002 §A).
    {
      quantity: 5,
      costItems: [
        { amount: 450000, quantity: 5, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 60000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    // Equipo: costoConIVA=9000, cnts=[2] x cantidad(5) = 10 unidades efectivas.
    // Sin modoPrecio propio en el legacy → pass-through a costo (MARKUP_ON_COST 0%).
    {
      costItems: [
        { amount: 9000, quantity: 10, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'MARKUP_ON_COST', value: 0, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];

  const { quote } = computeQuote(groups);

  assertClose(quote.grossView.ventaGross, 2_688_000.00, 'G01 ventaTotal (c/IVA)');
  assertClose(quote.operating.ventaOperacional, 2_317_241.379310345, 'G01 ventaSIVA');
  assertClose(quote.operating.costoOperacional, 2_017_241.3793103448, 'G01 costoTotalSIVA');
  assertClose(quote.grossView.costoGross, 2_340_000.00, 'G01 costoTotalCIVA');
  assertClose(quote.operating.utilidadOperacional, 300_000.00, 'G01 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.14871794871794872, 'G01 legacy margen (markup)');
  assertClose(quote.operating.margenSobreVenta, 0.12946428571428573, 'G01 CANONICAL_MARGIN_REFERENCE');
  assertClose(quote.taxReference.ivaVentaIdentificado, 370_758.6206896552, 'G01 ivaVenta');
  assertClose(quote.taxReference.ivaCostoIdentificado, 322_758.62068965513, 'G01 ivaAcreditable');
  assertClose(quote.taxReference.ivaSobranteReferencial, 48_000.00000000006, 'G01 ivaSobrante');
});

test('G02 — MARKUP_ON_COST', () => {
  const groups = [
    {
      quantity: 5,
      costItems: [
        { amount: 200000, quantity: 5, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'MARKUP_ON_COST', value: 0.15, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];

  const { quote } = computeQuote(groups);

  assertClose(quote.grossView.ventaGross, 1_150_000.00, 'G02 ventaTotal (c/IVA)');
  assertClose(quote.operating.ventaOperacional, 991_379.3103448276, 'G02 ventaSIVA');
  assertClose(quote.operating.costoOperacional, 862_068.9655172414, 'G02 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 129_310.3448275862, 'G02 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.15, 'G02 legacy margen (markup) — debe ser exactamente 0.15');
  assertClose(quote.operating.margenSobreVenta, 0.13043478260869565, 'G02 CANONICAL_MARGIN_REFERENCE');
});

test('G03 — BUDGET_CEILING (paridad obligatoria)', () => {
  const groups = [
    {
      quantity: 2,
      costItems: [
        { amount: 300000, quantity: 2, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'BUDGET_CEILING', amountBasis: 'TOTAL', value: 800000, taxTreatment: 'IVA_INCLUDED', taxRate: IVA },
    },
  ];

  const { quote } = computeQuote(groups);

  assertClose(quote.grossView.ventaGross, 800_000.0000000001, 'G03 ventaTotal (c/IVA) = techo exacto');
  assertClose(quote.operating.ventaOperacional, 689_655.1724137932, 'G03 ventaSIVA');
  assertClose(quote.operating.costoOperacional, 517_241.37931034487, 'G03 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 172_413.7931034483, 'G03 utilBruta (consecuencia, no input)');
  assertClose(quote.operating.markupSobreCosto, 0.3333333333333333, 'G03 legacy margen (markup)');
  assertClose(quote.operating.margenSobreVenta, 0.25, 'G03 CANONICAL_MARGIN_REFERENCE');
});

test('G04 — equipo sin vehículo (cantidadGlobal → PRICE_DIRECT/TOTAL)', () => {
  const groups = [
    {
      costItems: [
        { amount: 5000, quantity: 3, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'TOTAL', value: 50000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];

  const { quote } = computeQuote(groups);

  assertClose(quote.operating.costoOperacional, 12_931.034482758621, 'G04 costoTotalSIVA');
  assertClose(quote.operating.ventaOperacional, 50_000.00, 'G04 ventaSIVA (= montoGanar exacto)');
  assertClose(quote.operating.utilidadOperacional, 37_068.96551724138, 'G04 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 2.8666666666666663, 'G04 legacy margen (markup extremo)');
  assertClose(quote.operating.margenSobreVenta, 0.7413793103448275, 'G04 CANONICAL_MARGIN_REFERENCE');
});

test('G05 — servicio (costo y precio capturados directamente)', () => {
  const groups = [
    {
      quantity: 3,
      costItems: [
        { amount: 150000, quantity: 3, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 20000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    {
      quantity: 2,
      costItems: [
        { amount: 8000, quantity: 2, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      // precioUnitario capturado directo → PRICE_DIRECT + PER_UNIT, mismo
      // tratamiento IVA_INCLUDED que el costo del servicio (llevaIVA aplica
      // uniforme a costo y venta del servicio en el legacy).
      pricing: { mode: 'PRICE_DIRECT', amountBasis: 'PER_UNIT', value: 12000, taxTreatment: 'IVA_INCLUDED', taxRate: IVA },
    },
  ];

  const { groups: groupResults, quote } = computeQuote(groups);

  assertClose(groupResults[1].costoGross, 16_000.00, 'G05 costoServCIVA');
  assertClose(groupResults[1].costoNet, 13_793.103448275862, 'G05 costoServSIVA');
  assertClose(quote.grossView.ventaGross, 543_600.00, 'G05 ventaTotal (c/IVA)');
  assertClose(quote.operating.ventaOperacional, 468_620.6896551724, 'G05 ventaSIVA');
  assertClose(quote.operating.costoOperacional, 401_724.13793103455, 'G05 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 66_896.55172413785, 'G05 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.1665236051502144, 'G05 legacy margen');
  assertClose(quote.operating.margenSobreVenta, 0.14275202354672537, 'G05 CANONICAL_MARGIN_REFERENCE');
});

test('G06 — FIXED_TOTAL/PER_LOT (fianza "Monto fijo total", 2 partidas)', () => {
  const groups = [
    {
      quantity: 10,
      costItems: [
        { amount: 400000, quantity: 10, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 50000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    {
      quantity: 30,
      costItems: [
        { amount: 380000, quantity: 30, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 45000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    // Fianza "Monto fijo total": grupo de solo costo (sin pricing propio) —
    // se aplica UNA vez, nunca por unidad (quantityMode=FIXED_TOTAL).
    // llevaIVA=false NO se mapea automáticamente a ZERO_RATE/EXEMPT (LP_ARCH_002
    // §G) — se registra como UNKNOWN/NOT_DOCUMENTED salvo evidencia de exención.
    {
      costItems: [
        { amount: 500000, quantityMode: 'FIXED_TOTAL', taxTreatment: 'UNKNOWN', documentationStatus: 'NOT_DOCUMENTED' },
      ],
      pricing: null,
    },
  ];

  const { groups: groupResults, quote } = computeQuote(groups);

  assertClose(groupResults[2].costoGross, 500_000.00, 'G06 totalFianzas (no multiplicado por unidades)');
  assertClose(groupResults[2].costoNet, 500_000.00, 'G06 costoFianzasSIVA (llevaIVA=false, sin conversión)');
  assertClose(quote.operating.costoOperacional, 13_775_862.068965519, 'G06 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 1_350_000.00, 'G06 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.09799749687108884, 'G06 legacy margen');
  assertClose(quote.operating.margenSobreVenta, 0.08925111136441354, 'G06 CANONICAL_MARGIN_REFERENCE');
});

test('G07 — multipartida / consolidado (modos de precio distintos por partida)', () => {
  const groups = [
    {
      quantity: 10,
      costItems: [
        { amount: 450000, quantity: 10, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 60000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    {
      quantity: 30,
      costItems: [
        { amount: 380000, quantity: 30, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'MARKUP_ON_COST', value: 0.15, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
  ];

  const { quote } = computeQuote(groups);

  assertClose(quote.grossView.ventaGross, 18_306_000.00, 'G07 ventaTotal (c/IVA)');
  assertClose(quote.operating.ventaOperacional, 15_781_034.482758619, 'G07 ventaSIVA');
  assertClose(quote.operating.costoOperacional, 13_706_896.55172414, 'G07 costoTotalSIVA');
  assertClose(quote.operating.utilidadOperacional, 2_074_137.9310344793, 'G07 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.15132075471698087, 'G07 legacy margen (consolidado)');
  assertClose(quote.operating.margenSobreVenta, 0.13143231727302504, 'G07 CANONICAL_MARGIN_REFERENCE');
});

test('G08 — IVA mixto legacy (llevaIVA boolean ambiguo)', () => {
  const groups = [
    {
      quantity: 4,
      costItems: [
        { amount: 250000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'TARGET_PROFIT_AMOUNT', amountBasis: 'PER_UNIT', value: 30000, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    // E1: llevaIVA=true → candidato razonable a IVA_INCLUDED.
    {
      costItems: [
        { amount: 8000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'IVA_INCLUDED', taxRate: IVA, documentationStatus: 'DOCUMENTED' },
      ],
      pricing: { mode: 'MARKUP_ON_COST', value: 0, taxTreatment: 'IVA_ADDITIONAL', taxRate: IVA },
    },
    // E2: llevaIVA=false — LEGACY_BOOLEAN_ONLY. NO se mapea automáticamente a
    // ZERO_RATE/EXEMPT (advertencia explícita del golden baseline, sección C/G08,
    // y LP_ARCH_002 §G): se mapea a UNKNOWN/NOT_DOCUMENTED por defecto.
    // Ver nota NOT_PARITY_COMPARABLE_DUE_TO_LEGACY_TAX_AMBIGUITY más abajo:
    // esta elección es aritméticamente equivalente a ZERO_RATE/EXEMPT para
    // TODOS los campos numéricos de este caso (net === gross en ambos), pero
    // la CONCLUSIÓN fiscal ("¿es realmente una exención confirmada?") no es
    // comparable contra el legacy — el legacy nunca distinguió ambos casos.
    {
      costItems: [
        { amount: 3000, quantity: 4, quantityMode: 'PER_UNIT', taxTreatment: 'UNKNOWN', documentationStatus: 'NOT_DOCUMENTED' },
      ],
      pricing: { mode: 'MARKUP_ON_COST', value: 0, taxTreatment: 'UNKNOWN' },
    },
  ];

  const { groups: groupResults, quote } = computeQuote(groups);

  const costoEqCIVA = groupResults[1].costoGross + groupResults[2].costoGross;
  const costoEqSIVA = groupResults[1].costoNet + groupResults[2].costoNet;
  const ivaEq = costoEqCIVA - costoEqSIVA;

  assertClose(costoEqCIVA, 44_000.00, 'G08 costoEqCIVA');
  assertClose(costoEqSIVA, 39_586.206896551725, 'G08 costoEqSIVA');
  assertClose(ivaEq, 4_413.793103448275, 'G08 ivaEq');
  assertClose(quote.operating.utilidadOperacional, 120_000.00, 'G08 utilBruta');
  assertClose(quote.operating.markupSobreCosto, 0.13308857273978889, 'G08 legacy margen');
  assertClose(quote.operating.margenSobreVenta, 0.11745646010530579, 'G08 CANONICAL_MARGIN_REFERENCE');

  // Marca explícita de diseño (LP-ENG-001 §12): la distinción semántica
  // "exención confirmada" vs "no documentado" para E2 no es un PARITY
  // TARGET numérico — es NOT_PARITY_COMPARABLE_DUE_TO_LEGACY_TAX_AMBIGUITY,
  // y eso es un PASS de diseño, no un error. Se documenta aquí en vez de
  // forzar una conclusión fiscal no sustentada.
  assert.equal(groupResults[2].costoNet, groupResults[2].costoGross, 'G08 NOT_PARITY_COMPARABLE_DUE_TO_LEGACY_TAX_AMBIGUITY: net===gross para E2 bajo UNKNOWN, igual que bajo ZERO_RATE/EXEMPT — la ambigüedad fiscal del legacy no se resuelve, solo se documenta.');
});
