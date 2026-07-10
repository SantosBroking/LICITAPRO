# MIGRACIÓN LICITAPRO → ERP MULTIEMPRESA "GRUPO SANTIAGO"

**Este archivo es la fuente de verdad, dentro del propio repositorio, del estado de la migración de seguridad y multiempresa.** Existe para que cualquier persona (o cualquier sesión futura de asistente de IA) que retome este proyecto entienda en qué punto va, sin depender de una conversación de chat externa.

---

## Estado actual

- **Fase en curso:** 0E (IA vía endpoint serverless) — **completa en preview, pendiente de autorización de merge a `main`**
- **Rama de trabajo:** `fase0-seguridad`
- **`main` no ha sido tocado.** Todo el trabajo de Fase 0 se construye en esta rama hasta que esté probado y aprobado explícitamente para merge.
- **Diseño completo de la migración:** documentado fuera del repo (tres documentos técnicos: Master Blueprint de auditoría, Plan de Migración Fase 0+1 v1 y v2, Preparación Fase 0A, Guía de Backup Manual). Este archivo resume el estado operativo; el diseño detallado vive en esos documentos.

---

## Reglas de esta migración (no negociables)

- Ningún archivo se toca sin que Santiago autorice explícitamente la fase/paso correspondiente.
- Ninguna contraseña, API key o secreto se escribe jamás en el código. Todo secreto vive en variables de entorno de Vercel o en el gestor de Supabase.
- Cada fase se prueba en un preview/rama antes de tocar producción (`main`).
- `src/lib/calc.js` (motor financiero) no se toca en Fase 0 ni Fase 1.

---

## Checklist de fases

### ✅ Fase 0A — Backup, rama y variables
- [x] Backup manual de la base de datos (verificado por Santiago)
- [x] Email Auth confirmado activo en Supabase
- [x] Registro libre desactivado en Supabase
- [x] `service_role` key localizada (nunca compartida)
- [x] `SUPABASE_SERVICE_ROLE_KEY` guardada en Vercel (Production + Preview, marcada Sensitive)
- [x] Nueva `ANTHROPIC_API_KEY` guardada en Vercel (Production + Preview, marcada Sensitive, distinta de la que estaba expuesta en el frontend)
- [x] Contraseña de base de datos que se expuso accidentalmente, reseteada
- [x] Rama `fase0-seguridad` creada
- [x] Este archivo (`MIGRACION.md`) creado

### ✅ Fase 0B — Supabase Auth real
- [x] Crear tabla `user_profiles` (vía SQL Editor de Supabase, ejecutado por Santiago con guía exacta)
- [x] Endpoint `api/invite-user.js` — **pospuesto a propósito**, no construido en 0B. Altas iniciales (Santiago, Eduardo) hechas manualmente por Dashboard
- [x] Reescribir `src/lib/supabase.js`: quitar `USERS[]` hardcodeado, `signIn`/`signUp` falsos; usar `sb.auth.signInWithPassword()` real + `buildAppUser()` (nuevo) que carga `role`/`active` desde `user_profiles`
- [x] Reescribir `src/views/Auth.js`: quitar modo "registro" por completo; solo login (recuperación de contraseña pospuesta, requiere configurar Redirect URLs/plantilla)
- [x] Migrar cuentas reales: Santiago (`admin`) y **Eduardo** (`empleado`) — Mauricio no se usó como empleado inicial, decisión de Santiago
- [x] Probar login/logout en preview — **login Santiago OK, login Eduardo OK, logout OK, refresh mantiene sesión OK**

#### Hallazgo durante las pruebas de 0B: fotos del catálogo no cargaban en preview

Al probar el preview con login real, las fotos personalizadas del catálogo (subidas a Storage, prefijo `catalog/` del bucket `licitapro`) no aparecían, aunque sí se veían en producción (`main`).

**Diagnóstico:** el bucket `licitapro` es privado. Antes de Fase 0B, la app **nunca** usaba una sesión real de Supabase Auth (el login era falso, vivía en `localStorage`) — así que **todas** las peticiones a Supabase, incluidas las de Storage, viajaban siempre como rol `anon`. Solo existía una política de Storage para `anon` (`public_access`). Al activar Auth real en 0B, el cliente `sb` pasó a adjuntar el JWT real del usuario autenticado en cada petición — cambiando el rol efectivo de `anon` a `authenticated`. Como no había ninguna política de Storage para `authenticated`, las peticiones para generar la URL firmada de cada foto del catálogo fallaban con "Object not found" (comportamiento de Supabase Storage cuando la política no matchea, no un 403 explícito).

**Corrección aplicada — manual, en Supabase, no en código:**
```
Política: authenticated_read_catalog_images
Tabla: storage.objects
Roles: authenticated
Comando: SELECT
USING: bucket_id = 'licitapro' and name like 'catalog/%'
```
Es una política de **solo lectura** — no otorga INSERT, UPDATE ni DELETE. Permite exclusivamente que un usuario autenticado *lea* imágenes bajo el prefijo `catalog/`.

**Resultado:** tras agregar la política, las fotos del catálogo cargan correctamente en el preview. Confirmado por Santiago.

**Pendiente para Fase 0D (storage privado):** la política antigua `public_access` (para `anon`) **sigue existiendo** en el bucket y debe revisarse/limpiarse quirúrgicamente en 0D — es probable que ya no se necesite una vez que todo el tráfico real pase autenticado, pero eliminarla es una decisión de esa fase, no de esta, para no mezclar alcance.

**Checklist completo de pruebas 0B — resultado final:**
- [x] Login Santiago (admin) OK
- [x] Login Eduardo (empleado) OK
- [x] Logout OK
- [x] Refresh mantiene sesión OK
- [x] Dashboard OK
- [x] Proyectos existentes visibles OK
- [x] Cotizador OK
- [x] PDF/exportación OK
- [x] Fotos del catálogo OK (tras la política de Storage arriba)
- [x] Sin usuarios hardcodeados ni contraseñas en texto plano (verificado por grep)
- [x] Sin opción de "Crear cuenta" en el frontend (verificado)

**Estado: Fase 0B completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

### ✅ Fase 0C — RLS completo y permisos mínimos

#### Hallazgo del Preflight (antes de aplicar nada)

RLS ya aparecía como `true` en las 5 tablas (`projects`, `vehicles`, `companies`, `config`, `audit_log`), pero las políticas existentes eran `anon_X` (comando `ALL`, rol `anon`) y `own X` (comando `ALL`, rol `public` = cualquiera) — es decir, RLS estaba activado pero era decorativo: cualquiera con la `anon` key podía leer/escribir/borrar sin haber iniciado sesión. Confirmado con Preflight de solo lectura antes de tocar nada (columnas, conteos de filas, `user_id` único por tabla = `31daca2f-17ff-4ce1-83ca-99e2b31094b7`, y `projects.id` coincide 20/20 con `data->>'id'`).

#### SQL aplicado (ejecutado manualmente por Santiago en el SQL Editor, en un solo bloque transaccional)

1. **Funciones auxiliares** `public.is_admin()` y `public.is_active_user()` — `SECURITY DEFINER` con `SET search_path = public, pg_catalog` fijo (evita que alguien manipule el `search_path` de su sesión para suplantar `user_profiles`), `EXECUTE` revocado de `PUBLIC` y otorgado solo a `authenticated`.
2. **Políticas viejas eliminadas explícitamente** en las 5 tablas: `anon_projects`, `own projects`, `anon_vehicles`, `own vehicles`, `anon_companies`, `own companies`, `anon_config`, `own config`, `anon_audit`, `own audit`.
3. **Políticas nuevas creadas** (todas `to authenticated`, cada una con su `drop policy if exists` previo para idempotencia):

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `projects` | activos del workspace | activos del workspace | activos del workspace | **admin** + workspace |
| `vehicles` | activos del workspace | activos del workspace | activos del workspace | **admin** + workspace |
| `companies` | activos del workspace | activos del workspace | activos del workspace | *(sin política — no existe función de borrado en el código hoy)* |
| `config` | activos del workspace | **admin** + workspace | **admin** + workspace | **admin** + workspace |
| `audit_log` | activos del workspace | activos del workspace | *(sin política — ni admin)* | *(sin política — ni admin, bitácora inmutable a propósito)* |

4. **Tabla nueva `project_financials`** (`project_id text primary key references projects(id) on delete cascade`, `data jsonb`, `updated_at`) — RLS exclusivo de `is_admin()` para SELECT/INSERT/UPDATE, sin política de DELETE (se borra solo en cascada si se borra el proyecto).

**Verificado por Santiago tras aplicar:** políticas viejas ya no aparecen en `pg_policies`; RLS activo en las 7 tablas; producción siguió cargando con normalidad inmediatamente después de correr el SQL.

#### Código (rama `fase0c-rls`, en preview, pendiente de merge)

- **`src/views/Projects.js`:** la pestaña **Cotización** (costos, márgenes, utilidad, retornos) queda oculta para quien no sea admin — se filtra de la lista de tabs y además hay un guardián en el render de contenido, por si el estado interno llegara a apuntar ahí por otra vía. El botón **"Eliminar" de proyecto** también queda oculto para empleados (además del bloqueo real por RLS en la base).
- **`src/App.js` + `src/lib/supabase.js`:** `project_financials` se llena de forma incremental (**Opción B**, decidida explícitamente sobre la alternativa de un script de un solo uso) — cada vez que un **admin** guarda un proyecto con cotización capturada, se calcula el resultado con `calcCotizacion()` (ya existente, sin modificar `calc.js`) y se persiste en la tabla nueva. Si falla, no rompe el guardado normal del proyecto. **No se tocó `Cotizacion.js`.**
- **Riesgo residual documentado, aceptado a propósito:** los costos por línea (`costoMSMS`, `costoConIVA` de cada partida/equipo) siguen dentro de `projects.data.cotizacion` — la pestaña oculta evita que un empleado los vea en la interfaz, pero no están separados a nivel de base de datos como sí lo está el resultado calculado (utilidad/margen/retornos, en `project_financials`). Cerrar esto del todo requiere rediseñar `Cotizacion.js` — pospuesto a **Fase 2** a propósito, según lo acordado.
- **No se centralizó `esAdmin()`** en este commit — hubiera requerido tocar `Admin.js` y `Firmas.js`, fuera del alcance autorizado de este turno. Queda pendiente para una autorización aparte.

#### Pruebas confirmadas por Santiago en preview

- [x] Login Santiago (admin) OK — Dashboard, Proyectos, Catálogo/fotos, Cotización visible y editable, guardar cotización OK, `project_financials` se creó/actualizó correctamente, PDF/exportación OK.
- [x] Login Eduardo (empleado) OK — Proyectos visibles, Cotización oculta, botón Eliminar oculto.
- [x] Sin errores críticos en consola.

**Estado: Fase 0C completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

**Pendiente para fases posteriores (no en 0C):** tablas `authorizations` y `ai_logs` (documentadas en el plan original de Fase 0, no requeridas para cerrar el alcance mínimo de 0C); centralizar `esAdmin()`.

### ✅ Fase 0D — Storage privado

#### Hallazgo del Preflight (antes de aplicar nada)

El bucket `licitapro` **ya era privado** (`public: false`) — no fue necesario ningún cambio de Dashboard para eso. Pero las políticas de `storage.objects` seguían siendo `public_access` (rol `anon`, comando `ALL`) y `authenticated_read_catalog_images` (de 0B, solo lectura del prefijo `catalog/`) — es decir, **`public_access` era hoy la única vía real de acceso** para 4 de los 5 prefijos que usa la app (`vehiculos/`, `empresas/`, `firmas/`, `proyectos/`; solo `catalog/` tenía además la política de 0B). El Preflight también confirmó: `file_size_limit`/`allowed_mime_types` en `null` a nivel bucket, y los tipos MIME reales en uso (`application/pdf`: 56, `text/xml`: 44, `image/jpeg`: 14) — lo que llevó a agregar `text/xml`/`application/xml` a la lista blanca, que no estaban contemplados en el diseño inicial.

#### SQL aplicado (ejecutado manualmente por Santiago en el SQL Editor, en un solo bloque transaccional)

1. `alter table storage.objects enable row level security;` (idempotente — ya estaba activo, se reafirma para que el script sea autosuficiente).
2. **Políticas viejas eliminadas:** `public_access`, `authenticated_read_catalog_images`.
3. **Políticas nuevas creadas** (todas `to authenticated`, con `drop policy if exists` previo):

| Comando | Regla |
|---------|-------|
| SELECT | `activos leen storage` — `bucket_id = 'licitapro' and is_active_user()` |
| INSERT | `activos suben storage` — `bucket_id = 'licitapro' and is_active_user()` |
| UPDATE | `solo admin actualiza storage` — `bucket_id = 'licitapro' and is_admin()` |
| DELETE | `solo admin borra storage` — `bucket_id = 'licitapro' and is_admin()` |

4. **`file_size_limit` del bucket fijado en 52428800 (50 MB)** — actúa como techo de infraestructura; el código sigue aplicando 25 MB para el caso general y 50 MB solo para documentos de empresa. `allowed_mime_types` del bucket se dejó en `null` a propósito (la validación de tipo vive en código, no duplicada a nivel bucket).

**Verificado por Santiago tras aplicar:** políticas viejas ya no aparecen; RLS activo; bucket privado confirmado; `file_size_limit = 52428800`; ninguna política con rol `anon`; producción siguió cargando archivos/fotos con normalidad inmediatamente después del SQL.

#### Código (rama `fase0d-storage`, en preview, pendiente de merge)

- **`src/lib/supabase.js`:** `uploadToStorage` ya no pide `getPublicUrl` — regresa `data.path` (ruta relativa); `upsert:true` → `upsert:false` (con rutas ya únicas, una colisión real ahora falla con error visible en vez de sobrescribir en silencio). `uploadFileToStorage` valida tipo MIME (lista blanca, incluye `text/xml`/`application/xml`) y tamaño (`maxSizeMB`, default 25, con excepción de 50 para documentos de empresa) — **corrección propia detectada antes del commit:** la primera versión de la validación dejaba pasar sin filtro cualquier tipo "desconocido"; se corrigió para rechazar por default. `signedUrl()` regresa `null` explícito si no pudo firmar (antes regresaba el valor original en silencio).
- **`src/ui/primitives.js` (`StorageImg`):** trata `null` de `signedUrl()` como error real (muestra `fallback`), no como "cargando" indefinido.
- **`src/views/Vehicles.js`:** guardia en el botón de descarga de factura XML (avisa si `signedUrl()` no pudo generar el enlace); rutas únicas con timestamp en acta de entrega firmada, factura de agencia y factura por tipo.
- **`src/views/Admin.js`:** rutas únicas con timestamp en las 3 subidas de fotos de catálogo — el archivo anterior no se borra, solo deja de estar referenciado (historial conservado).
- **`src/views/Companies.js`:** ruta única con timestamp en documentos de empresa; se quitó el chequeo manual duplicado de 50MB (ahora centralizado en `uploadFileToStorage` vía parámetro); si la subida falla (tipo o tamaño), se avisa claro y no se guarda el documento a medias.
- **No se tocó `pdf_export.js`** — confirmado innecesario: sus 2 usos de `signedUrl()` (`imgABase64`, `preloadImg`) ya estaban envueltos en `try/catch` que regresan `''`/cadena vacía ante cualquier falla, compatibles de forma nativa con el nuevo contrato de `signedUrl()` regresando `null`. Tampoco se tocó `calc.js` ni `Cotizacion.js`.

#### Pruebas confirmadas por Santiago

- [x] Preview validado en todos los flujos de subida/lectura de archivos.
- [x] Producción sigue abriendo correctamente tras limpiar caché/sesión del navegador (relevante por el cambio de contrato de `signedUrl()`/`uploadToStorage`).

**Estado: Fase 0D completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

**Riesgos/pendientes que quedan documentados, no resueltos aún:**
- `allowed_mime_types` a nivel bucket se dejó sin fijar (opción de defensa adicional, discutida y pospuesta a propósito — no es indispensable dado el control ya existente en código).
- La lista blanca de tipos MIME en código se basa en lo que existe hoy (Preflight) más los tipos de Office/imagen/comprimidos previstos — si en el futuro se necesita subir un tipo de archivo nuevo no contemplado, la subida se rechazará hasta que se agregue explícitamente a `TIPOS_PERMITIDOS`.
- No se migró ni re-subió ningún archivo existente — solo cambió el mecanismo de acceso; las rutas/URLs guardadas antes de 0D se siguen resolviendo por compatibilidad hacia atrás en `rutaDeStorage()`.

### ✅ Fase 0E — IA vía endpoint serverless

#### 1-2. Endpoint nuevo y validación de sesión

`api/ai-proxy.js` (nuevo, mismo patrón que `api/send-email.js`). Antes de llamar a Anthropic, valida en dos pasos:
1. **Sesión real:** el cliente manda `Authorization: Bearer <token de sesión de Supabase>`; el proxy verifica ese token contra `GET /auth/v1/user` (usando la `anon` key, ya pública).
2. **Perfil activo:** consulta `GET /rest/v1/user_profiles?id=eq.<id>` con el mismo token del usuario — la política de 0B ("usuario lee su propio perfil") ya permite esta lectura sin necesitar privilegios elevados. Si no hay perfil o `active=false`, responde `403` antes de tocar Anthropic.

Validaciones adicionales del cuerpo: `messages` debe ser arreglo no vacío (máx. 20 elementos); tamaño serializado de `messages`+`system` limitado a 4 MB (ver riesgos); `tipo` con allowlist (`bases`, `factura`, `constancia`, `empresa`, `redaccion`, `chat`, `desconocido`); modelo con allowlist estricta (rechaza si no coincide, no sustituye en silencio); `maxTokens` con mínimo/máximo (no numérico, negativo o cero → 1500; > 4000 → capeado a 4000).

#### 3-4. Keys — solo en servidor

- `ANTHROPIC_API_KEY` — usada únicamente dentro de `api/ai-proxy.js`, leída de `process.env`. Nunca en el cliente, nunca se regresa en ninguna respuesta.
- `SUPABASE_SERVICE_ROLE_KEY` — usada únicamente dentro de `api/ai-proxy.js`, exclusivamente para escribir en `ai_logs` (ver punto 5). Nunca se usa para nada más (la verificación de sesión/perfil usa la `anon` key + el token del propio usuario, no `service_role` — principio de mínimo privilegio).

**Verificado explícitamente:** `api.anthropic.com`, `x-api-key`, `ANTHROPIC_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY` no aparecen en ningún archivo de `src/` — solo en `api/ai-proxy.js`.

#### 5. `ai_logs` — registro obligatorio, no opcional

Corrección importante hecha durante el desarrollo (no en el diseño original): el log se crea con `status:'started'` **antes** de llamar a Anthropic. Si ese insert falla, el proxy responde `500` y **no llama a Anthropic** — el uso de IA sin registro queda estructuralmente imposible, no solo "mejor esfuerzo". Después de la llamada, se actualiza (`PATCH`) el mismo registro a `success`/`error` (esta segunda actualización sí es de mejor esfuerzo — si falla, no bloquea la respuesta ya completada al usuario).

`ai_logs` tiene RLS activo, `SELECT` admin-only, **sin política de `INSERT` ni `UPDATE` para `authenticated`** — el `service_role` escribe porque ese rol bypassa RLS por diseño de Postgres, no porque exista una política a su favor. `status` restringido por `CHECK (status in ('started','success','error'))`. No se guardan prompts, documentos, respuestas ni datos financieros — solo metadatos (`actor_email`, `actor_role`, `tipo`, `model`, `status`, `error` corto).

#### 6. Modelo unificado

Todo el sistema usa `claude-sonnet-4-6`. Se corrigió una inconsistencia encontrada en el chat de `Cotizacion.js`, que usaba `claude-sonnet-4-20250514` (un modelo distinto al resto) — confirmado con `git diff` que el texto del `system` prompt quedó **idéntico byte a byte** al original, y que `PROMPTS` en `ai_analyzer.js` tampoco cambió.

#### 7. Retiro de keys del cliente

Se eliminaron las 8 lecturas de `config.ia.openaiKey`/`config.anthropicApiKey` (`Companies.js`, `Vehicles.js` ×3, `AIAnalyzerButton.js`, `Projects.js` ×2). El campo "Anthropic API Key" en Configuración se reemplazó por un texto informativo ("IA configurada en servidor mediante variable de entorno") — ya no existe forma de guardar una key nueva desde la UI.

#### 8. Archivos modificados (rama `fase0e-ia-serverless`)

`api/ai-proxy.js` (nuevo), `src/lib/ai_analyzer.js`, `src/ui/AIAnalyzerButton.js`, `src/views/Admin.js`, `src/views/Companies.js`, `src/views/Cotizacion.js`, `src/views/Projects.js`, `src/views/Vehicles.js`.

#### 9. Riesgos/pendientes documentados

- **Límite de payload de Vercel:** las funciones serverless Node.js de Vercel limitan el cuerpo de la petición a ~4.5 MB por defecto (`vercel.json` no lo redefine). El proxy fija su propio límite en 4 MB (por debajo de ese techo) para dar un mensaje claro en vez de un error genérico de la plataforma. **Esto es una restricción nueva que no existía** cuando la IA se llamaba directo desde el navegador — un documento muy grande que hoy funciona podría empezar a fallar por este motivo. Validado en pruebas con documentos reales sin encontrar el problema, pero queda documentado como límite estructural a tener presente.
- La limpieza de `config` (retirar `ia.openaiKey`/`anthropicApiKey` de los datos ya guardados) **sigue pendiente, a propósito** — se ejecuta después de confirmar el proxy en producción.
- La key vieja de Anthropic (la que estuvo expuesta en el frontend) **sigue sin revocar, a propósito** — se revoca después del merge a producción.

#### 10. Confirmado: `calc.js` y `pdf_export.js` sin tocar

Verificado con `git diff --stat` contra `main` — ningún cambio en ninguno de los dos archivos.

#### 11. Nota operativa importante para el futuro

Durante las pruebas de esta fase, el primer intento de análisis en preview falló con *"No se puede registrar el uso de IA"* — la causa fue que `SUPABASE_SERVICE_ROLE_KEY` no estaba marcada para el entorno **Preview** en Vercel (solo Production). Se agregó explícitamente con ese nombre exacto para Preview, y fue necesario un **redeploy** (se usó un commit vacío, `git commit --allow-empty`, ya que Vercel no relee variables de entorno de un deployment ya construido sin reconstruirlo). **Para fases futuras:** cualquier variable de entorno nueva debe marcarse para **todos** los entornos donde vaya a probarse (Preview y Production), y recordar que agregar/editar una variable requiere redeploy para que tome efecto.

#### 12. Validación final confirmada por Santiago

- [x] Análisis de factura: `ai_logs` muestra `status=success`, `error=null`, `model=claude-sonnet-4-6`.
- [x] Análisis de constancia (CSF): `ai_logs` muestra `status=success`, `error=null`, `model=claude-sonnet-4-6`.
- [x] Se investigó un reporte de posible regresión en extracción de factura — diagnóstico exhaustivo por `git diff` no encontró ninguna diferencia de código en prompt/`contentBlock`/`messages`/modelo/parsing; confirmado además que el manejo de XML (parseo local, sin IA) nunca cambió. El propio Santiago confirmó después que la extracción ya funcionaba correctamente — se trató como falsa alarma, no como regresión real.

**Estado: Fase 0E completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

**Pendiente tras el merge (no antes):** limpieza de `config` (retirar `ia.openaiKey`/`anthropicApiKey` de los datos ya guardados) y revocación de la key vieja de Anthropic en console.anthropic.com.

### ⬜ Fase 0F — Pruebas
- [ ] Checklist completa de seguridad corrida en preview (login, registro cerrado, RLS de financieros, storage privado, IA sin key expuesta en Network tab)
- [ ] Merge a `main` solo si todo pasa

### Fase 1 — Multiempresa y nuevo proyecto (después de Fase 0 completa)
- Organización única: **Grupo Santiago**
- Empresas operadoras: Broking, SATHRI/Satri (datos fiscales pendientes de confirmar), tercera empresa
- Extender tabla `companies` existente (no crear una nueva) + `organization_id`
- Nuevo flujo de creación de proyecto: empresa → tipo de operación → tipo de venta → responsable → folio automático
- Folios: `{EMPRESA}-{AÑO}-{TIPO}-{CONSECUTIVO}` (proyecto) y `{FOLIO_PROYECTO}-COT-{CONSECUTIVO}` (cotización)
- Próxima acción obligatoria: texto + fecha compromiso + responsable
- Pestaña de Cotización (costos/márgenes/utilidad/retornos): **solo admin** hasta que exista vista reducida para empleados (Fase 2)
- Reporte de simulación de backfill de proyectos existentes, revisado por Santiago **antes** de aplicar cualquier cambio a datos reales

---

## Decisiones de diseño ya tomadas (para no repreguntar)

- Una sola organización, sin multi-tenant complejo.
- Empleados ven y operan proyectos de **todas** las empresas (no se restringe por empresa en Fase 1).
- Empleado vs. responsable de proyecto: mismos permisos; la diferencia es operativa (recordatorios, dueño del seguimiento).
- La contradicción "empleados crean cotizaciones" vs. "solo Santiago ve costos" se resuelve temporalmente restringiendo la pestaña completa de Cotización a admin (Opción A), con la vista reducida para empleados como prioridad de Fase 2 (Opción B).

---

*Última actualización: 8 de julio de 2026 — Fase 0A.*
