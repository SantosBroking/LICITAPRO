const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
// Mismo valor que src/lib/supabase.js:WORKSPACE_ID y que
// api/get-workspace-data.js -- duplicado a propósito, siguiendo la misma
// convención ya usada en todos los endpoints serverless de este proyecto.
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2E3A — endpoint de ESCRITURA server-side para `config`, con merge
// contra la base real (nunca contra lo que el cliente diga que es
// "original"). Mismo patrón de auth que api/get-workspace-data.js /
// api/admin-users.js: token real de Supabase Auth -> perfil en
// user_profiles -> solo entonces SUPABASE_SERVICE_ROLE_KEY server-side.
//
// Durante esta etapa (antes de 2E2B), regresa el config COMPLETO (sin
// sanitizeConfigForRole) incluso a empleado -- a propósito: empleado
// todavía carga por dbLoad() viejo, y mezclar un config sanitizado en el
// estado local rompería la consistencia con lo que dbLoad() ya trae. La
// PROTECCIÓN real de esta fase es de ESCRITURA (sanitizeConfigUpdateForRole),
// no de lectura -- eso sigue siendo 2E2B, fuera de alcance aquí.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Método no permitido' });

  // ── Sesión real ──
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok:false, error:'Falta sesión' });

  let authUser;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });
    authUser = await r.json();
  } catch(e) { return res.status(401).json({ ok:false, error:'No se pudo verificar la sesión' }); }

  // ── Perfil activo -- el rol SIEMPRE sale de aquí, nunca del cliente ──
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

  const appUser = { role: profile.role }; // shape mínimo que getPermissions() necesita

  // ── Body ──
  let incomingConfig = req.body;
  if (typeof incomingConfig === 'string') {
    try { incomingConfig = JSON.parse(incomingConfig); } catch(e) { incomingConfig = null; }
  }
  if (!incomingConfig || typeof incomingConfig !== 'object' || Array.isArray(incomingConfig)) {
    return res.status(400).json({ ok:false, error:'Falta el objeto de configuración a guardar' });
  }

  // ── Reutilizar sanitizeConfigUpdateForRole YA VALIDADA de data_sanitize.js ──
  // import() dinámico -- este archivo es CommonJS, data_sanitize.js es ESM.
  // Mismo patrón ya probado sin error en api/get-workspace-data.js.
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

  // Fase 2E3A: config completo para AMBOS roles (ver nota arriba del
  // encabezado -- empleado sigue en dbLoad() viejo hasta 2E2B).
  return res.status(200).json({ ok:true, config: configGuardado });
};
