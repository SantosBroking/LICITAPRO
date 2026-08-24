-- ============================================================================
-- LP-SCHEMA-002 — Standalone Quote v1 — DDL PostgreSQL / Supabase (OFFLINE)
-- ============================================================================
-- Translates LP-SCHEMA-001 v1.3 (CLOSED / APPROVED / CANONICAL / PUBLISHED,
-- commit 1eddb0452ea94dbe7f1ff5d5e870972aac6f9f40 on feat/licita-engine-v1)
-- into executable, auditable PostgreSQL DDL.
--
-- THIS SCRIPT IS NOT APPLIED IN THIS MISSION. Offline artifact only.
-- No SQL was executed against Supabase or any live database.
--
-- Scope discipline (per LP-SCHEMA-002 mission):
--   - Does NOT redesign the domain. Every table/column/constraint here is a
--     direct translation of an already-closed LP-SCHEMA-001 v1.3 decision.
--   - Does NOT implement Invoice/Collection/Payment/PurchaseOrder/Receipt/
--     WorkItem/tender workflow/Drive/PDF/UI/RLS. Those remain out of scope.
--   - Does NOT reimplement pricingEngine.js formulas in SQL. The engine
--     remains the sole source of truth for financial calculation.
--   - ZERO DELETE is enforced at the DB level (see fn_forbid_delete below),
--     not only assumed at the application layer.
--
-- Where LP-SCHEMA-001 v1.3 left a cross-table invariant that PostgreSQL
-- cannot express as a single-table CHECK, this script prefers, in order:
--   1. a composite FK against a composite UNIQUE constraint (fully
--      declarative, preferred wherever the shape allows it);
--   2. a partial UNIQUE index (for "unique among ACTIVE rows" invariants);
--   3. a trigger/function (only when 1–2 are not expressible).
--
-- See docs/architecture/LP-SCHEMA-002_IMPLEMENTATION_NOTES.md for the full
-- mapping of every LP-SCHEMA-001 invariant to the mechanism used here.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ============================================================================
-- SECTION 0 — SHARED HELPER: finiteness of NUMERIC
-- ============================================================================
-- LP-SCHEMA-001 v1.3 §1 (Anexo A punto 17) is explicit: PostgreSQL NUMERIC
-- CAN represent NaN / Infinity / -Infinity, and "value = value" is an
-- INCORRECT way to exclude NaN in PostgreSQL (NaN = NaN evaluates TRUE for
-- numeric, unlike IEEE-754 float semantics). This helper instead compares
-- the textual representation against the three special values explicitly.
-- IMMUTABLE so it can be used inside CHECK constraints.
CREATE OR REPLACE FUNCTION is_finite_numeric(p_value NUMERIC)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_value IS NOT NULL
     AND p_value::text NOT IN ('NaN', 'Infinity', '-Infinity');
$$;

COMMENT ON FUNCTION is_finite_numeric(NUMERIC) IS
  'Excludes NaN/Infinity/-Infinity for NUMERIC. Does NOT use "value = value" '
  '(incorrect for PostgreSQL NUMERIC, where NaN = NaN is TRUE). Callers must '
  'combine with "col IS NULL OR is_finite_numeric(col)" when the column is '
  'nullable and NULL is a valid state distinct from non-finite.';

-- ============================================================================
-- SECTION 0.1 — SHARED TRIGGER: ZERO DELETE enforcement
-- ============================================================================
-- Applied to every domain table below (BEFORE DELETE). The application layer
-- already never issues DELETE per LP-SCHEMA-001 §12; this trigger makes that
-- a DB-enforced guarantee rather than an application-only convention.
CREATE OR REPLACE FUNCTION fn_forbid_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ZERO DELETE: hard delete is not permitted on table %. Use status=ARCHIVED/VOID/MERGED instead.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$;

-- ============================================================================
-- SECTION 1 — issuing_company
-- ============================================================================
CREATE TABLE issuing_company (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         TEXT NOT NULL,
    legal_name   TEXT NOT NULL,
    tax_id       TEXT NULL,
    status       TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID NULL,
    updated_by   UUID NULL,
    CONSTRAINT uq_issuing_company_code UNIQUE (code),
    CONSTRAINT ck_issuing_company_code CHECK (code IN ('BROKING','SATHRI')),
    CONSTRAINT ck_issuing_company_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

CREATE TRIGGER trg_issuing_company_forbid_delete
    BEFORE DELETE ON issuing_company
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 2 — third_party
-- ============================================================================
CREATE TABLE third_party (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind             TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    legal_name       TEXT NULL,
    tax_id           TEXT NULL,
    merged_into_id   UUID NULL REFERENCES third_party(id),
    status           TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID NULL,
    updated_by       UUID NULL,
    CONSTRAINT ck_third_party_kind CHECK (kind IN ('CLIENT','SUPPLIER','BOTH')),
    CONSTRAINT ck_third_party_status CHECK (status IN ('ACTIVE','ARCHIVED','MERGED')),
    CONSTRAINT ck_third_party_merged_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

CREATE INDEX ix_third_party_tax_id ON third_party (tax_id);

-- Composite unique to support the FK-compuesta from quote/third_party_contact/
-- third_party_address back to (third_party_id, id) pairs.
-- (LP-SCHEMA-002R correction 9): uq_third_party_id UNIQUE(id) removed —
-- third_party.id is already the PRIMARY KEY, and no composite FK in this
-- contract references (third_party_id, id) against third_party, so the
-- extra UNIQUE was redundant. Composite UNIQUEs that ARE used by FKs
-- (uq_tpc_third_party_id_id, uq_tpa_third_party_id_id below) are kept.

CREATE TRIGGER trg_third_party_forbid_delete
    BEFORE DELETE ON third_party
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- Third-party role consistency (LP-SCHEMA-001 §11 / §R correction 7).
-- Cross-table by nature (kind lives on third_party, usage lives on quote/
-- cost_reference) — implemented as a trigger per mission §5, guarding BOTH
-- directions: the consumer INSERT/UPDATE, and an incompatible kind change
-- on third_party that would orphan existing references.
CREATE OR REPLACE FUNCTION fn_third_party_guard_kind_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.kind = OLD.kind THEN
        RETURN NEW;
    END IF;

    IF NEW.kind NOT IN ('CLIENT','BOTH') AND EXISTS (
        SELECT 1 FROM quote WHERE client_third_party_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'Cannot change third_party % kind to % — it is referenced as client_third_party_id by existing quote(s)', NEW.id, NEW.kind;
    END IF;

    IF NEW.kind NOT IN ('SUPPLIER','BOTH') AND EXISTS (
        SELECT 1 FROM cost_reference WHERE supplier_third_party_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'Cannot change third_party % kind to % — it is referenced as supplier_third_party_id by existing cost_reference row(s)', NEW.id, NEW.kind;
    END IF;

    RETURN NEW;
END;
$$;
-- NOTE: this trigger is created AFTER `quote` and `cost_reference` exist
-- (see bottom of Section 8/7) because it references both tables; the
-- CREATE TRIGGER statement itself is deferred to the end of this script,
-- immediately after cost_reference is created, to keep object dependency
-- order valid. See "trg_third_party_guard_kind_change" near Section 7.

-- ============================================================================
-- SECTION 3 — third_party_contact
-- ============================================================================
CREATE TABLE third_party_contact (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    third_party_id  UUID NOT NULL REFERENCES third_party(id),
    full_name       TEXT NOT NULL,
    role_label      TEXT NULL,
    email           TEXT NULL,
    phone           TEXT NULL,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID NULL,
    updated_by      UUID NULL,
    CONSTRAINT ck_third_party_contact_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

-- Composite unique to support quote.client_contact_id FK-compuesta.
ALTER TABLE third_party_contact ADD CONSTRAINT uq_tpc_third_party_id_id UNIQUE (third_party_id, id);

CREATE UNIQUE INDEX uq_third_party_contact_primary
    ON third_party_contact (third_party_id)
    WHERE is_primary AND status = 'ACTIVE';

CREATE TRIGGER trg_third_party_contact_forbid_delete
    BEFORE DELETE ON third_party_contact
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 4 — third_party_address
-- ============================================================================
CREATE TABLE third_party_address (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    third_party_id  UUID NOT NULL REFERENCES third_party(id),
    address_kind    TEXT NULL,
    line1           TEXT NULL,
    line2           TEXT NULL,
    city            TEXT NULL,
    state           TEXT NULL,
    postal_code     TEXT NULL,
    country         TEXT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID NULL,
    updated_by      UUID NULL,
    CONSTRAINT ck_third_party_address_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

-- Composite unique to support quote.client_address_id FK-compuesta.
ALTER TABLE third_party_address ADD CONSTRAINT uq_tpa_third_party_id_id UNIQUE (third_party_id, id);

CREATE TRIGGER trg_third_party_address_forbid_delete
    BEFORE DELETE ON third_party_address
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 5 — catalog_item  (DR1 closed: unified, PRODUCT/SERVICE only)
-- ============================================================================
CREATE TABLE catalog_item (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                     TEXT NOT NULL,
    sku                      TEXT NULL,
    name                     TEXT NOT NULL,
    commercial_description   TEXT NULL,
    technical_description    TEXT NULL,
    default_unit_label       TEXT NULL,
    status                   TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID NULL,
    updated_by               UUID NULL,
    CONSTRAINT ck_catalog_item_kind CHECK (kind IN ('PRODUCT','SERVICE')),
    CONSTRAINT ck_catalog_item_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

CREATE UNIQUE INDEX uq_catalog_item_sku ON catalog_item (sku) WHERE sku IS NOT NULL;

-- Composite unique to support quote_line's declarative origin_kind <-> kind
-- integrity FK (Section 11, correction 6).
ALTER TABLE catalog_item ADD CONSTRAINT uq_catalog_item_id_kind UNIQUE (id, kind);

CREATE TRIGGER trg_catalog_item_forbid_delete
    BEFORE DELETE ON catalog_item
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 6 — catalog_item_variant
-- ============================================================================
CREATE TABLE catalog_item_variant (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_item_id  UUID NOT NULL REFERENCES catalog_item(id),
    variant_label    TEXT NOT NULL,
    attributes       JSONB NULL,
    status           TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID NULL,
    updated_by       UUID NULL,
    CONSTRAINT ck_catalog_item_variant_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

-- Composite unique to support quote_line's (catalog_item_id, catalog_item_variant_id)
-- FK-compuesta against (catalog_item_id, id) — "variant belongs to the same
-- catalog_item" (LP-SCHEMA-001 §11 / correction 6), fully declarative.
ALTER TABLE catalog_item_variant ADD CONSTRAINT uq_civ_item_id_id UNIQUE (catalog_item_id, id);

CREATE TRIGGER trg_catalog_item_variant_forbid_delete
    BEFORE DELETE ON catalog_item_variant
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 7 — cost_reference
-- ============================================================================
CREATE TABLE cost_reference (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_item_id           UUID NULL REFERENCES catalog_item(id),
    supplier_third_party_id   UUID NULL REFERENCES third_party(id),
    amount                    NUMERIC NOT NULL,
    currency                  TEXT NOT NULL,
    tax_treatment             TEXT NOT NULL,
    tax_rate                  NUMERIC NULL,
    documentation_status      TEXT NOT NULL,
    observed_at               DATE NOT NULL,
    notes                     TEXT NULL,
    status                    TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NULL,
    updated_by                UUID NULL,
    CONSTRAINT ck_cost_reference_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_cost_reference_tax_treatment CHECK (tax_treatment IN ('IVA_INCLUDED','IVA_ADDITIONAL','ZERO_RATE','EXEMPT','UNKNOWN')),
    CONSTRAINT ck_cost_reference_tax_rate CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND is_finite_numeric(tax_rate))),
    CONSTRAINT ck_cost_reference_documentation_status CHECK (documentation_status IN ('DOCUMENTED','NOT_DOCUMENTED','UNCONFIRMED')),
    CONSTRAINT ck_cost_reference_status CHECK (status IN ('ACTIVE','ARCHIVED')),
    CONSTRAINT ck_cost_reference_amount_finite CHECK (is_finite_numeric(amount))
);

CREATE TRIGGER trg_cost_reference_forbid_delete
    BEFORE DELETE ON cost_reference
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- Supplier role consistency (LP-SCHEMA-001 §11 / correction 7).
CREATE OR REPLACE FUNCTION fn_check_cost_reference_supplier_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_kind TEXT;
BEGIN
    IF NEW.supplier_third_party_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT kind INTO v_kind FROM third_party WHERE id = NEW.supplier_third_party_id;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'cost_reference.supplier_third_party_id % not found', NEW.supplier_third_party_id;
    END IF;
    IF v_kind NOT IN ('SUPPLIER','BOTH') THEN
        RAISE EXCEPTION 'cost_reference.supplier_third_party_id % must reference a third_party with kind SUPPLIER or BOTH, found %', NEW.supplier_third_party_id, v_kind;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cost_reference_supplier_role
    BEFORE INSERT OR UPDATE OF supplier_third_party_id ON cost_reference
    FOR EACH ROW EXECUTE FUNCTION fn_check_cost_reference_supplier_role();

-- Now that both `quote` (below, Section 8) and `cost_reference` exist is
-- required for fn_third_party_guard_kind_change's body; the trigger
-- attachment itself is created here, immediately after cost_reference,
-- but BEFORE `quote` — PostgreSQL allows creating the trigger on
-- third_party referencing a function whose body mentions `quote` even
-- before `quote` exists, because the function body is only parsed at
-- CALL time, not at CREATE FUNCTION time (plpgsql is late-bound). The
-- trigger attachment statement itself is deferred to the very end of this
-- script for readability and to avoid any doubt about object ordering.

-- ============================================================================
-- SECTION 8 — quote
-- ============================================================================
CREATE TABLE quote (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio                    TEXT NULL,
    issuing_company_id       UUID NULL REFERENCES issuing_company(id),
    client_third_party_id    UUID NULL REFERENCES third_party(id),
    client_contact_id        UUID NULL,
    client_address_id        UUID NULL,
    reference_label          TEXT NULL,
    currency                 TEXT NOT NULL,
    valid_until              DATE NULL,
    display_mode             TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'DRAFT',
    terms_text               TEXT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID NULL,
    updated_by               UUID NULL,
    CONSTRAINT ck_quote_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_quote_display_mode CHECK (display_mode IN ('COMPONENT_PRICING','CONSOLIDATED_PRICING','MIXED_PRICING')),
    CONSTRAINT ck_quote_status CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED','VOID')),
    -- folio implies issuer (LP-SCHEMA-001 correction 9).
    CONSTRAINT ck_quote_folio_implies_issuer CHECK (folio IS NULL OR issuing_company_id IS NOT NULL),
    -- client contact/address nullability implication (correction 7, v1.3).
    CONSTRAINT ck_quote_contact_implies_client CHECK (client_contact_id IS NULL OR client_third_party_id IS NOT NULL),
    CONSTRAINT ck_quote_address_implies_client CHECK (client_address_id IS NULL OR client_third_party_id IS NOT NULL)
);

-- Folio uniqueness conceptual (issuing_company_id, folio) when folio NOT NULL.
CREATE UNIQUE INDEX uq_quote_issuer_folio ON quote (issuing_company_id, folio) WHERE folio IS NOT NULL;

-- Composite unique to support pricing_group/quote_sale_based_cost_item
-- currency-consistency FKs, and quote_section/pricing_group/quote_line
-- cross-quote identity FKs.
ALTER TABLE quote ADD CONSTRAINT uq_quote_id_currency UNIQUE (id, currency);

-- client_contact_id / client_address_id must belong to the same
-- client_third_party_id (LP-SCHEMA-001 correction 8). Composite FK with
-- default MATCH SIMPLE: any NULL among (client_third_party_id,
-- client_contact_id) skips the check, which is why the two CHECK
-- constraints above (ck_quote_contact_implies_client /
-- ck_quote_address_implies_client) are still required as a belt-and-braces
-- companion — MATCH SIMPLE alone would NOT catch "contact set, third_party
-- null".
ALTER TABLE quote ADD CONSTRAINT fk_quote_client_contact
    FOREIGN KEY (client_third_party_id, client_contact_id)
    REFERENCES third_party_contact (third_party_id, id);

ALTER TABLE quote ADD CONSTRAINT fk_quote_client_address
    FOREIGN KEY (client_third_party_id, client_address_id)
    REFERENCES third_party_address (third_party_id, id);

CREATE TRIGGER trg_quote_forbid_delete
    BEFORE DELETE ON quote
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- Client role consistency (LP-SCHEMA-001 correction 7): client_third_party_id
-- must reference a third_party with kind CLIENT or BOTH.
CREATE OR REPLACE FUNCTION fn_check_quote_client_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_kind TEXT;
BEGIN
    IF NEW.client_third_party_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT kind INTO v_kind FROM third_party WHERE id = NEW.client_third_party_id;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'quote.client_third_party_id % not found', NEW.client_third_party_id;
    END IF;
    IF v_kind NOT IN ('CLIENT','BOTH') THEN
        RAISE EXCEPTION 'quote.client_third_party_id % must reference a third_party with kind CLIENT or BOTH, found %', NEW.client_third_party_id, v_kind;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quote_client_role
    BEFORE INSERT OR UPDATE OF client_third_party_id ON quote
    FOR EACH ROW EXECUTE FUNCTION fn_check_quote_client_role();

-- Now that `quote` exists, attach the third_party kind-change guard trigger
-- declared (as a function) back in Section 2.
CREATE TRIGGER trg_third_party_guard_kind_change
    BEFORE UPDATE OF kind ON third_party
    FOR EACH ROW EXECUTE FUNCTION fn_third_party_guard_kind_change();

-- ============================================================================
-- SECTION 9 — quote_section
-- ============================================================================
CREATE TABLE quote_section (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id       UUID NOT NULL REFERENCES quote(id),
    label          TEXT NOT NULL,
    display_order  INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID NULL,
    updated_by     UUID NULL,
    CONSTRAINT ck_quote_section_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);

-- Unique only among ACTIVE rows (LP-SCHEMA-001 correction 10): archiving a
-- section frees its display_order slot for reuse.
CREATE UNIQUE INDEX uq_quote_section_active_order
    ON quote_section (quote_id, display_order)
    WHERE status = 'ACTIVE';

-- Composite unique to support quote_line's cross-quote identity FK.
ALTER TABLE quote_section ADD CONSTRAINT uq_quote_section_quote_id_id UNIQUE (quote_id, id);

CREATE TRIGGER trg_quote_section_forbid_delete
    BEFORE DELETE ON quote_section
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 10 — pricing_group
-- ============================================================================
CREATE TABLE pricing_group (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id              UUID NOT NULL REFERENCES quote(id),
    quantity              NUMERIC NULL,
    pricing_mode          TEXT NULL,
    amount_basis          TEXT NULL,
    profit_target_basis   TEXT NULL,
    pricing_value         NUMERIC NULL,
    sale_tax_treatment    TEXT NULL,
    sale_tax_rate         NUMERIC NULL,
    quote_total_role      TEXT NOT NULL,
    currency              TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NULL,
    updated_by            UUID NULL,

    CONSTRAINT ck_pricing_group_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_pricing_group_status CHECK (status IN ('ACTIVE','ARCHIVED')),
    CONSTRAINT ck_pricing_group_total_role CHECK (quote_total_role IN ('INCLUDED','OPTIONAL','REFERENCE_ONLY')),
    CONSTRAINT ck_pricing_group_amount_basis_domain CHECK (amount_basis IS NULL OR amount_basis IN ('PER_UNIT','TOTAL')),
    CONSTRAINT ck_pricing_group_ptb_domain CHECK (profit_target_basis IS NULL OR profit_target_basis IN ('BASE_COST_BEFORE_SALE_BASED_COSTS','FINAL_AFTER_KNOWN_COSTS')),
    CONSTRAINT ck_pricing_group_tax_treatment_domain CHECK (sale_tax_treatment IS NULL OR sale_tax_treatment IN ('IVA_INCLUDED','IVA_ADDITIONAL','ZERO_RATE','EXEMPT','UNKNOWN')),
    CONSTRAINT ck_pricing_group_tax_rate CHECK (sale_tax_rate IS NULL OR (sale_tax_rate >= 0 AND is_finite_numeric(sale_tax_rate))),
    CONSTRAINT ck_pricing_group_quantity_finite CHECK (quantity IS NULL OR is_finite_numeric(quantity)),
    CONSTRAINT ck_pricing_group_value_finite CHECK (pricing_value IS NULL OR is_finite_numeric(pricing_value)),

    -- amount_basis='PER_UNIT' => quantity NOT NULL and finite
    -- (LP-SCHEMA-001 v1.3 correction 1 — pricing_group.quantity).
    CONSTRAINT ck_pricing_group_per_unit_requires_quantity CHECK (
        amount_basis IS DISTINCT FROM 'PER_UNIT'
        OR (quantity IS NOT NULL AND is_finite_numeric(quantity))
    ),

    -- Full compound shape per pricing_mode (LP-SCHEMA-001 v1.2 correction 4).
    CONSTRAINT ck_pricing_group_mode_shape CHECK (
        (
            pricing_mode IS NULL
            AND amount_basis IS NULL
            AND profit_target_basis IS NULL
            AND pricing_value IS NULL
            AND sale_tax_treatment IS NULL
            AND sale_tax_rate IS NULL
        )
        OR (
            pricing_mode = 'MARKUP_ON_COST'
            AND amount_basis IS NULL
            AND profit_target_basis IS NULL
            AND pricing_value IS NOT NULL
            AND sale_tax_treatment IS NOT NULL
        )
        OR (
            pricing_mode = 'PRICE_DIRECT'
            AND amount_basis IN ('PER_UNIT','TOTAL')
            AND profit_target_basis IS NULL
            AND pricing_value IS NOT NULL
            AND sale_tax_treatment IS NOT NULL
        )
        OR (
            pricing_mode = 'TARGET_PROFIT_AMOUNT'
            AND amount_basis IN ('PER_UNIT','TOTAL')
            AND (profit_target_basis IS NULL OR profit_target_basis IN ('BASE_COST_BEFORE_SALE_BASED_COSTS','FINAL_AFTER_KNOWN_COSTS'))
            AND pricing_value IS NOT NULL
            AND sale_tax_treatment IS NOT NULL
        )
        OR (
            pricing_mode = 'BUDGET_CEILING'
            AND amount_basis = 'TOTAL'
            AND profit_target_basis IS NULL
            AND pricing_value IS NOT NULL
            AND sale_tax_treatment IS NOT NULL
        )
    )
);

-- Composite uniques for downstream declarative FKs.
ALTER TABLE pricing_group ADD CONSTRAINT uq_pricing_group_quote_id_id UNIQUE (quote_id, id);
ALTER TABLE pricing_group ADD CONSTRAINT uq_pricing_group_id_currency UNIQUE (id, currency);

-- Currency consistency with quote.currency — fully declarative composite FK
-- (LP-SCHEMA-001 §9/§11), no trigger required.
ALTER TABLE pricing_group ADD CONSTRAINT fk_pricing_group_quote_currency
    FOREIGN KEY (quote_id, currency) REFERENCES quote (id, currency);

CREATE TRIGGER trg_pricing_group_forbid_delete
    BEFORE DELETE ON pricing_group
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 11 — quote_line
-- ============================================================================
CREATE TABLE quote_line (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id                  UUID NOT NULL REFERENCES quote(id),
    quote_section_id          UUID NOT NULL,
    pricing_group_id          UUID NULL,
    origin_kind               TEXT NOT NULL,
    catalog_item_id           UUID NULL,
    catalog_item_variant_id   UUID NULL,
    source_snapshot           JSONB NULL,
    commercial_description    TEXT NOT NULL,
    technical_description     TEXT NULL,
    quantity                  NUMERIC NOT NULL,
    unit_label                TEXT NULL,
    line_status               TEXT NOT NULL,
    display_order             INTEGER NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NULL,
    updated_by                UUID NULL,

    CONSTRAINT ck_quote_line_origin_kind CHECK (origin_kind IN ('PRODUCT','SERVICE','KIT','SOLUTION','FREE_CONCEPT')),
    CONSTRAINT ck_quote_line_line_status CHECK (line_status IN ('PRICED','INCLUDED','OPTIONAL','REFERENCE_NOT_INCLUDED')),
    CONSTRAINT ck_quote_line_status CHECK (status IN ('ACTIVE','ARCHIVED')),

    -- Quantity finiteness is a blanket data-hygiene rule; the additional
    -- ">0" requirement is an EMISSION-time rule per LP-SCHEMA-001 v1.3
    -- ("debe ser finita y > 0 para una línea comercial emitible" — the
    -- "para ser emitible" phrasing is conditional on emission, not a
    -- blanket column constraint that would block legitimate incomplete
    -- DRAFT capture at quantity=0). The >0 check is therefore enforced in
    -- validate_quote_for_emission(), not here. See implementation notes.
    CONSTRAINT ck_quote_line_quantity_finite CHECK (is_finite_numeric(quantity)),

    -- catalog_item_variant_id requires catalog_item_id (LP-SCHEMA-001
    -- correction 6). Companion CHECK to the composite FK below — MATCH
    -- SIMPLE alone would not catch "variant set, item null".
    CONSTRAINT ck_quote_line_variant_requires_item CHECK (catalog_item_variant_id IS NULL OR catalog_item_id IS NOT NULL),

    -- KIT/SOLUTION require source_snapshot; FREE_CONCEPT already has
    -- commercial_description NOT NULL as its sole comercial source
    -- (free_text_label removed entirely per v1.3 correction 3).
    CONSTRAINT ck_quote_line_kit_solution_snapshot CHECK (
        origin_kind NOT IN ('KIT','SOLUTION') OR source_snapshot IS NOT NULL
    ),

    -- PRICED/INCLUDED require a pricing_group. OPTIONAL may be temporarily
    -- ungrouped during DRAFT (enforced only at emission, not here).
    -- REFERENCE_NOT_INCLUDED may remain ungrouped permanently.
    CONSTRAINT ck_quote_line_group_required_for_priced_included CHECK (
        line_status NOT IN ('PRICED','INCLUDED') OR pricing_group_id IS NOT NULL
    )
);

-- Cross-quote identity, declarative composite FKs (LP-SCHEMA-001 correction
-- K / v1.3 §4/§11): a quote_line cannot reference a quote_section or a
-- pricing_group belonging to a DIFFERENT quote than its own quote_id.
ALTER TABLE quote_line ADD CONSTRAINT fk_quote_line_section
    FOREIGN KEY (quote_id, quote_section_id) REFERENCES quote_section (quote_id, id);

ALTER TABLE quote_line ADD CONSTRAINT fk_quote_line_pricing_group
    FOREIGN KEY (quote_id, pricing_group_id) REFERENCES pricing_group (quote_id, id);

-- PRODUCT/SERVICE origin integrity, declarative composite FK against
-- catalog_item(id, kind): MATCH SIMPLE skips the check when catalog_item_id
-- is NULL (any origin_kind, including KIT/SOLUTION/FREE_CONCEPT). When
-- catalog_item_id IS NOT NULL, the pair (catalog_item_id, origin_kind) must
-- exist in catalog_item(id, kind) — and because catalog_item.kind only ever
-- takes the values PRODUCT/SERVICE (ck_catalog_item_kind), this single FK
-- ALSO structurally forbids catalog_item_id from ever being populated when
-- origin_kind IN ('KIT','SOLUTION','FREE_CONCEPT'): no catalog_item row can
-- ever match kind='KIT' (etc.), so the FK would fail. This single
-- declarative constraint fully covers LP-SCHEMA-001 correction 6's
-- PRODUCT/SERVICE/KIT/SOLUTION/FREE_CONCEPT integrity rule for
-- catalog_item_id, without any trigger.
ALTER TABLE quote_line ADD CONSTRAINT fk_quote_line_catalog_item_kind
    FOREIGN KEY (catalog_item_id, origin_kind) REFERENCES catalog_item (id, kind);

-- Variant must belong to the same catalog_item_id declared on the line
-- (LP-SCHEMA-001 §11 correction 6), declarative composite FK.
ALTER TABLE quote_line ADD CONSTRAINT fk_quote_line_variant
    FOREIGN KEY (catalog_item_id, catalog_item_variant_id) REFERENCES catalog_item_variant (catalog_item_id, id);

-- display_order unique only among ACTIVE rows within the same section
-- (correction 10).
CREATE UNIQUE INDEX uq_quote_line_active_order
    ON quote_line (quote_section_id, display_order)
    WHERE status = 'ACTIVE';

-- "At most one anchor line per pricing_group" (LP-SCHEMA-001 §4.10): a
-- partial unique index on pricing_group_id restricted to the three
-- anchor line_status values structurally caps it at <=1 ACTIVE anchor
-- per group. Combined with the role-consistency trigger below (which
-- ensures the anchor's line_status matches the group's quote_total_role),
-- this gives "at most one, and of the right kind" declaratively. The
-- ">= 1 anchor at emission" half of "exactamente una" (v1.3 correction 5)
-- cannot be expressed as a structural constraint (it depends on emission
-- timing, not row-level shape) and is checked in
-- validate_quote_for_emission() instead.
CREATE UNIQUE INDEX uq_pricing_group_single_anchor
    ON quote_line (pricing_group_id)
    WHERE status = 'ACTIVE' AND line_status IN ('PRICED','OPTIONAL','REFERENCE_NOT_INCLUDED');

CREATE TRIGGER trg_quote_line_forbid_delete
    BEFORE DELETE ON quote_line
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- line_status <-> pricing_group.quote_total_role consistency
-- (LP-SCHEMA-001 v1.3 correction 3/§4.10) — cross-table, trigger-enforced.
CREATE OR REPLACE FUNCTION fn_check_line_status_role_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF NEW.pricing_group_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT quote_total_role INTO v_role FROM pricing_group WHERE id = NEW.pricing_group_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'quote_line.pricing_group_id % not found', NEW.pricing_group_id;
    END IF;

    IF v_role = 'INCLUDED' AND NEW.line_status NOT IN ('PRICED','INCLUDED') THEN
        RAISE EXCEPTION 'quote_line.line_status % is not allowed for a pricing_group with quote_total_role=INCLUDED (allowed: PRICED, INCLUDED)', NEW.line_status;
    ELSIF v_role = 'OPTIONAL' AND NEW.line_status NOT IN ('OPTIONAL','INCLUDED') THEN
        RAISE EXCEPTION 'quote_line.line_status % is not allowed for a pricing_group with quote_total_role=OPTIONAL (allowed: OPTIONAL, INCLUDED)', NEW.line_status;
    ELSIF v_role = 'REFERENCE_ONLY' AND NEW.line_status NOT IN ('REFERENCE_NOT_INCLUDED','INCLUDED') THEN
        RAISE EXCEPTION 'quote_line.line_status % is not allowed for a pricing_group with quote_total_role=REFERENCE_ONLY (allowed: REFERENCE_NOT_INCLUDED, INCLUDED)', NEW.line_status;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quote_line_status_role_consistency
    BEFORE INSERT OR UPDATE OF pricing_group_id, line_status ON quote_line
    FOR EACH ROW EXECUTE FUNCTION fn_check_line_status_role_consistency();

-- Reverse-direction guard (LP-SCHEMA-002R correction 2): the trigger above
-- only checks new/changed quote_line rows against the group's CURRENT role.
-- It does not stop pricing_group.quote_total_role itself from being changed
-- out from under quote_line rows that were already valid for the OLD role.
-- This BEFORE UPDATE OF quote_total_role trigger on pricing_group closes
-- that gap: it rejects the role change if any ACTIVE quote_line attached to
-- this group would become invalid under the NEW role, using the same
-- matrix as fn_check_line_status_role_consistency(). ARCHIVED lines are
-- deliberately excluded from this check (an archived line must never block
-- a legitimate role change on its former group).
CREATE OR REPLACE FUNCTION fn_check_pricing_group_role_change_against_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_bad_count INTEGER;
BEGIN
    IF NEW.quote_total_role = OLD.quote_total_role THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_bad_count
    FROM quote_line ql
    WHERE ql.pricing_group_id = NEW.id
      AND ql.status = 'ACTIVE'
      AND NOT (
          (NEW.quote_total_role = 'INCLUDED' AND ql.line_status IN ('PRICED','INCLUDED'))
          OR (NEW.quote_total_role = 'OPTIONAL' AND ql.line_status IN ('OPTIONAL','INCLUDED'))
          OR (NEW.quote_total_role = 'REFERENCE_ONLY' AND ql.line_status IN ('REFERENCE_NOT_INCLUDED','INCLUDED'))
      );

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'pricing_group % cannot change quote_total_role from % to %: % ACTIVE quote_line row(s) would become incompatible (ARCHIVED lines are exempt from this check)',
            NEW.id, OLD.quote_total_role, NEW.quote_total_role, v_bad_count;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_group_role_change_guard
    BEFORE UPDATE OF quote_total_role ON pricing_group
    FOR EACH ROW EXECUTE FUNCTION fn_check_pricing_group_role_change_against_lines();

-- ============================================================================
-- SECTION 12 — pricing_group_cost_item  (ownership GROUP_FINAL)
-- ============================================================================
CREATE TABLE pricing_group_cost_item (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pricing_group_id          UUID NOT NULL REFERENCES pricing_group(id),
    cost_scope                TEXT NOT NULL,
    cost_calculation_mode     TEXT NOT NULL,
    amount                    NUMERIC NULL,
    quantity                  NUMERIC NULL,
    quantity_mode             TEXT NULL,
    rate                      NUMERIC NULL,
    cost_role                 TEXT NOT NULL,
    tax_treatment             TEXT NOT NULL,
    tax_rate                  NUMERIC NULL,
    documentation_status      TEXT NOT NULL,
    currency                  TEXT NOT NULL,
    source_cost_reference_id  UUID NULL REFERENCES cost_reference(id) ON DELETE RESTRICT,
    status                    TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NULL,
    updated_by                UUID NULL,

    CONSTRAINT ck_pgci_cost_scope CHECK (cost_scope IN ('GROUP_BASE_COST','GROUP_KNOWN_SALE_BASED_COST')),
    CONSTRAINT ck_pgci_calc_mode_domain CHECK (cost_calculation_mode IN ('DIRECT_AMOUNT','PERCENT_OF_SALE_NET','PERCENT_OF_SALE_GROSS')),
    CONSTRAINT ck_pgci_quantity_mode_domain CHECK (quantity_mode IS NULL OR quantity_mode IN ('PER_UNIT','PER_LOT','FIXED_TOTAL')),
    CONSTRAINT ck_pgci_cost_role CHECK (cost_role IN ('LINE_BACKING','INTERNAL_ONLY')),
    CONSTRAINT ck_pgci_tax_treatment CHECK (tax_treatment IN ('IVA_INCLUDED','IVA_ADDITIONAL','ZERO_RATE','EXEMPT','UNKNOWN')),
    CONSTRAINT ck_pgci_tax_rate CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND is_finite_numeric(tax_rate))),
    CONSTRAINT ck_pgci_documentation_status CHECK (documentation_status IN ('DOCUMENTED','NOT_DOCUMENTED','UNCONFIRMED')),
    CONSTRAINT ck_pgci_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_pgci_status CHECK (status IN ('ACTIVE','ARCHIVED')),
    CONSTRAINT ck_pgci_amount_finite CHECK (amount IS NULL OR is_finite_numeric(amount)),
    CONSTRAINT ck_pgci_quantity_finite CHECK (quantity IS NULL OR is_finite_numeric(quantity)),
    CONSTRAINT ck_pgci_rate_finite CHECK (rate IS NULL OR is_finite_numeric(rate)),

    -- GROUP_BASE_COST restricted to DIRECT_AMOUNT only (LP-SCHEMA-001 §4.12 /
    -- correction C — the engine computes group.costItems before
    -- ventaNetReference/ventaGrossReference exist).
    CONSTRAINT ck_pgci_scope_mode CHECK (
        (cost_scope = 'GROUP_BASE_COST' AND cost_calculation_mode = 'DIRECT_AMOUNT')
        OR cost_scope = 'GROUP_KNOWN_SALE_BASED_COST'
    ),

    -- Exclusivity of fields by cost_calculation_mode (v1.3 correction 4).
    CONSTRAINT ck_pgci_mode_field_shape CHECK (
        (
            cost_calculation_mode = 'DIRECT_AMOUNT'
            AND amount IS NOT NULL
            AND quantity_mode IS NOT NULL
            AND rate IS NULL
        )
        OR (
            cost_calculation_mode IN ('PERCENT_OF_SALE_NET','PERCENT_OF_SALE_GROSS')
            AND rate IS NOT NULL
            AND amount IS NULL
            AND quantity_mode IS NULL
            AND quantity IS NULL
        )
    )
);

ALTER TABLE pricing_group_cost_item ADD CONSTRAINT fk_pgci_currency
    FOREIGN KEY (pricing_group_id, currency) REFERENCES pricing_group (id, currency);

CREATE TRIGGER trg_pgci_forbid_delete
    BEFORE DELETE ON pricing_group_cost_item
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 13 — quote_sale_based_cost_item  (ownership QUOTE_LEVEL)
-- ============================================================================
CREATE TABLE quote_sale_based_cost_item (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id                  UUID NOT NULL REFERENCES quote(id),
    cost_calculation_mode     TEXT NOT NULL,
    amount                    NUMERIC NULL,
    quantity                  NUMERIC NULL,
    quantity_mode             TEXT NULL,
    rate                      NUMERIC NULL,
    cost_role                 TEXT NOT NULL,
    tax_treatment             TEXT NOT NULL,
    tax_rate                  NUMERIC NULL,
    documentation_status      TEXT NOT NULL,
    currency                  TEXT NOT NULL,
    source_cost_reference_id  UUID NULL REFERENCES cost_reference(id) ON DELETE RESTRICT,
    status                    TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NULL,
    updated_by                UUID NULL,

    CONSTRAINT ck_qsbci_calc_mode_domain CHECK (cost_calculation_mode IN ('DIRECT_AMOUNT','PERCENT_OF_SALE_NET','PERCENT_OF_SALE_GROSS')),
    CONSTRAINT ck_qsbci_quantity_mode_domain CHECK (quantity_mode IS NULL OR quantity_mode IN ('PER_UNIT','PER_LOT','FIXED_TOTAL')),
    CONSTRAINT ck_qsbci_cost_role CHECK (cost_role IN ('LINE_BACKING','INTERNAL_ONLY')),
    CONSTRAINT ck_qsbci_tax_treatment CHECK (tax_treatment IN ('IVA_INCLUDED','IVA_ADDITIONAL','ZERO_RATE','EXEMPT','UNKNOWN')),
    CONSTRAINT ck_qsbci_tax_rate CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND is_finite_numeric(tax_rate))),
    CONSTRAINT ck_qsbci_documentation_status CHECK (documentation_status IN ('DOCUMENTED','NOT_DOCUMENTED','UNCONFIRMED')),
    CONSTRAINT ck_qsbci_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_qsbci_status CHECK (status IN ('ACTIVE','ARCHIVED')),
    CONSTRAINT ck_qsbci_amount_finite CHECK (amount IS NULL OR is_finite_numeric(amount)),
    CONSTRAINT ck_qsbci_quantity_finite CHECK (quantity IS NULL OR is_finite_numeric(quantity)),
    CONSTRAINT ck_qsbci_rate_finite CHECK (rate IS NULL OR is_finite_numeric(rate)),

    -- All three modes are valid for QUOTE_LEVEL; exclusivity of fields
    -- still applies identically to pricing_group_cost_item (correction 4).
    CONSTRAINT ck_qsbci_mode_field_shape CHECK (
        (
            cost_calculation_mode = 'DIRECT_AMOUNT'
            AND amount IS NOT NULL
            AND quantity_mode IS NOT NULL
            AND rate IS NULL
        )
        OR (
            cost_calculation_mode IN ('PERCENT_OF_SALE_NET','PERCENT_OF_SALE_GROSS')
            AND rate IS NOT NULL
            AND amount IS NULL
            AND quantity_mode IS NULL
            AND quantity IS NULL
        )
    )
);

ALTER TABLE quote_sale_based_cost_item ADD CONSTRAINT fk_qsbci_currency
    FOREIGN KEY (quote_id, currency) REFERENCES quote (id, currency);

CREATE TRIGGER trg_qsbci_forbid_delete
    BEFORE DELETE ON quote_sale_based_cost_item
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- ============================================================================
-- SECTION 14 — quote_version  (immutable — commercial snapshot ONLY)
-- ============================================================================
CREATE TABLE quote_version (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id                            UUID NOT NULL REFERENCES quote(id),
    version_number                      INTEGER NOT NULL,
    commercial_snapshot_schema_version  TEXT NOT NULL,
    quote_header_snapshot               JSONB NOT NULL,
    issuer_snapshot                     JSONB NOT NULL,
    client_snapshot                     JSONB NOT NULL,
    commercial_lines_snapshot           JSONB NOT NULL,
    terms_snapshot                      JSONB NULL,
    issued_at                           TIMESTAMPTZ NOT NULL,
    issued_by                           UUID NULL,
    status                              TEXT NOT NULL DEFAULT 'ISSUED',

    CONSTRAINT ck_quote_version_status CHECK (status IN ('ISSUED','SUPERSEDED','VOID')),
    CONSTRAINT uq_quote_version_number UNIQUE (quote_id, version_number)
);

CREATE TRIGGER trg_quote_version_forbid_delete
    BEFORE DELETE ON quote_version
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- Content immutability + status lifecycle, consolidated into ONE trigger
-- covering BOTH INSERT and UPDATE (LP-SCHEMA-002R correction 5;
-- LP-SCHEMA-002S correction 1 closed the remaining gap on the INSERT side;
-- LP-SCHEMA-002T correction 1 added `id` itself to the immutable-content
-- comparison below — it was omitted before, which meant the PK was only
-- ever protected indirectly via FKs, not by this trigger directly).
-- Only `status` may ever change after INSERT (content, including `id`, is
-- fully immutable), and status itself only ever moves along the canonical
-- state machine:
--   INSERT     -> NEW.status MUST be exactly 'ISSUED' (enforced here, in
--                 the TG_OP='INSERT' branch below — NOT by a CHECK
--                 constraint, since a CHECK cannot distinguish INSERT from
--                 UPDATE and would wrongly block later legitimate
--                 transitions). ck_quote_version_status (on the table)
--                 only restricts the DOMAIN of possible status values
--                 (ISSUED/SUPERSEDED/VOID) — it does NOT enforce which
--                 value is legal at INSERT time; that is this trigger's job.
--                 DEFAULT 'ISSUED' on the column is a convenience for
--                 callers that omit the column — it does not, by itself,
--                 stop an explicit INSERT ... status='SUPERSEDED' or
--                 status='VOID', which is exactly the gap this trigger's
--                 INSERT branch closes.
--   UPDATE:
--   ISSUED     -> {ISSUED, SUPERSEDED, VOID}
--   SUPERSEDED -> {SUPERSEDED, VOID}
--   VOID       -> {VOID}
-- All other UPDATE transitions (SUPERSEDED->ISSUED, VOID->ISSUED,
-- VOID->SUPERSEDED, or any status value outside the three) are rejected.
-- fn_supersede_previous_quote_versions() below is unaffected — it only
-- ever writes ISSUED -> SUPERSEDED via UPDATE, which remains permitted.
CREATE OR REPLACE FUNCTION fn_quote_version_content_and_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'ISSUED' THEN
            RAISE EXCEPTION 'quote_version must be INSERTed with status=ISSUED (got %); SUPERSEDED/VOID are only reachable via a subsequent UPDATE', NEW.status;
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE' from here on.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.commercial_snapshot_schema_version IS DISTINCT FROM OLD.commercial_snapshot_schema_version
       OR NEW.quote_header_snapshot IS DISTINCT FROM OLD.quote_header_snapshot
       OR NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot
       OR NEW.client_snapshot IS DISTINCT FROM OLD.client_snapshot
       OR NEW.commercial_lines_snapshot IS DISTINCT FROM OLD.commercial_lines_snapshot
       OR NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
    THEN
        RAISE EXCEPTION 'quote_version content is immutable after INSERT; only status may change (id=%)', OLD.id;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'ISSUED' AND NEW.status IN ('ISSUED','SUPERSEDED','VOID'))
            OR (OLD.status = 'SUPERSEDED' AND NEW.status IN ('SUPERSEDED','VOID'))
            OR (OLD.status = 'VOID' AND NEW.status = 'VOID')
        ) THEN
            RAISE EXCEPTION 'quote_version % cannot transition status from % to %; allowed: ISSUED->{ISSUED,SUPERSEDED,VOID}, SUPERSEDED->{SUPERSEDED,VOID}, VOID->{VOID}',
                OLD.id, OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ONE trigger object, two events (INSERT OR UPDATE) — this does not add a
-- second trigger and does not change the 23-trigger-object count.
CREATE TRIGGER trg_quote_version_content_and_status_guard
    BEFORE INSERT OR UPDATE ON quote_version
    FOR EACH ROW EXECUTE FUNCTION fn_quote_version_content_and_status_guard();

-- ============================================================================
-- SECTION 15 — quote_version_calculation  (immutable — internal ONLY, 1:1)
-- ============================================================================
CREATE TABLE quote_version_calculation (
    quote_version_id             UUID PRIMARY KEY REFERENCES quote_version(id),
    engine_input                 JSONB NOT NULL,
    engine_output                JSONB NOT NULL,
    internal_calculation_snapshot JSONB NULL,
    engine_commit_sha            TEXT NOT NULL,
    engine_contract_version      TEXT NOT NULL,
    calculation_schema_version   TEXT NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                   UUID NULL
);

CREATE TRIGGER trg_qvc_forbid_delete
    BEFORE DELETE ON quote_version_calculation
    FOR EACH ROW EXECUTE FUNCTION fn_forbid_delete();

-- Fully immutable: no column, including status-equivalents, may change.
CREATE OR REPLACE FUNCTION fn_quote_version_calculation_forbid_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'quote_version_calculation is fully immutable after INSERT (quote_version_id=%)', OLD.quote_version_id;
END;
$$;

CREATE TRIGGER trg_qvc_immutable
    BEFORE UPDATE ON quote_version_calculation
    FOR EACH ROW EXECUTE FUNCTION fn_quote_version_calculation_forbid_update();

-- Deferred integrity: at COMMIT time, every quote_version row inserted in
-- the transaction must have a matching quote_version_calculation row.
-- The PK/FK shape on quote_version_calculation alone only guarantees "at
-- most one" (LP-SCHEMA-001 v1.3 correction 11) — "exactly one, atomically"
-- is what this DEFERRABLE constraint trigger adds (per mission LP-SCHEMA-002
-- §13/§16, "si es seguro y limpio"). Correction (LP-SCHEMA-002R #6): this is
-- a ROW-LEVEL constraint trigger, not a once-per-transaction check — every
-- quote_version row INSERTed schedules its OWN deferred check, and each
-- scheduled check runs (by default at end-of-transaction, or earlier under
-- SET CONSTRAINTS ... IMMEDIATE) independently for that row. It must never
-- be described as "firing once per transaction." This is judged safe: it
-- only ever fires on quote_version INSERT, and the orchestrator's emission
-- transaction always inserts both rows together per LP-SCHEMA-001 §14/§6.
CREATE OR REPLACE FUNCTION fn_quote_version_require_calculation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM quote_version_calculation WHERE quote_version_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'quote_version % committed without a matching quote_version_calculation row', NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_quote_version_require_calculation
    AFTER INSERT ON quote_version
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_quote_version_require_calculation();

-- ============================================================================
-- SECTION 16 — Orchestration helpers (NOT the engine; relational support only)
-- ============================================================================

-- Next version_number for a quote. True concurrency safety requires the
-- caller to have already locked the parent `quote` row (SELECT ... FOR
-- UPDATE) within the same transaction, per LP-SCHEMA-001 §11/§14 and
-- LP-SCHEMA-002 §15's documented transactional pattern — this function
-- alone does not acquire that lock (see implementation notes for why a
-- row lock on `quote` is the chosen mechanism instead of a separate
-- sequence/table).
CREATE OR REPLACE FUNCTION fn_next_quote_version_number(p_quote_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(MAX(version_number), 0) + 1
    FROM quote_version
    WHERE quote_id = p_quote_id;
$$;

-- Atomically supersede all currently-ISSUED versions of a quote except the
-- one just created (used immediately after inserting the new
-- quote_version + quote_version_calculation pair, within the same
-- transaction that holds the `quote` row lock).
CREATE OR REPLACE FUNCTION fn_supersede_previous_quote_versions(p_quote_id UUID, p_new_version_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE quote_version
    SET status = 'SUPERSEDED'
    WHERE quote_id = p_quote_id
      AND status = 'ISSUED'
      AND id <> p_new_version_id;
$$;

-- ----------------------------------------------------------------------------
-- validate_quote_for_emission(p_quote_id)
-- ----------------------------------------------------------------------------
-- Read-only relational validator. Does NOT invoke or substitute
-- pricingEngine.js, does NOT compute prices, and does NOT mutate any row.
-- Returns one row per check, so the orchestrator can inspect every failure
-- at once rather than only the first. A caller should treat the emission
-- as blocked if ANY row has passed = false.
CREATE OR REPLACE FUNCTION validate_quote_for_emission(p_quote_id UUID)
RETURNS TABLE (check_name TEXT, passed BOOLEAN, detail TEXT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_issuing_company_id UUID;
    v_client_id UUID;
    v_client_kind TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM quote WHERE id = p_quote_id) THEN
        RETURN QUERY SELECT 'quote_exists'::TEXT, FALSE, format('quote %s not found', p_quote_id);
        RETURN;
    END IF;

    SELECT issuing_company_id, client_third_party_id
      INTO v_issuing_company_id, v_client_id
      FROM quote WHERE id = p_quote_id;

    -- 1. issuer_present
    RETURN QUERY SELECT 'issuer_present'::TEXT, v_issuing_company_id IS NOT NULL,
        CASE WHEN v_issuing_company_id IS NULL THEN 'quote.issuing_company_id is NULL' ELSE 'ok' END;

    -- 2. client_present
    RETURN QUERY SELECT 'client_present'::TEXT, v_client_id IS NOT NULL,
        CASE WHEN v_client_id IS NULL THEN 'quote.client_third_party_id is NULL' ELSE 'ok' END;

    -- 3. client_role_valid (defensive re-check; also enforced by trigger at write time)
    IF v_client_id IS NOT NULL THEN
        SELECT kind INTO v_client_kind FROM third_party WHERE id = v_client_id;
        RETURN QUERY SELECT 'client_role_valid'::TEXT, v_client_kind IN ('CLIENT','BOTH'),
            format('third_party.kind=%s (expected CLIENT or BOTH)', v_client_kind);
    ELSE
        RETURN QUERY SELECT 'client_role_valid'::TEXT, FALSE, 'no client to validate (see client_present)';
    END IF;

    -- 4. main_group_present: at least one ACTIVE INCLUDED pricing_group
    -- (aggregateQuote requires >=1 group; OPTIONAL/REFERENCE_ONLY alone do
    -- not constitute the main aggregate — LP-SCHEMA-001 v1.3 correction 6).
    RETURN QUERY SELECT 'main_group_present'::TEXT,
        EXISTS (
            SELECT 1 FROM pricing_group
            WHERE quote_id = p_quote_id AND status = 'ACTIVE' AND quote_total_role = 'INCLUDED'
        ),
        'requires >=1 ACTIVE pricing_group with quote_total_role=INCLUDED';

    -- 5. anchor_exactness: for every ACTIVE, priced pricing_group of this
    -- quote, exactly one matching ACTIVE anchor line must exist. The <=1
    -- half is already guaranteed structurally by uq_pricing_group_single_anchor;
    -- here we additionally require >=1 (i.e. exactly one, combined).
    RETURN QUERY
    SELECT
        'anchor_exactness'::TEXT,
        NOT EXISTS (
            SELECT 1
            FROM pricing_group pg
            WHERE pg.quote_id = p_quote_id
              AND pg.status = 'ACTIVE'
              AND pg.pricing_mode IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM quote_line ql
                  WHERE ql.pricing_group_id = pg.id
                    AND ql.status = 'ACTIVE'
                    AND (
                        (pg.quote_total_role = 'INCLUDED' AND ql.line_status = 'PRICED')
                        OR (pg.quote_total_role = 'OPTIONAL' AND ql.line_status = 'OPTIONAL')
                        OR (pg.quote_total_role = 'REFERENCE_ONLY' AND ql.line_status = 'REFERENCE_NOT_INCLUDED')
                    )
              )
        ),
        'every ACTIVE pricing_group with pricing_mode NOT NULL must have exactly one matching ACTIVE anchor line';

    -- 5b. active_line_group_active (LP-SCHEMA-002R correction 3): an ACTIVE
    -- quote_line that points to a pricing_group must point to a group that
    -- is itself ACTIVE (not ARCHIVED). This is an emission-time check only
    -- (NOT a permanent structural CHECK constraint), because a line may
    -- legitimately reference an archived group transiently during DRAFT
    -- editing before being re-pointed or archived itself.
    RETURN QUERY
    SELECT
        'active_line_group_active'::TEXT,
        NOT EXISTS (
            SELECT 1
            FROM quote_line ql
            JOIN pricing_group pg ON pg.id = ql.pricing_group_id
            WHERE ql.quote_id = p_quote_id
              AND ql.status = 'ACTIVE'
              AND ql.pricing_group_id IS NOT NULL
              AND pg.status <> 'ACTIVE'
        ),
        'no ACTIVE quote_line may reference a pricing_group whose status is not ACTIVE';

    -- 5c. priced_anchor_group_commercial (LP-SCHEMA-002R correction 4): a
    -- "priced anchor" line (PRICED, OPTIONAL, or REFERENCE_NOT_INCLUDED with
    -- a non-null pricing_group_id) must reference a pricing_group that is
    -- ACTIVE and has pricing_mode IS NOT NULL. A pricing_group with
    -- pricing_mode NULL is cost-only/internal, not commercial, and must not
    -- back a commercial anchor. REFERENCE_NOT_INCLUDED with a NULL
    -- pricing_group_id remains valid and is not evaluated by this check;
    -- cost-only internal groups may exist without any quote_line at all.
    RETURN QUERY
    SELECT
        'priced_anchor_group_commercial'::TEXT,
        NOT EXISTS (
            SELECT 1
            FROM quote_line ql
            JOIN pricing_group pg ON pg.id = ql.pricing_group_id
            WHERE ql.quote_id = p_quote_id
              AND ql.status = 'ACTIVE'
              AND ql.pricing_group_id IS NOT NULL
              AND ql.line_status IN ('PRICED','OPTIONAL','REFERENCE_NOT_INCLUDED')
              AND (pg.status <> 'ACTIVE' OR pg.pricing_mode IS NULL)
        ),
        'a priced anchor (PRICED/OPTIONAL/REFERENCE_NOT_INCLUDED with non-null pricing_group_id) must reference an ACTIVE pricing_group with pricing_mode IS NOT NULL';

    -- 6. line_status_role_valid: holistic re-check across the whole quote
    -- (the trigger enforces this per-write; this is a defensive full scan).
    RETURN QUERY
    SELECT
        'line_status_role_valid'::TEXT,
        NOT EXISTS (
            SELECT 1
            FROM quote_line ql
            JOIN pricing_group pg ON pg.id = ql.pricing_group_id
            WHERE ql.quote_id = p_quote_id
              AND ql.status = 'ACTIVE'
              AND NOT (
                  (pg.quote_total_role = 'INCLUDED' AND ql.line_status IN ('PRICED','INCLUDED'))
                  OR (pg.quote_total_role = 'OPTIONAL' AND ql.line_status IN ('OPTIONAL','INCLUDED'))
                  OR (pg.quote_total_role = 'REFERENCE_ONLY' AND ql.line_status IN ('REFERENCE_NOT_INCLUDED','INCLUDED'))
              )
        ),
        'no ACTIVE quote_line may combine a line_status incompatible with its pricing_group.quote_total_role';

    -- 7. optional_not_orphan: no ACTIVE OPTIONAL line without a pricing_group
    RETURN QUERY
    SELECT
        'optional_not_orphan'::TEXT,
        NOT EXISTS (
            SELECT 1 FROM quote_line
            WHERE quote_id = p_quote_id AND status = 'ACTIVE'
              AND line_status = 'OPTIONAL' AND pricing_group_id IS NULL
        ),
        'an OPTIONAL line may be ungrouped during DRAFT but not at emission';

    -- 8. currency_consistent (defensive; structurally guaranteed by composite FKs)
    RETURN QUERY SELECT 'currency_consistent'::TEXT, TRUE,
        'guaranteed structurally by fk_pricing_group_quote_currency / fk_pgci_currency / fk_qsbci_currency';

    -- 9. ownership_guard: FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS
    -- Literal, no heuristic, no semantic matching, no proration
    -- (LP-SCHEMA-001 §12 / LP-SCHEMA-002 §12).
    RETURN QUERY
    SELECT
        'ownership_guard_final_target'::TEXT,
        NOT (
            EXISTS (
                SELECT 1 FROM pricing_group
                WHERE quote_id = p_quote_id AND status = 'ACTIVE'
                  AND quote_total_role = 'INCLUDED'
                  AND pricing_mode = 'TARGET_PROFIT_AMOUNT'
                  AND profit_target_basis = 'FINAL_AFTER_KNOWN_COSTS'
            )
            AND EXISTS (
                SELECT 1 FROM quote_sale_based_cost_item
                WHERE quote_id = p_quote_id AND status = 'ACTIVE'
            )
        ),
        'FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS: an INCLUDED group using TARGET_PROFIT_AMOUNT + FINAL_AFTER_KNOWN_COSTS cannot coexist with ACTIVE quote_sale_based_cost_item rows for the main aggregate';

    -- 10. emittable_lines_valid: quantity > 0 and finite for every ACTIVE line
    -- (LP-SCHEMA-001 v1.3 correction 2 — the ">0" half is emission-scoped).
    RETURN QUERY
    SELECT
        'emittable_lines_quantity_valid'::TEXT,
        NOT EXISTS (
            SELECT 1 FROM quote_line
            WHERE quote_id = p_quote_id AND status = 'ACTIVE'
              AND (NOT is_finite_numeric(quantity) OR quantity <= 0)
        ),
        'every ACTIVE quote_line must have a finite quantity > 0 to be emitted';

    -- 11. catalog_origin_integrity (defensive; structurally guaranteed by
    -- fk_quote_line_catalog_item_kind / fk_quote_line_variant)
    RETURN QUERY SELECT 'catalog_origin_integrity'::TEXT, TRUE,
        'guaranteed structurally by fk_quote_line_catalog_item_kind / fk_quote_line_variant';

END;
$$;

COMMENT ON FUNCTION validate_quote_for_emission(UUID) IS
  'Read-only relational pre-emission validator for LP-SCHEMA-001/LP-SCHEMA-002. '
  'Does not invoke pricingEngine.js and does not compute prices. Caller must '
  'treat emission as blocked if any returned row has passed=false.';

-- ============================================================================
-- SECTION 17 — Seeds
-- ============================================================================
-- issuing_company.legal_name is NOT NULL per LP-SCHEMA-001 §4.1.
--
-- BROKING (LP-SCHEMA-002R correction 10): Control Tower has confirmed the
-- real corporate data via Índice Maestro IM-001/IM-020. Inserted as a real,
-- uncommented row. No other corporate data is added beyond what was
-- confirmed.
INSERT INTO issuing_company (code, legal_name, tax_id, status) VALUES
  ('BROKING', 'BROKING AND BRANDS GROUP, S.A. de C.V.', 'BBG1007304K0', 'ACTIVE');

-- SATHRI (LP-SCHEMA-002R correction 11): tax_id (RFC SAT190911445) and
-- corporate type (S.A.P.I. de C.V.) are confirmed, but the literal
-- legal_name transcription remains "PENDIENTE DE VALIDAR" in the Índice
-- Maestro. This seed MUST stay commented/unexecuted — no legal_name may be
-- invented or normalized (e.g. do NOT assume "SATHRI, S.A.P.I. de C.V." is
-- the literal registered name). See DECISION_REQUIRED in the implementation
-- notes: "SATHRI legal_name literal exacto para seed" — this blocks only
-- this seed row, not the rest of the DDL's approval.
--
-- INSERT INTO issuing_company (code, legal_name, tax_id, status) VALUES
--   ('SATHRI', '<LITERAL LEGAL NAME — PENDIENTE DE VALIDAR>', 'SAT190911445', 'ACTIVE');
--
-- Left commented out deliberately. Do not uncomment without the literal
-- legal_name confirmed by Corporate Office / Índice Maestro.

-- ============================================================================
-- END OF LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql — NOT APPLIED IN THIS MISSION
-- ============================================================================
