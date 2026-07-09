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

export async function saveAuditLog(entry, userId) {
  if (!userId) return;
  await sb.from('audit_log').insert({ id: entry.id, user_id: userId, data: entry }).catch(()=>{});
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

/** Sube un File/Blob a Storage. Retorna la URL pública.
 *  Si falla (bucket no existe, permisos, etc.) retorna null — el código llamador debe manejar fallback. */
export async function uploadToStorage(path, fileOrBlob, contentType) {
  try {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .upload(path, fileOrBlob, { contentType, upsert: true });
    if (error) { console.warn('[Storage] upload error:', error.message); return null; }
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(data.path);
    return urlData?.publicUrl || null;
  } catch(e) { console.warn('[Storage] upload exception:', e.message); return null; }
}

/** Sube una imagen en base64 a Storage. Retorna URL pública o null. */
export async function uploadImageToStorage(path, base64, mimeType = 'image/jpeg') {
  const blob = base64ToBlob(base64, mimeType);
  return uploadToStorage(path, blob, mimeType);
}

/** Sube un File directamente a Storage (XML, PDF). Retorna URL pública o null. */
export async function uploadFileToStorage(path, file) {
  return uploadToStorage(path, file, file.type || 'application/octet-stream');
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
// Si no es de storage (base64 o URL externa), regresa el valor tal cual.
export async function signedUrl(urlOrPath, expiresSec = 3600) {
  const rel = rutaDeStorage(urlOrPath);
  if (!rel) return urlOrPath; // base64 o URL externa: devolver tal cual
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(decodeURIComponent(rel), expiresSec);
    if (error || !data?.signedUrl) {
      console.warn('[Storage] signedUrl error:', error?.message);
      return urlOrPath; // fallback: intentar con la URL original (compat con archivos públicos viejos)
    }
    return data.signedUrl;
  } catch(e) { console.warn('[Storage] signedUrl exception:', e.message); return urlOrPath; }
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
