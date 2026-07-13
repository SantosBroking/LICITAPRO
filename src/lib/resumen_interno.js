// resumen_interno.js — Fase 2A5 v3: helper de datos para la Corrida
// Financiera Interna, organizada POR PARTIDA. Admin-only.
//
// Cambio de diseño respecto a v2: la corrida central ya NO combina
// vehículo/equipo entre partidas distintas (ej. Ford Explorer + Toyota
// Hilux en una sola cifra unificada). Cada partida activa tiene su
// propia corrida completa, con sus propios conceptos de costo y su
// propio equipo. El consolidado del proyecto es un resumen al final,
// nunca el cálculo central.
//
// Principio que se mantiene igual que v2: nunca se duplica una fórmula
// agregada que calcCotizacion ya calcula -- los totales consolidados
// (venta, costo, utilidad, margen) se toman tal cual de `calc`. El
// detalle POR PARTIDA (que calc.js no expone) se calcula aquí replicando
// la misma fórmula exacta que calc.js usa internamente.
//
// Asignación de retornos/fianzas por partida: se replica EXACTAMENTE la
// misma convención ya existente en el panel "Corrida financiera" de
// Cotizacion.js (costoTratoPart, líneas ~617-621) -- no se inventó una
// regla paralela, para que ambos paneles coincidan siempre:
//   - 'Monto fijo por unidad'  -> unitario x cantidad de esa partida.
//   - '% sobre venta c/IVA'    -> porcentaje sobre la venta c/IVA de esa partida.
//   - '% sobre venta s/IVA'    -> porcentaje sobre la venta s/IVA de esa partida.
//   - 'Monto fijo total'       -> prorrateo por participación de venta
//     de esa partida sobre la venta total del proyecto.
//
// Esta v3 se enfoca únicamente en la corrida financiera clara, sin que
// el reporte interprete, califique ni añada capas de interpretación
// adicionales -- solo los números desglosados por partida.

import { TODAY } from './utils.js';

const IVA = 0.16;

// Etiqueta de IVA para mostrar en la corrida -- nunca se inventa: si el
// dato no existe o no aplica (ej. vehículo base, que no tiene un campo
// llevaIVA real capturado por partida), se muestra "—".
function ivaLabel(llevaIVA) {
  if (llevaIVA === true) return 'Sí';
  if (llevaIVA === false) return 'No';
  return '—';
}

// Calcula el monto (c/IVA, antes de convertir a s/IVA con llevaIVA) que
// un item de retorno/fianza aporta AL PROYECTO COMPLETO -- necesario para
// el caso 'Monto fijo total', que se prorratea después.
function montoTotalProyecto(item, calc) {
  const val = Number(item.valor || 0);
  if (item.base === '% sobre venta c/IVA') return calc.ventaTotal * val / 100;
  if (item.base === '% sobre venta s/IVA') return calc.ventaSIVA * val / 100;
  if (item.base === 'Monto fijo por unidad') return val * (calc.unidades || 0);
  return val; // 'Monto fijo total'
}

// Calcula el monto (c/IVA) que corresponde específicamente a UNA partida,
// replicando exactamente costoTratoPart de Cotizacion.js.
function montoParaPartida(item, ventaPartidaCIVA, ventaPartidaSIVA, cantidadPartida, participacion, calc) {
  const val = Number(item.valor || 0);
  if (item.base === '% sobre venta c/IVA') return ventaPartidaCIVA * val / 100;
  if (item.base === '% sobre venta s/IVA') return ventaPartidaSIVA * val / 100;
  if (item.base === 'Monto fijo por unidad') return val * cantidadPartida;
  // 'Monto fijo total' -> prorrateo por participación de venta
  return montoTotalProyecto(item, calc) * participacion;
}

// ── Detalle por partida — corrida financiera completa de ESA partida,
// con sus propios conceptos de costo (vehículo, equipo por categoría real
// presente en ella, retornos/fianzas asignados) y su propio equipo. ──
export function buildPartidasDetalle(cot, calc) {
  const { partidas = [], equipo = [], soloEquipo = false, modoEquipo = 'margen', margenEquipo = 0.30, montoGanar = 0, retornos = [], fianzas = [] } = cot;

  let _totalUnidadesMonto = 0;
  if (soloEquipo && modoEquipo === 'monto') {
    partidas.filter(p => p.activo && p.cantidad > 0).forEach(p => { _totalUnidadesMonto += (p.cantidad || 0); });
  }
  const _ventaUnitMonto = (_totalUnidadesMonto > 0) ? (montoGanar || 0) / _totalUnidadesMonto : 0;

  const activas = partidas.filter(p => p.activo && p.cantidad > 0);
  const retActivos = retornos.filter(r => r.activo);
  const fianzActivas = fianzas.filter(f => f.activo);

  return activas.map(p => {
    const pi = parseInt((p.id || '').replace('P', '')) - 1;
    const qty = p.cantidad || 0;

    // ── Vehículo base de ESTA partida (nunca promediado con otras) ──
    const vehCIVA = soloEquipo ? 0 : (p.costoMSMS || 0) * qty;
    const vehSIVA = vehCIVA / (1 + IVA);
    const vehUnitSIVA = vehSIVA / qty;

    // ── Equipo de ESTA partida, agrupado por categoría real presente
    // aquí -- y expuesto también como detalle item por item (Sección 4). ──
    const equipoPartida = [];
    let eqSIVA_unit_total = 0;
    let ventaEqSIVA_unit = 0;
    equipo.filter(e => e.usar).forEach(e => {
      const cntPorUnidad = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      if (cntPorUnidad <= 0) return; // este equipo no aplica a esta partida
      const cantidadTotal = cntPorUnidad * qty;
      const costoUnitCIVA = e.costoConIVA || 0;
      const costoTotalCIVA = costoUnitCIVA * cantidadTotal;
      const costoUnitSIVA = e.llevaIVA ? costoUnitCIVA / (1 + IVA) : costoUnitCIVA;
      eqSIVA_unit_total += costoUnitSIVA * cntPorUnidad;
      if (modoEquipo !== 'monto') {
        const margen = (e.margenPropio != null) ? e.margenPropio : margenEquipo;
        ventaEqSIVA_unit += costoUnitSIVA * cntPorUnidad * (1 + margen);
      }
      equipoPartida.push({
        nombre: e.nombre,
        categoria: e.cat || 'Sin categoría',
        cantidadPorUnidad: cntPorUnidad,
        cantidadTotal,
        costoUnitario: costoUnitCIVA,
        costoTotal: costoTotalCIVA,
        costoTotalSIVA: e.llevaIVA ? costoTotalCIVA / (1 + IVA) : costoTotalCIVA,
        llevaIVA: e.llevaIVA,
        fechaCosto: e.fechaCosto || null,
        notas: e.notas || '',
      });
    });

    const costoUnitSIVA = vehUnitSIVA + eqSIVA_unit_total;
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
    const pvTotalCIVA = pvTotalSIVA * (1 + IVA);
    const participacion = calc.ventaTotal > 0 ? pvTotalCIVA / calc.ventaTotal : (1 / activas.length);

    // ── Conceptos de costo, en el orden pedido ──
    const conceptosCosto = [];
    if (!soloEquipo) {
      conceptosCosto.push({
        key: 'vehiculo_base', label: 'Vehículo base', tipo: 'vehiculo',
        unitario: vehUnitSIVA, total: vehSIVA, nota: '',
        // Sin campo llevaIVA real capturado por partida para el vehículo
        // -- no se inventa, se muestra "—" (a diferencia de equipo/
        // retornos/fianzas, que sí tienen ese campo real en el dato).
        iva: ivaLabel(undefined),
      });
    }
    // Equipo -- UNA LÍNEA POR ITEM REAL seleccionado (no agrupado por
    // categoría) -- se quiere ver exactamente qué equipo se eligió, no
    // solo la categoría. La categoría y la cantidad por unidad van en la
    // columna Nota, compactas.
    equipoPartida.forEach(e => {
      const notaCantidad = e.cantidadPorUnidad === 1 ? e.categoria : `${e.categoria} · ${e.cantidadPorUnidad} x unidad`;
      conceptosCosto.push({
        key: 'equipo_' + e.nombre, label: e.nombre, tipo: 'equipo',
        unitario: qty > 0 ? e.costoTotalSIVA / qty : 0, total: e.costoTotalSIVA,
        nota: notaCantidad, iva: ivaLabel(e.llevaIVA),
      });
    });
    // Retornos, un renglón por item real activo, asignado a esta partida
    retActivos.forEach(r => {
      const ventaPartidaCIVA = pvTotalCIVA, ventaPartidaSIVA = pvTotalSIVA;
      const montoCIVA = montoParaPartida(r, ventaPartidaCIVA, ventaPartidaSIVA, qty, participacion, calc);
      const montoSIVA = r.llevaIVA ? montoCIVA / (1 + IVA) : montoCIVA;
      conceptosCosto.push({
        key: 'retorno_' + r.id, label: 'Retorno: ' + (r.nombre || 'Sin nombre'), tipo: 'retorno',
        unitario: qty > 0 ? montoSIVA / qty : 0, total: montoSIVA, nota: r.base || '',
        iva: ivaLabel(r.llevaIVA),
      });
    });
    // Fianzas / ISR / costos financieros, mismo principio -- un renglón
    // por item real con su nombre real (así "ISR" aparece si existe).
    fianzActivas.forEach(f => {
      const ventaPartidaCIVA = pvTotalCIVA, ventaPartidaSIVA = pvTotalSIVA;
      const montoCIVA = montoParaPartida(f, ventaPartidaCIVA, ventaPartidaSIVA, qty, participacion, calc);
      const montoSIVA = f.llevaIVA ? montoCIVA / (1 + IVA) : montoCIVA;
      conceptosCosto.push({
        key: 'fianza_' + f.id, label: (f.nombre || 'Fianza'), tipo: 'fianza',
        unitario: qty > 0 ? montoSIVA / qty : 0, total: montoSIVA, nota: f.base || '',
        iva: ivaLabel(f.llevaIVA),
      });
    });

    const costoUnitarioTotalConcepto = conceptosCosto.reduce((s, c) => s + c.unitario, 0);
    const costoTotalConcepto = conceptosCosto.reduce((s, c) => s + c.total, 0);
    const utilidadUnitaria = pvUnitSIVA - costoUnitarioTotalConcepto;
    const utilidadTotal = utilidadUnitaria * qty;
    const margen = costoUnitarioTotalConcepto > 0 ? utilidadUnitaria / costoUnitarioTotalConcepto : 0;

    return {
      id: p.id,
      nombre: [p.marca, p.modelo].filter(Boolean).join(' ') || p.tipo || '(sin descripción)',
      descripcion: [p.marca, p.modelo].filter(Boolean).join(' ') || p.tipo || '(sin descripción)',
      cantidad: qty,
      ventaUnitaria: pvUnitSIVA,
      ventaTotal: pvTotalSIVA,
      costoUnitario: costoUnitarioTotalConcepto,
      costoTotal: costoTotalConcepto,
      utilidadUnitaria,
      utilidadTotal,
      margen,
      conceptosCosto,
      equipo: equipoPartida,
    };
  });
}

// ── Consolidado general del proyecto -- solo totales ya existentes en
// calc, sin ningún concepto desglosado (eso vive en cada partida). ──
export function buildConsolidado(calc) {
  return {
    unidadesTotales: calc.unidades || 0,
    ventaTotal: calc.ventaSIVA,
    costoTotal: calc.costoTotalSIVA,
    utilidadTotal: calc.utilBruta,
    margenGeneral: calc.margen,
  };
}

// ── Orquestador ──
export function buildResumenInternoData(project, cot, calc, companyObj, options = {}) {
  const partidas = buildPartidasDetalle(cot, calc);
  const consolidado = buildConsolidado(calc);

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
    partidas,
    consolidado,
    // IVA a utilidad -- condicionado al interruptor cot.ivaSelectivo, no
    // al valor resultante (ver diseño v3, Sección 6).
    ivaSelectivo: cot.ivaSelectivo !== false,
    ivaAlSAT: calc.ivaAlSAT || 0,
    ivaAUtilidad: calc.ivaAUtilidad || 0,
    ivaVenta: calc.ivaVenta || 0,
    ivaAcreditable: calc.ivaAcreditable || 0,
    ivaSobrante: calc.ivaSobrante || 0,
  };
}
