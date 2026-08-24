# LP-ORCH-001 — Quote Engine Adapter (v1)

**Estado:** implementado, cubierto por 31 tests unitarios (`node --test`), no persiste nada, no toca legacy/DB/Supabase/UI/API.

**Entrada canónica:**
- LP-SCHEMA-001 v1.3 — CLOSED / CANONICAL
- LP-SCHEMA-002 — CLOSED / EXECUTABLY VALIDATED / PUBLISHED (commit `46daa209e907bbb0eccab4a465340debc8c46729`)
- Engine consumido: `engine/src/pricingEngine.js`, commit `0421b8f28d075089320387d526c97d1f27adf764` (LP-ENG-002T)

**Paquete:** `quote-core/` (aislado — no vive dentro de `src/`, `api/` ni `index.html`).

## 1. Frontera: DB-shaped rows → engine

```
PostgreSQL-shaped rows (snake_case)
        ↓
quote-core/src/quoteEngineAdapter.js  (pure adapter / mapper)
        ↓
canonical engine input ({ groups, saleBasedCostItems })
        ↓
engine/src/pricingEngine.js :: computeQuoteCanonical
        ↓
canonical calculation output
```

El adapter **no consulta la base de datos**. Recibe un `envelope` ya cargado por el llamador:

```js
{
  quote,                       // fila quote (solo se usa quote.id para scoping)
  pricingGroups,                // filas completas de pricing_group
  pricingGroupCostItems,        // filas completas de pricing_group_cost_item
  quoteSaleBasedCostItems,       // filas completas de quote_sale_based_cost_item
}
```

Todas las filas llegan en snake_case exactamente como las devuelve PostgreSQL. El adapter nunca muta las filas de entrada (verificado por el test AC).

## 2. Reglas numeric → Number

Implementadas en `coerceFiniteNumber` / `toRequiredNumber` / `toOptionalNumber`:

- Acepta `number` finito, o `string` numérico válido (formato que devuelve el driver de PostgreSQL para columnas `NUMERIC`).
- Rechaza (con código de error estable): `null`/`undefined` en campo requerido (`REQUIRED_NUMERIC_FIELD_MISSING`), `NaN`/`Infinity`/`-Infinity` sea como `number` o como texto (`NON_FINITE_NUMERIC_FIELD` / `NON_NUMERIC_STRING_FIELD`), `''`/whitespace-only (`EMPTY_NUMERIC_FIELD`), y cualquier tipo no soportado (`UNSUPPORTED_NUMERIC_TYPE`).
- **Nunca** dependemos de `Number(null) === 0`: un campo requerido ausente es un rechazo explícito, nunca un cero implícito.
- Un campo NULLABLE ausente (`null`/`undefined`) se resuelve como propiedad **omitida** (`undefined`), nunca como `null` propagado al motor — el motor exige `undefined`, no `null`, para varios campos opcionales (crítico en `MARKUP_ON_COST.amountBasis`).
- `'0'` y `0` se preservan como cero real, nunca se confunden con ausencia.

## 3. snake_case → camelCase (CostItem)

`mapCostItemRow(row, label?)` mapea tanto `pricing_group_cost_item` como `quote_sale_based_cost_item` (mismo vocabulario en ambas tablas) al `CostItem` del motor:

| DB (snake_case)        | Engine (camelCase)   |
|-------------------------|-----------------------|
| `cost_calculation_mode` | `costCalculationMode` |
| `amount`                | `amount`               |
| `quantity`              | `quantity`             |
| `quantity_mode`         | `quantityMode`         |
| `rate`                  | `rate`                 |
| `cost_role`             | `costRole`             |
| `tax_treatment`         | `taxTreatment`         |
| `tax_rate`              | `taxRate`              |
| `documentation_status`  | `documentationStatus`  |
| `currency`              | `currency`             |

Reglas por modo:
- `DIRECT_AMOUNT`: envía `amount` (requerido) + `quantityMode` (requerido) + `quantity` (solo si la fila no es `NULL`); **nunca** envía `rate`.
- `PERCENT_OF_SALE_NET` / `PERCENT_OF_SALE_GROSS`: envía `rate` (requerido); **nunca** envía `amount`/`quantity`/`quantityMode`.
- `tax_rate` NULL → `taxRate` omitido.

## 4. snake_case → camelCase (PricingGroup)

`mapPricingGroupRow(groupRow, costItemRows, label?)` construye:

```js
{ quantity?, costItems, knownSaleBasedCosts, pricing }
```

- `quantity`: convertida a `Number` si la fila no es `NULL`; omitida si es `NULL`.
- `costItems`: filas `pricing_group_cost_item` con `status=ACTIVE` y `cost_scope=GROUP_BASE_COST` de ese mismo grupo.
- `knownSaleBasedCosts`: filas `pricing_group_cost_item` con `status=ACTIVE` y `cost_scope=GROUP_KNOWN_SALE_BASED_COST` de ese mismo grupo (ver §6, guard de ownership).
- `pricing`:
  - si `pricing_mode IS NULL` → `pricing = null` y **todos** los demás campos de pricing se omiten (grupo de solo costo).
  - si no es `NULL` → `{ mode, value, taxTreatment, currency, amountBasis?, profitTargetBasis?, taxRate? }`, donde `amount_basis`/`profit_target_basis`/`sale_tax_rate` con valor `NULL` en DB se traducen a propiedad **omitida**, nunca a `null` — obligatorio en particular para `MARKUP_ON_COST`, donde el motor exige `amountBasis === undefined`.

## 5. Tratamiento INCLUDED (main aggregate)

`buildMainEngineInput(envelope)` construye el único `engineInput` que se persistirá a futuro como `engine_input` de una `QuoteVersion`:

- Solo incluye `pricing_group` con `status=ACTIVE` **y** `quote_total_role=INCLUDED`.
- Excluye completamente `OPTIONAL` y `REFERENCE_ONLY`.
- Exige al menos un grupo ACTIVE+INCLUDED; si no existe, rechaza con `MAIN_INCLUDED_GROUP_REQUIRED`.
- `saleBasedCostItems` del resultado = `quote_sale_based_cost_item` con `quote_id=quote.id` y `status=ACTIVE`, mapeados con la misma semántica de CostItem.

`calculateMainQuote(envelope)` invoca `computeQuoteCanonical(engineInput)` **exactamente** (sin redondeo, sin rename, sin campos agregados) y retorna `{ engineInput, engineOutput }`.

## 6. Tratamiento OPTIONAL / REFERENCE_ONLY (supplemental)

`calculateSupplementalGroups(envelope)` toma cada `pricing_group` ACTIVE con `quote_total_role` `OPTIONAL` o `REFERENCE_ONLY` y lo calcula **por separado** — nunca se incluyen en el `engineInput` principal. Por cada grupo:

```js
{ pricing_group_id, quote_total_role, engine_input, engine_output }
```

con `engine_input = { groups: [mappedGroup], saleBasedCostItems: [] }` — nunca se prorratean ni copian automáticamente los `saleBasedCostItems` de alcance-cotización a un grupo supplemental (sin heurísticas). El arreglo resultante se llama `supplementalCalculations`; qué elementos son materialmente parte de una `QuoteVersion` lo decide la misión futura de emisión (LP-EMIT-001), no este adapter.

## 7. Ownership guard — GROUP_KNOWN_SALE_BASED_COST

Regla canónica LP-SCHEMA-001: una fila `pricing_group_cost_item` ACTIVE con `cost_scope=GROUP_KNOWN_SALE_BASED_COST` solo es consumible si el grupo dueño declara **explícitamente** `pricing_mode=TARGET_PROFIT_AMOUNT` y `profit_target_basis=FINAL_AFTER_KNOWN_COSTS` (nunca por default/omisión). Si existen filas así en cualquier otro tipo de grupo, `mapPricingGroupRow` rechaza antes de llegar al motor con el código estable `GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET`. El guard se aplica tanto a grupos del main como a grupos supplemental.

## 8. Quote-level sale based costs y el guard del propio engine

`saleBasedCostItems` de alcance-cotización (tabla `quote_sale_based_cost_item`) se mapean con la misma función `mapCostItemRow`. El adapter **no** intenta resolver el conflicto entre un grupo `FINAL_AFTER_KNOWN_COSTS` y `saleBasedCostItems` de cotización no vacíos — ese guard ya existe en `computeQuoteCanonical` (`FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS`) y el adapter simplemente **propaga** el error del motor sin capturarlo ni reinterpretarlo.

## 9. Metadata del engine

```js
export const QUOTE_ENGINE_METADATA = Object.freeze({
  engineCommitSha: '0421b8f28d075089320387d526c97d1f27adf764',
  engineContractVersion: 'LP-ENG-002T',
  calculationSchemaVersion: 'v1',
});
```

Esta metadata **no** se mezcla dentro de `engineInput` — es metadata para la futura capa de emisión (LP-EMIT-001), que decidirá cómo/si asociarla a una `QuoteVersion` persistida.

## 10. Qué NO hace este paquete

- No construye `quote_header_snapshot`, `issuer_snapshot`, `client_snapshot`, `commercial_lines_snapshot` ni `terms_snapshot`.
- No crea ni persiste ninguna `QuoteVersion`.
- No usa cliente de PostgreSQL ni de Supabase, no ejecuta SQL, no expone endpoints HTTP/API, no maneja auth ni RLS.
- No modifica `engine/`, `sql/`, la documentación de LP-SCHEMA-001/002, ni el `package.json`/`vercel.json` raíz.
- No toca el legacy (`src/`, `api/`, `index.html`).

Se prueba íntegramente con `cd quote-core && npm test`, sin infraestructura externa.

## 11. Frontera futura hacia LP-EMIT-001

`calculateQuoteDraft(envelope)` produce un cálculo **efímero** (`{ main: { engineInput, engineOutput }, supplementalCalculations }`) que LP-EMIT-001 consumirá para decidir:

- qué subconjunto de `supplementalCalculations` (si alguno) se vuelve materialmente parte de una `QuoteVersion` emitida;
- cómo se construyen los snapshots comerciales (`quote_header_snapshot`, etc.) a partir de datos que este adapter no conoce (issuer, client, líneas comerciales, términos);
- cómo se asocia `QUOTE_ENGINE_METADATA` a la versión persistida para trazabilidad del motor/contrato usado.

Este adapter es la única capa autorizada a invocar el motor con datos DB-shaped; LP-EMIT-001 debe consumir `calculateQuoteDraft`/`calculateMainQuote`/`calculateSupplementalGroups`, nunca reimplementar el mapeo.
