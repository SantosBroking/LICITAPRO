# LP-SCHEMA-002 — Implementation Notes: Standalone Quote v1 DDL

Preparado por: SATHIA AI — LICITACIONES CORE (rol de ejecutor técnico, no Control Tower)
Fecha: 24-ago-2026
Estado: OFFLINE. No aplicado. No hay SQL ejecutado contra Supabase ni ninguna base de datos real.
Fuente canónica: `docs/architecture/LP-SCHEMA-001_STANDALONE_QUOTE_V1.md` v1.3 — CLOSED / APPROVED / CANONICAL / PUBLISHED (commit remoto `1eddb0452ea94dbe7f1ff5d5e870972aac6f9f40`, branch `feat/licita-engine-v1`).
Artefactos hermanos: `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql`, `sql/LP-SCHEMA-002_VERIFY_STANDALONE_QUOTE_V1.sql`.

Esta misión NO rediseña el dominio. Cada objeto SQL descrito aquí es una traducción directa de una decisión ya cerrada en LP-SCHEMA-001 v1.3. Donde PostgreSQL obligó a elegir una implementación concreta entre varias formas posibles de expresar el mismo invariante, esa elección se documenta explícitamente en la sección 6.

---

## 1. Mapping LP-SCHEMA-001 → objetos SQL

| Entidad LP-SCHEMA-001 | Tabla SQL | Notas |
|---|---|---|
| IssuingCompany | `issuing_company` | Set cerrado `BROKING`/`SATHRI` vía CHECK. |
| ThirdParty | `third_party` | `kind` CLIENT/SUPPLIER/BOTH; `merged_into_id` ZERO DELETE. |
| ThirdPartyContact | `third_party_contact` | Unique parcial `is_primary` por tercero ACTIVE. |
| ThirdPartyAddress | `third_party_address` | Sin normalización geográfica. |
| CatalogItem (DR1 opción A) | `catalog_item` | Solo PRODUCT/SERVICE; `commercial_description`/`technical_description` (v1.3 corrección 2). |
| CatalogItemVariant | `catalog_item_variant` | — |
| CostReference | `cost_reference` | Vínculos salientes `RESTRICT`, nunca `SET NULL`. |
| Quote | `quote` | `client_contact_id`/`client_address_id` (v1.3 corrección 7/8); sin `work_item_id`. |
| QuoteSection (DR2 opción A) | `quote_section` | Unicidad de orden solo entre `ACTIVE`. |
| PricingGroup | `pricing_group` | `pricing_mode` nullable; `quote_total_role`; `quantity` obligatoria bajo `PER_UNIT`. |
| QuoteLine | `quote_line` | Campos comerciales mínimos; sin `free_text_label`; integridad PRODUCT/SERVICE/variant. |
| PricingGroupCostItem (GROUP_FINAL) | `pricing_group_cost_item` | Exclusividad de campos por modo; `GROUP_BASE_COST` solo `DIRECT_AMOUNT`. |
| QuoteSaleBasedCostItem (QUOTE_LEVEL) | `quote_sale_based_cost_item` | Los tres modos válidos. |
| QuoteVersion (DR3 sustituida) | `quote_version` | Exclusivamente snapshot comercial. |
| QuoteVersionCalculation (nueva en v1.1) | `quote_version_calculation` | Exclusivamente interno, 1:1. |

---

## 2. Invariantes: CHECK de una sola tabla

- `issuing_company.code IN ('BROKING','SATHRI')`.
- `third_party.kind IN ('CLIENT','SUPPLIER','BOTH')`; `merged_into_id <> id`.
- `catalog_item.kind IN ('PRODUCT','SERVICE')`.
- `cost_reference.currency ~ '^[A-Z]{3}$'`; `tax_treatment`/`documentation_status` de dominio; `tax_rate >= 0`; `amount` finito.
- `quote.currency`, `display_mode`, `status`; `folio IS NULL OR issuing_company_id IS NOT NULL` (corrección 9); `client_contact_id/address_id IS NULL OR client_third_party_id IS NOT NULL` (corrección 7).
- `pricing_group`: dominio de cada campo; **`ck_pricing_group_mode_shape`** (el gran CHECK compuesto de la tabla de la sección 7 de LP-SCHEMA-001S/T, un único `CHECK` con cinco ramas `OR`, una por `pricing_mode`); **`ck_pricing_group_per_unit_requires_quantity`** (v1.3 corrección 1).
- `pricing_group_cost_item`/`quote_sale_based_cost_item`: **`ck_*_mode_field_shape`** (exclusividad de campos por `cost_calculation_mode`, v1.3 corrección 4); `pricing_group_cost_item` además **`ck_pgci_scope_mode`** (GROUP_BASE_COST solo DIRECT_AMOUNT).
- `quote_line`: dominio de `origin_kind`/`line_status`; **`ck_quote_line_variant_requires_item`**; **`ck_quote_line_kit_solution_snapshot`** (KIT/SOLUTION exigen `source_snapshot`); **`ck_quote_line_group_required_for_priced_included`**; **`ck_quote_line_quantity_finite`** (finitud siempre; el `>0` es de emisión, ver §11 del DDL y §7 de estas notas).
- `quote_version.status IN ('ISSUED','SUPERSEDED','VOID')`.

Todas las columnas financieras `NUMERIC` relevantes (`amount`, `rate`, `tax_rate`, `sale_tax_rate`, `pricing_value`, `quantity` en las tablas que lo requieren) llevan `is_finite_numeric(...)` en su CHECK — ver sección 4.

---

## 3. Invariantes: FK / composite FK (declarativo, sin trigger)

Esta es la categoría donde PostgreSQL permitió eliminar por completo la necesidad de un trigger, gracias al comportamiento `MATCH SIMPLE` por defecto de las FK compuestas (si **cualquier** columna referenciante es `NULL`, la fila queda exenta de la verificación — lo cual, combinado con un `CHECK` complementario cuando el `NULL` parcial también sería inválido, produce integridad completa):

| Invariante LP-SCHEMA-001 | Mecanismo SQL |
|---|---|
| `quote_line` no puede cruzar de `Quote` (sección/grupo de otra Quote) | `fk_quote_line_section (quote_id, quote_section_id) → quote_section(quote_id, id)`; `fk_quote_line_pricing_group (quote_id, pricing_group_id) → pricing_group(quote_id, id)`. |
| `origin_kind=PRODUCT/SERVICE` ⟹ `catalog_item.kind` coincide; KIT/SOLUTION/FREE_CONCEPT ⟹ `catalog_item_id` NULL | **Un único** `fk_quote_line_catalog_item_kind (catalog_item_id, origin_kind) → catalog_item(id, kind)`. Ver explicación detallada en sección 6 — este es el punto donde PostgreSQL forzó la elección más elegante de toda la misión. |
| Variante pertenece al mismo `catalog_item_id` declarado en la línea | `fk_quote_line_variant (catalog_item_id, catalog_item_variant_id) → catalog_item_variant(catalog_item_id, id)`. |
| `client_contact_id`/`client_address_id` pertenecen al mismo `client_third_party_id` | `fk_quote_client_contact`/`fk_quote_client_address (client_third_party_id, client_*_id) → third_party_contact/address(third_party_id, id)`, acompañados de un `CHECK` explícito de columna (ver §6 — por qué la FK sola no basta). |
| Moneda consistente `quote` → `pricing_group` → `pricing_group_cost_item` / `quote_sale_based_cost_item` | Cadena de FKs compuestas `(id, currency)`: `fk_pricing_group_quote_currency`, `fk_pgci_currency`, `fk_qsbci_currency`. **Cero triggers de moneda** — el mismo mecanismo de v1.1-v1.3 (antes descrito como "trigger de aplicación" en el documento de diseño) resultó ser completamente expresable de forma declarativa una vez traducido a SQL real. |
| `folio` único por emisor | `UNIQUE (issuing_company_id, folio) WHERE folio IS NOT NULL` — parcial, no FK, ver sección 4. |
| `CostReference` vínculos no destructivos | `ON DELETE RESTRICT` en `pricing_group_cost_item.source_cost_reference_id` / `quote_sale_based_cost_item.source_cost_reference_id`. |

---

## 4. Invariantes: UNIQUE parcial (partial index)

- `uq_quote_issuer_folio` — `(issuing_company_id, folio) WHERE folio IS NOT NULL`.
- `uq_catalog_item_sku` — `(sku) WHERE sku IS NOT NULL`.
- `uq_third_party_contact_primary` — `(third_party_id) WHERE is_primary AND status='ACTIVE'`.
- `uq_quote_section_active_order` — `(quote_id, display_order) WHERE status='ACTIVE'` (v1.3 corrección 10: archivar libera la posición).
- `uq_quote_line_active_order` — `(quote_section_id, display_order) WHERE status='ACTIVE'`.
- `uq_pricing_group_single_anchor` — `(pricing_group_id) WHERE status='ACTIVE' AND line_status IN ('PRICED','OPTIONAL','REFERENCE_NOT_INCLUDED')` — cubre la mitad "como máximo una" de "ancla exacta al emitir" (v1.3 corrección 5); la mitad "al menos una" no es expresable como índice y vive en `validate_quote_for_emission()`.

---

## 5. Invariantes: trigger/función (solo donde 1–4 no alcanzan)

| Trigger | Tabla | Qué garantiza | Por qué no es declarativo |
|---|---|---|---|
| `trg_quote_client_role` / `fn_check_quote_client_role` | `quote` | `client_third_party_id` referencia un tercero `kind IN ('CLIENT','BOTH')`. | El `kind` tiene 3 valores posibles y necesitamos aceptar 2 de ellos — una FK compuesta exigiría una fila-por-valor-aceptado en la tabla referenciada, lo cual no aplica aquí (no hay tabla intermedia de "roles válidos" en el contrato). |
| `trg_cost_reference_supplier_role` / `fn_check_cost_reference_supplier_role` | `cost_reference` | `supplier_third_party_id` referencia `kind IN ('SUPPLIER','BOTH')`. | Mismo motivo que arriba. |
| `trg_third_party_guard_kind_change` / `fn_third_party_guard_kind_change` | `third_party` | Un cambio de `kind` que dejaría inválida una referencia existente (`quote.client_third_party_id` o `cost_reference.supplier_third_party_id`) se rechaza. | Requiere escanear dos tablas dependientes en el momento del `UPDATE` — no expresable como CHECK de una sola fila. |
| `trg_quote_line_status_role_consistency` / `fn_check_line_status_role_consistency` | `quote_line` | `line_status` es compatible con `pricing_group.quote_total_role` del grupo referenciado (tabla exacta de LP-SCHEMA-001 v1.3 corrección 3). | Cruza dos tablas con una tabla de combinaciones válidas de 3×2, no expresable como CHECK ni como FK compuesta contra un conjunto de pares válidos sin una tabla de lookup adicional (que el contrato no pide). |
| `trg_quote_version_content_and_status_guard` / `fn_quote_version_content_and_status_guard` (LP-SCHEMA-002R corrección 5, consolidó `trg_quote_version_immutable` / `fn_quote_version_forbid_content_update`; LP-SCHEMA-002S corrección 1 extendió el mismo trigger a `BEFORE INSERT OR UPDATE`) | `quote_version` | En `INSERT`: `status` debe ser exactamente `ISSUED` (rechaza `INSERT ... status='SUPERSEDED'`/`'VOID'` explícito). En `UPDATE`: solo `status` puede cambiar, y solo siguiendo la máquina de estados: `ISSUED → {ISSUED,SUPERSEDED,VOID}`; `SUPERSEDED → {SUPERSEDED,VOID}`; `VOID → {VOID}`. | PostgreSQL no tiene una forma declarativa de "valor inicial obligatorio distinto del dominio permitido" ni de "columnas inmutables selectivamente" ni de "transiciones de estado permitidas"; las tres se validan con `TG_OP`/`NEW`/`OLD` en un solo trigger consolidado, con un único objeto cubriendo ambos eventos. |
| `trg_pricing_group_role_change_guard` / `fn_check_pricing_group_role_change_against_lines` (nuevo, LP-SCHEMA-002R corrección 2) | `pricing_group` (`BEFORE UPDATE OF quote_total_role`) | Guardia en sentido inverso al de `trg_quote_line_status_role_consistency`: rechaza un cambio de `quote_total_role` si deja alguna `quote_line` `ACTIVE` existente incompatible con el nuevo rol (misma matriz INCLUDED/OPTIONAL/REFERENCE_ONLY). Las líneas `ARCHIVED` quedan explícitamente excluidas del chequeo. | Requiere escanear todas las `quote_line` `ACTIVE` del grupo en el momento del `UPDATE` de `pricing_group` — no expresable como CHECK de una sola fila ni como FK. |
| `trg_qvc_immutable` / `fn_quote_version_calculation_forbid_update` | `quote_version_calculation` | Ningún `UPDATE` es válido — inmutabilidad total. | Mismo motivo; aquí es más simple porque no hay ninguna columna mutable, así que el trigger rechaza cualquier `UPDATE` sin comparar columnas. |
| `trg_quote_version_require_calculation` / `fn_quote_version_require_calculation` | `quote_version` (CONSTRAINT TRIGGER, `DEFERRABLE INITIALLY DEFERRED`) | Al `COMMIT`, toda `quote_version` insertada en la transacción debe tener su `quote_version_calculation` correspondiente. | Es un invariante "al menos una fila relacionada debe existir", lo opuesto de lo que una FK normal expresa (una FK garantiza que el hijo apunte a un padre válido, nunca que el padre tenga un hijo). Solo un CONSTRAINT TRIGGER diferido puede expresar esto en PostgreSQL puro. |
| `trg_*_forbid_delete` / `fn_forbid_delete` | Las 15 tablas de dominio | ZERO DELETE reforzado a nivel de DB, no solo de aplicación. | PostgreSQL no tiene un modo de tabla "sin DELETE" nativo; un trigger `BEFORE DELETE` que siempre lanza excepción es el mecanismo estándar. |

**Ninguno de estos triggers reimplementa una fórmula financiera.** Todos son comparaciones de texto/existencia/pertenencia — el motor (`pricingEngine.js`) sigue siendo la única autoridad de cálculo.

---

## 6. Puntos donde PostgreSQL obligó a elegir una implementación concreta

1. **`fk_quote_line_catalog_item_kind` — el hallazgo más significativo de esta misión.** LP-SCHEMA-001 describe la integridad PRODUCT/SERVICE/KIT/SOLUTION/FREE_CONCEPT (§11, corrección 6) como varias reglas separadas ("si origin_kind=PRODUCT, catalog_item debe ser PRODUCT"; "si origin_kind=SERVICE, catalog_item debe ser SERVICE"; "KIT/SOLUTION/FREE_CONCEPT ⟹ catalog_item_id NULL"). Al traducirlo a SQL, una única FK compuesta `(catalog_item_id, origin_kind) REFERENCES catalog_item(id, kind)` con `MATCH SIMPLE` (el comportamiento por defecto de PostgreSQL) resultó cubrir las CUATRO reglas simultáneamente: si `catalog_item_id` es `NULL` (cualquier `origin_kind`), la FK se omite; si `catalog_item_id` NO es `NULL`, el par debe existir en `catalog_item(id, kind)`, y como `catalog_item.kind` solo acepta `PRODUCT`/`SERVICE` (nunca `KIT`), ninguna fila con `origin_kind='KIT'` (o `SOLUTION`/`FREE_CONCEPT`) puede tener `catalog_item_id` poblado sin violar la FK. Esto **no era la única forma válida de implementarlo** — la alternativa era un trigger explícito con un `CASE` por `origin_kind` (el enfoque más "obvio" al leer el contrato en prosa) — pero la FK compuesta es estrictamente más fuerte (declarativa, verificada por el motor de FK de PostgreSQL, no por lógica de aplicación en PL/pgSQL) y se documenta aquí como la elección tomada.
2. **`third_party` role consistency vía trigger, no FK.** Se consideró una FK compuesta `third_party(id, kind)` con una tabla de "roles válidos" intermedia, pero el contrato no define tal tabla y crearla habría sido una expansión de alcance no autorizada ("no rediseñar el dominio"). Se optó por trigger, documentado en la sección 5.
3. **`is_finite_numeric()` como función `IMMUTABLE` en lugar de una expresión CHECK inline repetida.** Se centralizó en una única función para (a) evitar re-derivar la lógica correcta de exclusión de NaN en cada una de las ~15 columnas que la necesitan, y (b) dejar un único punto de corrección si `LP-SCHEMA-002` posterior decide una forma distinta. La función usa comparación textual (`::text NOT IN ('NaN','Infinity','-Infinity')`), no `value = value` (que LP-SCHEMA-001 v1.2/v1.3 marcó explícitamente como incorrecto para `NUMERIC` en PostgreSQL, donde `NaN = NaN` es `TRUE`).
4. **`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`** para "`quote_version` no puede quedar sin `quote_version_calculation` al `COMMIT`.** LP-SCHEMA-001 v1.3 (corrección 11) fue explícito en que esto es una garantía transaccional, no estructural — pero LP-SCHEMA-002 pidió implementarla "si es seguro y limpio". Un `CONSTRAINT TRIGGER` diferido es el único mecanismo nativo de PostgreSQL para "al final de la transacción, verifica que exista una fila relacionada" sin reintroducir la fórmula del motor ni bloquear el patrón transaccional normal (INSERT `quote_version`, luego INSERT `quote_version_calculation`, ambos antes del `COMMIT`). Se documenta como reforzada, no como sustituto de la disciplina transaccional del orquestador.
5. **`quote_line.quantity`: finitud como CHECK de columna, `>0` como regla de emisión, no de columna.** LP-SCHEMA-001 v1.3 dice "quantity debe ser finita y > 0 **para una línea comercial emitible**" — la frase condicional ("para ser emitible") se interpretó como una regla de la transición de emisión, no una restricción de captura permanente, para no bloquear un DRAFT con una línea todavía incompleta (`quantity=0` mientras se captura). PostgreSQL no distingue "modo DRAFT" vs "modo emisión" a nivel de fila sin una columna de fase adicional que el contrato no define, así que la única forma limpia de expresar esta condicionalidad fue moverla a `validate_quote_for_emission()`. Esto es una interpretación razonada, no una reapertura de la decisión — se señala aquí por transparencia.

---

## 7. Estrategia de finitud (LP-SCHEMA-002 §2)

- Función centralizada `is_finite_numeric(NUMERIC) RETURNS BOOLEAN IMMUTABLE`, comparación textual explícita contra `'NaN'`, `'Infinity'`, `'-Infinity'` — nunca `value = value`.
- Columnas cubiertas: `cost_reference.amount`/`tax_rate`; `pricing_group.quantity`/`pricing_value`/`sale_tax_rate`; `pricing_group_cost_item.amount`/`quantity`/`rate`/`tax_rate`; `quote_sale_based_cost_item.amount`/`quantity`/`rate`/`tax_rate`; `quote_line.quantity`.
- No negatividad conservada donde el contrato la exige: `tax_rate >= 0`, `sale_tax_rate >= 0` (ambos combinados con finitud en el mismo CHECK). No se inventó ninguna restricción de signo adicional (ej. `pricing_value`/`amount` NO llevan `>= 0` porque LP-SCHEMA-001 no lo fija).
- `engine_input`/`engine_output` (JSONB) no llevan validación de finitud a nivel de columna — son el payload ya congelado post-conversión del orquestador; la finitud de esos valores se garantiza aguas arriba, por el motor (`Number.isFinite`, 68/68 PASS) y por las columnas `NUMERIC` de origen que si alimentaron ese cálculo.

---

## 8. Estrategia de precisión y frontera con el motor

- Ninguna columna `NUMERIC` que alimente al motor usa `numeric(p,s)` con escala fija — todas son `NUMERIC` sin restricción, tal como exige LP-SCHEMA-001 v1.3 (evita el redondeo silencioso que `numeric(p,s)` introduciría).
- La conversión `NUMERIC → Number` de JavaScript, la validación `Number.isFinite`, y la invocación de `pricingEngine.js` siguen siendo responsabilidad exclusiva del orquestador — este SQL no intenta sustituir esa frontera ni reimplementarla.
- `engine_input` congela el valor ya convertido y efectivamente enviado al motor (no el `NUMERIC` crudo previo a la conversión) — disciplina documental, no reforzable por un CHECK de PostgreSQL sobre contenido JSONB arbitrario.

---

## 9. Estrategia de concurrencia y atomicidad (LP-SCHEMA-002 §11/§15/§16)

Patrón transaccional documentado, no reimplementado como lógica de motor:

```
BEGIN;
  SELECT * FROM quote WHERE id = :quote_id FOR UPDATE;         -- lock de fila
  SELECT * FROM validate_quote_for_emission(:quote_id);         -- validación relacional
  -- construir engine_input en el orquestador (fuera de SQL)
  -- invocar pricingEngine.js desde el orquestador (fuera de SQL)
  INSERT INTO quote_version (...) VALUES (...) RETURNING id;    -- nueva versión ISSUED
  INSERT INTO quote_version_calculation (...) VALUES (...);     -- calculation 1:1, misma transacción
  SELECT fn_supersede_previous_quote_versions(:quote_id, :new_version_id);
  UPDATE quote SET status = 'ACTIVE' WHERE id = :quote_id;      -- si es la primera emisión
COMMIT;                                                          -- trg_quote_version_require_calculation
                                                                  -- se evalúa aquí (DEFERRED)
```

- El `SELECT ... FOR UPDATE` sobre `quote` es lo que serializa emisiones concurrentes de la misma cotización — no se creó un sistema paralelo de revisiones ni una tabla de locks adicional; "row locking es suficiente para v1" (instrucción explícita de la misión).
- `fn_next_quote_version_number()` se documenta como no-atómico por sí solo — su seguridad depende enteramente de que el llamador ya sostenga el lock de `quote` en la misma transacción. Esto se señala explícitamente en el comentario de la función en el DDL, para que una futura implementación no lo use sin el lock y crea erróneamente que ya es seguro.
- `fn_supersede_previous_quote_versions()` es segura de llamar dentro de la misma transacción porque `trg_quote_version_content_and_status_guard` permite explícitamente cambios de `status` (no de contenido) en su rama `UPDATE`, y su rama `INSERT` (LP-SCHEMA-002S corrección 1) no interfiere con este `UPDATE` posterior.

---

## 10. Limitaciones conocidas

- `validate_quote_for_emission()` es un validador relacional — no calcula precios, no invoca al motor, y no puede detectar todas las formas de "duplicación semántica manual" entre `GROUP_KNOWN_SALE_BASED_COST` y `QUOTE_LEVEL` (LP-SCHEMA-001 explícitamente renuncia a esa garantía — no hay matching heurístico).
- El guard `FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS` implementado en `validate_quote_for_emission()` solo evalúa el agregado principal (`quote_total_role='INCLUDED'`); grupos `OPTIONAL`/`REFERENCE_ONLY` con la misma combinación de modo/base no disparan este chequeo aquí — LP-SCHEMA-001 mismo deja esa evaluación para "si ese grupo se calcula de forma independiente" (fuera del validador de emisión del agregado principal, en el orquestador).
- `is_finite_numeric()` asume que el driver/versión de PostgreSQL en uso puede almacenar `NaN`/`Infinity`/`-Infinity` en `NUMERIC` (soporte añadido en versiones recientes de PostgreSQL); en versiones donde el tipo `NUMERIC` no admite esos valores en absoluto, la función sigue siendo correcta pero redundante (el motor de tipos ya lo impediría antes de llegar al CHECK).
- No se implementa RLS. No se implementan políticas de columna para ocultar `quote_version_calculation` de un rol "cliente" — solo la separación física de tabla, tal como LP-SCHEMA-001 documenta como la preparación estructural, dejando la política de acceso explícita para una misión futura.
- El seed de `issuing_company` para BROKING ya está insertado (LP-SCHEMA-002R corrección 10); el de SATHRI permanece deliberadamente comentado/sin insertar (ver DECISION_REQUIRED en §14).

---

## 11. Lista completa de funciones y triggers (post LP-SCHEMA-002T)

**Funciones (13):**
`is_finite_numeric`, `fn_forbid_delete`, `fn_third_party_guard_kind_change`, `fn_check_quote_client_role`, `fn_check_cost_reference_supplier_role`, `fn_check_line_status_role_consistency`, `fn_check_pricing_group_role_change_against_lines` (nueva, corrección 2), `fn_quote_version_content_and_status_guard` (renombrada/consolidada de `fn_quote_version_forbid_content_update`, corrección 5), `fn_quote_version_calculation_forbid_update`, `fn_quote_version_require_calculation`, `fn_next_quote_version_number`, `fn_supersede_previous_quote_versions`, `validate_quote_for_emission`.

**Triggers (23 objetos reales — 15 forbid-delete + 8 con nombre propio):** un `trg_<tabla>_forbid_delete` por cada una de las 15 tablas de dominio, más: `trg_third_party_guard_kind_change`, `trg_quote_client_role`, `trg_cost_reference_supplier_role`, `trg_quote_line_status_role_consistency`, `trg_pricing_group_role_change_guard` (nuevo, corrección 2), `trg_quote_version_content_and_status_guard` (renombrado/consolidado, corrección 5), `trg_qvc_immutable`, `trg_quote_version_require_calculation`.

Conteo previo a LP-SCHEMA-002R: 22 objetos (15 + 7). Conteo real actual: 23 (15 + 8) — la corrección 2 agregó un trigger nuevo; la corrección 5 renombró/consolidó uno existente sin cambiar el conteo. Este recuento se basa en objetos de trigger distintos (`pg_trigger` / `SELECT DISTINCT trigger_name`), no en filas crudas de `information_schema.triggers`, que pueden duplicar un mismo trigger multi-evento (ver corrección 7 y el verify script actualizado).

---

## 12. Orden de creación

1. Extensión `pgcrypto`.
2. `is_finite_numeric`, `fn_forbid_delete` (funciones compartidas, sin dependencias).
3. `issuing_company` → `third_party` (+ trigger forbid-delete; sin UNIQUE adicional sobre `id` — `uq_third_party_id` fue eliminado por ser redundante con la PK, LP-SCHEMA-002R corrección 9) → `third_party_contact` (+ `uq_tpc_third_party_id_id`) → `third_party_address` (+ `uq_tpa_third_party_id_id`).
4. `catalog_item` → `catalog_item_variant`.
5. `cost_reference` (+ trigger de rol de proveedor).
6. `quote` (+ FKs compuestas de contacto/domicilio, trigger de rol de cliente) — y aquí se adjunta `trg_third_party_guard_kind_change` sobre `third_party` (diferido hasta que `quote` y `cost_reference` existan, porque su función referencia ambas tablas).
7. `quote_section`.
8. `pricing_group` (+ FK de moneda contra `quote`). El trigger guardia en sentido inverso sobre `quote_total_role` (`trg_pricing_group_role_change_guard`, LP-SCHEMA-002R corrección 2) NO se adjunta en este paso — ver paso 9 (corrección de orden, LP-SCHEMA-002T corrección 6: una versión anterior de estas notas afirmaba incorrectamente que se adjuntaba aquí).
9. `quote_line` (+ todas sus FKs compuestas, índices parciales, `trg_quote_line_status_role_consistency` — coherencia forward `line_status`→`quote_total_role`). Inmediatamente después, ya con `quote_line` existente, se define y adjunta `trg_pricing_group_role_change_guard` sobre `pricing_group` (guardia reverse, LP-SCHEMA-002R corrección 2) — este orden es necesario porque la función del guardia consulta `quote_line`, y aunque PL/pgSQL no resuelve nombres de tabla dentro del cuerpo de una función hasta el momento de ejecución (no de creación), el `CREATE TRIGGER` en sí se colocó físicamente después de que `quote_line` ya existe en el archivo, por claridad de lectura. Este es el orden real del archivo — no se movió SQL para hacer coincidir esta nota; la nota se corrigió para reflejar el SQL.
10. `pricing_group_cost_item` → `quote_sale_based_cost_item`.
11. `quote_version` (+ `trg_quote_version_content_and_status_guard`, trigger consolidado de inmutabilidad de contenido + ciclo de vida de `status`, cubriendo BEFORE INSERT OR UPDATE — LP-SCHEMA-002S corrección 1 cerró el lado INSERT) → `quote_version_calculation` (+ trigger de inmutabilidad total, constraint trigger diferido).
12. Helpers de orquestación (`fn_next_quote_version_number`, `fn_supersede_previous_quote_versions`, `validate_quote_for_emission`).
13. Seeds: `issuing_company` BROKING insertado activo (LP-SCHEMA-002R corrección 10); SATHRI permanece comentado, pendiente de validar `legal_name` literal (ver DECISION_REQUIRED en §14).

Este es exactamente el orden físico del archivo `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql`.

---

## 13. Rollback conceptual — SOLO PRE-PRODUCCIÓN

Aplica **únicamente** antes de que el esquema tenga datos reales (ambiente de desarrollo/CI, nunca un sistema con cotizaciones vivas):

```
DROP TABLE IF EXISTS quote_version_calculation;
DROP TABLE IF EXISTS quote_version;
DROP TABLE IF EXISTS quote_sale_based_cost_item;
DROP TABLE IF EXISTS pricing_group_cost_item;
DROP TABLE IF EXISTS quote_line;
DROP TABLE IF EXISTS pricing_group;
DROP TABLE IF EXISTS quote_section;
DROP TABLE IF EXISTS quote;
DROP TABLE IF EXISTS cost_reference;
DROP TABLE IF EXISTS catalog_item_variant;
DROP TABLE IF EXISTS catalog_item;
DROP TABLE IF EXISTS third_party_address;
DROP TABLE IF EXISTS third_party_contact;
DROP TABLE IF EXISTS third_party;
DROP TABLE IF EXISTS issuing_company;
DROP FUNCTION IF EXISTS validate_quote_for_emission(UUID);
DROP FUNCTION IF EXISTS fn_supersede_previous_quote_versions(UUID, UUID);
DROP FUNCTION IF EXISTS fn_next_quote_version_number(UUID);
DROP FUNCTION IF EXISTS fn_quote_version_require_calculation();
DROP FUNCTION IF EXISTS fn_quote_version_calculation_forbid_update();
DROP FUNCTION IF EXISTS fn_quote_version_content_and_status_guard();
DROP FUNCTION IF EXISTS fn_check_line_status_role_consistency();
DROP FUNCTION IF EXISTS fn_check_pricing_group_role_change_against_lines();
DROP FUNCTION IF EXISTS fn_check_cost_reference_supplier_role();
DROP FUNCTION IF EXISTS fn_check_quote_client_role();
DROP FUNCTION IF EXISTS fn_third_party_guard_kind_change();
DROP FUNCTION IF EXISTS fn_forbid_delete();
DROP FUNCTION IF EXISTS is_finite_numeric(NUMERIC);
```
Lista auditada contra las 13 funciones reales actuales del DDL (LP-SCHEMA-002S): coincide exactamente — `fn_quote_version_forbid_content_update()` (nombre eliminado en LP-SCHEMA-002R corrección 5) ya no aparece aquí, y se agregó `fn_check_pricing_group_role_change_against_lines()` (nueva en LP-SCHEMA-002R corrección 2, que faltaba en este rollback).

**Esto NO es una recomendación de `DROP` sobre un sistema con datos.** Es exclusivamente un rollback conceptual para un ambiente pre-producción que necesite reiniciar el intento de aplicar este DDL. Sobre cualquier ambiente con cotizaciones reales, el principio ZERO DELETE del contrato aplica también a la infraestructura: no se recomienda ni se documenta aquí ningún procedimiento de reversión destructiva.

---

## 14. `DECISION_REQUIRED` de esta misión (actualizado por LP-SCHEMA-002R)

### DECISION_REQUIRED — BROKING: RESUELTO (LP-SCHEMA-002R corrección 10)

Control Tower confirmó la razón social y RFC de BROKING vía Índice Maestro IM-001/IM-020. El seed real (`code='BROKING'`, `legal_name='BROKING AND BRANDS GROUP, S.A. de C.V.'`, `tax_id='BBG1007304K0'`) ya está insertado, sin comentar, en `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql` §17. Ya no es un `DECISION_REQUIRED`.

### DECISION_REQUIRED — SATHRI legal_name literal exacto para seed (sigue abierto, LP-SCHEMA-002R corrección 11)

- **Cuestión:** el RFC de SATHRI (`SAT190911445`) y su tipo corporativo (`S.A.P.I. de C.V.`) están confirmados, pero la transcripción literal exacta de `legal_name` permanece "PENDIENTE DE VALIDAR" en el Índice Maestro.
- **No se inventó ni normalizó** ningún valor (p.ej., no se asume que "SATHRI, S.A.P.I. de C.V." sea la razón social literal registrada).
- El seed de SATHRI permanece comentado/sin ejecutar en `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql` §17, documentando el RFC confirmado en un comentario.
- **Se requiere:** que Corporate Office / el Índice Maestro confirme la transcripción literal exacta de `legal_name` antes de descomentar y ejecutar ese `INSERT`.
- Este `DECISION_REQUIRED` bloquea únicamente esta fila de seed — no bloquea la aprobación del resto del DDL.

Este es el único `DECISION_REQUIRED` restante de LP-SCHEMA-002/002R — no reabre ninguna decisión arquitectónica de LP-SCHEMA-001.

---

## 15. Addendum LP-SCHEMA-002R — QA correctivo focal (13 correcciones aplicadas)

Verdict de entrada de Control Tower: "NO aprobado todavía" — arquitectura NO reabierta. Se aplicaron exactamente las 13 correcciones solicitadas, únicamente sobre los tres archivos autorizados (`sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql`, `sql/LP-SCHEMA-002_VERIFY_STANDALONE_QUOTE_V1.sql`, este documento). Sin archivos nuevos, sin ejecución de SQL, sin Supabase, sin staging, sin commit/push/PR/merge/deploy.

1. **`sale_tax_rate IS NULL`** agregado a la rama `pricing_mode IS NULL` de `ck_pricing_group_mode_shape`. No se tocó la nulabilidad de `sale_tax_rate` en ninguna otra rama.
2. **Trigger inverso** `trg_pricing_group_role_change_guard` / `fn_check_pricing_group_role_change_against_lines` sobre `pricing_group` (`BEFORE UPDATE OF quote_total_role`) — ver §5 y §11 arriba. Líneas `ARCHIVED` explícitamente exentas.
3. **`active_line_group_active`** agregado a `validate_quote_for_emission()` — falla si una `quote_line` `ACTIVE` con `pricing_group_id` no nulo referencia un `pricing_group` cuyo `status <> 'ACTIVE'`. Es un chequeo de emisión, NO una CHECK estructural permanente.
4. **`priced_anchor_group_commercial`** agregado a `validate_quote_for_emission()` — para un "ancla" comercial (`PRICED`/`OPTIONAL`/`REFERENCE_NOT_INCLUDED` con `pricing_group_id` no nulo), el `pricing_group` referenciado debe tener `status='ACTIVE'` Y `pricing_mode IS NOT NULL`. `REFERENCE_NOT_INCLUDED` con `pricing_group_id` NULL sigue siendo válido y no se evalúa aquí; los grupos de solo costo interno pueden seguir existiendo sin ninguna `quote_line`.
5. **Máquina de estados de `quote_version.status`** consolidada en `trg_quote_version_content_and_status_guard` / `fn_quote_version_content_and_status_guard` (reemplaza `trg_quote_version_immutable` / `fn_quote_version_forbid_content_update`): `ISSUED→{ISSUED,SUPERSEDED,VOID}`; `SUPERSEDED→{SUPERSEDED,VOID}`; `VOID→{VOID}`; cualquier otra transición se rechaza. `fn_supersede_previous_quote_versions()` sigue siendo compatible (solo escribe `ISSUED→SUPERSEDED`).
6. **Corrección de redacción**: el comentario sobre `trg_quote_version_require_calculation` ya no dice "fires once per transaction" — se corrigió a: es un constraint trigger a nivel de FILA; cada `INSERT` de `quote_version` programa su propio chequeo diferido, ejecutado independientemente (no una sola invocación por transacción). El mecanismo `DEFERRABLE INITIALLY DEFERRED` en sí se mantiene sin cambios.
7. **Conteo real de triggers**: 22 objetos previos (15 forbid-delete + 7 otros) → 23 tras esta ronda (15 + 8, por el nuevo trigger de la corrección 2). El verify script ahora usa `SELECT DISTINCT trigger_name` en vez de contar filas crudas de `information_schema.triggers` (que puede duplicar un trigger multi-evento).
8. **Verify script**: el spot-check de columnas v1.3 en realidad lista 14 pares (tabla, columna), no 13 — corregido el comentario a "Expect exactly 14 rows".
9. **`uq_third_party_id UNIQUE(id)`** eliminado de `third_party` — era redundante (ya es PK, ninguna FK compuesta del contrato la usa). Las UNIQUE compuestas realmente usadas por FKs (`uq_tpc_third_party_id_id`, `uq_tpa_third_party_id_id`) se conservaron intactas.
10. **Seed BROKING real insertado** — ver DECISION_REQUIRED arriba.
11. **Seed SATHRI permanece comentado** — ver DECISION_REQUIRED arriba.
12. **Redacción del diagnóstico de tablas fuera de alcance** en el verify script corregida: ya no implica que esas tablas deban estar ausentes globalmente de la base de datos; solo distingue "creada por LP-SCHEMA-002" (nunca) de "preexistente en otro lugar" (no es, por sí sola, una violación).
13. **Auto-auditoría estática final** (sin ejecución contra ninguna base de datos): 15 `CREATE TABLE` (confirmado por conteo estático); ningún `CREATE TYPE ... AS ENUM` nativo (confirmado, cero coincidencias); ningún `NUMERIC(p,s)` con precisión/escala fija (confirmado, cero coincidencias); la rama `pricing_mode IS NULL` ahora nulifica `sale_tax_rate` (corrección 1 aplicada); el trigger inverso de `quote_total_role` existe (`trg_pricing_group_role_change_guard`); `quote_version` tiene ciclo de vida controlado (`trg_quote_version_content_and_status_guard`); `validate_quote_for_emission()` incluye los dos chequeos nuevos (`active_line_group_active`, `priced_anchor_group_commercial`); el spot-check de columnas lista 14 filas; el inventario de triggers es consistente (23 objetos reales, recontados con `DISTINCT`/`pg_trigger`); únicamente los tres archivos autorizados fueron modificados en esta ronda.

**Nota de status honesta (corregida por LP-SCHEMA-002S):** el ciclo de vida de `quote_version.status` NO quedaba completamente cerrado al terminar LP-SCHEMA-002R — el trigger consolidado solo corría en `BEFORE UPDATE`, por lo que un `INSERT ... status='SUPERSEDED'` o `status='VOID'` explícito pasaba el `CHECK` de dominio sin ser rechazado. Este documento no debe leerse como si esa ronda hubiera cerrado el lifecycle end-to-end; ese cierre ocurrió en LP-SCHEMA-002S (ver §16).

---

## 16. Addendum LP-SCHEMA-002S — cierre estático final (defecto de INSERT + limpieza documental)

Veredicto de entrada de Control Tower: LP-SCHEMA-002R "sustancialmente correcta, pero NO cerrada" — un defecto SQL bloqueante (INSERT explícito con `status` distinto de `ISSUED` pasaba el CHECK) más referencias documentales obsoletas. Arquitectura NO reabierta; NO se introdujeron nuevas decisiones de dominio. Solo se modificaron los tres archivos autorizados.

1. **Defecto bloqueante cerrado.** `fn_quote_version_content_and_status_guard()` ahora maneja `TG_OP`: en `INSERT` exige `NEW.status = 'ISSUED'` exacto (si no, `RAISE EXCEPTION`); en `UPDATE` conserva intacta la máquina de estados y la inmutabilidad de contenido ya validadas en LP-SCHEMA-002R. El trigger pasó de `BEFORE UPDATE ON quote_version` a `BEFORE INSERT OR UPDATE ON quote_version` — sigue siendo UN solo objeto de trigger, no se creó un segundo.
2. **Comentario falso eliminado.** Ya no se menciona `ck_quote_version_status_initial` (nunca existió como constraint). El comentario del DDL ahora aclara: `DEFAULT 'ISSUED'` es solo conveniencia para el llamador; el trigger `BEFORE INSERT OR UPDATE` es quien realmente exige que toda fila nazca `ISSUED`; `ck_quote_version_status` solo restringe el dominio de valores posibles, no cuál es válido en el momento del INSERT.
3. **Verify actualizado** con una comprobación de solo lectura (vía `pg_trigger`, sin `pg_get_triggerdef()` de texto) que confirma que `trg_quote_version_content_and_status_guard` está definido sobre `quote_version` para `BEFORE INSERT OR UPDATE` (un solo objeto, `fires_before/fires_on_insert/fires_on_update = true`), documentando explícitamente que dos filas en `information_schema.triggers` para este trigger son esperadas y correctas (una por evento), no dos objetos.
4. **Limpieza de nombres obsoletos en las notas:** §9 (antes citaba `trg_quote_version_immutable`, ahora `trg_quote_version_content_and_status_guard`); §12 (orden de creación corregido: ya no describe `uq_third_party_id` sobre `third_party` — eliminado en LP-SCHEMA-002R corrección 9 —, describe el trigger de `pricing_group` de la corrección 2, y describe el trigger consolidado de `quote_version` con su cobertura INSERT+UPDATE); §12 punto 13 de seeds actualizado (BROKING activo, SATHRI comentado); rollback conceptual (§13 anterior) con `fn_quote_version_forbid_content_update()` reemplazada por `fn_quote_version_content_and_status_guard()` y `fn_check_pricing_group_role_change_against_lines()` agregada, auditado contra las 13 funciones reales.
5. **Conteos tras LP-SCHEMA-002S (sin cambio respecto a LP-SCHEMA-002R):** 15 tablas, 13 funciones, 23 trigger objects reales. El trigger de `quote_version` sigue siendo un solo objeto aunque ahora tenga dos eventos (INSERT y UPDATE).
6. **Estado honesto documentado:** este addendum dice explícitamente que el lifecycle de `quote_version` NO estaba completamente cerrado al final de LP-SCHEMA-002R (faltaba el lado INSERT); LP-SCHEMA-002S lo cerró, extendiendo el mismo trigger a ambos eventos sin cambiar el conteo de objetos, y corrigiendo las referencias documentales obsoletas enumeradas arriba.

**Cómo se rechaza cada caso ahora (verificado por lectura estática del DDL, no por ejecución):**
- `INSERT INTO quote_version (..., status) VALUES (..., 'SUPERSEDED')` → rechazado por `fn_quote_version_content_and_status_guard()`, rama `TG_OP='INSERT'`, porque `NEW.status IS DISTINCT FROM 'ISSUED'`.
- `INSERT INTO quote_version (..., status) VALUES (..., 'VOID')` → rechazado por el mismo motivo.
- Un `INSERT` que omite `status` (usa el `DEFAULT 'ISSUED'`) → permitido, porque `NEW.status = 'ISSUED'` tras aplicarse el default.
- Transiciones `UPDATE` válidas sin cambio: `ISSUED→ISSUED`, `ISSUED→SUPERSEDED`, `ISSUED→VOID`, `SUPERSEDED→SUPERSEDED`, `SUPERSEDED→VOID`, `VOID→VOID`; cualquier otra (`SUPERSEDED→ISSUED`, `VOID→ISSUED`, `VOID→SUPERSEDED`) sigue rechazada.

---

## 17. Addendum LP-SCHEMA-002T — hardening estático final (id immutability + robustez del verify)

Veredicto de entrada de Control Tower: la corrección principal de LP-SCHEMA-002S está bien (TG_OP INSERT exige ISSUED; trigger cubre BEFORE INSERT OR UPDATE; state machine UPDATE correcta; conteos 15/13/23 confirmados). Un defecto contractual pequeño en el DDL y varias mejoras de robustez del verify quedaban pendientes antes del cierre estático definitivo. Arquitectura NO reabierta; sin tablas/funciones/triggers nuevos; solo los tres archivos autorizados modificados.

1. **`quote_version.id` ahora explícitamente inmutable.** La rama `UPDATE` de `fn_quote_version_content_and_status_guard()` agrega `NEW.id IS DISTINCT FROM OLD.id` al mismo bloque de comparación de contenido inmutable. Antes, el PK solo quedaba protegido indirectamente por las FKs que lo referencian, no por este trigger directamente. Ningún trigger nuevo — mismo objeto `trg_quote_version_content_and_status_guard`, `BEFORE INSERT OR UPDATE`.
2. **Inventario de triggers del verify: scoped, no global.** La afirmación "23 objetos distintos en total en `public`" fue reemplazada por una comprobación CONTRACTUAL basada en una lista `VALUES` de los 23 pares (tabla, trigger) exactos que LP-SCHEMA-002 debe crear, verificados con `LEFT JOIN` contra el inventario real — detecta tanto un trigger faltante como uno adjunto a la tabla equivocada. El inventario global (`SELECT DISTINCT ... WHERE trigger_schema='public'`) se conserva, pero re-etiquetado explícitamente como diagnóstico, no como assertion contractual — un trigger ajeno a LP-SCHEMA-002 en una base compartida nunca hace fallar el conteo.
3. **Chequeo del lifecycle trigger, ahora con `pg_namespace`.** La consulta `pg_trigger` que confirma `trg_quote_version_content_and_status_guard` ahora exige explícitamente `n.nspname = 'public'` y `c.relname = 'quote_version'`, además del nombre exacto del trigger — sigue devolviendo exactamente 1 fila.
4. **Inventario de FKs compuestas con mapping posicional real.** Reemplazado el join por `constraint_name`/`table_schema` entre `information_schema.key_column_usage` y `constraint_column_usage` (que no garantiza pairing posicional confiable en FKs compuestas) por una consulta sobre `pg_constraint.conkey`/`confkey`, desanidados con `unnest(...) WITH ORDINALITY`, que preserva el orden posicional columna-por-columna de forma inequívoca. El spot-check de las 9 FKs compuestas nombradas se conserva sin cambios. Ninguna FK del DDL fue modificada — solo su verificación.
5. **ENUM nativo como diagnóstico de provenance**, con la misma disciplina que el chequeo de tablas fuera de alcance (§10 del verify): el invariante real es que LP-SCHEMA-002 no crea ningún `CREATE TYPE ... AS ENUM` (confirmado estáticamente, cero coincidencias), no que `public` esté globalmente libre de ENUMs — una base compartida puede tener un ENUM ajeno preexistente sin que eso viole este contrato.
6. **§12 (orden de creación) corregido** para reflejar el orden físico real del DDL: `trg_pricing_group_role_change_guard` (el guardia reverse sobre `quote_total_role`) se define y adjunta DESPUÉS de que `quote_line` ya existe (línea ~741 del DDL, después de `trg_quote_line_status_role_consistency` en la línea ~697), no en el paso de creación de `pricing_group`. No se movió SQL para ajustar la nota; se corrigió la nota para describir el SQL real. El encabezado de §11 se actualizó de "post LP-SCHEMA-002R" a "post LP-SCHEMA-002T".

**Conteos tras LP-SCHEMA-002T (sin cambio):** 15 tablas, 13 funciones, 23 trigger objects — ninguna corrección de esta ronda agrega ni quita tablas, funciones o triggers; todas son endurecimiento de una comparación existente (`id`) o de la robustez/alcance de las comprobaciones del verify.

**Cómo distingue el verify los 23 triggers propios de triggers ajenos:** la comprobación contractual (corrección 2) enumera explícitamente los 23 pares (tabla, trigger_name) esperados y los busca uno por uno vía `LEFT JOIN`; cualquier trigger adicional que exista en `public` pero no esté en esa lista simplemente no aparece en el resultado y no afecta el conteo de 23 filas esperadas. El inventario global de diagnóstico (`SELECT DISTINCT ... FROM information_schema.triggers WHERE trigger_schema='public'`) puede mostrar más de 23 filas en una base compartida sin que eso sea, por sí solo, una falla.

---

**LP-SCHEMA-002 / LP-SCHEMA-002R / LP-SCHEMA-002S / LP-SCHEMA-002T — fin de entrega de esta ronda.** Solo DDL/notas offline. Sin SQL ejecutado, sin PostgreSQL, sin Supabase, sin staging, sin commit, sin push, sin PR, sin merge, sin deploy.
