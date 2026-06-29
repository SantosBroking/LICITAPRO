// Firmas.js — Buzón de pendientes de firma
import { h, useState, useRef } from '../lib/core.js';
import { EmptyState } from '../ui/primitives.js';
import { fmtBytes, TODAY } from '../lib/utils.js';
import { uploadFileToStorage } from '../lib/supabase.js';

export default function FirmasView({ projects, user, onUpdateProject, onNav }) {
  const [filtro, setFiltro] = useState('pendiente'); // 'pendiente' | 'firmado' | 'todos'
  const [busyId, setBusyId] = useState(null);
  const fileRefs = useRef({});

  // Juntar todos los pendientes de todos los proyectos
  const todos = [];
  projects.forEach(p => (p.firmas||[]).forEach(f => todos.push({ ...f, proyecto:p })));
  todos.sort((a,b)=>(b.fechaSolicitud||'').localeCompare(a.fechaSolicitud||''));

  const lista = todos.filter(f => filtro==='todos' ? true : f.estatus===filtro);
  const numPend = todos.filter(f=>f.estatus==='pendiente').length;

  // Subir el documento firmado → marca el pendiente como firmado
  const subirFirmado = async (pend, file) => {
    if (!file) return;
    setBusyId(pend.id);
    try {
      const path = `firmas/${pend.proyecto.id}/${pend.id}-${file.name}`;
      const url = await uploadFileToStorage(path, file);
      const proy = pend.proyecto;
      const firmasAct = (proy.firmas||[]).map(f => f.id===pend.id
        ? { ...f, estatus:'firmado', archivoFirmado:{ url:url||'', nombre:file.name, size:file.size, tipo:file.type||'', fecha:TODAY(), subidoPor:user?.name||user?.email||'' } }
        : f);
      onUpdateProject({ ...proy, firmas: firmasAct });
    } catch(e) { console.error(e); alert('Error al subir el documento firmado'); }
    setBusyId(null);
  };

  const verFirmado = (pend) => { if (pend.archivoFirmado?.url) window.open(pend.archivoFirmado.url, '_blank'); };

  const quitarPendiente = (pend) => {
    if (!confirm('¿Eliminar este pendiente de firma? No se puede deshacer.')) return;
    const proy = pend.proyecto;
    onUpdateProject({ ...proy, firmas:(proy.firmas||[]).filter(f=>f.id!==pend.id) });
  };

  const reabrir = (pend) => {
    const proy = pend.proyecto;
    const firmasAct = (proy.firmas||[]).map(f => f.id===pend.id ? { ...f, estatus:'pendiente', archivoFirmado:null } : f);
    onUpdateProject({ ...proy, firmas: firmasAct });
  };

  const iconoTipo = (t) => t==='oc'?'🛒':t==='acta'?'📋':t==='documento'?'📝':'📄';

  return h('div', { className:'main-content' },
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 } },
      h('h1', { style:{ fontSize:22, fontWeight:600, margin:0 } }, 'Firmas'),
    ),
    h('p', { style:{ fontSize:13, color:'var(--t2)', marginTop:0, marginBottom:20 } },
      'Buzón de documentos pendientes de firma. El pendiente no se quita hasta que se sube el documento firmado.'),

    // Filtros
    h('div', { style:{ display:'flex', gap:8, marginBottom:16 } },
      [['pendiente','Pendientes ('+numPend+')'],['firmado','Firmados'],['todos','Todos']].map(([k,label]) =>
        h('button', { key:k, onClick:()=>setFiltro(k),
          style:{ fontSize:13, padding:'7px 14px', borderRadius:'var(--r)', cursor:'pointer',
            background: filtro===k?'var(--t1)':'var(--bg2)', color: filtro===k?'#fff':'var(--t2)',
            border:'1px solid '+(filtro===k?'var(--t1)':'var(--b2)') } }, label)
      ),
    ),

    lista.length===0
      ? h('div', { className:'card' }, h(EmptyState, { icon:'✍️', title: filtro==='pendiente'?'Sin pendientes de firma':'Nada por aquí', description: filtro==='pendiente'?'Cuando se mande un documento a firma, aparecerá aquí.':'No hay documentos en esta vista.' }))
      : h('div', { style:{ display:'flex', flexDirection:'column', gap:12 } },
          lista.map(pend => h('div', { key:pend.id, className:'card', style:{ borderLeft:'3px solid '+(pend.estatus==='firmado'?'#1D9E75':'#EF9F27') } },
            h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' } },
              h('div', { style:{ flex:1, minWidth:0 } },
                h('div', { style:{ fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:6 } },
                  h('span', null, iconoTipo(pend.tipo)),
                  h('span', null, pend.titulo),
                  pend.folio && h('span', { style:{ fontSize:11, fontWeight:400, color:'var(--t3)', fontFamily:'monospace' } }, pend.folio),
                ),
                h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:4 } },
                  '📁 ', h('span', { style:{ color:'var(--blue)', cursor:'pointer' }, onClick:()=>onNav&&onNav('project_detail',pend.proyecto.id) }, pend.proyecto.name),
                  ' · Responsable: ', h('strong', null, pend.responsableNombre||pend.responsableEmail||'—'),
                ),
                h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } },
                  'Solicitado ', pend.fechaSolicitud, pend.solicitadoPor?' por '+pend.solicitadoPor:'',
                  pend.estatus==='firmado' && pend.archivoFirmado ? ' · Firmado '+pend.archivoFirmado.fecha+(pend.archivoFirmado.subidoPor?' por '+pend.archivoFirmado.subidoPor:'') : '',
                ),
                pend.notas && h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:6, fontStyle:'italic' } }, '“'+pend.notas+'”'),
              ),
              h('div', { style:{ flexShrink:0 } },
                pend.estatus==='pendiente'
                  ? h('span', { style:{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:10, background:'#FAEEDA', color:'#633806' } }, '⏳ Pendiente')
                  : h('span', { style:{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:10, background:'#E1F5EE', color:'#085041' } }, '✓ Firmado'),
              ),
            ),
            // Acciones
            h('div', { style:{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' } },
              pend.estatus==='pendiente'
                ? h('div', null,
                    h('input', { ref:el=>fileRefs.current[pend.id]=el, type:'file', accept:'application/pdf,image/*', style:{ display:'none' },
                      onChange:e=>{ subirFirmado(pend, e.target.files[0]); e.target.value=''; } }),
                    h('button', { className:'bp', disabled:busyId===pend.id, onClick:()=>fileRefs.current[pend.id]&&fileRefs.current[pend.id].click() },
                      busyId===pend.id?'Subiendo...':'📎 Subir documento firmado'),
                  )
                : h('div', { style:{ display:'flex', gap:8 } },
                    pend.archivoFirmado?.url && h('button', { onClick:()=>verFirmado(pend), style:{ fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '📄 Ver firmado'),
                    h('button', { onClick:()=>reabrir(pend), style:{ fontSize:13, padding:'8px 14px', background:'transparent', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer', color:'var(--t2)' } }, 'Reabrir'),
                  ),
              h('button', { onClick:()=>quitarPendiente(pend), style:{ fontSize:12, padding:'8px 12px', background:'transparent', border:'none', cursor:'pointer', color:'var(--red)', marginLeft:'auto' } }, 'Eliminar'),
            ),
          ))
        )
  );
}
