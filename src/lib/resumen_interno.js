// resumen_interno.js — Fase 2A5: helper de datos para el Resumen Interno /
// Corrida Financiera Desglosada. Admin-only (mismo alcance que
// printResumenInterno, que es quien consume este archivo).
//
// Principio central: este archivo NUNCA duplica una fórmula agregada que
// calcCotizacion ya calcula (venta total, costo total, utilidad, margen —
// todos se toman tal cual de `calc`). Lo que SÍ hace, porque calc.js no lo
// expone, es calcular el DETALLE por partida con la misma fórmula exacta
// que calc.js usa internamente (replicada línea por línea desde
// calc.js:67-123, no reinventada) — hoy esa misma fórmula estaba
// duplicada de forma independiente e inconsistente dentro de
// pdf_export.js; con este helper queda en un solo lugar.

import { TODAY } from './utils.js';

const IVA = 0.16;

// ── Semáforos — constantes editables, confirmadas con Santiago, no
// tomadas de ningún lugar preexistente del código (no había ninguna antes). ──
export const SEMAFORO_MARGEN_VERDE = 0.25;
export const SEMAFORO_MARGEN_AMARILLO = 0.10;
export const SEMAFORO_FECHA_COSTO_DIAS = 30;
export const SEMAFORO_RETORNOS_FIANZAS_AMARILLO = 0.10; // % de venta
export const SEMAFORO_RETORNOS_FIANZAS_ROJO = 0.20; // % de venta

function semaforoMargen(margen, utilidadNegativa) {
  if (utilidadNegativa) return 'rojo';
  if (margen >= SEMAFORO_MARGEN_VERDE) return 'verde';
  if (margen >= SEMAFORO_MARGEN_AMARILLO) return 'amarillo';
  return 'rojo';
}

function diasDesde(fechaStr) {
  if (!fechaStr) return null;
  const f = new Date(fechaStr);
  if (isNaN(f.getTime())) return null;
  return Math.floor((new Date() - f) / (1000 * 60 * 60 * 24));
}

// ── Detalle por partida — ÚNICA fuente de verdad para el cálculo por
// partida. Replica exactamente calc.js:67-123 (mismo costo/venta unitaria
// por partida), pero además EXPONE el detalle que calc.js no expone
// (calc.js solo acumula el agregado, nunca guarda el dato por partida). ──
export function buildPartidasDetalle(cot) {
  const { partidas = [], equipo = [], soloEquipo = false, modoEquipo = 'margen', margenEquipo = 0.30, montoGanar = 0 } = cot;

  let _totalUnidadesMonto = 0;
  if (soloEquipo && modoEquipo === 'monto') {
    partidas.filter(p => p.activo && p.cantidad > 0).forEach(p => { _totalUnidadesMonto += (p.cantidad || 0); });
  }
  const _ventaUnitMonto = (_totalUnidadesMonto > 0) ? (montoGanar || 0) / _totalUnidadesMonto : 0;

  return partidas.filter(p => p.activo && p.cantidad > 0).map(p => {
    const pi = parseInt((p.id || '').replace('P', '')) - 1;
    const qty = p.cantidad || 0;

    const vehCIVA = soloEquipo ? 0 : (p.costoMSMS || 0) * qty;
    const vehSIVA = vehCIVA / (1 + IVA);

    let eqCIVA_unit = 0, eqSIVA_unit = 0;
    let ventaEqSIVA_unit = 0;
    let equipoSinCosto = false;
    equipo.filter(e => e.usar).forEach(e => {
      const cnt = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      if (cnt > 0 && !(e.costoConIVA > 0)) equipoSinCosto = true;
      const cost = (e.costoConIVA || 0) * cnt;
      const costSIVA = e.llevaIVA ? cost / (1 + IVA) : cost;
      eqCIVA_unit += cost;
      eqSIVA_unit += costSIVA;
      if (modoEquipo !== 'monto') {
        const margen = (e.margenPropio != null) ? e.margenPropio : margenEquipo;
        ventaEqSIVA_unit += costSIVA * (1 + margen);
      }
    });
    const eqCIVA = eqCIVA_unit * qty;
    const eqSIVA = eqSIVA_unit * qty;

    const costoUnitSIVA = vehSIVA / qty + eqSIVA_unit;
    let pvUnitSIVA = 0;
    if (soloEquipo) {
      pvUnitSIVA = (modoEquipo === 'monto') ? _ventaUnitMonto : ventaEqSIVA_unit;
    } else if (p.modoPrecio === 'Techo presupuestal') {
      pvUnitSIVA = (p.techo || 0) > 0 ? (p.techo || 0) / (1 + IVA) / qty : costoUnitSIVA;
    } else if (p.modoPrecio === 'Utilidad deseada $') {
      pvUnitSIVA = costoUnitSIVA + (p.utilidadDeseada || 0);
    } else {
      pvUnitSIVA = costoUnitSIVA * (1 + (p.utilidadPct || 0));
    }

    const pvTotalSIVA = pvUnitSIVA * qty;
    const utilUnit = pvUnitSIVA - costoUnitSIVA;
    const utilTotal = utilUnit * qty;
    const margen = costoUnitSIVA > 0 ? utilUnit / costoUnitSIVA : 0;
    const sinCostoVehiculo = !soloEquipo && !(p.costoMSMS > 0);
    // Costo faltante siempre fuerza rojo, sin importar cómo luzca el
    // margen calculado (un costo en 0 puede maquillar un margen alto de
    // forma engañosa -- esta regla existe justamente para no confiar en
    // ese número cuando el dato de origen está incompleto).
    const semaforo = (sinCostoVehiculo || equipoSinCosto) ? 'rojo' : semaforoMargen(margen, utilUnit < 0);

    return {
      id: p.id,
      descripcion: [p.marca, p.modelo].filter(Boolean).join(' ') || p.tipo || '(sin descripción)',
      cantidad: qty,
      ventaUnitSIVA: pvUnitSIVA,
      costoUnitSIVA,
      utilUnit,
      ventaTotalSIVA: pvTotalSIVA,
      costoTotalSIVA: costoUnitSIVA * qty,
      utilTotal,
      margen,
      semaforo,
      alertas: [
        sinCostoVehiculo && 'Partida activa sin costo de vehículo',
        equipoSinCosto && 'Equipo asignado sin costo capturado',
      ].filter(Boolean),
    };
  });
}

// ── Detalle de equipo — un renglón por item de equipo, con costo total
// agregando todas las partidas donde se usa. IMPORTANTE: cnts[pi] es la
// cantidad de ese equipo POR VEHÍCULO en la partida pi (confirmado en
// calc.js:93, eqCIVA = eqCIVA_unit * qty) -- no es un total absoluto. Se
// multiplica por la cantidad de cada partida activa donde aplica, exacto
// como calc.js lo hace, para no repetir el bug que esta misma prueba
// (Sección de pruebas del commit 1) detectó durante el desarrollo.
export function buildEquipoDetalle(cot) {
  const { equipo = [], partidas = [] } = cot;
  const partidasActivas = partidas.filter(p => p.activo && p.cantidad > 0);
  return equipo.map(e => {
    let cntTotal = 0;
    partidasActivas.forEach(p => {
      const pi = parseInt((p.id || '').replace('P', '')) - 1;
      const cnt = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      cntTotal += cnt * (p.cantidad || 0);
    });
    const costoTotal = (e.costoConIVA || 0) * cntTotal;
    const dias = diasDesde(e.fechaCosto);
    return {
      id: e.id,
      nombre: e.nombre,
      categoria: e.cat,
      usar: !!e.usar,
      cantidadTotal: cntTotal,
      costoUnitCIVA: e.costoConIVA || 0,
      costoTotalCIVA: costoTotal,
      llevaIVA: !!e.llevaIVA,
      fechaCosto: e.fechaCosto || null,
      notas: e.notas || '',
      alertas: [
        e.usar && cntTotal > 0 && !(e.costoConIVA > 0) && 'Sin costo capturado',
        e.usar && dias != null && dias > SEMAFORO_FECHA_COSTO_DIAS && `Costo capturado hace ${dias} días`,
      ].filter(Boolean),
    };
  });
}

// ── Corrida financiera unitaria — el desglose por concepto que pediste.
// Venta se muestra aparte, nunca se suma dentro de los conceptos de costo. ──
export function buildCorridaUnitaria(cot, calc, partidasDetalle, equipoDetalle) {
  const unidades = calc.unidades || 0;
  const conceptos = [];

  // Vehículo base — promedio ponderado si hay varias partidas con costos
  // distintos (se declara así explícitamente, no se oculta el supuesto).
  if (calc.costoVehSIVA > 0 || partidasDetalle.some(p => p.cantidad > 0)) {
    conceptos.push({
      key: 'vehiculo_base',
      label: 'Vehículo base' + (partidasDetalle.length > 1 ? ' (promedio ponderado)' : ''),
      tipo: 'vehiculo',
      montoUnitario: unidades > 0 ? calc.costoVehSIVA / unidades : 0,
      montoTotal: calc.costoVehSIVA,
      fuente: 'partida_costo_base',
      alerta: partidasDetalle.some(p => p.alertas.includes('Partida activa sin costo de vehículo')),
      notas: '',
    });
  }

  // Equipo — un renglón por CATEGORÍA REAL presente en los datos, nunca
  // una lista fija inventada (no existen categorías como "Pintura" o
  // "Balizado" en el catálogo real, confirmado con grep -- si algún día
  // se agregan, aparecerán aquí automáticamente porque se agrupa por el
  // campo `cat` real, no por una lista fija).
  const equipoUsado = equipoDetalle.filter(e => e.usar && e.cantidadTotal > 0);
  const categorias = [...new Set(equipoUsado.map(e => e.categoria || 'Sin categoría'))];
  categorias.forEach(catNombre => {
    const items = equipoUsado.filter(e => (e.categoria || 'Sin categoría') === catNombre);
    const totalCIVA = items.reduce((s, e) => s + e.costoTotalCIVA, 0);
    const totalSIVA = items.reduce((s, e) => s + (e.llevaIVA ? e.costoTotalCIVA / (1 + IVA) : e.costoTotalCIVA), 0);
    conceptos.push({
      key: 'equipo_' + catNombre,
      label: catNombre,
      tipo: 'equipo',
      montoUnitario: unidades > 0 ? totalSIVA / unidades : 0,
      montoTotal: totalSIVA,
      fuente: 'equipo[].costoConIVA (categoría: ' + catNombre + ')',
      alerta: items.some(e => e.alertas.some(a => a.includes('Sin costo'))),
      notas: items.length + ' item(s)',
    });
  });

  // Retornos — un renglón POR ITEM real activo (así, si alguno se llama
  // "ISR" o cualquier otro nombre que el usuario haya capturado, aparece
  // con su nombre real -- no se inventa una fila fija).
  (cot.retornos || []).filter(r => r.activo).forEach(r => {
    const val = Number(r.valor || 0);
    let montoCIVA = 0;
    if (r.base === '% sobre venta c/IVA') montoCIVA = calc.ventaTotal * val / 100;
    else if (r.base === '% sobre venta s/IVA') montoCIVA = calc.ventaSIVA * val / 100;
    else if (r.base === 'Monto fijo total') montoCIVA = val;
    else if (r.base === 'Monto fijo por unidad') montoCIVA = val * unidades;
    const montoSIVA = r.llevaIVA ? montoCIVA / (1 + IVA) : montoCIVA;
    conceptos.push({
      key: 'retorno_' + r.id,
      label: 'Retorno: ' + (r.nombre || 'Sin nombre'),
      tipo: 'retorno',
      montoUnitario: unidades > 0 ? montoSIVA / unidades : 0,
      montoTotal: montoSIVA,
      fuente: 'retornos[]',
      alerta: false,
      notas: r.base || '',
    });
  });

  // Fianzas / ISR / costos financieros — mismo principio, un renglón por
  // item real, con su nombre real (aquí es donde "ISR" aparecería si el
  // usuario lo capturó, confirmado que existe como opción real en
  // Cotizacion.js, no como campo estructural aparte).
  (cot.fianzas || []).filter(f => f.activo).forEach(f => {
    const val = Number(f.valor || 0);
    let montoCIVA = 0;
    if (f.base === '% sobre venta c/IVA') montoCIVA = calc.ventaTotal * val / 100;
    else if (f.base === '% sobre venta s/IVA') montoCIVA = calc.ventaSIVA * val / 100;
    else if (f.base === 'Monto fijo total') montoCIVA = val;
    else if (f.base === 'Monto fijo por unidad') montoCIVA = val * unidades;
    const montoSIVA = f.llevaIVA ? montoCIVA / (1 + IVA) : montoCIVA;
    conceptos.push({
      key: 'fianza_' + f.id,
      label: (f.nombre || 'Fianza'),
      tipo: 'fianza',
      montoUnitario: unidades > 0 ? montoSIVA / unidades : 0,
      montoTotal: montoSIVA,
      fuente: 'fianzas[]',
      alerta: false,
      notas: f.base || '',
    });
  });

  const costoUnitarioTotal = conceptos.reduce((s, c) => s + c.montoUnitario, 0);
  const costoTotal = conceptos.reduce((s, c) => s + c.montoTotal, 0);
  const ventaUnitaria = unidades > 0 ? calc.ventaSIVA / unidades : 0;
  const utilidadUnitaria = ventaUnitaria - costoUnitarioTotal;
  const utilidadTotal = utilidadUnitaria * unidades;

  return {
    unidades,
    ventaUnitaria,
    costoUnitarioTotal,
    utilidadUnitaria,
    ventaTotal: calc.ventaSIVA,
    costoTotal,
    utilidadTotal,
    margen: costoUnitarioTotal > 0 ? utilidadUnitaria / costoUnitarioTotal : 0,
    conceptos,
    // DPP: no existe ningún campo con este nombre en el código hoy
    // (confirmado en el diagnóstico) -- se documenta como no disponible,
    // no se inventa ningún valor.
    dppDisponible: false,
    // Efecto fiscal -- informativo, NO se resta de la utilidad bruta aquí
    // (ya está incluido en utilNeta a nivel agregado, vía calc.ivaAUtilidad).
    efectoFiscal: {
      ivaAlSATTotal: calc.ivaAlSAT || 0,
      ivaAUtilidadTotal: calc.ivaAUtilidad || 0,
      ivaAUtilidadUnitario: unidades > 0 ? (calc.ivaAUtilidad || 0) / unidades : 0,
    },
  };
}

// ── Riesgos y pendientes ──
export function buildRiesgos(project, cot, calc, partidasDetalle, equipoDetalle, corrida) {
  const riesgos = [];
  const ventaPositiva = calc.ventaTotal > 0;

  partidasDetalle.forEach(p => {
    p.alertas.forEach(a => riesgos.push({ nivel: 'rojo', texto: `Partida ${p.id}: ${a}` }));
    if (p.margen < SEMAFORO_MARGEN_AMARILLO && p.utilUnit >= 0) {
      riesgos.push({ nivel: p.margen < 0 ? 'rojo' : 'amarillo', texto: `Partida ${p.id}: margen bajo (${(p.margen*100).toFixed(1)}%)` });
    }
  });

  equipoDetalle.forEach(e => {
    e.alertas.forEach(a => riesgos.push({ nivel: a.includes('Sin costo') ? 'rojo' : 'amarillo', texto: `Equipo "${e.nombre}": ${a}` }));
  });

  if (calc.utilNeta < 0) riesgos.push({ nivel: 'rojo', texto: 'Utilidad neta total negativa' });

  const pctRetFianzas = ventaPositiva ? (calc.totalRetornos + calc.totalFianzas) / calc.ventaTotal : 0;
  if (pctRetFianzas > SEMAFORO_RETORNOS_FIANZAS_ROJO) {
    riesgos.push({ nivel: 'rojo', texto: `Retornos+fianzas superan ${(pctRetFianzas*100).toFixed(1)}% de la venta` });
  } else if (pctRetFianzas > SEMAFORO_RETORNOS_FIANZAS_AMARILLO) {
    riesgos.push({ nivel: 'amarillo', texto: `Retornos+fianzas superan ${(pctRetFianzas*100).toFixed(1)}% de la venta` });
  }

  // Documentos/firmas pendientes -- cruce de solo lectura contra
  // project.firmas, si existe.
  (project.firmas || []).forEach(d => {
    if (d.estatus && d.estatus !== 'completado' && d.estatus !== 'firmado') {
      riesgos.push({ nivel: 'amarillo', texto: `Documento pendiente: ${d.titulo || d.tipo} (${d.estatus})` });
    }
  });

  riesgos.push({ nivel: 'info', texto: 'DPP: no disponible -- no existe un campo capturado para este concepto todavía.' });

  return riesgos;
}

// ── Semáforo general y decisión sugerida -- NO es una decisión mágica
// definitiva, es una recomendación interna basada en reglas explícitas. ──
export function buildSemaforoGeneral(calc, riesgos) {
  const tieneRojo = riesgos.some(r => r.nivel === 'rojo');
  const tieneAmarillo = riesgos.some(r => r.nivel === 'amarillo');
  const nivel = tieneRojo ? 'rojo' : (tieneAmarillo ? 'amarillo' : semaforoMargen(calc.margen, calc.utilNeta < 0));
  const decision = {
    verde: 'Aprobar / operación sana',
    amarillo: 'Revisar antes de avanzar',
    rojo: 'No avanzar sin ajuste/autorización',
  }[nivel];
  return { nivel, decision };
}

// ── Orquestador ──
export function buildResumenInternoData(project, cot, calc, companyObj, options = {}) {
  const partidasDetalle = buildPartidasDetalle(cot);
  const equipoDetalle = buildEquipoDetalle(cot);
  const corrida = buildCorridaUnitaria(cot, calc, partidasDetalle, equipoDetalle);
  const riesgos = buildRiesgos(project, cot, calc, partidasDetalle, equipoDetalle, corrida);
  const semaforo = buildSemaforoGeneral(calc, riesgos);

  // Partidas ordenadas por riesgo/impacto: rojo primero, luego menor
  // margen, luego mayor impacto económico (utilTotal absoluto).
  const ordenSemaforo = { rojo: 0, amarillo: 1, verde: 2 };
  const partidasOrdenadas = [...partidasDetalle].sort((a, b) => {
    if (ordenSemaforo[a.semaforo] !== ordenSemaforo[b.semaforo]) return ordenSemaforo[a.semaforo] - ordenSemaforo[b.semaforo];
    if (a.margen !== b.margen) return a.margen - b.margen;
    return Math.abs(b.utilTotal) - Math.abs(a.utilTotal);
  });

  return {
    base: {
      proyecto: project.name || '—',
      dependencia: project.dependencia || '—',
      empresa: (companyObj && (companyObj.nombreComercial || companyObj.razonSocial)) || '—',
      folio: cot.folio || '—',
      fecha: cot.fechaCotizacion || TODAY(),
      estatus: project.status || '—',
      unidades: calc.unidades || 0,
      vigenciaDias: cot.vigenciaDias || null,
    },
    kpis: {
      ventaTotalCIVA: calc.ventaTotal,
      ventaTotalSIVA: calc.ventaSIVA,
      costoTotalCIVA: calc.costoTotalCIVA,
      costoTotalSIVA: calc.costoTotalSIVA,
      utilBruta: calc.utilBruta,
      utilNeta: calc.utilNeta,
      margen: calc.margen,
      margenNeto: calc.margenNeto,
      utilidadPorUnidad: calc.unidades > 0 ? calc.utilNeta / calc.unidades : 0,
      costoPorUnidad: calc.unidades > 0 ? calc.costoTotalSIVA / calc.unidades : 0,
      precioPorUnidad: calc.unidades > 0 ? calc.ventaSIVA / calc.unidades : 0,
      totalRetornos: calc.totalRetornos,
      totalFianzas: calc.totalFianzas,
      pctEquipoSobreCostoTotal: calc.costoTotalCIVA > 0 ? calc.costoEqCIVA / calc.costoTotalCIVA : 0,
      pctRetFianzasSobreVenta: calc.ventaTotal > 0 ? (calc.totalRetornos + calc.totalFianzas) / calc.ventaTotal : 0,
    },
    corrida,
    partidas: partidasOrdenadas,
    equipo: equipoDetalle,
    riesgos,
    semaforo,
  };
}
