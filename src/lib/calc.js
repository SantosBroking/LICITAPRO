// ─────────────────────────────────────────────────────────────
// calc.js  —  Lógica financiera de cotización
//
// Fórmulas extraídas directamente del archivo de cálculo original
// Hoja "06 Corrida Financiera" (verificado celda por celda)
//
// COSTO TOTAL s/IVA = veh_sIVA + eq_sIVA + internos_sIVA + retornos_sIVA + fianzas_sIVA
// UTILIDAD BRUTA    = venta_sIVA − COSTO_TOTAL_sIVA
// UTILIDAD NETA     = BRUTA + IVA_a_utilidad
// MARGEN BRUTO      = BRUTA / COSTO_TOTAL_sIVA
// ─────────────────────────────────────────────────────────────
import { TODAY } from './utils.js';

const IVA = 0.16;

/**
 * Calcula la corrida financiera completa.
 * Replica exactamente las fórmulas del archivo de cálculo original
 */
export function calcCotizacion(cot) {
  const empty = {
    // Venta
    ventaTotal: 0, ventaSIVA: 0, ivaVenta: 0,
    // Costos
    costoVehCIVA: 0, costoVehSIVA: 0, ivaVeh: 0,
    costoEqCIVA: 0,  costoEqSIVA: 0,  ivaEq: 0,
    costoInternosSIVA: 0,
    costoRetornosSIVA: 0, ivaRetornos: 0,
    costoFianzasSIVA: 0,  ivaFianzas: 0,
    costoTotalSIVA: 0, costoTotalCIVA: 0,
    // Utilidad
    utilBruta: 0, utilNeta: 0,
    margen: 0, margenNeto: 0,
    // IVA
    ivaAcreditable: 0, ivaSobrante: 0,
    ivaAlSAT: 0, ivaAUtilidad: 0,
    // Retornos y fianzas
    totalRetornos: 0, totalFianzas: 0,
    // Misc
    unidades: 0,
  };

  if (!cot) return empty;

  const {
    partidas = [], equipo = [], retornos = [], fianzas = [],
    pctIvaSat = 0.5, pctIvaUtil = 0.5,
    ivaSelectivo = true,
    soloEquipo = false, margenEquipo = 0.30,
    modoEquipo = 'margen', montoGanar = 0,
  } = cot;

  // En modo "monto a ganar": la venta total ES el monto (los costos se ignoran).
  // Se reparte en partes iguales por unidad.
  let _totalUnidadesMonto = 0;
  if (soloEquipo && modoEquipo === 'monto') {
    partidas.filter(p => p.activo && p.cantidad > 0).forEach(p => { _totalUnidadesMonto += (p.cantidad || 0); });
  }
  const _ventaUnitMonto = (_totalUnidadesMonto > 0) ? (montoGanar || 0) / _totalUnidadesMonto : 0;

  // ── Por partida ───────────────────────────────────────────
  let ventaSIVA = 0, ivaVenta = 0;
  let costoVehCIVA = 0, costoVehSIVA = 0, ivaVeh = 0;
  let costoEqCIVA = 0,  costoEqSIVA = 0,  ivaEq = 0;
  let unidades = 0;

  // Fase 3F-1 -- caso "equipo sin vehículos" (ej. Chimalhuacán: solo se
  // vende equipamiento, no hay partidas de vehículo). El bucle ORIGINAL
  // de abajo (por partida de vehículo, usando cnts[pi]) se PRESERVA
  // INTACTO, byte por byte, sin ningún cambio -- solo se ejecuta cuando
  // SÍ hay al menos una partida activa. Cuando NO hay ninguna, se usa
  // esta rama nueva y separada, que calcula el equipo con
  // `cantidadGlobal` (cantidad capturada directamente, sin depender de
  // cnts[] por partida de vehículo). Nunca se mezclan ambos caminos en
  // la misma cotización -- o hay vehículos activos (camino de siempre) o
  // no los hay (camino nuevo), nunca los dos a la vez.
  const activePartidas = partidas.filter(p => p.activo && p.cantidad > 0);

  if (activePartidas.length === 0) {
    // ── Equipo sin vehículos -- costoVeh queda en 0 (no hay vehículo que
    // costear). unidades = suma de cantidadGlobal de todo el equipo
    // usado -- es la mejor aproximación disponible para "unidades"
    // cuando no hay un conteo de vehículos que sirva de base real (usado
    // solo por retornos/fianzas "Monto fijo por unidad").
    let totalUnidadesEquipo = 0;
    equipo.filter(e => e.usar).forEach(e => { totalUnidadesEquipo += Number(e.cantidadGlobal || 0); });
    const ventaUnitMontoEquipo = (soloEquipo && modoEquipo === 'monto' && totalUnidadesEquipo > 0)
      ? (montoGanar || 0) / totalUnidadesEquipo : 0;

    equipo.filter(e => e.usar).forEach(e => {
      const qty = Number(e.cantidadGlobal || 0);
      if (qty <= 0) return; // mismo criterio que cnts[pi]||0 -- sin cantidad, no aporta nada
      const cost = (e.costoConIVA || 0) * qty;
      const costSIVA = e.llevaIVA ? cost / (1 + IVA) : cost;
      const iva = cost - costSIVA;
      costoEqCIVA += cost;
      costoEqSIVA += costSIVA;
      ivaEq       += iva;
      unidades    += qty;

      // Precio de venta -- mismo criterio ya usado para equipo dentro
      // del bucle de vehículo: margen individual (margenPropio) o
      // general (margenEquipo), o monto fijo repartido entre unidades
      // de equipo (en vez de entre vehículos, que no existen aquí).
      let pvSIVA;
      if (soloEquipo && modoEquipo === 'monto') {
        pvSIVA = ventaUnitMontoEquipo * qty;
      } else {
        const margen = (e.margenPropio != null) ? e.margenPropio : margenEquipo;
        pvSIVA = costSIVA * (1 + margen);
      }
      ventaSIVA += pvSIVA;
      ivaVenta  += pvSIVA * IVA;
    });
    // costoVehCIVA/costoVehSIVA/ivaVeh quedan en 0 -- no hay vehículo que costear.
  } else {
  partidas.filter(p => p.activo && p.cantidad > 0).forEach(p => {
    const pi = parseInt(p.id.replace('P', '')) - 1;
    const qty = p.cantidad || 0;

    // Costo vehículo (0 en modo solo-equipo)
    const vehCIVA  = soloEquipo ? 0 : (p.costoMSMS || 0) * qty;
    const vehSIVA  = vehCIVA / (1 + IVA);
    const ivaV     = vehCIVA - vehSIVA;

    // Costo equipo para esta partida + precio de venta del equipo con su margen (modo solo-equipo)
    let eqCIVA_unit = 0, eqSIVA_unit = 0, ivaEq_unit = 0;
    let ventaEqSIVA_unit = 0; // venta del equipo (con margen) por unidad, en modo solo-equipo
    equipo.filter(e => e.usar).forEach(e => {
      const cnt = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      const cost = (e.costoConIVA || 0) * cnt;
      const costSIVA = e.llevaIVA ? cost / (1 + IVA) : cost;
      const iva = cost - costSIVA;
      eqCIVA_unit += cost;
      eqSIVA_unit += costSIVA;
      ivaEq_unit  += iva;
      // Precio de venta del equipo (solo para modo margen; en modo monto se usa el monto directo)
      if (modoEquipo !== 'monto') {
        const margen = (e.margenPropio != null) ? e.margenPropio : margenEquipo;
        ventaEqSIVA_unit += costSIVA * (1 + margen);
      }
    });
    const eqCIVA  = eqCIVA_unit * qty;
    const eqSIVA  = eqSIVA_unit * qty;
    const ivaEqP  = ivaEq_unit  * qty;

    // Precio de venta unitario s/IVA
    const costoUnitSIVA = vehSIVA / qty + eqSIVA_unit;
    let pvUnitSIVA = 0;
    if (soloEquipo) {
      // Solo equipo: monto directo por unidad, o equipo con margen
      pvUnitSIVA = (modoEquipo === 'monto') ? _ventaUnitMonto : ventaEqSIVA_unit;
    } else if (p.modoPrecio === 'Techo presupuestal') {
      pvUnitSIVA = (p.techo || 0) > 0 ? (p.techo || 0) / (1 + IVA) / qty : costoUnitSIVA;
    } else if (p.modoPrecio === 'Utilidad deseada $') {
      pvUnitSIVA = costoUnitSIVA + (p.utilidadDeseada || 0);
    } else { // % sobre costo
      pvUnitSIVA = costoUnitSIVA * (1 + (p.utilidadPct || 0));
    }

    const pvTotalSIVA = pvUnitSIVA * qty;
    const ivaV2       = pvTotalSIVA * IVA;

    ventaSIVA    += pvTotalSIVA;
    ivaVenta     += ivaV2;
    costoVehCIVA += vehCIVA;
    costoVehSIVA += vehSIVA;
    ivaVeh       += ivaV;
    costoEqCIVA  += eqCIVA;
    costoEqSIVA  += eqSIVA;
    ivaEq        += ivaEqP;
    unidades     += qty;
  });
  } // fin del else (bucle original de vehículo, sin ningún cambio de lógica)

  const ventaCIVA = ventaSIVA + ivaVenta;

  // ── Costos internos (bloque 08 mano de obra sin retornos) ─
  // En el Excel: bloque 10, filas 145-156 de la hoja Selección Equipo
  // En la app: equipo de categoría "08 Mano de obra" excluyendo premios
  // Por simplicidad: se incluye dentro del costoEq (ya calculado arriba)
  const costoInternosSIVA = 0; // Ya incluido en costoEqSIVA

  // ── Retornos ──────────────────────────────────────────────
  // Fórmula Excel: el retorno puede llevar IVA (acreditable)
  // Base de cálculo según tipo
  let totalRetornos = 0;
  let costoRetornosSIVA = 0;
  let ivaRetornos = 0;

  retornos.filter(r => r.activo).forEach(r => {
    const val = Number(r.valor || 0);
    let monto = 0;
    if      (r.base === '% sobre venta c/IVA')  monto = ventaCIVA * val / 100;
    else if (r.base === '% sobre venta s/IVA')  monto = ventaSIVA * val / 100;
    else if (r.base === 'Monto fijo total')      monto = val;
    else if (r.base === 'Monto fijo por unidad') monto = val * unidades;

    totalRetornos += monto;

    // Si el retorno lleva IVA, separar s/IVA e IVA acreditable
    if (r.llevaIVA) {
      const montoSIVA = monto / (1 + IVA);
      costoRetornosSIVA += montoSIVA;
      ivaRetornos       += monto - montoSIVA;
    } else {
      costoRetornosSIVA += monto;
    }
  });

  // ── Fianzas / financieros / ISR ───────────────────────────
  let totalFianzas = 0;
  let costoFianzasSIVA = 0;
  let ivaFianzas = 0;

  fianzas.filter(f => f.activo).forEach(f => {
    const val = Number(f.valor || 0);
    let monto = 0;
    if      (f.base === '% sobre venta c/IVA') monto = ventaCIVA * val / 100;
    else if (f.base === '% sobre venta s/IVA') monto = ventaSIVA * val / 100;
    else if (f.base === 'Monto fijo total')      monto = val;
    else if (f.base === 'Monto fijo por unidad') monto = val * unidades;

    totalFianzas += monto;

    if (f.llevaIVA) {
      const montoSIVA = monto / (1 + IVA);
      costoFianzasSIVA += montoSIVA;
      ivaFianzas       += monto - montoSIVA;
    } else {
      costoFianzasSIVA += monto;
    }
  });

  // ── COSTO TOTAL (fórmula C39 del Excel) ──────────────────
  // C39 = costoVehSIVA + costoEqSIVA + costoInternosSIVA + costoRetornosSIVA + costoFianzasSIVA
  const costoTotalSIVA = costoVehSIVA + costoEqSIVA + costoInternosSIVA + costoRetornosSIVA + costoFianzasSIVA;
  const costoTotalCIVA = costoVehCIVA + costoEqCIVA + totalRetornos + totalFianzas;

  // ── ESTRATEGIA IVA (fórmulas C46-C49 del Excel) ──────────
  // IVA acreditable = ivaVeh + ivaEq + ivaRetornos + ivaFianzas
  const ivaAcreditable = ivaVeh + ivaEq + ivaRetornos + ivaFianzas;
  const ivaSobrante    = Math.max(0, ivaVenta - ivaAcreditable);
  // IVA selectivo activado: reparte el sobrante entre SAT y utilidad.
  // Desactivado: todo el sobrante se paga al SAT (IVA natural 16%), nada va a utilidad.
  const ivaAlSAT       = ivaSelectivo ? ivaSobrante * (pctIvaSat || 0.5) : ivaSobrante;
  const ivaAUtilidad   = ivaSelectivo ? ivaSobrante * (pctIvaUtil || 0.5) : 0;

  // ── UTILIDAD (fórmulas C53-C54 del Excel) ────────────────
  // Utilidad bruta = venta_sIVA − costo_total_sIVA
  const utilBruta = ventaSIVA - costoTotalSIVA;
  const utilNeta  = utilBruta + ivaAUtilidad;

  // ── MÁRGENES ──────────────────────────────────────────────
  // Margen = utilidad / costo total s/IVA (como el Excel)
  const margen    = costoTotalSIVA > 0 ? utilBruta / costoTotalSIVA : 0;
  const margenNeto = costoTotalSIVA > 0 ? utilNeta  / costoTotalSIVA : 0;

  return {
    ventaTotal: ventaCIVA, ventaSIVA, ivaVenta,
    costoVehCIVA, costoVehSIVA, ivaVeh,
    costoEqCIVA,  costoEqSIVA,  ivaEq,
    costoInternosSIVA,
    costoRetornosSIVA, ivaRetornos,
    costoFianzasSIVA,  ivaFianzas,
    costoTotalSIVA, costoTotalCIVA,
    utilBruta, utilNeta,
    margen, margenNeto,
    ivaAcreditable, ivaSobrante, ivaAlSAT, ivaAUtilidad,
    ivaSelectivo,
    totalRetornos, totalFianzas,
    unidades,
  };
}

/** Crea una cotización vacía con folio generado */
export function newCotizacion(folio) {
  const yr  = new Date().getFullYear();
  const num = String(Math.floor(Math.random() * 900) + 100);
  const makePartida = (id, activo) => ({
    id, activo, tipo:'', marca:'', modelo:'', ano:yr, version:'',
    cantidad:0, costoMSMS:0, modoPrecio:'Utilidad deseada $',
    techo:0, utilidadDeseada:0, utilidadPct:0,
  });
  return {
    version:'V1',
    folio: folio || `COT-${yr}-${num}`,
    fechaCotizacion: TODAY(),
    vigenciaDias: 20,
    condicionesComerciales: 'Cotización válida por 20 días naturales.',
    agenciaProveedor: 'Grupo Surman',
    pctIvaSat: 0.5,
    pctIvaUtil: 0.5,
    partidas: [
      makePartida('P1', true),
      makePartida('P2', false),
      makePartida('P3', false),
      makePartida('P4', false),
      makePartida('P5', false),
    ],
    equipo: [],
    retornos: [],
    fianzas: [],
  };
}
