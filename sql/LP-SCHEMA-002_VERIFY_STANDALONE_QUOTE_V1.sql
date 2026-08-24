-- ============================================================================
-- LP-SCHEMA-002 — VERIFY SCRIPT — Standalone Quote v1 (READ-ONLY)
-- ============================================================================
-- Purpose: after a FUTURE application of
-- LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql, run this script to confirm the
-- live schema matches the LP-SCHEMA-001 v1.3 / LP-SCHEMA-002 contract.
--
-- STRICT READ-ONLY: no INSERT, no UPDATE, no DELETE, no DDL anywhere in
-- this file. Every statement is a SELECT against information_schema /
-- pg_catalog. This script was NOT executed in this mission — it is an
-- offline artifact for future use.
--
-- How to read the results: every query below returns rows describing
-- what it FOUND. A query returning zero rows where the surrounding
-- comment says "expect >=1 row" indicates a missing object; a query
-- under "SHOULD BE EMPTY" returning rows indicates a violation (e.g. an
-- unexpected native ENUM, or a table outside the approved scope).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table existence — all 15 canonical tables must exist.
-- ----------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'issuing_company','third_party','third_party_contact','third_party_address',
    'catalog_item','catalog_item_variant','cost_reference',
    'quote','quote_section','pricing_group','quote_line',
    'pricing_group_cost_item','quote_sale_based_cost_item',
    'quote_version','quote_version_calculation'
  )
ORDER BY table_name;
-- Expect exactly 15 rows.

-- ----------------------------------------------------------------------------
-- 2. Column inventory per table (spot-check the v1.3 additions).
-- ----------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'issuing_company','third_party','third_party_contact','third_party_address',
    'catalog_item','catalog_item_variant','cost_reference',
    'quote','quote_section','pricing_group','quote_line',
    'pricing_group_cost_item','quote_sale_based_cost_item',
    'quote_version','quote_version_calculation'
  )
ORDER BY table_name, ordinal_position;

-- Spot-check: v1.3 additions that must be present.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('catalog_item','commercial_description'),
    ('catalog_item','technical_description'),
    ('quote_line','commercial_description'),
    ('quote_line','technical_description'),
    ('quote_line','quantity'),
    ('quote_line','unit_label'),
    ('quote','client_contact_id'),
    ('quote','client_address_id'),
    ('pricing_group','quote_total_role'),
    ('quote_version','commercial_snapshot_schema_version'),
    ('quote_version_calculation','engine_commit_sha'),
    ('quote_version_calculation','engine_contract_version'),
    ('quote_version_calculation','calculation_schema_version'),
    ('quote_version_calculation','created_by')
  )
ORDER BY table_name, column_name;
-- Expect exactly 14 rows present (LP-SCHEMA-002R correction 8: this list
-- has 14 (table,column) pairs, not 13 — verify the count explicitly).

-- Spot-check: columns that must NOT exist (removed by v1.3).
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'quote_line' AND column_name = 'free_text_label')
    OR (table_name = 'catalog_item' AND column_name = 'description')
    OR (table_name = 'quote' AND column_name = 'work_item_id')
    OR (table_name = 'quote_version' AND column_name IN ('engine_input','engine_output','profitability_snapshot'))
  );
-- SHOULD BE EMPTY.

-- ----------------------------------------------------------------------------
-- 3. Primary keys.
-- ----------------------------------------------------------------------------
SELECT tc.table_name, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'issuing_company','third_party','third_party_contact','third_party_address',
    'catalog_item','catalog_item_variant','cost_reference',
    'quote','quote_section','pricing_group','quote_line',
    'pricing_group_cost_item','quote_sale_based_cost_item',
    'quote_version','quote_version_calculation'
  )
ORDER BY tc.table_name;
-- Expect exactly one PK column per table; quote_version_calculation's PK
-- column must be quote_version_id (the 1:1 shape).

-- ----------------------------------------------------------------------------
-- 4. Foreign keys, including the composite ones that carry the cross-table
--    invariants LP-SCHEMA-001 assigns to declarative FKs.
-- ----------------------------------------------------------------------------
-- (LP-SCHEMA-002T correction 4): information_schema.key_column_usage /
-- constraint_column_usage joined only by constraint_name does not reliably
-- preserve REFERENCING-column <-> REFERENCED-column POSITIONAL pairing for
-- composite FKs (constraint_column_usage in particular is not guaranteed
-- to align row-for-row with the referencing side's ordinal position). This
-- query instead reads pg_constraint's own conkey/confkey arrays (which ARE
-- positionally paired by definition: conkey[i] corresponds to confkey[i])
-- and unnests them WITH ORDINALITY to reconstruct the pairing unambiguously.
SELECT
    referencing_table,
    constraint_name,
    string_agg(referencing_column, ', ' ORDER BY ord) AS referencing_columns,
    referenced_table,
    string_agg(referenced_column, ', ' ORDER BY ord) AS referenced_columns
FROM (
    SELECT
        rc.relname AS referencing_table,
        con.conname AS constraint_name,
        fc.relname AS referenced_table,
        ord.ord,
        ra.attname AS referencing_column,
        fa.attname AS referenced_column
    FROM pg_constraint con
    JOIN pg_class rc ON rc.oid = con.conrelid
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = con.connamespace
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS ord(rcol, fcol, ord)
    JOIN pg_attribute ra ON ra.attrelid = con.conrelid AND ra.attnum = ord.rcol
    JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = ord.fcol
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND rc.relname IN (
        'issuing_company','third_party','third_party_contact','third_party_address',
        'catalog_item','catalog_item_variant','cost_reference',
        'quote','quote_section','pricing_group','quote_line',
        'pricing_group_cost_item','quote_sale_based_cost_item',
        'quote_version','quote_version_calculation'
      )
) pairs
GROUP BY referencing_table, constraint_name, referenced_table
ORDER BY referencing_table, constraint_name;
-- Each row's referencing_columns / referenced_columns are listed in true
-- positional order (position 1 of conkey <-> position 1 of confkey, etc.),
-- unambiguous for composite FKs — unlike a join purely on constraint_name.

-- Spot-check the specific composite FKs that encode LP-SCHEMA-001
-- invariants declaratively (must all be present):
--   quote_line.fk_quote_line_section              -> (quote_id, quote_section_id)
--   quote_line.fk_quote_line_pricing_group         -> (quote_id, pricing_group_id)
--   quote_line.fk_quote_line_catalog_item_kind     -> (catalog_item_id, origin_kind)
--   quote_line.fk_quote_line_variant               -> (catalog_item_id, catalog_item_variant_id)
--   quote.fk_quote_client_contact                  -> (client_third_party_id, client_contact_id)
--   quote.fk_quote_client_address                  -> (client_third_party_id, client_address_id)
--   pricing_group.fk_pricing_group_quote_currency  -> (quote_id, currency)
--   pricing_group_cost_item.fk_pgci_currency       -> (pricing_group_id, currency)
--   quote_sale_based_cost_item.fk_qsbci_currency   -> (quote_id, currency)
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND constraint_name IN (
    'fk_quote_line_section','fk_quote_line_pricing_group',
    'fk_quote_line_catalog_item_kind','fk_quote_line_variant',
    'fk_quote_client_contact','fk_quote_client_address',
    'fk_pricing_group_quote_currency','fk_pgci_currency','fk_qsbci_currency'
  )
ORDER BY constraint_name;
-- Expect exactly 9 rows.

-- ----------------------------------------------------------------------------
-- 5. RESTRICT/NO ACTION on cost_reference links (ZERO DELETE trazabilidad).
-- ----------------------------------------------------------------------------
SELECT
    tc.table_name,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('pricing_group_cost_item','quote_sale_based_cost_item')
  AND EXISTS (
      SELECT 1 FROM information_schema.key_column_usage kcu
      WHERE kcu.constraint_name = tc.constraint_name
        AND kcu.column_name = 'source_cost_reference_id'
  );
-- delete_rule must be 'RESTRICT' or 'NO ACTION' — never 'SET NULL'.

-- ----------------------------------------------------------------------------
-- 6. Unique indexes, including the partial ones (ACTIVE-only uniqueness,
--    single-anchor cap, folio-per-issuer).
-- ----------------------------------------------------------------------------
SELECT
    schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'uq_quote_issuer_folio',
    'uq_quote_section_active_order',
    'uq_quote_line_active_order',
    'uq_pricing_group_single_anchor',
    'uq_third_party_contact_primary',
    'uq_catalog_item_sku'
  )
ORDER BY tablename, indexname;
-- Expect all 6 rows, each indexdef containing a WHERE clause (partial index).

-- ----------------------------------------------------------------------------
-- 7. CHECK constraints — full inventory, for manual/diff review.
-- ----------------------------------------------------------------------------
SELECT
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name AND tc.table_schema = cc.constraint_schema
WHERE tc.constraint_type = 'CHECK'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'issuing_company','third_party','third_party_contact','third_party_address',
    'catalog_item','catalog_item_variant','cost_reference',
    'quote','quote_section','pricing_group','quote_line',
    'pricing_group_cost_item','quote_sale_based_cost_item',
    'quote_version','quote_version_calculation'
  )
ORDER BY tc.table_name, tc.constraint_name;

-- Spot-check the big compound CHECKs must exist by name:
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND constraint_name IN (
    'ck_pricing_group_mode_shape',
    'ck_pricing_group_per_unit_requires_quantity',
    'ck_pgci_mode_field_shape',
    'ck_qsbci_mode_field_shape',
    'ck_pgci_scope_mode',
    'ck_quote_line_variant_requires_item',
    'ck_quote_line_kit_solution_snapshot',
    'ck_quote_folio_implies_issuer',
    'ck_quote_contact_implies_client',
    'ck_quote_address_implies_client'
  )
ORDER BY constraint_name;
-- Expect exactly 10 rows.

-- ----------------------------------------------------------------------------
-- 8. Triggers and their functions.
--
-- (LP-SCHEMA-002R correction 7): information_schema.triggers can return
-- MULTIPLE ROWS for a single multi-event trigger (one row per event it
-- fires on), so raw row counts against that view over/undercount actual
-- trigger OBJECTS. Use pg_trigger (or SELECT DISTINCT trigger_name against
-- information_schema.triggers) to count real trigger objects instead.
-- ----------------------------------------------------------------------------
SELECT
    event_object_table AS table_name,
    trigger_name,
    action_timing,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- Global diagnostic inventory ONLY (DISTINCT trigger_name — each row above
-- is one (trigger, event) pair, not one object). This is NOT a contractual
-- assertion: a real database's `public` schema can legitimately host
-- triggers from other modules or legacy migrations, so "exactly N triggers
-- total in public" is not something LP-SCHEMA-002 can or should assert
-- (LP-SCHEMA-002T correction 2). Use it only to eyeball what exists; the
-- CONTRACTUAL check — that LP-SCHEMA-002's own 23 expected trigger objects
-- are present, each on the right table — is the scoped query below.
SELECT DISTINCT event_object_table AS table_name, trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY table_name, trigger_name;

-- CONTRACTUAL check (LP-SCHEMA-002T correction 2): the 23 trigger objects
-- LP-SCHEMA-002 itself is responsible for — 15 ZERO DELETE (fn_forbid_delete)
-- triggers, one per canonical table, plus 8 named business-rule triggers —
-- verified BOTH by name AND by the table each must be attached to. This
-- detects a missing expected trigger (fewer than 23 rows below) and an
-- expected trigger attached to the wrong table (present in the DISTINCT
-- trigger_name list above but absent from this exact (table,trigger) list).
-- Triggers NOT in this list (legacy/other-module triggers a shared database
-- may also carry) are diagnostics only, per the note above, and never fail
-- this check.
WITH expected(table_name, trigger_name) AS (
    VALUES
        ('issuing_company','trg_issuing_company_forbid_delete'),
        ('third_party','trg_third_party_forbid_delete'),
        ('third_party_contact','trg_third_party_contact_forbid_delete'),
        ('third_party_address','trg_third_party_address_forbid_delete'),
        ('catalog_item','trg_catalog_item_forbid_delete'),
        ('catalog_item_variant','trg_catalog_item_variant_forbid_delete'),
        ('cost_reference','trg_cost_reference_forbid_delete'),
        ('quote','trg_quote_forbid_delete'),
        ('quote_section','trg_quote_section_forbid_delete'),
        ('pricing_group','trg_pricing_group_forbid_delete'),
        ('quote_line','trg_quote_line_forbid_delete'),
        ('pricing_group_cost_item','trg_pgci_forbid_delete'),
        ('quote_sale_based_cost_item','trg_qsbci_forbid_delete'),
        ('quote_version','trg_quote_version_forbid_delete'),
        ('quote_version_calculation','trg_qvc_forbid_delete'),
        ('third_party','trg_third_party_guard_kind_change'),
        ('quote','trg_quote_client_role'),
        ('cost_reference','trg_cost_reference_supplier_role'),
        ('quote_line','trg_quote_line_status_role_consistency'),
        ('pricing_group','trg_pricing_group_role_change_guard'),
        ('quote_version','trg_quote_version_content_and_status_guard'),
        ('quote_version_calculation','trg_qvc_immutable'),
        ('quote_version','trg_quote_version_require_calculation')
)
SELECT
    e.table_name,
    e.trigger_name,
    (t.trigger_name IS NOT NULL) AS found_on_expected_table
FROM expected e
LEFT JOIN (
    SELECT DISTINCT event_object_table AS table_name, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
) t ON t.table_name = e.table_name AND t.trigger_name = e.trigger_name
ORDER BY e.table_name, e.trigger_name;
-- Expect exactly 23 rows, ALL with found_on_expected_table = true. A row
-- with found_on_expected_table = false means either the trigger is missing
-- entirely, or it exists but is attached to a different table than
-- contracted — both are LP-SCHEMA-002 violations regardless of what else
-- may exist in `public`.

-- (LP-SCHEMA-002R correction 5 documented the trigger, LP-SCHEMA-002S
-- correction 1 closed the INSERT-side gap by making the SAME trigger fire
-- on BOTH events.) Confirm trg_quote_version_content_and_status_guard is
-- defined on quote_version for BEFORE INSERT OR UPDATE, i.e. it appears
-- with event_manipulation IN ('INSERT','UPDATE') and action_timing='BEFORE'.
-- This is a READ-ONLY definition check (pg_trigger.tgtype bitmask, decoded
-- via pg_trigger directly rather than pg_get_triggerdef() text-matching) —
-- it is expected and CORRECT for information_schema.triggers to return TWO
-- rows for this ONE trigger object (one per event); do not mistake that for
-- two trigger objects — see the DISTINCT-based inventory above and note 7.
-- (LP-SCHEMA-002T correction 3): schema-qualified via pg_namespace, and
-- additionally pinned to table quote_version — a same-named trigger on an
-- unrelated table in another schema, or a same-named trigger accidentally
-- attached to the wrong table, must not be mistaken for this one.
SELECT
    t.tgname AS trigger_name,
    n.nspname AS schema_name,
    c.relname AS table_name,
    (t.tgtype & 2) <> 0  AS fires_before,
    (t.tgtype & 4) <> 0  AS fires_on_insert,
    (t.tgtype & 16) <> 0 AS fires_on_update
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname = 'quote_version'
  AND t.tgname = 'trg_quote_version_content_and_status_guard';
-- Expect exactly 1 row (one trigger OBJECT) with schema_name='public',
-- table_name='quote_version', fires_before=true, fires_on_insert=true,
-- fires_on_update=true — confirming BEFORE INSERT OR UPDATE on a single
-- object in the correct schema and table, per LP-SCHEMA-002S correction 1
-- and LP-SCHEMA-002T correction 3.

-- Functions backing the above, plus the emission validator and helpers.
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' END AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_finite_numeric',
    'fn_forbid_delete',
    'fn_third_party_guard_kind_change',
    'fn_check_quote_client_role',
    'fn_check_cost_reference_supplier_role',
    'fn_check_line_status_role_consistency',
    'fn_check_pricing_group_role_change_against_lines',
    'fn_quote_version_content_and_status_guard',
    'fn_quote_version_calculation_forbid_update',
    'fn_quote_version_require_calculation',
    'fn_next_quote_version_number',
    'fn_supersede_previous_quote_versions',
    'validate_quote_for_emission'
  )
ORDER BY p.proname;
-- Expect exactly 13 rows (was 12 before LP-SCHEMA-002R correction 2 added
-- fn_check_pricing_group_role_change_against_lines;
-- fn_quote_version_forbid_content_update was renamed/consolidated to
-- fn_quote_version_content_and_status_guard per correction 5).
-- is_finite_numeric must show IMMUTABLE.

-- ----------------------------------------------------------------------------
-- 9. Native ENUM types — provenance diagnostic only (LP-SCHEMA-002T
--    correction 5, same discipline as the out-of-scope-tables check in
--    §10). LP-SCHEMA-001/002 mandate TEXT + CHECK, never PostgreSQL native
--    ENUM, for alterability — that is an invariant about what THIS
--    migration creates (statically, zero `CREATE TYPE ... AS ENUM` in
--    sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql), NOT an assertion that
--    `public` must be globally free of ENUMs. A shared database may
--    already carry a native ENUM created by an unrelated module before
--    LP-SCHEMA-002 was ever applied; a non-empty result here is not
--    automatically a violation of THIS contract — it requires manual
--    attribution of the source before drawing any conclusion.
-- ----------------------------------------------------------------------------
SELECT t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype = 'e';
-- Any rows returned here were NOT created by LP-SCHEMA-002 (this script
-- defines no ENUM type). A non-empty result requires manual attribution,
-- not an automatic fail. The contractual guarantee — that LP-SCHEMA-002
-- itself never introduces a native ENUM — is verified statically by
-- inspecting sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql for the absence of
-- any `CREATE TYPE ... AS ENUM` statement (confirmed: zero occurrences).

-- ----------------------------------------------------------------------------
-- 10. Out-of-scope tables — provenance diagnostic only (LP-SCHEMA-002R
--     correction 12). LP-SCHEMA-002 explicitly excludes Invoice/Collection/
--     Payment/PurchaseOrder/Receipt/WorkItem/tender workflow tables from
--     THIS migration's own scope of creation. This query does NOT assert
--     these tables must be globally absent from the database — a database
--     that already hosts other, legacy, or shared schemas may legitimately
--     have tables with these names created by something other than
--     LP-SCHEMA-002. This check only distinguishes "created by
--     LP-SCHEMA-002" (never — this script creates none of them) from
--     "preexisting elsewhere" (a non-empty result here, on its own, is NOT
--     a violation of this contract; it simply means these names exist in
--     this schema from some other source and should be attributed
--     manually before drawing any conclusion).
-- ----------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'invoice','collection','payment','purchase_order','receipt',
    'work_item','tender_procedure','kit','solution'
  );
-- Any rows returned here were NOT created by LP-SCHEMA-002 (this script
-- issues no DDL for them). A non-empty result requires manual attribution
-- of the source, not an automatic fail.

-- ----------------------------------------------------------------------------
-- 11. quote_version vs quote_version_calculation separation — no financial
--     columns leaked into the commercial snapshot table.
-- ----------------------------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'quote_version'
  AND column_name IN ('engine_input','engine_output','profitability_snapshot','internal_calculation_snapshot');
-- SHOULD BE EMPTY.

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'quote_version_calculation'
ORDER BY column_name;
-- Expect exactly: calculation_schema_version, created_at, created_by,
-- engine_commit_sha, engine_contract_version, engine_input, engine_output,
-- internal_calculation_snapshot, quote_version_id (9 columns).

-- ----------------------------------------------------------------------------
-- 12. Extensions in use.
-- ----------------------------------------------------------------------------
SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';
-- Expect 1 row.

-- ============================================================================
-- END OF VERIFY SCRIPT — READ-ONLY, NO DDL/DML EXECUTED BY THIS FILE ITSELF
-- ============================================================================
