# MIGRACIÓN LICITAPRO → ERP MULTIEMPRESA "GRUPO SANTIAGO"

**Este archivo es la fuente de verdad, dentro del propio repositorio, del estado de la migración de seguridad y multiempresa.** Existe para que cualquier persona (o cualquier sesión futura de asistente de IA) que retome este proyecto entienda en qué punto va, sin depender de una conversación de chat externa.

---

## Estado actual

- **Fase en curso:** 0A (Backup, rama y variables) — **en ejecución**
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

### ⬜ Fase 0B — Supabase Auth real
- [ ] Crear tabla `user_profiles` (vía SQL Editor de Supabase, ejecutado por Santiago con guía exacta)
- [ ] Endpoint `api/invite-user.js` (usa `service_role` key)
- [ ] Reescribir `src/lib/supabase.js`: quitar `USERS[]` hardcodeado, `signIn`/`signUp` falsos; usar `sb.auth.signInWithPassword()` real
- [ ] Reescribir `src/views/Auth.js`: quitar modo "registro"; solo login + "olvidé mi contraseña"
- [ ] Migrar cuentas reales de Santiago y Mauricio (contraseñas nuevas, las viejas expuestas quedan invalidadas)
- [ ] Probar login/logout en preview antes de mergear

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
