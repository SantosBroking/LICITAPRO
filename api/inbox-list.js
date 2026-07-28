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
    // Empleado: solo sus propios pendientes.
    query += `&created_by=eq.${encodeURIComponent(profile.email)}`;
  }

  // Hotfix 2F4 -- si la lectura de inbox_items falla (por el motivo que
  // sea: cache de esquema de PostgREST desactualizada tras el ALTER TABLE
  // que agregó seen_by_admin_at/seen_by_creator_at, un hipo transitorio de
  // red, etc.), NO se rompe el endpoint completo con un 502 -- eso tumbaba
  // el badge de navegación Y la vista de Inbox por igual. Se degrada con
  // gracia: se responde igual con ok:true, items:[] y unreadCount:0, y el
  // detalle REAL del error queda en los logs del servidor (nunca se
  // expone al cliente, y nunca incluye la service key). El único caso que
  // sigue devolviendo un error real es que falte la sesión/el perfil/la
  // service key -- esos sí son fatales para esta solicitud.
  let items = [];
  let degradado = false;
  try {
    const r = await fetch(query, { headers:restHeaders });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[inbox-list] La lectura de inbox_items respondió HTTP', r.status, '-- se degrada a inbox vacío. Detalle:', detalle);
      degradado = true;
    } else {
      const parsed = await r.json();
      // Defensivo: la REST API de Supabase siempre debería regresar un
      // arreglo para un SELECT normal, pero si por cualquier motivo
      // regresara otra cosa (objeto de error con 200, null, etc.), nunca
      // se debe dejar que eso se propague como "items".
      items = Array.isArray(parsed) ? parsed : [];
    }
  } catch(e) {
    console.error('[inbox-list] Excepción leyendo inbox_items, se degrada a inbox vacío:', e.message);
    degradado = true;
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

  const respuesta = { ok:true, user:{ id:authUser.id, email:profile.email, role:profile.role }, items, unreadCount };
  // Señal SEGURA (sin detalle interno) de que esta respuesta es un
  // fallback degradado -- Inbox.js/App.js pueden ignorarla hoy sin romper
  // nada (siguen viendo ok:true, items:[], unreadCount:0), y sirve como
  // gancho si más adelante se quiere mostrar un aviso distinto de "sin
  // pendientes" real.
  if (degradado) respuesta.degraded = true;

  return res.status(200).json(respuesta);
};
