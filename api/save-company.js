const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2E3B — endpoint de ESCRITURA server-side para `companies`, con merge
// contra la base real. Mismo patrón que api/save-config.js. Empleado nunca
// puede modificar/borrar objetoSocial ni documentosMembretados, sin importar
// qué mande (omitido, null, vacío, o con datos falsos) -- siempre se
// preservan desde el registro real leído en el servidor.
//
// Durante esta etapa regresa la empresa COMPLETA incluso a empleado, porque
// empleado sigue cargando por dbLoad() viejo hasta 2E2B.
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

  let incomingCompany = req.body;
  if (typeof incomingCompany === 'string') {
    try { incomingCompany = JSON.parse(incomingCompany); } catch(e) { incomingCompany = null; }
  }
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
};
