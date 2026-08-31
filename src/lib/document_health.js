// document_health.js — GO-LIVE-02: "salud documental" determinística.
//
// Objetivo (misión CONTROL TOWER — GO-LIVE LICITAPRO 01 + 02): distinguir
// ESTADO OPERATIVO (project.status, ej. 'cobrado') de COMPLETITUD
// DOCUMENTAL (¿existe evidencia real de que ese estado ocurrió?). Ejemplo
// real de aceptación: un proyecto puede estar 'cobrado' y al mismo tiempo
// tener documentación INCOMPLETA (sin fallo/contrato/factura/cobro
// localizados) -- este módulo NUNCA cambia project.status ni inventa
// evidencia; solo calcula, a partir de datos YA EXISTENTES en el proyecto
// (project.docs[], project.cotizacion, project.ordenesCompra[]), qué
// documentos se esperan para la etapa actual y cuáles de ellos están
// presentes.
//
// NO usa IA (requisito explícito de la misión) -- 100% reglas
// determinísticas basadas en rangos (rank) sobre STATUSES.
//
// v1 -- fuente de datos limitada a lo que LicitaPro ya conoce (docs/
// cotización/OC). NO sincroniza con Google Drive todavía (eso es una fase
// futura DRIVE-1/DRIVE-2) -- pero está diseñado para que esa futura
// integración alimente este MISMO motor (agregando señales nuevas a
// `detectarEvidencia`, sin rediseñar la severidad/matriz de abajo), en vez
// de construir un segundo motor paralelo.
//
// Este módulo es puro (sin efectos secundarios, sin red, sin fechas
// mutables más allá de lo que ya viene en `project`) para poder probarse
// con Node nativo (ver document_health.test.js) sin bundler ni DOM.

import { STATUSES } from './constants.js';

const RANK_POR_STATUS = {};
STATUSES.forEach((s, i) => { RANK_POR_STATUS[s.id] = i; });

// Estatus que representan un desenlace NEGATIVO (perdida) o neutro
// (cancelada) del procedimiento -- documentación "faltante" en estos casos
// nunca debe leerse como una alerta operativa real (no se va a "completar"
// un expediente de una licitación perdida/cancelada), así que su severidad
// máxima se limita a INFO, sin importar el rank que tuvieran al momento de
// perderse/cancelarse. 'cobrado' NO entra aquí -- es el desenlace positivo
// y sigue sujeto a la matriz completa.
const ESTATUS_DESENLACE_NO_EXIGIBLE = ['perdida', 'cancelada'];

export const SEVERIDAD = { INFO: 'INFO', PENDIENTE: 'PENDIENTE', CRITICO: 'CRITICO' };

// GO-LIVE-02 (corrección v2 -- CORRECCIÓN 3) -- LICITACIÓN vs VENTA
// PRIVADA. Discriminador inspeccionado en el código real (no inventado):
// `project.tipoOperacion` ya existe hoy con exactamente estos 4 valores
// (ver src/views/Projects.js, Inp 'Tipo de operación'):
//   'Licitación pública' (default), 'Venta privada', 'Compra interna', 'Otro'.
// Único criterio pedido por Control Tower: distinguir LICITACIÓN (procedimiento
// público) de VENTA PRIVADA -- 'Compra interna'/'Otro' NO se tocan en esta
// corrección (no fue solicitado, y agregar reglas para ellos sería inventar
// requisitos no pedidos) -- para ambos, el comportamiento se mantiene
// idéntico al de un procedimiento público (todos los renglones aplican
// según su rank, sin excepción), hasta que Control Tower pida explícitamente
// un criterio propio.
function esVentaPrivada(project) {
  return (project && project.tipoOperacion) === 'Venta privada';
}

// ── Señales de evidencia — TODAS derivadas de datos ya presentes en el
// proyecto, ninguna inventada. `docs` ya es el arreglo completo (pre-
// sanitización de rol -- ver nota en data_sanitize.js sobre por qué esto se
// calcula ANTES de sanitizeDocsForRole/sanitizeProjectForRole). ──
function tieneDocDeCategoria(docs, categorias) {
  return (docs || []).some(d => d && categorias.includes(d.category));
}

function hayCotizacionCapturada(cotizacion) {
  const cot = cotizacion || {};
  const partidas = (cot.partidas || []).filter(p => p && p.activo && (p.cantidad || 0) > 0);
  const equipo = (cot.equipo || []).filter(e => e && e.usar);
  const servicios = (cot.servicios || []).filter(s => s && s.usar);
  return partidas.length > 0 || equipo.length > 0 || servicios.length > 0;
}

// ── Los 8 renglones del checklist (orden fijo, exactamente el pedido en la
// misión: Bases, Propuesta, Fallo, Contrato, Órdenes de compra,
// Facturación, Entrega, Cobro). ──
//
// infoFrom / pendienteFrom / criticoFrom son RANKS de STATUSES (índice en
// el arreglo de arriba) a partir de los cuales el renglón se vuelve
// aplicable / pasa a PENDIENTE / pasa a CRÍTICO si sigue faltando. Antes de
// `infoFrom` el renglón ni siquiera se muestra (no aplica todavía). Estos
// umbrales son un juicio de producto explícito (documentado aquí, ajustable
// en una sola línea cada uno) -- NO son un cálculo financiero ni jurídico,
// y no dependen de precio/margen/utilidad en ningún punto.
const CHECKLIST = [
  {
    key: 'bases',
    label: 'Bases',
    infoFrom: RANK_POR_STATUS.prospecto,
    pendienteFrom: RANK_POR_STATUS.analisis,
    criticoFrom: RANK_POR_STATUS.aclaraciones,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Bases', 'Convocatoria']),
    // CORRECCIÓN 3: una venta privada no tiene "bases" de convocatoria --
    // no debe aparecer como obligatoria solo por avanzar de status.
    aplicaSoloSiLicitacionPublica: true,
  },
  {
    key: 'propuesta',
    label: 'Propuesta',
    infoFrom: RANK_POR_STATUS.analisis,
    pendienteFrom: RANK_POR_STATUS.aclaraciones,
    criticoFrom: RANK_POR_STATUS.presentada,
    detectar: (project) => hayCotizacionCapturada(project.cotizacion)
      || tieneDocDeCategoria(project.docs, ['Propuesta técnica', 'Propuesta económica']),
  },
  {
    key: 'fallo',
    label: 'Fallo',
    infoFrom: RANK_POR_STATUS.presentada,
    pendienteFrom: RANK_POR_STATUS.evaluacion,
    criticoFrom: RANK_POR_STATUS.ganada,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Fallo']),
    // CORRECCIÓN 3: una venta privada no tiene "fallo" de convocatoria --
    // no debe aparecer como obligatorio.
    aplicaSoloSiLicitacionPublica: true,
  },
  {
    key: 'contrato',
    label: 'Contrato',
    // CORRECCIÓN 3: se conserva SIN cambio para venta privada -- es un
    // criterio de completitud de expediente (¿hay un documento de
    // categoría 'Contrato' cargado?), nunca una conclusión de suficiencia
    // u obligatoriedad jurídica (ver FRONTERA JURÍDICA del governance:
    // DOCUMENTO LOCALIZADO ≠ VALIDEZ JURÍDICA CONFIRMADA). No se le agrega
    // ningún gate nuevo por tipoOperacion a propósito.
    infoFrom: RANK_POR_STATUS.evaluacion,
    pendienteFrom: RANK_POR_STATUS.ganada,
    criticoFrom: RANK_POR_STATUS.contrato,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Contrato']),
  },
  {
    key: 'ordenes_compra',
    label: 'Órdenes de compra',
    infoFrom: RANK_POR_STATUS.ganada,
    pendienteFrom: RANK_POR_STATUS.contrato,
    criticoFrom: RANK_POR_STATUS.entrega,
    detectar: (project) => (project.ordenesCompra || []).length > 0,
  },
  {
    key: 'facturacion',
    label: 'Facturación',
    infoFrom: RANK_POR_STATUS.contrato,
    pendienteFrom: RANK_POR_STATUS.entrega,
    criticoFrom: RANK_POR_STATUS.facturado,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Facturas']),
  },
  {
    key: 'entrega',
    label: 'Entrega',
    infoFrom: RANK_POR_STATUS.contrato,
    pendienteFrom: RANK_POR_STATUS.entrega,
    criticoFrom: RANK_POR_STATUS.facturado,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Comprobantes de entrega']),
  },
  {
    key: 'cobro',
    label: 'Cobro',
    infoFrom: RANK_POR_STATUS.entrega,
    pendienteFrom: RANK_POR_STATUS.facturado,
    criticoFrom: RANK_POR_STATUS.cobrado,
    detectar: (project) => tieneDocDeCategoria(project.docs, ['Comprobante de cobro']),
  },
];

// Calcula la severidad de UN renglón para un rank dado, ya sabiendo si el
// documento está presente. Nunca CRITICO/PENDIENTE si `presente` es true --
// en ese caso el renglón está resuelto (severidad null -- no es un
// pendiente, se muestra como ✓ en la UI).
function severidadRenglon(item, rank, presente, desenlaceNoExigible) {
  if (presente) return null;
  if (rank < item.infoFrom) return null; // todavía no aplica -- se oculta
  if (desenlaceNoExigible) return SEVERIDAD.INFO; // tope INFO en perdida/cancelada
  if (rank >= item.criticoFrom) return SEVERIDAD.CRITICO;
  if (rank >= item.pendienteFrom) return SEVERIDAD.PENDIENTE;
  return SEVERIDAD.INFO;
}

// computeDocumentHealth(project) -> {
//   items: [{ key, label, aplica, presente, severidad }...],  // 8 renglones, orden fijo
//   total: number,        // renglones que aplican (aplica === true)
//   completos: number,    // de los que aplican, cuántos están presentes
//   pendientes: [...],    // items con severidad != null, ordenados CRITICO > PENDIENTE > INFO
//   resumen: { CRITICO, PENDIENTE, INFO }, // conteo por severidad
// }
//
// Nunca modifica `project`. Nunca modifica project.status. Solo LEE
// project.docs/cotizacion/ordenesCompra/status.
export function computeDocumentHealth(project) {
  const status = project && project.status;
  const rank = Object.prototype.hasOwnProperty.call(RANK_POR_STATUS, status) ? RANK_POR_STATUS[status] : -1;
  const desenlaceNoExigible = ESTATUS_DESENLACE_NO_EXIGIBLE.includes(status);
  const ventaPrivada = esVentaPrivada(project);

  const items = CHECKLIST.map(item => {
    const presente = !!item.detectar(project || {});
    // CORRECCIÓN 3: en venta privada, un renglón marcado
    // aplicaSoloSiLicitacionPublica nunca aplica -- se oculta por completo
    // (aplica:false), sin importar el rank/status. No se inventa ningún
    // requisito nuevo, solo se desactiva lo que no corresponde a este
    // tipo de operación.
    const aplica = (item.aplicaSoloSiLicitacionPublica && ventaPrivada) ? false : rank >= item.infoFrom;
    const severidad = aplica ? severidadRenglon(item, rank, presente, desenlaceNoExigible) : null;
    return { key: item.key, label: item.label, aplica, presente, severidad };
  });

  const aplicables = items.filter(i => i.aplica);
  const completos = aplicables.filter(i => i.presente).length;

  const ordenSeveridad = { [SEVERIDAD.CRITICO]: 0, [SEVERIDAD.PENDIENTE]: 1, [SEVERIDAD.INFO]: 2 };
  const pendientes = items
    .filter(i => i.severidad)
    .sort((a, b) => ordenSeveridad[a.severidad] - ordenSeveridad[b.severidad]);

  const resumen = { CRITICO: 0, PENDIENTE: 0, INFO: 0 };
  pendientes.forEach(i => { resumen[i.severidad] += 1; });

  return { items, total: aplicables.length, completos, pendientes, resumen };
}
