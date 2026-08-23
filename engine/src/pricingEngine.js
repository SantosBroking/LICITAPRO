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

// LP-ARCH-003 v1.2 / LP-ENG-002: solo aplica dentro de
// pricing.mode = TARGET_PROFIT_AMOUNT. Default del motor cuando se omite:
// BASE_COST_BEFORE_SALE_BASED_COSTS (comportamiento idéntico al existente,
// byte-semántico — ver LP-ARCH-003 v1.2 §1/§5).
export const PROFIT_TARGET_BASIS = Object.freeze([
  'BASE_COST_BEFORE_SALE_BASED_COSTS',
  'FINAL_AFTER_KNOWN_COSTS',
]);

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

// LP-ARCH-003 v1.2 §2.4/§4/§9 — LP-ENG-002: nombres deterministas para los
// rechazos/advertencias de `profitTargetBasis=FINAL_AFTER_KNOWN_COSTS`. Nunca
// NaN/Infinity/-Infinity — ver `resolveFinalAfterKnownCostsVenta` y
// `computeQuoteCanonical`.
export const TARGET_PROFIT_BASIS_ERRORS = Object.freeze({
  IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION: 'IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION',
  FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS: 'FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS',
});

export const TARGET_PROFIT_BASIS_WARNINGS = Object.freeze({
  DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE: 'DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE',
});

// LP-ENG-002S — QA Control Tower: cierre global del invariant "ningún
// resultado público del motor puede contener NaN/Infinity/-Infinity".
// LP-ENG-002R cerró inputs individualmente no finitos (taxRate, quantity);
// esta capa cierra el caso restante: inputs individualmente finitos que
// producen OVERFLOW aritmético (multiplicaciones/sumas que exceden
// Number.MAX_VALUE). Código genérico único para cualquier resultado
// financiero no representable, sin importar en qué operación ocurrió.
export const NUMERIC_ERRORS = Object.freeze({
  NON_FINITE_FINANCIAL_RESULT: 'NON_FINITE_FINANCIAL_RESULT',
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
 *
 * LP-ENG-002S: además, si numerador y denominador son ambos finitos pero el
 * cociente matemático resulta no representable (overflow, ej. un numerador
 * astronómico entre un denominador diminuto), también regresa `null` en vez
 * de Infinity/-Infinity/NaN. `null` conserva su significado ya establecido
 * ("indicador no calculable de forma representable") — no se introduce una
 * conclusión financiera nueva, solo se cierra el caso de overflow bajo el
 * mismo indicador que ya existía para división entre cero.
 */
function safeDivide(numerator, denominator) {
  if (denominator === 0) return null;
  const result = numerator / denominator;
  if (!Number.isFinite(result)) return null;
  return result;
}

// LP-ENG-002R — QA Control Tower: hardening de inputs no finitos. El motor
// promete NUNCA producir NaN/Infinity/-Infinity; esa promesa requiere que
// ningún camino aritmético reciba un taxRate no finito o negativo sin
// validar. Helper único y compartido — no se duplica la regla por ubicación.
// Semántica: omitido (undefined/null) conserva el comportamiento actual → 0.
// Si se declara, debe ser number finito y >= 0; si no, rechazo determinista.
function assertValidTaxRate(taxRate, label) {
  if (taxRate === undefined || taxRate === null) return 0;
  assert(
    typeof taxRate === 'number' && Number.isFinite(taxRate) && taxRate >= 0,
    `${label} debe ser un número finito >= 0 cuando se declara (recibido: ${taxRate}).`
  );
  return taxRate;
}

// LP-ENG-002R — mismo principio para CostItem.quantity cuando
// quantityMode=PER_UNIT (único caso donde `quantity` participa en la
// aritmética del resultado — LP-ENG-001 §9 / golden G06). Omitido conserva
// el default actual (1). No introduce reglas nuevas sobre cantidades
// negativas — exclusivamente hardening de NaN/Infinity/-Infinity.
function assertFiniteQuantity(quantity, label) {
  if (quantity === undefined || quantity === null) return 1;
  assert(
    typeof quantity === 'number' && Number.isFinite(quantity),
    `${label} debe ser un número finito cuando se declara (recibido: ${quantity}).`
  );
  return quantity;
}

// LP-ENG-002S — helper puro compartido para el cierre global de finitud.
// A diferencia de assertValidTaxRate/assertFiniteQuantity (que validan
// INPUTS antes de calcular), este valida un RESULTADO ya calculado — cierra
// el caso donde cada input individual era finito pero la operación
// (multiplicación, suma, división) produjo overflow. NO ajusta, NO clampa,
// NO redondea: solo rechaza de forma determinista con un código genérico
// único, reutilizable en cualquier punto del motor donde se produzca un
// número que vaya a formar parte de un resultado público.
function assertFiniteFinancialResult(value, label) {
  assert(
    typeof value === 'number' && Number.isFinite(value),
    `${NUMERIC_ERRORS.NON_FINITE_FINANCIAL_RESULT}: ${label} resultó no finito (${value}) — overflow aritmético o configuración numéricamente no representable. El motor nunca produce NaN/Infinity/-Infinity en un resultado público.`
  );
  return value;
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
    // FIXED_TOTAL / PER_LOT: el monto ya es el total del concepto — no se
    // multiplica por `quantity` (LP-ENG-001 §9 / golden G06: "Monto fijo
    // total" se aplica una sola vez, nunca por unidad); `quantity` no
    // participa en la aritmética para estos modos, por lo que no se valida
    // aquí (LP-ENG-002R: hardening exclusivo de PER_UNIT, sin cambiar la
    // semántica de PER_LOT/FIXED_TOTAL).
    const multiplier = item.quantityMode === 'PER_UNIT'
      ? assertFiniteQuantity(item.quantity, 'CostItem.quantity (quantityMode=PER_UNIT)')
      : 1;
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
  const rate = assertValidTaxRate(item.taxRate, 'CostItem.taxRate');
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

  // LP-ENG-002S: cierra overflow de `amount * quantity`, `baseAmount * tax
  // factor` y cualquier otra multiplicación de costo — inputs finitos que
  // producen un resultado no representable se rechazan aquí, antes de
  // retornar.
  assertFiniteFinancialResult(net, 'CostItem.net');
  assertFiniteFinancialResult(gross, 'CostItem.gross');

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
  const rate = assertValidTaxRate(taxRate, 'pricing.taxRate');
  let result;
  switch (taxTreatment) {
    case 'IVA_INCLUDED':
      result = { net: baseAmount / (1 + rate), gross: baseAmount, isUnknownTax: false };
      break;
    case 'IVA_ADDITIONAL':
      result = { net: baseAmount, gross: baseAmount * (1 + rate), isUnknownTax: false };
      break;
    case 'ZERO_RATE':
    case 'EXEMPT':
      result = { net: baseAmount, gross: baseAmount, isUnknownTax: false };
      break;
    case 'UNKNOWN':
      result = { net: baseAmount, gross: baseAmount, isUnknownTax: true };
      break;
    default:
      throw new Error(`[pricingEngine] taxTreatment no soportado: ${taxTreatment}`);
  }
  // LP-ENG-002S: cierra overflow del tipo PRICE_DIRECT value=1e308 +
  // IVA_ADDITIONAL taxRate=1 (ventaGross = 1e308*2) — sin cambiar la
  // interpretación de IVA_INCLUDED/IVA_ADDITIONAL.
  assertFiniteFinancialResult(result.net, 'pricing venta net');
  assertFiniteFinancialResult(result.gross, 'pricing venta gross');
  return result;
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

  // LP-ARCH-003 v1.2 §1 / LP-ENG-002: profitTargetBasis solo existe dentro de
  // TARGET_PROFIT_AMOUNT. Si se omite, el motor asume
  // BASE_COST_BEFORE_SALE_BASED_COSTS (comportamiento actual, sin cambio) —
  // ver la resolución del default en `computePricingGroup`, no aquí.
  if (pricing.profitTargetBasis !== undefined) {
    assert(
      pricing.mode === 'TARGET_PROFIT_AMOUNT',
      'pricing.profitTargetBasis solo puede declararse cuando pricing.mode = TARGET_PROFIT_AMOUNT.'
    );
    assert(
      PROFIT_TARGET_BASIS.includes(pricing.profitTargetBasis),
      `pricing.profitTargetBasis inválido: ${pricing.profitTargetBasis}`
    );
  }
}

// ── FINAL_AFTER_KNOWN_COSTS (LP-ARCH-003 v1.2 / LP-ENG-002) ─────────────

/**
 * Dado un neto S ya resuelto algebraicamente (no un monto declarado por un
 * humano), calcula el bruto correspondiente. Deliberadamente DISTINTO de
 * `applySaleTax`: `applySaleTax` recibe un monto declarado y decide, según
 * taxTreatment, si ESE monto es el neto o el bruto (IVA_INCLUDED divide para
 * extraer el neto). Aquí S ya ES el neto — nunca se vuelve a dividir entre
 * (1+rate) (LP-ARCH-003 v1.2 §3 "CUIDADO CRÍTICO — SALE TAX").
 */
function grossFromResolvedNet(S, taxTreatment, taxRate) {
  assert(TAX_TREATMENTS.includes(taxTreatment), `pricing.taxTreatment inválido: ${taxTreatment}`);
  const rate = assertValidTaxRate(taxRate, 'pricing.taxRate (FINAL_AFTER_KNOWN_COSTS)');
  switch (taxTreatment) {
    case 'IVA_INCLUDED':
    case 'IVA_ADDITIONAL':
      return S * (1 + rate);
    case 'ZERO_RATE':
    case 'EXEMPT':
    case 'UNKNOWN':
      // UNKNOWN preserva incertidumbre fiscal vía `isUnknownTax`/
      // `unknownSaleAmount` en el llamador — aquí solo se define neto=bruto,
      // sin inventar una tasa (LP_ARCH_002 §5).
      return S;
    default:
      throw new Error(`[pricingEngine] taxTreatment no soportado: ${taxTreatment}`);
  }
}

/**
 * Deriva (a_i, b_i) de un `knownSaleBasedCosts[i]` tal que
 * `cost_i_net = a_i·S + b_i` (LP-ARCH-003 v1.2 §3.2). Reutiliza
 * `resolveCostBase` para DIRECT_AMOUNT (mismo cómputo que un CostItem normal,
 * sin depender de S) — sin duplicar esa lógica.
 *
 * @param {object} item - mismo vocabulario que CostItem (costCalculationMode,
 *   rate|amount, taxTreatment, taxRate, quantity, quantityMode...).
 * @param {string} saleTaxTreatment - taxTreatment de VENTA del grupo (T_sale).
 * @param {number} saleTaxRate - tasa de venta del grupo (r_sale).
 */
function deriveSaleBasedCostCoefficients(item, saleTaxTreatment, saleTaxRate) {
  assert(typeof item === 'object' && item !== null, 'knownSaleBasedCosts[i] debe ser un objeto.');
  const mode = item.costCalculationMode ?? 'DIRECT_AMOUNT';
  assert(COST_CALCULATION_MODES.includes(mode), `knownSaleBasedCosts[i].costCalculationMode inválido: ${mode}`);
  assert(TAX_TREATMENTS.includes(item.taxTreatment), `knownSaleBasedCosts[i].taxTreatment inválido: ${item.taxTreatment}`);
  const r_i = assertValidTaxRate(item.taxRate, 'knownSaleBasedCosts[i].taxRate');

  if (mode === 'DIRECT_AMOUNT') {
    // F_i: mismo monto fijo que produciría computeCostItem para este item,
    // ya resuelto por quantityMode/quantity (LP-ARCH-003 v1.2 §3.2, caso
    // DIRECT_AMOUNT) — no depende de S, por eso no participa en a_i.
    const { baseAmount, multiplier } = resolveCostBase(item, {});
    const F_i = baseAmount * multiplier;
    if (item.taxTreatment === 'IVA_INCLUDED') return { a: 0, b: F_i / (1 + r_i) };
    return { a: 0, b: F_i };
  }

  assert(typeof item.rate === 'number' && Number.isFinite(item.rate), `knownSaleBasedCosts[i].rate debe ser un número cuando costCalculationMode=${mode}.`);
  const p_i = item.rate;

  let k_i;
  if (mode === 'PERCENT_OF_SALE_NET') {
    k_i = p_i;
  } else {
    // PERCENT_OF_SALE_GROSS: la base es p_i · grossFromNet(S, T_sale, r_sale).
    const saleMultiplier = (saleTaxTreatment === 'IVA_INCLUDED' || saleTaxTreatment === 'IVA_ADDITIONAL')
      ? (1 + assertValidTaxRate(saleTaxRate, 'pricing.taxRate (venta, para PERCENT_OF_SALE_GROSS)'))
      : 1;
    k_i = p_i * saleMultiplier;
  }

  if (item.taxTreatment === 'IVA_INCLUDED') return { a: k_i / (1 + r_i), b: 0 };
  return { a: k_i, b: 0 };
}

/**
 * Resuelve algebraicamente S (venta neta) para
 * `profitTargetBasis=FINAL_AFTER_KNOWN_COSTS` (LP-ARCH-003 v1.2 §3.3):
 *
 *   S = (C_base + Σb_i + TargetProfit) / (1 − Σa_i)
 *
 * Nunca regresa NaN/Infinity/-Infinity: si el denominador es ~0, rechaza
 * explícitamente (`IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION`); si es negativo,
 * SÍ calcula pero adjunta `DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE`.
 * No redondea internamente (LP-ENG-002 §2).
 */
function resolveFinalAfterKnownCostsVenta({ costoBaseNet, targetProfit, knownSaleBasedCosts, saleTaxTreatment, saleTaxRate }) {
  const coefficients = knownSaleBasedCosts.map((item) => deriveSaleBasedCostCoefficients(item, saleTaxTreatment, saleTaxRate));
  const sumA = coefficients.reduce((sum, c) => sum + c.a, 0);
  const sumB = coefficients.reduce((sum, c) => sum + c.b, 0);
  const denominator = 1 - sumA;

  // LP-ENG-002R — QA Control Tower: defensa final antes de dividir. Un
  // costItem/knownSaleBasedCost con taxRate/quantity ya validados no debería
  // poder producir un coeficiente no finito, pero esta capa lo cierra de
  // forma determinista en vez de asumirlo — cero confianza implícita.
  assert(
    Number.isFinite(sumA) && Number.isFinite(sumB) && Number.isFinite(denominator),
    `${TARGET_PROFIT_BASIS_ERRORS.IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION}: los coeficientes derivados de knownSaleBasedCosts no son finitos (Σa_i=${sumA}, Σb_i=${sumB}) — configuración numéricamente no representable. No se calculó S.`
  );

  const warnings = [];
  if (Math.abs(denominator) <= 1e-12) {
    throw new Error(
      `[pricingEngine] ${TARGET_PROFIT_BASIS_ERRORS.IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION}: Σa_i=${sumA} hace que (1-Σa_i)≈0 — no existe una venta única que resuelva la ecuación. No se calculó S.`
    );
  }
  if (denominator < 0) {
    warnings.push(TARGET_PROFIT_BASIS_WARNINGS.DEGENERATE_SALE_COST_COEFFICIENT_SUM_EXCEEDS_ONE);
  }

  const S = (costoBaseNet + sumB + targetProfit) / denominator;

  // Overflow/config numéricamente no representable: nunca se devuelve un S
  // no finito, aunque sumA/sumB/denominator individualmente sí lo fueran.
  assert(
    Number.isFinite(S),
    `${TARGET_PROFIT_BASIS_ERRORS.IMPOSSIBLE_TARGET_PROFIT_CONFIGURATION}: S resultó no finito (overflow o configuración numéricamente no representable). No se produce un resultado no finito.`
  );

  return { S, sumA, sumB, warnings };
}

/**
 * Calcula un grupo de pricing completo cuando
 * `pricing.mode=TARGET_PROFIT_AMOUNT` y
 * `pricing.profitTargetBasis=FINAL_AFTER_KNOWN_COSTS` (LP-ARCH-003 v1.2).
 * Reemplaza el flujo común baseAmount→applySaleTax→utilidad de
 * `computePricingGroup` para este caso específico, porque aquí S se resuelve
 * primero y los `knownSaleBasedCosts` deben integrarse al costo/venta final
 * del grupo (LP-ENG-002 §4) — nunca quedan fuera del resultado económico.
 *
 * @param {object} params
 * @param {object} params.group - el group original (para leer
 *   `knownSaleBasedCosts` y `quantity`).
 * @param {number} params.costoNetBase - costo neto de `group.costItems`
 *   (idéntico a lo que ya calcula `computePricingGroup`, sin cambio).
 * @param {number} params.costoGrossBase
 * @param {number} params.unknownCostAmountBase
 * @param {object[]} params.documentationWarningsBase
 * @param {string} params.currencyBase - moneda ya validada de costItems+pricing.
 * @param {string} params.taxTreatment - taxTreatment de VENTA del grupo.
 * @param {number} [params.taxRate]
 * @param {string} params.amountBasis
 * @param {number} params.value - la ganancia objetivo declarada (antes de amountBasis).
 */
function computeFinalAfterKnownCostsGroup({
  group,
  costoNetBase,
  costoGrossBase,
  unknownCostAmountBase,
  documentationWarningsBase,
  currencyBase,
  taxTreatment,
  taxRate,
  amountBasis,
  value,
}) {
  const knownSaleBasedCosts = group.knownSaleBasedCosts ?? [];
  assert(Array.isArray(knownSaleBasedCosts), 'group.knownSaleBasedCosts debe ser un arreglo.');

  const targetProfit = resolveAmountByBasis(value, amountBasis, group.quantity);

  const { S, warnings: denominatorWarnings } = resolveFinalAfterKnownCostsVenta({
    costoBaseNet: costoNetBase,
    targetProfit,
    knownSaleBasedCosts,
    saleTaxTreatment: taxTreatment,
    saleTaxRate: taxRate ?? 0,
  });

  const ventaNet = S;
  const ventaGross = grossFromResolvedNet(S, taxTreatment, taxRate);
  // LP-ENG-002R: defensa final — S ya es finita (garantizado arriba), pero
  // grossFromResolvedNet multiplica por (1+rate); se cierra aquí también
  // antes de producir el resultado económico del grupo.
  assertFiniteFinancialResult(ventaGross, 'FINAL_AFTER_KNOWN_COSTS ventaGross');
  const saleIsUnknownTax = taxTreatment === 'UNKNOWN';

  // Los knownSaleBasedCosts reales se calculan CONTRA la S/ventaGross ya
  // resueltas (LP-ENG-002 §4) — se reutiliza `computeCostItem` tal cual
  // (mismo helper que ya resuelve PERCENT_OF_SALE_NET/GROSS/DIRECT_AMOUNT),
  // sin duplicar la lógica fiscal.
  const context = { ventaNetReference: ventaNet, ventaGrossReference: ventaGross };
  const knownCostResults = knownSaleBasedCosts.map((item) => computeCostItem(item, context));

  const currency = assertSingleCurrency(
    [currencyBase, ...knownCostResults.map((c) => c.currency)],
    'un grupo FINAL_AFTER_KNOWN_COSTS (costItems base + knownSaleBasedCosts, misma moneda)'
  );

  const knownCostNet = knownCostResults.reduce((sum, c) => sum + c.net, 0);
  const knownCostGross = knownCostResults.reduce((sum, c) => sum + c.gross, 0);
  const knownCostUnknown = knownCostResults
    .filter((c) => c.isUnknownTax)
    .reduce((sum, c) => sum + c.net, 0);
  const knownCostDocumentationWarnings = knownCostResults
    .map((c, index) => ({ index, documentationStatus: c.documentationStatus, source: 'knownSaleBasedCosts' }))
    .filter((w) => w.documentationStatus !== 'DOCUMENTED');

  // LP-ENG-002S §6: cierra el caso donde S/ventaGross son finitas pero un
  // knownSaleBasedCost individual (ya validado como finito por
  // computeCostItem) produce, al sumarse, un agregado no representable.
  assertFiniteFinancialResult(knownCostNet, 'FINAL_AFTER_KNOWN_COSTS knownCostNet');
  assertFiniteFinancialResult(knownCostGross, 'FINAL_AFTER_KNOWN_COSTS knownCostGross');

  // Costo final del grupo = costo base + knownSaleBasedCosts (LP-ENG-002 §4)
  // — estos costos SÍ forman parte del resultado económico del grupo, a
  // diferencia de los saleBasedCostItems de alcance-cotización clásicos.
  const costoNet = costoNetBase + knownCostNet;
  const costoGross = costoGrossBase + knownCostGross;
  const unknownCostAmount = unknownCostAmountBase + knownCostUnknown;
  const documentationWarnings = [...documentationWarningsBase, ...knownCostDocumentationWarnings];

  const utilidad = ventaNet - costoNet;

  assertFiniteFinancialResult(costoNet, 'FINAL_AFTER_KNOWN_COSTS costoNet');
  assertFiniteFinancialResult(costoGross, 'FINAL_AFTER_KNOWN_COSTS costoGross');
  assertFiniteFinancialResult(unknownCostAmount, 'FINAL_AFTER_KNOWN_COSTS unknownCostAmount');
  assertFiniteFinancialResult(utilidad, 'FINAL_AFTER_KNOWN_COSTS utilidad');

  return {
    costoNet,
    costoGross,
    ventaNet,
    ventaGross,
    utilidad,
    markupSobreCosto: safeDivide(utilidad, costoNet),
    margenSobreVenta: safeDivide(utilidad, ventaNet),
    unknownSaleAmount: saleIsUnknownTax ? ventaNet : 0,
    unknownCostAmount,
    documentationWarnings,
    isCostOnlyGroup: false,
    currency,
    warnings: [...zeroDenominatorWarnings(costoNet, ventaNet), ...denominatorWarnings],
    profitTargetBasis: 'FINAL_AFTER_KNOWN_COSTS',
    targetProfitRequested: targetProfit,
  };
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
    // LP-ENG-002S §5: asegurar finitud antes de retornar (markup/margen ya
    // pasan por safeDivide, que devuelve null en vez de no-finito).
    assertFiniteFinancialResult(costoNet, 'costoNet');
    assertFiniteFinancialResult(costoGross, 'costoGross');
    assertFiniteFinancialResult(-costoNet, 'utilidad (grupo de solo costo)');
    assertFiniteFinancialResult(unknownCostAmount, 'unknownCostAmount');
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
  const { mode, amountBasis, value, taxTreatment, taxRate, profitTargetBasis } = group.pricing;

  // LP-ARCH-003 v1.2 / LP-ENG-002: profitTargetBasis solo existe dentro de
  // TARGET_PROFIT_AMOUNT; default del motor cuando se omite:
  // BASE_COST_BEFORE_SALE_BASED_COSTS (preserva byte-semánticamente el
  // comportamiento actual para todo input existente — nunca entra a esta
  // rama si el campo se omite o es explícitamente BASE_COST_BEFORE_SALE_BASED_COSTS).
  if (mode === 'TARGET_PROFIT_AMOUNT' && (profitTargetBasis ?? 'BASE_COST_BEFORE_SALE_BASED_COSTS') === 'FINAL_AFTER_KNOWN_COSTS') {
    return computeFinalAfterKnownCostsGroup({
      group,
      costoNetBase: costoNet,
      costoGrossBase: costoGross,
      unknownCostAmountBase: unknownCostAmount,
      documentationWarningsBase: documentationWarnings,
      currencyBase: currency,
      taxTreatment,
      taxRate,
      amountBasis,
      value,
    });
  }

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
      // Rama BASE_COST_BEFORE_SALE_BASED_COSTS (default u omitido) — sin
      // cambio respecto a LP-ENG-001/001R: venta = costo base + ganancia
      // objetivo; los costos derivados de venta se calculan aparte, después
      // (computeQuoteWithSaleBasedCosts), y pueden erosionar esta utilidad.
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
  const unknownSaleAmount = sale.isUnknownTax ? ventaNet : 0;

  // LP-ENG-002S §5: cierre global — costoNet/costoGross ya se validaron por
  // CostItem (computeCostItem); ventaNet/ventaGross ya se validaron en
  // applySaleTax. Aquí se cierra la combinación (utilidad = resta de dos
  // valores finitos, siempre finita — se valida igual, sin asumirlo).
  assertFiniteFinancialResult(costoNet, 'costoNet');
  assertFiniteFinancialResult(costoGross, 'costoGross');
  assertFiniteFinancialResult(ventaNet, 'ventaNet');
  assertFiniteFinancialResult(ventaGross, 'ventaGross');
  assertFiniteFinancialResult(utilidad, 'utilidad');
  assertFiniteFinancialResult(unknownSaleAmount, 'unknownSaleAmount');
  assertFiniteFinancialResult(unknownCostAmount, 'unknownCostAmount');

  return {
    costoNet,
    costoGross,
    ventaNet,
    ventaGross,
    utilidad,
    markupSobreCosto: safeDivide(utilidad, costoNet),
    margenSobreVenta: safeDivide(utilidad, ventaNet),
    unknownSaleAmount,
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

  // LP-ENG-002S §7: sumar múltiples grupos individualmente finitos también
  // puede hacer overflow. Se cierra ANTES de retornar — no se produce una
  // cotización parcialmente válida con algún campo no finito.
  assertFiniteFinancialResult(ventaNet, 'aggregateQuote ventaNet');
  assertFiniteFinancialResult(ventaGross, 'aggregateQuote ventaGross');
  assertFiniteFinancialResult(costoNet, 'aggregateQuote costoNet');
  assertFiniteFinancialResult(costoGross, 'aggregateQuote costoGross');
  assertFiniteFinancialResult(utilidadOperacional, 'aggregateQuote utilidadOperacional');
  assertFiniteFinancialResult(unknownSaleAmount, 'aggregateQuote unknownSaleAmount');
  assertFiniteFinancialResult(unknownCostAmount, 'aggregateQuote unknownCostAmount');
  assertFiniteFinancialResult(ivaVentaIdentificado, 'aggregateQuote ivaVentaIdentificado');
  assertFiniteFinancialResult(ivaCostoIdentificado, 'aggregateQuote ivaCostoIdentificado');
  assertFiniteFinancialResult(ivaSobranteReferencial, 'aggregateQuote ivaSobranteReferencial');

  // LP-ENG-002T — QA final Control Tower: unknownSaleAmount y
  // unknownCostAmount ya se validaron finitos arriba, pero su SUMA
  // (unknownTaxAmounts.total) es un campo público derivado propio que no se
  // validaba — la misma clase de fuga que §7 ya cierra para el resto de
  // agregados. Se calcula explícitamente y se valida antes de usarse, en
  // vez de inlinearla directo en el objeto de retorno.
  const unknownTaxTotal = unknownSaleAmount + unknownCostAmount;
  assertFiniteFinancialResult(unknownTaxTotal, 'aggregateQuote unknownTaxAmounts.total');

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
        total: unknownTaxTotal,
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

  // LP-ENG-002S §8: cada g.ventaNet/g.ventaGross ya es finito (garantizado
  // por computePricingGroup), pero la SUMA de todos los grupos puede hacer
  // overflow. Se cierra aquí, ANTES de usarlas como referencia para los
  // costos derivados de venta — un overflow en la referencia nunca debe
  // propagarse silenciosamente a PERCENT_OF_SALE_NET/GROSS.
  assertFiniteFinancialResult(ventaNetReference, 'computeQuoteWithSaleBasedCosts ventaNetReference');
  assertFiniteFinancialResult(ventaGrossReference, 'computeQuoteWithSaleBasedCosts ventaGrossReference');

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

// ── Orquestador canónico de nivel cotización (LP-ARCH-003 v1.2 §2.5/§9, LP-ENG-002) ──

/**
 * Único entry point puro de nivel cotización que decide, sin heurísticas ni
 * matching de dominio, cuál de los mecanismos existentes usar — y que
 * ejecuta el guard de ownership de costos derivados de venta (LP-ARCH-003
 * v1.2 §2.4/§2.5) en el único lugar donde es posible hacerlo: aquí, donde
 * `groups` y `saleBasedCostItems` son visibles simultáneamente.
 * `computePricingGroup` NO puede ejecutar este guard por sí solo — no
 * conoce `saleBasedCostItems` externos al grupo.
 *
 * v1 (LP-ENG-002 §5, aclaración vinculante de Control Tower): NO se intenta
 * matching heurístico entre `knownSaleBasedCosts` de un grupo y
 * `saleBasedCostItems` de la cotización (sin comparar amount/rate para
 * "descubrir" si representan el mismo costo económico, sin IDs de dominio,
 * sin prorrateo). La regla es deliberadamente amplia: si CUALQUIER grupo usa
 * `FINAL_AFTER_KNOWN_COSTS` y la cotización declara CUALQUIER
 * `saleBasedCostItems` de alcance-cotización, se rechaza — cubre tanto el
 * caso de un costo quote-level no absorbido como el de un posible doble
 * ownership, sin necesidad de inferir cuál es cuál.
 *
 * Contrato (no modifica `computeQuote` ni `computeQuoteWithSaleBasedCosts`):
 *   A) existe group FINAL_AFTER_KNOWN_COSTS Y saleBasedCostItems.length>0
 *      → throw FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS
 *   B) existe group FINAL_AFTER_KNOWN_COSTS Y NO hay saleBasedCostItems
 *      → computeQuote(groups)
 *   C) NO existe group FINAL_AFTER_KNOWN_COSTS Y hay saleBasedCostItems
 *      → computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems })
 *   D) NO existe group FINAL_AFTER_KNOWN_COSTS Y NO hay saleBasedCostItems
 *      → computeQuote(groups)
 *
 * @param {object} input
 * @param {object[]} input.groups - insumos de `computePricingGroup` (algunos
 *   pueden declarar `pricing.profitTargetBasis='FINAL_AFTER_KNOWN_COSTS'` +
 *   `knownSaleBasedCosts`).
 * @param {object[]} [input.saleBasedCostItems] - costos de alcance-cotización
 *   clásicos (retornos/fianzas), mismo insumo que
 *   `computeQuoteWithSaleBasedCosts`.
 */
export function computeQuoteCanonical({ groups, saleBasedCostItems = [] }) {
  assert(Array.isArray(groups) && groups.length > 0, 'computeQuoteCanonical requiere al menos un group.');
  assert(Array.isArray(saleBasedCostItems), 'saleBasedCostItems debe ser un arreglo.');

  const hasFinalGroup = groups.some((g) => {
    if (!g || !g.pricing || g.pricing.mode !== 'TARGET_PROFIT_AMOUNT') return false;
    const basis = g.pricing.profitTargetBasis ?? 'BASE_COST_BEFORE_SALE_BASED_COSTS';
    return basis === 'FINAL_AFTER_KNOWN_COSTS';
  });

  if (hasFinalGroup && saleBasedCostItems.length > 0) {
    throw new Error(
      `[pricingEngine] ${TARGET_PROFIT_BASIS_ERRORS.FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS}: existe al menos un grupo con profitTargetBasis=FINAL_AFTER_KNOWN_COSTS y, además, esta cotización declara saleBasedCostItems de alcance-cotización. v1 no infiere ni prorratea (LP-ARCH-003 v1.2 §2.4/LP-ENG-002 §5): declara el costo como knownSaleBasedCosts del grupo (ownership GROUP_FINAL) y retíralo de saleBasedCostItems, o mantenlo en saleBasedCostItems (ownership QUOTE_LEVEL) y cambia ese grupo a profitTargetBasis=BASE_COST_BEFORE_SALE_BASED_COSTS.`
    );
  }

  if (saleBasedCostItems.length > 0) {
    // hasFinalGroup === false aquí (el caso true ya lanzó arriba) → caso C.
    return computeQuoteWithSaleBasedCosts({ groups, saleBasedCostItems });
  }

  // Casos B y D: sin saleBasedCostItems de alcance-cotización, con o sin
  // grupo FINAL — computeQuote ya invoca computePricingGroup por grupo, que
  // internamente resuelve FINAL_AFTER_KNOWN_COSTS cuando corresponda.
  return computeQuote(groups);
}
