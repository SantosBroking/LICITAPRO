// supabase.js — Supabase para datos y Auth real (Fase 0B)
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';

// Cliente Supabase — Auth real habilitado (persistencia de sesión + refresco de token).
// persistSession/autoRefreshToken en true es indispensable para que el login
// real de Supabase Auth mantenga la sesión entre recargas de página.
export const sb = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
window.__sb = sb; // diagnóstico

// ── Compatibilidad temporal con el modelo de datos actual (Fase 0B) ────
// Todo usuario autenticado real sigue leyendo/escribiendo bajo este mismo
// identificador de workspace, igual que en el sistema anterior. Es intencional:
// separa "quién eres" (resuelto aquí, en Fase 0B, con Auth real) de "qué datos
// ves" (se resolverá con el modelo de organización/empresa en Fase 1). No es
// un descuido — se retira cuando exista ese modelo.
export const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// ── Auth real ────────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Email o contraseña incorrectos');
  return { user: data.user };
}

export async function signOut() {
  await sb.auth.signOut();
}

// Construye el objeto "user" que usa el resto de la app (name, role, workspaceId)
// a partir del usuario real de Supabase Auth + su perfil en user_profiles.
// Lanza error si no hay perfil o si el usuario está desactivado (active=false).
export async function buildAppUser(authUser) {
  const { data: profile, error } = await sb
    .from('user_profiles')
    .select('name, email, role, active')
    .eq('id', authUser.id)
    .maybeSingle();
  if (error) throw new Error('No se pudo cargar tu perfil. Intenta de nuevo.');
  if (!profile) throw new Error('No existe un perfil para este usuario. Contacta al administrador.');
  if (!profile.active) throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
  return {
    id: authUser.id,
    workspaceId: WORKSPACE_ID, // compatibilidad temporal — ver nota arriba
    name: profile.name,
    email: profile.email || authUser.email,
    role: profile.role, // 'admin' | 'empleado'
  };
}

// authSb: se usa en App.js para suscribirse a los eventos reales de sesión
// (INITIAL_SESSION, SIGNED_IN, SIGNED_OUT) directamente desde Supabase Auth.
export const authSb = sb.auth;

// ── CRUD con Supabase ─────────────────────────────────────────
export async function dbLoad(userId) {
  // allSettled: si una tabla falla, las demás siguen cargando
  const [proj, veh, comp, aud] = await Promise.allSettled([
    sb.from('projects').select('data').eq('user_id', userId),
    sb.from('vehicles').select('data').eq('user_id', userId),
    sb.from('companies').select('data').eq('user_id', userId),
    sb.from('audit_log').select('data').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
  ]);
  const get = (r, name) => {
    if (r.status === 'rejected') { console.error(name+' RECHAZADO:', r.reason); return []; }
    if (r.value?.error) { console.error(name+' ERROR:', r.value.error); return []; }
    return r.value?.data || [];
  };
  let cfgData = null;
  try {
    const cfg = await sb.from('config').select('data').eq('user_id', userId).maybeSingle();
    cfgData = cfg.data?.data || null;
  } catch(e) { console.warn('Config timeout:', e.message); }
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(x => { if (!x || seen.has(x.id)) return false; seen.add(x.id); return true; });
  };
  return {
    projects:  dedup(get(proj,'projects').map(r => r.data)),
    vehicles:  dedup(get(veh,'vehicles').map(r => r.data)),
    companies: dedup(get(comp,'companies').map(r => r.data)),
    config:    cfgData,
    audit:     get(aud,'audit').map(r => r.data),
  };
}

// Fase 2E2A — lectura vía /api/get-workspace-data, SOLO para admin (el
// llamador en App.js decide el rol; esta función no valida rol, solo llama
// al endpoint con la sesión real). dbLoad() de arriba NO se toca -- sigue
// siendo el único camino de lectura para empleado hasta que exista 2E3
// (escritura server-side con merge seguro contra la base real).
//
// Sin fallback silencioso a propósito: si el endpoint falla, esta función
// LANZA el error tal cual (con mensaje claro) -- el llamador decide qué
// hacer, pero nunca debe recurrir a dbLoad() en silencio, porque eso
// ocultaría un fallo real del endpoint durante esta prueba controlada.
export async function dbLoadViaWorkspaceEndpoint() {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error('No se pudo obtener la sesión real: ' + sessionError.message);
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('No hay sesión activa de Supabase Auth -- no se puede llamar al endpoint.');

  let res;
  try {
    res = await fetch('/api/get-workspace-data', { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error('No se pudo contactar /api/get-workspace-data: ' + e.message);
  }
  if (!res.ok) {
    let detalle = '';
    try { const body = await res.json(); detalle = body?.error || ''; } catch(_e) {}
    throw new Error(`/api/get-workspace-data respondió HTTP ${res.status}` + (detalle ? ` -- ${detalle}` : ''));
  }

  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Respuesta de /api/get-workspace-data no es JSON válido: ' + e.message); }
  if (!json.ok) throw new Error('/api/get-workspace-data respondió ok:false -- ' + (json.error || 'sin detalle'));

  const data = json.data || {};
  // Mapeo exacto del shape nuevo al shape viejo que ya consume App.js.
  return {
    projects:  data.projects  || [],
    vehicles:  data.vehicles  || [],
    companies: data.companies || [],
    config:    data.config    || null,
    audit:     data.auditLog  || [],
  };
}

export async function saveProject(project, userId) {
  if (!project.id || !userId) return;
  const { error } = await sb.from('projects').upsert({
    id: project.id, user_id: userId, data: project, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function deleteProject(id, userId) {
  // Intentar borrar con y sin user_id para cubrir ambos casos
  let deleted = false;
  if (userId) {
    const { error, count } = await sb.from('projects').delete({ count:'exact' }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    if (count > 0) deleted = true;
  }
  if (!deleted) {
    const { error, count } = await sb.from('projects').delete({ count:'exact' }).eq('id', id);
    if (error) throw error;
    if (count === 0) {
      // El delete no borró nada — intentar con upsert marcando como eliminado
      // y luego forzar borrado por data->id
      const { error: e2 } = await sb.from('projects').delete().filter('data->>id', 'eq', id);
      if (e2) throw e2;
    }
  }
  try { await sb.from('vehicles').delete().eq('project_id', id); } catch(e) {}
}

export async function saveVehicle(vehicle, userId) {
  if (!vehicle.id || !userId) return;
  const { error } = await sb.from('vehicles').upsert({
    id: vehicle.id, user_id: userId, project_id: vehicle.projectId, data: vehicle, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function deleteVehicle(id) {
  await sb.from('vehicles').delete().eq('id', id);
}

export async function saveCompany(company, userId) {
  if (!company.id || !userId) return;
  const { error } = await sb.from('companies').upsert({
    id: company.id, user_id: userId, data: company, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function saveConfig(config, userId) {
  if (!userId) return;
  const { error } = await sb.from('config').upsert({
    user_id: userId, data: config, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// Fase 2E3A — guardado de config vía endpoint server-side (api/save-config.js),
// con merge seguro contra la base real. saveConfig() de arriba NO se toca --
// sigue existiendo, pero App.js deja de llamarla para config a partir de
// esta fase. Sin fallback silencioso a propósito: cualquier fallo se lanza
// tal cual, nunca cae a saveConfig() en silencio.
// Fase 3F-2 — api/save-config.js se fusionó dentro de api/save-company.js
// (consolidación de límite de funciones Vercel Hobby). Mismo endpoint,
// mismo manejo de sesión/errores de siempre -- solo cambia la URL y el
// body ahora va envuelto con {entity, payload}.
export async function saveConfigViaEndpoint(config) {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error('No se pudo obtener la sesión real: ' + sessionError.message);
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('No hay sesión activa de Supabase Auth -- no se puede guardar la configuración.');

  let res;
  try {
    res = await fetch('/api/save-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity:'config', payload:config }),
    });
  } catch (e) {
    throw new Error('No se pudo contactar /api/save-company: ' + e.message);
  }
  if (!res.ok) {
    let detalle = '';
    try { const body = await res.json(); detalle = body?.error || ''; } catch(_e) {}
    throw new Error(`/api/save-company respondió HTTP ${res.status}` + (detalle ? ` -- ${detalle}` : ''));
  }

  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Respuesta de /api/save-company no es JSON válido: ' + e.message); }
  if (!json.ok) throw new Error('/api/save-company respondió ok:false -- ' + (json.error || 'sin detalle'));

  return json.config;
}

// Fase 2E3B-C-D — mismo patrón exacto que saveConfigViaEndpoint, extraído
// aquí para no repetir la lógica de sesión/POST/validación 3 veces. Sin
// fallback silencioso: cualquier fallo se lanza tal cual.
async function postJsonWithSession(path, body) {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error('No se pudo obtener la sesión real: ' + sessionError.message);
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error(`No hay sesión activa de Supabase Auth -- no se puede llamar a ${path}.`);

  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`No se pudo contactar ${path}: ` + e.message);
  }
  if (!res.ok) {
    let detalle = '';
    try { const errBody = await res.json(); detalle = errBody?.error || ''; } catch(_e) {}
    throw new Error(`${path} respondió HTTP ${res.status}` + (detalle ? ` -- ${detalle}` : ''));
  }

  let json;
  try { json = await res.json(); } catch (e) { throw new Error(`Respuesta de ${path} no es JSON válido: ` + e.message); }
  if (!json.ok) throw new Error(`${path} respondió ok:false -- ` + (json.error || 'sin detalle'));
  return json;
}

// Fase 2E3B — guardado de empresa vía endpoint server-side
// (api/save-company.js), con merge seguro contra la base real.
// saveCompany() de arriba NO se toca, sigue existiendo.
// Fase 3F-2 — mismo endpoint que saveConfigViaEndpoint (api/save-company.js
// ahora hospeda ambas lógicas). El body va envuelto con {entity, payload}.
export async function saveCompanyViaEndpoint(company) {
  const json = await postJsonWithSession('/api/save-company', { entity:'company', payload:company });
  return json.company;
}

// Fase 2E3C — guardado de proyecto vía endpoint server-side
// (api/save-project.js), con merge seguro contra la base real.
// saveProject() de arriba NO se toca, sigue existiendo.
// Fase 3F-1 — api/save-vehicle.js se fusionó dentro de api/save-project.js
// (consolidación de límite de funciones Vercel Hobby). El endpoint ahora
// exige `entity` explícito ("project"|"vehicle") para saber qué guardar --
// ver api/save-project.js para el razonamiento de por qué no hay fallback.
export async function saveProjectViaEndpoint(project) {
  const json = await postJsonWithSession('/api/save-project', { entity:'project', payload:project });
  return json.project;
}

// Fase 2E3D — guardado de vehículo vía endpoint server-side. Fase 3F-1:
// mismo endpoint que saveProjectViaEndpoint (api/save-project.js), ya no
// existe api/save-vehicle.js como archivo separado.
// saveVehicle() de arriba NO se toca, sigue existiendo.
export async function saveVehicleViaEndpoint(vehicle) {
  const json = await postJsonWithSession('/api/save-project', { entity:'vehicle', payload:vehicle });
  return json.vehicle;
}

// Fase 2F3 — Inbox / Centro de aprobaciones. Mismo patrón: sesión real,
// sin fallback silencioso, acceso real siempre vía service_role en el
// servidor (RLS de inbox_items es admin-only, ver sql/2f3_inbox_items.sql).
export async function listInboxItems() {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw new Error('No se pudo obtener la sesión real: ' + sessionError.message);
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('No hay sesión activa de Supabase Auth -- no se puede leer el inbox.');

  let res;
  try {
    res = await fetch('/api/inbox-list', { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error('No se pudo contactar /api/inbox-list: ' + e.message);
  }
  if (!res.ok) {
    let detalle = '';
    try { const body = await res.json(); detalle = body?.error || ''; } catch(_e) {}
    throw new Error(`/api/inbox-list respondió HTTP ${res.status}` + (detalle ? ` -- ${detalle}` : ''));
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Respuesta de /api/inbox-list no es JSON válido: ' + e.message); }
  if (!json.ok) throw new Error('/api/inbox-list respondió ok:false -- ' + (json.error || 'sin detalle'));
  // Fase 2F4 -- ahora regresa { items, unreadCount } en vez de solo el
  // arreglo. Todo llamador debe desestructurar (Inbox.js, App.js).
  return { items: json.items || [], unreadCount: json.unreadCount || 0 };
}

export async function createInboxItem(item) {
  const json = await postJsonWithSession('/api/inbox-create', item);
  return json.item;
}

export async function updateInboxItem(id, status, comentario) {
  const json = await postJsonWithSession('/api/inbox-update', { id, status, comentario });
  return json.item;
}

// Fase 2F4 — marcar pendientes como vistos. `ids` es un arreglo de ids
// específicos, o pasa `{ all: true }` para marcar todos los visibles para
// este usuario (admin: todos; empleado: los suyos). El campo que se
// actualiza en el servidor (seen_by_admin_at o seen_by_creator_at) sale
// siempre del rol real, nunca de lo que mande este cliente.
// Hotfix de deployment (Vercel Hobby: límite de 12 Serverless Functions) --
// api/inbox-mark-seen.js se fusionó dentro de api/inbox-update.js. Mismo
// comportamiento para quien llama esta función, solo cambia el endpoint y
// el shape del body (envuelto en `mark_seen`).
export async function markInboxSeen({ ids, all } = {}) {
  const json = await postJsonWithSession('/api/inbox-update', { mark_seen: all ? { all:true } : { ids } });
  return json.updated || 0;
}

// Fase 2G — responder/comentar en un pendiente sin cambiar su estatus.
// Mismo endpoint fusionado (api/inbox-update.js), shape distinto ({comment}
// en vez de {mark_seen} o {id,status}).
export async function commentOnInboxItem(id, message) {
  const json = await postJsonWithSession('/api/inbox-update', { comment: { id, message } });
  return json.item;
}

// Fase 3D-B2 — flujo de firma dentro de Inbox (subir documento firmado /
// dar visto bueno final). Mismo endpoint fusionado (api/inbox-update.js),
// shape {firma:{...}}. `campos` es un objeto con cualquiera de:
// documentoUrl, documentoNombre, documentoMime, firmaStatus, cerrar.
export async function actualizarFirmaInboxItem(id, campos) {
  const json = await postJsonWithSession('/api/inbox-update', { firma: { id, ...campos } });
  return json.item;
}

export async function saveAuditLog(entry, userId) {
  if (!userId) return;
  await sb.from('audit_log').insert({ id: entry.id, user_id: userId, data: entry }).catch(()=>{});
}

// Fase 0C — Opción B: guarda el resultado financiero calculado (calcCotizacion)
// en project_financials, tabla separada con RLS admin-only. Si falla (ej. quien
// llama no es admin y RLS lo rechaza), no debe romper el guardado del proyecto —
// por eso regresa silenciosamente con un aviso en consola, nunca lanza el error.
export async function saveProjectFinancials(projectId, financialsData) {
  if (!projectId) return;
  const { error } = await sb.from('project_financials').upsert({
    project_id: projectId, data: financialsData, updated_at: new Date().toISOString(),
  });
  if (error) console.warn('[project_financials] no se pudo guardar:', error.message);
}

// ══ Supabase Storage ══════════════════════════════════════════
const BUCKET = 'licitapro';

/** Detecta si un string es base64 (data URL) o una URL de storage */
export const isBase64 = (s) => typeof s === 'string' && s.startsWith('data:');

/** Detecta si un string es una ruta de Storage */
export const isStoragePath = (s) => typeof s === 'string' && s.includes('/storage/v1/');

/** Convierte base64 a Blob para poder subir a Storage */
export function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const [header, b64] = base64.includes(',') ? base64.split(',') : ['', base64];
  const mime = mimeType || (header.match(/:(.*?);/)?.[1]) || 'application/octet-stream';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Sube un File/Blob a Storage. Retorna la RUTA relativa (no una URL pública) —
 *  Fase 0D: el bucket es privado, ya no tiene sentido pedir una URL "pública".
 *  signedUrl()/StorageImg/abrirArchivo ya saben resolver una ruta relativa tal cual.
 *  upsert:false — con las rutas ya únicas (timestamp), no debe haber colisiones
 *  legítimas; si alguna vez la hubiera, ahora falla con error visible en vez de
 *  sobrescribir en silencio (requeriría permiso de UPDATE, admin-only desde 0D).
 *  Si falla (bucket no existe, permisos, etc.) retorna null — el código llamador debe manejar fallback. */
export async function uploadToStorage(path, fileOrBlob, contentType) {
  try {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .upload(path, fileOrBlob, { contentType, upsert: false });
    if (error) { console.warn('[Storage] upload error:', error.message); return null; }
    return data.path;
  } catch(e) { console.warn('[Storage] upload exception:', e.message); return null; }
}

/** Sube una imagen en base64 a Storage. Retorna la ruta relativa o null. */
export async function uploadImageToStorage(path, base64, mimeType = 'image/jpeg') {
  const blob = base64ToBlob(base64, mimeType);
  return uploadToStorage(path, blob, mimeType);
}

// Fase 0D — validación de subida: tipo MIME y tamaño máximo.
// 25 MB por default; Companies.js pasa 50 para documentos de empresa
// (límite ya existente ahí antes de 0D, se mantiene como excepción).
const TIPOS_PERMITIDOS = [
  'application/pdf',
  'text/xml', 'application/xml',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/zip', 'application/x-zip-compressed',
];

/** Sube un File directamente a Storage (XML, PDF, etc.), validando tipo y tamaño.
 *  Retorna la ruta relativa o null si no pasa la validación o falla la subida. */
export async function uploadFileToStorage(path, file, maxSizeMB = 25) {
  if (!file) return null;
  if (file.size > maxSizeMB * 1024 * 1024) {
    console.warn(`[Storage] archivo excede el límite de ${maxSizeMB}MB:`, file.name);
    return null;
  }
  const tipo = file.type || '';
  if (!TIPOS_PERMITIDOS.includes(tipo)) {
    console.warn('[Storage] tipo de archivo no permitido:', tipo || '(desconocido)', file.name);
    return null;
  }
  return uploadToStorage(path, file, tipo || 'application/octet-stream');
}

/** Elimina un archivo de Storage (no falla si no existe). */
export async function deleteFromStorage(path) {
  try {
    // Extraer solo el path relativo si viene la URL completa
    const rel = path.includes('/storage/v1/') 
      ? path.split('/object/public/'+BUCKET+'/')[1] 
      : path;
    if (rel) await sb.storage.from(BUCKET).remove([rel]);
  } catch(e) { /* silencioso */ }
}

/** Dispara descarga de un archivo que puede ser base64 o URL de Storage */
export function downloadFile(dataOrUrl, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = dataOrUrl; // funciona para data: y https://
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Almacenamiento privado: URLs firmadas temporales ──────────
// Extrae la ruta relativa dentro del bucket a partir de una URL pública o firmada
function rutaDeStorage(urlOrPath) {
  if (!urlOrPath) return null;
  if (urlOrPath.startsWith('data:')) return null; // base64, no es de storage
  // URL pública: .../object/public/<bucket>/<ruta>
  if (urlOrPath.includes('/object/public/'+BUCKET+'/')) return urlOrPath.split('/object/public/'+BUCKET+'/')[1].split('?')[0];
  // URL firmada: .../object/sign/<bucket>/<ruta>?token=...
  if (urlOrPath.includes('/object/sign/'+BUCKET+'/')) return urlOrPath.split('/object/sign/'+BUCKET+'/')[1].split('?')[0];
  // Genérico: si contiene el bucket en algún punto
  if (urlOrPath.includes('/'+BUCKET+'/')) return urlOrPath.split('/'+BUCKET+'/')[1].split('?')[0];
  // Ya es una ruta relativa (no es URL http)
  if (!urlOrPath.startsWith('http')) return urlOrPath;
  return null;
}

// Genera una URL firmada temporal (por defecto 1 hora) para un archivo privado.
// Si no es de storage (base64 o URL externa), regresa el valor tal cual (no es un
// fallo, es un passthrough legítimo). Si SÍ es de storage pero no se pudo firmar
// (Fase 0D: antes regresaba el valor original en silencio; ahora es explícito),
// regresa `null` — el llamador debe manejar ese caso (ver StorageImg, Vehicles.js).
export async function signedUrl(urlOrPath, expiresSec = 3600) {
  const rel = rutaDeStorage(urlOrPath);
  if (!rel) return urlOrPath; // base64 o URL externa: no es un storage path, no es un fallo
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(decodeURIComponent(rel), expiresSec);
    if (error || !data?.signedUrl) {
      console.warn('[Storage] signedUrl error:', error?.message);
      return null;
    }
    return data.signedUrl;
  } catch(e) { console.warn('[Storage] signedUrl exception:', e.message); return null; }
}

// Abre un archivo (privado o no) en una pestaña nueva, resolviendo la URL firmada si aplica.
export async function abrirArchivo(urlOrPath) {
  if (!urlOrPath) return;
  // Para base64 y URLs externas, abrir directo
  if (urlOrPath.startsWith('data:') || (!rutaDeStorage(urlOrPath) && urlOrPath.startsWith('http'))) {
    window.open(urlOrPath, '_blank'); return;
  }
  const url = await signedUrl(urlOrPath, 3600);
  window.open(url, '_blank');
}
