// supabase.js — Modo LOCAL (localStorage), sin Supabase
// Guarda todo en el navegador. Sin cuenta, sin servidor.

const KEYS = {
  user:     'lp_user',
  projects: 'lp_projects',
  vehicles: 'lp_vehicles',
  companies:'lp_companies',
  config:   'lp_config',
  audit:    'lp_audit',
};

const load  = k => { try { return JSON.parse(localStorage.getItem(k)||'null'); } catch{ return null; } };
const save  = (k,v) => localStorage.setItem(k, JSON.stringify(v));

// ── Auth simulada ─────────────────────────────────────────────
const DEFAULT_USER = { id:'local-user', email:'usuario@msms.com', name:'Usuario local' };

let _authCb = null;

export const sb = {
  auth: {
    onAuthStateChange: (cb) => {
      _authCb = cb;
      // Dispara inmediatamente si hay sesión guardada
      const u = load(KEYS.user);
      if (u) setTimeout(() => cb('SIGNED_IN', { user: u }), 50);
      else    setTimeout(() => cb('SIGNED_OUT', null), 50);
      return { data: { subscription: { unsubscribe: ()=>{} } } };
    },
    getSession: async () => {
      const u = load(KEYS.user);
      return { data: { session: u ? { user: u } : null }, error: null };
    },
  }
};

export async function signIn(email, password) {
  // En modo local cualquier email/password funciona
  const user = { id:'local-user', email, name: email.split('@')[0] };
  save(KEYS.user, user);
  if (_authCb) _authCb('SIGNED_IN', { user });
  return { user };
}

export async function signUp(email, password, name) {
  const user = { id:'local-user', email, name };
  save(KEYS.user, user);
  if (_authCb) _authCb('SIGNED_IN', { user });
  return { user };
}

export async function signOut() {
  localStorage.removeItem(KEYS.user);
  if (_authCb) _authCb('SIGNED_OUT', null);
}

// ── CRUD local ────────────────────────────────────────────────
export async function dbLoad(userId) {
  return {
    projects:  load(KEYS.projects)  || [],
    vehicles:  load(KEYS.vehicles)  || [],
    companies: load(KEYS.companies) || [],
    config:    load(KEYS.config)    || null,
    audit:     load(KEYS.audit)     || [],
  };
}

export async function saveProject(project, userId) {
  const list = load(KEYS.projects) || [];
  const idx  = list.findIndex(p => p.id === project.id);
  if (idx >= 0) list[idx] = project; else list.unshift(project);
  save(KEYS.projects, list);
}

export async function deleteProject(id) {
  const list = (load(KEYS.projects) || []).filter(p => p.id !== id);
  save(KEYS.projects, list);
}

export async function saveVehicle(vehicle, userId) {
  const list = load(KEYS.vehicles) || [];
  const idx  = list.findIndex(v => v.id === vehicle.id);
  if (idx >= 0) list[idx] = vehicle; else list.push(vehicle);
  save(KEYS.vehicles, list);
}

export async function deleteVehicle(id) {
  const list = (load(KEYS.vehicles) || []).filter(v => v.id !== id);
  save(KEYS.vehicles, list);
}

export async function saveCompany(company, userId) {
  const list = load(KEYS.companies) || [];
  const idx  = list.findIndex(c => c.id === company.id);
  if (idx >= 0) list[idx] = company; else list.push(company);
  save(KEYS.companies, list);
}

export async function saveConfig(config, userId) {
  save(KEYS.config, config);
}

export async function saveAuditLog(entry, userId) {
  const list = [entry, ...(load(KEYS.audit) || [])].slice(0, 500);
  save(KEYS.audit, list);
}
