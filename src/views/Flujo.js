// Flujo.js — Calendario de Pagos a Proveedores (basado en Cotizador MSMS)
import { h, useState, useMemo } from '../lib/core.js';
import { fmt } from '../lib/utils.js';

// Bloques de proveedores según el cotizador MSMS
const BLOQUES_DEFAULT = [
  { id:'V',  nom:'Vehículo',                 diasCredito:60, pctAnticipo:50, diasAnticipo:0 },
  { id:'1',  nom:'Imagen Institucional',      diasCredito:60, pctAnticipo:50, diasAnticipo:0 },
  { id:'2',  nom:'Fierros',                   diasCredito:60, pctAnticipo:50, diasAnticipo:0 },
  { id:'3',  nom:'Luces / Sirenas',           diasCredito:60, pctAnticipo:0,  diasAnticipo:0 },
  { id:'4',  nom:'Video Seguridad',           diasCredito:60, pctAnticipo:50, diasAnticipo:0 },
  { id:'5',  nom:'Radio Comunicación',        diasCredito:60, pctAnticipo:0,  diasAnticipo:0 },
  { id:'6',  nom:'GPS',                       diasCredito:60, pctAnticipo:0,  diasAnticipo:0 },
  { id:'7',  nom:'Consumibles',               diasCredito:75, pctAnticipo:0,  diasAnticipo:0 },
  { id:'8',  nom:'Mano de Obra',              diasCredito:0,  pctAnticipo:0,  diasAnticipo:0 },
  { id:'9',  nom:'Traslados',                 diasCredito:0,  pctAnticipo:0,  diasAnticipo:0 },
  { id:'10', nom:'Costo Interno / Retornos',  diasCredito:0,  pctAnticipo:0,  diasAnticipo:0 },
  { id:'11', nom:'Fianzas e ISR',             diasCredito:0,  pctAnticipo:0,  diasAnticipo:0 },
  { id:'12', nom:'Otros / Especiales',        diasCredito:0,  pctAnticipo:0,  diasAnticipo:0 },
];

// Mapeo de categorías del catálogo a bloques
const CAT_A_BLOQUE = {
  '01': '1', '02': '2', '03': '3', '04': '4',
  '05': '5', '06': '6', '07': '7', '08': '8', '09': '9',
};

// Extrae costos desde la cotización del proyecto
function costosDesdeCotz(cot = {}) {
  const { partidas = [], equipo = [], retornos = [], fianzas = [] } = cot;
  const c = {};

  // Vehículo: costoMSMS (con IVA) × cantidad por partida activa
  c['V'] = partidas
    .filter(p => p.activo && (p.cantidad || 0) > 0)
    .reduce((s, p) => s + (p.costoMSMS || 0) * (p.cantidad || 0), 0);

  // Equipo por categoría: costoConIVA × suma de cantidades en todas las partidas
  equipo.filter(e => e.usar !== false).forEach(e => {
    const prefix = (e.cat || '').slice(0, 2);
    const bid = CAT_A_BLOQUE[prefix];
    if (!bid) return;
    const qty = (e.cnts || []).reduce((s, q) => s + (q || 0), 0);
    c[bid] = (c[bid] || 0) + (e.costoConIVA || 0) * qty;
  });

  // Retornos → bloque 10
  c['10'] = (retornos || []).reduce((s, r) => s + (r.monto || 0) * 1.16, 0);

  // Fianzas → bloque 11
  c['11'] = (fianzas || []).reduce((s, f) => s + (f.monto || 0) * 1.16, 0);

  return c;
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
}

function endOfMonth(dateStr, offsetMonths) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00');
  const eom = new Date(d.getFullYear(), d.getMonth() + offsetMonths + 1, 0);
  return eom.toISOString().slice(0, 10);
}

function startOfMonthPlus(dateStr, offsetMonths) {
  if (!dateStr) return null;
  const eom = new Date(endOfMonth(dateStr, offsetMonths - 1) + 'T12:00:00');
  const s = new Date(eom.getFullYear(), eom.getMonth(), eom.getDate() + 1);
  return s.toISOString().slice(0, 10);
}

function inRange(fecha, desde, hasta) {
  if (!fecha) return false;
  return fecha >= desde && fecha <= hasta;
}

function numInp(value, onChange, label) {
  return h('div', { style:{ display:'flex', flexDirection:'column', gap:3 } },
    h('label', { style:{ fontSize:11, color:'var(--t2)', fontWeight:500 } }, label),
    h('input', { type:'number', value:value||0, min:0,
      onChange:e=>onChange(Number(e.target.value)),
      style:{ width:'100%', padding:'6px 8px', fontSize:13, fontFamily:'tabular-nums' } }),
  );
}

export default function Flujo({ project, onUpdate }) {
  const saved   = project.flujo || {};
  const cot     = project.cotizacion || {};

  // ── Parámetros ──────────────────────────────────────────────
  const [fechaInicio,      setFechaInicio]      = useState(saved.fechaInicio      || project.fechaContrato || '');
  const [diasCobranza,     setDiasCobranza]     = useState(saved.diasCobranza     ?? 75);
  const [pctAntCliente,    setPctAntCliente]    = useState(saved.pctAntCliente    ?? 0);
  const [diasAntCliente,   setDiasAntCliente]   = useState(saved.diasAntCliente   ?? 0);

  // ── Bloques de proveedores ──────────────────────────────────
  // Costos actuales de la cotización
  const costosCotz = costosDesdeCotz(cot);
  const hayCotizacion = Object.values(costosCotz).some(v => v > 0);

  const [bloques, setBloques] = useState(() => {
    const base = saved.bloques ? saved.bloques : BLOQUES_DEFAULT;
    return base.map(b => ({
      ...b,
      // Si hay guardado previo usa ese costo, si no usa el de la cotización
      costo: saved.bloques ? (b.costo || 0) : (costosCotz[b.id] || 0),
    }));
  });

  // Recalcular desde cotización
  const recalcularDesdeCot = () => {
    setBloques(prev => prev.map(b => ({ ...b, costo: costosCotz[b.id] || 0 })));
  };

  const setBloque = (id, field, val) =>
    setBloques(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b));

  // ── Guardar ──────────────────────────────────────────────────
  const guardar = () => {
    onUpdate({ ...project, flujo: { fechaInicio, diasCobranza, pctAntCliente, diasAntCliente, bloques } });
  };

  // ── Cálculos del calendario ──────────────────────────────────
  const calendario = useMemo(() => bloques.map(b => {
    if (!b.costo) return { ...b, mtoAnticipo:0, fechaAnticipo:null, mtoFiniquito:0, fechaFiniquito:null };
    const mtoAnticipo  = b.costo * (b.pctAnticipo / 100);
    const mtoFiniquito = b.costo - mtoAnticipo;
    const fechaAnticipo  = fechaInicio ? addDays(fechaInicio, b.diasAnticipo) : null;
    const fechaFiniquito = fechaInicio ? addDays(fechaInicio, b.diasCredito)  : null;
    return { ...b, mtoAnticipo, fechaAnticipo, mtoFiniquito, fechaFiniquito };
  }), [bloques, fechaInicio]);

  // ── Cronograma mensual 6 meses ───────────────────────────────
  const meses = useMemo(() => {
    if (!fechaInicio) return [];
    return Array.from({ length: 6 }, (_, i) => {
      const desde = i === 0 ? fechaInicio : startOfMonthPlus(fechaInicio, i);
      const hasta = endOfMonth(fechaInicio, i);
      const label = new Date(hasta + 'T12:00:00').toLocaleDateString('es-MX', { month:'short', year:'numeric' });

      const anticipos  = calendario.filter(b => inRange(b.fechaAnticipo,  desde, hasta)).reduce((s,b) => s + b.mtoAnticipo, 0);
      const finiquitos = calendario.filter(b => inRange(b.fechaFiniquito, desde, hasta)).reduce((s,b) => s + b.mtoFiniquito, 0);
      const salidas    = anticipos + finiquitos;

      return { label, desde, hasta, anticipos, finiquitos, salidas };
    });
  }, [calendario, fechaInicio]);

  // Cobranza del cliente
  const ventaTotal = bloques.reduce((s, b) => s + (b.costo || 0), 0) * 1.2; // margen aprox
  const cobros = useMemo(() => meses.map(m => {
    let c = 0;
    if (pctAntCliente > 0 && fechaInicio) {
      const fAnt = addDays(fechaInicio, diasAntCliente);
      if (inRange(fAnt, m.desde, m.hasta)) c += ventaTotal * pctAntCliente / 100;
    }
    const fCob = addDays(fechaInicio, diasCobranza);
    if (fechaInicio && inRange(fCob, m.desde, m.hasta)) c += ventaTotal * (1 - pctAntCliente / 100);
    return c;
  }), [meses, diasCobranza, pctAntCliente, diasAntCliente, ventaTotal, fechaInicio]);

  // Flujo neto y acumulado
  const netos = meses.map((m, i) => cobros[i] - m.salidas);
  const acum  = netos.reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + v); return acc; }, []);
  const picoInv = Math.min(...acum.filter(v => v < 0), 0);

  const totalAnticipios = meses.reduce((s, m) => s + m.anticipos, 0);
  const totalFiniquitos = meses.reduce((s, m) => s + m.finiquitos, 0);
  const totalSalidas    = meses.reduce((s, m) => s + m.salidas,    0);
  const totalCobros     = cobros.reduce((s, c) => s + c, 0);
  const totalNeto       = netos.reduce((s, v) => s + v, 0);

  const tdN = { style:{ padding:'8px 10px', textAlign:'right', fontFamily:'tabular-nums', fontSize:12, borderBottom:'1px solid var(--b1)' } };
  const tdL = { style:{ padding:'8px 10px', fontSize:12, borderBottom:'1px solid var(--b1)', fontWeight:500 } };
  const th  = v => h('th', { style:{ padding:'8px 10px', fontSize:11, fontWeight:600, color:'var(--t2)', textAlign:'right', letterSpacing:'.4px', borderBottom:'2px solid var(--b2)', whiteSpace:'nowrap' } }, v);
  const thL = v => h('th', { style:{ padding:'8px 10px', fontSize:11, fontWeight:600, color:'var(--t2)', textAlign:'left',  letterSpacing:'.4px', borderBottom:'2px solid var(--b2)' } }, v);

  const fmtC = v => v ? fmt(v) : '—';
  const rowColor = v => v >= 0 ? 'var(--green)' : 'var(--red)';

  return h('div', null,

    // Header
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', null,
        h('div', { className:'page-title' }, 'Calendario de Pagos'),
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Flujo de inversión por proveedor — ' + (project.name || '')),
      ),
      h('div', { style:{ display:'flex', gap:8 } },
        hayCotizacion && h('button', { onClick:recalcularDesdeCot,
          style:{ fontSize:12, padding:'8px 14px', border:'1px solid var(--b2)', borderRadius:'var(--r)', background:'var(--bg2)', cursor:'pointer' } },
          '↺ Recalcular desde cotización'),
        h('button', { className:'bp', onClick:guardar }, 'Guardar cambios'),
      ),
    ),

    // A. Parámetros
    !hayCotizacion && h('div', { style:{ marginBottom:16, padding:'10px 14px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12 } },
      '⚠ No hay cotización cargada. Los costos se toman de la cotización del proyecto (pestaña Cotización MSMS). Puedes ingresarlos manualmente en la tabla de abajo.'
    ),
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:14 } }, 'A. Parámetros del flujo'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14 } },
        h('div', { style:{ display:'flex', flexDirection:'column', gap:3 } },
          h('label', { style:{ fontSize:11, color:'var(--t2)', fontWeight:500 } }, 'Fecha de inicio (firma/contrato)'),
          h('input', { type:'date', value:fechaInicio||'', onChange:e=>setFechaInicio(e.target.value),
            style:{ width:'100%', padding:'6px 8px', fontSize:13 } }),
        ),
        numInp(diasCobranza,   setDiasCobranza,   'Días de cobranza del cliente'),
        numInp(pctAntCliente,  setPctAntCliente,  '% Anticipo del cliente'),
        numInp(diasAntCliente, setDiasAntCliente, 'Días para recibir anticipo'),
      ),
    ),

    // B. Catálogo de proveedores
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:14 } }, 'B. Proveedores — condiciones de pago'),
      h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', fontSize:13, borderCollapse:'collapse' } },
          h('thead', null, h('tr', null,
            thL('Bloque'), thL('Proveedor'), th('Costo c/IVA'), th('Días crédito'), th('% Anticipo'), th('Días anticipo'),
          )),
          h('tbody', null, bloques.map(b =>
            h('tr', { key:b.id },
              h('td', { style:{ padding:'6px 10px', fontSize:11, color:'var(--t3)', borderBottom:'1px solid var(--b1)', fontWeight:600 } }, b.id),
              h('td', { style:{ padding:'6px 10px', fontSize:12, borderBottom:'1px solid var(--b1)' } }, b.nom),
              h('td', { style:{ padding:'4px 6px', borderBottom:'1px solid var(--b1)' } },
                h('input', { type:'number', value:b.costo||0, min:0, step:1000,
                  onChange:e=>setBloque(b.id,'costo',Number(e.target.value)),
                  style:{ width:120, textAlign:'right', fontFamily:'tabular-nums', fontSize:12, padding:'4px 6px' } }),
              ),
              h('td', { style:{ padding:'4px 6px', borderBottom:'1px solid var(--b1)' } },
                h('input', { type:'number', value:b.diasCredito||0, min:0,
                  onChange:e=>setBloque(b.id,'diasCredito',Number(e.target.value)),
                  style:{ width:70, textAlign:'right', fontFamily:'tabular-nums', fontSize:12, padding:'4px 6px' } }),
              ),
              h('td', { style:{ padding:'4px 6px', borderBottom:'1px solid var(--b1)' } },
                h('input', { type:'number', value:b.pctAnticipo||0, min:0, max:100,
                  onChange:e=>setBloque(b.id,'pctAnticipo',Number(e.target.value)),
                  style:{ width:60, textAlign:'right', fontFamily:'tabular-nums', fontSize:12, padding:'4px 6px' } }),
              ),
              h('td', { style:{ padding:'4px 6px', borderBottom:'1px solid var(--b1)' } },
                h('input', { type:'number', value:b.diasAnticipo||0, min:0,
                  onChange:e=>setBloque(b.id,'diasAnticipo',Number(e.target.value)),
                  style:{ width:70, textAlign:'right', fontFamily:'tabular-nums', fontSize:12, padding:'4px 6px' } }),
              ),
            )
          )),
        )
      ),
    ),

    // C. Calendario de pagos
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:14 } }, 'C. Calendario de pagos'),
      !fechaInicio && h('div', { style:{ fontSize:12, color:'var(--t2)', fontStyle:'italic' } }, 'Define la fecha de inicio para ver el calendario.'),
      fechaInicio && h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', fontSize:12, borderCollapse:'collapse' } },
          h('thead', null, h('tr', null,
            thL('Bloque'), thL('Proveedor'), th('Costo c/IVA'), th('Anticipo'), th('Fecha anticipo'), th('Finiquito'), th('Fecha finiquito'),
          )),
          h('tbody', null,
            calendario.filter(b => b.costo > 0).map(b =>
              h('tr', { key:b.id },
                h('td', { style:{ padding:'7px 10px', fontSize:11, color:'var(--t3)', borderBottom:'1px solid var(--b1)', fontWeight:600 } }, b.id),
                h('td', { ...tdL, style:{...tdL.style} }, b.nom),
                h('td', tdN, fmtC(b.costo)),
                h('td', { ...tdN, style:{...tdN.style, color:'var(--amber)' } }, fmtC(b.mtoAnticipo)),
                h('td', tdN, fmtDate(b.fechaAnticipo)),
                h('td', tdN, fmtC(b.mtoFiniquito)),
                h('td', tdN, fmtDate(b.fechaFiniquito)),
              )
            ),
            // Totales
            h('tr', { style:{ background:'var(--bg2)' } },
              h('td', { colSpan:2, style:{ padding:'8px 10px', fontSize:12, fontWeight:600 } }, 'TOTAL'),
              h('td', { ...tdN, style:{...tdN.style, fontWeight:600} }, fmt(calendario.reduce((s,b)=>s+b.costo,0))),
              h('td', { ...tdN, style:{...tdN.style, fontWeight:600, color:'var(--amber)'} }, fmt(calendario.reduce((s,b)=>s+b.mtoAnticipo,0))),
              h('td', null),
              h('td', { ...tdN, style:{...tdN.style, fontWeight:600} }, fmt(calendario.reduce((s,b)=>s+b.mtoFiniquito,0))),
              h('td', null),
            ),
          ),
        )
      ),
    ),

    // D. Cronograma mensual
    meses.length > 0 && h('div', { className:'card' },
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:14 } }, 'D. Cronograma mensual — flujo de inversión proyectado'),
      h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', fontSize:12, borderCollapse:'collapse' } },
          h('thead', null, h('tr', null,
            thL('Concepto'),
            ...meses.map(m => th(m.label)),
            th('Total'),
          )),
          h('tbody', null,
            // Anticipos
            h('tr', null, h('td', tdL, 'Salida: anticipos'), ...meses.map((m,i)=>h('td',{...tdN,style:{...tdN.style,color:'var(--amber)'}},fmtC(m.anticipos))), h('td',{...tdN,style:{...tdN.style,color:'var(--amber)',fontWeight:600}},fmtC(totalAnticipios))),
            // Finiquitos
            h('tr', null, h('td', tdL, 'Salida: finiquitos'), ...meses.map((m,i)=>h('td',{...tdN,style:{...tdN.style,color:'var(--amber)'}},fmtC(m.finiquitos))), h('td',{...tdN,style:{...tdN.style,color:'var(--amber)',fontWeight:600}},fmtC(totalFiniquitos))),
            // Total salidas
            h('tr', { style:{ background:'var(--bg2)' } }, h('td',{...tdL,style:{...tdL.style,fontWeight:700}},'TOTAL SALIDAS'), ...meses.map((m,i)=>h('td',{...tdN,style:{...tdN.style,fontWeight:700}},fmtC(m.salidas))), h('td',{...tdN,style:{...tdN.style,fontWeight:700}},fmtC(totalSalidas))),
            // Cobranza
            h('tr', null, h('td',tdL,'Entrada: cobranza cliente'), ...cobros.map((c,i)=>h('td',{...tdN,style:{...tdN.style,color:'var(--green)'}},fmtC(c))), h('td',{...tdN,style:{...tdN.style,color:'var(--green)',fontWeight:600}},fmtC(totalCobros))),
            // Flujo neto
            h('tr', { style:{ background:'var(--bg2)' } }, h('td',{...tdL,style:{...tdL.style,fontWeight:700}},'FLUJO NETO DEL MES'), ...netos.map((v,i)=>h('td',{...tdN,style:{...tdN.style,fontWeight:700,color:rowColor(v)}},fmtC(v))), h('td',{...tdN,style:{...tdN.style,fontWeight:700,color:rowColor(totalNeto)}},fmtC(totalNeto))),
            // Flujo acumulado
            h('tr', null, h('td',tdL,'Flujo acumulado'), ...acum.map((v,i)=>h('td',{...tdN,style:{...tdN.style,color:rowColor(v),fontWeight:500}},fmtC(v))),
              h('td', { ...tdN, style:{...tdN.style, fontWeight:700 } },
                picoInv < 0 ? h('span', { style:{color:'var(--red)',fontWeight:700} }, 'Pico: ' + fmt(picoInv)) : '—'
              ),
            ),
          ),
        )
      ),
      picoInv < 0 && h('div', { style:{ marginTop:12, padding:'8px 12px', background:'#FEF3C7', borderRadius:'var(--r)', fontSize:12 } },
        '⚠ Pico de inversión: ', h('strong', null, fmt(picoInv)), ' — capital necesario en el momento de mayor exposición.'
      ),
    ),
  );
}
