// ─────────────────────────────────────────────────────────────
// calc.js  —  Lógica financiera de cotización MSMS
//
// Fórmulas extraídas directamente del COTIZADOR_MSMS_.xltx
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
 * Replica exactamente las fórmulas del COTIZADOR_MSMS_.xltx
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
  } = cot;

  // ── Por partida ───────────────────────────────────────────
  let ventaSIVA = 0, ivaVenta = 0;
  let costoVehCIVA = 0, costoVehSIVA = 0, ivaVeh = 0;
  let costoEqCIVA = 0,  costoEqSIVA = 0,  ivaEq = 0;
  let unidades = 0;

  partidas.filter(p => p.activo && p.cantidad > 0).forEach(p => {
    const pi = parseInt(p.id.replace('P', '')) - 1;
    const qty = p.cantidad || 0;

    // Costo vehículo
    const vehCIVA  = (p.costoMSMS || 0) * qty;
    const vehSIVA  = vehCIVA / (1 + IVA);
    const ivaV     = vehCIVA - vehSIVA;

    // Costo equipo para esta partida
    let eqCIVA_unit = 0, eqSIVA_unit = 0, ivaEq_unit = 0;
    equipo.filter(e => e.usar).forEach(e => {
      const cnt = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      const cost = (e.costoConIVA || 0) * cnt;
      const costSIVA = e.llevaIVA ? cost / (1 + IVA) : cost;
      const iva = cost - costSIVA;
      eqCIVA_unit += cost;
      eqSIVA_unit += costSIVA;
      ivaEq_unit  += iva;
    });
    const eqCIVA  = eqCIVA_unit * qty;
    const eqSIVA  = eqSIVA_unit * qty;
    const ivaEqP  = ivaEq_unit  * qty;

    // Precio de venta unitario s/IVA
    const costoUnitSIVA = vehSIVA / qty + eqSIVA_unit;
    let pvUnitSIVA = 0;
    if (p.modoPrecio === 'Techo presupuestal') {
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
  const ivaAlSAT       = ivaSobrante * (pctIvaSat || 0.5);
  const ivaAUtilidad   = ivaSobrante * (pctIvaUtil || 0.5);

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
    folio: folio || `MSMS-${yr}-${num}`,
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
