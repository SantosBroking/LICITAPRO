const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Tipos válidos de pendiente -- allowlist explícita, nunca se acepta un
// `type` arbitrario del cliente.
const TIPOS_VALIDOS = ['proyecto_nuevo', 'cotizacion_revision', 'documento_cargado', 'cambios_solicitados'];

// Fase 2F3 — endpoint de ESCRITURA para CREAR un pendiente nuevo. Ambos
// roles pueden crear (empleado manda a revisión / registra que cargó un
// documento; admin también puede crear pendientes propios si lo necesita).
// `created_by` SIEMPRE sale de la sesión real, nunca del body -- igual que
// `role` en el resto de endpoints. `data` se limita a un objeto liviano de
// referencia (ids/folio/nombre) -- NUNCA se acepta un snapshot completo de
// proyecto (misma lección aprendida de firmas[].proyecto en Fase 2E).
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
  if (!body || typeof body !== 'object') return res.status(400).json({ ok:false, error:'Falta el pendiente a crear' });

  const { type, title, message, project_id, data } = body;
  if (!TIPOS_VALIDOS.includes(type)) return res.status(400).json({ ok:false, error:'Tipo de pendiente no válido' });
  if (!title || typeof title !== 'string') return res.status(400).json({ ok:false, error:'Falta el título del pendiente' });

  // `data` acotado a un objeto liviano -- se descarta cualquier cosa que no
  // sea un objeto plano, y se limita su tamaño serializado para evitar que
  // alguien intente colar un snapshot grande por aquí.
  let dataLimitada = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const serializado = JSON.stringify(data);
    if (serializado.length > 4000) return res.status(400).json({ ok:false, error:'El campo data es demasiado grande -- solo debe llevar referencias (folio, nombre, id), no un snapshot del proyecto' });
    dataLimitada = data;
  }

  const ahora = new Date().toISOString();
  const nuevoItem = {
    user_id: WORKSPACE_ID,
    project_id: typeof project_id === 'string' ? project_id : null,
    type,
    status: 'pendiente',
    title: String(title).slice(0, 200),
    message: message ? String(message).slice(0, 2000) : null,
    created_by: profile.email, // SIEMPRE del servidor, nunca del body
    assigned_to: null,
    data: dataLimitada,
    history: [{ accion:'creado', por:profile.email, fecha:ahora, comentario:'' }],
    created_at: ahora,
    updated_at: ahora,
    // Fase 2F4 -- quien crea el pendiente ya lo "vio" (es su propia acción);
    // el otro lado queda en null (no leído) para que le aparezca como
    // notificación nueva. Empleado crea -> admin no lo ha visto todavía;
    // admin crea -> el empleado (si aplica) no lo ha visto todavía.
    seen_by_admin_at: profile.role === 'admin' ? ahora : null,
    seen_by_creator_at: profile.role === 'admin' ? null : ahora,
  };

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  let creado;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/inbox_items`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify(nuevoItem),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[inbox-create] Error HTTP al crear:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo crear el pendiente' });
    }
    const rows = await r.json();
    creado = rows && rows[0];
  } catch(e) {
    console.error('[inbox-create] Excepción al crear:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo crear el pendiente' });
  }

  return res.status(200).json({ ok:true, item: creado });
};
