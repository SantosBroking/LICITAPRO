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

    // ── Fase 2F1A: Cotización operativa ampliada ──
    // Redefinición de alcance: 'empleado' hoy es personal administrativo/
    // operativo interno (no un vendedor externo) — SÍ debe ver y capturar
    // costos de proveedor/origen (costoMSMS, precioLista, costoConIVA de
    // equipo) y un precio de venta PROPUESTO/borrador (no el oficial). Sigue
    // sin ver utilidad/margen/montoGanar/retornos/fianzas/flujo/corrida
    // financiera -- esos permisos (verMargenUtilidad, verRetornosEstrategicos,
    // verCorridaFinanciera, verUnitarioFinanciero, arriba) NO cambian.
    // `verCostosInternos` tampoco cambia de significado (sigue == isAdmin,
    // lo usan Catalog.js/Firmas.js/Projects.js para fines distintos a este) --
    // estos son permisos NUEVOS y adicionales, no un reemplazo.
    verCostosProveedor: !!role,
    editarCostosProveedor: !!role,
    verPreciosVentaPropuestos: !!role,
    editarPreciosVentaPropuestos: !!role,
    verUtilidadMargen: isAdmin,
    verFlujoFinanciero: isAdmin,
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
// Fase 2A6 -- Navegación Esencial v1: de 10 tabs a 4 (resumen, cotizacion,
// operacion, documentos). 'info'/'borrador'/'activity' se fusionan dentro
// de 'resumen'; 'vehiculos'/'facturacion'/'flujo' dentro de 'operacion';
// 'bases'/'preguntas' se ocultan por ahora (sin borrar sus datos, sin
// desarrollar el futuro módulo de IA de bases). Ningún dato se pierde --
// solo cambia qué id de tab principal existe y qué componente monta cada
// uno; los datos siguen viviendo exactamente donde ya vivían
// (project.notes, project.preguntas, etc.).
const TODAS_LAS_PESTANAS_PROYECTO = ['resumen', 'cotizacion', 'operacion', 'docs'];
// 'operacion' ya NO es admin-only a nivel de tab completo -- Facturación y
// Flujo siguen siendo admin-only, pero ahora como sub-navegación INTERNA
// dentro de 'operacion' (mismo patrón que 'cotizacion' desde Fase 2A4:
// un tab, contenido distinto según rol). Empleado sigue viendo 'operacion'
// si tiene algo permitido ahí (hoy: Vehículos).
const PESTANAS_ADMIN_ONLY = [];

export function getAllowedProjectTabs(user) {
  const admin = getPermissions(user).isAdmin;
  return admin ? TODAS_LAS_PESTANAS_PROYECTO : TODAS_LAS_PESTANAS_PROYECTO.filter(t => !PESTANAS_ADMIN_ONLY.includes(t));
}
export function canProjectTab(tab, user) {
  return typeof tab === 'string' && getAllowedProjectTabs(user).includes(tab);
}
// Fase 2A6: mapeo de ids de tab viejos (localStorage previo a la
// reorganización) a su nueva ubicación real -- 'vehiculos'/'facturacion'/
// 'flujo' ahora viven DENTRO de 'operacion' (como sub-pestañas), así que
// un usuario con ese valor guardado debe caer en 'operacion', no en el
// fallback genérico 'resumen'. Esto es seguro para ambos roles: dentro de
// 'operacion', cada rol ya ve solo lo que le corresponde (empleado nunca
// ve facturacion/flujo, sin importar por qué id viejo haya entrado).
// Fase 2A6 (cierre): 'preguntas' y 'bases' ahora viven DENTRO de 'docs'
// (Expediente), como sub-pestañas -- ya no caen en el fallback genérico
// 'resumen'. Mismo criterio que 'vehiculos'/'facturacion'/'flujo' → 'operacion'.
const LEGACY_TAB_MAP = {
  info: 'resumen',
  borrador: 'resumen',
  activity: 'resumen',
  preguntas: 'docs',
  bases: 'docs',
  vehiculos: 'operacion',
  facturacion: 'operacion',
  flujo: 'operacion',
};
export function sanitizeProjectTab(tab, user) {
  if (canProjectTab(tab, user)) return tab;
  const mapeado = LEGACY_TAB_MAP[tab];
  return (mapeado && canProjectTab(mapeado, user)) ? mapeado : 'resumen';
}

// ── Sub-pestañas dentro de un módulo. "Scope" es el identificador del
// módulo padre. Fase 2A4: 'cotizacion' deja de ser "todo o nada" — admin
// sigue viendo las 6 sub-pestañas originales de CotizacionTab; empleado ve
// 3 nuevas, operativas, propias de CotizacionOperativa — nunca las
// financieras (extras/corrida/unitario/agente), sin importar qué se
// intente forzar por URL/localStorage.
//
// Fase 2A6: dentro de 'cotizacion' (admin), 'corrida' y 'unitario' se
// fusionan en una sola sub-pestaña 'finanzas' -- ya no son dos secciones
// separadas. Nuevo scope 'operacion': admin ve vehiculos/facturacion/
// flujo; empleado ve solo vehiculos (Facturación y Flujo siguen
// admin-only, ahora como sub-pestaña en vez de tab principal).
//
// Espejo de TABS (src/views/Cotizacion.js:26) para admin — NO se importa
// directo (mismo riesgo de ciclo de imports que PROJ_TABS). Si TABS cambia
// en Cotizacion.js, actualizar también esta lista.
// Fase 2A6 (cierre): nuevo scope 'docs' (Expediente) -- Bases, Documentos y
// Preguntas antes eran tabs principales sin gate de rol (PESTANAS_ADMIN_ONLY
// nunca los incluyó); se preserva exactamente ese mismo acceso, ahora como
// sub-pestañas: admin y empleado ven las 3 por igual.
const SUBTABS_POR_SCOPE_ADMIN = {
  cotizacion: ['partidas', 'equipo', 'extras', 'finanzas', 'agente'],
  operacion: ['vehiculos', 'facturacion', 'flujo'],
  docs: ['documentos', 'bases', 'preguntas'],
};
// Sub-pestañas de CotizacionOperativa.js (Fase 2A4) — ninguna financiera.
const SUBTABS_POR_SCOPE_EMPLEADO = {
  cotizacion: ['resumen', 'partidas', 'equipo'],
  operacion: ['vehiculos'],
  docs: ['documentos', 'bases', 'preguntas'],
};

export function getAllowedSubTabs(scope, user) {
  const admin = getPermissions(user).isAdmin;
  return (admin ? SUBTABS_POR_SCOPE_ADMIN[scope] : SUBTABS_POR_SCOPE_EMPLEADO[scope]) || [];
}
export function canSubTab(scope, tab, user) {
  return typeof tab === 'string' && getAllowedSubTabs(scope, user).includes(tab);
}
// Fase 2A6: 'corrida' y 'unitario' (sub-pestañas viejas de Cotización,
// ya fusionadas en 'finanzas') deben caer específicamente en 'finanzas'
// para quien tuviera ese valor guardado -- no en la primera sub-pestaña
// genérica de la lista.
const LEGACY_SUBTAB_MAP = {
  cotizacion: { corrida: 'finanzas', unitario: 'finanzas' },
  // Fase 2A6 (cierre): si algo quedó guardado como sub-pestaña 'docs'
  // (id viejo del tab principal), debe caer en 'documentos', no en la
  // primera sub-pestaña genérica de la lista.
  docs: { docs: 'documentos' },
};
export function sanitizeSubTab(scope, tab, user) {
  const permitidas = getAllowedSubTabs(scope, user);
  if (permitidas.length === 0) return null; // el scope entero está prohibido para este usuario
  if (canSubTab(scope, tab, user)) return tab;
  const mapeado = LEGACY_SUBTAB_MAP[scope] && LEGACY_SUBTAB_MAP[scope][tab];
  return (mapeado && canSubTab(scope, mapeado, user)) ? mapeado : permitidas[0];
}
