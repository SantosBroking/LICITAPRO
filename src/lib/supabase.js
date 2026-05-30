// ─────────────────────────────────────────────────────────────
// supabase.js  —  Cliente, auth y CRUD
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = 'https://hiofjttxnlfxbrogjske.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2ZqdHR4bmxmeGJyb2dqc2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MjEwNDUsImV4cCI6MjA5NTQ5NzA0NX0.mShA6E8gXS45tdVX4r6x66DvGyJUeabOAUXBw112ptE';

/** Cliente Supabase (singleton) */
export const sb = createClient(SUPA_URL, SUPA_KEY);

// ── Auth ──────────────────────────────────────────────────────

export const signIn  = (email, pwd) =>
  sb.auth.signInWithPassword({ email, password: pwd })
    .then(({ data, error }) => { if (error) throw error; return data.user; });

export const signUp  = (email, pwd, name) =>
  sb.auth.signUp({ email, password: pwd, options: { data: { full_name: name } } })
    .then(({ data, error }) => { if (error) throw error; return data.user; });

export const signOut = async () => {
  await sb.auth.signOut();
  window.location.reload();
};

// ── Data load ─────────────────────────────────────────────────

export async function dbLoad(userId) {
  const [
    { data: projects },
    { data: vehicles },
    { data: companies },
    { data: cfg },
    { data: audit },
  ] = await Promise.all([
    sb.from('projects').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    sb.from('vehicles').select('*').eq('user_id', userId),
    sb.from('companies').select('*').eq('user_id', userId),
    sb.from('user_config').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('audit_logs').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(500),
  ]);
  return {
    projects:  (projects  || []).map(dbToProject),
    vehicles:  (vehicles  || []).map(dbToVehicle),
    companies: companies  || [],
    config:    cfg ? dbToConfig(cfg) : null,
    audit:     (audit || []).map(a => ({
      id: a.id, timestamp: a.created_at, userId: a.user_id,
      userName: a.user_name, action: a.action, entity: a.entity,
      entityId: a.entity_id, details: a.details,
    })),
  };
}

// ── Mappers DB → App ──────────────────────────────────────────

export const dbToProject = (r) => ({
  id: r.id, name: r.name || '',
  dependencia: r.dependencia || '', company: r.company || '',
  numLicitacion: r.num_licitacion || '', status: r.status || 'prospecto',
  tipoProcedimiento: r.tipo_procedimiento || '',
  productType: r.product_type || 'Patrullas y vehículos',
  responsable: r.responsable || '', montoEstimado: r.monto_estimado || 0,
  probability: r.probability || 50, description: r.description || '',
  observaciones: r.observaciones || '',
  fechaPublicacion: r.fecha_publicacion || '', fechaAclaraciones: r.fecha_aclaraciones || '',
  fechaPropuesta: r.fecha_propuesta || '', fechaFallo: r.fecha_fallo || '',
  fechaContrato: r.fecha_contrato || '',
  notes: r.notes || [], activity: r.activity || [],
  preguntas: r.preguntas || [], docs: r.docs || [],
  preparation: r.preparation || {}, cotizacion: r.cotizacion || {},
});

export const dbToVehicle = (r) => ({
  id: r.id, projectId: r.project_id,
  marca: r.marca || '', modelo: r.modelo || '', version: r.version || '',
  ano: r.ano || '', color: r.color || '', vin: r.vin || '',
  numMotor: r.num_motor || '', numInventario: r.num_inventario || '',
  precioUnitario: r.precio_unitario || 0, iva: r.iva || 0, precioTotal: r.precio_total || 0,
  equipamiento: r.equipamiento || '', statusDocs: r.status_docs || 'Pendiente',
  statusEntrega: r.status_entrega || 'Pendiente', ubicacion: r.ubicacion || '',
  observaciones: r.observaciones || '',
  facturaAgencia: r.factura_agencia || {}, facturaEquipo: r.factura_equipo || {},
  facturaGobierno: r.factura_gobierno || {}, actaEntrega: r.acta_entrega || {},
});

export const dbToConfig = (r) => ({
  groupName: r.group_name || 'MSMS CORP', currency: r.currency || 'MXN',
  checklistTemplate: r.checklist_template || null,
  customStatuses: r.custom_statuses || [], customProductTypes: r.custom_product_types || [],
});

// ── CRUD ─────────────────────────────────────────────────────

export const saveProject = (p, userId) =>
  sb.from('projects').upsert({
    id: p.id, user_id: userId, name: p.name, dependencia: p.dependencia,
    company: p.company, num_licitacion: p.numLicitacion, status: p.status,
    tipo_procedimiento: p.tipoProcedimiento, product_type: p.productType,
    responsable: p.responsable, monto_estimado: p.montoEstimado || 0,
    probability: p.probability || 0, description: p.description,
    observaciones: p.observaciones,
    fecha_publicacion:  p.fechaPublicacion  || null,
    fecha_aclaraciones: p.fechaAclaraciones || null,
    fecha_propuesta:    p.fechaPropuesta    || null,
    fecha_fallo:        p.fechaFallo        || null,
    fecha_contrato:     p.fechaContrato     || null,
    notes: p.notes || [], activity: p.activity || [],
    preguntas: p.preguntas || [], docs: p.docs || [],
    preparation: p.preparation || {}, cotizacion: p.cotizacion || {},
  });

export const deleteProject = (id) =>
  sb.from('projects').delete().eq('id', id);

export const saveVehicle = (v, userId) =>
  sb.from('vehicles').upsert({
    id: v.id, project_id: v.projectId, user_id: userId,
    marca: v.marca, modelo: v.modelo, version: v.version, ano: v.ano,
    color: v.color, vin: v.vin, num_motor: v.numMotor, num_inventario: v.numInventario,
    precio_unitario: v.precioUnitario || 0, iva: v.iva || 0, precio_total: v.precioTotal || 0,
    equipamiento: v.equipamiento, status_docs: v.statusDocs, status_entrega: v.statusEntrega,
    ubicacion: v.ubicacion, observaciones: v.observaciones,
    factura_agencia: v.facturaAgencia || {}, factura_equipo: v.facturaEquipo || {},
    factura_gobierno: v.facturaGobierno || {}, acta_entrega: v.actaEntrega || {},
  });

export const deleteVehicle = (id) =>
  sb.from('vehicles').delete().eq('id', id);

export const saveCompany = (c, userId) =>
  sb.from('companies').upsert({ ...c, user_id: userId });

export const deleteCompany = (id) =>
  sb.from('companies').delete().eq('id', id);

export const saveConfig = (cfg, userId) =>
  sb.from('user_config').upsert({
    user_id: userId, group_name: cfg.groupName, currency: cfg.currency,
    checklist_template: cfg.checklistTemplate,
    custom_statuses: cfg.customStatuses || [],
    custom_product_types: cfg.customProductTypes || [],
  });

export const saveAuditLog = (entry, userId) =>
  sb.from('audit_logs').insert({
    id: entry.id, user_id: userId, user_name: entry.userName,
    action: entry.action, entity: entry.entity,
    entity_id: entry.entityId, details: entry.details,
  });
