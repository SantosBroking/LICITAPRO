// Cotizacion.js — Tab de cotización MSMS (5 sub-tabs, sin htm)
import { h, useState, useEffect, useMemo, useCallback } from '../lib/core.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js';
import { calcCotizacion } from '../lib/calc.js';
import { fmt, pctS, daysOld, TODAY, uid } from '../lib/utils.js';
import { NumInput } from '../ui/primitives.js';

// Construye catálogo en vivo (base + personalizados) para que editar el catálogo
// se refleje inmediatamente en la cotización sin necesidad de re-agregar productos.
function buildLiveCatalog() {
  const custom = window._lpConfig?.customProducts || [];
  const map = {};
  [...CATALOG_PRODUCTS, ...custom].forEach(p => { map[p.id] = p; });
  return map;
}
// Mezcla los datos del catálogo en vivo con la entrada guardada en la cotización.
// Los campos del usuario (costo, cantidades, etc.) se respetan; nombre/cat/vis vienen del catálogo.
function liveEquipo(e) {
  const cat = buildLiveCatalog();
  const live = cat[e.productoId];
  if (!live) return e;
  return { ...e, nombre: live.nom || e.nombre, cat: live.cat || e.cat, vis: live.vis ?? e.vis };
}

const TABS = ['partidas','equipo','extras','corrida','agente'];
const TAB_LABELS = { partidas:'1 · Partidas', equipo:'2 · Equipo', extras:'3 · Retornos e ISR', corrida:'4 · Corrida financiera', agente:'5 · Agente Claude' };
const BASES_RETORNO = ['% sobre venta c/IVA','% sobre venta s/IVA','Monto fijo total','Monto fijo por unidad'];
const BASES_FIANZA  = ['% sobre venta c/IVA','% sobre venta s/IVA','Monto fijo total','Monto fijo por unidad'];
const IVA = 0.16;

export default function CotizacionTab({ project, onUpdate, activeTab, setActiveTab }) {
  const [_localTab, _setLocalTab] = useState(activeTab||'partidas');
  useEffect(()=>{ if(activeTab&&activeTab!==_localTab)_setLocalTab(activeTab); },[activeTab]);
  const tab    = activeTab||_localTab;
  const setTab = useCallback(t=>{ _setLocalTab(t); if(setActiveTab)setActiveTab(t); },[setActiveTab]);

  const [aiMsg, setAiMsg]       = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResp, setAiResp]     = useState('');
  const [showCat, setShowCat]   = useState(false);
  const [catSel, setCatSel]     = useState('01 Imagen');

  const cot = useMemo(()=>{
    const c=project.cotizacion||{};
    const yr=new Date().getFullYear();
    const makeP=(id,activo)=>({id,activo,tipo:'',marca:'',modelo:'',ano:yr,version:'',cantidad:0,costoMSMS:0,modoPrecio:'Utilidad deseada $',techo:0,utilidadDeseada:0,utilidadPct:0});
    return {
      version:c.version||'V1', folio:c.folio||'', municipio:c.municipio||'', fechaCotizacion:c.fechaCotizacion||TODAY(), vigenciaDias:c.vigenciaDias||20,
      condicionesComerciales:c.condicionesComerciales||'', agenciaProveedor:c.agenciaProveedor||'',
      pctIvaSat:c.pctIvaSat!=null?c.pctIvaSat:0.5, pctIvaUtil:c.pctIvaUtil!=null?c.pctIvaUtil:0.5,
      partidas:c.partidas||[makeP('P1',true),makeP('P2',false),makeP('P3',false),makeP('P4',false),makeP('P5',false)],
      equipo:c.equipo||[], retornos:c.retornos||[], fianzas:c.fianzas||[],
    };
  },[project.cotizacion]);

  const calc = useMemo(()=>calcCotizacion(cot),[cot]);

  const updCot = newCot => {
    const calcN=calcCotizacion(newCot);
    onUpdate({...project, cotizacion:newCot, montoEstimado:Math.round(calcN.ventaTotal)||project.montoEstimado});
  };
  const updPartida = (id,k,v) => updCot({...cot,partidas:cot.partidas.map(p=>p.id===id?{...p,[k]:v}:p)});
  const selectVehiculo = (pid, veh) => updCot({...cot,partidas:cot.partidas.map(p=>p.id!==pid?p:{...p,
    vehiculoId:veh?veh.id:null, foto:veh?veh.photo||'':'',
    tipo:veh?veh.v_tipo||p.tipo:'', marca:veh?veh.v_marca||'':'',
    modelo:veh?veh.v_modelo||'':'', version:veh?veh.v_version||'':'', ano:veh?Number(veh.v_ano)||p.ano:p.ano,
  })});
  const catalogVehiculos = [...CATALOG_PRODUCTS, ...(window._lpConfig?.customProducts||[])].filter(x=>x.esVehiculo);
  const updEquipo  = (eid,k,v) => updCot({...cot,equipo:cot.equipo.map(e=>e.id===eid?{...e,[k]:v}:e)});
  const updCnts = (eid,pi,v) => updCot({...cot,equipo:cot.equipo.map(e=>{ if(e.id!==eid)return e; const cnts=[...(e.cnts||new Array(cot.partidas.length).fill(0))];cnts[pi]=Number(v)||0;return{...e,cnts}; })});

  const addPartida = () => {
    const nums = cot.partidas.map(p=>parseInt(p.id.replace('P',''))).filter(n=>!isNaN(n));
    const next = nums.length ? Math.max(...nums)+1 : cot.partidas.length+1;
    const newPart = makeP('P'+next, false);
    const newEquipo = cot.equipo.map(e=>({...e, cnts:[...(e.cnts||new Array(cot.partidas.length).fill(0)),0]}));
    updCot({...cot, partidas:[...cot.partidas,newPart], equipo:newEquipo});
  };

  const removeLastPartida = () => {
    if (cot.partidas.length <= 1) { alert('Debe haber al menos una partida.'); return; }
    const last = cot.partidas[cot.partidas.length-1];
    if (last.activo && last.cantidad>0) { alert('Desactiva la última partida antes de eliminarla.'); return; }
    const idx = cot.partidas.length-1;
    const newEquipo = cot.equipo.map(e=>({...e, cnts:(e.cnts||[]).slice(0,idx)}));
    updCot({...cot, partidas:cot.partidas.slice(0,-1), equipo:newEquipo});
  };
  const addEquipo = prod => {
    if(cot.equipo.some(e=>e.productoId===prod.id))return;
    updCot({...cot,equipo:[...cot.equipo,{id:uid('EQ'),productoId:prod.id,nombre:prod.nom,cat:prod.cat,usar:true,vis:prod.vis,costoConIVA:0,llevaIVA:prod.cat!=='08 Mano de obra',cnts:new Array(cot.partidas.length).fill(0),est:'Estimado',fechaCosto:TODAY(),notas:''}]});
  };
  const removeEquipo  = eid => updCot({...cot,equipo:cot.equipo.filter(e=>e.id!==eid)});
  const addRetorno    = ()  => updCot({...cot,retornos:[...cot.retornos,{id:uid('RET'),nombre:'Retorno',base:'% sobre venta c/IVA',valor:0,activo:true,llevaIVA:false}]});
  const updRetorno    = (id,k,v) => updCot({...cot,retornos:cot.retornos.map(r=>r.id===id?{...r,[k]:v}:r)});
  const removeRetorno = id  => updCot({...cot,retornos:cot.retornos.filter(r=>r.id!==id)});
  const addFianza     = ()  => updCot({...cot,fianzas:[...cot.fianzas,{id:uid('FZ'),nombre:'Fianza de cumplimiento',base:'% sobre venta c/IVA',valor:0,activo:true,llevaIVA:false}]});
  const updFianza     = (id,k,v) => updCot({...cot,fianzas:cot.fianzas.map(f=>f.id===id?{...f,[k]:v}:f)});
  const removeFianza  = id  => updCot({...cot,fianzas:cot.fianzas.filter(f=>f.id!==id)});

  const askAgent = async () => {
    if(!aiMsg.trim())return; setAiLoading(true); setAiResp('');
    try {
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:800,system:`Eres el asistente de cotización de MSMS CORP, especializado en patrullas y vehículos equipados para seguridad pública en México. Responde en español de forma concisa.\nProyecto: "${project.name}" — Cliente: ${project.dependencia||'sin definir'}\nPartidas: ${cot.partidas.filter(p=>p.activo&&p.cantidad>0).map(p=>`${p.id}: ${p.cantidad} ${p.tipo} ${p.marca} ${p.modelo}`).join(' | ')||'ninguna'}\nVenta: ${fmt(calc.ventaTotal)} | Margen bruto: ${pctS(calc.margen)} | Utilidad NETA: ${fmt(calc.utilNeta)}`,messages:[{role:'user',content:aiMsg}]})});
      const d=await r.json(); setAiResp(d.content?.[0]?.text||'Sin respuesta');
    } catch(e){ setAiResp('Error: '+e.message); }
    setAiLoading(false);
  };

  const cats   = [...new Set(CATALOG_PRODUCTS.map(p=>p.cat))];
  const tabIdx = TABS.indexOf(tab);
  const goNext = ()=>{ if(tabIdx<TABS.length-1)setTab(TABS[tabIdx+1]); };
  const goPrev = ()=>{ if(tabIdx>0)setTab(TABS[tabIdx-1]); };

  const NavButtons = () => h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:20, paddingTop:14, borderTop:'.5px solid var(--b3)' } },
    h('button', { onClick:goPrev, style:{ opacity:tabIdx===0?.3:1, pointerEvents:tabIdx===0?'none':'auto' } }, '← Anterior'),
    h('span', { style:{ fontSize:11, color:'var(--t3)' } }, tabIdx+1,' / ',TABS.length),
    tabIdx<TABS.length-1
      ? h('button', { className:'bp', onClick:goNext }, 'Siguiente →')
      : h('span', { style:{ fontSize:12, color:'var(--green)', fontWeight:500 } }, '✓ Cotización completa'),
  );

  const kpis = [
    { label:'Venta c/IVA', val:fmt(calc.ventaTotal), color:'var(--blue)' },
    { label:'Utilidad bruta', val:fmt(calc.utilBruta), color:calc.utilBruta>0?'var(--green)':'var(--red)' },
    { label:'Utilidad NETA', val:fmt(calc.utilNeta), color:calc.utilNeta>0?'var(--green)':'var(--red)' },
    { label:'Margen bruto', val:pctS(calc.margen), color:calc.margen>=.2?'var(--green)':calc.margen>=.1?'var(--amber)':'var(--red)' },
    { label:'Margen neto', val:pctS(calc.margenNeto), color:calc.margenNeto>=.2?'var(--green)':calc.margenNeto>=.1?'var(--amber)':'var(--red)' },
  ];

  const activeParts = cot.partidas.filter(p=>p.activo&&p.cantidad>0);

  return h('div', null,
    // KPIs
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:14 } },
      kpis.map(k=>h('div', { key:k.label, className:'metric' },
        h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, k.label),
        h('div', { style:{ fontSize:14, fontWeight:500, color:k.color } }, k.val),
      ))
    ),
    // Sub-tabs
    h('div', { style:{ display:'flex', gap:2, marginBottom:14, borderBottom:'.5px solid var(--b3)', overflowX:'auto', flexWrap:'nowrap' } },
      TABS.map(t=>h('button', { key:t, className:'tab'+(tab===t?' active':''), onClick:()=>setTab(t), style:{ flexShrink:0, whiteSpace:'nowrap' } }, TAB_LABELS[t]))
    ),

    // ══ 1. PARTIDAS ══
    tab==='partidas' && h('div', null,
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 } },
        h('div', null, h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:3 } }, 'Folio'), h('input', { value:cot.folio||'', onChange:e=>updCot({...cot,folio:e.target.value}), style:{ fontSize:12 } })),
        h('div', null, h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:3 } }, 'Agencia / Proveedor'), h('input', { value:cot.agenciaProveedor||'', onChange:e=>updCot({...cot,agenciaProveedor:e.target.value}), style:{ fontSize:12 }, placeholder:'Ej: Grupo Surman' })),
        h('div', { style:{ gridColumn:'1/-1' } }, h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:3 } }, 'Municipio / Destinatario (aparece en el PDF como «Para»)'), h('input', { value:cot.municipio||'', onChange:e=>updCot({...cot,municipio:e.target.value}), style:{ fontSize:12 }, placeholder:'Ej: Tultitlán, Estado de México' })),
      ),
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 } },
        h('div', { style:{ fontSize:12, color:'var(--t2)', background:'var(--bg2)', padding:'8px 12px', borderRadius:'var(--r)', flex:1 } }, 'Una ', h('strong', null, 'partida'), ' = grupo de vehículos con el mismo equipamiento.'),
        h('div', { style:{ display:'flex', gap:6, marginLeft:10 } },
          h('button', { onClick:addPartida, style:{ fontSize:12, padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--blue)', color:'var(--blue)', background:'var(--bg1)', cursor:'pointer', fontWeight:500 } }, '+ Partida'),
          cot.partidas.length > 1 && h('button', { onClick:removeLastPartida, style:{ fontSize:12, padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--b2)', color:'var(--t2)', background:'var(--bg1)', cursor:'pointer' } }, '− Última'),
        ),
      ),
      cot.partidas.map(p=>h('div', { key:p.id, className:'card', style:{ marginBottom:8, borderLeft:p.activo?'3px solid var(--blue)':'3px solid transparent', opacity:p.activo?1:.5 } },
        h('div', { style:{ display:'flex', alignItems:'center', gap:10, marginBottom:p.activo?12:0 } },
          h('input', { type:'checkbox', checked:p.activo, onChange:e=>updPartida(p.id,'activo',e.target.checked), style:{ width:15, height:15, cursor:'pointer', accentColor:'var(--blue)' } }),
          (() => {
            const vehFoto = p.foto || (window._lpConfig?.customProducts||[]).find(x=>x.id===p.vehiculoId)?.photo || '';
            return vehFoto ? h('img', { src:vehFoto, style:{ width:36, height:28, objectFit:'contain', borderRadius:4, flexShrink:0 } }) : null;
          })(),
          h('span', { style:{ fontWeight:600, fontSize:14, color:p.activo?'var(--blue)':'var(--t3)' } }, p.id),
          p.activo&&p.cantidad>0&&p.tipo && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, p.cantidad,' × ',p.tipo,' ',p.marca,' ',p.modelo),
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
                    background:sel?'var(--blue-bg)':'var(--bg1)', padding:6, textAlign:'center', transition:'all .15s' } },
                  veh.photo
                    ? h('img', { src:veh.photo, style:{ width:56, height:44, objectFit:'contain', borderRadius:6, display:'block', margin:'0 auto 4px' } })
                    : h('div', { style:{ width:56, height:44, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, margin:'0 auto 4px' } }, '🚗'),
                  h('div', { style:{ fontSize:9, fontWeight:sel?600:400, color:sel?'var(--blue)':'var(--t1)', lineHeight:1.2, wordBreak:'break-word' } },
                    veh.nom || (veh.v_marca+' '+veh.v_modelo)),
                );
              }),
              h('div', { onClick:()=>selectVehiculo(p.id,null),
                style:{ flexShrink:0, width:64, cursor:'pointer', borderRadius:10, border:'1px dashed var(--b2)',
                  background:'transparent', padding:6, textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4 } },
                h('div', { style:{ fontSize:18, color:'var(--t3)' } }, '✏'),
                h('div', { style:{ fontSize:9, color:'var(--t3)' } }, 'Manual'),
              ),
            ),
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr', gap:8, marginBottom:8 } },
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
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Cantidad'), h(NumInput, { value:p.cantidad, onChange:v=>updPartida(p.id,'cantidad',v), style:{ fontSize:13, padding:'6px 8px', fontWeight:500 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Costo MSMS c/IVA ($)'), h(NumInput, { value:p.costoMSMS, onChange:v=>updPartida(p.id,'costoMSMS',v), style:{ fontSize:13, padding:'6px 8px' } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Modo de precio'),
              h('select', { value:p.modoPrecio||'Utilidad deseada $', onChange:e=>updPartida(p.id,'modoPrecio',e.target.value), style:{ fontSize:11, padding:'6px 5px' } },
                ['Utilidad deseada $','Utilidad deseada %','Techo presupuestal'].map(o=>h('option',{key:o},o))
              )
            ),
            h('div', null,
              h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, p.modoPrecio==='Techo presupuestal'?'Techo c/IVA ($)':p.modoPrecio==='Utilidad deseada %'?'Utilidad (%)':'Utilidad s/IVA ($)'),
              h(NumInput, {
                value:p.modoPrecio==='Utilidad deseada %'?Math.round((p.utilidadPct||0)*100):p.modoPrecio==='Techo presupuestal'?(p.techo||0):(p.utilidadDeseada||0),
                onChange:v=>{ if(p.modoPrecio==='Utilidad deseada %')updPartida(p.id,'utilidadPct',v/100); else if(p.modoPrecio==='Techo presupuestal')updPartida(p.id,'techo',v); else updPartida(p.id,'utilidadDeseada',v); },
                style:{ fontSize:13, padding:'6px 8px' },
              })
            ),
          ),
        ),
      )),
      h(NavButtons),
    ),

    // ══ 2. EQUIPO ══
    tab==='equipo' && h('div', null,
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 } },
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Cantidades = por unidad del vehículo'),
        h('button', { onClick:()=>setShowCat(!showCat), style:{ fontSize:12, color:'var(--blue)', border:'.5px solid var(--blue)44', padding:'5px 12px' } }, showCat?'Ocultar catálogo':'+ Del catálogo'),
      ),
      showCat && h('div', { className:'card', style:{ marginBottom:12 } },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:8 } }, 'Catálogo — clic en + para agregar'),
        h('div', { style:{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:8 } },
          cats.map(c=>h('button',{key:c,style:{fontSize:11,padding:'4px 10px',background:catSel===c?'var(--t1)':'transparent',color:catSel===c?'var(--bg1)':'var(--t2)',border:'.5px solid var(--b2)',borderRadius:'var(--r)'},onClick:()=>setCatSel(c)},c))
        ),
        h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:5 } },
          CATALOG_PRODUCTS.filter(p=>p.cat===catSel).map(prod=>{
            const ya=cot.equipo.some(e=>e.productoId===prod.id);
            return h('div', { key:prod.id, style:{ padding:'7px 10px', background:ya?'#E1F5EE':'var(--bg2)', borderRadius:'var(--r)', border:'.5px solid var(--b3)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 } },
              h('div', { style:{ minWidth:0 } },
                h('div', { style:{ fontSize:12, fontWeight:ya?500:400, color:ya?'#085041':'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, prod.nom),
                h('div', { style:{ fontSize:10, color:'var(--t2)' } }, prod.sub),
              ),
              h('button', { onClick:()=>ya?removeEquipo(cot.equipo.find(e=>e.productoId===prod.id)?.id):addEquipo(prod), style:{ fontSize:12, padding:'3px 8px', flexShrink:0, color:ya?'#085041':'var(--t1)', fontWeight:ya?500:400 } }, ya?'✓':'+'),
            );
          })
        ),
      ),
      cot.equipo.length===0 && h('div', { className:'card', style:{ textAlign:'center', padding:'30px', color:'var(--t2)', fontSize:13 } }, 'Sin equipo. Abre el catálogo arriba.'),
      cot.equipo.length>0 && h('div', { className:'card', style:{ overflowX:'auto' } },
        h('table', { style:{ fontSize:12, minWidth:700 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:30 } }, 'Usar'),
            h('td', { style:{ padding:'6px 8px', color:'var(--t2)', fontSize:10 } }, 'Producto'),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:95 } }, 'Costo c/IVA'),
            ...cot.partidas.filter(p=>p.activo).map(p=>h('td',{key:p.id,style:{padding:'6px 4px',color:'var(--blue)',fontSize:10,width:52,textAlign:'center'}},p.id,h('br'),h('span',{style:{fontSize:9,color:'var(--t3)'}},p.cantidad,' uds'))),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:38, textAlign:'center' } }, 'IVA'),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:115 } }, 'Estatus'),
            h('td', { style:{ padding:'6px 4px', width:24 } }),
          )),
          h('tbody', null, [...cot.equipo].sort((a,b)=>(a.cat||'').localeCompare(b.cat||'','es',{numeric:true})).map(eRaw=>{ const e=liveEquipo(eRaw);
            const days=daysOld(e.fechaCosto), ageC=days===null?'':days>120?'var(--red)':days>60?'var(--amber)':'';
            const estBg=e.est==='Confirmado'?'#E1F5EE':e.est==='Vencido'?'#FCEBEB':'#FAEEDA';
            const estTx=e.est==='Confirmado'?'#085041':e.est==='Vencido'?'#791F1F':'#633806';
            return h('tr', { key:e.id, style:{ borderBottom:'.5px solid var(--b3)', opacity:e.usar?1:.45 } },
              h('td', { style:{ padding:'6px 4px', textAlign:'center' } }, h('input', { type:'checkbox', checked:e.usar, onChange:ev=>updEquipo(e.id,'usar',ev.target.checked), style:{ width:14, height:14, accentColor:'var(--blue)' } })),
              h('td', { style:{ padding:'6px 8px' } },
                h('div', { style:{ fontWeight:e.usar?500:400 } }, e.nombre),
                h('div', { style:{ fontSize:10, color:'var(--t2)' } }, e.cat),
              ),
              h('td', { style:{ padding:'6px 4px' } }, h(NumInput, { value:e.costoConIVA, onChange:v=>updEquipo(e.id,'costoConIVA',v), style:{ width:90, fontSize:11, padding:'3px 5px' } })),
              ...cot.partidas.filter(p=>p.activo).map(p=>{ const pi=parseInt(p.id.replace('P',''))-1; return h('td',{key:p.id,style:{padding:'6px 4px',textAlign:'center'}},h(NumInput,{value:(e.cnts&&e.cnts[pi])||0,onChange:v=>updCnts(e.id,pi,v),style:{width:46,fontSize:11,padding:'3px 4px',textAlign:'center'}})); }),
              h('td', { style:{ padding:'6px 4px', textAlign:'center' } }, h('input', { type:'checkbox', checked:e.llevaIVA, onChange:ev=>updEquipo(e.id,'llevaIVA',ev.target.checked), style:{ width:14, height:14 } })),
              h('td', { style:{ padding:'6px 4px' } },
                h('select', { value:e.est||'Estimado', onChange:ev=>updEquipo(e.id,'est',ev.target.value), style:{ fontSize:10, padding:'3px 5px', background:estBg, color:estTx, border:'none', borderRadius:8, cursor:'pointer', width:'100%' } },
                  ['Confirmado','Estimado','Heredado','Pendiente MSM','Vencido'].map(o=>h('option',{key:o},o))
                ),
              ),
              h('td', { style:{ padding:'6px 4px' } }, h('button', { onClick:()=>removeEquipo(e.id), style:{ background:'transparent', border:'none', color:'var(--red)', cursor:'pointer', fontSize:14, padding:'2px 4px' } }, '×')),
            );
          }))
        )
      ),
      h(NavButtons),
    ),

    // ══ 3. RETORNOS E ISR ══
    tab==='extras' && h('div', null,
      h('div', { className:'card', style:{ marginBottom:14 } },
        h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 } },
          h('div', null,
            h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Retornos y comisiones'),
            h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Se incluyen en el costo total del proyecto.'),
          ),
          h('button', { className:'bp', onClick:addRetorno, style:{ fontSize:12 } }, '+ Agregar retorno'),
        ),
        cot.retornos.length===0 && h('div', { style:{ color:'var(--t2)', fontSize:13, padding:'12px 0' } }, 'Sin retornos configurados.'),
        cot.retornos.map(r=>h('div', { key:r.id, style:{ display:'grid', gridTemplateColumns:'1fr 1fr 100px 60px 30px', gap:8, alignItems:'center', padding:'10px 0', borderBottom:'.5px solid var(--b3)' } },
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Nombre'), h('input', { value:r.nombre||'', onChange:e=>updRetorno(r.id,'nombre',e.target.value), style:{ fontSize:12 } })),
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Base'), h('select', { value:r.base, onChange:e=>updRetorno(r.id,'base',e.target.value), style:{ fontSize:12 } }, BASES_RETORNO.map(b=>h('option',{key:b},b)))),
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, r.base&&r.base.startsWith('%')?'%':'$'), h(NumInput, { value:r.valor, onChange:v=>updRetorno(r.id,'valor',v), style:{ fontSize:12 } })),
          h('div', { style:{ textAlign:'center' } }, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:6 } }, 'Activo'), h('input', { type:'checkbox', checked:r.activo, onChange:e=>updRetorno(r.id,'activo',e.target.checked), style:{ width:15, height:15, accentColor:'var(--blue)' } })),
          h('button', { onClick:()=>removeRetorno(r.id), style:{ background:'transparent', border:'none', color:'var(--red)', cursor:'pointer', fontSize:16, padding:0 } }, '×'),
        )),
        cot.retornos.filter(r=>r.activo).length>0 && h('div', { style:{ display:'flex', justifyContent:'flex-end', paddingTop:10, fontSize:13, fontWeight:500 } }, 'Total retornos: ', h('span', { style:{ color:'var(--red)', marginLeft:8 } }, fmt(calc.totalRetornos))),
      ),
      h('div', { className:'card' },
        h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 } },
          h('div', null,
            h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Fianzas, ISR y costos financieros'),
            h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Se incluyen en el costo total del proyecto.'),
          ),
          h('button', { className:'bp', onClick:addFianza, style:{ fontSize:12 } }, '+ Agregar concepto'),
        ),
        h('div', { style:{ marginBottom:12 } },
          ['Fianza de cumplimiento 5%','Fianza de anticipo','ISR','Costo financiero'].map(label=>
            h('button', { key:label, onClick:()=>updCot({...cot,fianzas:[...cot.fianzas,{id:uid('FZ'),nombre:label,base:'% sobre venta c/IVA',valor:label==='Fianza de cumplimiento 5%'?5:label==='ISR'?1.5:2,activo:true,llevaIVA:false}]}), style:{ fontSize:11, padding:'4px 10px', color:'var(--t2)', border:'.5px solid var(--b2)', borderRadius:8, marginRight:6, marginBottom:4 } }, '+ ',label)
          )
        ),
        cot.fianzas.map(f=>h('div', { key:f.id, style:{ display:'grid', gridTemplateColumns:'1fr 1fr 100px 60px 30px', gap:8, alignItems:'center', padding:'10px 0', borderBottom:'.5px solid var(--b3)' } },
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Concepto'), h('input', { value:f.nombre||'', onChange:e=>updFianza(f.id,'nombre',e.target.value), style:{ fontSize:12 } })),
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Base'), h('select', { value:f.base, onChange:e=>updFianza(f.id,'base',e.target.value), style:{ fontSize:12 } }, BASES_FIANZA.map(b=>h('option',{key:b},b)))),
          h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, f.base&&f.base.startsWith('%')?'%':'$'), h(NumInput, { value:f.valor, onChange:v=>updFianza(f.id,'valor',v), style:{ fontSize:12 } })),
          h('div', { style:{ textAlign:'center' } }, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:6 } }, 'Activo'), h('input', { type:'checkbox', checked:f.activo, onChange:e=>updFianza(f.id,'activo',e.target.checked), style:{ width:15, height:15, accentColor:'var(--blue)' } })),
          h('button', { onClick:()=>removeFianza(f.id), style:{ background:'transparent', border:'none', color:'var(--red)', cursor:'pointer', fontSize:16, padding:0 } }, '×'),
        )),
        cot.fianzas.filter(f=>f.activo).length>0 && h('div', { style:{ display:'flex', justifyContent:'flex-end', paddingTop:10, fontSize:13, fontWeight:500 } }, 'Total fianzas: ', h('span', { style:{ color:'var(--red)', marginLeft:8 } }, fmt(calc.totalFianzas))),
      ),
      h(NavButtons),
    ),

    // ══ 4. CORRIDA FINANCIERA ══
    tab==='corrida' && h('div', null,
      // Total contrato
      h('div', { className:'card', style:{ marginBottom:12, borderLeft:'3px solid var(--blue)' } },
        h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center' } },
          h('div', { style:{ fontSize:13, color:'var(--t2)' } }, 'TOTAL CONTRATO c/IVA'),
          h('div', { style:{ fontSize:22, fontWeight:600, color:'var(--blue)' } }, fmt(calc.ventaTotal)),
        ),
        h('div', { style:{ fontSize:12, color:'var(--t3)', marginTop:4 } }, 'Venta s/IVA: ',fmt(calc.ventaSIVA),' · IVA cobrado: ',fmt(calc.ivaVenta)),
      ),
      // Tabla por partida
      h('div', { className:'card', style:{ marginBottom:12 } },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:10 } }, 'Por partida'),
        h('div', { style:{ overflowX:'auto' } },
          h('table', { style:{ fontSize:12 } },
            h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
              ['Partida','Vehículo','Qty','Costo veh c/IVA','Equipo c/IVA','Costo total c/IVA','Venta c/IVA','Util. bruta s/IVA','Margen s/costo'].map(hd=>h('td',{key:hd,style:{padding:'6px 6px',color:'var(--t2)',fontSize:10}},hd))
            )),
            h('tbody', null, activeParts.map(p=>{
              const pi=parseInt(p.id.replace('P',''))-1, qty=p.cantidad||0;
              const vehCIVA=(p.costoMSMS||0)*qty, vehSIVA=vehCIVA/(1+IVA);
              const eqCIVA=cot.equipo.filter(e=>e.usar).reduce((s,e)=>{const c=(e.cnts&&e.cnts[pi])||0;return s+(e.costoConIVA||0)*c;},0)*qty;
              const eqSIVA=cot.equipo.filter(e=>e.usar).reduce((s,e)=>{const c=(e.cnts&&e.cnts[pi])||0;return s+(e.llevaIVA?(e.costoConIVA||0)/(1+IVA):(e.costoConIVA||0))*c;},0)*qty;
              const costoUnitSIVA=vehSIVA/qty+eqSIVA/qty;
              let pvUnitSIVA=0;
              if(p.modoPrecio==='Techo presupuestal')pvUnitSIVA=(p.techo||0)>0?(p.techo||0)/(1+IVA):costoUnitSIVA;
              else if(p.modoPrecio==='Utilidad deseada $')pvUnitSIVA=costoUnitSIVA+(p.utilidadDeseada||0);
              else pvUnitSIVA=costoUnitSIVA*(1+(p.utilidadPct||0));
              const pvCIVA=pvUnitSIVA*qty*(1+IVA), costTotalSIVA=vehSIVA+eqSIVA;
              const util=pvUnitSIVA*qty-costTotalSIVA, margen=costTotalSIVA>0?util/costTotalSIVA:0;
              return h('tr', { key:p.id, style:{ borderBottom:'.5px solid var(--b3)' } },
                h('td', { style:{ padding:'9px 6px', fontWeight:600, color:'var(--blue)' } }, p.id),
                h('td', { style:{ padding:'9px 6px', fontSize:11, color:'var(--t2)' } }, p.marca,' ',p.modelo, p.version?' · '+p.version:''),
                h('td', { style:{ padding:'9px 6px', fontWeight:500 } }, qty),
                h('td', { style:{ padding:'9px 6px' } }, fmt(vehCIVA)),
                h('td', { style:{ padding:'9px 6px' } }, fmt(eqCIVA)),
                h('td', { style:{ padding:'9px 6px' } }, fmt(vehCIVA+eqCIVA)),
                h('td', { style:{ padding:'9px 6px', fontWeight:500, color:'var(--blue)' } }, fmt(pvCIVA)),
                h('td', { style:{ padding:'9px 6px', color:util>0?'var(--green)':'var(--red)' } }, fmt(util)),
                h('td', { style:{ padding:'9px 6px', fontWeight:500, color:margen>=.2?'var(--green)':margen>=.1?'var(--amber)':'var(--red)' } }, pctS(margen)),
              );
            })),
            h('tfoot', null, h('tr', { style:{ borderTop:'1px solid var(--b2)', background:'var(--bg2)' } },
              h('td', { colSpan:5, style:{ padding:'10px 6px', fontWeight:500, fontSize:12 } }, 'TOTALES PROYECTO'),
              h('td', { style:{ padding:'10px 6px', fontWeight:600, fontSize:12 } }, fmt(calc.costoTotalCIVA)),
              h('td', { style:{ padding:'10px 6px', fontWeight:600, color:'var(--blue)', fontSize:13 } }, fmt(calc.ventaTotal)),
              h('td', { style:{ padding:'10px 6px', fontWeight:600, color:calc.utilBruta>0?'var(--green)':'var(--red)' } }, fmt(calc.utilBruta)),
              h('td', { style:{ padding:'10px 6px', fontWeight:600, color:calc.margen>=.2?'var(--green)':calc.margen>=.1?'var(--amber)':'var(--red)' } }, pctS(calc.margen)),
            )),
          )
        ),
      ),
      // Retornos + IVA
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 } },
        h('div', { className:'card' },
          h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:10 } }, 'Retornos desglosados'),
          cot.retornos.filter(r=>r.activo).length===0
            ? h('div', { style:{ fontSize:12, color:'var(--t3)' } }, 'Sin retornos.')
            : h('div', null,
                cot.retornos.filter(r=>r.activo).map(r=>{
                  const val=Number(r.valor||0); let monto=0;
                  if(r.base==='% sobre venta c/IVA')monto=calc.ventaTotal*val/100;
                  else if(r.base==='% sobre venta s/IVA')monto=calc.ventaSIVA*val/100;
                  else if(r.base==='Monto fijo total')monto=val;
                  else if(r.base==='Monto fijo por unidad')monto=val*calc.unidades;
                  return h('div', { key:r.id, style:{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'.5px solid var(--b3)', fontSize:12 } },
                    h('span', null, r.nombre,' ', r.base.startsWith('%')?'('+val+'%)':''),
                    h('span', { style:{ color:'var(--red)', fontWeight:500 } }, fmt(monto)),
                  );
                }),
                h('div', { style:{ display:'flex', justifyContent:'space-between', paddingTop:8, fontSize:13, fontWeight:600 } },
                  h('span', null, 'TOTAL RETORNOS'), h('span', { style:{ color:'var(--red)' } }, fmt(calc.totalRetornos)),
                ),
              ),
        ),
        h('div', { className:'card' },
          h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:10 } }, 'Desglose de IVAs'),
          [['IVA cobrado al cliente',fmt(calc.ivaVenta),'var(--t1)',false],['− IVA acreditable (costos)',fmt(calc.ivaAcreditable),'var(--t2)',false],['IVA sobrante',fmt(calc.ivaSobrante),'var(--t1)',true],['IVA pagado al SAT',fmt(calc.ivaAlSAT),'var(--t2)',false],['IVA a utilidad',fmt(calc.ivaAUtilidad),'var(--green)',false]].map(([l,v,c,bold])=>
            h('div', { key:l, style:{ display:'flex', justifyContent:'space-between', fontSize:12, fontWeight:bold?600:400, padding:'7px 0', borderBottom:'.5px solid var(--b3)' } },
              h('span', { style:{ color:'var(--t2)' } }, l), h('span', { style:{ color:c, fontWeight:bold?600:500 } }, v),
            )
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:12 } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, '% al SAT'), h(NumInput, { value:Math.round((cot.pctIvaSat||.5)*100), onChange:v=>updCot({...cot,pctIvaSat:v/100,pctIvaUtil:1-v/100}), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, '% a utilidad'), h('input', { type:'number', value:Math.round((cot.pctIvaUtil||.5)*100), readOnly:true, style:{ fontSize:12, background:'var(--bg2)' } })),
          ),
        ),
      ),
      // Cascada utilidad
      h('div', { className:'card' },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:12 } }, 'Utilidad y desglose'),
        h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 } },
          h('div', null,
            [['Utilidad bruta s/IVA',fmt(calc.utilBruta),calc.utilBruta>0?'var(--green)':'var(--red)',false],['+ IVA a utilidad',fmt(calc.ivaAUtilidad),'var(--t2)',false],['UTILIDAD NETA',fmt(calc.utilNeta),calc.utilNeta>0?'var(--green)':'var(--red)',true],['Margen neto s/costo',pctS(calc.margenNeto),calc.margenNeto>=.2?'var(--green)':calc.margenNeto>=.1?'var(--amber)':'var(--red)',false]].map(([l,v,c,bold])=>
              h('div', { key:l, style:{ display:'flex', justifyContent:'space-between', fontSize:bold?14:13, fontWeight:bold?700:400, padding:bold?'12px 10px':'8px 0', borderBottom:'.5px solid var(--b3)', background:bold?'var(--bg2)':'transparent', borderRadius:bold?'var(--r)':'0', marginTop:bold?4:0 } },
                h('span', { style:{ color:bold?'var(--t1)':'var(--t2)' } }, l), h('span', { style:{ color:c } }, v),
              )
            )
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, alignContent:'start' } },
            [['Costo total s/IVA',fmt(calc.costoTotalSIVA),'var(--t2)'],['Costo total c/IVA',fmt(calc.costoTotalCIVA),'var(--t2)'],['Venta total s/IVA',fmt(calc.ventaSIVA),'var(--t1)'],['Venta total c/IVA',fmt(calc.ventaTotal),'var(--blue)'],['Unidades totales',calc.unidades+' uds','var(--t1)'],['Margen bruto s/costo',pctS(calc.margen),calc.margen>=.2?'var(--green)':'var(--amber)']].map(([l,v,c])=>
              h('div', { key:l, style:{ padding:'8px 0', borderBottom:'.5px solid var(--b3)' } },
                h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, l),
                h('div', { style:{ fontSize:13, fontWeight:500, color:c } }, v),
              )
            )
          ),
        ),
      ),
      h(NavButtons),
    ),

    // ══ 5. AGENTE ══
    tab==='agente' && h('div', null,
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:4 } }, 'Agente cotizador MSMS · Claude'),
        h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } },
          project.name,' · ',calc.unidades,' vehículos · ',fmt(calc.ventaTotal),' · margen bruto ',pctS(calc.margen),' · NETA ',fmt(calc.utilNeta),
          cot.equipo.filter(e=>e.usar&&(e.est==='Estimado'||e.est==='Pendiente MSM')).length>0 && h('span', { style:{ color:'var(--amber)' } }, ' · ⚠ ',cot.equipo.filter(e=>e.usar&&(e.est==='Estimado'||e.est==='Pendiente MSM')).length,' costos sin confirmar'),
        ),
        h('div', { style:{ display:'flex', gap:8, marginBottom:10 } },
          h('input', { value:aiMsg, onChange:e=>setAiMsg(e.target.value), placeholder:'¿Cómo mejorar el margen? ¿Qué equipo falta?...', style:{ flex:1 }, onKeyDown:e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),askAgent()) }),
          h('button', { className:'bp', onClick:askAgent, disabled:aiLoading }, aiLoading?'Consultando...':'Preguntar'),
        ),
        !aiResp&&!aiLoading && h('div', { style:{ display:'flex', gap:6, flexWrap:'wrap' } },
          ['¿Es suficiente el margen?','¿Qué equipo es estándar para una pickup patrulla?','Analiza los riesgos de esta cotización','¿Qué costos confirmar urgente?'].map(s=>
            h('button', { key:s, onClick:()=>setAiMsg(s), style:{ fontSize:11, padding:'5px 10px', color:'var(--blue)', border:'.5px solid var(--blue)33', borderRadius:10 } }, s)
          )
        ),
        aiResp && h('div', { style:{ marginTop:12, padding:14, background:'var(--bg2)', borderRadius:'var(--r)', fontSize:13, lineHeight:1.75, whiteSpace:'pre-wrap' } }, aiResp),
      ),
      h(NavButtons),
    ),
  );
}
