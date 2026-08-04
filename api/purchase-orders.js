const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 3G-B — endpoint consolidado para public.purchase_orders (OC como
// módulo propio: ligadas a proyecto o independientes). UN SOLO endpoint,
// mismo patrón de siempre (Bearer -> user_profiles -> service_role) para
// no exceder el límite de funciones de Vercel Hobby (10 -> 11 con este
// archivo, confirmado antes de programar).
//
// Modos, según body.action:
//   'list'   -- listar OCs (sanitizado por rol)
//   'get'    -- una sola OC por id
//   'create' -- crear OC nueva (ligada si project_id viene, independiente si null)
//   'update' -- editar campos permitidos
//   'cancel' -- status='cancelada' (NUNCA delete físico -- no hay policy DELETE)
//
// Seguridad: RLS en purchase_orders es admin-only a nivel Postgres (ver
// sql ya ejecutado) -- el acceso real para AMBOS roles pasa por AQUÍ,
// con service_role, sanitizando salida/entrada por rol exactamente igual
// que ya se hace para project.ordenesCompra[] (sanitizeOrdenCompraForRole
// en data_sanitize.js): condiciones y partidas[].precioUnit son
// admin-only, el resto es operativo.
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

  const isAdmin = profile.role === 'admin';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok:false, error:'Falta el cuerpo de la solicitud' });
  }

  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };

  switch (body.action) {
    case 'list':   return handleList(res, restHeaders, isAdmin, profile.email, body);
    case 'get':    return handleGet(res, restHeaders, isAdmin, profile.email, body);
    case 'create': return handleCreate(res, restHeaders, isAdmin, profile.email, body);
    case 'update': return handleUpdate(res, restHeaders, isAdmin, profile.email, body);
    case 'cancel': return handleCancel(res, restHeaders, isAdmin, profile.email, body);
    default: return res.status(400).json({ ok:false, error:'action no reconocida (usa: list, get, create, update, cancel)' });
  }
};

// ── Sanitización de salida -- mismo criterio EXACTO ya usado en OC legacy
// (sanitizeOrdenCompraForRole, data_sanitize.js): condiciones y
// partidas[].precioUnit son admin-only. Empleado ve el resto completo.
function sanitizarOCParaRol(oc, isAdmin) {
  if (isAdmin) return oc;
  const limpia = { ...oc };
  delete limpia.condiciones;
  limpia.partidas = (Array.isArray(oc.partidas) ? oc.partidas : []).map(p => {
    const pLimpia = { ...p };
    delete pLimpia.precioUnit;
    return pLimpia;
  });
  return limpia;
}

async function handleList(res, restHeaders, isAdmin, email, body) {
  try {
    // Empleado ve las OC donde es created_by o assigned_to -- mismo
    // criterio ya usado en inbox_items (Fase 2G). Admin ve todas.
    let url = `${SUPA_URL}/rest/v1/purchase_orders?user_id=eq.${WORKSPACE_ID}&select=*&order=created_at.desc`;
    if (!isAdmin) {
      url += `&or=(created_by.eq.${encodeURIComponent(email)},assigned_to.eq.${encodeURIComponent(email)})`;
    }
    const r = await fetch(url, { headers:restHeaders });
    if (!r.ok) return res.status(200).json({ ok:true, items:[], degraded:true }); // nunca 502 duro, mismo criterio que inbox-list.js
    const rows = await r.json();
    const items = (rows||[]).map(o => sanitizarOCParaRol(o, isAdmin));
    return res.status(200).json({ ok:true, items });
  } catch(e) {
    console.error('[purchase-orders:list] Error:', e.message);
    return res.status(200).json({ ok:true, items:[], degraded:true });
  }
}

async function handleGet(res, restHeaders, isAdmin, email, body) {
  if (!body.id) return res.status(400).json({ ok:false, error:'Falta id' });
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${WORKSPACE_ID}&select=*`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer la orden de compra' });
    const rows = await r.json();
    const oc = rows && rows[0];
    if (!oc) return res.status(404).json({ ok:false, error:'Orden de compra no encontrada' });
    if (!isAdmin && oc.created_by !== email && oc.assigned_to !== email) {
      return res.status(403).json({ ok:false, error:'No tienes acceso a esta orden de compra' });
    }
    return res.status(200).json({ ok:true, item: sanitizarOCParaRol(oc, isAdmin) });
  } catch(e) {
    console.error('[purchase-orders:get] Error:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo leer la orden de compra' });
  }
}

// Campos que el CLIENTE puede mandar al crear/editar -- allowlist
// estricta. user_id/created_by/created_at NUNCA se aceptan del cliente.
const CAMPOS_CREATE_UPDATE = [
  'project_id', 'company_id', 'tipo', 'proveedor_nombre', 'proveedor_email', 'proveedor_rfc',
  'fecha', 'moneda', 'subtotal', 'iva', 'total', 'partidas', 'condiciones', 'data', 'assigned_to',
];
function tomarCamposPermitidos(payload) {
  const limpio = {};
  CAMPOS_CREATE_UPDATE.forEach(campo => { if (payload[campo] !== undefined) limpio[campo] = payload[campo]; });
  return limpio;
}

async function handleCreate(res, restHeaders, isAdmin, email, body) {
  const payload = body.payload;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ ok:false, error:'Falta payload' });

  // Fase 3G-B -- folio calculado SERVER-SIDE (nunca se confía en un folio
  // que mande el cliente) -- consulta los folios existentes del MISMO
  // prefijo antes de asignar el consecutivo, reduciendo (no eliminando
  // del todo) la ventana de carrera; el constraint unique(user_id,folio)
  // ya ejecutado en Supabase es la protección real y final.
  let generarFolioOC, obtenerPrefijoEmpresa;
  try {
    const mod = await import('../src/lib/utils.js');
    generarFolioOC = mod.generarFolioOC;
    obtenerPrefijoEmpresa = mod.obtenerPrefijoEmpresa;
  } catch(e) {
    console.error('[purchase-orders:create] No se pudo cargar utils.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo generar el folio' });
  }

  const limpio = tomarCamposPermitidos(payload);
  const esLigada = typeof limpio.project_id === 'string' && limpio.project_id.length > 0;
  if (!esLigada) limpio.project_id = null; // nunca aceptar valores raros -- o es un string real, o null

  let folio;
  try {
    if (esLigada) {
      // OC ligada: {folioProyecto}-OC-0N -- folioProyecto lo manda el
      // cliente (ya lo tiene cargado del proyecto), pero el CONSECUTIVO
      // se calcula aquí contra lo que ya existe en purchase_orders para
      // ese project_id.
      const folioProyecto = payload.folioProyecto;
      if (!folioProyecto || typeof folioProyecto !== 'string') {
        return res.status(400).json({ ok:false, error:'Falta folioProyecto para OC ligada' });
      }
      const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?user_id=eq.${WORKSPACE_ID}&project_id=eq.${encodeURIComponent(limpio.project_id)}&select=folio`, { headers:restHeaders });
      const existentes = r.ok ? await r.json() : [];
      const prefijo = folioProyecto + '-OC-';
      let maxIdx = 0;
      (existentes||[]).forEach(o => {
        if (o.folio && o.folio.startsWith(prefijo)) {
          const n = parseInt(o.folio.slice(prefijo.length), 10);
          if (!isNaN(n) && n > maxIdx) maxIdx = n;
        }
      });
      folio = generarFolioOC(folioProyecto, maxIdx + 1);
    } else {
      // OC independiente: {prefijoEmpresa}-{año}-OC-00N -- el cliente
      // manda empresaNombre SOLO para calcular el prefijo (nunca se
      // persiste como columna, ver diagnóstico -- companies no se
      // consulta aquí para mantener el endpoint simple, mismo criterio
      // que folios de proyecto en Fase 3C-1). Sin segmento de tipo
      // (LIC/VTA/COM) -- el esquema pedido para independiente es
      // literal {EMPRESA}-{AÑO}-OC-00N.
      const prefijoEmpresa = obtenerPrefijoEmpresa(payload.empresaNombre || '');
      const año = new Date().getFullYear();
      const prefijoIndep = `${prefijoEmpresa}-${año}-OC-`;
      const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?user_id=eq.${WORKSPACE_ID}&project_id=is.null&select=folio`, { headers:restHeaders });
      const existentes = r.ok ? await r.json() : [];
      let maxIdx = 0;
      (existentes||[]).forEach(o => {
        if (o.folio && o.folio.startsWith(prefijoIndep)) {
          const n = parseInt(o.folio.slice(prefijoIndep.length), 10);
          if (!isNaN(n) && n > maxIdx) maxIdx = n;
        }
      });
      folio = `${prefijoIndep}${String(maxIdx + 1).padStart(3, '0')}`;
    }
  } catch(e) {
    console.error('[purchase-orders:create] Error calculando folio:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo calcular el folio' });
  }

  const ahora = new Date().toISOString();
  const registro = {
    ...limpio,
    id: undefined, // dejar que Postgres genere el uuid (default gen_random_uuid())
    user_id: WORKSPACE_ID,
    folio,
    status: 'borrador',
    created_by: email,
    created_at: ahora,
    updated_at: ahora,
  };
  delete registro.id;

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders`, {
      method: 'POST',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify(registro),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      // Colisión de folio (constraint unique) -- error claro, tal como se pidió.
      if (r.status === 409 || /duplicate key/i.test(detalle)) {
        return res.status(409).json({ ok:false, error:'Ya existe una orden de compra con ese folio en este workspace. Intenta de nuevo.' });
      }
      console.error('[purchase-orders:create] Error HTTP al crear:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo crear la orden de compra' });
    }
    const rows = await r.json();
    return res.status(200).json({ ok:true, item: sanitizarOCParaRol(rows[0], isAdmin) });
  } catch(e) {
    console.error('[purchase-orders:create] Excepción:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo crear la orden de compra' });
  }
}

async function handleUpdate(res, restHeaders, isAdmin, email, body) {
  if (!body.id) return res.status(400).json({ ok:false, error:'Falta id' });
  const payload = body.payload;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ ok:false, error:'Falta payload' });

  let original;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${WORKSPACE_ID}&select=*`, { headers:restHeaders });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo leer la orden de compra' });
    const rows = await r.json();
    original = rows && rows[0];
  } catch(e) { return res.status(502).json({ ok:false, error:'No se pudo leer la orden de compra' }); }
  if (!original) return res.status(404).json({ ok:false, error:'Orden de compra no encontrada' });
  if (!isAdmin && original.created_by !== email && original.assigned_to !== email) {
    return res.status(403).json({ ok:false, error:'No tienes acceso a esta orden de compra' });
  }
  if (original.status === 'cancelada') {
    return res.status(400).json({ ok:false, error:'Esta orden de compra está cancelada, no se puede editar' });
  }

  const limpio = tomarCamposPermitidos(payload);
  // Empleado NUNCA puede tocar condiciones ni partidas[].precioUnit --
  // mismo criterio que OC legacy. Se preservan del original sin importar
  // qué mande el cliente.
  if (!isAdmin) {
    delete limpio.condiciones;
    if (Array.isArray(limpio.partidas)) {
      const originalPorId = {};
      (original.partidas||[]).forEach(p => { originalPorId[p.id] = p; });
      limpio.partidas = limpio.partidas.map(p => ({ ...p, precioUnit: (originalPorId[p.id]||{}).precioUnit }));
    }
  }
  // Nunca se acepta cambiar folio/project_id/user_id/status desde update
  // (status tiene su propio modo 'cancel'; folio/project_id/user_id son
  // inmutables tras creación -- evita romper el folio ya asignado).
  delete limpio.project_id;

  const nuevoRegistro = { ...limpio, updated_at: new Date().toISOString() };
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?id=eq.${encodeURIComponent(body.id)}`, {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify(nuevoRegistro),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(()=> '');
      console.error('[purchase-orders:update] Error HTTP:', r.status, detalle);
      return res.status(502).json({ ok:false, error:'No se pudo actualizar la orden de compra' });
    }
    const rows = await r.json();
    return res.status(200).json({ ok:true, item: sanitizarOCParaRol(rows[0], isAdmin) });
  } catch(e) {
    console.error('[purchase-orders:update] Excepción:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo actualizar la orden de compra' });
  }
}

// Cancelar -- SOLO admin (mismo criterio que aprobar/rechazar/cerrar en
// Inbox: cambios de estatus finales/formales son admin-only). Nunca
// borra físicamente -- no existe policy DELETE en purchase_orders.
async function handleCancel(res, restHeaders, isAdmin, email, body) {
  if (!isAdmin) return res.status(403).json({ ok:false, error:'Solo un administrador puede cancelar una orden de compra' });
  if (!body.id) return res.status(400).json({ ok:false, error:'Falta id' });
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/purchase_orders?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${WORKSPACE_ID}`, {
      method: 'PATCH',
      headers: { ...restHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: JSON.stringify({ status:'cancelada', updated_at:new Date().toISOString() }),
    });
    if (!r.ok) return res.status(502).json({ ok:false, error:'No se pudo cancelar la orden de compra' });
    const rows = await r.json();
    if (!rows || !rows[0]) return res.status(404).json({ ok:false, error:'Orden de compra no encontrada' });
    return res.status(200).json({ ok:true, item: sanitizarOCParaRol(rows[0], isAdmin) });
  } catch(e) {
    console.error('[purchase-orders:cancel] Excepción:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo cancelar la orden de compra' });
  }
}
