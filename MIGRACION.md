# MIGRACIÓN LICITAPRO → ERP MULTIEMPRESA "GRUPO SANTIAGO"

**Este archivo es la fuente de verdad, dentro del propio repositorio, del estado de la migración de seguridad y multiempresa.** Existe para que cualquier persona (o cualquier sesión futura de asistente de IA) que retome este proyecto entienda en qué punto va, sin depender de una conversación de chat externa.

---

## Estado actual

- **Fase en curso:** 0B (Supabase Auth real) — **completa en preview, pendiente de autorización de merge a `main`**
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

### ⬜ Fase 0C — RLS y permisos mínimos
- [ ] Activar RLS en `projects`, `vehicles`, `companies`, `config`, `audit_log`
- [ ] Crear tabla `project_financials` (datos sensibles: costos, márgenes, utilidad, retornos) con RLS exclusivo de `role='admin'`
- [ ] Crear tablas `authorizations` y `ai_logs`
- [ ] Centralizar función `esAdmin(user)` en `utils.js` (elimina duplicación existente en `Projects.js`, `Firmas.js`, `App.js`)
- [ ] Conectar el flujo de aprobaciones (`firmas.js`) a roles reales de `user_profiles`

### ⬜ Fase 0D — Storage privado
- [ ] Confirmar/activar bucket `licitapro` como privado en el panel de Supabase
- [ ] Quitar `getPublicUrl` de `uploadToStorage`
- [ ] Quitar el fallback silencioso de `signedUrl()` a URL pública
- [ ] Validar tipo MIME y tamaño máximo en `uploadFileToStorage`
- [ ] (Pendiente, antes de este paso) Backup manual de archivos de Storage — guía aparte

### ⬜ Fase 0E — IA vía endpoint serverless
- [ ] Nuevo `api/ai-proxy.js` (mismo patrón que `api/send-email.js`), key desde `process.env.ANTHROPIC_API_KEY`
- [ ] Actualizar `ai_analyzer.js` y el chat de `Cotizacion.js` para llamar al proxy, no a Anthropic directo
- [ ] Registrar cada uso en `ai_logs`
- [ ] **Revocar la API key vieja** que estuvo expuesta en el frontend, una vez confirmado que el proxy funciona

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
