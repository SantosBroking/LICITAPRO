// server/emission/loadQuoteAggregate.js
//
// LP-EMIT-004 — real SQL reads for LP-EMIT-001 §2.1. Every query in this
// module runs against the SAME `client` the caller passes in (the one
// `transactionCoordinator.js` BEGAN, isolated, and locked `quote` on) — this
// module never acquires its own connection, never opens a second client, and
// never uses supabase-js/PostgREST. Plain parameterized SQL only.
//
// This module does not know about `quote-core`, the engine, or any
// financial concept — it only knows how to read rows and hand them back
// as-is (snake_case, exactly as PostgreSQL returns them), which is precisely
// what `quote-core.mapPricingGroupRow`/`mapCostItemRow` expect as input.

'use strict';

/**
 * Reads the `quote` row itself. Called separately from the rest of the
 * aggregate because the emission flow needs it FIRST (to check
 * `quote.status` — LP-EMIT-001 §7 paso 1 — before deciding whether to load
 * anything else at all).
 *
 * @param {{ query: Function }} client
 * @param {string} quoteId
 * @returns {Promise<object|null>}
 */
async function loadQuote(client, quoteId) {
  const { rows } = await client.query('SELECT * FROM quote WHERE id = $1', [quoteId]);
  return rows[0] || null;
}

/**
 * Reads the rest of the coherent aggregate (LP-EMIT-001 §2.1, points 2-11)
 * for a `quote` row already loaded/locked by the caller. Every read below
 * uses the SAME client/transaction, so — combined with the isolation level
 * `transactionCoordinator.js` already set — these lectures share one
 * consistent snapshot.
 *
 * @param {{ query: Function }} client
 * @param {object} quote - the already-loaded `quote` row (from loadQuote)
 * @returns {Promise<{
 *   issuingCompany: object|null,
 *   client: object|null,
 *   contact: object|null,
 *   address: object|null,
 *   sections: object[],
 *   lines: object[],
 *   pricingGroups: object[],
 *   pricingGroupCostItems: object[],
 *   quoteSaleBasedCostItems: object[],
 *   catalogItemsById: Map<string, object>,
 * }>}
 */
async function loadQuoteAggregateRest(client, quote) {
  const quoteId = quote.id;

  // 2. issuing_company
  const issuingCompany = quote.issuing_company_id
    ? (await client.query('SELECT * FROM issuing_company WHERE id = $1', [quote.issuing_company_id])).rows[0] || null
    : null;

  // 3. third_party (client)
  const clientThirdParty = quote.client_third_party_id
    ? (await client.query('SELECT * FROM third_party WHERE id = $1', [quote.client_third_party_id])).rows[0] || null
    : null;

  // 4. third_party_contact — only when quote.client_contact_id IS NOT NULL
  const contact = quote.client_contact_id
    ? (await client.query('SELECT * FROM third_party_contact WHERE id = $1', [quote.client_contact_id])).rows[0] || null
    : null;

  // 5. third_party_address — only when quote.client_address_id IS NOT NULL
  const address = quote.client_address_id
    ? (await client.query('SELECT * FROM third_party_address WHERE id = $1', [quote.client_address_id])).rows[0] || null
    : null;

  // 6. ACTIVE quote_section
  const sections = (
    await client.query('SELECT * FROM quote_section WHERE quote_id = $1 AND status = $2 ORDER BY display_order', [quoteId, 'ACTIVE'])
  ).rows;

  // 7. ACTIVE quote_line
  const lines = (
    await client.query('SELECT * FROM quote_line WHERE quote_id = $1 AND status = $2 ORDER BY display_order', [quoteId, 'ACTIVE'])
  ).rows;

  // 8. ACTIVE pricing_group (all roles — relevance is determined later by
  // cross-referencing against `lines`, not by filtering here; §2.1 point 8).
  const pricingGroups = (
    await client.query('SELECT * FROM pricing_group WHERE quote_id = $1 AND status = $2', [quoteId, 'ACTIVE'])
  ).rows;

  // 9. ACTIVE pricing_group_cost_item belonging to the groups from point 8
  const groupIds = pricingGroups.map((g) => g.id);
  const pricingGroupCostItems = groupIds.length
    ? (
        await client.query(
          'SELECT * FROM pricing_group_cost_item WHERE pricing_group_id = ANY($1::uuid[]) AND status = $2',
          [groupIds, 'ACTIVE'],
        )
      ).rows
    : [];

  // 10. ACTIVE quote_sale_based_cost_item
  const quoteSaleBasedCostItems = (
    await client.query('SELECT * FROM quote_sale_based_cost_item WHERE quote_id = $1 AND status = $2', [quoteId, 'ACTIVE'])
  ).rows;

  // 11. catalog_item referenced by ACTIVE lines' catalog_item_id — NOT
  // filtered by catalog_item.status (LP-EMIT-001 §2.1 point 11: trazabilidad
  // del objeto referenciado, no una relectura del maestro vivo).
  const catalogItemIds = [...new Set(lines.map((l) => l.catalog_item_id).filter((id) => id !== null && id !== undefined))];
  const catalogItemRows = catalogItemIds.length
    ? (await client.query('SELECT * FROM catalog_item WHERE id = ANY($1::uuid[])', [catalogItemIds])).rows
    : [];
  const catalogItemsById = new Map(catalogItemRows.map((row) => [row.id, row]));

  return {
    issuingCompany,
    client: clientThirdParty,
    contact,
    address,
    sections,
    lines,
    pricingGroups,
    pricingGroupCostItems,
    quoteSaleBasedCostItems,
    catalogItemsById,
  };
}

module.exports = { loadQuote, loadQuoteAggregateRest };
