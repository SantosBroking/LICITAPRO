// server/emission/buildCommercialSnapshots.js
//
// LP-EMIT-004 — real implementation of the whitelist snapshots specified in
// LP-EMIT-001 §4, the identity mapping sidecar of §5, and the supplemental
// materiality selection of §3. Pure functions over already-loaded rows and
// an already-computed `calculateQuoteDraft` result — no SQL, no DB access,
// no `quote-core`/engine reimplementation.

'use strict';

const { EmissionInternalInvariantFailureError, SupplementalCommercialInconsistencyError, CommercialSnapshotIncompleteError } = require('./emissionErrors.js');

// ── §5 — identity mapping sidecar ────────────────────────────────────────

/**
 * Builds `includedPricingGroupIdsInEngineOrder` (LP-EMIT-001 §5): the
 * `pricing_group.id` values, in EXACTLY the order `quote-core`'s
 * `buildMainEngineInput` filters them — `pricingGroups.filter(g => g.status
 * === 'ACTIVE' && g.quote_total_role === 'INCLUDED')`, preserving the
 * relative order of the `pricingGroups` array passed in.
 *
 * @param {object[]} pricingGroups - the SAME array passed as
 *   `envelope.pricingGroups` to `calculateQuoteDraft`.
 * @returns {string[]}
 */
function buildIncludedPricingGroupIdsInEngineOrder(pricingGroups) {
  return pricingGroups.filter((g) => g.status === 'ACTIVE' && g.quote_total_role === 'INCLUDED').map((g) => g.id);
}

/**
 * Validates the cardinality invariant of §5/§7 paso 6. Throws
 * EmissionInternalInvariantFailureError (LP-EMIT-003R corrección 4 code) if
 * `main.engineOutput.groups` and `includedPricingGroupIdsInEngineOrder`
 * don't have matching length.
 *
 * @param {object} mainEngineOutput - draft.main.engineOutput
 * @param {string[]} includedPricingGroupIdsInEngineOrder
 */
function assertMainMappingCardinality(mainEngineOutput, includedPricingGroupIdsInEngineOrder) {
  const groups = (mainEngineOutput && mainEngineOutput.groups) || [];
  if (groups.length !== includedPricingGroupIdsInEngineOrder.length) {
    throw new EmissionInternalInvariantFailureError(
      `main.engineOutput.groups.length=${groups.length} !== includedPricingGroupIdsInEngineOrder.length=${includedPricingGroupIdsInEngineOrder.length}`,
    );
  }
}

// ── §3 — supplemental materiality selection ──────────────────────────────

const ANCHOR_LINE_STATUS_BY_ROLE = { OPTIONAL: 'OPTIONAL', REFERENCE_ONLY: 'REFERENCE_NOT_INCLUDED' };

/**
 * LP-EMIT-001 §3 — selects which OPTIONAL/REFERENCE_ONLY pricing_groups are
 * materially part of the version being emitted (i.e. have a valid ACTIVE
 * commercial anchor line), and pairs each with its already-computed
 * supplemental calculation.
 *
 * Throws SupplementalCommercialInconsistencyError for a priced
 * (`pricing_mode IS NOT NULL`) OPTIONAL/REFERENCE_ONLY group with no anchor
 * — a state `anchor_exactness` (validate_quote_for_emission) should already
 * have prevented; this is a defensive re-check, not the primary guard.
 *
 * @param {object[]} pricingGroups
 * @param {object[]} lines - ACTIVE quote_line rows
 * @param {object[]} supplementalCalculations - draft.supplementalCalculations
 * @returns {Map<string, object>} pricing_group_id -> supplemental calculation entry, material only
 */
function selectMaterialSupplemental(pricingGroups, lines, supplementalCalculations) {
  const supplementalByGroupId = new Map(supplementalCalculations.map((s) => [s.pricing_group_id, s]));
  const material = new Map();

  for (const pg of pricingGroups) {
    if (pg.quote_total_role !== 'OPTIONAL' && pg.quote_total_role !== 'REFERENCE_ONLY') continue;

    const anchorLineStatus = ANCHOR_LINE_STATUS_BY_ROLE[pg.quote_total_role];
    const anchorLine = lines.find((l) => l.pricing_group_id === pg.id && l.line_status === anchorLineStatus);

    if (!anchorLine) {
      if (pg.pricing_mode !== null && pg.pricing_mode !== undefined) {
        // A priced group with no anchor at this point is an invariant
        // failure — anchor_exactness should already have blocked emission.
        throw new SupplementalCommercialInconsistencyError(pg.id);
      }
      // Cost-only group with no anchor: normal, not material, not an error.
      continue;
    }

    if (pg.pricing_mode === null || pg.pricing_mode === undefined) {
      // A cost-only group cannot legitimately have a PRICED/OPTIONAL/
      // REFERENCE_NOT_INCLUDED anchor per priced_anchor_group_commercial —
      // if we get here, validate_quote_for_emission should already have
      // rejected the quote. Never material regardless.
      continue;
    }

    const supplemental = supplementalByGroupId.get(pg.id);
    if (supplemental) material.set(pg.id, supplemental);
  }

  return material;
}

// ── §4 — commercial snapshots (whitelist) ────────────────────────────────

function buildQuoteHeaderSnapshot(quote) {
  return {
    quote_id: quote.id,
    folio: quote.folio ?? null,
    currency: quote.currency,
    display_mode: quote.display_mode,
    valid_until: quote.valid_until ?? null,
    reference_label: quote.reference_label ?? null,
  };
}

function buildIssuerSnapshot(issuingCompany) {
  if (!issuingCompany) throw new CommercialSnapshotIncompleteError('issuer_snapshot: issuing_company row missing');
  return {
    issuing_company_id: issuingCompany.id,
    code: issuingCompany.code,
    legal_name: issuingCompany.legal_name,
    tax_id: issuingCompany.tax_id ?? null,
  };
}

function buildClientSnapshot(clientThirdParty, contact, address) {
  if (!clientThirdParty) throw new CommercialSnapshotIncompleteError('client_snapshot: third_party row missing');
  return {
    third_party_id: clientThirdParty.id,
    display_name: clientThirdParty.display_name,
    legal_name: clientThirdParty.legal_name ?? null,
    tax_id: clientThirdParty.tax_id ?? null,
    contact: contact
      ? {
          third_party_contact_id: contact.id,
          full_name: contact.full_name,
          role_label: contact.role_label ?? null,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
        }
      : null,
    address: address
      ? {
          third_party_address_id: address.id,
          address_kind: address.address_kind ?? null,
          line1: address.line1 ?? null,
          line2: address.line2 ?? null,
          city: address.city ?? null,
          state: address.state ?? null,
          postal_code: address.postal_code ?? null,
          country: address.country ?? null,
        }
      : null,
  };
}

function buildTermsSnapshot(quote) {
  return { terms_text: quote.terms_text ?? null };
}

/**
 * Derives `presented_price` for one line, per LP-EMIT-001 §4.4 — `null`
 * unless the line is exactly the anchor of a commercial (`pricing_mode IS
 * NOT NULL`) pricing_group. Only extracts `ventaNet`/`ventaGross`/`currency`
 * already computed by the engine — never recalculates.
 */
function derivePresentedPrice(line, { pricingGroupsById, includedPricingGroupIdsInEngineOrder, mainEngineOutputGroups, materialSupplementalByGroupId }) {
  if (!line.pricing_group_id) return null;
  const pg = pricingGroupsById.get(line.pricing_group_id);
  if (!pg || pg.pricing_mode === null || pg.pricing_mode === undefined) return null;

  if (pg.quote_total_role === 'INCLUDED' && line.line_status === 'PRICED') {
    const index = includedPricingGroupIdsInEngineOrder.indexOf(pg.id);
    if (index === -1) return null; // not the main aggregate's anchor after all
    const groupOutput = mainEngineOutputGroups[index];
    if (!groupOutput) return null;
    return { ventaNet: groupOutput.ventaNet, ventaGross: groupOutput.ventaGross, currency: groupOutput.currency, pricing_group_id: pg.id };
  }

  if (
    (pg.quote_total_role === 'OPTIONAL' && line.line_status === 'OPTIONAL') ||
    (pg.quote_total_role === 'REFERENCE_ONLY' && line.line_status === 'REFERENCE_NOT_INCLUDED')
  ) {
    const supplemental = materialSupplementalByGroupId.get(pg.id);
    if (!supplemental) return null; // not material (shouldn't normally happen for a valid anchor, but never invented)
    const groupOutput = supplemental.engine_output.groups[0];
    if (!groupOutput) return null;
    return { ventaNet: groupOutput.ventaNet, ventaGross: groupOutput.ventaGross, currency: groupOutput.currency, pricing_group_id: pg.id };
  }

  return null; // subordinate INCLUDED line, or any other non-anchor combination
}

/**
 * Builds `commercial_lines_snapshot` (§4.4) — one entry per ACTIVE
 * `quote_line`, grouped by its section.
 */
function buildCommercialLinesSnapshot(lines, sections, { pricingGroupsById, includedPricingGroupIdsInEngineOrder, mainEngineOutputGroups, materialSupplementalByGroupId, catalogItemsById }) {
  const sectionsById = new Map(sections.map((s) => [s.id, s]));

  return lines.map((line) => {
    const section = sectionsById.get(line.quote_section_id);
    if (!section) throw new CommercialSnapshotIncompleteError(`commercial_lines_snapshot: quote_section ${line.quote_section_id} missing for line ${line.id}`);

    const catalogItem = line.catalog_item_id ? catalogItemsById.get(line.catalog_item_id) : null;

    return {
      section: { quote_section_id: section.id, label: section.label, display_order: section.display_order },
      line: {
        quote_line_id: line.id,
        display_order: line.display_order,
        origin_kind: line.origin_kind,
        commercial_description: line.commercial_description,
        technical_description: line.technical_description ?? null,
        quantity: Number(line.quantity),
        unit_label: line.unit_label ?? null,
        line_status: line.line_status,
        catalog_reference: catalogItem ? { catalog_item_id: catalogItem.id, name: catalogItem.name } : null,
        presented_price: derivePresentedPrice(line, { pricingGroupsById, includedPricingGroupIdsInEngineOrder, mainEngineOutputGroups, materialSupplementalByGroupId }),
      },
    };
  });
}

/**
 * Orchestrates all five §4 snapshots + the §5 mapping + the §3 selection
 * into the single object emitQuote.js needs. Does NOT touch SQL/DB.
 */
function buildAllCommercialSnapshots({ quote, issuingCompany, clientThirdParty, contact, address, sections, lines, pricingGroups, mainEngineOutput, supplementalCalculations, catalogItemsById = new Map() }) {
  const includedPricingGroupIdsInEngineOrder = buildIncludedPricingGroupIdsInEngineOrder(pricingGroups);
  assertMainMappingCardinality(mainEngineOutput, includedPricingGroupIdsInEngineOrder);

  const materialSupplementalByGroupId = selectMaterialSupplemental(pricingGroups, lines, supplementalCalculations);
  const pricingGroupsById = new Map(pricingGroups.map((g) => [g.id, g]));

  const commercialSnapshots = {
    quote_header_snapshot: buildQuoteHeaderSnapshot(quote),
    issuer_snapshot: buildIssuerSnapshot(issuingCompany),
    client_snapshot: buildClientSnapshot(clientThirdParty, contact, address),
    commercial_lines_snapshot: buildCommercialLinesSnapshot(lines, sections, {
      pricingGroupsById,
      includedPricingGroupIdsInEngineOrder,
      mainEngineOutputGroups: mainEngineOutput.groups,
      materialSupplementalByGroupId,
      catalogItemsById,
    }),
    terms_snapshot: buildTermsSnapshot(quote),
  };

  return { commercialSnapshots, includedPricingGroupIdsInEngineOrder, materialSupplementalByGroupId };
}

module.exports = {
  buildIncludedPricingGroupIdsInEngineOrder,
  assertMainMappingCardinality,
  selectMaterialSupplemental,
  buildQuoteHeaderSnapshot,
  buildIssuerSnapshot,
  buildClientSnapshot,
  buildTermsSnapshot,
  buildCommercialLinesSnapshot,
  buildAllCommercialSnapshots,
};
