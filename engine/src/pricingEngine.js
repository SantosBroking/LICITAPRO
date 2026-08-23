// engine/src/pricingEngine.js
//
// Motor financiero puro de LicitaPro — LP-ENG-001.
//
// Contrato de origen: LP-ARCH-001_v1.1 (secciones B/C) + LP_ARCH_002 (amount
// basis, tax treatment de venta, vistas canónicas del motor, campos de
// paridad). No conoce Project, UI, Supabase, PDF, Drive, vehículos ni
// ninguna entidad de dominio del legacy. Recibe estructuras canónicas y
// produce resultados canónicos. Determinista, sin estado externo.
//
// "Un solo motor calcula; el resto solo presenta."
//
// No redondea internamente por presentación (regla LP-ENG-001 §14) — toda la
// aritmética se mantiene en precisión flotante completa. El redondeo para
// mostrar al usuario es responsabilidad de la capa de presentación (Editor /
// PDF), no de este módulo.

// ── Enums de referencia (documentales — el motor no valida contra listas
// cerradas más allá de lo estrictamente necesario para no adivinar semántica
// silenciosamente; ver validate* más abajo). ─────────────────────────────

export const PRICING_MODES = Object.freeze([
  'PRICE_DIRECT',
  'TARGET_PROFIT_AMOUNT',
  'MARKUP_ON_COST',
  'BUDGET_CEILING',
]);

export const AMOUNT_BASIS = Object.freeze(['PER_UNIT', 'TOTAL']);

export const TAX_TREATMENTS = Object.freeze([
  'IVA_INCLUDED',
  'IVA_ADDITIONAL',
  'ZERO_RATE',
  'EXEMPT',
  'UNKNOWN',
]);

export const QUANTITY_MODES = Object.freeze(['PER_UNIT', 'PER_LOT', 'FIXED_TOTAL']);

export const COST_ROLES = Object.freeze(['LINE_BACKING', 'INTERNAL_ONLY']);

export const DOCUMENTATION_STATUSES = Object.freeze([
  'DOCUMENTED',
  'NOT_DOCUMENTED',
  'UNCONFIRMED',
]);

// LP-ENG-001R §1-2: hallazgo de auditoría read-only sobre calc.js legacy
// (repo SantosBroking/LICITAPRO, commit a256ba9f6c4f0ce52ea7642c6394d9b6fed99fb8):
// retornos/fianzas se calculan DESPUÉS de que venta ya quedó fija (nunca
// realimentan el precio), como % de la venta ya determinada (neta o bruta)
// o como monto directo (fijo total o fijo por unidad). costCalculationMode
// generaliza esas 4 bases sin crear objetos "Retorno"/"Fianza" propios:
//   - DIRECT_AMOUNT: usa `amount` + quantityMode (PER_UNIT/PER_LOT/FIXED_TOTAL),
//     exactamente como en LP-ENG-001 v1 (sin cambio de comportamiento).
//   - PERCENT_OF_SALE_NET / PERCENT_OF_SALE_GROSS: usa `rate` (fracción, no
//     amount) aplicado sobre la venta YA determinada de la cotización — ver
//     `computeQuoteWithSaleBasedCosts`.
export const COST_CALCULATION_MODES = Object.freeze([
  'DIRECT_AMOUNT',
  'PERCENT_OF_SALE_NET',
  'PERCENT_OF_SALE_GROSS',
]);

// LP-ENG-001R §8: el motor v1 no hace FX. Toda estructura de costo/pricing
// declara opcionalmente `currency`; si se omite, se asume este default — pero
// mezclar monedas *distintas* dentro de un mismo cálculo se rechaza siempre
// (ver `assertSingleCurrency`), nunca se convierte ni se asume tipo de cambio.
export const DEFAULT_CURRENCY = 'MXN';

// LP-ENG-001R §6: nombres deterministas y testeables para división entre
// cero — nunca Infinity/-Infinity/NaN.
export const ZERO_DENOMINATOR_WARNINGS = Object.freeze({
  ZERO_COST: 'UNDEFINED_ZERO_COST',
  ZERO_SALE: 'UNDEFINED_ZERO_SALE',
});

// ── Utilidades internas ──────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(`[pricingEngine] ${message}`);
}

/**
 * División determinista: si el denominador es 0, regresa `null` en vez de
 * NaN/Infinity, para que el consumidor pueda distinguir "no calculable" de
 * un resultado numérico real. (LP-ENG-001 §8: manejar división entre cero de
 * manera determinista.)
 */
function safeDivide(numerator, denominator) {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Valida que un conjunto de monedas (ya resueltas con su default aplicado)
 * sea uno solo. El motor v1 no hace FX (LP-ENG-001R §8): nunca suma, nunca
 * convierte, nunca asume tipo de cambio — si aparece más de una moneda en el
 * mismo cálculo, rechaza explícitamente.
 */
function assertSingleCurrency(currencies, contextLabel) {
  const unique = [...new Set(currencies)];
  assert(
    unique.length <= 1,
    `Mezcla de monedas no soportada en ${contextLabel}: ${unique.join(', ')}. El motor v1 no hace conversión de divisas — normaliza a una sola moneda antes de calcular.`
  );
  return unique[0] ?? DEFAULT_CURRENCY;
}

// ── CostItem ──────────────────────────────────────────────────────────────

/**
 * Resuelve el monto base (antes de tratamiento fiscal) y el multiplicador de
 * cantidad de un CostItem, según `costCalculationMode` (LP-ENG-001R §2).
 *
 * - DIRECT_AMOUNT: comportamiento idéntico a LP-ENG-001 v1 — `amount` +
 *   `quantityMode` (PER_UNIT multiplica por `quantity`; PER_LOT/FIXED_TOTAL
 *   no multiplican).
 * - PERCENT_OF_SALE_NET / PERCENT_OF_SALE_GROSS: `rate` (fracción, ej. 0.05)
 *   aplicado sobre la venta ya determinada de la cotización, provista en
 *   `context.ventaNetReference` / `context.ventaGrossReference`. Nunca se
 *   multiplica por cantidad — la venta de referencia ya es un total.
 */
function resolveCostBase(item, context) {
  const mode = item.costCalculationMode ?? 'DIRECT_AMOUNT';
  assert(COST_CALCULATION_MODES.includes(mode), `CostItem.costCalculationMode inválido: ${mode}`);

  if (mode === 'DIRECT_AMOUNT') {
    assert(typeof item.amount === 'number' && Number.isFinite(item.amount), 'CostItem.amount debe ser un número cuando costCalculationMode=DIRECT_AMOUNT.');
    assert(QUANTITY_MODES.includes(item.quantityMode), `CostItem.quantityMode inválido: ${item.quantityMode}`);
    const quantity = item.quantity ?? 1;
    // FIXED_TOTAL / PER_LOT: el monto ya es el total del concepto — no se
    // multiplica por `quantity` (LP-ENG-001 §9 / golden G06: "Monto fijo
    // total" se aplica una sola vez, nunca por unidad).
    const multiplier = item.quantityMode === 'PER_UNIT' ? quantity : 1;
    return { baseAmount: item.amount, multiplier };
  }

  assert(typeof item.rate === 'number' && Number.isFinite(item.rate), `CostItem.rate debe ser un número cuando costCalculationMode=${mode}.`);

  if (mode === 'PERCENT_OF_SALE_NET') {
    assert(
      context && typeof context.ventaNetReference === 'number' && Number.isFinite(context.ventaNetReference),
      'PERCENT_OF_SALE_NET requiere context.ventaNetReference (venta neta ya determinada de la cotización) — ver computeQuoteWithSaleBasedCosts.'
    );
    return { baseAmount: context.ventaNetReference * item.rate, multiplier: 1 };
  }

  // PERCENT_OF_SALE_GROSS
  assert(
    context && typeof context.ventaGrossReference === 'number' && Number.isFinite(context.ventaGrossReference),
    'PERCENT_OF_SALE_GROSS requiere context.ventaGrossReference (venta bruta ya determinada de la cotización) — ver computeQuoteWithSaleBasedCosts.'
  );
  return { baseAmount: context.ventaGrossReference * item.rate, multiplier: 1 };
}

/**
 * Calcula el neto/bruto de un CostItem individual.
 *
 * CostItem es SIEMPRE información interna de cálculo (LP-ENG-001 §5): su
 * `amount`/`rate` resuelto nunca se convierte en dato de presentación al
 * cliente por el solo hecho de pasar por aquí. `costRole` es metadato para
 * capas superiores (Editor/PDF) — no cambia la aritmética del motor.
 *
 * Regla UNKNOWN (LP-ENG-001 §6): si `taxTreatment === 'UNKNOWN'`, el monto
 * completo entra al costo operacional; el motor NO asume IVA 0%, exento, ni
 * ningún tratamiento — solo señala incertidumbre.
 *
 * @param {object} item
 * @param {'DIRECT_AMOUNT'|'PERCENT_OF_SALE_NET'|'PERCENT_OF_SALE_GROSS'} [item.costCalculationMode='DIRECT_AMOUNT']
 * @param {number} [item.amount] - requerido si costCalculationMode=DIRECT_AMOUNT.
 * @param {number} [item.rate] - requerido si costCalculationMode es PERCENT_OF_SALE_*.
 * @param {number} [item.quantity=1]
 * @param {'PER_UNIT'|'PER_LOT'|'FIXED_TOTAL'} [item.quantityMode] - requerido si DIRECT_AMOUNT.
 * @param {'LINE_BACKING'|'INTERNAL_ONLY'} [item.costRole]
 * @param {'IVA_INCLUDED'|'IVA_ADDITIONAL'|'ZERO_RATE'|'EXEMPT'|'UNKNOWN'} item.taxTreatment
 * @param {number} [item.taxRate]
 * @param {'DOCUMENTED'|'NOT_DOCUMENTED'|'UNCONFIRMED'} [item.documentationStatus]
 * @param {string} [item.currency] - default DEFAULT_CURRENCY; el motor no convierte divisas.
 * @param {object} [context] - { ventaNetReference, ventaGrossReference }, requerido solo para modos PERCENT_OF_SALE_*.
 */
export function computeCostItem(item, context = {}) {
  assert(typeof item === 'object' && item !== null, 'CostItem debe ser un objeto.');
  assert(TAX_TREATMENTS.includes(item.taxTreatment), `CostItem.taxTreatment inválido: ${item.taxTreatment}`);

  const { baseAmount, multiplier } = resolveCostBase(item, context);
  const rate = item.taxRate ?? 0;
  const isUnknownTax = item.taxTreatment === 'UNKNOWN';

  // Interpretación según taxTreatment. IVA_INCLUDED asume que `baseAmount`
  // ya es el bruto (con IVA). El resto (IVA_ADDITIONAL, ZERO_RATE, EXEMPT,
  // UNKNOWN) asume que `baseAmount` es ya el monto operacional/neto tal cual
  // fue resuelto (capturado directo, o derivado de venta para PERCENT_OF_SALE_*).
  let unitNet;
  let unitGross;
  switch (item.taxTreatment) {
    case 'IVA_INCLUDED':
      unitNet = baseAmount / (1 + rate);
      unitGross = baseAmount;
      break;
    case 'IVA_ADDITIONAL':
      unitNet = baseAmount;
      unitGross = baseAmount * (1 + rate);
      break;
    case 'ZERO_RATE':
    case 'EXEMPT':
    case 'UNKNOWN':
      // PAGO EN EFECTIVO != IVA 0%: UNKNOWN nunca se trata como ZERO_RATE/
      // EXEMPT. Aquí ambos casos coinciden numéricamente (net === gross,
      // sin IVA que sumar) pero se preservan como ramas separadas para que
      // el significado quede explícito en el código, no solo en el dato.
      unitNet = baseAmount;
      unitGross = baseAmount;
      break;
    default:
      throw new Error(`[pricingEngine] taxTreatment no soportado: ${item.taxTreatment}`);
  }

  const net = unitNet * multiplier;
  const gross = unitGross * multiplier;

  return {
    net,
    gross,
    costRole: item.costRole ?? 'LINE_BACKING',
    costCalculationMode: item.costCalculationMode ?? 'DIRECT_AMOUNT',
    taxTreatment: item.taxTreatment,
    documentationStatus: item.documentationStatus ?? 'UNCONFIRMED',
    isUnknownTax,
    isUndocumented: (item.documentationStatus ?? 'UNCONFIRMED') !== 'DOCUMENTED',
    currency: item.currency ?? DEFAULT_CURRENCY,
  };
}

// ── Tratamiento fiscal del precio de venta ──────────────────────────────

/**
 * Resuelve neto/bruto de un monto de venta ya determinado (`baseAmount`)
 * según su tratamiento fiscal declarado. Simétrico al tratamiento de costo:
 * IVA_INCLUDED asume que `baseAmount` es el bruto (se extrae el neto);
 * IVA_ADDITIONAL asume que `baseAmount` es el neto (se añade el IVA encima).
 * ZERO_RATE/EXEMPT/UNKNOWN: neto === bruto, sin inventar una base fiscal
 * cuando taxTreatment es UNKNOWN (LP_ARCH_002 §5).
 */
function applySaleTax(baseAmount, taxTreatment, taxRate) {
  assert(TAX_TREATMENTS.includes(taxTreatment), `pricing.taxTreatment inválido: ${taxTreatment}`);
  const rate = taxRate ?? 0;
  switch (taxTreatment) {
    case 'IVA_INCLUDED':
      return { net: baseAmount / (1 + rate), gross: baseAmount, isUnknownTax: false };
    case 'IVA_ADDITIONAL':
      return { net: baseAmount, gross: baseAmount * (1 + rate), isUnknownTax: false };
    case 'ZERO_RATE':
    case 'EXEMPT':
      return { net: baseAmount, gross: baseAmount, isUnknownTax: false };
    case 'UNKNOWN':
      return { net: baseAmount, gross: baseAmount, isUnknownTax: true };
    default:
      throw new Error(`[pricingEngine] taxTreatment no soportado: ${taxTreatment}`);
  }
}

/**
 * Aplica amountBasis a un valor monetario declarado por el usuario.
 * PER_UNIT: el valor es "por unidad" y se multiplica por `quantity`.
 * TOTAL: el valor ya es el total, se usa tal cual.
 */
function resolveAmountByBasis(value, amountBasis, quantity) {
  assert(AMOUNT_BASIS.includes(amountBasis), `pricing.amountBasis inválido: ${amountBasis}`);
  if (amountBasis === 'PER_UNIT') {
    assert(typeof quantity === 'number' && Number.isFinite(quantity), 'quantity es requerido cuando amountBasis=PER_UNIT.');
    return value * quantity;
  }
  return value;
}

/**
 * Valida el objeto pricing contra el contrato LP-ARCH-002 / LP-ENG-001 §3-4:
 * - amountBasis requerido en PRICE_DIRECT, TARGET_PROFIT_AMOUNT, BUDGET_CEILING.
 * - amountBasis NO debe declararse en MARKUP_ON_COST (el input ya es %).
 * - BUDGET_CEILING debe declararse siempre como TOTAL (paridad legacy "Techo
 *   presupuestal", LP_ARCH_002 §A / LP-ENG-001 §3).
 * No infiere silenciosamente: cualquier violación lanza error explícito.
 */
function validatePricing(pricing) {
  assert(typeof pricing === 'object' && pricing !== null, 'pricing debe ser un objeto.');
  assert(PRICING_MODES.includes(pricing.mode), `pricing.mode inválido: ${pricing.mode}`);

  const requiresAmountBasis = pricing.mode !== 'MARKUP_ON_COST';
  if (requiresAmountBasis) {
    assert(
      pricing.amountBasis !== undefined && pricing.amountBasis !== null,
      `pricing.amountBasis es requerido para el modo ${pricing.mode}.`
    );
    assert(AMOUNT_BASIS.includes(pricing.amountBasis), `pricing.amountBasis inválido: ${pricing.amountBasis}`);
  } else {
    assert(
      pricing.amountBasis === undefined,
      'pricing.amountBasis no debe declararse para MARKUP_ON_COST (el input es un porcentaje, no un monto).'
    );
  }

  if (pricing.mode === 'BUDGET_CEILING') {
    assert(pricing.amountBasis === 'TOTAL', 'BUDGET_CEILING debe declararse siempre como amountBasis=TOTAL (paridad legacy "Techo presupuestal").');
  }

  assert(typeof pricing.value === 'number' && Number.isFinite(pricing.value), 'pricing.value debe ser un número.');
}

// ── Grupo de pricing (unidad mínima del motor) ──────────────────────────

/**
 * Calcula un "grupo de pricing": el conjunto mínimo de CostItems que
 * respaldan UNA decisión de precio. Este es el mismo primitivo, sin
 * importar si el llamador lo usa para representar una QuoteLine, una
 * QuoteSection/Partida con CONSOLIDATED_PRICING, o una Solution instance —
 * el motor no conoce esos objetos de UI (LP-ENG-001 §9).
 *
 * Un grupo con `pricing = null` es un grupo de "solo costo" (p. ej. una
 * fianza/retorno sin línea comercial propia): aporta costo al total, pero
 * venta = 0 para ese grupo — el `aggregateQuote` decide cómo combinarlo.
 *
 * @param {object} group
 * @param {number} [group.quantity] - requerido si algún costItem usa
 *   PER_UNIT o si pricing.amountBasis === 'PER_UNIT'.
 * @param {object[]} group.costItems
 * @param {object|null} group.pricing
 */
/**
 * Warnings deterministas de división entre cero (LP-ENG-001R §6), derivadas
 * de qué denominador resultó 0 — nunca Infinity/-Infinity/NaN.
 */
function zeroDenominatorWarnings(costoNet, ventaNet) {
  const warnings = [];
  if (costoNet === 0) warnings.push(ZERO_DENOMINATOR_WARNINGS.ZERO_COST);
  if (ventaNet === 0) warnings.push(ZERO_DENOMINATOR_WARNINGS.ZERO_SALE);
  return warnings;
}

export function computePricingGroup(group) {
  assert(typeof group === 'object' && group !== null, 'group debe ser un objeto.');
  assert(Array.isArray(group.costItems), 'group.costItems debe ser un arreglo.');

  const costItemResults = group.costItems.map((item) => computeCostItem(item));

  const costoNet = costItemResults.reduce((sum, c) => sum + c.net, 0);
  const costoGross = costItemResults.reduce((sum, c) => sum + c.gross, 0);
  const unknownCostAmount = costItemResults
    .filter((c) => c.isUnknownTax)
    .reduce((sum, c) => sum + c.net, 0);
  const documentationWarnings = costItemResults
    .map((c, i) => ({ index: i, documentationStatus: c.documentationStatus }))
    .filter((w) => w.documentationStatus !== 'DOCUMENTED');

  const groupCurrencies = costItemResults.map((c) => c.currency);
  if (group.pricing && group.pricing.currency) groupCurrencies.push(group.pricing.currency);
  const currency = assertSingleCurrency(groupCurrencies, 'un mismo grupo de pricing (costItems + pricing)');

  if (group.pricing === null || group.pricing === undefined) {
    // Grupo de solo costo: no hay decisión de precio asociada.
    return {
      costoNet,
      costoGross,
      ventaNet: 0,
      ventaGross: 0,
      utilidad: -costoNet,
      markupSobreCosto: safeDivide(-costoNet, costoNet),
      margenSobreVenta: safeDivide(-costoNet, 0), // venta=0 → null (determinista)
      unknownSaleAmount: 0,
      unknownCostAmount,
      documentationWarnings,
      isCostOnlyGroup: true,
      currency,
      warnings: zeroDenominatorWarnings(costoNet, 0),
    };
  }

  validatePricing(group.pricing);
  const { mode, amountBasis, value, taxTreatment, taxRate } = group.pricing;

  let baseAmount;
  switch (mode) {
    case 'PRICE_DIRECT':
    case 'BUDGET_CEILING':
      // El humano declara la venta directamente (o el techo, que es
      // funcionalmente la misma resolución: LP-ARCH-002 §A). La utilidad
      // resultante es siempre consecuencia, nunca input (golden G03).
      baseAmount = resolveAmountByBasis(value, amountBasis, group.quantity);
      break;
    case 'TARGET_PROFIT_AMOUNT': {
      const profit = resolveAmountByBasis(value, amountBasis, group.quantity);
      baseAmount = costoNet + profit;
      break;
    }
    case 'MARKUP_ON_COST':
      baseAmount = costoNet * (1 + value);
      break;
    default:
      throw new Error(`[pricingEngine] pricing.mode no soportado: ${mode}`);
  }

  const sale = applySaleTax(baseAmount, taxTreatment, taxRate);
  const ventaNet = sale.net;
  const ventaGross = sale.gross;
  // LP-ENG-001R §7: venta y costo pueden cruzarse — el motor NO ajusta el
  // precio, NO bloquea, NO "corrige" la operación. Utilidad/markup/margen
  // negativos son resultados legítimos que el usuario debe poder ver.
  const utilidad = ventaNet - costoNet;

  return {
    costoNet,
    costoGross,
    ventaNet,
    ventaGross,
    utilidad,
    markupSobreCosto: safeDivide(utilidad, costoNet),
    margenSobreVenta: safeDivide(utilidad, ventaNet),
    unknownSaleAmount: sale.isUnknownTax ? ventaNet : 0,
    unknownCostAmount,
    documentationWarnings,
    isCostOnlyGroup: false,
    currency,
    warnings: zeroDenominatorWarnings(costoNet, ventaNet),
  };
}

// ── Agregación a nivel Quote ─────────────────────────────────────────────

/**
 * Agrega uno o más resultados de `computePricingGroup` en las vistas
 * canónicas del motor (LP-ENG-001 §7):
 *   - OPERATING/PROFITABILITY (neto operacional real, incluye UNKNOWN
 *     completo — nunca se excluye un costo/venta por incertidumbre fiscal).
 *   - REFERENCE NET VIEW (mismas cifras netas, expuestas para el análisis de
 *     IVA referencial; señala incertidumbre sin alterar el operacional).
 *   - GROSS/DISBURSEMENT VIEW (desembolso, nunca presentado como utilidad
 *     fiscal).
 *   - TAX REFERENCE (IVA identificado de venta/costo, sobrante referencial,
 *     montos con tratamiento fiscal desconocido, advertencias de
 *     documentación).
 *
 * @param {object[]} groupResults - salidas de `computePricingGroup`.
 */
export function aggregateQuote(groupResults) {
  assert(Array.isArray(groupResults) && groupResults.length > 0, 'aggregateQuote requiere al menos un grupo.');

  const currency = assertSingleCurrency(groupResults.map((g) => g.currency ?? DEFAULT_CURRENCY), 'la cotización (todos los grupos deben compartir moneda)');

  const ventaNet = groupResults.reduce((sum, g) => sum + g.ventaNet, 0);
  const ventaGross = groupResults.reduce((sum, g) => sum + g.ventaGross, 0);
  const costoNet = groupResults.reduce((sum, g) => sum + g.costoNet, 0);
  const costoGross = groupResults.reduce((sum, g) => sum + g.costoGross, 0);
  // LP-ENG-001R §7: sin ajustar, bloquear ni corregir — una cotización cuyo
  // total de venta cae por debajo del costo total reporta utilidad negativa
  // tal cual, para que el usuario vea que está perdiendo dinero.
  const utilidadOperacional = ventaNet - costoNet;

  const unknownSaleAmount = groupResults.reduce((sum, g) => sum + g.unknownSaleAmount, 0);
  const unknownCostAmount = groupResults.reduce((sum, g) => sum + g.unknownCostAmount, 0);
  const documentationWarnings = groupResults.flatMap((g, groupIndex) =>
    g.documentationWarnings.map((w) => ({ groupIndex, ...w }))
  );

  const ivaVentaIdentificado = ventaGross - ventaNet;
  const ivaCostoIdentificado = costoGross - costoNet;
  const ivaSobranteReferencial = ivaVentaIdentificado - ivaCostoIdentificado;

  return {
    currency,
    operating: {
      ventaOperacional: ventaNet,
      costoOperacional: costoNet,
      utilidadOperacional,
      markupSobreCosto: safeDivide(utilidadOperacional, costoNet),
      margenSobreVenta: safeDivide(utilidadOperacional, ventaNet),
      warnings: zeroDenominatorWarnings(costoNet, ventaNet),
    },
    referenceNetView: {
      ventaNetaReferencial: ventaNet,
      costoNetoReferencial: costoNet,
      hasUncertainty: unknownSaleAmount !== 0 || unknownCostAmount !== 0,
    },
    grossView: {
      ventaGross,
      costoGross,
    },
    taxReference: {
      ivaVentaIdentificado,
      ivaCostoIdentificado,
      ivaSobranteReferencial,
      unknownTaxAmounts: {
        sale: unknownSaleAmount,
        cost: unknownCostAmount,
        total: unknownSaleAmount + unknownCostAmount,
      },
      documentationWarnings,
    },
  };
}

/**
 * Atajo: calcula uno o más grupos y los agrega en una sola llamada. Útil
 * para pruebas y para el consumidor que ya tiene los grupos en forma de
 * insumo canónico (costItems + pricing) y solo quiere el resultado de la
 * cotización completa.
 *
 * @param {object[]} groups - insumos de `computePricingGroup`.
 */
export function computeQuote(groups) {
  const groupResults = groups.map(computePricingGroup);
  return {
    groups: groupResults,
    quote: aggregateQuote(groupResults),
  };
}

/**
 * Envuelve un CostItem ya resuelto (`computeCostItem`) en la misma forma que
 * un grupo de solo costo de `computePricingGroup` — para que
 * `aggregateQuote` pueda combinarlo con el resto de los grupos sin conocer
 * la diferencia.
 */
function costOnlyGroupResultFromCostItem(costResult, index) {
  const costoNet = costResult.net;
  const costoGross = costResult.gross;
  return {
    costoNet,
    costoGross,
    ventaNet: 0,
    ventaGross: 0,
    utilidad: -costoNet,
    markupSobreCosto: safeDivide(-costoNet, costoNet),
    margenSobreVenta: safeDivide(-costoNet, 0),
    unknownSaleAmount: 0,
    unknownCostAmount: costResult.isUnknownTax ? costoNet : 0,
    documentationWarnings: costResult.documentationStatus !== 'DOCUMENTED'
      ? [{ index, documentationStatus: costResult.documentationStatus }]
      : [],
    isCostOnlyGroup: true,
    currency: costResult.currency,
    warnings: zeroDenominatorWarnings(costoNet, 0),
  };
}

/**
 * Calcula una cotización completa cuando existen costos derivados de la
 * venta (LP-ENG-001R §1-2: retornos/fianzas legacy con base "% sobre venta
 * c/IVA", "% sobre venta s/IVA", "Monto fijo total" o "Monto fijo por
 * unidad"). Hallazgo confirmado leyendo calc.js (read-only, sin
 * modificarlo): estos costos se calculan DESPUÉS de que la venta de la
 * cotización ya quedó fija — nunca la realimentan. Por eso este cálculo
 * ocurre en dos pasadas:
 *
 *   1. Se calculan todos los `groups` normalmente (exactamente como
 *      `computeQuote`) y se obtiene la venta ya determinada (neta y bruta)
 *      de TODA la cotización.
 *   2. Cada `saleBasedCostItems` (costCalculationMode PERCENT_OF_SALE_NET /
 *      PERCENT_OF_SALE_GROSS, o DIRECT_AMOUNT para "Monto fijo total/por
 *      unidad") se resuelve usando esa venta ya fija como referencia, y se
 *      suma al costo total — sin volver a tocar la venta.
 *
 * @param {object} input
 * @param {object[]} input.groups - insumos de `computePricingGroup`.
 * @param {object[]} [input.saleBasedCostItems] - insumos de `computeCostItem`
 *   (costCalculationMode DIRECT_AMOUNT, PERCENT_OF_SALE_NET o
 *   PERCENT_OF_SALE_GROSS); PERCENT_OF_SALE_* no requieren `amount` (usan
 *   `rate`) ni participan en la determinación de la venta.
 */
export function computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems = [] }) {
  assert(Array.isArray(groups) && groups.length > 0, 'computeQuoteWithSaleBasedCosts requiere al menos un group.');
  assert(Array.isArray(saleBasedCostItems), 'saleBasedCostItems debe ser un arreglo.');

  const groupResults = groups.map(computePricingGroup);

  const ventaNetReference = groupResults.reduce((sum, g) => sum + g.ventaNet, 0);
  const ventaGrossReference = groupResults.reduce((sum, g) => sum + g.ventaGross, 0);
  const context = { ventaNetReference, ventaGrossReference };

  const saleBasedResults = saleBasedCostItems.map((item, index) =>
    costOnlyGroupResultFromCostItem(computeCostItem(item, context), index)
  );

  const allGroupResults = [...groupResults, ...saleBasedResults];

  return {
    groups: groupResults,
    saleBasedCosts: saleBasedResults,
    quote: aggregateQuote(allGroupResults),
  };
}
