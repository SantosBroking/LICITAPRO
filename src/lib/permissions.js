// permissions.js — Fase 1C: permisos centralizados por usuario/rol.
// Reemplaza las repeticiones de `user?.role==='admin' || user?.role==='jefe'`
// que existían en 6 lugares distintos (App.js, Admin.js, Firmas.js, Projects.js x4).
// 'jefe' era un valor muerto: el CHECK de user_profiles (desde Fase 0B) solo
// permite 'admin'/'empleado' — nunca puede existir de verdad en la base.
//
// Diseñado para aceptar roles futuros sin tocar 6 archivos otra vez: agregar
// un rol nuevo (ej. 'finanzas') es editar esta función, no cada vista.
export function getPermissions(user) {
  const role = user?.role; // Fase 1: solo 'admin' | 'empleado' existen en la base
  const isAdmin = role === 'admin';
  return {
    isAdmin,
    verFinanciero: isAdmin,
    verCotizacionCompleta: isAdmin,
    borrarProyectos: isAdmin,
    borrarVehiculos: isAdmin,
    gestionarUsuarios: isAdmin,
    verConfiguracion: isAdmin,
    // Operación general — cualquier usuario autenticado activo (rol presente)
    operarProyectos: !!role,
    subirDocumentos: !!role,
    usarIA: !!role,
  };
}

// ── Navegación permitida por rol — fuente única, reutilizada en menú,
// deep-links, restauración de localStorage, y el guard de pre-render de
// App.js. No se duplica en ningún otro lugar. ──
//
// 'project_new' está en ambas listas: cualquier rol autenticado puede crear
// proyectos (operarProyectos en getPermissions ya lo confirma).
const VISTAS_ADMIN    = ['dashboard','projects','project_new','firmas','companies','catalog','reports','settings','audit','project_detail'];
const VISTAS_EMPLEADO = ['dashboard','projects','project_new','firmas','companies','catalog','project_detail'];

export function getAllowedViews(user) {
  return getPermissions(user).isAdmin ? VISTAS_ADMIN : VISTAS_EMPLEADO;
}
export function canView(view, user) {
  return getAllowedViews(user).includes(view);
}
export function sanitizeView(view, user) {
  return canView(view, user) ? view : 'dashboard';
}

// Espejo de PROJ_TABS (src/views/Projects.js) — NO se importa directo para
// evitar un ciclo de imports (Projects.js ya importa getPermissions de aquí).
// Si PROJ_TABS cambia en Projects.js, actualizar también esta lista.
const TODAS_LAS_PESTANAS_PROYECTO = ['info','cotizacion','flujo','bases','vehiculos','facturacion','docs','preguntas','borrador','activity'];
// Decisión verificada con código real (ver documento de diseño): cotizacion y
// facturacion muestran costos/montos reales de factura; flujo es el
// calendario de pagos a proveedores. 'borrador' se inspeccionó (buildBorradorHTML/
// buildBorradorText) y NO contiene costoMSMS/costoConIVA/utilidad/margen —
// solo compila montoEstimado (ya visible a empleados en otros 5 lugares),
// fechas, y composición de vehículos sin precios. Queda permitido.
const PESTANAS_ADMIN_ONLY = ['cotizacion', 'facturacion', 'flujo'];

export function getAllowedProjectTabs(user) {
  const admin = getPermissions(user).isAdmin;
  return admin ? TODAS_LAS_PESTANAS_PROYECTO : TODAS_LAS_PESTANAS_PROYECTO.filter(t => !PESTANAS_ADMIN_ONLY.includes(t));
}
export function canProjectTab(tab, user) {
  return typeof tab === 'string' && getAllowedProjectTabs(user).includes(tab);
}
export function sanitizeProjectTab(tab, user) {
  return canProjectTab(tab, user) ? tab : 'info';
}

// ── Sub-pestañas dentro de un módulo (ej. las 6 pestañas internas de
// Cotización: partidas/equipo/extras/corrida/unitario/agente). "Scope" es
// el identificador del módulo padre (hoy solo 'cotizacion' tiene sub-pestañas
// reales — confirmado con grep en Companies.js/ProjectForm: no tienen
// ninguna). Diseño extensible: agregar un scope nuevo es una entrada más en
// SUBTABS_POR_SCOPE, sin tocar el resto.
//
// Espejo de TABS (src/views/Cotizacion.js:26) — NO se importa directo (mismo
// riesgo de ciclo de imports que PROJ_TABS). Si TABS cambia en Cotizacion.js,
// actualizar también esta lista.
const SUBTABS_POR_SCOPE = {
  cotizacion: ['partidas', 'equipo', 'extras', 'corrida', 'unitario', 'agente'],
};
// Scopes cuyas sub-pestañas son TODAS admin-only. 'cotizacion' ya es
// admin-only como módulo completo (PESTANAS_ADMIN_ONLY) — esto es una
// segunda capa de defensa, no depende solo de que el padre esté bien.
const SCOPES_ADMIN_ONLY = ['cotizacion'];

export function getAllowedSubTabs(scope, user) {
  if (SCOPES_ADMIN_ONLY.includes(scope) && !getPermissions(user).isAdmin) return [];
  return SUBTABS_POR_SCOPE[scope] || [];
}
export function canSubTab(scope, tab, user) {
  return typeof tab === 'string' && getAllowedSubTabs(scope, user).includes(tab);
}
export function sanitizeSubTab(scope, tab, user) {
  const permitidas = getAllowedSubTabs(scope, user);
  if (permitidas.length === 0) return null; // el scope entero está prohibido para este usuario
  return canSubTab(scope, tab, user) ? tab : permitidas[0]; // cae a la primera permitida, no a un valor fijo
}
