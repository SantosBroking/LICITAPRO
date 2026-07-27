const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';

// Estatus válidos -- allowlist explícita.
const ESTATUS_VALIDOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado', 'cambios_solicitados', 'revisado'];

// Fase 2F3 — endpoint de ESCRITURA para actualizar el ESTATUS de un
// pendiente. SOLO admin puede llamarlo -- "empleado no puede aprobar" es
// una regla dura, verificada aquí server-side (nunca confiar en que la UI
// oculte el botón). El rol SIEMPRE sale de user_profiles, nunca del body.
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

  // Regla dura: SOLO admin puede cambiar el estatus de un pendiente.
  if (profile.role !== 'admin') {
    return res.status(403).json({ ok:false, error:'Solo un administrador puede aprobar, rechazar, pedir cambios o marcar como revisado' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ ok:false, error:'No se puede procesar la solicitud' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok:false, error:'Falta la actualización a aplicar' });

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
        // Fase 2F4 -- admin acaba de actuar sobre el pendiente, así que ya
        // lo vio (seen_by_admin_at). Esto genera una notificación NUEVA
        // para quien lo creó -- su "visto" se reinicia a null.
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
