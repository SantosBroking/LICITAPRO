// Flujo.js — Calendario de Pagos a Proveedores (rediseñado)
import { h, useState, useMemo, useEffect } from '../lib/core.js';
import { fmt } from '../lib/utils.js';
import { calcCotizacion } from '../lib/calc.js';

// Bloques de equipo (los de vehículo se generan dinámicamente por partida)
const BLOQUES_EQUIPO = [
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

const CAT_A_BLOQUE = { '01':'1','02':'2','03':'3','04':'4','05':'5','06':'6','07':'7','08':'8','09':'9' };

function costosDesdeCotz(cot = {}) {
  const { partidas = [], equipo = [], retornos = [], fianzas = [] } = cot;
  const c = {};
  const activas = partidas.filter(p => p.activo && (p.cantidad||0) > 0);
  // Un bloque de vehículo POR PARTIDA activa (V1, V2, ...)
  activas.forEach(p => {
    const pnum = (p.id||'').replace('P','');
    c['V'+pnum] = (p.costoMSMS||0) * (p.cantidad||0);
  });
  // Equipo: costoConIVA × cantidad-en-la-partida × unidades-de-la-partida (igual que la corrida)
  equipo.filter(e => e.usar !== false).forEach(e => {
    const bid = CAT_A_BLOQUE[(e.cat||'').slice(0,2)];
    if (!bid) return;
    let totalCIVA = 0;
    activas.forEach(p => {
      const pi = parseInt((p.id||'').replace('P','')) - 1;
      const cnt = (e.cnts && e.cnts[pi] != null) ? Number(e.cnts[pi]) : 0;
      totalCIVA += (e.costoConIVA||0) * cnt * (p.cantidad||0);
    });
    c[bid] = (c[bid]||0) + totalCIVA;
  });
  c['10'] = (retornos||[]).reduce((s,r) => s+(r.monto||0)*1.16, 0);
  c['11'] = (fianzas||[]).reduce((s,f) => s+(f.monto||0)*1.16, 0);
  return c;
}

// Construye la lista de bloques: un bloque de vehículo por partida + bloques de equipo fijos
function construirBloques(cot = {}) {
  const partidas = (cot.partidas||[]).filter(p => p.activo && (p.cantidad||0) > 0);
  const bloquesVeh = partidas.length > 0
    ? partidas.map(p => {
        const pnum = (p.id||'').replace('P','');
        const nombreVeh = [p.marca, p.modelo].filter(Boolean).join(' ') || ('Vehículo '+p.id);
        return { id:'V'+pnum, nom:'🚗 '+p.id+' · '+nombreVeh, diasCredito:60, pctAnticipo:50, diasAnticipo:0 };
      })
    : [{ id:'V1', nom:'🚗 Vehículo', diasCredito:60, pctAnticipo:50, diasAnticipo:0 }];
  return [...bloquesVeh, ...BLOQUES_EQUIPO];
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + (days||0));
  return d.toISOString().slice(0,10);
}
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short' });
}
function endOfMonth(dateStr, off) {
  const d = new Date(dateStr + 'T12:00:00');
  return new Date(d.getFullYear(), d.getMonth()+off+1, 0).toISOString().slice(0,10);
}
function startOfMonthPlus(dateStr, off) {
  const eom = new Date(endOfMonth(dateStr, off-1) + 'T12:00:00');
  return new Date(eom.getFullYear(), eom.getMonth(), eom.getDate()+1).toISOString().slice(0,10);
}
const inRange = (f, a, b) => f && f >= a && f <= b;

// Input numérico que SÍ se puede vaciar (no fuerza 0)
function NumCell({ value, onChange, width=110, money=false, suffix='' }) {
  const [txt, setTxt] = useState(value === 0 || value == null ? '' : String(value));
  const [focus, setFocus] = useState(false);
  // Editando: muestra el número crudo. Sin foco: muestra con separador de miles.
  const fmtMiles = n => { const num = Number(n); return isNaN(num) ? '' : num.toLocaleString('es-MX'); };
  const display = focus ? txt : (txt === '' ? '' : fmtMiles(txt));
  return h('input', {
    type:'text', inputMode:'numeric', value:display,
    placeholder:'0',
    onFocus: () => setFocus(true),
    onBlur:  () => setFocus(false),
    onChange:e => {
      const raw = e.target.value.replace(/[^0-9.]/g,'');
      setTxt(raw);
      onChange(raw === '' ? 0 : Number(raw));
    },
    style:{
      width, textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13,
      padding:'7px 10px', border:'1px solid var(--b2)', borderRadius:8,
      background:'var(--bg1)', color:'var(--t1)',
    },
  });
}

export default function Flujo({ project, onUpdate }) {
  const saved = project.flujo || {};
  const cot   = project.cotizacion || {};
  const iniContrato = saved.fechaInicio || project.fechaContrato || '';

  const [fechaInicio,    setFechaInicio]    = useState(saved.fechaInicio    || project.fechaContrato || '');
  const [diasCobranza,   setDiasCobranza]   = useState(saved.diasCobranza   ?? 75);
  const [pctAntCliente,  setPctAntCliente]  = useState(saved.pctAntCliente  ?? 0);
  const [diasAntCliente, setDiasAntCliente] = useState(saved.diasAntCliente ?? 0);

  const costosCotz = costosDesdeCotz(cot);
  const hayCotizacion = Object.values(costosCotz).some(v => v > 0);
  const bloquesActuales = construirBloques(cot);

  const [bloques, setBloques] = useState(() => {
    // El COSTO siempre se toma de la cotización (en vivo). Solo las condiciones (días, %) se recuerdan de lo guardado.
    return bloquesActuales.map(b => {
      const prev = saved.bloques ? saved.bloques.find(x => x.id === b.id) : null;
      return {
        ...b,
        costo: costosCotz[b.id] || 0,
        diasCredito:  prev ? prev.diasCredito  : b.diasCredito,
        pctAnticipo:  prev ? prev.pctAnticipo  : b.pctAnticipo,
        diasAnticipo: prev ? prev.diasAnticipo : b.diasAnticipo,
        fechaAnticipoManual: prev ? (prev.fechaAnticipoManual||'') : (b.fechaAnticipoManual||''),
      };
    });
  });
  const [recalcKey, setRecalcKey] = useState(0);
  const [vistaCron, setVistaCron] = useState('mes');
  const [expandAnt, setExpandAnt] = useState(false);

  const setBloque = (id, f, v) => setBloques(prev => prev.map(b => b.id===id ? {...b,[f]:v} : b));
  const recalcular = () => { setBloques(construirBloques(cot).map(b => { const prev = bloques.find(x=>x.id===b.id); return {...b, costo: costosCotz[b.id]||0, diasCredito: prev?.diasCredito??b.diasCredito, pctAnticipo: prev?.pctAnticipo??b.pctAnticipo, diasAnticipo: prev?.diasAnticipo??b.diasAnticipo, fechaAnticipoManual: (prev?.fechaAnticipoManual)||(b.fechaAnticipoManual||'')}; })); setRecalcKey(k=>k+1); };

  // Mantener los costos sincronizados con la cotización en vivo (sin perder las condiciones que el usuario editó)
  const costosFirma = JSON.stringify(costosDesdeCotz(cot));
  useEffect(() => {
    const nuevosCostos = costosDesdeCotz(cot);
    const estructura = construirBloques(cot);
    setBloques(prev => estructura.map(b => {
      const ant = prev.find(x => x.id === b.id);
      return {
        ...b,
        costo: nuevosCostos[b.id] || 0,
        diasCredito:  ant ? ant.diasCredito  : b.diasCredito,
        pctAnticipo:  ant ? ant.pctAnticipo  : b.pctAnticipo,
        diasAnticipo: ant ? ant.diasAnticipo : b.diasAnticipo,
        fechaAnticipoManual: ant ? (ant.fechaAnticipoManual||'') : (b.fechaAnticipoManual||''),
      };
    }));
    setRecalcKey(k => k + 1);
  }, [costosFirma]);
  const guardar = () => onUpdate({ ...project, flujo:{ fechaInicio, diasCobranza, pctAntCliente, diasAntCliente, bloques } });

  // Calendario
  const calendario = useMemo(() => bloques.map(b => {
    const mtoAnticipo  = (b.costo||0) * ((b.pctAnticipo||0)/100);
    const mtoFiniquito = (b.costo||0) - mtoAnticipo;
    return {
      ...b, mtoAnticipo, mtoFiniquito,
      // Si hay una fecha manual elegida, se usa esa; si no, se calcula desde la fecha de inicio
      fechaAnticipo:  b.fechaAnticipoManual ? b.fechaAnticipoManual : (fechaInicio ? addDays(fechaInicio, b.diasAnticipo) : null),
      fechaFiniquito: fechaInicio ? addDays(fechaInicio, b.diasCredito)  : null,
    };
  }), [bloques, fechaInicio]);

  const costoTotal = bloques.reduce((s,b) => s+(b.costo||0), 0);

  // Cronograma: por mes (6 meses) o por semana (12 semanas)
  const meses = useMemo(() => {
    if (!fechaInicio) return [];
    // El cronograma debe empezar en la fecha más temprana de todos los eventos (anticipos manuales incluidos)
    const todasFechas = [fechaInicio];
    calendario.forEach(b => { if (b.fechaAnticipo) todasFechas.push(b.fechaAnticipo); if (b.fechaFiniquito) todasFechas.push(b.fechaFiniquito); });
    const fechaMin = todasFechas.filter(Boolean).sort()[0] || fechaInicio;

    if (vistaCron === 'semana') {
      // Semanas desde la fecha más temprana; alinear al lunes de esa semana
      const base = new Date(fechaMin + 'T12:00:00');
      const diaSem = (base.getDay() + 6) % 7; // 0 = lunes
      const inicioSemana = addDays(fechaMin, -diaSem);
      return Array.from({length:14}, (_,i) => {
        const desde = addDays(inicioSemana, i*7);
        const hasta = addDays(inicioSemana, i*7 + 6);
        const d = new Date(desde+'T12:00:00');
        const antBloques = calendario.filter(b=>inRange(b.fechaAnticipo, desde,hasta) && b.mtoAnticipo>0);
        return {
          label: 'Sem '+(i+1)+' · '+d.toLocaleDateString('es-MX',{day:'2-digit',month:'short'}),
          desde, hasta,
          anticipos:  antBloques.reduce((s,b)=>s+b.mtoAnticipo,0),
          detalleAnt: antBloques.map(b=>({ nom:b.nom, monto:b.mtoAnticipo })),
          finiquitos: calendario.filter(b=>inRange(b.fechaFiniquito,desde,hasta)).reduce((s,b)=>s+b.mtoFiniquito,0),
        };
      }).map(m => ({...m, salidas:m.anticipos+m.finiquitos}));
    }
    return Array.from({length:7}, (_,i) => {
      const desde = i===0 ? fechaMin : startOfMonthPlus(fechaMin, i);
      const hasta = endOfMonth(fechaMin, i);
      const antBloques = calendario.filter(b=>inRange(b.fechaAnticipo, desde,hasta) && b.mtoAnticipo>0);
      return {
        label: new Date(hasta+'T12:00:00').toLocaleDateString('es-MX',{month:'short',year:'2-digit'}),
        desde, hasta,
        anticipos:  antBloques.reduce((s,b)=>s+b.mtoAnticipo,0),
        detalleAnt: antBloques.map(b=>({ nom:b.nom, monto:b.mtoAnticipo })),
        finiquitos: calendario.filter(b=>inRange(b.fechaFiniquito,desde,hasta)).reduce((s,b)=>s+b.mtoFiniquito,0),
      };
    }).map(m => ({...m, salidas:m.anticipos+m.finiquitos}));
  }, [calendario, fechaInicio, vistaCron]);

  const ventaTotal = costoTotal * 1.2;
  const cobros = useMemo(() => meses.map(m => {
    let c = 0;
    if (pctAntCliente>0 && fechaInicio && inRange(addDays(fechaInicio,diasAntCliente), m.desde,m.hasta))
      c += ventaTotal * pctAntCliente/100;
    if (fechaInicio && inRange(addDays(fechaInicio,diasCobranza), m.desde,m.hasta))
      c += ventaTotal * (1-pctAntCliente/100);
    return c;
  }), [meses,diasCobranza,pctAntCliente,diasAntCliente,ventaTotal,fechaInicio]);

  const netos = meses.map((m,i) => cobros[i]-m.salidas);
  const acum  = netos.reduce((a,v,i)=>{a.push((a[i-1]||0)+v);return a;},[]);
  const picoInv = acum.length ? Math.min(...acum, 0) : 0;
  const totSalidas = meses.reduce((s,m)=>s+m.salidas,0);
  const totCobros  = cobros.reduce((s,c)=>s+c,0);

  // ── estilos ──
  const cardSt = { background:'var(--bg1)', border:'1px solid var(--b1)', borderRadius:'var(--rl)', padding:20, marginBottom:16 };
  const secTitle = (n,t,sub) => h('div', { style:{ marginBottom:16 } },
    h('div', { style:{ fontSize:13, fontWeight:600, color:'var(--t1)' } }, n + '. ' + t),
    sub && h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } }, sub),
  );
  const th = (txt, align='right') => h('th', { style:{ padding:'8px 12px', fontSize:10, fontWeight:600, color:'var(--t3)', textAlign:align, letterSpacing:'.5px', textTransform:'uppercase', borderBottom:'1px solid var(--b2)', whiteSpace:'nowrap' } }, txt);
  const tdR = (v, extra={}) => h('td', { style:{ padding:'9px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13, borderBottom:'1px solid var(--b1)', ...extra } }, v);
  const fmtC = v => v ? fmt(v) : h('span',{style:{color:'var(--t3)'}},'—');

  return h('div', null,

    // ── Header ──
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, gap:12, flexWrap:'wrap' } },
      h('div', null,
        h('div', { className:'page-title' }, 'Calendario de Pagos'),
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Flujo de inversión por proveedor'),
      ),
      h('div', { style:{ display:'flex', gap:8 } },
        hayCotizacion && h('button', { onClick:recalcular,
          style:{ fontSize:12, padding:'8px 14px', border:'1px solid var(--b2)', borderRadius:'var(--r)', background:'var(--bg2)', cursor:'pointer', color:'var(--t1)' } }, '↺ Recalcular'),
        h('button', { className:'bp', onClick:guardar }, 'Guardar'),
      ),
    ),

    // ── Resumen visual (KPIs) ──
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:16 } },
      h('div', { style:{ ...cardSt, marginBottom:0, padding:16 } },
        h('div', { style:{ fontSize:10, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.5px', fontWeight:600, marginBottom:6 } }, 'Costo total proveedores'),
        h('div', { style:{ fontSize:20, fontWeight:600, fontVariantNumeric:'tabular-nums' } }, fmt(costoTotal)),
      ),
      h('div', { style:{ ...cardSt, marginBottom:0, padding:16 } },
        h('div', { style:{ fontSize:10, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.5px', fontWeight:600, marginBottom:6 } }, 'Total anticipos'),
        h('div', { style:{ fontSize:20, fontWeight:600, fontVariantNumeric:'tabular-nums', color:'var(--amber)' } }, fmt(calendario.reduce((s,b)=>s+b.mtoAnticipo,0))),
      ),
      h('div', { style:{ ...cardSt, marginBottom:0, padding:16 } },
        h('div', { style:{ fontSize:10, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.5px', fontWeight:600, marginBottom:6 } }, 'Pico de inversión'),
        h('div', { style:{ fontSize:20, fontWeight:600, fontVariantNumeric:'tabular-nums', color:picoInv<0?'var(--red)':'var(--green)' } }, picoInv<0?fmt(picoInv):'—'),
      ),
    ),

    !hayCotizacion && h('div', { style:{ marginBottom:16, padding:'10px 14px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12 } },
      '⚠ Sin cotización cargada. Ingresa los costos manualmente en la tabla, o créala en la pestaña Cotización MSMS.'
    ),

    // ── A. Parámetros ──
    h('div', { style:cardSt },
      secTitle('A','Parámetros del flujo'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:16 } },
        h('div', null,
          h('label', { style:{ display:'block', fontSize:11, color:'var(--t2)', fontWeight:500, marginBottom:5 } }, 'Fecha de inicio (firma/contrato)'),
          h('input', { type:'date', value:fechaInicio||'', onChange:e=>setFechaInicio(e.target.value),
            style:{ width:'100%', padding:'8px 10px', fontSize:13, border:'1px solid var(--b2)', borderRadius:8, background:'var(--bg1)', WebkitAppearance:'none', appearance:'none', minHeight:38, textAlign:'left', boxSizing:'border-box', fontFamily:'inherit', color:'var(--t1)' } }),
        ),
        h('div', null,
          h('label', { style:{ display:'block', fontSize:11, color:'var(--t2)', fontWeight:500, marginBottom:5 } }, 'Días cobranza del cliente'),
          h(NumCell, { value:diasCobranza, onChange:setDiasCobranza, width:'100%', key:'dc'+recalcKey }),
        ),
        h('div', null,
          h('label', { style:{ display:'block', fontSize:11, color:'var(--t2)', fontWeight:500, marginBottom:5 } }, '% Anticipo del cliente'),
          h(NumCell, { value:pctAntCliente, onChange:setPctAntCliente, width:'100%', key:'pa'+recalcKey }),
        ),
        h('div', null,
          h('label', { style:{ display:'block', fontSize:11, color:'var(--t2)', fontWeight:500, marginBottom:5 } }, 'Días recibir anticipo'),
          h(NumCell, { value:diasAntCliente, onChange:setDiasAntCliente, width:'100%', key:'da'+recalcKey }),
        ),
      ),
    ),

    // ── B. Proveedores ──
    h('div', { style:cardSt },
      secTitle('B','Proveedores — condiciones de pago', 'Edita costo, días de crédito y % de anticipo de cada proveedor.'),
      // Tabla (desktop)
      h('div', { className:'tbl-scroll hide-mobile', style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', borderCollapse:'collapse', minWidth:640 } },
          h('thead', null, h('tr', null,
            th('Bloque','left'), th('Proveedor','left'), th('Costo c/IVA'), th('Días créd.'), th('% Antic.'), th('Fecha antic.'),
          )),
          h('tbody', null, bloques.map((b,idx) =>
            h('tr', { key:b.id, style:{ background:idx%2?'var(--bg2)':'transparent' } },
              h('td', { style:{ padding:'7px 12px', fontSize:11, color:'var(--t3)', fontWeight:600, borderBottom:'1px solid var(--b1)', width:50 } }, b.id),
              h('td', { style:{ padding:'7px 12px', fontSize:13, borderBottom:'1px solid var(--b1)' } }, b.nom),
              h('td', { style:{ padding:'5px 12px', textAlign:'right', borderBottom:'1px solid var(--b1)' } },
                h(NumCell, { value:b.costo, onChange:v=>setBloque(b.id,'costo',v), width:120, key:'c'+b.id+recalcKey })),
              h('td', { style:{ padding:'5px 12px', textAlign:'right', borderBottom:'1px solid var(--b1)' } },
                h(NumCell, { value:b.diasCredito, onChange:v=>setBloque(b.id,'diasCredito',v), width:64, key:'dc'+b.id+recalcKey })),
              h('td', { style:{ padding:'5px 12px', textAlign:'right', borderBottom:'1px solid var(--b1)' } },
                h(NumCell, { value:b.pctAnticipo, onChange:v=>setBloque(b.id,'pctAnticipo',v), width:56, key:'pa'+b.id+recalcKey })),
              h('td', { style:{ padding:'5px 12px', textAlign:'right', borderBottom:'1px solid var(--b1)' } },
                h('input', { type:'date', value:(b.fechaAnticipoManual || (fechaInicio? addDays(fechaInicio, b.diasAnticipo||0):'') || ''), onChange:e=>setBloque(b.id,'fechaAnticipoManual',e.target.value),
                  style:{ width:130, fontSize:12, padding:'6px 8px', border:'1px solid var(--b2)', borderRadius:8, background:'var(--bg1)', WebkitAppearance:'none', appearance:'none', textAlign:'left', color:'var(--t1)' }, key:'da'+b.id+recalcKey })),
            )
          )),
          h('tfoot', null, h('tr', null,
            h('td', { colSpan:2, style:{ padding:'10px 12px', fontSize:12, fontWeight:700 } }, 'TOTAL'),
            h('td', { style:{ padding:'10px 12px', textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', fontSize:13 } }, fmt(costoTotal)),
            h('td', { colSpan:3 }),
          )),
        )
      ),
      // Tarjetas (móvil)
      h('div', { className:'show-mobile', style:{ display:'none' } },
        bloques.map(b => h('div', { key:b.id, style:{ padding:'12px 0', borderBottom:'.5px solid var(--b3)' } },
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 } },
            h('div', { style:{ fontSize:14, fontWeight:600 } }, h('span', { style:{ color:'var(--t3)', fontWeight:600, marginRight:8, fontSize:12 } }, b.id), b.nom),
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Costo c/IVA'),
              h(NumCell, { value:b.costo, onChange:v=>setBloque(b.id,'costo',v), width:'100%', key:'mc'+b.id+recalcKey })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Días crédito'),
              h(NumCell, { value:b.diasCredito, onChange:v=>setBloque(b.id,'diasCredito',v), width:'100%', key:'mdc'+b.id+recalcKey })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, '% Anticipo'),
              h(NumCell, { value:b.pctAnticipo, onChange:v=>setBloque(b.id,'pctAnticipo',v), width:'100%', key:'mpa'+b.id+recalcKey })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Fecha anticipo'),
              h('input', { type:'date', value:(b.fechaAnticipoManual || (fechaInicio? addDays(fechaInicio, b.diasAnticipo||0):'') || ''), onChange:e=>setBloque(b.id,'fechaAnticipoManual',e.target.value),
                style:{ width:'100%', fontSize:12, padding:'6px 8px', border:'1px solid var(--b2)', borderRadius:8, background:'var(--bg1)', WebkitAppearance:'none', appearance:'none', textAlign:'left', color:'var(--t1)', boxSizing:'border-box' }, key:'mda'+b.id+recalcKey })),
          ),
        )),
        h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:12, marginTop:4, borderTop:'1px solid var(--b1)' } },
          h('span', { style:{ fontSize:13, fontWeight:700 } }, 'TOTAL'),
          h('span', { style:{ fontSize:15, fontWeight:700, fontVariantNumeric:'tabular-nums' } }, fmt(costoTotal)),
        ),
      ),
    ),

    // ── C. Calendario de pagos ──
    fechaInicio && costoTotal > 0 && h('div', { style:cardSt },
      secTitle('C','Calendario de pagos', 'Fechas calculadas desde la fecha de inicio.'),
      h('div', { className:'tbl-scroll', style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', borderCollapse:'collapse', minWidth:620 } },
          h('thead', null, h('tr', null,
            th('Proveedor','left'), th('Costo'), th('Anticipo'), th('Fecha antic.'), th('Finiquito'), th('Fecha finiq.'),
          )),
          h('tbody', null, calendario.filter(b=>b.costo>0).map((b,idx) =>
            h('tr', { key:b.id, style:{ background:idx%2?'var(--bg2)':'transparent' } },
              h('td', { style:{ padding:'9px 12px', fontSize:13, fontWeight:500, borderBottom:'1px solid var(--b1)' } }, b.nom),
              tdR(fmtC(b.costo)),
              tdR(b.mtoAnticipo?fmt(b.mtoAnticipo):h('span',{style:{color:'var(--t3)'}},'—'), { color:b.mtoAnticipo?'var(--amber)':'inherit' }),
              tdR(b.mtoAnticipo?fmtDate(b.fechaAnticipo):'—', { fontSize:12, color:'var(--t2)' }),
              tdR(fmtC(b.mtoFiniquito)),
              tdR(b.mtoFiniquito?fmtDate(b.fechaFiniquito):'—', { fontSize:12, color:'var(--t2)' }),
            )
          )),
        )
      ),
    ),

    // ── D. Cronograma ──
    meses.length>0 && costoTotal>0 && h('div', { style:cardSt },
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10, marginBottom:14 } },
        h('div', null,
          h('div', { style:{ fontSize:14, fontWeight:600 } }, 'D. Cronograma '+(vistaCron==='semana'?'semanal — 12 semanas':'mensual — 6 meses')),
          h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Salidas a proveedores vs entrada de cobranza del cliente.'),
        ),
        h('div', { style:{ display:'flex', gap:4, background:'var(--bg2)', borderRadius:'var(--r)', padding:3 } },
          ['mes','semana'].map(v => h('button', {
            key:v, onClick:()=>setVistaCron(v),
            style:{ fontSize:12, padding:'5px 14px', borderRadius:'calc(var(--r) - 2px)', border:'none', cursor:'pointer',
              background: vistaCron===v ? 'var(--t1)' : 'transparent', color: vistaCron===v ? 'var(--bg1)' : 'var(--t2)', fontWeight: vistaCron===v?600:400 }
          }, v==='mes'?'Mensual':'Semanal'))
        ),
      ),
      h('div', { className:'tbl-scroll', style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', borderCollapse:'collapse', minWidth:680 } },
          h('thead', null, h('tr', null,
            th('Concepto','left'), ...meses.map(m=>th(m.label)), th('Total'),
          )),
          h('tbody', null,
            // Fila Anticipos (clicable para expandir)
            h('tr', { style:{ cursor:'pointer' }, onClick:()=>setExpandAnt(v=>!v) },
              h('td',{style:{padding:'9px 12px',fontSize:12,borderBottom:'1px solid var(--b1)',fontWeight:500}},
                h('span',{style:{display:'inline-block',width:14,color:'var(--t2)'}}, expandAnt?'▾':'▸'),'Anticipos'),
              ...meses.map((m,i)=>tdR(m.anticipos?fmt(m.anticipos):'—',{fontSize:12,color:m.anticipos?'var(--amber)':'var(--t3)'})),
              tdR(fmt(meses.reduce((s,m)=>s+m.anticipos,0)),{fontSize:12,fontWeight:600,color:'var(--amber)'})),
            // Desglose por concepto (cuando está expandido)
            ...(expandAnt ? (() => {
              // Conceptos únicos que tienen algún anticipo en el rango visible
              const conceptos = [...new Set(meses.flatMap(m=>(m.detalleAnt||[]).map(d=>d.nom)))];
              return conceptos.map(nom => h('tr', { key:'ant-'+nom, style:{ background:'var(--bg2)' } },
                h('td',{style:{padding:'6px 12px 6px 28px',fontSize:11,color:'var(--t2)',borderBottom:'.5px solid var(--b3)'}}, nom),
                ...meses.map((m,i)=>{
                  const d=(m.detalleAnt||[]).find(x=>x.nom===nom);
                  return tdR(d?fmt(d.monto):'',{fontSize:11,color:d?'var(--t1)':'var(--t3)',borderBottom:'.5px solid var(--b3)'});
                }),
                tdR(fmt(meses.reduce((s,m)=>s+((m.detalleAnt||[]).find(x=>x.nom===nom)?.monto||0),0)),{fontSize:11,fontWeight:500,color:'var(--t2)',borderBottom:'.5px solid var(--b3)'}),
              ));
            })() : []),
            h('tr', null, h('td',{style:{padding:'9px 12px',fontSize:12,borderBottom:'1px solid var(--b1)'}},'Finiquitos'),
              ...meses.map((m,i)=>tdR(m.finiquitos?fmt(m.finiquitos):'—',{fontSize:12,color:m.finiquitos?'var(--amber)':'var(--t3)'})),
              tdR(fmt(meses.reduce((s,m)=>s+m.finiquitos,0)),{fontSize:12,fontWeight:600,color:'var(--amber)'})),
            h('tr', { style:{ background:'var(--bg2)' } }, h('td',{style:{padding:'9px 12px',fontSize:12,fontWeight:700,borderBottom:'1px solid var(--b1)'}},'Total salidas'),
              ...meses.map((m,i)=>tdR(fmt(m.salidas),{fontWeight:700,fontSize:12})),
              tdR(fmt(totSalidas),{fontWeight:700,fontSize:12})),
            h('tr', null, h('td',{style:{padding:'9px 12px',fontSize:12,borderBottom:'1px solid var(--b1)'}},'Cobranza cliente'),
              ...cobros.map((c,i)=>tdR(c?fmt(c):'—',{fontSize:12,color:c?'var(--green)':'var(--t3)'})),
              tdR(fmt(totCobros),{fontSize:12,fontWeight:600,color:'var(--green)'})),
            h('tr', { style:{ background:'var(--bg2)' } }, h('td',{style:{padding:'9px 12px',fontSize:12,fontWeight:700,borderBottom:'1px solid var(--b1)'}},'Flujo neto'),
              ...netos.map((v,i)=>tdR(fmt(v),{fontWeight:700,fontSize:12,color:v>=0?'var(--green)':'var(--red)'})),
              tdR(fmt(netos.reduce((s,v)=>s+v,0)),{fontWeight:700,fontSize:12})),
            h('tr', null, h('td',{style:{padding:'9px 12px',fontSize:12,borderBottom:'1px solid var(--b1)'}},'Flujo acumulado'),
              ...acum.map((v,i)=>tdR(fmt(v),{fontSize:12,fontWeight:500,color:v>=0?'var(--green)':'var(--red)'})),
              h('td',{style:{borderBottom:'1px solid var(--b1)'}})),
          ),
        )
      ),
      picoInv<0 && h('div', { style:{ marginTop:14, padding:'10px 14px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12 } },
        '⚠ Pico de inversión: ', h('strong',null,fmt(picoInv)), ' — es el capital máximo que necesitarás tener disponible en el momento de mayor exposición.'
      ),
    ),
  );
}
