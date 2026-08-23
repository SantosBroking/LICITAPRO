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

// ── CostItem ──────────────────────────────────────────────────────────────

/**
 * Calcula el neto/bruto de un CostItem individual.
 *
 * CostItem es SIEMPRE información interna de cálculo (LP-ENG-001 §5): su
 * `amount` nunca se convierte en dato de presentación al cliente por el
 * solo hecho de pasar por aquí. `costRole` es metadato para capas
 * superiores (Editor/PDF) — no cambia la aritmética del motor.
 *
 * Regla UNKNOWN (LP-ENG-001 §6): si `taxTreatment === 'UNKNOWN'`, el monto
 * completo entra al costo operacional; el motor NO asume IVA 0%, exento, ni
 * ningún tratamiento — solo señala incertidumbre.
 *
 * @param {object} item
 * @param {number} item.amount
 * @param {number} [item.quantity=1]
 * @param {'PER_UNIT'|'PER_LOT'|'FIXED_TOTAL'} item.quantityMode
 * @param {'LINE_BACKING'|'INTERNAL_ONLY'} [item.costRole]
 * @param {'IVA_INCLUDED'|'IVA_ADDITIONAL'|'ZERO_RATE'|'EXEMPT'|'UNKNOWN'} item.taxTreatment
 * @param {number} [item.taxRate]
 * @param {'DOCUMENTED'|'NOT_DOCUMENTED'|'UNCONFIRMED'} [item.documentationStatus]
 */
export function computeCostItem(item) {
  assert(typeof item === 'object' && item !== null, 'CostItem debe ser un objeto.');
  assert(typeof item.amount === 'number' && Number.isFinite(item.amount), 'CostItem.amount debe ser un número.');
  assert(QUANTITY_MODES.includes(item.quantityMode), `CostItem.quantityMode inválido: ${item.quantityMode}`);
  assert(TAX_TREATMENTS.includes(item.taxTreatment), `CostItem.taxTreatment inválido: ${item.taxTreatment}`);

  const quantity = item.quantity ?? 1;
  const rate = item.taxRate ?? 0;
  const isUnknownTax = item.taxTreatment === 'UNKNOWN';

  // Monto base (antes de multiplicar por cantidad): interpretación según
  // taxTreatment. IVA_INCLUDED asume que `amount` ya es el bruto (con IVA).
  // El resto (IVA_ADDITIONAL, ZERO_RATE, EXEMPT, UNKNOWN) asume que `amount`
  // es ya el monto operacional/neto tal cual fue capturado.
  let unitNet;
  let unitGross;
  switch (item.taxTreatment) {
    case 'IVA_INCLUDED':
      unitNet = item.amount / (1 + rate);
      unitGross = item.amount;
      break;
    case 'IVA_ADDITIONAL':
      unitNet = item.amount;
      unitGross = item.amount * (1 + rate);
      break;
    case 'ZERO_RATE':
    case 'EXEMPT':
    case 'UNKNOWN':
      // PAGO EN EFECTIVO != IVA 0%: UNKNOWN nunca se trata como ZERO_RATE/
      // EXEMPT. Aquí ambos casos coinciden numéricamente (net === gross,
      // sin IVA que sumar) pero se preservan como ramas separadas para que
      // el significado quede explícito en el código, no solo en el dato.
      unitNet = item.amount;
      unitGross = item.amount;
      break;
    default:
      throw new Error(`[pricingEngine] taxTreatment no soportado: ${item.taxTreatment}`);
  }

  // FIXED_TOTAL / PER_LOT: el monto ya es el total del concepto — no se
  // multiplica por `quantity` (LP-ENG-001 §9 / golden G06: "Monto fijo
  // total" se aplica una sola vez, nunca por unidad).
  const multiplier = item.quantityMode === 'PER_UNIT' ? quantity : 1;

  const net = unitNet * multiplier;
  const gross = unitGross * multiplier;

  return {
    net,
    gross,
    costRole: item.costRole ?? 'LINE_BACKING',
    taxTreatment: item.taxTreatment,
    documentationStatus: item.documentationStatus ?? 'UNCONFIRMED',
    isUnknownTax,
    isUndocumented: (item.documentationStatus ?? 'UNCONFIRMED') !== 'DOCUMENTED',
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
export function computePricingGroup(group) {
  assert(typeof group === 'object' && group !== null, 'group debe ser un objeto.');
  assert(Array.isArray(group.costItems), 'group.costItems debe ser un arreglo.');

  const costItemResults = group.costItems.map(computeCostItem);

  const costoNet = costItemResults.reduce((sum, c) => sum + c.net, 0);
  const costoGross = costItemResults.reduce((sum, c) => sum + c.gross, 0);
  const unknownCostAmount = costItemResults
    .filter((c) => c.isUnknownTax)
    .reduce((sum, c) => sum + c.net, 0);
  const documentationWarnings = costItemResults
    .map((c, i) => ({ index: i, documentationStatus: c.documentationStatus }))
    .filter((w) => w.documentationStatus !== 'DOCUMENTED');

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

  const ventaNet = groupResults.reduce((sum, g) => sum + g.ventaNet, 0);
  const ventaGross = groupResults.reduce((sum, g) => sum + g.ventaGross, 0);
  const costoNet = groupResults.reduce((sum, g) => sum + g.costoNet, 0);
  const costoGross = groupResults.reduce((sum, g) => sum + g.costoGross, 0);
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
    operating: {
      ventaOperacional: ventaNet,
      costoOperacional: costoNet,
      utilidadOperacional,
      markupSobreCosto: safeDivide(utilidadOperacional, costoNet),
      margenSobreVenta: safeDivide(utilidadOperacional, ventaNet),
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
