# LP-EMIT-001 — Contrato de Emisión Atómica: Standalone Quote v1

Preparado por: SATHIA AI — LICITACIONES CORE (rol de ejecutor técnico, no Control Tower)
Estado: v1 (QA correctivos LP-EMIT-001R / LP-EMIT-001S aplicados) — SOLO DISEÑO. No implementado. No hay SQL nuevo, no hay migraciones, no hay Supabase, no hay UI/API. Sin staging, sin commit, sin push.
Repositorio: `SantosBroking/LICITAPRO` · Branch base conceptual: `feat/licita-engine-v1`
HEAD remoto confirmado por Control Tower: `9ec18f349948e1b01d5afabfda4c6f9cfa27a68a`

**Estado canónico de entrada:**
- LP-SCHEMA-001 v1.3 — CLOSED / CANONICAL (`docs/architecture/LP-SCHEMA-001_STANDALONE_QUOTE_V1.md`)
- LP-SCHEMA-002T — CLOSED / PUBLISHED, pero el SQL sigue **OFFLINE** (no aplicado a Supabase ni a ninguna base real) (`sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql`, `sql/LP-SCHEMA-002_VERIFY_STANDALONE_QUOTE_V1.sql`)
- LP-ORCH-001 — CLOSED / APPROVED / PUBLISHED (`quote-core/`)
- Engine: `engine/src/pricingEngine.js`, commit `0421b8f28d075089320387d526c97d1f27adf764`, contrato `LP-ENG-002T`

> Este documento es un contrato de operación, no una implementación. Ninguna función SQL, endpoint o handler de aplicación descrito aquí existe todavía. Es la especificación exacta que una misión posterior de implementación (SQL: extensión de `LP-SCHEMA-002` con la función/procedimiento de emisión; aplicación: el handler que la invoca) debe cumplir, con la aprobación explícita de Control Tower.

---

## 0. Resumen ejecutivo

LP-EMIT-001 especifica la operación **atómica** de emisión de una `Quote` (`DRAFT`/`ACTIVE` → nueva `QuoteVersion` inmutable + su `QuoteVersionCalculation` 1:1), sin reimplementar ninguna pieza ya cerrada:

- El **cálculo financiero** se consume exclusivamente vía `quote-core.calculateQuoteDraft(envelope)` (LP-ORCH-001) — este contrato nunca vuelve a tocar `numeric → Number`, el mapeo snake_case → engine, ni los ownership guards financieros (`GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET`, `FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS`); esos ya viven en `quote-core` y en `pricingEngine.js` respectivamente.
- La **validación estructural de emisión** se apoya en los helpers ya definidos por LP-SCHEMA-002 (`validate_quote_for_emission`, `fn_next_quote_version_number`, `fn_supersede_previous_quote_versions`) — este contrato documenta cuál capa valida qué, sin duplicar en aplicación una garantía que debe vivir en la base de datos.
- El **mecanismo de concurrencia v1 ya está elegido por LP-SCHEMA-002**: row lock de la fila `quote`, adquirido en modo fail-fast (§2.2) — no es una decisión pendiente de este contrato.
- La **selección de qué cálculo supplemental (`OPTIONAL`/`REFERENCE_ONLY`) es materialmente parte de la versión emitida** se cierra de forma vinculante y no heurística (§3): solo entra si existe una `quote_line` ACTIVE comercial de esa versión que lo referencia como su ancla válida.
- Los **snapshots comerciales** (`quote_version.*`) se construyen exclusivamente por whitelist explícita — nunca serialización indiscriminada, nunca dato financiero interno filtrado hacia el lado comercial.
- La **atomicidad** se especifica como una secuencia lógica de 14 pasos dentro de una sola transacción/sesión, con rollback total ante cualquier fallo — sin diseñar el SQL concreto (eso pertenece a una migración futura de `LP-SCHEMA-002`/una nueva misión de implementación).

**No quedan `DECISION_REQUIRED` abiertos** (§12).

---

## 1. Frontera obligatoria

LP-EMIT-001 **orquesta**, no reimplementa. Explícitamente:

| Responsabilidad | Dueño canónico | LP-EMIT-001 |
|---|---|---|
| `numeric → Number`, validación de finitud de inputs | `quote-core` (`mapCostItemRow`/`mapPricingGroupRow`) | Consume, nunca reimplementa |
| snake_case → camelCase hacia el motor | `quote-core` | Consume, nunca reimplementa |
| Ownership guard `GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET` | `quote-core.mapPricingGroupRow` | Consume, nunca reimplementa |
| Guard `FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS` | `engine/src/pricingEngine.js :: computeQuoteCanonical` | Consume vía `quote-core`, nunca reimplementa |
| Cálculo financiero (main + supplemental) | `quote-core.calculateQuoteDraft(envelope)` | **Única puerta de entrada al motor** |
| Metadata de motor/contrato | `quote-core.QUOTE_ENGINE_METADATA` | **Única fuente**, nunca inventada aquí |
| Validación estructural de emisión (§2) | funciones SQL de `LP-SCHEMA-002` | Invoca, nunca duplica en aplicación |
| Mutex de emisión (row lock de `quote`) | `LP-SCHEMA-002` (convención documentada en `fn_supersede_previous_quote_versions`) | Adquiere y respeta, nunca inventa un mecanismo alterno |
| Finitud numérica de columnas persistentes (`is_finite_numeric(...)`) | `LP-SCHEMA-002` (CHECKs sobre `cost_reference`/`pricing_group`/`pricing_group_cost_item`/`quote_sale_based_cost_item`) | La finitud está **definida/cerrada** en el DDL canónico de LP-SCHEMA-002T; cuando ese DDL sea aplicado, PostgreSQL impondrá esos `CHECK`. LP-EMIT no reabre ni reimplementa esa decisión. **LP-SCHEMA-002T está PUBLISHED en Git, pero el SQL sigue OFFLINE** (no aplicado a Supabase ni a ninguna base real) — mientras siga OFFLINE, no se afirma que la garantía ya exista físicamente en una DB real; el motor (`Number.isFinite`) sigue siendo la autoridad de cálculo en tiempo de ejecución |

`LP-EMIT-001` recibe el `envelope` DB-shaped (§2), lo pasa **sin transformación adicional propia** a `calculateQuoteDraft`, y usa `main.engineInput`/`main.engineOutput`/`supplementalCalculations`/`QUOTE_ENGINE_METADATA` exactamente como esa función los produce — nunca reordena, redondea, renombra ni agrega campos al resultado del motor.

---

## 2. Agregado coherente de emisión

### 2.1 Conjunto exacto de datos leídos como un único estado coherente

Una operación de emisión debe leer, **en un único snapshot transaccional coherente** (mismo instante lógico de lectura, dentro de la transacción de emisión — ver §7 paso 2), exactamente:

1. `quote` (la fila siendo emitida).
2. `issuing_company` referenciada por `quote.issuing_company_id`.
3. `third_party` (cliente) referenciado por `quote.client_third_party_id`.
4. `third_party_contact` referenciado por `quote.client_contact_id`, **si `client_contact_id IS NOT NULL`** (LP-SCHEMA-001 §4.8, corrección 7 v1.3).
5. `third_party_address` referenciado por `quote.client_address_id`, **si `client_address_id IS NOT NULL`**.
6. Todas las `quote_section` con `status='ACTIVE'` de esa `quote`.
7. Todas las `quote_line` con `status='ACTIVE'` de esa `quote` (denormalizadas por `quote_id`, LP-SCHEMA-001 §4.11).
8. Todos los `pricing_group` con `status='ACTIVE'` **relevantes** — es decir, todo `pricing_group` de esa `quote` con `status='ACTIVE'`, independientemente de `quote_total_role`, porque la relevancia comercial (§3) se determina cruzando contra las `quote_line` ACTIVE leídas en el punto 7, no filtrando de antemano.
9. Todos los `pricing_group_cost_item` con `status='ACTIVE'` que pertenezcan a los `pricing_group` leídos en el punto 8.
10. Todos los `quote_sale_based_cost_item` con `status='ACTIVE'` de esa `quote`.
11. **(LP-EMIT-001R, corrección 2 — nueva)** Todos los `catalog_item` referenciados por `catalog_item_id` de las `quote_line` ACTIVE leídas en el punto 7 — necesarios para poblar `catalog_reference.name` en `commercial_lines_snapshot` (§4.4). Esta lectura **no exige** `catalog_item.status='ACTIVE'`: es trazabilidad del objeto que la línea referenció en el momento de captura, no una relectura del maestro vivo con las mismas reglas de vigencia que aplican a otras partes del agregado. No se leen otros masters (`catalog_item_variant`, `cost_reference`, etc.) — únicamente el `catalog_item` necesario para el nombre mostrado.

### 2.2 Mutex de emisión y coherencia del agregado (dos garantías distintas — LP-EMIT-001R, corrección 1)

**Mecanismo de mutex v1, ya elegido por `LP-SCHEMA-002` — no es una decisión pendiente de este contrato:** el candado de emisión es el **row lock de la fila `quote`** (equivalente a `SELECT ... FOR UPDATE` sobre esa fila). El comentario de `fn_supersede_previous_quote_versions` en `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql` ya documenta esta convención ("used immediately after inserting the new `quote_version` + `quote_version_calculation` pair, within the same transaction that holds the `quote` row lock") — LP-EMIT-001 no elige entre "row lock vs. token optimista"; adopta el mecanismo ya canónico. **No se introduce ninguna columna de token de revisión nueva.**

**El mutex y la coherencia de lectura del agregado NO son la misma garantía — deben tratarse por separado:**

- **Mutex (adquisición del row lock):** serializa las operaciones de emisión de una misma `quote` entre sí — mientras una transacción sostiene el lock, ninguna otra transacción de emisión de esa misma `quote` puede avanzar. Esto por sí solo **no** garantiza que las múltiples lecturas del agregado (§2.1, puntos 2-11) observen un estado mutuamente consistente: un row lock aislado sobre `quote`, ejecutado bajo `READ COMMITTED` (el nivel de aislamiento por defecto de PostgreSQL), **no** impide que dos `SELECT` sucesivos dentro de la misma transacción observen commits distintos de otras filas (`quote_line`, `pricing_group`, etc.) si algún proceso las modificara sin pasar por el mutex de `quote` — no debe describirse un row lock aislado bajo `READ COMMITTED` como equivalente, por sí mismo, a un snapshot consistente de múltiples lecturas.
- **Coherencia del agregado (snapshot consistente):** las lecturas de §2.1 deben compartir **un único snapshot transaccional coherente** — la transacción de emisión debe ejecutarse con un nivel de aislamiento que garantice esa vista consistente entre sus propias lecturas (equivalente a `REPEATABLE READ` o superior), de modo que los puntos 2-11 de §2.1 vean el estado del agregado tal como existía en un mismo instante lógico, independientemente de qué mutex esté sosteniendo la fila `quote`. Cuál combinación exacta de nivel de aislamiento/mecanismo SQL implementa esto es una decisión de la migración de implementación — este contrato exige la propiedad observable (coherencia de snapshot), no el dialecto SQL exacto.

**Adquisición fail-fast (NOWAIT / try-lock equivalente — LP-EMIT-001S, corrección 3: se elimina `SKIP LOCKED` como ejemplo equivalente):** el comportamiento ya especificado en versiones previas de este contrato — que dos emisiones simultáneas de la misma `quote` no esperan en cola a que la primera termine — se cierra semánticamente como **adquisición fail-fast**: la operación intenta adquirir el row lock de `quote` de forma no bloqueante (equivalente a `NOWAIT` o un try-lock); si el lock ya está sostenido por otra transacción de emisión en curso, la segunda operación **falla inmediatamente** con `EMISSION_CONCURRENCY_CONFLICT` (§9) — nunca se bloquea esperando el turno. **`SKIP LOCKED` no es un ejemplo equivalente y no se usa aquí:** `SKIP LOCKED` omite silenciosamente una fila bloqueada (útil para colas de trabajo que procesan "la siguiente fila disponible"), y no representa por sí solo el conflicto explícito que este contrato exige — la operación de emisión debe **reportar** `EMISSION_CONCURRENCY_CONFLICT` cuando la fila `quote` objetivo está bloqueada, no saltarla silenciosamente. Esto no se especifica como sintaxis SQL concreta (`NOWAIT` es el nombre de PostgreSQL; el contrato exige la semántica, no el keyword), no se diseña SQL concreto, y no se introduce ningún token optimista ni columna nueva — es vinculante como comportamiento observable.

### 2.3 Qué valida cada capa (sin duplicar en aplicación una garantía de DB)

| Validación | Capa dueña | LP-EMIT-001 |
|---|---|---|
| Los 13 checks estructurales de emisión (`issuer_present`, `client_present`, `client_role_valid`, `main_group_present`, `anchor_exactness`, `active_line_group_active`, `priced_anchor_group_commercial`, `line_status_role_valid`, `optional_not_orphan`, `currency_consistent`, `ownership_guard_final_target`, `emittable_lines_quantity_valid`, `catalog_origin_integrity`) | `validate_quote_for_emission(quote_id)` (SQL, LP-SCHEMA-002) | **Invoca** el resultado; si algún check `passed=false`, aborta con `QUOTE_NOT_EMITTABLE` (§9) antes de tocar el motor — nunca reimplementa estos 13 checks en aplicación |
| Siguiente `version_number` libre de carrera | `fn_next_quote_version_number(quote_id)` (SQL) | **Invoca**, dentro de la misma transacción que ya sostiene el row lock de `quote` (§2.2) — nunca calcula `MAX(version_number)+1` en aplicación fuera de transacción |
| Marcar versiones `ISSUED` anteriores como `SUPERSEDED` | `fn_supersede_previous_quote_versions(quote_id, new_version_id)` (SQL) | **Invoca**, después de insertar la nueva versión (§7 paso 11) — nunca actualiza `status` de versiones anteriores a mano |
| Inmutabilidad de contenido / máquina de estados `ISSUED→{ISSUED,SUPERSEDED,VOID}` de `quote_version` | `fn_quote_version_content_and_status_guard()` (trigger, LP-SCHEMA-002) | Nunca intenta un `UPDATE` de contenido; solo el `INSERT` inicial en estado `ISSUED` (§7 paso 10) y, en el mismo statement de superseding, el `UPDATE` de `status` que el trigger ya permite |
| Deferred integrity: toda `quote_version` debe tener su `quote_version_calculation` al `COMMIT` | `trg_quote_version_require_calculation` (constraint trigger `DEFERRABLE INITIALLY DEFERRED`, LP-SCHEMA-002) | Garantiza estructuralmente el paso 11 (§7) — LP-EMIT-001 **debe** ejecutar el `INSERT` de `quote_version_calculation` en la misma transacción, pero la garantía de "nunca sin calculation" la impone el trigger, no una verificación de aplicación después del hecho |
| ZERO DELETE en todas las tablas de dominio | `fn_forbid_delete()` (trigger, LP-SCHEMA-002) | No aplica a esta operación (la emisión nunca borra) — mencionado para completitud de frontera |
| Finitud numérica de columnas persistentes (`is_finite_numeric(...)`) | `LP-SCHEMA-002` (CHECKs definidos en el DDL, **DDL sigue OFFLINE**) | La finitud está definida/cerrada en el DDL; cuando ese DDL sea aplicado, PostgreSQL impondrá esos `CHECK` — LP-EMIT no reabre esa decisión, pero tampoco afirma que el CHECK ya opere sobre una base real mientras el schema siga OFFLINE. El motor (`Number.isFinite`) sigue siendo la autoridad de cálculo en tiempo de ejecución — ver §1 |
| Precondición de lifecycle de `Quote` (LP-EMIT-001S, corrección 2 — nueva) | `LP-EMIT` / operación de emisión (**no** `validate_quote_for_emission`, que no contiene este check) | `quote.status` debe pertenecer a `{DRAFT, ACTIVE}` inmediatamente después de leer la fila `quote` bajo el mutex (§7, entre pasos 1-2) y **antes** de cargar/calcular/persistir cualquier otra cosa; si es `ARCHIVED`/`VOID`, abortar con `QUOTE_NOT_EMITTABLE` (§9.1) |
| Cálculo financiero, ownership guards financieros | `quote-core` + `pricingEngine.js` | Invoca vía `calculateQuoteDraft`, nunca reimplementa (§1) |

**Principio general:** si una garantía ya existe como `CHECK`/trigger/función SQL en `LP-SCHEMA-002`, LP-EMIT-001 la invoca y confía en ella — no la reverifica en aplicación "por si acaso". Esto no aplica a la precondición de lifecycle de `Quote` de la fila anterior: ese check **no** existe hoy en `validate_quote_for_emission`, así que LP-EMIT-001 sí debe ejecutarlo explícitamente como parte de la operación de emisión.

---

## 3. Selección de supplemental calculations (cierre vinculante, no heurístico)

**Regla única, sin excepciones ni inferencia:**

Un `pricing_group` con `quote_total_role IN ('OPTIONAL','REFERENCE_ONLY')` se considera **materialmente parte** de la versión emitida **si y solo si** existe, entre las `quote_line` ACTIVE leídas en §2.1 punto 7, al menos una línea cuya combinación `(pricing_group_id, line_status)` es su **ancla válida** según la tabla cerrada de LP-SCHEMA-001 §4.10:

| `pricing_group.quote_total_role` | `quote_line.line_status` ancla válida |
|---|---|
| `OPTIONAL` | `OPTIONAL` |
| `REFERENCE_ONLY` | `REFERENCE_NOT_INCLUDED`, **y** `pricing_group_id` de esa línea apunta exactamente a ese grupo |

Por construcción de LP-SCHEMA-001 §4.10 ("ancla exacta al emitir"), si el grupo es materialmente parte de la versión, esa ancla es **exactamente una** — `validate_quote_for_emission` (`anchor_exactness`) ya lo garantiza antes de llegar a este paso (§2.3); LP-EMIT-001 no vuelve a contar anclas, solo lee cuál `pricing_group_id` está referenciado.

**Consecuencias explícitas, sin heurística:**

- Un `pricing_group` `OPTIONAL` **con** una `quote_line` ACTIVE `OPTIONAL` que lo ancla → su cálculo supplemental **se incluye** en `internal_calculation_snapshot`.
- Un `pricing_group` `REFERENCE_ONLY` **con** una `quote_line` ACTIVE `REFERENCE_NOT_INCLUDED` que lo ancla → su cálculo supplemental **se incluye**.
- Una `quote_line` `REFERENCE_NOT_INCLUDED` puramente informativa con `pricing_group_id IS NULL` → **puede** aparecer en `commercial_lines_snapshot` (es contenido comercial legítimo, LP-SCHEMA-001 §4.10), pero **no genera** ninguna entrada en `internal_calculation_snapshot` — no hay grupo ni cálculo que preservar, y su `presented_price` es `null` (§4.4).

**Grupos con `pricing_mode IS NOT NULL` ("priced") sin ancla (LP-EMIT-001R, corrección 6 — alineado exactamente con `anchor_exactness`):** `anchor_exactness` en `validate_quote_for_emission` **solo evalúa** `pricing_group` `ACTIVE` con `pricing_mode IS NOT NULL` (ver `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql`, comentario "5. anchor_exactness: for every ACTIVE, priced pricing_group"). Un `pricing_group` `OPTIONAL`/`REFERENCE_ONLY` `ACTIVE` con `pricing_mode IS NOT NULL` que llegue a este paso (§7 de la secuencia) sin su ancla — estado que `anchor_exactness` ya debería haber impedido en el paso 3 — es un fallo de invariante: `SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY` (§9).

**Grupos de solo costo (`pricing_mode IS NULL`) — corrección 6, sin inventar una regla que el DDL no contiene:** un `pricing_group` con `pricing_mode IS NULL` (grupo de solo costo/interno) **nunca** se vuelve contenido comercial y **nunca** entra a `internal_calculation_snapshot`, porque `priced_anchor_group_commercial` en `validate_quote_for_emission` ya exige que toda `quote_line` `PRICED`/`OPTIONAL`/`REFERENCE_NOT_INCLUDED` con `pricing_group_id IS NOT NULL` referencie un `pricing_group` con `pricing_mode IS NOT NULL` — por construcción, un grupo de solo costo **nunca puede ser la ancla** de ninguna de esas líneas, así que su ausencia de ancla es la situación normal esperada, **no** un `SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY`. Este contrato **no afirma** que un `pricing_group` de solo costo con alguna `quote_line` `INCLUDED` (subordinada) apuntándole esté prohibido — LP-SCHEMA-001/LP-SCHEMA-002 no contienen ese invariante (`active_line_group_active` solo exige que el grupo referenciado esté `ACTIVE`, no que tenga `pricing_mode NOT NULL`); un grupo de solo costo con líneas subordinadas `INCLUDED` es una configuración válida, simplemente **nunca recibe `presented_price`** (§4.4) y **nunca genera entrada** en `internal_calculation_snapshot`.

**Cómo se implementa con `quote-core` (sin reimplementar mapeo):** `calculateSupplementalGroups(envelope)` (LP-ORCH-001) ya calcula **todo** grupo `ACTIVE` `OPTIONAL`/`REFERENCE_ONLY` del envelope, sin conocer `quote_line` ni `pricing_mode` como criterio de filtrado. LP-EMIT-001 es la capa que, **después** de recibir el arreglo completo `supplementalCalculations` de `calculateQuoteDraft`, lo **filtra** contra el criterio de ancla de esta sección antes de escribirlo en `internal_calculation_snapshot` — el filtrado por ancla comercial es responsabilidad de LP-EMIT-001, no de `quote-core` (que deliberadamente no conoce `quote_line`, LP-ORCH-001 §11).

---

## 4. Commercial snapshot (shape v1, whitelist estricta)

`commercial_snapshot_schema_version = 'v1'` (LP-SCHEMA-001 §4.14, corrección 12).

### 4.1 `quote_header_snapshot`

```jsonc
{
  "quote_id": "<uuid>",
  "folio": "<text | null>",
  "currency": "<text, ^[A-Z]{3}$>",
  "display_mode": "COMPONENT_PRICING | CONSOLIDATED_PRICING | MIXED_PRICING",
  "valid_until": "<date | null>",
  "reference_label": "<text | null>"
}
```

Nunca incluye `status`, `issuing_company_id`/`client_third_party_id` crudos (esos van en `issuer_snapshot`/`client_snapshot`, no como FKs vivas — LP-SCHEMA-001 corrección 17), ni columnas de auditoría (`created_at`/`updated_at`/`created_by`/`updated_by`).

### 4.2 `issuer_snapshot`

```jsonc
{
  "issuing_company_id": "<uuid>",   // id de origen, solo para trazabilidad — nunca FK viva
  "code": "BROKING | SATHRI",
  "legal_name": "<text>",
  "tax_id": "<text | null>"
}
```

### 4.3 `client_snapshot`

```jsonc
{
  "third_party_id": "<uuid>",        // id de origen, solo para trazabilidad — nunca FK viva
  "display_name": "<text>",
  "legal_name": "<text | null>",
  "tax_id": "<text | null>",
  "contact": null | {                 // únicamente el contacto seleccionado en quote.client_contact_id
    "third_party_contact_id": "<uuid>",
    "full_name": "<text>",
    "role_label": "<text | null>",
    "email": "<text | null>",
    "phone": "<text | null>"
  },
  "address": null | {                 // únicamente el domicilio seleccionado en quote.client_address_id
    "third_party_address_id": "<uuid>",
    "address_kind": "<text | null>",
    "line1": "<text | null>", "line2": "<text | null>",
    "city": "<text | null>", "state": "<text | null>",
    "postal_code": "<text | null>", "country": "<text | null>"
  }
}
```

**Nunca** se incluyen otros contactos/domicilios del `third_party` que no sean los explícitamente seleccionados en `quote.client_contact_id`/`quote.client_address_id` (LP-SCHEMA-001 §4.14, corrección 8 — "nunca se elige 'el primario' silenciosamente en emisión"). Si `client_contact_id`/`client_address_id` es `NULL`, el campo correspondiente (`contact`/`address`) es `null`.

### 4.4 `commercial_lines_snapshot`

Arreglo de objetos, uno por `quote_line` ACTIVE incluida en la versión (§2.1 punto 7), agrupados/ordenados por sección:

```jsonc
[
  {
    "section": { "quote_section_id": "<uuid>", "label": "<text>", "display_order": <int> },
    "line": {
      "quote_line_id": "<uuid>",
      "display_order": <int>,
      "origin_kind": "PRODUCT | SERVICE | KIT | SOLUTION | FREE_CONCEPT",
      "commercial_description": "<text>",
      "technical_description": "<text | null>",
      "quantity": <number>,
      "unit_label": "<text | null>",
      "line_status": "PRICED | INCLUDED | OPTIONAL | REFERENCE_NOT_INCLUDED",
      "catalog_reference": null | { "catalog_item_id": "<uuid>", "name": "<text>" },  // id/nombre desde el catalog_item leído en §2.1 punto 11 — nunca costo
      "presented_price": null | {
        "ventaNet": <number>,
        "ventaGross": <number>,
        "currency": "<text>",
        "pricing_group_id": "<uuid>"
      }
    }
  }
]
```

**`presented_price` (LP-EMIT-001R, corrección 3 — reemplaza la formulación anterior, que lo trataba como obligatorio para toda línea):** **no** es obligatorio para toda `quote_line`. Es **`null`** salvo que la línea sea, exactamente, la **línea ancla** (§3, tabla LP-SCHEMA-001 §4.10) de un `pricing_group` comercial con `pricing_mode IS NOT NULL` — es decir, únicamente en estas tres combinaciones:

| Rol del grupo | `line_status` de la línea ancla |
|---|---|
| `INCLUDED` | `PRICED` |
| `OPTIONAL` | `OPTIONAL` |
| `REFERENCE_ONLY` | `REFERENCE_NOT_INCLUDED` (con `pricing_group_id` poblado) |

`presented_price` es **siempre `null`** para: cualquier línea subordinada con `line_status='INCLUDED'` (su precio ya está absorbido dentro del precio único del grupo, mostrado únicamente en la línea ancla — LP-SCHEMA-001 §4.10, "línea subordinada"); cualquier `REFERENCE_NOT_INCLUDED` con `pricing_group_id IS NULL` (puramente informativa, sin cálculo detrás); y cualquier otra línea sin precio comercial independiente propio. **Nunca se repite** el precio único de un grupo en sus líneas subordinadas `INCLUDED` — cada precio aparece exactamente una vez, en su línea ancla.

Cuando `presented_price` no es `null`, se deriva así (usando el mapping de identidad de §5): para la ancla `PRICED` de un grupo `INCLUDED` que participa del agregado principal, de `main.engineOutput.groups[i]` (identificado vía el mapping de §5); para la ancla `OPTIONAL`/`REFERENCE_NOT_INCLUDED` de un grupo `OPTIONAL`/`REFERENCE_ONLY`, de la entrada correspondiente de `supplementalCalculations` ya filtrada por §3 (identificada directamente por su `pricing_group_id`, que LP-ORCH-001 ya devuelve en cada entrada). `presented_price` extrae **únicamente** los campos de venta ya calculados por el motor (`ventaNet`, `ventaGross`, `currency`) — nunca recalcula ni re-deriva un precio por su cuenta.

**Excluye siempre** (LP-SCHEMA-001 §4.14, corrección 15, reafirmado aquí): `costoNet`/`costoGross`, `utilidad`, `markupSobreCosto`, `margenSobreVenta`, `engine_input`/`engine_output` completos, `source_snapshot` de KIT/SOLUTION, y cualquier columna de auditoría de `quote_line`.

### 4.5 `terms_snapshot`

```jsonc
{ "terms_text": "<text | null>" }
```

Copia directa de `quote.terms_text` en el instante de emisión (LP-SCHEMA-001 §4.8/§4.14).

---

## 5. Mapping de identidad — `pricing_group_id` en el output principal (LP-EMIT-001R, corrección 4 — nuevo)

**Problema a cerrar:** `pricingEngine.js :: computeQuoteCanonical`/`computeQuote` no devuelve `pricing_group_id` dentro de `main.engineOutput.groups[]` — el motor es deliberadamente agnóstico de identidad de dominio (LP-ENG-002T, "no conoce Project, UI, Supabase... ni ninguna entidad de dominio del legacy"). Para construir `presented_price` de la línea ancla `PRICED` del agregado principal (§4.4), LP-EMIT-001 necesita saber a qué `pricing_group_id` corresponde cada posición `main.engineOutput.groups[i]` — **sin modificar `quote-core` ni el motor** para agregar esa identidad al output financiero.

**Solución — sidecar no financiero, mantenido por LP-EMIT-001, nunca dentro de `engineInput`/`engineOutput`:**

Antes de invocar `calculateQuoteDraft(envelope)`, LP-EMIT-001 construye:

```
includedPricingGroupIdsInEngineOrder =
  [ g.id for g in pricingGroups
    where g.status = 'ACTIVE' and g.quote_total_role = 'INCLUDED' ]
  // en EXACTAMENTE el mismo orden en que ese mismo filtro y mapeo
  // se le entrega al adapter (buildMainEngineInput, LP-ORCH-001,
  // itera pricingGroups en el orden en que el envelope los trae).
```

Después del cálculo:

- `main.engineOutput.groups[i]` corresponde a `includedPricingGroupIdsInEngineOrder[i]`, para cada `i`.
- **Exigir igualdad de cardinalidad** antes de usar el mapping: `main.engineOutput.groups.length === includedPricingGroupIdsInEngineOrder.length`. Si no coincide, es un **fallo de invariante interno** — no es un rechazo financiero real lanzado por `calculateQuoteDraft`/`quote-core`/`pricingEngine.js` (eso sería `FINANCIAL_CALCULATION_REJECTED`), ni un fallo de infraestructura de persistencia (eso sería `PERSISTENCE_TRANSACTION_FAILURE`): es una incoherencia imposible detectada por la capa de orquestación de LP-EMIT-001 después de que las capas canónicas ya produjeron sus resultados, indicando una discrepancia entre el orden que LP-EMIT-001 asumió y el que `buildMainEngineInput` realmente produjo. Se reporta como `EMISSION_INTERNAL_INVARIANT_FAILURE` (§9.1) — nunca se silencia ni se intenta reconciliar heurísticamente, y nunca se esconde bajo `FINANCIAL_CALCULATION_REJECTED` o `PERSISTENCE_TRANSACTION_FAILURE` solo por conveniencia de categorización.
- Este mapping se usa **exclusivamente** para obtener `ventaNet`/`ventaGross`/`currency` del grupo ancla al construir `presented_price` (§4.4) — **nunca** se escribe dentro de `engineInput`, **nunca** se agrega `pricing_group_id` al motor, y **nunca** reimplementa el mapeo snake_case → engine (§1).
- Para los cálculos **supplemental** (`OPTIONAL`/`REFERENCE_ONLY`), este mapping **no es necesario**: cada entrada de `supplementalCalculations` ya trae su propio `pricing_group_id` directamente (LP-ORCH-001, `calculateSupplementalGroups` retorna `{ pricing_group_id, quote_total_role, engine_input, engine_output }` por construcción) — se usa ese campo tal cual.

Este sidecar es puramente posicional y vive enteramente dentro de la operación de emisión (aplicación) — no es una columna, no es un cambio a `quote-core`, y no forma parte de ningún snapshot persistido salvo indirectamente a través de `presented_price.pricing_group_id`.

---

## 6. Internal calculation snapshot (shape v1)

En `quote_version_calculation`:

```jsonc
{
  "engine_input":  /* = main.engineInput  de calculateQuoteDraft(envelope), tal cual */,
  "engine_output": /* = main.engineOutput de calculateQuoteDraft(envelope), tal cual */,
  "internal_calculation_snapshot": [
    // únicamente las entradas de supplementalCalculations que §3 determinó
    // materialmente incluidas — nunca el arreglo completo sin filtrar.
    // Si no existe ninguna entrada material, este arreglo es [] — NUNCA null
    // (LP-EMIT-001R, corrección 10: "cero supplementals" se representa como
    // arreglo vacío, no como ausencia del campo ni como NULL).
    {
      "pricing_group_id": "<uuid>",
      "quote_total_role": "OPTIONAL | REFERENCE_ONLY",
      "engine_input":  /* = entry.engine_input  tal cual lo produjo calculateSupplementalGroups */,
      "engine_output": /* = entry.engine_output tal cual */
    }
    // ... una entrada por cada pricing_group supplemental materialmente incluido
  ],
  "engine_commit_sha":          /* = QUOTE_ENGINE_METADATA.engineCommitSha */,
  "engine_contract_version":    /* = QUOTE_ENGINE_METADATA.engineContractVersion */,
  "calculation_schema_version": /* = QUOTE_ENGINE_METADATA.calculationSchemaVersion */
}
```

**Reglas exactas (sin excepción):**
- `engine_input`/`engine_output` de nivel `quote_version_calculation` son **exactamente** `main.engineInput`/`main.engineOutput` de `calculateMainQuote`/`calculateQuoteDraft` — sin recortar, sin renombrar, sin agregar campos (LP-SCHEMA-001 §4.15, LP-ORCH-001 §11 "sin redondeo, sin reinterpretación, sin rename").
- `internal_calculation_snapshot` contiene **únicamente** las entradas cuyo `pricing_group_id` pasó el filtro de ancla comercial de §3 — nunca el arreglo `supplementalCalculations` completo devuelto por `calculateQuoteDraft` sin filtrar. Cuando no hay ninguna entrada material, el valor es `[]` (arreglo vacío), nunca `null` (corrección 10).
- `engine_commit_sha`/`engine_contract_version`/`calculation_schema_version` provienen **exclusivamente** de `QUOTE_ENGINE_METADATA` (LP-ORCH-001) — nunca de una constante paralela definida en la capa de emisión, para que ambas capas nunca puedan divergir sobre qué motor se usó.

---

## 7. Atomicidad de emisión — secuencia lógica (una sola transacción)

Toda la secuencia siguiente ocurre dentro de **una** transacción/sesión de base de datos (ver §11, boundary de implementación); cualquier fallo en cualquier paso produce **rollback total** (ningún efecto parcial visible) y termina con uno de los errores de §9. No se especifica aquí el dialecto SQL exacto — eso es una decisión de la migración de implementación. **Orden corregido (LP-EMIT-001R, corrección 5):** el cálculo financiero y la validación/selección de su resultado ocurren **antes** de construir cualquier snapshot comercial — los snapshots se construyen una sola vez, ya con el mapping de identidad y la selección de supplemental resueltos, nunca antes.

1. **Adquirir el mutex de emisión y aplicar de inmediato la precondición de lifecycle de `Quote`** — row lock fail-fast (`NOWAIT`/try-lock equivalente) sobre la fila `quote` (§2.2); si no se puede adquirir de inmediato (otra emisión en curso), abortar sin más trabajo con `EMISSION_CONCURRENCY_CONFLICT`. Inmediatamente después de leer la fila `quote` bajo ese lock, **antes de cargar el resto del agregado, calcular o persistir nada** (LP-EMIT-001S, corrección 2 — nueva): `quote.status` debe pertenecer a `{DRAFT, ACTIVE}`; si es `ARCHIVED`/`VOID`, abortar con `QUOTE_NOT_EMITTABLE` (§2.3, §9.1) — esta precondición **no** la garantiza `validate_quote_for_emission` (que no la contiene) y por tanto la aplica explícitamente esta operación, integrada en este mismo paso sin aumentar el número total de pasos.
2. **Cargar el agregado coherente** (§2.1, incluye ahora los `catalog_item` referenciados) dentro de la misma transacción, con un nivel de aislamiento que garantice snapshot consistente entre estas lecturas (§2.2 — distinto del mutex del paso 1).
3. **Invocar `validate_quote_for_emission(quote_id)`** (§2.3). Si algún check retorna `passed=false`, abortar con `QUOTE_NOT_EMITTABLE`, incluyendo qué check(s) fallaron.
4. **Construir el envelope financiero** DB-shaped (`{ quote, pricingGroups, pricingGroupCostItems, quoteSaleBasedCostItems }`) a partir del agregado cargado en el paso 2 — sin transformación propia adicional (§1). En el mismo paso, construir `includedPricingGroupIdsInEngineOrder` (§5) a partir de `pricingGroups`, en el mismo orden que se le entregará al adapter.
5. **Invocar `calculateQuoteDraft(envelope)`** (`quote-core`, LP-ORCH-001). Si lanza (`MAIN_INCLUDED_GROUP_REQUIRED`, `GROUP_KNOWN_SALE_BASED_COST_REQUIRES_FINAL_TARGET`, `FINAL_TARGET_WITH_UNALLOCATED_QUOTE_LEVEL_COSTS`, cualquier error de `mapCostItemRow`/`mapPricingGroupRow`, o el propio motor), abortar con `FINANCIAL_CALCULATION_REJECTED`, preservando la causa original (§9 — nunca se traduce a un código genérico que la pierda).
6. **Construir y validar el mapping de identidad del output principal** (§5) — verificar la igualdad de cardinalidad entre `main.engineOutput.groups` e `includedPricingGroupIdsInEngineOrder`; si no coincide, abortar con `EMISSION_INTERNAL_INVARIANT_FAILURE` (§5, §9.1).
7. **Seleccionar/validar los supplemental calculations materiales** (§3) sobre `supplementalCalculations` del paso 5, usando las `quote_line` ACTIVE cargadas en el paso 2. Si se detecta un `pricing_group` `OPTIONAL`/`REFERENCE_ONLY` `ACTIVE` con `pricing_mode IS NOT NULL` sin ancla (estado que `anchor_exactness` del paso 3 debería haber impedido), abortar con `SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY`. Un grupo de solo costo sin ancla no es un error (§3) — simplemente no produce entrada.
8. **Construir los snapshots comerciales por whitelist** (§4), ahora que el mapping (paso 6) y la selección de supplemental (paso 7) ya están resueltos — `presented_price` de cada línea ancla se deriva de estos dos resultados, nunca antes de tenerlos. Si falta algún dato requerido por la whitelist que debería haber sido garantizado por el paso 3 (ej. `client_snapshot.display_name` ausente), abortar con `COMMERCIAL_SNAPSHOT_INCOMPLETE`.
9. **Determinar `version_number`** invocando `fn_next_quote_version_number(quote_id)` (§2.3) — dentro de la misma transacción, protegida por el mutex del paso 1.
10. **Crear la nueva `quote_version`**, inicialmente `status='ISSUED'` (único estado permitido en `INSERT` por `fn_quote_version_content_and_status_guard`, LP-SCHEMA-002), con los snapshots del paso 8, `commercial_snapshot_schema_version='v1'`, y `issued_at = <emission_timestamp>` (§7.1).
11. **Crear exactamente una `quote_version_calculation`**, 1:1 con la `quote_version` del paso 10, con el contenido de §6 (usando la selección del paso 7 y la metadata de `QUOTE_ENGINE_METADATA`) — en la misma transacción, satisfaciendo el constraint trigger diferido (§2.3) que exige que exista al `COMMIT`. `created_at = <emission_timestamp>` (el mismo valor que `issued_at` del paso 10 — §7.1).
12. **Invocar `fn_supersede_previous_quote_versions(quote_id, new_version_id)`** — marca cualquier `quote_version` previa en `status='ISSUED'` de esa `quote` como `SUPERSEDED`, dentro de la misma transacción (§8).
13. **Transición de estado de `quote`:**
    - Si `quote.status = 'DRAFT'` (primera emisión): `DRAFT → ACTIVE`.
    - Si `quote.status = 'ACTIVE'` (reemisión): permanece `ACTIVE`.
    - Ningún otro `quote.status` de entrada es válido para esta operación (`quote.status IN ('ARCHIVED','VOID')` ya fue rechazado en el paso 1 por la precondición explícita de lifecycle, §2.3 — no por `validate_quote_for_emission`, que no contiene ese check).
14. **Commit atómico** — todos los pasos 9-13 se confirman como una sola unidad; si cualquier paso 1-13 falla, **rollback total lógico**, sin dejar ninguna `quote_version` sin su `quote_version_calculation`, sin `version_number` "saltado" de forma visible a otra transacción, y sin cambio de `quote.status`.

### 7.1 Auditoría temporal y actor unificados (LP-EMIT-001R, corrección 9 — nuevo)

Una única emisión usa **un solo** `emission_timestamp`, capturado una vez al inicio de la fase de persistencia (pasos 9-14), y **un solo** actor autenticado (cuando exista):

- `quote_version.issued_at = quote_version_calculation.created_at = <emission_timestamp>`.
- `quote_version.issued_by = quote_version_calculation.created_by = <actor autenticado>`, cuando exista un actor autenticado ejecutando la emisión (ambas columnas son `uuid NULL` con FK diferida, LP-SCHEMA-001 §4.14/§4.15 — permanecen `NULL` si no hay actor identificable, pero nunca deben divergir entre sí cuando sí existe).

Ambos pares de columnas pertenecen a la **misma transacción** (pasos 10-11) — no se capturan por separado ni se recalculan entre el `INSERT` de `quote_version` y el de `quote_version_calculation`.

**Nunca:** una `quote_version` sin `quote_version_calculation` sobrevive a un `COMMIT` exitoso (garantizado estructuralmente por el constraint trigger diferido de LP-SCHEMA-002, §2.3 — este contrato no depende únicamente de la disciplina de aplicación para esa garantía).

---

## 8. Reemisión y versionado

- `Quote` sigue siendo un workspace mutable en todo momento (LP-SCHEMA-001 §6) — la emisión no la congela, solo produce un snapshot append-only.
- `QuoteVersion` es append-only en contenido: cada emisión (primera o reemisión) crea una fila nueva; **ninguna** `quote_version`/`quote_version_calculation` existente se modifica en contenido (solo `quote_version.status` transiciona, vía el trigger de LP-SCHEMA-002, §2.3).
- Una reemisión **no modifica** los snapshots de versiones previas — cada `quote_version` es una fotografía independiente del agregado en el instante de esa emisión específica.
- La versión anterior en `status='ISSUED'` pasa a `SUPERSEDED` **dentro de la misma operación atómica** que emite la nueva versión (§7 paso 12) — nunca en una transacción separada, para que no exista una ventana donde dos versiones aparezcan simultáneamente como `ISSUED` para la misma `quote`.
- `VOID` es una operación explícita **aparte**, fuera del alcance de este contrato de emisión — anular una `quote_version` (`ISSUED→VOID` o `SUPERSEDED→VOID`, ambas transiciones ya válidas según la máquina de estados de LP-SCHEMA-002) no es una reemisión y no debe confundirse con ella: `VOID` no crea una nueva versión, no recalcula nada, y no pasa por `calculateQuoteDraft`.
- **Carrera de dos emisiones simultáneas de la misma `quote`:** el mutex fail-fast (§2.2, §7 paso 1) garantiza que como máximo una de las dos operaciones concurrentes adquiera el row lock y proceda; la otra falla de inmediato con `EMISSION_CONCURRENCY_CONFLICT` (§9), **antes** de haber invocado el motor o leído siquiera el agregado — nunca ambas deben producir una `quote_version`, y nunca debe producirse un estado donde dos `quote_version` con `status='ISSUED'` coexistan para la misma `quote` como resultado de una carrera.

---

## 9. Errores / resultado de la operación

### 9.1 Categorías estables de error (conceptuales — no SQLSTATE concretos, eso es de la migración)

| Código | Cuándo | Origen de la causa |
|---|---|---|
| `QUOTE_NOT_EMITTABLE` | (a) `quote.status` no pertenece a `{DRAFT, ACTIVE}` al leer la fila bajo el mutex (§7 paso 1 — precondición explícita de LP-EMIT, **no** un check de `validate_quote_for_emission`); o (b) algún check de `validate_quote_for_emission` (§7 paso 3) retorna `passed=false` | (a): origen es la precondición de lifecycle de §2.3/§7 paso 1, aplicada por LP-EMIT directamente. (b): preserva el/los `check_name` fallidos reportados por la función SQL — no se traduce a un mensaje genérico. Ambos orígenes son distintos y no deben confundirse al reportar la causa |
| `EMISSION_CONCURRENCY_CONFLICT` | No se pudo adquirir el row lock fail-fast de `quote` | — |
| `FINANCIAL_CALCULATION_REJECTED` | `calculateQuoteDraft`/`calculateMainQuote`/`calculateSupplementalGroups` lanza (adapter o engine) — exclusivamente error realmente lanzado por esas funciones | Ver §9.2 — nunca se re-envuelve perdiendo la causa |
| `EMISSION_INTERNAL_INVARIANT_FAILURE` (LP-EMIT-001S, corrección 4 — nueva) | Incoherencia imposible detectada por la propia capa de orquestación de LP-EMIT-001 **después** de que las capas canónicas (SQL, `quote-core`, engine) ya produjeron resultados válidos — p. ej. discrepancia de cardinalidad entre `main.engineOutput.groups` e `includedPricingGroupIdsInEngineOrder` (§5, §7 paso 6), o cualquier otra contradicción equivalente de orquestación interna que no sea rechazo financiero real ni fallo de infraestructura | No es `FINANCIAL_CALCULATION_REJECTED` (no lo lanzó `calculateQuoteDraft`/`quote-core`/`pricingEngine.js`) ni `PERSISTENCE_TRANSACTION_FAILURE` (no es un fallo de DB/transacción) — nunca se esconde bajo ninguna de esas dos categorías |
| `COMMERCIAL_SNAPSHOT_INCOMPLETE` | Falta un dato requerido por la whitelist de §4 que `validate_quote_for_emission` debería haber garantizado | Indica discrepancia entre validación estructural y agregado real — tratar como bug de invariante, no como input inválido del usuario |
| `SUPPLEMENTAL_COMMERCIAL_INCONSISTENCY` | Un `pricing_group` con `pricing_mode IS NOT NULL` `OPTIONAL`/`REFERENCE_ONLY` `ACTIVE` sin ancla comercial válida llega al paso 7 de §7 | Mismo tratamiento — indica que `anchor_exactness` no debió haber pasado. **No aplica** a un grupo de solo costo sin ancla (§3) |
| `PERSISTENCE_TRANSACTION_FAILURE` | Cualquier fallo de infraestructura durante los pasos 9-14 de §7 (conexión perdida, deadlock, violación de constraint inesperada) — exclusivamente fallo de DB/transacción/infraestructura durante persistencia | Preserva el error de infraestructura original de la capa de persistencia |

### 9.2 Propagación de errores del engine/adapter (LP-EMIT-001R, corrección 8 — reemplaza la formulación anterior)

`FINANCIAL_CALCULATION_REJECTED` es una **categoría de emisión** — no una re-especificación de los errores internos de `quote-core`/`pricingEngine.js`. Reglas exactas de propagación:

- **No** se afirma que `pricingEngine.js`/`quote-core` siempre expongan `error.code` — `pricingEngine.js` lanza `Error` estándar de JavaScript (mensajes con prefijo `[pricingEngine] <CODIGO>: <detalle>`, sin una propiedad `.code` estructurada), mientras que `quote-core` sí expone `QuoteEngineAdapterError` con `.code` (`ADAPTER_ERROR_CODES`). LP-EMIT-001 no debe asumir uniformidad donde no la hay.
- Si el error original trae una propiedad `code` (estructurada, como en `QuoteEngineAdapterError`), **se preserva tal cual**.
- Se preservan **siempre** `name`, `message`, y `cause` cuando existan en el objeto de error original — sin excepción.
- **Nunca** se parsea `error.message` con expresiones regulares o heurísticas para *inventar* un `code` cuando el error original no trae uno estructurado (ej. un `Error` plano de `pricingEngine.js` con el código embebido solo como texto dentro del mensaje) — el mensaje se preserva íntegro, y el consumidor de `FINANCIAL_CALCULATION_REJECTED` puede leer el texto si necesita el detalle, pero LP-EMIT-001 no fabrica una tabla paralela de códigos "equivalentes" a los del motor.
- **No** se crea una tabla paralela/duplicada de códigos de error del engine dentro de este contrato — la fuente de códigos de error financieros sigue siendo exclusivamente `pricingEngine.js`/`quote-core` (`ADAPTER_ERROR_CODES`, `TARGET_PROFIT_BASIS_ERRORS`, `NUMERIC_ERRORS`, y los `Error` planos del motor), nunca una reescritura en este documento.

### 9.3 Shape conceptual del resultado exitoso

```jsonc
{
  "quote_id": "<uuid>",
  "quote_version_id": "<uuid>",
  "version_number": <int>,
  "status": "ISSUED",
  "issued_at": "<timestamptz>",
  "engine": {
    "engine_commit_sha": "0421b8f28d075089320387d526c97d1f27adf764",
    "engine_contract_version": "LP-ENG-002T",
    "calculation_schema_version": "v1"
  }
}
```

Sin PDF, sin URL de descarga, sin ningún campo de las tablas fuera de alcance (§11) — este es el resultado mínimo de la operación de emisión en sí misma.

---

## 10. Security boundary

Reafirmación vinculante (LP-SCHEMA-001 §4.14/§4.15, sin cambio de fondo):

- `quote_version` = **comercial**. Puede exponerse a un cliente final/usuario con permiso comercial.
- `quote_version_calculation` = **interno/restringido**. Contiene costo, utilidad, markup, margen, `engine_input`/`engine_output` completos e `internal_calculation_snapshot`.

**Nunca expuesto por defecto** desde ningún resultado de esta operación ni desde ninguna lectura posterior construida sobre `quote_version` sin acceso explícito a `quote_version_calculation`:
- `costoNet`/`costoGross` (de cualquier grupo, principal o supplemental).
- `utilidad`/`markupSobreCosto`/`margenSobreVenta`.
- `engine_input`/`engine_output` (principal o de `internal_calculation_snapshot`).
- `internal_calculation_snapshot` completo.

Este contrato **no diseña RLS definitivo** (fuera de alcance, igual que en LP-SCHEMA-001 §13) — pero documenta la frontera que cualquier política de acceso futura debe respetar: un rol con acceso de lectura a `quote_version` no implica, por defecto, acceso de lectura a `quote_version_calculation`; deben ser permisos separables.

---

## 11. Non-scope (explícitamente fuera de esta misión)

Generación de PDF; envío de email; firma electrónica; sincronización/enlace con Drive; flujo de licitación (tender workflow); `PurchaseOrder`; `Receipt`; `Invoice`; `Collection`; `Payment`; `WorkItem`; `Project`; UI; endpoint HTTP/API; ejecución real de cualquier SQL contra Supabase o cualquier base real (el SQL de LP-SCHEMA-002 sigue OFFLINE); RLS definitivo (§10 solo documenta la frontera).

### 11.1 Boundary de implementación (LP-EMIT-001R, corrección 11 — vinculante, nota agregada)

La implementación futura de esta operación debe conservar **una misma sesión/transacción de PostgreSQL** durante la totalidad de: adquisición del row lock (§7 paso 1); lectura coherente del agregado (paso 2); `validate_quote_for_emission` (paso 3); construcción del envelope y del mapping (pasos 4, 6); el cálculo en JavaScript (`calculateQuoteDraft`, paso 5) — entendiendo que el resultado de esa llamada debe reincorporarse a la misma transacción de base de datos que la originó, no a una nueva; la selección de supplemental (paso 7); la construcción de snapshots (paso 8); `version_number` (paso 9); los dos `INSERT` (pasos 10-11); el `supersede` (paso 12); el cambio de `quote.status` (paso 13); y el `COMMIT` (paso 14). **No es válido** implementar esta secuencia como llamadas independientes que abran transacciones distintas entre sí (por ejemplo, una transacción para leer el agregado, cerrarla, calcular en JS, y abrir una segunda transacción nueva para persistir) — eso rompería tanto la coherencia de snapshot (§2.2) como el mutex de emisión (que debe sostenerse desde el paso 1 hasta el paso 14 sin interrupción). Esta nota **no elige** todavía la librería cliente de PostgreSQL, el pooler de conexiones, ni ninguna infraestructura concreta — eso sigue siendo una decisión de la migración de implementación.

---

## 12. `DECISION_REQUIRED` — puntos abiertos

**Ninguno.** LP-EMIT-001R cerró las dos áreas que la versión anterior de este contrato había dejado formuladas como "diferidas a la migración de implementación" pero que, en realidad, ya estaban resueltas en el canon existente:

- **Mecanismo de concurrencia:** ya NO se presenta como "row lock vs. token optimista" — LP-SCHEMA-002 ya eligió row lock de `quote` como mecanismo v1 (documentado en el comentario de `fn_supersede_previous_quote_versions`); este contrato lo adopta explícitamente (§2.2) y no reabre la elección.
- **Finitud numérica:** ya NO se presenta como "CHECK exacto diferido" — `sql/LP-SCHEMA-002_STANDALONE_QUOTE_V1.sql` ya **define/cierra** `is_finite_numeric(...)` y los `CHECK` correspondientes sobre las columnas financieras relevantes en el DDL canónico; este contrato adopta esa decisión y no la reabre (§1, §2.3). Esto es distinto de afirmar que el CHECK ya está **aplicado a una base real**: LP-SCHEMA-002T está PUBLISHED en Git, pero el SQL sigue **OFFLINE** — no aplicado a Supabase ni a ninguna base real — hasta que una misión de implementación lo despliegue.

No se identificó ninguna ambigüedad genuina nueva en el canon existente (LP-SCHEMA-001 v1.3, LP-SCHEMA-002T, LP-ORCH-001, `pricingEngine.js` LP-ENG-002T) que este contrato no pudiera resolver. `DECISION_REQUIRED: 0`.

---

**LP-EMIT-001 v1 (LP-EMIT-001R / LP-EMIT-001S aplicados) — fin de entrega.** Solo diseño. Sin SQL nuevo, sin modificación de SQL existente, sin Supabase, sin migraciones, sin UI, sin API, sin staging, sin commit, sin push, sin PR, sin merge, sin deploy.
