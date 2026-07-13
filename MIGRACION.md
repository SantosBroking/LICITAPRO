# MIGRACIÓN LICITAPRO → ERP MULTIEMPRESA "GRUPO SANTIAGO"

**Este archivo es la fuente de verdad, dentro del propio repositorio, del estado de la migración de seguridad y multiempresa.** Existe para que cualquier persona (o cualquier sesión futura de asistente de IA) que retome este proyecto entienda en qué punto va, sin depender de una conversación de chat externa.

---

## Estado actual

- **Fase en curso:** ninguna — última entrega cerrada: Corrida Financiera Interna v3 — por partida, **completa en producción**; siguiente paso sugerido: probar visualmente el nuevo PDF con proyectos reales y ajustar layout si hace falta, o continuar con otro incremento pendiente (agregar equipo desde catálogo en Cotización Operativa, quitar partida/equipo, Fase 2E), según decisión
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

### ✅ Fase 0F — Cierre de seguridad y limpieza final

Auditoría de cierre tras Fase 0E, en 4 partes: secretos en el repo, variables de Vercel, políticas de Supabase, y frontend.

#### Auditoría de secretos (repo) — sin hallazgos de seguridad

Confirmado con `grep` real (no supuesto): `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `api.anthropic.com` existen **únicamente** en `api/ai-proxy.js`. Cero ocurrencias de `openai`, `dangerous-direct-browser-access` en todo el repo. La única otra mención de "apiKey" en `api/` corresponde a `RESEND_API_KEY` (servicio distinto, sin relación).

#### Auditoría de Supabase — confirmada por Santiago, sin hallazgos críticos

- `config` limpio (sin `ia.openaiKey` ni `anthropicApiKey` residuales).
- `ai_logs`: RLS activo, solo política `SELECT` admin-only, sin `INSERT`/`UPDATE`/`DELETE` para `authenticated`. Cero logs `started` sin cerrar (`started_antiguos=0`).
- `user_profiles`: solo política `SELECT`, sin `INSERT`/`UPDATE`/`DELETE`.
- `storage.objects`: exactamente 4 políticas, todas `authenticated`, ninguna `anon`. Bucket `licitapro` confirmado `public=false`, `file_size_limit=52428800` (50MB).
- Tablas principales (`projects`, `vehicles`, `companies`, `config`, `audit_log`): sin políticas `anon` residuales.

#### Auditoría de frontend — 1 hallazgo real, corregido

Los 3 controles de rol de Fase 0C (pestaña Cotización oculta para empleados, su guardián de contenido, botón "Eliminar" proyecto oculto) — confirmados intactos, sin cambios desde 0C.

**Hallazgo:** el reemplazo del campo de API Key hecho en Fase 0E (línea única, quirúrgico) dejó **dos líneas de texto huérfano** sin actualizar en `src/views/Admin.js` — una descripción que seguía diciendo "Obtén tu key en console.anthropic.com", y una nota al pie mal ubicada (aparecía debajo de la sección de Notificaciones/Resend) que decía "Tu API key se guarda en tu cuenta. Obtén créditos en console.anthropic.com/settings/billing". No era un riesgo de seguridad — el campo funcional ya no existía — pero sí copy engañoso.

**Corrección aplicada (rama `fase0f-cierre-seguridad`):**
- Línea de descripción actualizada: *"Análisis automático de bases de licitación y documentos con Claude (Anthropic). La conexión con la IA está configurada del lado del servidor."*
- Línea huérfana del pie de página eliminada por completo.
- **Cambio puramente de texto — cero cambios de lógica, estado, props o `onClick`.** Confirmado con `git diff`: una línea de string cambiada, una línea eliminada.

**Archivo modificado:** `src/views/Admin.js` (único archivo de código).

**Riesgos que quedan documentados, no resueltos en esta fase (por diseño, no por omisión):**
- Keys viejas de Anthropic sin revocar — decisión consciente de Santiago, por posible uso en otros proyectos.
- Límite de payload de Vercel (~4.5MB, límite propio en 4MB) — sigue como restricción de plataforma no probada a fondo con un documento al límite del tamaño.
- Permisos finos de empleados por empresa — pendiente para Fase 1, frontera ya acordada desde el plan original, no un olvido de Fase 0.

**Estado: Fase 0F completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

Con este cierre, **Fase 0 completa (0A–0F) queda lista para producción** en cuanto se apruebe este último merge — quedando como trabajo consciente y documentado para el futuro: revocación de keys viejas, y todo el alcance de Fase 1 (multiempresa) descrito abajo.

### ✅ Fase 1 (1A-1C) — Usuarios, permisos y operación multiusuario

**Nota de alcance:** esta "Fase 1" es distinta de la sección de "multiempresa" escrita más abajo en este documento hace tiempo (antes de que Santiago redefiniera qué seguía después de Fase 0). Ese contenido de multiempresa **sigue pendiente**, sin fase asignada todavía — se re-etiquetó para no confundirse con lo que sí se ejecutó aquí.

#### Hallazgos del Preflight 1A (antes de tocar nada)

- **Dos listas de "empleados" desincronizadas:** `user_profiles` (la real, controla login desde 0B) y `config.equipo[]` (JSON suelto dentro de `config`, remanente del sistema de auth falso previo a 0B) — y `config.equipo` era, hasta este cambio, la única fuente del selector "Responsable" en el formulario de proyecto.
- **El RLS de `user_profiles` (desde 0B) solo permitía que cada quien leyera su propia fila** — ni siquiera un admin podía listar a los demás usuarios desde el cliente.
- **`'jefe'` era un valor muerto** en 6 puntos del código (`App.js`, `Admin.js`, `Firmas.js`, `Projects.js` ×4) — el `CHECK` de `user_profiles` desde 0B solo permite `'admin'`/`'empleado'`, así que esa mitad de cada condición nunca podía ser verdadera.
- **Datos reales desordenados:** el campo `responsable` de los proyectos tenía 6 variantes de texto distintas para solo 3 personas (mayúsculas, acentos, segundo nombre de más). Se decidió **no normalizar automáticamente** (sin fuzzy matching) — cada variante se conserva tal cual como valor legado.
- **Normalización manual de datos (hecha por Santiago, fuera de este código):** Mauricio fue dado de alta en Supabase Auth + `user_profiles`; el nombre de Eduardo en `user_profiles` se actualizó a su nombre completo ("Luis Eduardo Contreras Baez") para coincidir con la mayoría de sus proyectos.

#### SQL aplicado en 1B (único cambio funcional de base de datos de esta fase)

```sql
create policy "activos ven directorio de activos"
  on public.user_profiles for select
  to authenticated
  using (active = true and public.is_active_user());
```
Una sola política nueva, de solo `SELECT`. **Sin política de `UPDATE`** (decisión explícita — las escrituras van por el endpoint serverless con `service_role`, no por RLS directo). **Sin ampliar el `CHECK` de roles** (se mantiene únicamente `admin`/`empleado`). Verificado por Santiago: RLS activo, 2 políticas totales en `user_profiles` (la de 0B + esta), sin `INSERT`/`UPDATE`/`DELETE`.

#### Código de 1C (rama `fase1c-usuarios-permisos`, en preview, pendiente de merge)

1. **`src/lib/permissions.js` (nuevo):** `getPermissions(user)` centraliza los permisos por rol — diseñada para aceptar roles futuros (`ventas`, `operaciones`, `finanzas`, `solo_lectura`) editando solo esta función, sin volver a tocar 6 archivos.
2. **Eliminación de `role==='jefe'`:** las 6 repeticiones (`App.js:52`, `Admin.js`, `Firmas.js:17`, `Projects.js` ×4) reemplazadas por `getPermissions(user).isAdmin`.
3. **`api/admin-users.js` (nuevo):** endpoint serverless — lista usuarios (incluidos inactivos) y permite activar/desactivar/cambiar rol. Verifica sesión real de Supabase + perfil activo + `role==='admin'` antes de cualquier acción. Usa `SUPABASE_SERVICE_ROLE_KEY` exclusivamente del lado servidor (nunca expuesta, nunca regresada, nunca logueada). Valida `r.ok` antes de `r.json()` en los 4 puntos de red (listar, buscar `targetId`, contar admins activos, `PATCH`) — ante cualquier fallo de Supabase, regresa un mensaje genérico, nunca el detalle interno. `active` debe ser booleano; `role` solo `admin`/`empleado`; `targetId` debe existir (`404` si no); rechaza actualizaciones vacías; **nunca deja el sistema sin al menos un admin activo** (bloqueo absoluto); la auto-modificación de un admin sobre su propia cuenta requiere `confirmSelfAction` explícito. Acciones limitadas a `list`/`update` — cualquier otra, rechazada.
4. **Panel "Usuarios" real (`Admin.js`):** reemplaza al panel "Equipo" viejo (que leía/escribía `config.equipo`, desconectado del auth real desde antes de 0B). El nuevo panel lee/escribe `user_profiles` de verdad, vía `api/admin-users.js`. Admin-only (`getPermissions(user).isAdmin`).
5. **Selector "Responsable" migrado (`Projects.js`, 3 puntos: `ProjectForm` ×2, `ProjectDetail` ×1):** ya no lee `config.equipo` — ahora consulta el directorio de usuarios activos (`user_profiles`, permitido por la política de 1B) directamente con `sb.from('user_profiles').select('name,email').eq('active', true)`.
6. **Fallback de responsable legado:** si el valor guardado en un proyecto (`project.responsable`) no coincide exactamente con ningún nombre activo, se agrega como opción adicional en el selector, tal cual, sin normalizar mayúsculas/acentos/variantes y sin intentar adivinar coincidencias ("fuzzy matching"). Los proyectos con las 3 variantes de nombre de Eduardo, las 2 de Mauricio, y el de Thiago (sin cuenta) siguen abriendo y mostrando su responsable histórico sin romperse.
7. **`config.equipo` — confirmado que NO se borró:** solo dejó de leerse desde el código. Los datos siguen existiendo en `config.data.equipo`, disponibles por si algún día hace falta consultarlos históricamente (ej. para confirmar el correo de alguien antes de darlo de alta).

#### Archivos modificados

`src/lib/permissions.js` (nuevo), `api/admin-users.js` (nuevo), `src/App.js`, `src/views/Admin.js`, `src/views/Firmas.js`, `src/views/Projects.js`.

**No se tocó:** `calc.js`, `pdf_export.js`, `Cotizacion.js`, `api/ai-proxy.js`, Supabase (fuera del SQL de 1B), Vercel, variables de entorno. No se construyó `api/invite-user.js` (alta de usuarios sigue siendo manual, decisión explícita).

#### Pruebas confirmadas por Santiago en preview

- [x] Santiago (admin) ve el panel Usuarios con los 3 usuarios reales (Santiago, Eduardo, Mauricio).
- [x] Panel Usuarios permite activar/desactivar y restaurar correctamente.
- [x] Eduardo/Mauricio (empleados) no ven Configuración ni el panel Usuarios.
- [x] Eduardo/Mauricio no ven la pestaña Cotización (confirma que 1C no afectó el control de 0C).
- [x] El selector de Responsable muestra a los usuarios activos.
- [x] Proyectos con responsables legados (variantes de nombre, o sin cuenta como Thiago) abren bien y conservan el nombre histórico.
- [x] Sin errores críticos en consola.

**Estado: Fase 1 (1A-1C) completa en preview. Pendiente de autorización explícita de Santiago para merge a `main`.**

#### Riesgos/pendientes documentados, no resueltos en esta fase

- **`api/invite-user.js` sigue sin construirse** — alta de usuarios nuevos sigue siendo manual en el Supabase Dashboard + `insert` en `user_profiles`. Se pospone hasta que el ritmo de contrataciones lo justifique.
- **Roles futuros (`ventas`, `operaciones`, `finanzas`, `solo_lectura`)** — `getPermissions()` está diseñada para aceptarlos, pero el `CHECK` de `user_profiles` **no se amplió** (decisión explícita de Santiago). Si se necesitan en el futuro, requiere un `ALTER TABLE` + ampliar `ROLES_PERMITIDOS` en `api/admin-users.js`.
- **Variantes de responsable legado no se limpiaron** — siguen existiendo como texto suelto en los proyectos viejos (por diseño, para no arriesgar mezclar personas distintas con normalización automática). Si en algún momento se quiere limpiar manualmente, es una tarea de datos separada, no de código.
- **Cotización sigue admin-only** — la vista reducida para empleados (Opción B) sigue siendo prioridad de Fase 2, sin tocar en esta fase.
- **Multiempresa** — sigue completamente pendiente, ver la sección re-etiquetada más abajo.

### ✅ Fix — Persistencia + Seguridad de Navegación

**Problema original:** al cambiar de ventana/pestaña del navegador y volver, o al refrescar la página, LicitaPro regresaba al dashboard (o a la pestaña principal de un módulo) en vez de conservar dónde estaba el usuario — perdiendo el proyecto abierto, la pestaña interna, y las sub-pestañas de Cotización (Equipo, Retornos y condiciones, Corrida financiera, Unitario, Agente Claude).

**Solución implementada:**
- Persistencia segura de navegación en `localStorage`, con llave por usuario (`licitapro_nav_<id>`).
- Se guarda únicamente `view`, `projId`, `projTab`, `subTabs` y `ts` — nunca nada más.
- Guard de pre-render (`sanitizeNavigation()`): la navegación se sanea de forma síncrona, en el mismo render, antes de decidir qué construir — nunca existe un frame donde se renderice una vista prohibida.
- Protección por permisos en 3 niveles: vistas principales (`canView`), pestañas de proyecto (`canProjectTab`), y sub-pestañas internas (`canSubTab`) — los 3 con fuente única en `src/lib/permissions.js`.
- Persistencia jerárquica para sub-pestañas (hoy, las de Cotización) — se levantó el estado que antes vivía local y desconectado dentro de `ProjectDetail` hacia `App.js`, mismo patrón ya usado para `projTab`.
- Corrección de una condición de carrera real: `loading===false` no garantizaba que `projects` ya estuviera poblado en el mismo render — se resolvió con `projectsReady` (state, no ref) para una señal confiable.
- Filtro real del menú (sidebar, menú móvil, barra inferior) — ya no solo se ocultan botones, hay una guardia continua que corrige cualquier vista no permitida sin importar el origen (clic, URL, `localStorage`).

**Seguridad:**
- No se guardan proyectos completos, cotizaciones, costos, márgenes, facturas, documentos, PDFs, XML, prompts ni respuestas de IA — solo nombres/IDs de pantalla y pestaña.
- Empleados no pueden restaurar vistas ni pestañas sensibles (Configuración, Reportes, Bitácora, Cotización, Facturación, Flujo, ni las sub-pestañas de Cotización) por ningún medio — ni clic, ni URL, ni `localStorage` forzado.
- Cambio de usuario en la misma pestaña del navegador (sin recargar) no hereda la navegación del usuario anterior.

**Archivos modificados:** `src/App.js`, `src/lib/permissions.js`, `src/views/Projects.js`. No se tocó `calc.js`, `pdf_export.js`, `Cotizacion.js`, `api/ai-proxy.js`, `api/admin-users.js`, Supabase, Vercel, ni variables de entorno.

**Commit final:** `621c04d6fca9be45d3fd102ac9767a0a231a45ef`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

### ✅ Fase 2A0 — Contención visible inmediata (parte de Fase 2)

**Contexto:** primer paso de Fase 2 (Cotización reducida para empleados). Antes de abrir cualquier vista nueva a empleados, se hizo un diagnóstico exhaustivo (2 rondas de revisión) que encontró que ocultar la pestaña de Cotización no bastaba — había fugas reales de datos financieros en otros puntos ya accesibles para empleado, sin relación directa con Cotización en sí.

**Objetivo:** cerrar esas fugas visibles/exportables de inmediato. **Cotización reducida NO se abre en esta sub-fase** — sigue admin-only, sin cambios.

#### Cambios realizados

1. **PDF cliente (`printCotizacionCliente`) ya no incluye utilidad, margen ni costos internos.** Antes exponía "Costo total c/IVA/s/IVA" y una sección completa de "Utilidad y margen" (utilidad bruta/neta, margen bruto/neto) — datos internos de MSMS/Surman/Broking en un documento pensado para el cliente externo (gobierno). Se conserva venta total, unidades, partidas y datos del proyecto.
2. **Vehículos oculta precios y facturas para empleado** en los 3 puntos donde antes se exponían: la columna PRECIO/FACTURAS de la tabla general, el Metric "Precio total" y el tab interno "Facturación" del detalle de vehículo, y la tarjeta completa "Datos económicos" del formulario de alta/edición.
3. **Excel exportado por empleado es una versión operativa sanitizada**, no el botón oculto — sigue pudiendo exportar VIN, marca, modelo, estatus, ubicación, equipamiento, etc., pero sin ninguna columna de precio o factura. El CSV se construye desde columnas explícitas por rol, nunca serializando el objeto completo.
4. **`DocsTab` ya no genera ni siquiera la referencia de los documentos de factura para empleado** — las 4 categorías (compra, reventa, equipo, cliente) no se construyen en absoluto si el usuario no tiene el permiso, no solo se ocultan del listado.
5. **Admin conserva exactamente lo mismo que tenía antes** — cero cambios en su experiencia.

#### Archivos modificados

`src/lib/pdf_export.js`, `src/lib/permissions.js`, `src/views/Vehicles.js`. No se tocó `Cotizacion.js`, `Projects.js`, `calc.js`, `api/ai-proxy.js`, `api/admin-users.js`, `project_financials`, Supabase, RLS, SQL, ni Vercel/variables de entorno.

#### Commits

`26a2f69` (contención visible inmediata) y `8e5aeec6641b5e0df65c943584a23840eea58c50` (ajuste: `generarPDFCliente` habilitado para ambos roles, ya que el PDF quedó corregido en el mismo commit — sin efecto observable todavía, porque el botón sigue detrás del gate admin-only del tab Cotización).

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Límites pendientes, documentados a propósito (no resueltos en esta sub-fase)

- **Network/DevTools crudo** — la respuesta de red de `projects`/`vehicles` sigue trayendo todos los campos financieros para cualquier usuario activo; RLS no distingue rol. Requiere Fase 2E.
- **RLS `UPDATE` amplio** — cualquier usuario activo del workspace puede escribir en `projects`/`vehicles`, sin distinguir rol; confirmado que esta misma vía es la que usan acciones legítimas cotidianas (ej. cambiar estatus de vehículo), lo que hace que cerrarlo de verdad sea del tamaño de Fase 2E, no una sub-fase corta.
- **Sanitización React profunda** de `project`/`vehicles` antes de pasarlos como props a componentes de empleado — diseñada (`sanitizeProjectForRole`, `sanitizeVehicleForRole`, etc.) pero no implementada — es Fase 2A2.
- **Cotización operativa para empleado** — sigue sin existir; Cotización completa sigue admin-only — es Fase 2A4.

### ✅ Fase 2A1 + 2A2 — Permisos granulares + Sanitización React profunda (parte de Fase 2)

**Contexto:** Fase 2A0 cerró las fugas visibles/exportables (UI, Excel, descargas). Esta ronda ataca el nivel de props/estado React: aunque el dato financiero completo sigue llegando por Network/Supabase (eso queda para una fase posterior), deja de llegar a los *componentes* que un empleado usa.

**Objetivo:** permisos granulares en `getPermissions`, sanitización React profunda para que empleados no reciban datos financieros en props/estado React de ningún componente accesible, y protección de los guardados normales desde la app con allowlist explícita (no denylist).

#### Cambios realizados

1. **Nuevos permisos granulares en `permissions.js`** (13 nuevos + 3 alias) — sin cambiar roles en base de datos ni el `CHECK` existente. Cubren Cotización (`verCotizacionOperativa`, `verCostosInternos`, `verMargenUtilidad`, `verRetornosEstrategicos`, `verCorridaFinanciera`, `verUnitarioFinanciero`, `guardarFinancieros`, etc.), IA (`usarIAOperativa`/`usarIAFinanciera`) y Vehículos (`editarVehiculosFinancieros`, `descargarFacturasVehiculo`). Los permisos que preparan Cotización Operativa (`verCotizacionOperativa`, `editarCotizacionOperativa`, `usarIAOperativa`) ya son `true` para ambos roles, pero **sin ningún efecto todavía** — Cotización sigue admin-only por el gate de tab ya existente, no tocado en esta ronda.

2. **Archivo nuevo `src/lib/data_sanitize.js`** — funciones puras de sanitización:
   - **Lectura:** `sanitizeProjectForRole`, `sanitizeCotizacionForRole`, `sanitizeVehicleForRole`, `sanitizeDocsForRole`, más `removeSensitiveKeysDeep` como segunda capa de defensa contra campos financieros futuros no contemplados explícitamente.
   - **Escritura:** `sanitizeProjectUpdateForRole`, `sanitizeVehicleUpdateForRole`, `sanitizeDocsUpdateForRole`, `sanitizeFirmasUpdateForRole` — todas por **allowlist explícita**, nunca copiando el objeto completo que manda un empleado. Un campo financiero inventado (`cotizacion.calc`, `partida.margen`, `equipo.precioTotal`, etc.) nunca se copia, porque no está en ninguna lista permitida.
   - Se incluyó también el caso de `project.docs` (categorías "Facturas", "Propuesta económica", "Garantías", "Fianzas" se preservan del original si el empleado no las veía) y de `project.firmas` (empleado solo puede actualizar `estatus`/`archivoFirmado`/`comentarioRechazo`/`historial` de un documento existente; nunca puede crear uno nuevo ni modificar a quién se le asigna).

3. **`App.js`** ahora calcula `visibleProjects`/`visibleVehicles`/`visibleCurrentProject` junto al resto de la navegación efectiva. **Dashboard, ProjectsList, ProjectDetail, VehiclesTab (vía ProjectDetail) y FirmasView** reciben la versión sanitizada cuando el usuario es empleado — admin sigue recibiendo los datos completos sin cambios, en los 5 puntos. El guardado normal (`handleSaveProject`, `upProject`, `handleSaveVehicle`) aplica el merge seguro contra el objeto original **antes** de `saveProject`/`saveVehicle` — así, aunque un empleado edite un campo operativo, los campos financieros existentes nunca se pierden ni se pueden inyectar desde la app normal.

4. **`maybeSaveFinancials` sigue admin-only, sin ningún cambio de código.**

5. **Cotización operativa NO se abrió** — sigue siendo exactamente la misma vista admin-only de siempre.

#### Archivos modificados

`src/App.js`, `src/lib/data_sanitize.js` (nuevo), `src/lib/permissions.js`. No se tocó `Cotizacion.js`, `Vehicles.js`, `Projects.js`, `Firmas.js`, `pdf_export.js`, `calc.js`, `api/ai-proxy.js`, `api/admin-users.js`, `project_financials`, Supabase, RLS, SQL, ni Vercel/variables de entorno.

#### Commit

`3047808ded0c934e0fe2c80d0c72e33251ce244d`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Límites pendientes, documentados a propósito (no resueltos en esta ronda)

- **Network/DevTools crudo** — la respuesta de red de `projects`/`vehicles` sigue trayendo todos los campos financieros; RLS no distingue rol. Requiere una fase de separación real a nivel de Supabase/RLS.
- **RLS `UPDATE` amplio** — cualquier usuario activo del workspace puede escribir en `projects`/`vehicles` vía API directa, sin distinguir rol. Confirmado que cerrarlo de verdad (sin romper acciones operativas legítimas de empleado) requiere un rediseño de mayor alcance, no una sub-fase corta.
- **Cotización operativa para empleado** — sigue sin existir; Cotización completa sigue admin-only.
- **Vector de correo de Orden de Compra con costos** — si un empleado es designado firmante de una OC, recibe por correo el PDF con `costoMSMS` cuando admin aprueba. Es una decisión de proceso de negocio pendiente, fuera del alcance de sanitización React.

### ✅ Mini-fase Firmas/OC (seguridad) + Limpieza de texto visible "MSMS"

**Contexto:** al revisar el vector de correo detectado durante el diseño de Cotización Operativa, se confirmó un riesgo real, distinto de props/React: admin podía crear y aprobar una Orden de Compra que genera un PDF con costos internos, y el responsable/firmante de esa OC podía ser **cualquier usuario activo, incluido un empleado** — al aprobar, el PDF con costos se enviaba por correo a ese responsable. En paralelo, se decidió una regla de marca: "MSMS" no debe aparecer como texto visible en ningún lugar del sistema (UI, PDFs, correos, labels, etc.) — solo se conserva `costoMSMS` como campo técnico interno heredado, ya que renombrarlo implicaría migración y riesgo estructural, fuera del alcance de esta mini-fase.

#### A. Seguridad Firmas/OC

- **`Projects.js`**: la consulta de usuarios activos ahora incluye `role`. Al enviar una OC a aprobación, los firmantes posibles se filtran a solo admins con `getPermissions({ role: u.role }).verCostosInternos` — ya no existe captura manual libre de nombre/correo para esta acción. Si no hay ningún admin activo disponible, el flujo se bloquea con una alerta clara en vez de caer a captura libre.
- **`Firmas.js`**: carga el conjunto de correos de admins activos (`adminEmails`); el botón "Aprobar" se deshabilita mientras esa lista carga (evita bloquear una aprobación legítima solo por timing). Antes de generar el PDF y antes de llamar a la función de aviso por correo, valida que el responsable del documento sea admin — si no lo es, no genera el PDF, no envía el correo, no cambia el estatus del documento, y muestra un mensaje claro pidiendo reasignar a un admin. Esto cubre tanto el flujo normal como documentos ya existentes (o manipulados) con un responsable empleado.
- **Resultado:** una OC con responsable empleado queda bloqueada antes de generar PDF o enviar correo; una OC con responsable admin funciona exactamente igual que antes.

#### B. Limpieza de texto visible "MSMS"

Búsqueda global en `src/` y `api/`, en 3 rondas sucesivas. Se eliminó "MSMS" de: login, sidebar, catálogo, tab y label de Cotización, chat de IA (título y `system` prompt), PDFs (cliente, interno, Orden de Compra, y sus fallbacks de nombre de empresa), correos (encabezado, cuerpo, pie y remitente, tanto de Firmas como de recordatorios mensuales), mensaje de ayuda en Flujo, y comentarios de código (incluidos varios que el propio proceso de esta fase había introducido). Los folios nuevos de cotización ahora usan el prefijo `COT-` en vez de `MSMS-` — **los folios ya existentes no se migran**.

**Grep final:** `grep -rniE "msms|m\.s\.m\.s\.|Costo MSMS|costo msms" src/ api/` → **17 líneas**, las 17 confirmadas como usos técnicos de `costoMSMS` (propiedad de código) — cero texto visible, cero comentarios, cero strings de UI/PDF/correo/remitente/fallback.

#### Archivos modificados, por commit

- **Commit 1** (`4a905b2b2a7e3e675d417bbf29b2adeb8f71e26a`) — Seguridad Firmas/OC: `src/views/Firmas.js`, `src/views/Projects.js`.
- **Commit 2** (`967112a9518d2681387280e50c30f97b8b8cbc46`) — Limpieza de texto visible MSMS: `api/send-email.js`, `src/App.js`, `src/lib/calc.js`, `src/lib/constants.js`, `src/lib/email_reminders.js`, `src/lib/firmas.js`, `src/lib/pdf_export.js`, `src/views/Auth.js`, `src/views/Catalog.js`, `src/views/Cotizacion.js`, `src/views/Flujo.js`, `src/views/Projects.js`.
- **Commit 3** (`916473243ba9b15459854745d02f330c5d7a934d`) — Limpieza de MSMS en comentarios/textos no visibles: `src/lib/calc.js`, `src/lib/catalog.js`, `src/lib/catalog_images.js`, `src/lib/pdf_export.js`, `src/lib/permissions.js`, `src/views/Catalog.js`, `src/views/Cotizacion.js`, `src/views/Projects.js`.

**Commit final en `main`:** `916473243ba9b15459854745d02f330c5d7a934d`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Límites pendientes, documentados a propósito (no resueltos en esta mini-fase)

- Network/DevTools crudo — sigue pendiente (Fase 2E).
- RLS `UPDATE` amplio — sigue pendiente.
- Cotización Operativa — sigue sin abrirse.
- Correos ya enviados **antes** de este cambio a un responsable empleado — no se revocan retroactivamente.
- El campo técnico `costoMSMS` se conserva tal cual, como campo heredado — no debe renderizarse ni mostrarse como label en ningún punto nuevo del código. Si algún día se decide renombrarlo, debe ser una fase separada con su propio control de migración de datos — no se tocó ni se migró nada aquí.
- Folios de cotización creados **antes** de este cambio conservan su prefijo original — no se migran.

### ✅ Fase 2A4 — Cotización Operativa para empleados

**Contexto:** antes de esta fase, el tab Cotización estaba completamente cerrado para empleados — admin usaba `Cotizacion.js` completo, sin ninguna alternativa. El diagnóstico de esta fase confirmó, con código real, que `Cotizacion.js` **no podía reutilizarse** para empleados: mezcla campos operativos y financieros en el mismo bloque de render, y recalcula con el motor de cálculo de cotización en cada edición — si se le diera una cotización sin datos financieros, el cálculo produciría valores incorrectos, no solo un riesgo de confidencialidad. También se detectó, durante el diagnóstico, que **Catálogo exponía el precio de cada producto a empleados** — y ese precio se usa literalmente como costo interno de equipo al agregarse a una cotización. Abrir Cotización Operativa sin cerrar antes esa fuga habría dejado un camino indirecto hacia el mismo dato que se buscaba proteger.

**Decisión de arquitectura:** mantener `Cotizacion.js` admin-only e intacto; construir una vista nueva, `CotizacionOperativa.js`, desde cero, sin ningún dato ni cálculo financiero en su alcance. PDF cliente, IA operativa y Orden de Compra para empleado quedan fuera de esta fase — no se abrieron.

#### A. Cierre de fuga en Catálogo

Catálogo ya no muestra el precio a empleados — ni en tarjetas, ni en labels, ni en placeholders del formulario. Empleado no puede crear productos nuevos ni duplicar productos existentes (ambas acciones habrían requerido capturar o heredar un costo interno sin poder verlo) — se bloquean con un mensaje claro, tanto en la UI como en el guardado, incluso si se intenta por payload directo. Si empleado edita un producto ya existente, el precio original se preserva exacto, nunca se acepta lo que traiga el formulario. Admin conserva el comportamiento completo: ve, edita, crea y duplica productos con normalidad, incluida la herencia correcta de precio al duplicar.

#### B. Gate de Cotización por rol

Admin sigue montando `Cotizacion.js`, sin ningún cambio en ese archivo. Empleado monta `CotizacionOperativa.js`. El ajuste de permisos permite el tab `cotizacion` a empleados **solo por esta ruta operativa** — `facturacion` y `flujo` siguen bloqueados, y las sub-pestañas financieras de Cotización (retornos y condiciones, corrida financiera, unitario, agente) siguen completamente fuera del alcance de empleado.

#### C. Vista nueva `CotizacionOperativa.js`

Empleado ve únicamente: Resumen, Partidas, Equipo. No ve PDF, IA, Orden de Compra, corrida financiera, unitario financiero, retornos, fianzas, facturación, flujo, costos, precios internos, márgenes, utilidad, ni ningún campo financiero. El archivo no importa el motor de cálculo de cotización, ni la generación de PDF, ni funciones de Firmas/OC, ni el analizador de IA — no contiene ningún string sensible, ni "MSMS", en ningún punto, incluidos los comentarios. No guarda directo a Supabase — usa el flujo normal de guardado del proyecto, ya protegido.

#### D. Guardado y monto estimado

`CotizacionOperativa.js` nunca calcula el monto estimado del proyecto. El guardado de empleado pasa por el mismo flujo ya protegido desde Fase 2A2 (`sanitizeProjectUpdateForRole`) — el payload se fusiona contra el original antes de guardar, preservando siempre los datos financieros existentes; un empleado no puede inyectar ni borrar ningún campo financiero, y el monto estimado nunca se corrompe ni se recalcula con datos incompletos. El ajuste correspondiente en `App.js` fue principalmente de verificación y documentación de un comportamiento que ya funcionaba correctamente, no una reescritura de lógica.

#### Commits

| # | Commit | Contenido | Archivos |
|---|---|---|---|
| 1 | `4da4e08d46348aad7b9449afaff36fa4d9d2de99` | Cerrar fuga de costo interno en Catálogo | `src/views/Catalog.js`, `src/App.js` |
| 2 | `373095d467ceeb4f32753655b6e8c2ff42fd5a82` | Permisos/gate + esqueleto de Cotización Operativa | `src/lib/permissions.js`, `src/views/Projects.js`, `src/views/CotizacionOperativa.js` |
| 3 | `bae636febc42aa19b37ce4372d3fb8d92ffeafeb` | Partidas y Equipo operativos completos | `src/views/CotizacionOperativa.js` |
| 4 | `8151cf7fcbde940dcdb44479f68ec2679eaea02c` | Verificación/documentación de guardado y monto estimado | `src/App.js` |
| 5 | `9ec3bbec1f3c2b2366dc3bdf3911c631ea406ec9` | Limpieza de comentarios sensibles | `src/views/CotizacionOperativa.js` |
| 6 | `ff7cbc7806e2d3bb38e346feacfb9d59dd36c959` | Evitar que empleados creen/dupliquen productos sin costo interno | `src/views/Catalog.js` |

**Archivos modificados en toda la fase (5, únicamente):** `src/App.js`, `src/lib/permissions.js`, `src/views/Catalog.js`, `src/views/CotizacionOperativa.js`, `src/views/Projects.js`. No se tocó Supabase, RLS, SQL, variables, `api/`, `data_sanitize.js`, `Cotizacion.js`, `calc.js`, `pdf_export.js`, ni `firmas.js`.

**Commit final en `main`:** `ff7cbc7806e2d3bb38e346feacfb9d59dd36c959`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Validaciones finales

Exactamente 6 commits, sin ninguno extra. Exactamente 5 archivos modificados. Grep de "MSMS" en `src/`/`api/`: 17 líneas, todas el campo técnico `costoMSMS`, cero texto visible, cero comentarios, `CotizacionOperativa.js` confirmado sin aparecer. Búsqueda de strings financieros y de funciones prohibidas (PDF, IA, OC) dentro de `CotizacionOperativa.js`: 0 líneas en ambas. Catálogo y Cotización revalidados para ambos roles antes del merge. Deploy de producción confirmado exitoso.

#### Límites pendientes, documentados a propósito (no resueltos en esta fase)

- Quitar partida/equipo dentro de Cotización Operativa.
- Agregar equipo nuevo desde catálogo dentro de Cotización Operativa.
- PDF cliente para empleado.
- IA operativa para empleado.
- Network/DevTools crudo — sigue pendiente.
- RLS `UPDATE` amplio — sigue pendiente.
- Seguridad real a nivel de base de datos, incluida RLS por rol en `projects` — no se resuelve en esta fase, que es de UI/props/write-guard, no un sustituto de la Fase 2E.
- Renombrar el campo técnico `costoMSMS` — sigue como campo heredado, sin cambios.
- Migración de datos — no se hizo ninguna.

### ✅ Fase 2A5 — Resumen Interno v2 / Corrida Financiera Desglosada

**Contexto:** el "Resumen interno" anterior era poco útil como herramienta de decisión — mostraba algunos datos, pero no respondía con claridad cuánto se vende, cuánto cuesta, cuánto deja, cuál es el margen, qué partida está en riesgo, qué costos faltan, ni qué decisión conviene tomar. La utilidad total y el margen agregado ya existían en `calcCotizacion`, pero no estaban presentados en el PDF interno. Además, la tabla por partida reimplementaba cálculos de forma independiente dentro de `pdf_export.js`, con riesgo real de desalineación frente a `calcCotizacion`.

**Decisión de negocio:** convertir el resumen interno en una **Corrida financiera interna** para admin — la venta nunca se mezcla como costo, se muestra aparte; todos los costos se suman para llegar a un costo unitario total; venta unitaria menos costo unitario total da la utilidad unitaria; utilidad unitaria por unidades da la utilidad total. El reporte debe servir para decidir rápido si una operación conviene. No es para cliente ni para empleados.

#### A. Helper nuevo de datos internos

`src/lib/resumen_interno.js` (nuevo) — `buildResumenInternoData(project, cot, calc, companyObj, options)` centraliza las métricas internas, reutilizando `calcCotizacion`/`calc` como fuente de verdad para los totales agregados (nunca los recalcula ni los duplica), y expone datos base del proyecto, KPIs agregados, la corrida financiera unitaria con sus conceptos de costo, detalle por partida, detalle de equipo/extras, riesgos y pendientes, semáforo general y decisión sugerida. No modifica `calc.js`, no renombra `costoMSMS`, no toca base de datos, no se expone a empleados, y no reintroduce texto visible "MSMS" — `costoMSMS` se conserva únicamente como campo técnico interno.

#### B. Corrida financiera unitaria

Reglas: la venta nunca se suma dentro de los conceptos de costo, se muestra aparte; el costo unitario total es la suma de los conceptos de costo; utilidad unitaria = venta unitaria − costo unitario total; utilidad total = utilidad unitaria × unidades (salvo redondeo); un costo que viene por unidad se usa tal cual, uno que viene total se prorratea; sin unidades activas se evita cualquier división peligrosa; un costo faltante, una partida sin costo o un equipo sin costo fuerzan alerta roja automática, igual que una utilidad negativa.

**Bug real encontrado y corregido durante el desarrollo:** `cnts[pi]` representa la cantidad de un equipo *por vehículo* dentro de la partida, no un total absoluto — para obtener la cantidad total real hay que multiplicarlo por la cantidad de esa partida. La primera versión del helper no hacía esta multiplicación, y el costo total de equipo no coincidía con `calcCotizacion`; se corrigió y se verificó con pruebas numéricas exactas (3 × 10 = 30, confirmado) antes de continuar.

#### C. Semáforos y decisión sugerida

Umbrales iniciales, editables, no definitivos: margen ≥ 25% verde, entre 10% y 25% amarillo, < 10% rojo; utilidad negativa, costo faltante y equipo sin costo fuerzan rojo automático; fecha de costo con más de 30 días, amarillo; retornos/fianzas por encima de 10% de la venta, amarillo; por encima de 20%, rojo. Decisión sugerida: verde → "Aprobar / operación sana"; amarillo → "Revisar antes de avanzar"; rojo → "No avanzar sin ajuste/autorización" — es una recomendación interna para admin, nunca una decisión automática definitiva.

#### D. PDF interno rediseñado

`src/lib/pdf_export.js` — `printResumenInterno` ahora consume `buildResumenInternoData` en vez de recalcular por su cuenta. Seis secciones lógicas: **1** Resumen ejecutivo (identificación, semáforo, decisión sugerida, KPIs de venta/costo/utilidad/margen/unidades/utilidad por unidad); **2** Corrida financiera unitaria (tabla de conceptos con unitario/total/notas, y los totales de cierre, con la venta siempre separada visualmente de los costos); **3** Partidas (venta/costo/utilidad unitaria y total, margen, semáforo, alertas — ordenadas por riesgo/impacto); **4** Equipo/extras (categoría, cantidad, costo unitario/total, fecha de costo, notas, alertas); **5** Riesgos y pendientes (costos faltantes, equipo sin costo, márgenes bajos, utilidad negativa, fechas de costo vencidas, documentos/firmas pendientes, conceptos no disponibles); **6** Anexo técnico interno (IVA, retornos, fianzas, condiciones comerciales).

#### E. Botón admin

`src/views/Projects.js` — el botón cambió a "🔒 Corrida financiera interna", sin ningún cambio de lógica ni de permisos: sigue exactamente dentro de `tab==='cotizacion' && isAdmin`, empleado no lo ve, no se abrió nada nuevo.

#### Commits

| # | Commit | Contenido | Archivo |
|---|---|---|---|
| 1 | `f35035ea859f3f9cbd8bd61fcfefbbab7efbf1a7` | Helper de datos internos | `src/lib/resumen_interno.js` |
| 2 | `6e69396e851cb73dd0c608add42a1ca11a71d1ca` | Rediseño PDF, secciones 1-3 | `src/lib/pdf_export.js` |
| 3 | `a05750c85d41a743d4801385af68f9d37b963f42` | Rediseño PDF, secciones 4-6 | `src/lib/pdf_export.js` |
| 4 | `e49ed67750c129a6d681e13b97df510a55f1bf44` | Cambio de texto del botón | `src/views/Projects.js` |
| 5 | `80dd6c0fa0c8e7792fbe78c24a2f372d10001ebe` | Limpieza de strings técnicos sensibles en el helper | `src/lib/resumen_interno.js` |

**Archivos modificados en toda la fase (3, únicamente):** `src/lib/resumen_interno.js`, `src/lib/pdf_export.js`, `src/views/Projects.js`. No se tocó Supabase, RLS, SQL, variables, `api/`, `data_sanitize.js`, `calc.js`, `Cotizacion.js`, `CotizacionOperativa.js`, `Catalog.js`, `Firmas.js`, `firmas.js`, ni `package.json`.

**Commit final en `main`:** `80dd6c0fa0c8e7792fbe78c24a2f372d10001ebe`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Validaciones finales

Exactamente 5 commits, sin ninguno extra. Exactamente 3 archivos modificados. Grep de "MSMS" en `src/`/`api/`: 18 líneas — correcto, ya que el helper agrega 2 accesos técnicos reales a `p.costoMSMS`; cero texto visible, cero comentarios, cero strings descriptivos, cero fuentes tipo `'partidas[].costoMSMS'`. Búsqueda específica de strings sensibles en el helper: 0 líneas. El campo `fuente` interno del helper nunca se imprime en el PDF. Seis escenarios de prueba del helper (cotización simple, con retornos/fianzas, equipo sin costo, sin unidades activas, partida sin costo de vehículo, equipo con `cnts[pi]` y cantidad de partida mayor a 1) — todos verificados: sin `undefined`/`NaN`/`Infinity`, totales coincidentes con `calc`, igualdad `ventaUnitaria - costoUnitarioTotal = utilidadUnitaria` y `utilidadUnitaria × unidades = utilidadTotal`, equipo multiplicado correctamente, costo faltante y utilidad negativa forzando rojo, DPP nunca inventado, "ISR" apareciendo solo cuando existe como concepto real capturado en fianzas. PDF cliente, Orden de Compra, Cotización Operativa, Catálogo y Firmas/OC confirmados intactos. Deploy de producción confirmado exitoso.

#### Límites pendientes, documentados a propósito (no resueltos en esta fase)

- RLS/Network crudo — sigue pendiente (Fase 2E).
- PDF cliente para empleado — sigue diferido.
- IA operativa — sigue diferida.
- Agregar/quitar equipo operativo dentro de Cotización Operativa — pendiente, fuera de esta fase.
- DPP como campo real — **no existe** en el código actual; no se inventó ningún campo. Si algún día se desea capturarlo, requiere su propia fase con su propio diseño de dato.
- Campos nuevos de proveedor de equipo, moneda, responsable de costo, o un campo explícito de riesgo capturado por el usuario — todos documentados como ausentes, ninguno se programó.
- Cambios de base de datos — ninguno; toda esta fase es cálculo y presentación sobre datos ya existentes.
- Renombrar el campo técnico `costoMSMS` — sigue como campo heredado, sin cambios.

### ✅ Corrida Financiera Interna v3 — por partida

**Contexto:** tras probar la Corrida Financiera Interna v2 (Fase 2A5), se detectó que el reporte seguía sin cumplir la lógica operativa esperada. La v2 construía una corrida unitaria consolidada/promedio, mezclando vehículos y equipos distintos en una sola cifra — con un caso real de Ford Explorer (10 unidades) y Toyota Hilux (30 unidades), una corrida promedio mezclada no representa correctamente ni a la Explorer ni a la Hilux.

**Decisión:** la corrida financiera debe hacerse por partida. Cada partida activa tiene su propia corrida completa; el consolidado general del proyecto pasa a ser solo un resumen, nunca el centro del reporte.

#### A. Corrida por partida

Cada partida activa genera su propia corrida independiente: vehículo/producto propio, cantidad, venta unitaria, costo unitario, utilidad unitaria, utilidad total, margen, sus propios conceptos de costo, y su propio equipo — sin mezclarse con ninguna otra partida. Confirmado con el ejemplo real (Ford Explorer 10u + Toyota Hilux 30u): cada una con su vehículo base, su equipo y sus retornos/fianzas propios.

#### B. Equipo por partida

El equipo ya no se presenta como tabla global mezclada — se muestra dentro de cada partida. `cnts[pi]` se interpreta como cantidad por unidad; la cantidad total de equipo es `cnts[pi] × cantidad de la partida`. Si un equipo aplica a dos partidas, aparece en ambas con sus cantidades respectivas; si aplica solo a una, aparece solo ahí.

#### C. Retornos y fianzas por partida

Tres reglas de asignación, según cómo esté capturado el retorno/fianza:
1. **Monto fijo por unidad** → unitario × cantidad de esa partida.
2. **Porcentaje sobre venta** → porcentaje aplicado sobre la venta de esa partida específica, no la venta global.
3. **Monto total del proyecto** → prorrateado por participación de venta (venta de la partida / venta total del proyecto).

Esta lógica replica la convención ya existente en el panel admin de Cotización (`costoTratoPart` en `Cotizacion.js`) — no se inventó una regla paralela. Verificado: la suma por partida coincide exacto con `calc.totalRetornos`/`calc.totalFianzas` como fuente objetiva, no solo aproximado.

#### D. IVA a utilidad

Condicionado al interruptor real `cot.ivaSelectivo`, no al valor resultante. Si está encendido, se muestra la fila "IVA a utilidad"; si está apagado, la fila desaparece por completo — no se muestra en $0, no aparece ninguna nota relacionada, visualmente no existe.

#### E. Secciones eliminadas

Se eliminó por completo: la corrida promedio consolidada como centro del reporte, la página de riesgos, advertencias, alertas, pendientes, semáforos, decisión sugerida, la nota de "DPP no disponible", el texto "costo capturado hace X días", y cualquier otro texto interpretativo. Objetivo: un reporte que muestre números claros por partida, sin que el reporte "opine" o califique la operación.

#### F. Nueva estructura del PDF

Página/sección 1: resumen general del proyecto (identificación, KPIs consolidados, tabla resumen por partida). Secciones siguientes: una corrida completa por cada partida activa, con su equipo propio justo debajo. Anexo final: IVA, condiciones comerciales — retornos y fianzas ya no se repiten ahí, porque ya están desglosados por item real dentro de la corrida de cada partida.

#### Commits

| # | Commit | Contenido | Archivo |
|---|---|---|---|
| 1 | `8ed48ae9a592006a1dba4285f7e75b8892901505` | Helper reestructurado — corrida por partida | `src/lib/resumen_interno.js` |
| 2 | `da90ea689633e28707fe042fcee81e77ed7d2c18` | PDF completo v3 por partida | `src/lib/pdf_export.js` |
| 3 | `04d88096ae0e4c2c994dee76e198ab8c2752ecf3` | Limpieza de comentarios obsoletos | `src/lib/resumen_interno.js` |

**Archivos modificados (2, únicamente):** `src/lib/resumen_interno.js`, `src/lib/pdf_export.js`. No se tocó Supabase, RLS, SQL, variables, `api/`, `data_sanitize.js`, `calc.js`, `Cotizacion.js`, `CotizacionOperativa.js`, `Catalog.js`, `Firmas.js`, `Projects.js`, ni `package.json`.

**Commit final en `main`:** `04d88096ae0e4c2c994dee76e198ab8c2752ecf3`

**Estado: cerrado en producción.** URL: `https://licitapro-beta.vercel.app`

#### Validaciones finales

Exactamente 3 commits, sin ninguno extra. Exactamente 2 archivos modificados. Búsqueda de secciones eliminadas: 0 líneas. Búsqueda de corrida promedio: 0 líneas. Grep de "MSMS" en `src/`/`api/`: 17 líneas, todas `costoMSMS` como propiedad técnica interna, cero texto visible, cero comentarios, cero strings descriptivos. Pruebas: una sola partida, dos partidas con vehículos distintos (Explorer/Hilux), equipos diferentes, equipo compartido con cantidades distintas por partida, retorno fijo por unidad, retorno/fianza porcentual, monto total prorrateado, IVA a utilidad encendido/apagado, partida sin equipo, partida inactiva/cantidad 0 — todas verificadas: cada partida cuadra individualmente, venta unitaria − costo unitario = utilidad unitaria, utilidad unitaria × cantidad = utilidad total, suma de partidas = consolidado, equipo multiplicado correctamente, sin `NaN`/`Infinity`/`undefined`, sin ningún texto de riesgo/advertencia/pendiente/DPP no disponible/costo capturado impreso. Deploy de producción confirmado exitoso.

#### Límites pendientes, documentados a propósito (no resueltos en esta versión)

- Network/DevTools crudo — sigue pendiente (Fase 2E).
- RLS `UPDATE` amplio — sigue pendiente.
- PDF cliente para empleado — sigue diferido.
- IA operativa — sigue diferida.
- Agregar/quitar equipo operativo en Cotización Operativa — pendiente.
- DPP como campo real — no existe, no se inventó.
- Asignación manual de retornos/fianzas por partida — hoy se usan las 3 reglas automáticas ya confirmadas según cómo esté capturado cada retorno/fianza; una asignación manual explícita por partida podría ser una mejora futura, no implementada en esta versión.
- Cambios de base de datos — ninguno.
- Renombrar el campo técnico `costoMSMS` — sigue como campo heredado, sin cambios.

### Fase futura (pendiente, re-etiquetada) — Multiempresa y nuevo proyecto
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

*Última actualización: 10 de julio de 2026 — Fase 0F.*
