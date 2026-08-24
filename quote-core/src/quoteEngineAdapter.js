// quote-core/src/quoteEngineAdapter.js
//
// LP-ORCH-001 — adapter puro entre filas PostgreSQL-shaped (snake_case,
// exactamente como las produce LP-SCHEMA-002) y el input canónico del motor
// financiero (`engine/src/pricingEngine.js`, contrato LP-ENG-002T).
//
// Este módulo NO consulta la base de datos, NO conoce Supabase, NO conoce
// UI/API/legacy. Recibe un "envelope" ya cargado (arreglos de filas planas)
// y produce/consume exactamente el vocabulario que el motor espera
// (`computeQuoteCanonical({ groups, saleBasedCostItems })`).
//
// "El motor calcula; este adapter solo traduce forma, nunca inventa
// semántica financiera nueva."

import { computeQuoteCanonical } from '../../engine/src/pricingEngine.js';

// ── Metadata inmutable del motor consumido por este adapter (LP-ORCH-001 §14).
// NO se agrega dentro de engineInput — es metadata para la futura capa de
// emisión (LP-EMIT-001), que decidirá qué persistir junto a un QuoteVersion.
export const QUOTE_ENGINE_METADATA = Object.freeze({
  engineCommitSha: '0421b8f28d075089320387d526c97d1f27adf764',
  engineContractVersion: 'LP-ENG-002T',
  calculationSchemaVersion: 'v1',
});

// ── Códigos de error estables (LP-ORCH-001) ─────────────────────────────────
// Cada rechazo determinista de este adapter usa uno de estos códigos, tanto
// en `error.code` como embebido en `error.message`, para que un consumidor
// pueda discriminar programáticamente sin parsear texto libre.
export const ADAPTER_ERROR_CODES = Object.freeze({
  REQUIRED_NUMERIC_FIELD_MISSING: 'REQUIRED_NUMERIC_FIELD_MISSING',
  NON_FINITE_NUMERIC_FIELD: 'NON_FINITE_NUMERIC_FIELD',
  EMPTY_NUMERIC_FIELD: 'EMPTY_NUMERIC_FIELD',
  NON_NUMERIC_STRING_FIELD: 'NON_NUMERIC_STRING_FIELD',
  UNSUPPORTED_NUMERIC_TYPE: 'UNSUPPORTED_NUMERIC_TYPE',
  INVALID_COST_CALCULATION_MODE: 'INVALID_COST_CALCULATION_MODE',
  MISSING_QUANTITY_MODE: 'MISSING_QUANTITY_MODE',
  GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET: 'GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET',
  MAIN_INCLUDED_GROUP_REQUIRED: 'MAIN_INCLUDED_GROUP_REQUIRED',
  PRICING_GROUP_QUOTE_MISMATCH: 'PRICING_GROUP_QUOTE_MISMATCH',
  SALE_BASED_COST_ITEM_QUOTE_MISMATCH: 'SALE_BASED_COST_ITEM_QUOTE_MISMATCH',
  ORPHAN_PRICING_GROUP_COST_ITEM: 'ORPHAN_PRICING_GROUP_COST_ITEM',
  INVALID_ENVELOPE_SHAPE: 'INVALID_ENVELOPE_SHAPE',
});

export class QuoteEngineAdapterError extends Error {
  constructor(code, detail) {
    super(`[quote-core] ${code}: ${detail}`);
    this.name = 'QuoteEngineAdapterError';
    this.code = code;
  }
}

function fail(code, detail) {
  throw new QuoteEngineAdapterError(code, detail);
}

// ── NUMERIC → NUMBER (LP-ORCH-001 §5) ───────────────────────────────────────
//
// Conversión explícita y centralizada de valores "PostgreSQL-shaped"
// (number finito, o string numérico válido tal como lo devuelve el driver
// para columnas NUMERIC) hacia el `number` finito que el motor exige.
//
// CRÍTICO: nunca se permite que `Number(null) === 0` convierta ausencia en
// cero silenciosamente — null/undefined en un campo requerido es un rechazo
// explícito, nunca un 0 implícito. Un campo NULLABLE ausente (null/undefined)
// se resuelve como `undefined` (propiedad omitida), nunca como 0 ni como
// `null` propagado al motor.

function coerceFiniteNumber(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(ADAPTER_ERROR_CODES.NON_FINITE_NUMERIC_FIELD, `${label}: número no finito (${value}).`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      fail(ADAPTER_ERROR_CODES.EMPTY_NUMERIC_FIELD, `${label}: cadena vacía o solo espacios en blanco no es un valor numérico válido.`);
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      fail(ADAPTER_ERROR_CODES.NON_NUMERIC_STRING_FIELD, `${label}: cadena no numérica o no finita (recibido: ${JSON.stringify(value)}).`);
    }
    return num;
  }
  fail(ADAPTER_ERROR_CODES.UNSUPPORTED_NUMERIC_TYPE, `${label}: tipo no soportado para conversión numérica (${typeof value}).`);
}

/**
 * Campo requerido: null/undefined es un rechazo explícito (nunca se
 * convierte en 0).
 */
function toRequiredNumber(value, label) {
  if (value === undefined || value === null) {
    fail(
      ADAPTER_ERROR_CODES.REQUIRED_NUMERIC_FIELD_MISSING,
      `${label}: se requiere un valor numérico (recibido: ${value === undefined ? 'undefined' : 'null'}).`
    );
  }
  return coerceFiniteNumber(value, label);
}

/**
 * Campo nullable: null/undefined se resuelve como `undefined` (el llamador
 * debe OMITIR la propiedad, nunca enviar `null` al motor). Si el valor SÍ
 * está presente, debe ser un número/string numérico finito válido — no hay
 * una tercera opción silenciosa.
 */
function toOptionalNumber(value, label) {
  if (value === undefined || value === null) return undefined;
  return coerceFiniteNumber(value, label);
}

// ── MAPPING COST ITEM (LP-ORCH-001 §6) ──────────────────────────────────────

const COST_CALCULATION_MODES = Object.freeze(['DIRECT_AMOUNT', 'PERCENT_OF_SALE_NET', 'PERCENT_OF_SALE_GROSS']);

/**
 * Mapea una fila snake_case de `pricing_group_cost_item` o
 * `quote_sale_based_cost_item` (mismo vocabulario en ambas tablas) hacia el
 * CostItem camelCase que el motor espera. No muta `row`.
 */
export function mapCostItemRow(row, label = `cost_item ${row && row.id}`) {
  if (typeof row !== 'object' || row === null) {
    fail(ADAPTER_ERROR_CODES.INVALID_ENVELOPE_SHAPE, `${label}: se esperaba un objeto de fila.`);
  }

  const mode = row.cost_calculation_mode;
  if (!COST_CALCULATION_MODES.includes(mode)) {
    fail(ADAPTER_ERROR_CODES.INVALID_COST_CALCULATION_MODE, `${label}: cost_calculation_mode inválido (${mode}).`);
  }

  const out = {
    costCalculationMode: mode,
    costRole: row.cost_role,
    taxTreatment: row.tax_treatment,
    documentationStatus: row.documentation_status,
    currency: row.currency,
  };

  const taxRate = toOptionalNumber(row.tax_rate, `${label}.tax_rate`);
  if (taxRate !== undefined) out.taxRate = taxRate;

  if (mode === 'DIRECT_AMOUNT') {
    out.amount = toRequiredNumber(row.amount, `${label}.amount`);

    if (row.quantity_mode === null || row.quantity_mode === undefined) {
      fail(ADAPTER_ERROR_CODES.MISSING_QUANTITY_MODE, `${label}: quantity_mode es requerido cuando cost_calculation_mode=DIRECT_AMOUNT.`);
    }
    out.quantityMode = row.quantity_mode;

    const quantity = toOptionalNumber(row.quantity, `${label}.quantity`);
    if (quantity !== undefined) out.quantity = quantity;
    // rate NO se envía para DIRECT_AMOUNT.
  } else {
    // PERCENT_OF_SALE_NET / PERCENT_OF_SALE_GROSS.
    out.rate = toRequiredNumber(row.rate, `${label}.rate`);
    // amount / quantity / quantityMode NO se envían para modos PERCENT_*.
  }

  return out;
}

// ── MAPPING PRICING GROUP (LP-ORCH-001 §7/§8) ───────────────────────────────

/**
 * Regla canónica LP-SCHEMA-001: GROUP_KNOWN_SALE_BASED_COST solo es
 * consumible cuando pricing_mode=TARGET_PROFIT_AMOUNT Y
 * profit_target_basis (explícito, no inferido) = FINAL_AFTER_KNOWN_COSTS.
 */
function isFinalTargetEligible(groupRow) {
  return groupRow.pricing_mode === 'TARGET_PROFIT_AMOUNT' && groupRow.profit_target_basis === 'FINAL_AFTER_KNOWN_COSTS';
}

/**
 * Mapea una fila `pricing_group` + sus filas `pricing_group_cost_item`
 * (ya scoped a este grupo, cualquier status) hacia el `group` que el motor
 * espera. No muta `groupRow` ni `costItemRows`.
 */
export function mapPricingGroupRow(groupRow, costItemRows, label = `pricing_group ${groupRow && groupRow.id}`) {
  if (typeof groupRow !== 'object' || groupRow === null) {
    fail(ADAPTER_ERROR_CODES.INVALID_ENVELOPE_SHAPE, `${label}: se esperaba un objeto de fila.`);
  }
  const rows = Array.isArray(costItemRows) ? costItemRows : [];

  const activeCostItems = rows.filter((r) => r.pricing_group_id === groupRow.id && r.status === 'ACTIVE');
  const baseCostRows = activeCostItems.filter((r) => r.cost_scope === 'GROUP_BASE_COST');
  const knownRows = activeCostItems.filter((r) => r.cost_scope === 'GROUP_KNOWN_SALE_BASED_COST');

  if (knownRows.length > 0 && !isFinalTargetEligible(groupRow)) {
    fail(
      ADAPTER_ERROR_CODES.GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET,
      `${label}: existen filas ACTIVE con cost_scope=GROUP_KNOWN_SALE_BASED_COST pero pricing_mode=${groupRow.pricing_mode}/profit_target_basis=${groupRow.profit_target_basis} — solo TARGET_PROFIT_AMOUNT + FINAL_AFTER_KNOWN_COSTS puede consumir estas filas.`
    );
  }

  const group = {};

  const quantity = toOptionalNumber(groupRow.quantity, `${label}.quantity`);
  if (quantity !== undefined) group.quantity = quantity;

  group.costItems = baseCostRows.map((row, i) => mapCostItemRow(row, `${label}.costItems[${i}] (${row.id})`));
  group.knownSaleBasedCosts = knownRows.map((row, i) => mapCostItemRow(row, `${label}.knownSaleBasedCosts[${i}] (${row.id})`));

  if (groupRow.pricing_mode === null || groupRow.pricing_mode === undefined) {
    // Grupo de solo costo: pricing=null y el resto de campos de pricing se
    // omiten por completo (LP-ORCH-001 §7).
    group.pricing = null;
  } else {
    const pricing = {
      mode: groupRow.pricing_mode,
      value: toRequiredNumber(groupRow.pricing_value, `${label}.pricing_value`),
      taxTreatment: groupRow.sale_tax_treatment,
      currency: groupRow.currency,
    };

    // amount_basis / profit_target_basis / sale_tax_rate NULL -> propiedad
    // OMITIDA, nunca null. Obligatorio en particular para MARKUP_ON_COST,
    // donde el motor exige amountBasis=undefined (no null).
    if (groupRow.amount_basis !== null && groupRow.amount_basis !== undefined) {
      pricing.amountBasis = groupRow.amount_basis;
    }
    if (groupRow.profit_target_basis !== null && groupRow.profit_target_basis !== undefined) {
      pricing.profitTargetBasis = groupRow.profit_target_basis;
    }
    const saleTaxRate = toOptionalNumber(groupRow.sale_tax_rate, `${label}.sale_tax_rate`);
    if (saleTaxRate !== undefined) pricing.taxRate = saleTaxRate;

    group.pricing = pricing;
  }

  return group;
}

// ── SCOPE / ORPHANS (LP-ORCH-001 §10) ───────────────────────────────────────
//
// No confiar ciegamente en que el caller ya filtró por quote_id. Rechaza
// determinísticamente cualquier fila fuera de scope antes de calcular.

function assertEnvelopeScope(envelope) {
  if (typeof envelope !== 'object' || envelope === null) {
    fail(ADAPTER_ERROR_CODES.INVALID_ENVELOPE_SHAPE, 'envelope debe ser un objeto.');
  }
  const { quote, pricingGroups = [], pricingGroupCostItems = [], quoteSaleBasedCostItems = [] } = envelope;
  if (typeof quote !== 'object' || quote === null || quote.id === undefined || quote.id === null) {
    fail(ADAPTER_ERROR_CODES.INVALID_ENVELOPE_SHAPE, 'envelope.quote debe ser un objeto con id.');
  }

  const groupIds = new Set();
  for (const g of pricingGroups) {
    if (g.quote_id !== quote.id) {
      fail(
        ADAPTER_ERROR_CODES.PRICING_GROUP_QUOTE_MISMATCH,
        `pricing_group ${g.id} tiene quote_id=${g.quote_id}, se esperaba quote_id=${quote.id}.`
      );
    }
    groupIds.add(g.id);
  }

  for (const s of quoteSaleBasedCostItems) {
    if (s.quote_id !== quote.id) {
      fail(
        ADAPTER_ERROR_CODES.SALE_BASED_COST_ITEM_QUOTE_MISMATCH,
        `quote_sale_based_cost_item ${s.id} tiene quote_id=${s.quote_id}, se esperaba quote_id=${quote.id}.`
      );
    }
  }

  for (const c of pricingGroupCostItems) {
    if (!groupIds.has(c.pricing_group_id)) {
      fail(
        ADAPTER_ERROR_CODES.ORPHAN_PRICING_GROUP_COST_ITEM,
        `pricing_group_cost_item ${c.id} referencia pricing_group_id=${c.pricing_group_id}, que no existe dentro del envelope recibido.`
      );
    }
  }
}

// ── MAIN AGGREGATE (LP-ORCH-001 §9) ─────────────────────────────────────────

/**
 * Construye el `engineInput` principal: solo pricing_group ACTIVE +
 * quote_total_role=INCLUDED. OPTIONAL/REFERENCE_ONLY quedan completamente
 * excluidos. Exige al menos un grupo ACTIVE+INCLUDED.
 */
export function buildMainEngineInput(envelope) {
  assertEnvelopeScope(envelope);
  const { quote, pricingGroups = [], pricingGroupCostItems = [], quoteSaleBasedCostItems = [] } = envelope;

  const includedActiveGroups = pricingGroups.filter((g) => g.status === 'ACTIVE' && g.quote_total_role === 'INCLUDED');
  if (includedActiveGroups.length === 0) {
    fail(
      ADAPTER_ERROR_CODES.MAIN_INCLUDED_GROUP_REQUIRED,
      `quote ${quote.id}: no existe ningún pricing_group ACTIVE con quote_total_role=INCLUDED; el main engine input requiere al menos uno.`
    );
  }

  const groups = includedActiveGroups.map((g, i) => {
    const costItemsForGroup = pricingGroupCostItems.filter((c) => c.pricing_group_id === g.id);
    return mapPricingGroupRow(g, costItemsForGroup, `pricingGroups[${i}] (${g.id})`);
  });

  const saleBasedCostItems = quoteSaleBasedCostItems
    .filter((s) => s.status === 'ACTIVE')
    .map((row, i) => mapCostItemRow(row, `quoteSaleBasedCostItems[${i}] (${row.id})`));

  return { groups, saleBasedCostItems };
}

// ── CÁLCULO PRINCIPAL (LP-ORCH-001 §11) ─────────────────────────────────────

export function calculateMainQuote(envelope) {
  const engineInput = buildMainEngineInput(envelope);
  const engineOutput = computeQuoteCanonical(engineInput);
  return { engineInput, engineOutput };
}

// ── OPTIONAL / REFERENCE_ONLY (LP-ORCH-001 §12) ─────────────────────────────

/**
 * Cada pricing_group ACTIVE con quote_total_role OPTIONAL o REFERENCE_ONLY
 * se calcula por separado, NUNCA dentro del engineInput principal. No se
 * prorratean ni copian automáticamente los saleBasedCostItems de alcance-
 * cotización a un grupo supplemental — cada cálculo supplemental usa
 * saleBasedCostItems: [] explícitamente.
 */
export function calculateSupplementalGroups(envelope) {
  assertEnvelopeScope(envelope);
  const { pricingGroups = [], pricingGroupCostItems = [] } = envelope;

  const supplementalGroupRows = pricingGroups.filter(
    (g) => g.status === 'ACTIVE' && (g.quote_total_role === 'OPTIONAL' || g.quote_total_role === 'REFERENCE_ONLY')
  );

  return supplementalGroupRows.map((g, i) => {
    const costItemsForGroup = pricingGroupCostItems.filter((c) => c.pricing_group_id === g.id);
    const mappedGroup = mapPricingGroupRow(g, costItemsForGroup, `supplemental[${i}] (${g.id})`);
    const engine_input = { groups: [mappedGroup], saleBasedCostItems: [] };
    const engine_output = computeQuoteCanonical(engine_input);
    return {
      pricing_group_id: g.id,
      quote_total_role: g.quote_total_role,
      engine_input,
      engine_output,
    };
  });
}

// ── FUNCIÓN DE ALTO NIVEL (LP-ORCH-001 §13) ─────────────────────────────────

/**
 * DRAFT calculation — efímero, no persiste nada. Combina el cálculo
 * principal (INCLUDED) con los cálculos supplemental (OPTIONAL/
 * REFERENCE_ONLY), cada uno aislado.
 */
export function calculateQuoteDraft(envelope) {
  const main = calculateMainQuote(envelope);
  const supplementalCalculations = calculateSupplementalGroups(envelope);
  return { main, supplementalCalculations };
}
