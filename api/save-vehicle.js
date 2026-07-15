const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2E3D — endpoint de ESCRITURA server-side para `vehicles`, con merge
// contra la base real. Reutiliza sanitizeVehicleUpdateForRole TAL CUAL --
// preserva precioUnitario, precioTotal, iva, facturaAgencia/Intermedia/
// Gobierno y cualquier otro campo financiero, todo ya cubierto por el
// diseño existente de esa función.
//
// NOTA de shape: la tabla `vehicles` tiene una columna real `project_id`
// (ver src/lib/supabase.js:saveVehicle -- `project_id: vehicle.projectId`),
// distinta de `data`. Este endpoint la respeta igual que el cliente viejo.
//
// Durante esta etapa regresa el vehículo COMPLETO incluso a empleado,
// porque empleado sigue cargando por dbLoad() viejo hasta 2E2B.
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

  let incomingVehicle = req.body;
  if (typeof incomingVehicle === 'string') {
    try { incomingVehicle = JSON.parse(incomingVehicle); } catch(e) { incomingVehicle = null; }
  }
  if (!incomingVehicle || typeof incomingVehicle !== 'object' || Array.isArray(incomingVehicle)) {
    return res.status(400).json({ ok:false, error:'Falta el objeto de vehículo a guardar' });
  }
  if (!incomingVehicle.id) return res.status(400).json({ ok:false, error:'Falta id del vehículo' });

  let sanitizeVehicleUpdateForRole;
  try {
    const mod = await import('../src/lib/data_sanitize.js');
    sanitizeVehicleUpdateForRole = mod.sanitizeVehicleUpdateForRole;
    if (typeof sanitizeVehicleUpdateForRole !== 'function') throw new Error('Export esperado no encontrado');
  } catch(e) {
    console.error('[save-vehicle] No se pudo cargar data_sanitize.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la sanitización de datos' });
  }

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  // ── Leer el vehículo ACTUAL de la base ANTES de escribir ──
  let originalVehicle = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/vehicles?id=eq.${encodeURIComponent(incomingVehicle.id)}&user_id=eq.${WORKSPACE_ID}&select=data`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el vehículo actual' });
    const rows = await r.json();
    originalVehicle = (rows && rows[0] && rows[0].data) || null;
  } catch(e) {
    console.error('[save-vehicle] Error leyendo vehículo actual:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el vehículo actual' });
  }

  const nuevoVehicle = sanitizeVehicleUpdateForRole(originalVehicle, incomingVehicle, appUser);

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/vehicles?on_conflict=id`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: incomingVehicle.id, user_id: WORKSPACE_ID,
        project_id: nuevoVehicle.projectId || null, // misma columna real que usa saveVehicle() en el cliente
        data: nuevoVehicle, updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[save-vehicle] Error HTTP al guardar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo guardar el vehículo' });
    }
  } catch(e) {
    console.error('[save-vehicle] Excepción al guardar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo guardar el vehículo' });
  }

  let vehicleGuardado = nuevoVehicle;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/vehicles?id=eq.${encodeURIComponent(incomingVehicle.id)}&select=data`, { headers:restHeaders });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows[0] && rows[0].data) vehicleGuardado = rows[0].data;
    }
  } catch(e) { console.warn('[save-vehicle] No se pudo releer tras guardar, se regresa el valor calculado:', e.message); }

  return res.status(200).json({ ok:true, vehicle: vehicleGuardado });
};
