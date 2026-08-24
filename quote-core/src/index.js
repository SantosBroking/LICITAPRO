// quote-core/src/index.js
//
// LP-ORCH-001 — API pública deliberada de `quote-core`. Solo expone lo que
// una capa consumidora (futuro LP-EMIT-001, o pruebas) necesita; helpers
// internos del adapter (coerceFiniteNumber, assertEnvelopeScope, etc.)
// permanecen no exportados.

export {
  QUOTE_ENGINE_METADATA,
  ADAPTER_ERROR_CODES,
  QuoteEngineAdapterError,
  mapCostItemRow,
  mapPricingGroupRow,
  buildMainEngineInput,
  calculateMainQuote,
  calculateSupplementalGroups,
  calculateQuoteDraft,
} from './quoteEngineAdapter.js';
