const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 3F-2 — CONSOLIDACIÓN de límite de funciones Vercel Hobby (11/12,
// tras 3F-1). api/save-config.js se fusionó AQUÍ, dentro de
// api/save-company.js, como archivo separado. Mismo patrón exacto que
// 3F-1 (save-vehicle -> save-project): la lógica interna de cada uno NO
// CAMBIÓ -- es exactamente la misma de Fase 2E3B (empresa) y 2E3A
// (config), solo movida a una función interna cada una.
// sanitizeCompanyUpdateForRole / sanitizeConfigUpdateForRole se reutilizan
// TAL CUAL, sin ningún cambio, preservando objetoSocial/
// documentosMembretados (empresa) y ocSettings/customProducts/
// hiddenProducts (config) exactamente como ya protegían antes.
//
// Dispatch por `entity` en el body -- EXPLÍCITO y OBLIGATORIO, sin
// fallback "si no viene entity, asume company". Misma decisión de diseño
// y misma razón que 3F-1: cliente y servidor se despliegan atómicamente
// en el mismo build de Vercel -- nunca existe una ventana real donde un
// cliente viejo (sin `entity`) le hable a este servidor nuevo. Un
// fallback no resolvería ningún caso real, y sí introduciría un camino
// de "adivinar la intención" que podría enrutar mal una escritura por
// accidente.
//
//   { entity: "company", payload: { ...company } }
//   { entity: "config",  payload: { ...config } }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Método no permitido' });

  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok:false, error:'Falta sesión' });

  let authUser;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });
    authUser = await r.json();
  } catch(e) { return res.status(401).json({ ok:false, error:'No se pudo verificar la sesión' }); }

  let profile;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${authUser.id}&select=email,role,active`,
      { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' });
    const rows = await r.json();
    profile = rows && rows[0];
  } catch(e) { return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' }); }
  if (!profile) return res.status(403).json({ ok:false, error:'No existe un perfil para este usuario' });
  if (!profile.active) return res.status(403).json({ ok:false, error:'Cuenta inactiva' });
  if (profile.role !== 'admin' && profile.role !== 'empleado') {
    return res.status(403).json({ ok:false, error:'Rol no reconocido' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ ok:false, error:'No se puede procesar la solicitud' });

  const appUser = { role: profile.role };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok:false, error:'Falta el cuerpo de la solicitud' });
  }

  if (body.entity === 'config') return handleSaveConfig(res, appUser, serviceKey, body.payload);
  if (body.entity === 'company') return handleSaveCompany(res, appUser, serviceKey, body.payload);
  return res.status(400).json({ ok:false, error:'Falta entity ("company" o "config") en la solicitud' });
};

// Fase 2E3B (sin cambios de lógica) — endpoint de ESCRITURA server-side
// para `companies`, con merge contra la base real. Empleado nunca puede
// modificar/borrar objetoSocial ni documentosMembretados, sin importar
// qué mande (omitido, null, vacío, o con datos falsos) -- siempre se
// preservan desde el registro real leído en el servidor.
async function handleSaveCompany(res, appUser, serviceKey, incomingCompany) {
  if (!incomingCompany || typeof incomingCompany !== 'object' || Array.isArray(incomingCompany)) {
    return res.status(400).json({ ok:false, error:'Falta el objeto de empresa a guardar' });
  }
  if (!incomingCompany.id) return res.status(400).json({ ok:false, error:'Falta id de la empresa' });

  let sanitizeCompanyUpdateForRole;
  try {
    const mod = await import('../src/lib/data_sanitize.js');
    sanitizeCompanyUpdateForRole = mod.sanitizeCompanyUpdateForRole;
    if (typeof sanitizeCompanyUpdateForRole !== 'function') throw new Error('Export esperado no encontrado');
  } catch(e) {
    console.error('[save-company] No se pudo cargar data_sanitize.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la sanitización de datos' });
  }

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  // ── Leer la empresa ACTUAL de la base ANTES de escribir ──
  let originalCompany = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/companies?id=eq.${encodeURIComponent(incomingCompany.id)}&user_id=eq.${WORKSPACE_ID}&select=data`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer la empresa actual' });
    const rows = await r.json();
    originalCompany = (rows && rows[0] && rows[0].data) || null;
  } catch(e) {
    console.error('[save-company] Error leyendo empresa actual:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer la empresa actual' });
  }

  // Empleado no puede crear una empresa con id que no existe en la base
  // simulando que sí existe -- si no la encontramos, es creación legítima
  // (empleado sí puede crear empresas hoy, sin gate de vista) o edición de
  // una que ya existe; sanitizeCompanyUpdateForRole ya maneja ambos casos.
  const nuevaCompany = sanitizeCompanyUpdateForRole(originalCompany, incomingCompany, appUser);

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/companies?on_conflict=id`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: incomingCompany.id, user_id: WORKSPACE_ID, data: nuevaCompany, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[save-company] Error HTTP al guardar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo guardar la empresa' });
    }
  } catch(e) {
    console.error('[save-company] Excepción al guardar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo guardar la empresa' });
  }

  let companyGuardada = nuevaCompany;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/companies?id=eq.${encodeURIComponent(incomingCompany.id)}&select=data`, { headers:restHeaders });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows[0] && rows[0].data) companyGuardada = rows[0].data;
    }
  } catch(e) { console.warn('[save-company] No se pudo releer tras guardar, se regresa el valor calculado:', e.message); }

  return res.status(200).json({ ok:true, company: companyGuardada });
}

// Fase 2E3A (sin cambios de lógica, fusionado aquí en Fase 3F-2) —
// endpoint de ESCRITURA server-side para `config`, con merge contra la
// base real (nunca contra lo que el cliente diga que es "original").
// NOTA de shape: a diferencia de company/project/vehicle, config hace
// upsert por `user_id` (no por `id`) -- es un registro único por
// workspace, se preserva esa diferencia real tal cual.
async function handleSaveConfig(res, appUser, serviceKey, incomingConfig) {
  if (!incomingConfig || typeof incomingConfig !== 'object' || Array.isArray(incomingConfig)) {
    return res.status(400).json({ ok:false, error:'Falta el objeto de configuración a guardar' });
  }

  let sanitizeConfigUpdateForRole;
  try {
    const mod = await import('../src/lib/data_sanitize.js');
    sanitizeConfigUpdateForRole = mod.sanitizeConfigUpdateForRole;
    if (typeof sanitizeConfigUpdateForRole !== 'function') throw new Error('Export esperado no encontrado');
  } catch(e) {
    console.error('[save-config] No se pudo cargar data_sanitize.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la sanitización de datos' });
  }

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  // ── Leer config ACTUAL de la base ANTES de escribir -- nunca confiar en ──
  // ── lo que el cliente diga que es "original".                        ──
  let originalConfig = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/config?user_id=eq.${WORKSPACE_ID}&select=data&limit=1`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer la configuración actual' });
    const rows = await r.json();
    originalConfig = (rows && rows[0] && rows[0].data) || null;
  } catch(e) {
    console.error('[save-config] Error leyendo config actual:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer la configuración actual' });
  }

  const nuevaConfig = sanitizeConfigUpdateForRole(originalConfig, incomingConfig, appUser);

  // ── Escribir -- upsert SOLO de la columna `data`, mismo workspace fijo ──
  // que ya usa api/get-workspace-data.js (nunca aceptado del cliente).
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/config?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: WORKSPACE_ID, data: nuevaConfig, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[save-config] Error HTTP al guardar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo guardar la configuración' });
    }
  } catch(e) {
    console.error('[save-config] Excepción al guardar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo guardar la configuración' });
  }

  // ── Releer después de guardar -- la respuesta siempre refleja la base real ──
  let configGuardado = nuevaConfig;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/config?user_id=eq.${WORKSPACE_ID}&select=data&limit=1`, { headers:restHeaders });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows[0] && rows[0].data) configGuardado = rows[0].data;
    }
  } catch(e) { console.warn('[save-config] No se pudo releer tras guardar, se regresa el valor calculado:', e.message); }

  return res.status(200).json({ ok:true, config: configGuardado });
}
