// server/emission/emitQuote.js
//
// LP-EMIT-004 — real implementation of the LP-EMIT-001 atomic quote emission
// operation (`docs/architecture/LP-EMIT-001_QUOTE_EMISSION_CONTRACT_V1.md`),
// built strictly on top of the already-approved foundation:
//   - server/emission/transactionCoordinator.js (LP-EMIT-003/003R) — owns
//     BEGIN / fixed isolation / fail-fast lock / COMMIT / ROLLBACK / release.
//   - quote-core (LP-ORCH-001) — the ONLY entry point into the financial
//     engine; never reimplemented here.
// `quote-core` is an ES module; this file is CommonJS (matching the rest of
// this repo's `api/*.js` handlers, e.g. `api/save-project.js`'s
// `await import('../src/lib/data_sanitize.js')` pattern), so it is loaded
// via a cached dynamic `import()` rather than `require()`.

'use strict';

const { runEmissionTransaction } = require('./transactionCoordinator.js');
const { loadQuote, loadQuoteAggregateRest } = require('./loadQuoteAggregate.js');
const { buildAllCommercialSnapshots } = require('./buildCommercialSnapshots.js');
const {
  QuoteNotEmittableError,
  FinancialCalculationRejectedError,
  PersistenceTransactionFailureError,
} = require('./emissionErrors.js');

// Re-thrown as-is by runEmissionTransaction on a lock conflict — imported
// only so this module's own try/catch can recognize it by identity if ever
// needed (currently it is simply allowed to propagate untouched).
const { EmissionCommitOutcomeUnknownError } = require('./transactionCoordinator.js');

let quoteCorePromise;
/** Cached dynamic import of the ES module `quote-core` package. */
function loadQuoteCore() {
  if (!quoteCorePromise) {
    quoteCorePromise = import('../../quote-core/src/index.js');
  }
  return quoteCorePromise;
}

const EMITTABLE_QUOTE_STATUSES = new Set(['DRAFT', 'ACTIVE']);

/**
 * emitQuote — LP-EMIT-001 §7, the full 14-step atomic emission sequence,
 * executed inside a single `transactionCoordinator.runEmissionTransaction`
 * call (one session, one transaction, fixed REPEATABLE READ, fail-fast row
 * lock, COMMIT/ROLLBACK/release all handled by the coordinator).
 *
 * @param {{ db: { acquireClient: () => Promise<any> }, quoteId: string, actorId?: string|null }} params
 * @returns {Promise<{
 *   quote_id: string, quote_version_id: string, version_number: number,
 *   status: 'ISSUED', issued_at: string,
 *   engine: { engine_commit_sha: string, engine_contract_version: string, calculation_schema_version: string },
 * }>}
 */
async function emitQuote({ db, quoteId, actorId = null }) {
  if (!quoteId) throw new TypeError('emitQuote: quoteId is required');

  const { calculateQuoteDraft, QUOTE_ENGINE_METADATA } = await loadQuoteCore();

  try {
    return await runEmissionTransaction(db, {
      lock: { sql: 'SELECT id, status FROM quote WHERE id = $1 FOR UPDATE NOWAIT', params: [quoteId] },
      run: async (client) => {
        // ── Paso 1 (parte 2): precondición explícita de lifecycle ──
        // (LP-EMIT-001S corrección 2 — validate_quote_for_emission NO
        // contiene este check; se aplica aquí, antes de cargar/calcular/
        // persistir cualquier otra cosa.)
        const quote = await loadQuote(client, quoteId);
        if (!quote) throw new QuoteNotEmittableError(['quote_exists']);
        if (!EMITTABLE_QUOTE_STATUSES.has(quote.status)) {
          throw new QuoteNotEmittableError(['quote.status']);
        }

        // ── Paso 2: cargar el agregado coherente (§2.1) ──
        const aggregate = await loadQuoteAggregateRest(client, quote);

        // ── Paso 3: validate_quote_for_emission(quote_id) (§2.3) ──
        const { rows: checks } = await client.query('SELECT * FROM validate_quote_for_emission($1)', [quoteId]);
        const failed = checks.filter((c) => c.passed === false);
        if (failed.length > 0) {
          throw new QuoteNotEmittableError(failed.map((c) => c.check_name), checks);
        }

        // ── Paso 4: construir el envelope financiero + sidecar de identidad ──
        const envelope = {
          quote: { id: quote.id },
          pricingGroups: aggregate.pricingGroups,
          pricingGroupCostItems: aggregate.pricingGroupCostItems,
          quoteSaleBasedCostItems: aggregate.quoteSaleBasedCostItems,
        };

        // ── Paso 5: calculateQuoteDraft(envelope) — única puerta al motor ──
        let draft;
        try {
          draft = calculateQuoteDraft(envelope);
        } catch (engineErr) {
          throw new FinancialCalculationRejectedError(engineErr);
        }

        // ── Paso 6-9: mapping de identidad, selección de supplemental,
        // snapshots comerciales (§5, §3, §4 — implementados en
        // buildCommercialSnapshots.js; también valida cardinalidad y
        // lanza EmissionInternalInvariantFailureError/
        // SupplementalCommercialInconsistencyError/
        // CommercialSnapshotIncompleteError según corresponda) ──
        const { commercialSnapshots, materialSupplementalByGroupId } = buildAllCommercialSnapshots({
          quote,
          issuingCompany: aggregate.issuingCompany,
          clientThirdParty: aggregate.client,
          contact: aggregate.contact,
          address: aggregate.address,
          sections: aggregate.sections,
          lines: aggregate.lines,
          pricingGroups: aggregate.pricingGroups,
          mainEngineOutput: draft.main.engineOutput,
          supplementalCalculations: draft.supplementalCalculations,
          catalogItemsById: aggregate.catalogItemsById,
        });

        // internal_calculation_snapshot — [] never null (LP-EMIT-001R corrección 10)
        const internalCalculationSnapshot = [...materialSupplementalByGroupId.values()].map((s) => ({
          pricing_group_id: s.pricing_group_id,
          quote_total_role: s.quote_total_role,
          engine_input: s.engine_input,
          engine_output: s.engine_output,
        }));

        // ── Paso 9: version_number (§2.3, dentro de la misma transacción) ──
        const {
          rows: [{ fn_next_quote_version_number: versionNumber }],
        } = await client.query('SELECT fn_next_quote_version_number($1)', [quoteId]);

        // ── Paso 10/§7.1: emission_timestamp/actor unificados ──
        const emissionTimestamp = new Date().toISOString();

        // ── Paso 10: INSERT quote_version, capturar new_version_id
        // (LP-EMIT-001C corrección 4 — el llamador conserva este id en
        // memoria desde el momento en que el INSERT retorna). ──
        const {
          rows: [{ id: newVersionId }],
        } = await client.query(
          `INSERT INTO quote_version
             (quote_id, version_number, commercial_snapshot_schema_version,
              quote_header_snapshot, issuer_snapshot, client_snapshot,
              commercial_lines_snapshot, terms_snapshot, issued_at, issued_by, status)
           VALUES ($1,$2,'v1',$3,$4,$5,$6,$7,$8,$9,'ISSUED')
           RETURNING id`,
          [
            quoteId,
            versionNumber,
            JSON.stringify(commercialSnapshots.quote_header_snapshot),
            JSON.stringify(commercialSnapshots.issuer_snapshot),
            JSON.stringify(commercialSnapshots.client_snapshot),
            JSON.stringify(commercialSnapshots.commercial_lines_snapshot),
            JSON.stringify(commercialSnapshots.terms_snapshot),
            emissionTimestamp,
            actorId,
          ],
        );

        // ── Paso 11: INSERT quote_version_calculation, 1:1, misma transacción ──
        await client.query(
          `INSERT INTO quote_version_calculation
             (quote_version_id, engine_input, engine_output, internal_calculation_snapshot,
              engine_commit_sha, engine_contract_version, calculation_schema_version,
              created_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            newVersionId,
            JSON.stringify(draft.main.engineInput),
            JSON.stringify(draft.main.engineOutput),
            JSON.stringify(internalCalculationSnapshot),
            QUOTE_ENGINE_METADATA.engineCommitSha,
            QUOTE_ENGINE_METADATA.engineContractVersion,
            QUOTE_ENGINE_METADATA.calculationSchemaVersion,
            emissionTimestamp,
            actorId,
          ],
        );

        // ── Paso 12: fn_supersede_previous_quote_versions ──
        await client.query('SELECT fn_supersede_previous_quote_versions($1, $2)', [quoteId, newVersionId]);

        // ── Paso 13: transición de estado de quote (§7 paso 13) ──
        // Decidida explícitamente en JS a partir del `quote.status` ya
        // leído bajo el lock (paso 1), no delegada a una expresión SQL
        // condicional — así el resultado de la transición es directamente
        // observable/testeable, y el único valor de entrada válido en este
        // punto ya es DRAFT o ACTIVE (ARCHIVED/VOID ya fueron rechazados).
        const newQuoteStatus = quote.status === 'DRAFT' ? 'ACTIVE' : quote.status;
        await client.query(
          'UPDATE quote SET status = $2, updated_at = $3, updated_by = $4 WHERE id = $1',
          [quoteId, newQuoteStatus, emissionTimestamp, actorId],
        );

        // ── Paso 14: COMMIT — gestionado por transactionCoordinator ──
        return {
          quote_id: quoteId,
          quote_version_id: newVersionId,
          version_number: versionNumber,
          status: 'ISSUED',
          issued_at: emissionTimestamp,
          engine: {
            engine_commit_sha: QUOTE_ENGINE_METADATA.engineCommitSha,
            engine_contract_version: QUOTE_ENGINE_METADATA.engineContractVersion,
            calculation_schema_version: QUOTE_ENGINE_METADATA.calculationSchemaVersion,
          },
        };
      },
    });
  } catch (err) {
    if (err instanceof EmissionCommitOutcomeUnknownError) {
      // LP-EMIT-001C §9.2A — map the spike's internal
      // EMISSION_COMMIT_OUTCOME_UNKNOWN to the single external canonical
      // code PERSISTENCE_TRANSACTION_FAILURE, preserving commit_outcome,
      // cause, and rollbackError. No retry, no re-emission, ever.
      throw new PersistenceTransactionFailureError({
        cause: err.cause,
        commitOutcome: err.commitOutcome,
        rollbackError: err.rollbackError,
      });
    }
    // EmissionConcurrencyConflictError, QuoteNotEmittableError,
    // FinancialCalculationRejectedError, EmissionInternalInvariantFailureError,
    // CommercialSnapshotIncompleteError, SupplementalCommercialInconsistencyError
    // are already correctly typed/coded — propagate untouched. Any other
    // (unexpected) error is a pre-COMMIT infrastructure failure already
    // resolved by ROLLBACK inside the coordinator — surface it as
    // PERSISTENCE_TRANSACTION_FAILURE without a commit_outcome field (the
    // outcome IS known: not committed).
    const KNOWN_CODES = new Set([
      'QUOTE_NOT_EMITTABLE',
      'EMISSION_CONCURRENCY_CONFLICT',
      'FINANCIAL_CALCULATION_REJECTED',
      'EMISSION_INTERNAL_INVARIANT_FAILURE',
      'COMMERCIAL_SNAPSHOT_INCOMPLETE',
      'SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY',
    ]);
    if (err && KNOWN_CODES.has(err.code)) throw err;
    throw new PersistenceTransactionFailureError({ cause: err });
  }
}

module.exports = { emitQuote };
