const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const ROLES_PERMITIDOS = ['admin', 'empleado']; // Fase 1: no se amplía
const ACCIONES_PERMITIDAS = ['list', 'update'];

// Fase 1C — gestión real de usuarios (user_profiles). Solo admin puede usar
// este endpoint. Las escrituras se hacen con SUPABASE_SERVICE_ROLE_KEY,
// nunca expuesta al cliente ni regresada en ninguna respuesta. Sin política
// de UPDATE directa en user_profiles a propósito (decisión de diseño).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Método no permitido' });

  // ── Sesión real ──
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok:false, error:'Falta sesión' });

  let authUser;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });
    authUser = await r.json();
  } catch(e) { return res.status(401).json({ ok:false, error:'No se pudo verificar la sesión' }); }

  // ── Perfil activo Y admin ──
  let profile;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${authUser.id}&select=email,role,active`,
      { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' });
    const rows = await r.json();
    profile = rows && rows[0];
  } catch(e) { return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' }); }
  if (!profile || !profile.active) return res.status(403).json({ ok:false, error:'Cuenta inactiva o sin perfil' });
  if (profile.role !== 'admin') return res.status(403).json({ ok:false, error:'Solo administradores pueden gestionar usuarios' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ ok:false, error:'No se puede procesar la solicitud' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){ body = {}; } }
  const { action } = body || {};

  if (!ACCIONES_PERMITIDAS.includes(action)) {
    return res.status(400).json({ ok:false, error:'Acción no reconocida' });
  }

  // ── Acción: listar todos (incluidos inactivos) ──
  if (action === 'list') {
    let r;
    try {
      r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?select=id,email,name,role,active,created_at&order=created_at.asc`,
        { headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}` } });
    } catch(e) { return res.status(502).json({ ok:false, error:'No se pudo consultar usuarios' }); }
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo consultar usuarios' });
    const data = await r.json();
    return res.status(200).json({ ok:true, data });
  }

  // ── Acción: activar/desactivar, cambiar rol ──
  if (action === 'update') {
    const { targetId, active, role } = body;

    if (!targetId) return res.status(400).json({ ok:false, error:'Falta targetId' });
    if (active !== undefined && typeof active !== 'boolean') {
      return res.status(400).json({ ok:false, error:'active debe ser true o false' });
    }
    if (role !== undefined && !ROLES_PERMITIDOS.includes(role)) {
      return res.status(400).json({ ok:false, error:'Rol no permitido' });
    }
    if (active === undefined && role === undefined) {
      return res.status(400).json({ ok:false, error:'No hay ningún cambio que aplicar (falta active o role)' });
    }

    // targetId debe existir
    let targetActual;
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${targetId}&select=id,role,active`,
        { headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}` } });
      if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo verificar el usuario objetivo' });
      const rows = await r.json();
      targetActual = rows && rows[0];
    } catch(e) { return res.status(502).json({ ok:false, error:'No se pudo verificar el usuario objetivo' }); }
    if (!targetActual) return res.status(404).json({ ok:false, error:'Usuario no encontrado' });

    // Nunca dejar el sistema sin al menos un admin activo
    const quitaAdmin = (active === false) || (role !== undefined && role !== 'admin');
    if (quitaAdmin) {
      let admins;
      try {
        const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?role=eq.admin&active=eq.true&select=id`,
          { headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}` } });
        if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo verificar administradores activos' });
        admins = await r.json();
      } catch(e) { return res.status(502).json({ ok:false, error:'No se pudo verificar administradores activos' }); }
      const esElUnicoAdmin = admins.length === 1 && admins[0].id === targetId;
      if (esElUnicoAdmin) {
        return res.status(409).json({ ok:false, error:'No se puede desactivar ni quitar el rol admin al único administrador activo.' });
      }
    }

    // Auto-modificación de admin requiere confirmación explícita
    if (targetId === authUser.id && quitaAdmin && !body.confirmSelfAction) {
      return res.status(409).json({ ok:false, error:'Estás a punto de modificar tu propia cuenta de administrador. Confirma explícitamente para continuar.' });
    }

    const patch = {};
    if (active !== undefined) patch.active = active;
    if (role !== undefined) patch.role = role;

    let r;
    try {
      r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${targetId}`, {
        method:'PATCH',
        headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
        body: JSON.stringify(patch),
      });
    } catch(e) { return res.status(502).json({ ok:false, error:'No se pudo actualizar el usuario' }); }
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo actualizar el usuario' });
    return res.status(200).json({ ok:true });
  }
};
