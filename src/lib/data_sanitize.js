// data_sanitize.js — Fase 2A2: sanitización React profunda.
//
// Objetivo: aunque el dato completo siga llegando por Network/Supabase (eso
// es Fase 2E, no aquí), ningún componente accesible por empleado debe
// recibir por props/estado React objetos con datos financieros internos.
//
// Diseño (ver documentos de Fase 2 — Diagnóstico, Revisión 2/3/4 en
// /mnt/user-data/outputs de esas sesiones): archivo nuevo, separado de
// permissions.js a propósito — permissions.js responde "¿qué puede hacer
// este rol?", este archivo conoce la FORMA de un project/vehicle/doc/firma
// y transforma datos según esa respuesta. Importa getPermissions, nunca al
// revés — sin ciclo de imports.
//
// Regla de oro en TODA función de este archivo: admin siempre recibe el
// objeto original (o uno equivalente sin pérdida) — nunca se sanea para
// admin. Para empleado, lectura usa denylist explícita (más
// removeSensitiveKeysDeep como segunda capa); escritura usa ALLOWLIST
// explícita — nunca se hace spread completo de lo que manda el empleado.

import { getPermissions } from './permissions.js';

// ════════════════════════════════════════════════════════════════════
// LECTURA
// ════════════════════════════════════════════════════════════════════

// Shape real verificado en src/views/Cotizacion.js:50-63 — nada inventado.
// Fase 2F1A: separados en dos categorías reales, no una sola bolsa
// "financiero" — 'empleado' hoy es personal administrativo/operativo
// interno, no un vendedor externo (redefinición explícita de Santiago).
//
// ESTRATÉGICOS: la ESTRATEGIA de margen/utilidad en sí (cuánto se quiere
// ganar, cómo). Sigue admin-only sin excepción.
const COTIZACION_CAMPOS_ESTRATEGICOS = [
  'condicionesComerciales', 'condicionesLista',
  'pctIvaSat', 'pctIvaUtil', 'ivaSelectivo', 'soloEquipo', 'modoEquipo', 'margenEquipo',
  'montoGanar', 'retornos', 'fianzas',
];
// Partida — shape real Cotizacion.js:46 (makeP).
// COSTO_PROVEEDOR: costo de origen (lo que paga MSMS) -- ahora visible/
// editable para 'empleado' operativo (Fase 2F1A). precioLista se incluye
// aquí como precio base de referencia del catálogo, no una utilidad
// calculada -- si Santiago prefiere tratarlo distinto, es un ajuste de una
// línea aquí.
const PARTIDA_CAMPOS_COSTO_PROVEEDOR = ['costoMSMS', 'precioLista'];
// ESTRATEGICOS: la estrategia de precio de venta OFICIAL (cómo se calcula
// el margen) -- sigue admin-only. 'precioPropuesto' (Fase 2F1A, campo nuevo,
// ver PARTIDA_CAMPOS_PRECIO_PROPUESTO) es un borrador operativo separado,
// no reemplaza a estos.
const PARTIDA_CAMPOS_ESTRATEGICOS = ['modoPrecio', 'techo', 'utilidadDeseada', 'utilidadPct'];
// Fase 2F1A: precio de venta PROPUESTO/borrador -- campo nuevo, puramente
// operativo, nunca alimenta calc.js ni el cálculo oficial de utilidad/margen
// (Hallazgo B del diagnóstico: mostrar costo Y precio de venta permite
// inferir margen por resta -- aceptado explícitamente por Santiago, con el
// borrador/propuesto como mitigación: lo que el operativo ve NO es
// necesariamente el precio oficial final).
const PARTIDA_CAMPOS_PRECIO_PROPUESTO = ['precioPropuesto'];
// Equipo — shape real Cotizacion.js:103. Con la redefinición de rol, TODO
// este grupo pasa a ser "costo proveedor" -- costoConIVA es el costo en sí,
// llevaIVA/est/fechaCosto son metadata atada a ESE costo. Ya no queda ningún
// campo "estratégico" a nivel de equipo individual (el estratégico real,
// margenEquipo/modoEquipo, vive a nivel cotización, arriba).
const EQUIPO_CAMPOS_COSTO_PROVEEDOR = ['costoConIVA', 'llevaIVA', 'est', 'fechaCosto'];
const EQUIPO_CAMPOS_PRECIO_PROPUESTO = ['precioPropuesto'];

export function sanitizeCotizacionForRole(cotizacion, user) {
  if (getPermissions(user).verCostosInternos) return cotizacion; // admin: sin cambios, mismo objeto
  if (!cotizacion) return cotizacion;
  const perms = getPermissions(user);

  const limpia = { ...cotizacion };
  COTIZACION_CAMPOS_ESTRATEGICOS.forEach(campo => { delete limpia[campo]; });

  limpia.partidas = (cotizacion.partidas || []).map(p => {
    const pLimpia = { ...p };
    PARTIDA_CAMPOS_ESTRATEGICOS.forEach(campo => { delete pLimpia[campo]; });
    if (!perms.verCostosProveedor) PARTIDA_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { delete pLimpia[campo]; });
    if (!perms.verPreciosVentaPropuestos) PARTIDA_CAMPOS_PRECIO_PROPUESTO.forEach(campo => { delete pLimpia[campo]; });
    return pLimpia;
  });
  limpia.equipo = (cotizacion.equipo || []).map(e => {
    const eLimpio = { ...e };
    if (!perms.verCostosProveedor) EQUIPO_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { delete eLimpio[campo]; });
    if (!perms.verPreciosVentaPropuestos) EQUIPO_CAMPOS_PRECIO_PROPUESTO.forEach(campo => { delete eLimpio[campo]; });
    return eLimpio;
  });

  return limpia;
}

// Categorías de project.docs que pueden contener referencias financieras —
// verificado en src/lib/constants.js:41-45 (DOC_CATEGORIES), campo real
// confirmado: `category` (no `categoria`).
const DOC_CATEGORIAS_FINANCIERAS = ['Facturas', 'Propuesta económica', 'Garantías', 'Fianzas'];

export function sanitizeDocsForRole(docs, user) {
  if (getPermissions(user).verCostosInternos) return docs;
  return (docs || []).filter(d => !DOC_CATEGORIAS_FINANCIERAS.includes(d && d.category));
}

// Orden de Compra — shape real verificado en src/views/Projects.js:1175-1184
// (generarOC) y confirmado en src/views/Firmas.js:66-79 y Projects.js:756-760
// (reimprimir), donde SIEMPRE se reconstruye así:
//   costoMSMS: op.precioUnit || orig.costoMSMS || 0
// Es decir: `precioUnit` en cada partida de una OC ES el costo interno
// (costoMSMS), aunque no se llame igual -- confirmado con evidencia real,
// no supuesto. Shape completo de una OC:
//   { id, folio, fecha, proveedor, proveedorRfc, proveedorAddress,
//     partidas: [{ id, vehiculo, tipo, cantidad, precioUnit }],
//     condiciones: [{ id, label, value }] }
// `condiciones` son términos comerciales (forma de pago, anticipo, garantía,
// penalización, facturación...) -- mismo tipo de dato que
// COTIZACION_CAMPOS_ESTRATEGICOS a nivel cotización (condicionesComerciales/
// condicionesLista ya se tratan como estratégicas ahí, no como costo); mismo
// criterio aquí, se excluye el array completo para empleado. NOTA (Fase 2F1A):
// `precioUnit` (=costoMSMS de la OC) queda fuera de alcance de esta fase --
// Órdenes de Compra/documentos de proyecto se revisan en 2F2, no aquí.
const OC_CAMPOS_FINANCIEROS = ['condiciones'];
const OC_PARTIDA_CAMPOS_FINANCIEROS = ['precioUnit'];

export function sanitizeOrdenCompraForRole(orden, user) {
  if (getPermissions(user).verCostosInternos) return orden; // admin: sin cambios
  if (!orden) return orden;

  const limpia = { ...orden };
  OC_CAMPOS_FINANCIEROS.forEach(campo => { delete limpia[campo]; });

  limpia.partidas = (orden.partidas || []).map(p => {
    const pLimpia = { ...p };
    OC_PARTIDA_CAMPOS_FINANCIEROS.forEach(campo => { delete pLimpia[campo]; });
    return pLimpia;
  });

  return limpia;
}

export function sanitizeOrdenesCompraForRole(ordenes, user) {
  return (ordenes || []).map(o => sanitizeOrdenCompraForRole(o, user));
}

// Firmas — shape real verificado en src/lib/firmas.js:15-31 (nuevoDocFlujo):
//   { id, tipo, titulo, folio, proyectoId, creadoPor:{nombre,email},
//     responsable:{nombre,email}, estatus, archivoFirmado, comentarioRechazo,
//     ocId, docMembretadoId, empresaId, notas, historial }
// `proyecto` NO es parte de ese shape real -- se adjunta solo EN MEMORIA en
// src/views/Firmas.js:25 (`{...f, proyecto:p}`) para el render de esa vista.
// HALLAZGO (confirmado con escaneo real de preview, no solo simulado): las
// funciones de escritura en src/lib/firmas.js (aprobar/rechazar/reenviar/
// subirFirmadoDoc/vistoFinal/devolver) hacen `{ ...doc, ... }` -- si `doc`
// traía `.proyecto` pegado (porque venía de la lista ya construida en
// Firmas.js), ese snapshot COMPLETO del proyecto (con toda su cotización,
// ordenesCompra, flujo, y sus propias firmas) queda PERSISTIDO dentro de
// project.firmas[] en la base real, de forma recursiva
// (firmas[].proyecto.firmas[].proyecto...). No se corrige el origen aquí
// (src/views/Firmas.js / src/lib/firmas.js quedan fuera de alcance
// autorizado en este fix) -- se cierra en lectura con una ALLOWLIST
// explícita que nunca copia `proyecto`, sin importar qué tan anidado venga.
const FIRMA_CAMPOS_SEGUROS = [
  'id', 'tipo', 'titulo', 'folio', 'proyectoId', 'creadoPor', 'responsable',
  'estatus', 'archivoFirmado', 'comentarioRechazo', 'ocId', 'docMembretadoId',
  'empresaId', 'notas', 'historial',
];

export function sanitizeFirmaForRole(firma, user) {
  if (getPermissions(user).isAdmin) return firma; // admin: sin cambios
  if (!firma) return firma;
  const limpia = {};
  FIRMA_CAMPOS_SEGUROS.forEach(campo => {
    if (Object.prototype.hasOwnProperty.call(firma, campo)) limpia[campo] = firma[campo];
  });
  return limpia;
}

export function sanitizeFirmasForRole(firmas, user) {
  return (firmas || []).map(f => sanitizeFirmaForRole(f, user));
}

export function sanitizeProjectForRole(project, user) {
  if (getPermissions(user).verCostosInternos) return project; // admin: sin cambios
  if (!project) return project;
  const limpio = {
    ...project,
    cotizacion: sanitizeCotizacionForRole(project.cotizacion, user),
    docs: sanitizeDocsForRole(project.docs, user),
    // Fase 2E1 (Commit 2) -- hallazgo cerrado aquí: antes esta función NO
    // tocaba ordenesCompra, dejando pasar precioUnit (=costoMSMS real) sin
    // sanear. Ver sanitizeOrdenCompraForRole arriba.
    ordenesCompra: sanitizeOrdenesCompraForRole(project.ordenesCompra, user),
    // Fase 2E1 (fix adicional) -- cierra el hallazgo real de firmas[].proyecto
    // (ver sanitizeFirmaForRole arriba).
    firmas: sanitizeFirmasForRole(project.firmas, user),
    // project.flujo (src/views/Flujo.js:161) es 100% financiero (costos,
    // % de anticipo, días de crédito) -- misma sub-pestaña admin-only de
    // Operación desde Fase 2A6. El empleado no tiene ningún uso operativo
    // de esta estructura; se vacía completa en vez de redactar parcialmente
    // (evita dejar pasar valores de texto tipo "Retorno"/"Fianza" dentro de
    // bloques[].nom, que removeSensitiveKeysDeep no detectaría por ser
    // VALORES, no llaves).
    flujo: null,
  };
  // project.ocCondiciones (src/views/Projects.js:1186) es la última
  // condicion comercial usada al generar una OC (forma de pago, anticipo,
  // garantía...) -- mismo tipo de dato que OC_CAMPOS_FINANCIEROS a nivel de
  // cada orden de compra individual (ver sanitizeOrdenCompraForRole);
  // mismo criterio aquí, se elimina para empleado.
  delete limpio.ocCondiciones;
  return limpio;
}

export function sanitizeProjectsForRole(projects, user) {
  return (projects || []).map(p => sanitizeProjectForRole(p, user));
}

// Vehículo — shape real verificado en Vehicles.js (Fase 2A0). Fase 2F1B:
// separado en dos categorías reales con evidencia de código, no supuesto.
// Vehicles.js:190-199/207-220 confirma que precioUnitario/precioTotal/iva
// se derivan DIRECTAMENTE del subtotal/iva/total de facturaAgencia (la
// factura de COMPRA a la agencia) -- es decir, es el costo de origen que
// paga MSMS, no un precio de venta al cliente final (eso se calcula aparte,
// a nivel cotización, con campos que siguen 100% admin-only). facturaEquipo
// es la factura de proveedores de equipamiento -- mismo tipo de dato
// (costo de origen). Ambas se abren para 'empleado' (operativo) desde esta
// fase, igual que ya se hizo con partida.costoMSMS en Fase 2F1A.
const VEHICLE_CAMPOS_COSTO_PROVEEDOR = ['precioUnitario', 'precioTotal', 'iva', 'facturaAgencia', 'facturaEquipo'];
// ESTRATEGICOS: facturaIntermedia (venta ENTRE empresas, ej. Broking a
// SATHRI -- estructura interna) y facturaGobierno (factura de VENTA al
// cliente final) -- siguen admin-only, sin cambio.
const VEHICLE_CAMPOS_ESTRATEGICOS = ['facturaIntermedia', 'facturaGobierno'];

export function sanitizeVehicleForRole(vehicle, user) {
  if (getPermissions(user).verVehiculosFinancieros) return vehicle; // admin: sin cambios, mismo objeto
  if (!vehicle) return vehicle;
  const perms = getPermissions(user);
  const limpio = { ...vehicle };
  VEHICLE_CAMPOS_ESTRATEGICOS.forEach(campo => { delete limpio[campo]; });
  if (!perms.verCostosProveedor) VEHICLE_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { delete limpio[campo]; });
  return limpio;
}

export function sanitizeVehiclesForRole(vehicles, user) {
  return (vehicles || []).map(v => sanitizeVehicleForRole(v, user));
}

// Empresa (company) — shape real verificado en src/views/Companies.js:294
// (mapeo de campos del formulario) y :443 (empresa nueva): incluye
// { id, name, rfc, address, notario, notaria, escritura, fechaEscritura,
//   estado, objetoSocial, socios, regimen, cp, situacion,
//   documentosMembretados:[...] }. `objetoSocial` (objeto social notarial,
// texto libre) y `documentosMembretados` (cartas membretadas, texto libre)
// no son financieros en sentido estricto, pero HALLAZGO real (escaneo de
// preview, no supuesto): su texto libre puede mencionar términos como
// "facturación"/"fianza" según cómo esté redactado cada uno. Autorizado
// explícitamente excluirlos para empleado.
// NOTA para el resto del alcance de Fase 2E: hoy src/views/Companies.js NO
// tiene ningún gate de rol -- un empleado ya puede ver/editar objetoSocial
// y documentosMembretados completos vía la app en vivo (dbLoad, sin tocar).
// Este endpoint nuevo es el primero en restringirlo; no protege nada
// todavía en producción hasta que 2E2 reemplace dbLoad(), y aun entonces
// Companies.js seguiría sin gate visual -- quedaría pendiente como su
// propio hallazgo, fuera de alcance aquí.
const COMPANY_CAMPOS_RESTRINGIDOS = ['objetoSocial', 'documentosMembretados'];

export function sanitizeCompanyForRole(company, user) {
  if (getPermissions(user).isAdmin) return company; // admin: sin cambios
  if (!company) return company;
  const limpia = { ...company };
  COMPANY_CAMPOS_RESTRINGIDOS.forEach(campo => { delete limpia[campo]; });
  return limpia;
}

export function sanitizeCompaniesForRole(companies, user) {
  return (companies || []).map(c => sanitizeCompanyForRole(c, user));
}

// Fase 2E3B (corrección) — ESCRITURA server-side de empresa. ALLOWLIST
// explícita, no denylist: si en el futuro aparece un campo interno nuevo en
// companies, con denylist el empleado podría modificarlo sin que nadie lo
// note; con allowlist, cualquier campo no contemplado aquí queda preservado
// desde originalCompany por default, sin excepción. objetoSocial y
// documentosMembretados NO están en esta lista a propósito -- igual que
// cualquier campo futuro no incluido, siempre se preservan desde
// originalCompany, sin importar qué mande incoming.
const COMPANY_EMPLEADO_EDITABLE_FIELDS = [
  'id', 'name', 'nombre', 'razonSocial', 'nombreComercial', 'rfc', 'regimen',
  'address', 'domicilio', 'cp', 'ciudad', 'estado', 'situacion',
  'representanteLegal', 'cargoRepresentante', 'correosNotificacion',
  'correoContador', 'telefono', 'email', 'notario', 'notaria', 'escritura',
  'fechaEscritura', 'logo', 'color', 'activa', 'tipo', 'socios', 'baseDocs',
  'reformas',
];

export function sanitizeCompanyUpdateForRole(originalCompany, incomingCompany, user) {
  if (getPermissions(user).isAdmin) return incomingCompany; // admin: sin cambios, nunca se sanea

  const base = originalCompany ? { ...originalCompany } : { id: incomingCompany && incomingCompany.id };
  if (incomingCompany) {
    COMPANY_EMPLEADO_EDITABLE_FIELDS.forEach(campo => {
      if (Object.prototype.hasOwnProperty.call(incomingCompany, campo)) base[campo] = incomingCompany[campo];
    });
  }
  return base;
}

// Config — shape real verificado en src/lib/constants.js (DEFAULT_CONFIG:
// groupName, currency, checklistTemplate, customStatuses, customProductTypes)
// más `customProducts` (catálogo, agregado dinámicamente) y `ocSettings`
// (src/views/Projects.js:1034-1123: { direcciones:[...], condicionesDefault:[...] }).
// Solo `ocSettings.condicionesDefault` es el hallazgo real (default GLOBAL
// de términos comerciales de OC -- mismo tipo de dato que oc.condiciones/
// project.ocCondiciones, ya excluidos). El resto de config (catálogo,
// checklist, estatus/tipos personalizados) SÍ es necesario para empleado
// hoy (Catalog.js, Bases.js son accesibles para ambos roles) -- por eso NO
// se regresa `{}` completo como sugerencia de último recurso: hay
// evidencia concreta de que se rompería Catálogo/Bases para empleado sin
// necesidad, ya que el hallazgo real está acotado a ocSettings.
export function sanitizeConfigForRole(config, user) {
  if (getPermissions(user).isAdmin) return config; // admin: sin cambios
  if (!config) return config;
  const limpio = { ...config };
  delete limpio.ocSettings;
  return limpio;
}

// Fase 2E3A — ESCRITURA server-side de config. Mismo criterio de diseño que
// sanitizeProjectUpdateForRole/sanitizeVehicleUpdateForRole: ALLOWLIST
// explícita de lo poco que empleado puede tocar (exactamente lo que
// Catalog.js usa hoy -- confirmado con grep, nada inventado), y todo lo
// demás SIEMPRE parte de `originalConfig` -- que en el endpoint debe venir
// de un SELECT fresco en el servidor, nunca del estado del navegador.
// `Settings.js` (donde se edita groupName/currency/checklistTemplate/
// customStatuses/customProductTypes/ocSettings) ya es una vista admin-only
// (VISTAS_EMPLEADO no incluye 'settings') -- empleado nunca necesita editar
// esos campos, por eso no están en la allowlist.
const CONFIG_EMPLEADO_EDITABLE_FIELDS = ['customProducts', 'hiddenProducts'];

export function sanitizeConfigUpdateForRole(originalConfig, incomingConfig, user) {
  if (getPermissions(user).isAdmin) return incomingConfig; // admin: sin cambios, nunca se sanea

  // Base SIEMPRE parte del original real -- si no existiera aún (workspace
  // nuevo sin config guardada), la base es {} y los campos restringidos
  // simplemente no existen todavía (nunca inventados desde incoming).
  const base = originalConfig ? { ...originalConfig } : {};

  CONFIG_EMPLEADO_EDITABLE_FIELDS.forEach(campo => {
    if (incomingConfig && Object.prototype.hasOwnProperty.call(incomingConfig, campo)) {
      base[campo] = incomingConfig[campo];
    }
  });

  // Todo lo demás (ocSettings, checklistTemplate, customStatuses,
  // customProductTypes, notif, groupName, currency, y cualquier campo
  // futuro no contemplado) ya quedó preservado en `base` por el spread de
  // arriba -- se ignora explícitamente cualquier intento de tocarlo desde
  // incoming, sea que lo omita, lo mande null, o lo mande con datos falsos.
  return base;
}

// ── Defensa de segunda capa — captura campos futuros que las funciones
// explícitas de arriba no contemplen todavía. Se aplica DESPUÉS de la
// sanitización explícita, nunca en su lugar (lo explícito es más preciso y
// auditable; esto es un cinturón de seguridad extra). ──
// Fase 2F1A: separados en dos listas -- ya no una sola bolsa aplicada por
// igual a cualquier no-admin. 'empleado' (operativo) SÍ debe conservar
// costo/factura/precio -- solo lo verdaderamente estratégico se le sigue
// quitando aquí como segunda capa.
const PATRONES_ESTRATEGICOS = [
  /utilidad/i, /margen/i, /margin/i, /profit/i,
  /retorno/i, /fianza/i, /comision/i, /\bdpp\b/i, /financ/i, /tasa/i,
  /interes/i, /\bpago\b/i, /payment/i,
];
// Patrones de costo/factura -- YA NO se aplican a 'empleado' (operativo)
// desde Fase 2F1A. Se dejan preparados para un futuro rol sin acceso a
// costos (ej. 'vendedor', mencionado por Santiago pero no implementado
// todavía) -- agregar ese rol no requeriría rediseñar esta función, solo
// ajustar patronesParaRol() de abajo.
const PATRONES_COSTO = [
  /costo/i, /cost/i, /factura/i, /invoice/i, /precioUnitario/i, /precioTotal/i,
];
// Excepción explícita: montoEstimado ya es público (confirmado en fases
// anteriores — visible en 5 lugares distintos para empleado). No calza
// ningún patrón de todos modos; se deja explícito por claridad, no porque
// haga falta. fechaCosto NO se agrega como excepción a propósito — ya se
// excluye de raíz en sanitizeCotizacionForRole cuando aplica (empleado sin
// verCostosProveedor).
const EXCEPCIONES_DEFAULT = ['montoEstimado'];

// Fase 2F1A: qué lista de patrones aplica según el nivel real de acceso del
// usuario -- admin no pierde nada; 'empleado' (operativo, verCostosProveedor
// true) solo pierde lo estratégico; un futuro rol sin verCostosProveedor
// perdería también costo/factura/precio unitario.
function patronesParaRol(user) {
  const perms = getPermissions(user);
  if (perms.verCostosInternos) return [];
  if (perms.verCostosProveedor) return PATRONES_ESTRATEGICOS;
  return [...PATRONES_ESTRATEGICOS, ...PATRONES_COSTO];
}

export function removeSensitiveKeysDeep(obj, user, exceptions = EXCEPCIONES_DEFAULT) {
  const patrones = patronesParaRol(user);
  if (Array.isArray(obj)) return obj.map(item => removeSensitiveKeysDeep(item, user, exceptions));
  if (obj && typeof obj === 'object') {
    const resultado = {};
    Object.keys(obj).forEach(key => {
      if (exceptions.includes(key)) { resultado[key] = obj[key]; return; }
      if (patrones.some(p => p.test(key))) return; // se omite por completo
      resultado[key] = removeSensitiveKeysDeep(obj[key], user, exceptions);
    });
    return resultado;
  }
  return obj;
}

// ════════════════════════════════════════════════════════════════════
// ESCRITURA — ALLOWLIST explícita, nunca spread completo de lo que manda
// el empleado. Admin siempre regresa el incoming completo, sin cambios.
// ════════════════════════════════════════════════════════════════════

const PROJECT_OPERATIONAL_UPDATE_FIELDS = [
  'id', 'name', 'dependencia', 'nivelGobierno', 'municipio', 'company', 'numLicitacion',
  'status', 'tipoProcedimiento', 'productType', 'responsable', 'montoEstimado', 'probability',
  'description', 'observaciones',
  'fechaPublicacion', 'fechaAclaraciones', 'fechaPropuesta', 'fechaFallo', 'fechaContrato',
  'clienteEmpresaId', 'clienteRfc', 'clienteDomicilio', 'clienteCorreo', 'clienteTelefono',
  'notes', 'activity', 'preguntas', 'preparation',
  // 'docs' y 'firmas' NO están aquí — se manejan cada uno con su propia
  // función (sanitizeDocsUpdateForRole / sanitizeFirmasUpdateForRole),
  // porque una allowlist simple de "copiar tal cual" no basta para ninguno
  // de los dos (ver esas funciones abajo).
  // 'ordenesCompra' tampoco está aquí a propósito — no se verificó si algún
  // flujo de empleado lo modifica legítimamente; por default se preserva
  // del original (más seguro) hasta confirmar lo contrario.
  // 'cotizacion' se maneja aparte, campo por campo (ver abajo).
];

// Fase 2F3: 'estatusRevision' -- estatus operativo del flujo de aprobación
// (borrador/en_revision/cambios_solicitados/aprobada/rechazada). Es solo un
// eco local para feedback inmediato en la UI -- la fuente de verdad real
// del estatus es el inbox_item correspondiente (tabla separada, ver
// sql/2f3_inbox_items.sql), que CotizacionOperativa.js también consulta.
// No es un campo financiero ni estratégico, cualquier rol puede escribirlo.
const COTIZACION_OPERATIONAL_FIELDS = ['version', 'folio', 'municipio', 'fechaCotizacion', 'vigenciaDias', 'agenciaProveedor', 'vendedor', 'vendedorCorreo', 'estatusRevision'];
const PARTIDA_OPERATIONAL_FIELDS = ['id', 'activo', 'tipo', 'marca', 'modelo', 'ano', 'version', 'color', 'cantidad', 'vehiculoId', 'foto'];
const EQUIPO_OPERATIONAL_FIELDS = ['id', 'productoId', 'nombre', 'cat', 'marca', 'modelo', 'unidad', 'usar', 'vis', 'cnts', 'notas'];
const VEHICLE_OPERATIONAL_UPDATE_FIELDS = ['id', 'vin', 'marca', 'modelo', 'version', 'ano', 'color', 'numMotor', 'numInventario', 'statusEntrega', 'statusDocs', 'ubicacion', 'equipamiento', 'observaciones', 'actaEntrega'];

function copiarSoloPermitidos(origen, permitidos, base) {
  const resultado = { ...(base || {}) };
  permitidos.forEach(campo => {
    if (origen && Object.prototype.hasOwnProperty.call(origen, campo)) resultado[campo] = origen[campo];
  });
  return resultado;
}

// Fase 2F1A: ahora depende del nivel real de acceso del usuario, no de un
// único booleano admin/no-admin. Si tiene verCostosProveedor (empleado
// operativo, hoy cualquier rol autenticado), también puede escribir costo
// de origen/proveedor y su propio precio propuesto -- lo estratégico
// (PARTIDA_CAMPOS_ESTRATEGICOS) SIEMPRE viene del original, nunca del
// empleado, sin importar su nivel de acceso.
function construirPartidaOperativa(pEmpleado, pOriginal, user) {
  const perms = getPermissions(user);
  const permitidos = [
    ...PARTIDA_OPERATIONAL_FIELDS,
    ...(perms.verCostosProveedor ? PARTIDA_CAMPOS_COSTO_PROVEEDOR : []),
    ...(perms.verPreciosVentaPropuestos ? PARTIDA_CAMPOS_PRECIO_PROPUESTO : []),
  ];
  const nueva = copiarSoloPermitidos(pEmpleado, permitidos, pOriginal ? copiarSoloPermitidos(pOriginal, permitidos) : {});
  // Estratégicos: SIEMPRE del original, nunca de pEmpleado. Si pOriginal no
  // existe (partida nueva), quedan ausentes — nunca inventados ni aceptados.
  PARTIDA_CAMPOS_ESTRATEGICOS.forEach(campo => { if (pOriginal) nueva[campo] = pOriginal[campo]; });
  // Costo proveedor: si el usuario NO tiene verCostosProveedor (futuro rol
  // sin costos), se preserva del original en vez de perderse.
  if (!perms.verCostosProveedor) PARTIDA_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { if (pOriginal) nueva[campo] = pOriginal[campo]; });
  return nueva;
}

function construirEquipoOperativo(eEmpleado, eOriginal, user) {
  const perms = getPermissions(user);
  const permitidos = [
    ...EQUIPO_OPERATIONAL_FIELDS,
    ...(perms.verCostosProveedor ? EQUIPO_CAMPOS_COSTO_PROVEEDOR : []),
    ...(perms.verPreciosVentaPropuestos ? EQUIPO_CAMPOS_PRECIO_PROPUESTO : []),
  ];
  const nuevo = copiarSoloPermitidos(eEmpleado, permitidos, eOriginal ? copiarSoloPermitidos(eOriginal, permitidos) : {});
  if (!perms.verCostosProveedor) EQUIPO_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { if (eOriginal) nuevo[campo] = eOriginal[campo]; });
  return nuevo;
}

export function sanitizeDocsUpdateForRole(originalDocs, incomingDocs, user) {
  if (getPermissions(user).verCostosInternos) return incomingDocs; // admin: sin cambios
  const originalArr = originalDocs || [];
  if (!Array.isArray(incomingDocs)) return originalArr;
  // El empleado nunca vio los docs financieros (se filtraron en lectura) —
  // si se guardara solo lo entrante, esos documentos desaparecerían del
  // proyecto sin que el empleado supiera que existían. Se preservan.
  const financierosOriginales = originalArr.filter(d => DOC_CATEGORIAS_FINANCIERAS.includes(d && d.category));
  // Defensa: si intentó colar una categoría financiera nueva (ej. seleccionó
  // 'Facturas' en el formulario), se descarta.
  const operativos = incomingDocs.filter(d => !DOC_CATEGORIAS_FINANCIERAS.includes(d && d.category));
  return [...financierosOriginales, ...operativos];
}

// Exactamente los campos que subirFirmadoDoc/reenviar (las únicas acciones
// legítimas de empleado en Firmas.js) ya modifican. responsable, creadoPor,
// ocId, docMembretadoId, empresaId, folio, titulo, tipo, proyectoId,
// fechaCreacion se preservan siempre del original.
const FIRMA_EMPLEADO_EDITABLE_FIELDS = ['estatus', 'archivoFirmado', 'comentarioRechazo', 'historial'];

export function sanitizeFirmasUpdateForRole(originalFirmas, incomingFirmas, user) {
  if (getPermissions(user).isAdmin) return incomingFirmas; // admin: sin cambios
  const originalArr = originalFirmas || [];
  if (!Array.isArray(incomingFirmas)) return originalArr;

  const originalPorId = {};
  originalArr.forEach(f => { originalPorId[f.id] = f; });
  const idsEntrantes = new Set(incomingFirmas.map(f => f.id));

  const procesados = incomingFirmas
    // Descarta cualquier entrada "nueva" — verificado: ningún flujo de
    // empleado crea una entrada de firmas hoy (enviarAprobacion, la única
    // función que lo hace, vive enteramente dentro del tab Cotización,
    // admin-only).
    .filter(fEntrante => !!originalPorId[fEntrante.id])
    .map(fEntrante => {
      const base = { ...originalPorId[fEntrante.id] };
      FIRMA_EMPLEADO_EDITABLE_FIELDS.forEach(campo => {
        if (Object.prototype.hasOwnProperty.call(fEntrante, campo)) base[campo] = fEntrante[campo];
      });
      return base;
    });

  const preservados = originalArr.filter(f => !idsEntrantes.has(f.id)); // por si faltara alguna en incoming, no se pierde
  return [...preservados, ...procesados];
}

export function sanitizeProjectUpdateForRole(originalProject, incomingProject, user) {
  if (getPermissions(user).verCostosInternos) return incomingProject; // admin: sin cambios, nunca se sanea

  const base = originalProject ? { ...originalProject } : { id: incomingProject.id };
  PROJECT_OPERATIONAL_UPDATE_FIELDS.forEach(campo => {
    if (incomingProject && Object.prototype.hasOwnProperty.call(incomingProject, campo)) base[campo] = incomingProject[campo];
  });

  if (incomingProject && Object.prototype.hasOwnProperty.call(incomingProject, 'docs')) {
    base.docs = sanitizeDocsUpdateForRole(originalProject && originalProject.docs, incomingProject.docs, user);
  }
  if (incomingProject && Object.prototype.hasOwnProperty.call(incomingProject, 'firmas')) {
    base.firmas = sanitizeFirmasUpdateForRole(originalProject && originalProject.firmas, incomingProject.firmas, user);
  }

  const cotEntrante = incomingProject && incomingProject.cotizacion;
  const cotOriginal = (originalProject && originalProject.cotizacion) || {};

  if (cotEntrante) {
    // Construir cotizacion NUEVA desde cero, campo por campo — nunca
    // "...cotEntrante". Un campo inventado (cotizacion.calc, partida.margen,
    // equipo.precioTotal, lo que sea) simplemente nunca se copia, porque no
    // está en ninguna lista.
    const nuevaCot = copiarSoloPermitidos(cotEntrante, COTIZACION_OPERATIONAL_FIELDS, copiarSoloPermitidos(cotOriginal, COTIZACION_OPERATIONAL_FIELDS));
    // Estratégicos de nivel cotización: siempre del original, nunca aceptados del empleado.
    COTIZACION_CAMPOS_ESTRATEGICOS.forEach(campo => { nuevaCot[campo] = cotOriginal[campo]; });

    const idsPartidasEntrantes = new Set((cotEntrante.partidas || []).map(p => p.id));
    const partidasPreservadas = (cotOriginal.partidas || []).filter(p => !idsPartidasEntrantes.has(p.id));
    const partidasNuevas = (cotEntrante.partidas || []).map(pEmpleado =>
      construirPartidaOperativa(pEmpleado, (cotOriginal.partidas || []).find(p => p.id === pEmpleado.id), user)
    );
    nuevaCot.partidas = [...partidasPreservadas, ...partidasNuevas];

    const idsEquipoEntrantes = new Set((cotEntrante.equipo || []).map(e => e.id));
    const equipoPreservado = (cotOriginal.equipo || []).filter(e => !idsEquipoEntrantes.has(e.id));
    const equipoNuevo = (cotEntrante.equipo || []).map(eEmpleado =>
      construirEquipoOperativo(eEmpleado, (cotOriginal.equipo || []).find(e => e.id === eEmpleado.id), user)
    );
    nuevaCot.equipo = [...equipoPreservado, ...equipoNuevo];

    base.cotizacion = nuevaCot;
  } else if (originalProject && originalProject.cotizacion) {
    // Caso A: incoming NO trae cotizacion — preservar la original COMPLETA,
    // nunca crear una vacía ni borrarla.
    base.cotizacion = originalProject.cotizacion;
  }

  return base;
}

export function sanitizeVehicleUpdateForRole(originalVehicle, incomingVehicle, user) {
  if (getPermissions(user).verVehiculosFinancieros) return incomingVehicle; // admin: sin cambios

  const perms = getPermissions(user);
  const permitidos = [
    ...VEHICLE_OPERATIONAL_UPDATE_FIELDS,
    ...(perms.verCostosProveedor ? VEHICLE_CAMPOS_COSTO_PROVEEDOR : []),
  ];

  if (!originalVehicle) {
    // Caso: vehículo NUEVO. Empleado sí puede crear vehículos hoy (el
    // formulario no bloquea creación). Con verCostosProveedor (Fase 2F1B),
    // también puede capturar costo de origen/facturaAgencia/facturaEquipo
    // desde la creación -- los estratégicos (facturaIntermedia/
    // facturaGobierno) quedan ausentes, nunca inventados ni aceptados.
    return copiarSoloPermitidos(incomingVehicle, permitidos, { id: incomingVehicle.id });
  }

  // Vehículo existente — SIEMPRE parte del original. Los estratégicos
  // (facturaIntermedia/facturaGobierno) SIEMPRE vienen del original, nunca
  // de incomingVehicle, sin importar el nivel de acceso del usuario.
  const nuevo = copiarSoloPermitidos(incomingVehicle, permitidos, { ...originalVehicle });
  VEHICLE_CAMPOS_ESTRATEGICOS.forEach(campo => { nuevo[campo] = originalVehicle[campo]; });
  // Si no tiene verCostosProveedor (futuro rol sin costos), también se
  // preservan del original en vez de perderse.
  if (!perms.verCostosProveedor) VEHICLE_CAMPOS_COSTO_PROVEEDOR.forEach(campo => { nuevo[campo] = originalVehicle[campo]; });
  return nuevo;
}
