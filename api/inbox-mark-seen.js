const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2F4 — endpoint de ESCRITURA para marcar pendientes como VISTOS.
// Nunca toca `status` (eso sigue siendo exclusivo de api/inbox-update.js,
// admin-only) -- este endpoint SOLO actualiza seen_by_admin_at o
// seen_by_creator_at, y SIEMPRE el campo correspondiente al ROL real de
// quien llama (nunca el que el cliente pida). Empleado solo puede marcar
// como vistos los pendientes que él mismo creó -- se verifica el
// `created_by` real de cada id contra la sesión antes de tocar nada,
// nunca se confía en lo que el cliente diga que le pertenece.
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

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = null; } }
  const { ids, all } = body || {};
  if (!all && !Array.isArray(ids)) return res.status(400).json({ ok:false, error:'Falta ids (arreglo) o all:true' });

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  const isAdmin = profile.role === 'admin';

  // ── Determinar qué ids se van a marcar ──
  let targetIds = [];
  if (all) {
    let query = `${SUPA_URL}/rest/v1/inbox_items?user_id=eq.${WORKSPACE_ID}&select=id`;
    if (!isAdmin) query += `&created_by=eq.${encodeURIComponent(profile.email)}`;
    try {
      const r = await fetch(query, { headers:restHeaders });
      if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
      const rows = await r.json();
      targetIds = rows.map(row => row.id);
    } catch(e) {
      console.error('[inbox-mark-seen] Error leyendo ids (all):', e.message);
      return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
    }
  } else {
    targetIds = ids.filter(id => typeof id === 'string' && id);
  }

  if (targetIds.length === 0) return res.status(200).json({ ok:true, updated:0 });

  // ── Empleado: SOLO puede marcar como visto lo que él mismo creó -- se
  // verifica contra la base real, filtrando cualquier id que no le
  // pertenezca (se ignora silenciosamente, no es un error del cliente
  // marcar de más por accidente, pero nunca se ejecuta sobre lo ajeno). ──
  if (!isAdmin) {
    try {
      const idsParam = targetIds.map(id => encodeURIComponent(id)).join(',');
      const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=in.(${idsParam})&select=id,created_by`, { headers:restHeaders });
      if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo verificar la propiedad de los pendientes' });
      const rows = await r.json();
      targetIds = rows.filter(row => row.created_by === profile.email).map(row => row.id);
    } catch(e) {
      console.error('[inbox-mark-seen] Error verificando propiedad:', e.message);
      return res.status(502).json({ ok:false, error:'No se pudo verificar la propiedad de los pendientes' });
    }
  }

  if (targetIds.length === 0) return res.status(200).json({ ok:true, updated:0 });

  // ── El campo a actualizar SIEMPRE sale del rol real, nunca del cliente. ──
  const campo = isAdmin ? 'seen_by_admin_at' : 'seen_by_creator_at';
  const ahora = new Date().toISOString();
  const idsParam = targetIds.map(id => encodeURIComponent(id)).join(',');

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=in.(${idsParam})`, {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type':'application/json' },
      body: JSON.stringify({ [campo]: ahora }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[inbox-mark-seen] Error HTTP al marcar visto:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo marcar como visto' });
    }
  } catch(e) {
    console.error('[inbox-mark-seen] Excepción al marcar visto:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo marcar como visto' });
  }

  return res.status(200).json({ ok:true, updated: targetIds.length });
};
