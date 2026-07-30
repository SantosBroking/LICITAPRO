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

  let query = `${SUPA_URL}/rest/v1/inbox_items?user_id=eq.${WORKSPACE_ID}&select=id,project_id,type,status,title,message,created_by,assigned_to,data,history,created_at,updated_at,seen_by_admin_at,seen_by_creator_at&order=created_at.desc`;
  if (!isAdmin) {
    // Fase 2G -- empleado ve sus propios pendientes Y los que le asignen
    // explícitamente (created_by O assigned_to = su email). Antes solo
    // veía lo que él mismo creaba.
    const emailParam = encodeURIComponent(profile.email);
    query += `&or=(created_by.eq.${emailParam},assigned_to.eq.${emailParam})`;
  }

  let items = [];
  try {
    const r = await fetch(query, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
    const parsed = await r.json();
    // Hotfix 2F4 -- defensivo: la REST API de Supabase siempre debería
    // regresar un arreglo para un SELECT normal, pero si por cualquier
    // motivo regresara otra cosa (objeto de error con 200, null, etc.),
    // nunca se debe dejar que eso se propague como "items" ni rompa el
    // cálculo de unreadCount de abajo.
    items = Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.error('[inbox-list] Error leyendo inbox_items:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
  }

  // Fase 2F4 (hotfix) -- unreadCount: para admin, cuenta seen_by_admin_at
  // nulo; para empleado, cuenta seen_by_creator_at nulo (dentro de sus
  // propios pendientes, ya filtrados arriba). Envuelto en try/catch y
  // validado al final -- unreadCount NUNCA debe faltar ni ser undefined
  // en la respuesta, pase lo que pase con el contenido de `items`.
  const campoVisto = isAdmin ? 'seen_by_admin_at' : 'seen_by_creator_at';
  let unreadCount = 0;
  try {
    unreadCount = items.filter(i => i && !i[campoVisto]).length;
  } catch(e) {
    console.error('[inbox-list] Error calculando unreadCount:', e.message);
    unreadCount = 0;
  }
  if (typeof unreadCount !== 'number' || Number.isNaN(unreadCount)) unreadCount = 0;

  return res.status(200).json({ ok:true, user:{ id:authUser.id, email:profile.email, role:profile.role }, items, unreadCount });
};
