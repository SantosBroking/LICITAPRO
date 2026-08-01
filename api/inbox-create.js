const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2G — tipos/prioridad/acción/referencia ahora viven en
// src/lib/constants.js (compartido con la UI, Inbox.js/CotizacionOperativa.js)
// para no duplicar listas -- import dinámico, mismo patrón ya usado por
// api/save-project.js con data_sanitize.js.
async function cargarConstantesInbox() {
  const mod = await import('../src/lib/constants.js');
  return {
    TIPOS_VALIDOS: mod.INBOX_TIPOS,
    PRIORIDADES_VALIDAS: mod.INBOX_PRIORIDADES,
    ACCIONES_VALIDAS: mod.INBOX_ACCIONES,
    REFERENCIA_TIPOS_VALIDOS: mod.INBOX_REFERENCIA_TIPOS,
    DOCUMENTO_TIPOS_VALIDOS: mod.INBOX_DOCUMENTO_TIPOS,
    FIRMA_STATUS_VALIDOS: mod.INBOX_FIRMA_STATUS,
  };
}

// Fase 2G — campos permitidos dentro de `data` (jsonb). Allowlist explícita
// -- cualquier campo que NO esté aquí se descarta silenciosamente, nunca se
// guarda tal cual lo mande el cliente. Cubre tanto los campos operativos ya
// existentes desde 2F2/2F3 (folio, proyectoNombre, partidasActivas,
// equipoCount, categorias, cantidad) como los nuevos de la petición robusta
// (prioridad, accionSolicitada, referenciaTipo/Id/Label, dueDate, source).
// Fase 3D-A: campos de firma_documento agregados (ver diagnóstico 3D-0) --
// SOLO se permite que se GUARDEN si vienen en el body; ningún flujo real
// los crea todavía (Firmas.js/project.firmas[] siguen siendo la única vía
// real de firmas hoy, sin tocar).
const CAMPOS_DATA_PERMITIDOS = [
  'folio', 'proyectoNombre', 'partidasActivas', 'equipoCount', 'categorias', 'cantidad',
  'prioridad', 'accionSolicitada', 'referenciaTipo', 'referenciaId', 'referenciaLabel', 'dueDate', 'source',
  'documentoTipo', 'documentoFolio', 'folioProyecto', 'documentoUrl', 'documentoNombre', 'documentoMime',
  'firmante', 'firmanteEmail', 'firmaStatus', 'ocId', 'cotizacionId', 'docId',
];

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

  let constantesInbox;
  try {
    constantesInbox = await cargarConstantesInbox();
  } catch(e) {
    console.error('[inbox-create] No se pudieron cargar las constantes:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la solicitud' });
  }
  const { TIPOS_VALIDOS, PRIORIDADES_VALIDAS, ACCIONES_VALIDAS, REFERENCIA_TIPOS_VALIDOS, DOCUMENTO_TIPOS_VALIDOS, FIRMA_STATUS_VALIDOS } = constantesInbox;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok:false, error:'Falta el pendiente a crear' });

  // Fase 2G -- `status` NUNCA se acepta del body en la creación, ni antes
  // ni ahora: siempre se fuerza a 'pendiente' más abajo, sin importar qué
  // mande el cliente (incluido cualquier intento de empleado de crear ya
  // directamente como 'aprobado'/'rechazado'/'cerrado').
  const { type, title, message, project_id, data, assigned_to } = body;
  if (!TIPOS_VALIDOS.includes(type)) return res.status(400).json({ ok:false, error:'Tipo de pendiente no válido' });
  if (!title || typeof title !== 'string') return res.status(400).json({ ok:false, error:'Falta el título del pendiente' });

  // `data` acotado a un objeto liviano, con allowlist explícita de campos
  // Y límite de tamaño -- se descarta cualquier campo no reconocido, nunca
  // se guarda tal cual lo mande el cliente.
  let dataLimitada = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const serializado = JSON.stringify(data);
    if (serializado.length > 4000) return res.status(400).json({ ok:false, error:'El campo data es demasiado grande -- solo debe llevar referencias (folio, nombre, id), no un snapshot del proyecto' });
    Object.keys(data).forEach(campo => {
      if (CAMPOS_DATA_PERMITIDOS.includes(campo)) dataLimitada[campo] = data[campo];
    });
  }
  // Validaciones específicas de los campos robustos de Fase 2G -- si algo
  // no es válido, se descarta ese campo puntual (no se rechaza toda la
  // petición por un valor de más), salvo prioridad/accionSolicitada que si
  // vienen, deben ser válidos (para no guardar basura silenciosamente).
  if (dataLimitada.prioridad !== undefined && !PRIORIDADES_VALIDAS.includes(dataLimitada.prioridad)) delete dataLimitada.prioridad;
  if (dataLimitada.accionSolicitada !== undefined && !ACCIONES_VALIDAS.includes(dataLimitada.accionSolicitada)) delete dataLimitada.accionSolicitada;
  if (dataLimitada.referenciaTipo !== undefined && !REFERENCIA_TIPOS_VALIDOS.includes(dataLimitada.referenciaTipo)) delete dataLimitada.referenciaTipo;
  if (typeof dataLimitada.referenciaId !== 'string') delete dataLimitada.referenciaId;
  if (typeof dataLimitada.referenciaLabel !== 'string') delete dataLimitada.referenciaLabel;
  else dataLimitada.referenciaLabel = dataLimitada.referenciaLabel.slice(0, 200);
  if (typeof dataLimitada.dueDate !== 'string' || isNaN(Date.parse(dataLimitada.dueDate))) delete dataLimitada.dueDate;
  if (typeof dataLimitada.source !== 'string') delete dataLimitada.source;
  else dataLimitada.source = dataLimitada.source.slice(0, 100);
  // Fase 3D-A -- validaciones de los campos de firma_documento, mismo
  // patrón: si no son válidos, se descarta solo ese campo puntual.
  if (dataLimitada.documentoTipo !== undefined && !DOCUMENTO_TIPOS_VALIDOS.includes(dataLimitada.documentoTipo)) delete dataLimitada.documentoTipo;
  if (dataLimitada.firmaStatus !== undefined && !FIRMA_STATUS_VALIDOS.includes(dataLimitada.firmaStatus)) delete dataLimitada.firmaStatus;
  if (typeof dataLimitada.documentoFolio !== 'string') delete dataLimitada.documentoFolio;
  else dataLimitada.documentoFolio = dataLimitada.documentoFolio.slice(0, 100);
  if (typeof dataLimitada.folioProyecto !== 'string') delete dataLimitada.folioProyecto;
  else dataLimitada.folioProyecto = dataLimitada.folioProyecto.slice(0, 100);
  if (typeof dataLimitada.documentoUrl !== 'string') delete dataLimitada.documentoUrl;
  else dataLimitada.documentoUrl = dataLimitada.documentoUrl.slice(0, 500);
  if (typeof dataLimitada.documentoNombre !== 'string') delete dataLimitada.documentoNombre;
  else dataLimitada.documentoNombre = dataLimitada.documentoNombre.slice(0, 200);
  if (typeof dataLimitada.documentoMime !== 'string') delete dataLimitada.documentoMime;
  else dataLimitada.documentoMime = dataLimitada.documentoMime.slice(0, 100);
  if (typeof dataLimitada.firmante !== 'string') delete dataLimitada.firmante;
  else dataLimitada.firmante = dataLimitada.firmante.slice(0, 200);
  if (typeof dataLimitada.firmanteEmail !== 'string') delete dataLimitada.firmanteEmail;
  else dataLimitada.firmanteEmail = dataLimitada.firmanteEmail.slice(0, 200);
  if (typeof dataLimitada.ocId !== 'string') delete dataLimitada.ocId;
  if (typeof dataLimitada.cotizacionId !== 'string') delete dataLimitada.cotizacionId;
  if (typeof dataLimitada.docId !== 'string') delete dataLimitada.docId;
  // Default silencioso: si no se mandó prioridad válida, queda 'media' --
  // nunca ausente, para que la UI siempre tenga algo consistente que mostrar.
  if (!dataLimitada.prioridad) dataLimitada.prioridad = 'media';

  // Fase 2G -- `assigned_to`: puramente informativo (a quién va dirigida la
  // petición). NUNCA se usa para otorgar permisos -- created_by sigue
  // siendo el único criterio real de "es mío" en el resto de los
  // endpoints. Se acota a un string corto, sin validar que sea un email
  // real de un usuario existente (bajo riesgo, es solo metadata).
  const assignedToLimitado = (typeof assigned_to === 'string' && assigned_to.trim()) ? assigned_to.trim().slice(0, 200) : null;

  const ahora = new Date().toISOString();
  const nuevoItem = {
    user_id: WORKSPACE_ID,
    project_id: typeof project_id === 'string' ? project_id : null,
    type,
    status: 'pendiente',
    title: String(title).slice(0, 200),
    message: message ? String(message).slice(0, 2000) : null,
    created_by: profile.email, // SIEMPRE del servidor, nunca del body
    assigned_to: assignedToLimitado,
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
