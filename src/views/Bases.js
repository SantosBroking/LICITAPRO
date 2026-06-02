// Bases.js — Checklist y datos de las bases
import { h, useState } from '../lib/core.js';
import { TODAY, uid } from '../lib/utils.js';
import { Inp, EmptyState } from '../ui/primitives.js';

export function ChecklistItem({ item, onChange, onRemove }) {
  return h('div', { style:{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'var(--bg2)', borderRadius:'var(--r)', border:'.5px solid var(--b3)', marginBottom:6 } },
    h('input', { type:'checkbox', checked:item.checked||false, onChange:e=>onChange({...item,checked:e.target.checked}), style:{ width:16, height:16, accentColor:'var(--blue)', flexShrink:0, cursor:'pointer' } }),
    h('div', { style:{ flex:1, minWidth:0 } },
      h('div', { style:{ fontSize:13, fontWeight:item.checked?400:500, textDecoration:item.checked?'line-through':'none', color:item.checked?'var(--t2)':'var(--t1)' } }, item.name),
      item.category && h('div', { style:{ fontSize:10, color:'var(--t2)', marginTop:1 } }, item.category),
      item.notes && h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2, lineHeight:1.4 } }, item.notes),
    ),
    item.date && h('div', { style:{ fontSize:10, color:'var(--t3)', flexShrink:0 } }, item.date),
    h('button', { onClick:onRemove, style:{ background:'transparent', border:'none', color:'var(--t3)', cursor:'pointer', fontSize:14, padding:'0 4px', flexShrink:0 } }, '×'),
  );
}

export function BasesDetalle({ project, onUpdate, config }) {
  const prep = project.preparation || {};
  const setP = (k, v) => onUpdate({ ...project, preparation: { ...prep, [k]:v } });
  const handleAIResult = (data) => {
    const prep2 = { ...prep };
    if (data.urlConvocatoria) prep2.urlConvocatoria = data.urlConvocatoria;
    if (data.numeroLicitacion) prep2.numeroLicitacion = data.numeroLicitacion;
    if (data.fechaPublicacion) prep2.fechaPublicacion = data.fechaPublicacion;
    if (data.fechaJuntaAclaraciones) prep2.fechaJuntaAclaraciones = data.fechaJuntaAclaraciones;
    if (data.fechaPresentacion) prep2.fechaPresentacion = data.fechaPresentacion;
    if (data.fechaFallo) prep2.fechaFallo = data.fechaFallo;
    onUpdate({ ...project, preparation: prep2,
      dependencia: data.dependencia || project.dependencia,
      name: project.name || data.numeroLicitacion || project.name,
    });
  };

  return h('div', { className:'card' },
    h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:16 } }, 'Datos de las bases'),
    h('div', { style:{ marginBottom:16, padding:'12px 14px', background:'var(--bg2)', borderRadius:'var(--r)', display:'flex', alignItems:'center', gap:12 } },
      h('div', { style:{ flex:1 } },
        h('div', { style:{ fontSize:12, fontWeight:500, marginBottom:2 } }, '📄 Analizar bases con IA'),
        h('div', { style:{ fontSize:11, color:'var(--t2)' } }, 'Sube el PDF de bases y IA extraerá fechas, número de licitación y datos clave')
      ),
      h(AIAnalyzerButton, { config, tipo:'bases', label:'Subir y analizar', onResult: handleAIResult })
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
      h(Inp, { label:'URL de la convocatoria', value:prep.urlConvocatoria||'', onChange:v=>setP('urlConvocatoria',v), placeholder:'https://compranet...' }),
      h(Inp, { label:'No. de partidas en las bases', value:prep.numPartidas||'', onChange:v=>setP('numPartidas',v), type:'number' }),
      h(Inp, { label:'Fecha de visita a instalaciones', value:prep.fechaVisita||'', onChange:v=>setP('fechaVisita',v), type:'date' }),
      h(Inp, { label:'Lugar de presentación', value:prep.lugarPresentacion||'', onChange:v=>setP('lugarPresentacion',v) }),
      h(Inp, { label:'Monto de garantía', value:prep.montoGarantia||'', onChange:v=>setP('montoGarantia',v), type:'number' }),
    ),
    h(Inp, { label:'Requerimientos técnicos especiales', value:prep.reqTecnicos||'', onChange:v=>setP('reqTecnicos',v), textarea:true }),
    h(Inp, { label:'Observaciones de las bases', value:prep.obsBasesLicit||'', onChange:v=>setP('obsBasesLicit',v), textarea:true }),
  );
}

export default function BasesPreparacion({ project, config, onUpdate, user, logFn }) {
  const [newItem, setNewItem] = useState({ name:'', category:'Administrativo', notes:'' });
  const prep      = project.preparation || {};
  const checklist = prep.checklist || (config?.checklistTemplate||[]).map(t => ({...t, checked:false, date:''}));
  const saveList  = list => onUpdate({ ...project, preparation: { ...prep, checklist:list } });
  const checkItem = (id, updated) => saveList(checklist.map(it => it.id===id ? updated : it));
  const removeItem = id => saveList(checklist.filter(it => it.id!==id));
  const addItem = () => {
    if (!newItem.name) return;
    saveList([...checklist, { id:uid('chk'), ...newItem, checked:false, date:TODAY(), custom:true }]);
    setNewItem({ name:'', category:'Administrativo', notes:'' });
    if (logFn) logFn(user,'agregó','checklist',project.id,newItem.name);
  };
  const groupBy = {};
  checklist.forEach(it => { const c=it.category||'Otro'; if(!groupBy[c])groupBy[c]=[]; groupBy[c].push(it); });
  const total = checklist.length, done = checklist.filter(it=>it.checked).length;
  const pct = total>0 ? Math.round(done/total*100) : 0;
  return h('div', null,
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 } },
        h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Progreso del checklist'),
        h('div', { style:{ fontSize:20, fontWeight:500, color:pct===100?'var(--green)':'var(--blue)' } }, done,' / ',total),
      ),
      h('div', { style:{ height:8, background:'var(--b3)', borderRadius:4, overflow:'hidden' } },
        h('div', { style:{ height:'100%', width:pct+'%', background:pct===100?'var(--green)':'var(--blue)', borderRadius:4, transition:'width .4s' } }),
      ),
      h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:6 } }, pct+'% completado'),
    ),
    Object.entries(groupBy).map(([cat, items]) =>
      h('div', { key:cat, style:{ marginBottom:16 } },
        h('div', { style:{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:.5, color:'var(--t2)', marginBottom:6 } }, cat,' (',items.filter(i=>i.checked).length,'/',items.length,')'),
        items.map(it => h(ChecklistItem, { key:it.id, item:it, onChange:u=>checkItem(it.id,u), onRemove:()=>removeItem(it.id) })),
      )
    ),
    checklist.length===0 && h(EmptyState, { title:'Checklist vacío', description:'Agrega documentos al checklist.' }),
    h('div', { className:'card', style:{ marginTop:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Agregar documento'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12 } },
        h(Inp, { label:'Nombre', value:newItem.name, onChange:v=>setNewItem(p=>({...p,name:v})), placeholder:'Carta de intención...' }),
        h(Inp, { label:'Categoría', value:newItem.category, onChange:v=>setNewItem(p=>({...p,category:v})), options:['Administrativo','Técnico','Económico','Legal','Otro'] }),
      ),
      h(Inp, { label:'Notas', value:newItem.notes, onChange:v=>setNewItem(p=>({...p,notes:v})) }),
      h('button', { className:'bp', onClick:addItem }, '+ Agregar al checklist'),
    ),
    h('div', { style:{ marginTop:20 } },
      h('div', { style:{ fontSize:16, fontWeight:500, marginBottom:14 } }, 'Datos de las bases'),
      h(BasesDetalle, { project, onUpdate }),
    ),
  );
}
