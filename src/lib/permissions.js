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

    // ── Fase 2A0: contención visible inmediata (Vehículos + PDF) ──
    verVehiculosFinancieros: isAdmin,   // columna PRECIO/FACTURAS, Metric, tab Facturación del vehículo
    verFacturasVehiculo: isAdmin,       // documentos de factura en DocsTab (no listar ni generar referencia)
    exportVehiculosCompleto: isAdmin,   // Excel con columnas financieras
    exportVehiculosOperativo: !!role,   // Excel sin columnas financieras — ambos roles
    generarPDFCliente: !!role,         // ambos roles — el PDF ya se corrigió en esta misma Fase 2A0
                                        // (printCotizacionCliente ya no incluye margen/utilidad/costos internos)
    generarPDFCompleto: isAdmin,        // printResumenInterno

    // ── Fase 2A1: permisos granulares (preparación para Cotización Operativa,
    // NO abre ninguna UI todavía — eso es Fase 2A4) ──
    verCotizacionOperativa: !!role,      // puerta de entrada futura — hoy sin efecto, Cotización sigue admin-only por el gate de tab existente
    editarCotizacionOperativa: !!role,   // ídem — sin efecto hasta 2A4
    editarPartidasOperativas: !!role,    // ídem
    verCostosInternos: isAdmin,          // costos internos de compra — usado por data_sanitize.js
    editarCostosInternos: isAdmin,       // alias de guardarFinancieros — mismo valor, nombre más específico donde ayude a leer el código
    verMargenUtilidad: isAdmin,
    editarMargenUtilidad: isAdmin,       // alias
    verRetornosEstrategicos: isAdmin,
    editarRetornosEstrategicos: isAdmin, // alias
    verCorridaFinanciera: isAdmin,
    verUnitarioFinanciero: isAdmin,
    aprobarCotizacion: isAdmin,          // reservado — no hay flujo de aprobación de cotización hoy
    guardarFinancieros: isAdmin,         // ya era el comportamiento real de maybeSaveFinancials, se nombra aquí

    usarIAOperativa: !!role,             // futuro chat sin datos financieros — sin efecto hasta 2A4/2C
    usarIAFinanciera: isAdmin,           // chat actual de CotizacionTab, sin cambios

    editarVehiculosFinancieros: isAdmin,
    descargarFacturasVehiculo: isAdmin,  // alias de verFacturasVehiculo — no hay hoy una vía de descarga distinta de "ver" que amerite valor propio
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
// buildBorradorText) y NO contiene costos internos/utilidad/margen —
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
