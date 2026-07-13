// CotizacionOperativa.js — Fase 2A4: vista de Cotización para empleado.
//
// Deliberadamente separada de Cotizacion.js (CotizacionTab, admin-only) —
// ver diagnóstico de Fase 2A4: CotizacionTab llama calcCotizacion en cada
// edición para recalcular montoEstimado, y sus campos operativos/
// financieros viven entrelazados en el mismo bloque JSX. Reutilizarla con
// datos saneados produciría cifras incorrectas, no solo un riesgo de
// confidencialidad. Este archivo nunca debe:
// - importar calcCotizacion, pdf_export.js, firmas.js, ai_analyzer.js, ni
//   AIAnalyzerButton;
// - usar costoMSMS, costoConIVA, precioLista, utilidadDeseada, utilidadPct,
//   modoPrecio, techo, montoGanar, retornos, fianzas, DPP,
//   condicionesComerciales, ni condicionesLista;
// - mostrar botones de PDF, IA financiera, ni Orden de Compra.
//
// project que recibe ya viene saneado por App.js (sanitizeProjectForRole)
// antes de llegar aquí — este componente no necesita sanear nada por su
// cuenta, pero tampoco debe asumir que puede leer campos financieros si
// alguna vez cambiara ese contrato.

import { h, useState } from '../lib/core.js';
import { Metric, StorageImg, NumInput } from '../ui/primitives.js';

const SUBTABS = ['resumen', 'partidas', 'equipo'];
const SUBTAB_LABELS = { resumen: 'Resumen', partidas: 'Partidas', equipo: 'Equipo' };

// Partida nueva — SOLO campos operativos, ninguno financiero (comparar con
// makeP() en Cotizacion.js, que sí incluye precioLista/costoMSMS/etc).
const makePartidaOperativa = (id) => ({ id, activo:false, tipo:'', marca:'', modelo:'', ano:new Date().getFullYear(), version:'', color:'', cantidad:0, vehiculoId:null, foto:'' });

export default function CotizacionOperativa({ project, onUpdate, activeTab, setActiveTab }) {
  const [_localTab, _setLocalTab] = useState(activeTab || 'resumen');
  const tab = activeTab || _localTab;
  const setTab = (t) => { _setLocalTab(t); if (setActiveTab) setActiveTab(t); };

  const cot = project.cotizacion || {};
  const partidas = cot.partidas || [];
  const equipo = cot.equipo || [];

  // Nunca se llama calcCotizacion aquí -- App.js decide si hace falta
  // recalcular montoEstimado tras el merge seguro (Fase 2A4, Commit 4).
  const updCot = (newCot) => { onUpdate({ ...project, cotizacion: newCot }); };

  const updPartida = (id, k, v) => updCot({ ...cot, partidas: partidas.map(p => p.id===id ? {...p,[k]:v} : p) });

  // Agregar SÍ es seguro (confirmado en Fase 2A2: una partida nueva se
  // guarda sin ningún campo financiero, nunca inventado). Quitar NO se
  // implementa en este commit -- sanitizeProjectUpdateForRole preserva
  // conservadoramente cualquier partida del original ausente del incoming
  // (decisión documentada desde 2A2), así que un "quitar" aquí se
  // revertiría solo en el guardado. Se documenta como pendiente real, no
  // se implementa a medias.
  const addPartida = () => {
    const nums = partidas.map(p => parseInt((p.id||'').replace('P',''))).filter(n => !isNaN(n));
    const next = nums.length ? Math.max(...nums)+1 : partidas.length+1;
    const nueva = makePartidaOperativa('P'+next);
    // Mismo comportamiento que Cotizacion.js: extender cnts de cada equipo
    // para mantenerlo alineado por posición con el arreglo de partidas.
    const equipoActualizado = equipo.map(e => ({ ...e, cnts:[...(e.cnts||new Array(partidas.length).fill(0)), 0] }));
    updCot({ ...cot, partidas:[...partidas, nueva], equipo:equipoActualizado });
  };

  // Selector de vehículo del catálogo — mismo selector visual que admin
  // (Cotizacion.js:216-227, confirmado sin precio en la tarjeta), pero
  // copiando SOLO campos operativos -- nunca precioLista.
  const catalogVehiculos = [...(window._lpConfig?.customProducts||[])].filter(x=>x.esVehiculo);
  const selectVehiculo = (pid, veh) => updCot({ ...cot, partidas: partidas.map(p => p.id!==pid ? p : {
    ...p,
    vehiculoId: veh ? veh.id : null, foto: veh ? (veh.photo||'') : '',
    tipo: veh ? (veh.v_tipo||p.tipo) : p.tipo, marca: veh ? (veh.v_marca||'') : p.marca,
    modelo: veh ? (veh.v_modelo||'') : p.modelo, version: veh ? (veh.v_version||'') : p.version,
    ano: veh ? (Number(veh.v_ano)||p.ano) : p.ano,
  })});

  const updEquipo = (eid, k, v) => updCot({ ...cot, equipo: equipo.map(e => e.id===eid ? {...e,[k]:v} : e) });
  const updCnts = (eid, pi, v) => updCot({ ...cot, equipo: equipo.map(e => {
    if (e.id!==eid) return e;
    const cnts = [...(e.cnts||new Array(partidas.length).fill(0))];
    cnts[pi] = Number(v)||0;
    return { ...e, cnts };
  })});

  return h('div', null,
    h('div', { style:{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--b1)', overflowX:'auto' } },
      SUBTABS.map(t => h('button', { key:t, className:'tab'+(tab===t?' active':''), onClick:()=>setTab(t), style:{ flexShrink:0, whiteSpace:'nowrap' } }, SUBTAB_LABELS[t]))
    ),

    // ══ Resumen operativo ══
    tab==='resumen' && h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12 } },
      h(Metric, { label:'Proyecto', value:project.name || '—' }),
      h(Metric, { label:'Cliente / Dependencia', value:project.dependencia || '—' }),
      h(Metric, { label:'Tipo de procedimiento', value:project.tipoProcedimiento || '—' }),
      h(Metric, { label:'Estatus', value:project.status || '—' }),
      h(Metric, { label:'Responsable', value:project.responsable || '—' }),
      h(Metric, { label:'Monto estimado', value: project.montoEstimado ? ('$'+Number(project.montoEstimado).toLocaleString('es-MX')) : '—' }),
      h(Metric, { label:'Folio de cotización', value: cot.folio || '—' }),
      h(Metric, { label:'Fecha de cotización', value: cot.fechaCotizacion || '—' }),
    ),

    // ══ Partidas operativas ══
    tab==='partidas' && h('div', null,
      h('div', { style:{ display:'flex', justifyContent:'flex-end', marginBottom:12 } },
        h('button', { onClick:addPartida, style:{ fontSize:12, padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--blue)', color:'var(--blue)', background:'var(--bg1)', cursor:'pointer', fontWeight:500 } }, '+ Partida'),
      ),
      partidas.length===0 && h('div', { className:'empty' }, h('p', null, 'Sin partidas todavía.')),
      partidas.map(p => h('div', { key:p.id, className:'card', style:{ marginBottom:8, borderLeft:p.activo?'3px solid var(--blue)':'3px solid transparent', opacity:p.activo?1:.5 } },
        h('div', { style:{ display:'flex', alignItems:'center', gap:10, marginBottom:p.activo?12:0 } },
          h('input', { type:'checkbox', checked:p.activo, onChange:e=>updPartida(p.id,'activo',e.target.checked), style:{ width:15, height:15, cursor:'pointer', accentColor:'var(--blue)' } }),
          p.foto ? h(StorageImg, { src:p.foto, style:{ width:36, height:28, objectFit:'contain', borderRadius:4, flexShrink:0 } })
                 : h('span', { style:{ fontSize:10, color:'var(--t3)', padding:'2px 6px', background:'var(--bg2)', borderRadius:4 } }, '🚗 sin seleccionar'),
          h('span', { style:{ fontWeight:600, fontSize:14, color:p.activo?'var(--blue)':'var(--t3)' } }, p.id),
          p.activo && p.cantidad>0 && p.tipo && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, p.cantidad,' × ',p.tipo,' ',p.marca,' ',p.modelo),
          !p.activo && h('span', { style:{ fontSize:12, color:'var(--t3)' } }, 'Inactiva'),
        ),
        p.activo && h('div', null,
          catalogVehiculos.length > 0 && h('div', { style:{ marginBottom:12 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', fontWeight:600, marginBottom:6 } }, 'Modelo de vehículo (catálogo)'),
            h('div', { style:{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 } },
              catalogVehiculos.map(veh => {
                const sel = p.vehiculoId === veh.id;
                return h('div', { key:veh.id, onClick:()=>selectVehiculo(p.id, sel?null:veh),
                  style:{ flexShrink:0, width:90, cursor:'pointer', borderRadius:10, border:'2px solid '+(sel?'var(--blue)':'var(--b2)'),
                    background:sel?'var(--blue-bg)':'var(--bg1)', padding:6, textAlign:'center' } },
                  veh.photo
                    ? h(StorageImg, { src:veh.photo, style:{ width:56, height:44, objectFit:'contain', borderRadius:6, display:'block', margin:'0 auto 4px' } })
                    : h('div', { style:{ width:56, height:44, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, margin:'0 auto 4px' } }, '🚗'),
                  h('div', { style:{ fontSize:9, fontWeight:sel?600:400, color:sel?'var(--blue)':'var(--t1)', lineHeight:1.2, wordBreak:'break-word' } },
                    veh.nom || (veh.v_marca+' '+veh.v_modelo)),
                );
              }),
            ),
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:8, marginBottom:8 } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Tipo de vehículo'),
              h('select', { value:p.tipo||'', onChange:e=>updPartida(p.id,'tipo',e.target.value), style:{ fontSize:12, padding:'5px 7px' } },
                h('option', { value:'' }, '— Seleccionar —'),
                ['Pickup patrulla','Sedán patrulla','SUV patrulla','SUV mando','Pickup especial','Sedan administrativo','Furgoneta','Motocicleta','Otro'].map(o=>h('option',{key:o},o))
              )
            ),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Marca'), h('input', { value:p.marca||'', onChange:e=>updPartida(p.id,'marca',e.target.value), style:{ fontSize:12 }, placeholder:'Ford' })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Modelo'), h('input', { value:p.modelo||'', onChange:e=>updPartida(p.id,'modelo',e.target.value), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Año'), h('input', { type:'number', value:p.ano||'', onChange:e=>updPartida(p.id,'ano',Number(e.target.value)), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Versión'), h('input', { value:p.version||'', onChange:e=>updPartida(p.id,'version',e.target.value), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Color'), h('input', { value:p.color||'', onChange:e=>updPartida(p.id,'color',e.target.value), style:{ fontSize:12 }, placeholder:'Ej: Blanco' })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Cantidad'), h(NumInput, { value:p.cantidad, onChange:v=>updPartida(p.id,'cantidad',v), style:{ fontSize:13, padding:'6px 8px', fontWeight:500 } })),
          ),
        ),
      )),
    ),

    // ══ Equipo operativo — edición de existentes. Agregar equipo nuevo
    // desde catálogo queda pendiente para un commit posterior: requiere
    // replicar con cuidado el selector de catálogo dentro de este flujo
    // (distinto del selector general de Catalog.js ya corregido en el
    // Commit 1) para confirmar que tampoco expone precio ahí. No se
    // implementa a medias. ══
    tab==='equipo' && h('div', null,
      equipo.length===0 && h('div', { className:'empty' }, h('p', null, 'Sin equipo capturado todavía.')),
      equipo.length > 0 && h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ width:'100%', borderCollapse:'collapse', fontSize:12 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            ['Nombre','Marca/Modelo/Unidad','Usar','Notas'].map(hd=>h('td',{key:hd,style:{padding:'6px 4px',color:'var(--t2)',fontSize:11}},hd))
          )),
          h('tbody', null, equipo.map(e => h('tr', { key:e.id, style:{ borderBottom:'.5px solid var(--b3)' } },
            h('td', { style:{ padding:'6px 4px', fontWeight:500 } }, e.nombre),
            h('td', { style:{ padding:'6px 4px' } },
              h('input', { value:e.marca||'', onChange:ev=>updEquipo(e.id,'marca',ev.target.value), placeholder:'Marca', style:{ fontSize:10, padding:'2px 5px', width:70, border:'1px solid var(--b2)', borderRadius:5, marginRight:4 } }),
              h('input', { value:e.modelo||'', onChange:ev=>updEquipo(e.id,'modelo',ev.target.value), placeholder:'Modelo', style:{ fontSize:10, padding:'2px 5px', width:70, border:'1px solid var(--b2)', borderRadius:5, marginRight:4 } }),
              h('input', { value:e.unidad||'pz', onChange:ev=>updEquipo(e.id,'unidad',ev.target.value), placeholder:'Unidad', style:{ fontSize:10, padding:'2px 5px', width:40, border:'1px solid var(--b2)', borderRadius:5 } }),
            ),
            h('td', { style:{ padding:'6px 4px', textAlign:'center' } }, h('input', { type:'checkbox', checked:e.usar, onChange:ev=>updEquipo(e.id,'usar',ev.target.checked), style:{ width:14, height:14, accentColor:'var(--blue)' } })),
            h('td', { style:{ padding:'6px 4px' } }, h('input', { value:e.notas||'', onChange:ev=>updEquipo(e.id,'notas',ev.target.value), placeholder:'Notas', style:{ fontSize:11, padding:'3px 6px', width:'100%' } })),
          ))),
        ),
      ),
      partidas.filter(p=>p.activo).length > 0 && equipo.length > 0 && h('div', { style:{ marginTop:16 } },
        h('div', { style:{ fontSize:11, color:'var(--t2)', fontWeight:600, marginBottom:8 } }, 'Cantidad de cada equipo por partida'),
        h('div', { style:{ overflowX:'auto' } },
          h('table', { style:{ width:'100%', borderCollapse:'collapse', fontSize:11 } },
            h('thead', null, h('tr', null,
              h('td', { style:{ padding:'4px' } }, 'Equipo'),
              partidas.filter(p=>p.activo).map(p=>h('td',{key:p.id,style:{padding:'4px',textAlign:'center'}},p.id)),
            )),
            h('tbody', null, equipo.map(e => h('tr', { key:e.id },
              h('td', { style:{ padding:'4px' } }, e.nombre),
              partidas.filter(p=>p.activo).map(p => {
                const pi = parseInt((p.id||'').replace('P',''))-1;
                return h('td', { key:p.id, style:{ padding:'4px', textAlign:'center' } },
                  h(NumInput, { value:(e.cnts&&e.cnts[pi])||0, onChange:v=>updCnts(e.id,pi,v), style:{ width:46, fontSize:11, padding:'3px 4px', textAlign:'center' } }),
                );
              }),
            ))),
          ),
        ),
      ),
    ),
  );
}
