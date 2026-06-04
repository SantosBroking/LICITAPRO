// supabase.js — Supabase para datos, auth local con localStorage
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';

// Cliente Supabase solo para datos (sin auth)
export const sb = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// ── Auth local ────────────────────────────────────────────────
const USER_KEY = 'lp_user';

// Usuario hardcodeado — sin depender de Supabase Auth
const USERS = [
  { id: '31daca2f-17ff-4ce1-83ca-99e2b31094b7', email: 'santiago@brokingroup.com', password: 'Miscuates2804.' },
];

export const authSb = {
  onAuthStateChange: (cb) => {
    // Auto-login durante desarrollo
    const AUTO_USER = { id: '31daca2f-17ff-4ce1-83ca-99e2b31094b7', email: 'santiago@brokingroup.com' };
    localStorage.setItem(USER_KEY, JSON.stringify(AUTO_USER));
    setTimeout(() => cb('INITIAL_SESSION', { user: AUTO_USER }), 50);
    return { data: { subscription: { unsubscribe: () => {} } } };
  }
};

export async function signIn(email, password) {
  const found = USERS.find(u => u.email === email && u.password === password);
  if (!found) throw new Error('Email o contraseña incorrectos');
  const user = { id: found.id, email: found.email };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { user };
}

export async function signUp(email, password, name) {
  // Para registrar nuevos usuarios, agregar a la lista
  const user = { id: 'user-' + Date.now(), email, name };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { user };
}

export async function signOut() {
  localStorage.removeItem(USER_KEY);
}

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
  return {
    projects:  get(proj,'projects').map(r => r.data),
    vehicles:  get(veh,'vehicles').map(r => r.data),
    companies: get(comp,'companies').map(r => r.data),
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
