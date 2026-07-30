const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 3F-1 — CONSOLIDACIÓN de límite de funciones Vercel Hobby (12/12,
// ver blueprint 3A y diagnóstico 3F): api/save-vehicle.js se fusionó AQUÍ,
// dentro de api/save-project.js, como archivo separado. La lógica interna
// de cada uno NO CAMBIÓ -- es exactamente la misma de Fase 2E3C
// (proyecto) y 2E3D (vehículo), solo movida a una función interna cada
// una. Mismas garantías de siempre: sanitizeProjectUpdateForRole /
// sanitizeVehicleUpdateForRole se reutilizan TAL CUAL, sin ningún cambio,
// preservando cotización financiera, costoMSMS, montoGanar, utilidad,
// margen, retornos, fianzas, flujo, ocCondiciones, ordenesCompra con
// costos internos, docs internos (proyecto) y precioUnitario/precioTotal/
// iva/facturaAgencia/Intermedia/Gobierno (vehículo) -- todo ya cubierto
// por el diseño existente de esas funciones, sin tocarlas.
//
// Dispatch por `entity` en el body -- EXPLÍCITO y OBLIGATORIO, sin
// fallback "si no viene entity, asume project". Decisión de diseño:
// cliente y servidor se despliegan atómicamente en el mismo build de
// Vercel (monorepo, mismo commit) -- nunca existe una ventana real donde
// un cliente viejo (sin `entity`) le hable a este servidor nuevo. Un
// fallback aquí no resolvería ningún caso real, y sí introduciría un
// camino de "adivinar la intención" que podría enrutar mal una escritura
// por accidente (ej. un payload de vehículo mal formado tratado como
// intento de guardar un proyecto). Explícito y sin fallback es más seguro.
//
//   { entity: "project", payload: { ...project } }
//   { entity: "vehicle", payload: { ...vehicle } }
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

  if (body.entity === 'vehicle') return handleSaveVehicle(res, appUser, serviceKey, body.payload);
  if (body.entity === 'project') return handleSaveProject(res, appUser, serviceKey, body.payload);
  return res.status(400).json({ ok:false, error:'Falta entity ("project" o "vehicle") en la solicitud' });
};

// Fase 2E3C (sin cambios de lógica) — endpoint de ESCRITURA server-side
// para `projects`, con merge contra la base real.
async function handleSaveProject(res, appUser, serviceKey, incomingProject) {
  if (!incomingProject || typeof incomingProject !== 'object' || Array.isArray(incomingProject)) {
    return res.status(400).json({ ok:false, error:'Falta el objeto de proyecto a guardar' });
  }
  if (!incomingProject.id) return res.status(400).json({ ok:false, error:'Falta id del proyecto' });

  let sanitizeProjectUpdateForRole;
  try {
    const mod = await import('../src/lib/data_sanitize.js');
    sanitizeProjectUpdateForRole = mod.sanitizeProjectUpdateForRole;
    if (typeof sanitizeProjectUpdateForRole !== 'function') throw new Error('Export esperado no encontrado');
  } catch(e) {
    console.error('[save-project] No se pudo cargar data_sanitize.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la sanitización de datos' });
  }

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  // ── Leer el proyecto ACTUAL de la base ANTES de escribir ──
  let originalProject = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/projects?id=eq.${encodeURIComponent(incomingProject.id)}&user_id=eq.${WORKSPACE_ID}&select=data`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el proyecto actual' });
    const rows = await r.json();
    originalProject = (rows && rows[0] && rows[0].data) || null;
  } catch(e) {
    console.error('[save-project] Error leyendo proyecto actual:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el proyecto actual' });
  }

  const nuevoProject = sanitizeProjectUpdateForRole(originalProject, incomingProject, appUser);

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/projects?on_conflict=id`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: incomingProject.id, user_id: WORKSPACE_ID, data: nuevoProject, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[save-project] Error HTTP al guardar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo guardar el proyecto' });
    }
  } catch(e) {
    console.error('[save-project] Excepción al guardar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo guardar el proyecto' });
  }

  let projectGuardado = nuevoProject;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/projects?id=eq.${encodeURIComponent(incomingProject.id)}&select=data`, { headers:restHeaders });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows[0] && rows[0].data) projectGuardado = rows[0].data;
    }
  } catch(e) { console.warn('[save-project] No se pudo releer tras guardar, se regresa el valor calculado:', e.message); }

  return res.status(200).json({ ok:true, project: projectGuardado });
}

// Fase 2E3D (sin cambios de lógica, fusionado aquí en Fase 3F-1) —
// endpoint de ESCRITURA server-side para `vehicles`, con merge contra la
// base real.
async function handleSaveVehicle(res, appUser, serviceKey, incomingVehicle) {
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
}
