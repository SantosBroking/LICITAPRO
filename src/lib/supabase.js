// supabase.js — Cliente Supabase real + fallback localStorage
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = 'https://hiofjttxnlfxbrogjske.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2ZqdHR4bmxmeGJyb2dqc2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MjEwNDUsImV4cCI6MjA5NTQ5NzA0NX0.mShA6E8gXS45tdVX4r6x66DvGyJUeabOAUXBw112ptE';

export const sb = createClient(SUPA_URL, SUPA_KEY);

// ── Auth ──────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, name) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
}

// ── Cargar todos los datos ────────────────────────────────────
export async function dbLoad(userId) {
  const [proj, veh, comp, cfg, aud] = await Promise.all([
    sb.from('projects').select('data').eq('user_id', userId),
    sb.from('vehicles').select('data').eq('user_id', userId),
    sb.from('companies').select('data').eq('user_id', userId),
    sb.from('config').select('data').eq('user_id', userId).maybeSingle(),
    sb.from('audit_log').select('data').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
  ]);
  return {
    projects:  (proj.data  || []).map(r => r.data),
    vehicles:  (veh.data   || []).map(r => r.data),
    companies: (comp.data  || []).map(r => r.data),
    config:    cfg.data?.data || null,
    audit:     (aud.data   || []).map(r => r.data),
  };
}

// ── CRUD ──────────────────────────────────────────────────────
export async function saveProject(project, userId) {
  const { error } = await sb.from('projects').upsert({
    id: project.id, user_id: userId, data: project, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function deleteProject(id) {
  await sb.from('projects').delete().eq('id', id);
  await sb.from('vehicles').delete().eq('project_id', id);
}

export async function saveVehicle(vehicle, userId) {
  const { error } = await sb.from('vehicles').upsert({
    id: vehicle.id, user_id: userId, project_id: vehicle.projectId, data: vehicle, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function deleteVehicle(id) {
  await sb.from('vehicles').delete().eq('id', id);
}

export async function saveCompany(company, userId) {
  const { error } = await sb.from('companies').upsert({
    id: company.id, user_id: userId, data: company, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function saveConfig(config, userId) {
  const { error } = await sb.from('config').upsert({
    user_id: userId, data: config, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function saveAuditLog(entry, userId) {
  await sb.from('audit_log').insert({
    id: entry.id, user_id: userId, data: entry
  });
}
