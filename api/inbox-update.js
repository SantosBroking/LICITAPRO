const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Estatus válidos -- allowlist explícita. 'cerrado' es nuevo en Fase 2G,
// agregado al final sin quitar ni reordenar los 6 ya existentes.
const ESTATUS_VALIDOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado', 'cambios_solicitados', 'revisado', 'cerrado'];

// Fase 2F3/2F4/2G — endpoint de ESCRITURA para el Inbox. Fusionado con
// api/inbox-mark-seen.js desde el hotfix de límite de funciones de Vercel
// Hobby (12 funciones máximo) -- toda esta lógica vive en un solo archivo
// a propósito, no se debe volver a separar.
//
// Tres modos, según el shape del body:
//   A) { mark_seen: { ids, all } } -- marcar como VISTO. Ambos roles.
//      Nunca toca `status`.
//   B) { id, status, comentario } -- cambiar el ESTATUS (aprobar/rechazar/
//      pedir cambios/marcar revisado/cerrar). SOLO admin.
//   C) { comment: { id, message } } -- Fase 2G, responder/comentar SIN
//      cambiar estatus. Ambos roles -- admin en cualquier pendiente,
//      empleado solo en los suyos (created_by) o los que le asignen
//      (assigned_to). El campo "visto" que se actualiza sale siempre del
//      rol real de quien comenta.
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
  if (!body || typeof body !== 'object') return res.status(400).json({ ok:false, error:'Falta el cuerpo de la solicitud' });

  // ── Modo A: marcar como visto -- ambos roles ──
  if (body.mark_seen && typeof body.mark_seen === 'object' && !Array.isArray(body.mark_seen)) {
    return handleMarkSeen(res, profile, serviceKey, body.mark_seen);
  }

  // ── Modo C (Fase 2G): comentar/responder sin cambiar estatus -- ambos roles ──
  if (body.comment && typeof body.comment === 'object' && !Array.isArray(body.comment)) {
    return handleComment(res, profile, serviceKey, body.comment);
  }

  // ── Modo B: cambio de estatus -- SOLO admin, sin cambios de Fase 2F3 ──
  if (profile.role !== 'admin') {
    return res.status(403).json({ ok:false, error:'Solo un administrador puede aprobar, rechazar, pedir cambios o marcar como revisado' });
  }

  const { id, status, comentario } = body;
  if (!id) return res.status(400).json({ ok:false, error:'Falta id del pendiente' });
  if (!ESTATUS_VALIDOS.includes(status)) return res.status(400).json({ ok:false, error:'Estatus no válido' });

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  // Leer el pendiente actual para poder ANEXAR al historial, no reemplazarlo.
  let original;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=eq.${encodeURIComponent(id)}&select=*`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el pendiente' });
    const rows = await r.json();
    original = rows && rows[0];
  } catch(e) {
    console.error('[inbox-update] Error leyendo pendiente:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el pendiente' });
  }
  if (!original) return res.status(404).json({ ok:false, error:'Pendiente no encontrado' });

  const historialNuevo = [
    ...(Array.isArray(original.history) ? original.history : []),
    { accion:status, por:profile.email, fecha:new Date().toISOString(), comentario: comentario ? String(comentario).slice(0, 2000) : '' },
  ];

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify({
        status, history: historialNuevo, updated_at: new Date().toISOString(),
        // admin acaba de actuar sobre el pendiente, así que ya lo vio
        // (seen_by_admin_at). Esto genera una notificación NUEVA para
        // quien lo creó -- su "visto" se reinicia a null.
        seen_by_admin_at: new Date().toISOString(),
        seen_by_creator_at: null,
      }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[inbox-update] Error HTTP al actualizar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo actualizar el pendiente' });
    }
    const rows = await r.json();
    return res.status(200).json({ ok:true, item: rows && rows[0] });
  } catch(e) {
    console.error('[inbox-update] Excepción al actualizar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo actualizar el pendiente' });
  }
};

// Fase 2F4 (fusionado desde api/inbox-mark-seen.js por el límite de
// funciones de Vercel Hobby) -- marca pendientes como VISTOS. Nunca toca
// `status`. El campo que se actualiza SIEMPRE sale del rol real de quien
// llama (nunca el que el cliente pida). Empleado solo puede marcar como
// vistos los pendientes que él mismo creó -- se verifica el `created_by`
// real de cada id contra la sesión antes de tocar nada.
async function handleMarkSeen(res, profile, serviceKey, markSeenBody) {
  const { ids, all } = markSeenBody;
  if (!all && !Array.isArray(ids)) return res.status(400).json({ ok:false, error:'Falta ids (arreglo) o all:true dentro de mark_seen' });

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  const isAdmin = profile.role === 'admin';

  // ── Determinar qué ids se van a marcar ──
  let targetIds = [];
  if (all) {
    let query = `${SUPA_URL}/rest/v1/inbox_items?user_id=eq.${WORKSPACE_ID}&select=id`;
    if (!isAdmin) {
      const emailParam = encodeURIComponent(profile.email);
      query += `&or=(created_by.eq.${emailParam},assigned_to.eq.${emailParam})`;
    }
    try {
      const r = await fetch(query, { headers:restHeaders });
      if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
      const rows = await r.json();
      targetIds = rows.map(row => row.id);
    } catch(e) {
      console.error('[inbox-update:mark_seen] Error leyendo ids (all):', e.message);
      return res.status(502).json({ ok:false, error:'No se pudo leer el inbox' });
    }
  } else {
    targetIds = ids.filter(id => typeof id === 'string' && id);
  }

  if (targetIds.length === 0) return res.status(200).json({ ok:true, updated:0 });

  // ── Empleado: puede marcar como visto lo que él mismo creó O lo que le
  // asignaron (Fase 2G) -- se verifica contra la base real, filtrando
  // cualquier id que no le pertenezca ni le corresponda (se ignora
  // silenciosamente, nunca se ejecuta sobre lo ajeno). ──
  if (!isAdmin) {
    try {
      const idsParam = targetIds.map(id => encodeURIComponent(id)).join(',');
      const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=in.(${idsParam})&select=id,created_by,assigned_to`, { headers:restHeaders });
      if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo verificar la propiedad de los pendientes' });
      const rows = await r.json();
      targetIds = rows.filter(row => row.created_by === profile.email || row.assigned_to === profile.email).map(row => row.id);
    } catch(e) {
      console.error('[inbox-update:mark_seen] Error verificando propiedad:', e.message);
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
      console.error('[inbox-update:mark_seen] Error HTTP al marcar visto:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo marcar como visto' });
    }
  } catch(e) {
    console.error('[inbox-update:mark_seen] Excepción al marcar visto:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo marcar como visto' });
  }

  return res.status(200).json({ ok:true, updated: targetIds.length });
}

// Fase 2G — responder/comentar en un pendiente SIN cambiar su estatus.
// Ambos roles pueden usarlo: admin en cualquier pendiente, empleado solo
// en los que él mismo creó o le asignaron explícitamente (mismo criterio
// de propiedad que mark_seen). Nunca acepta ni modifica `status` -- ese
// campo sigue siendo exclusivo del modo B, admin-only.
async function handleComment(res, profile, serviceKey, commentBody) {
  const { id, message } = commentBody;
  if (!id || typeof id !== 'string') return res.status(400).json({ ok:false, error:'Falta id del pendiente' });
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ ok:false, error:'Falta el mensaje del comentario' });

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  const isAdmin = profile.role === 'admin';

  let original;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=eq.${encodeURIComponent(id)}&select=*`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer el pendiente' });
    const rows = await r.json();
    original = rows && rows[0];
  } catch(e) {
    console.error('[inbox-update:comment] Error leyendo pendiente:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer el pendiente' });
  }
  if (!original) return res.status(404).json({ ok:false, error:'Pendiente no encontrado' });

  // Empleado solo puede comentar en lo suyo (created_by) o lo que le
  // asignen (assigned_to) -- verificado contra la base real, nunca contra
  // lo que el cliente diga.
  if (!isAdmin && original.created_by !== profile.email && original.assigned_to !== profile.email) {
    return res.status(403).json({ ok:false, error:'No puedes responder a un pendiente que no es tuyo' });
  }

  const historialNuevo = [
    ...(Array.isArray(original.history) ? original.history : []),
    { accion:'comentario', por:profile.email, fecha:new Date().toISOString(), comentario:String(message).slice(0, 2000) },
  ];

  // Nunca toca status. El campo "visto" que se actualiza SIEMPRE sale del
  // rol real de quien comenta -- quien comenta ya lo vio; el otro lado
  // queda en null (notificación nueva para la otra parte).
  const ahora = new Date().toISOString();
  const patchBody = { history: historialNuevo, updated_at: ahora };
  if (isAdmin) { patchBody.seen_by_admin_at = ahora; patchBody.seen_by_creator_at = null; }
  else { patchBody.seen_by_creator_at = ahora; patchBody.seen_by_admin_at = null; }

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify(patchBody),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[inbox-update:comment] Error HTTP al comentar:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo guardar el comentario' });
    }
    const rows = await r.json();
    return res.status(200).json({ ok:true, item: rows && rows[0] });
  } catch(e) {
    console.error('[inbox-update:comment] Excepción al comentar:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo guardar el comentario' });
  }
}
