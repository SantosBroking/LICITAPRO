const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2F3 — endpoint de SOLO LECTURA para el Inbox / Centro de
// aprobaciones. Mismo patrón de auth que el resto de endpoints (Bearer ->
// user_profiles -> service role). RLS de inbox_items es admin-only a nivel
// Postgres (ver sql/2f3_inbox_items.sql) -- este endpoint SIEMPRE usa
// service_role, nunca depende de que RLS le abra la puerta a empleado.
//
// Admin ve TODOS los pendientes del workspace.
// Empleado ve SOLO los pendientes que él mismo creó (created_by = su email)
// -- "sus propios pendientes", el criterio más simple y seguro dado que hoy
// no existe un sistema de asignación de proyectos por empleado (cualquier
// activo ve cualquier proyecto).
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Método no permitido' });

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

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  const isAdmin = profile.role === 'admin';

  let query = `${SUPA_URL}/rest/v1/inbox_items?user_id=eq.${WORKSPACE_ID}&select=id,project_id,type,status,title,message,created_by,assigned_to,data,history,created_at,updated_at&order=created_at.desc`;
  if (!isAdmin) {
    // Empleado: solo sus propios pendientes.
    query += `&created_by=eq.${encodeURIComponent(profile.email)}`;
  }

  let items = [];
  try {
    const r = await fetch(query, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
    items = await r.json();
  } catch(e) {
    console.error('[inbox-list] Error leyendo inbox_items:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
  }

  return res.status(200).json({ ok:true, user:{ id:authUser.id, email:profile.email, role:profile.role }, items });
};
