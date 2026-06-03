// Companies.js — Empresas licitantes
import { h, useState, useRef } from '../lib/core.js';
import { AIAnalyzerButton } from '../ui/AIAnalyzerButton.js';
import { EMPRESA_BASE_DOCS } from '../lib/constants.js';
import { extractPdfText, parseActa, parseConstanciaFiscal } from '../lib/pdf.js';
import { TODAY, uid, dlFile, fmtBytes } from '../lib/utils.js';
import { Inp, EmptyState, DeleteConfirmModal, InfoModal } from '../ui/primitives.js';

export function EmpresaDocsCard({ company, onUpdate }) {
  const docs = company.baseDocs || [];
  const getDoc = id => docs.find(d=>d.id===id)||null;
  const handleUpload = async (def, file) => {
    let fileData = null;
    if (def.storeFile) {
      if (file.size>4*1024*1024){alert('Archivo muy grande (máx. 4MB)');return;}
      try{fileData=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});}catch(e){alert('Error: '+e.message);return;}
    }
    const newDoc={id:def.id,name:def.name,category:def.category,status:'guardado',uploadDate:TODAY(),fileName:file.name,fileSize:file.size,fileData,expirationDate:'',notes:''};
    const updated=docs.find(d=>d.id===def.id)?docs.map(d=>d.id===def.id?newDoc:d):[...docs,newDoc];
    onUpdate({...company,baseDocs:updated});
  };
  const rmDoc  = id   => onUpdate({...company,baseDocs:docs.filter(d=>d.id!==id)});
  const setExp = (id,date) => onUpdate({...company,baseDocs:docs.map(d=>d.id===id?{...d,expirationDate:date}:d)});
  return h('div', { className:'card', style:{ marginBottom:20 } },
    h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:6 } }, 'Documentos base de la empresa'),
    h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:14 } }, 'El acta constitutiva y la CSF se guardan en el sistema.'),
    h('div', { style:{ display:'flex', flexDirection:'column', gap:8 } },
      EMPRESA_BASE_DOCS.map(def => {
        const doc=getDoc(def.id), stored=!!(doc&&doc.status==='guardado');
        return h('div', { key:def.id, style:{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--bg2)', borderRadius:'var(--r)', border:'.5px solid var(--b3)', flexWrap:'wrap' } },
          h('span', { style:{ fontSize:16 } }, stored?'✅':'⬜'),
          h('div', { style:{ flex:1, minWidth:180 } },
            h('div', { style:{ fontSize:13, fontWeight:500 } }, def.name),
            h('div', { style:{ fontSize:11, color:'var(--t2)' } }, def.category, def.hint?' · '+def.hint:''),
            stored && h('div', { style:{ fontSize:11, color:'var(--green)', marginTop:2 } }, '📎 ',doc.fileName,' · ',fmtBytes(doc.fileSize),' · ',doc.uploadDate),
          ),
          stored && h('input', { type:'date', value:doc.expirationDate||'', onChange:e=>setExp(def.id,e.target.value), style:{ width:140, fontSize:11, padding:'4px 8px' }, title:'Fecha de vencimiento' }),
          stored && def.storeFile && doc.fileData && h('button', { onClick:()=>dlFile(doc.fileData,doc.fileName), style:{ fontSize:11, padding:'4px 10px', color:'var(--blue)' } }, '⬇ Descargar'),
          stored
            ? h('button', { onClick:()=>rmDoc(def.id), style:{ fontSize:11, padding:'4px 10px', color:'var(--red)', background:'transparent', border:'.5px solid #E24B4A55' } }, 'Quitar')
            : h('label', { style:{ fontSize:11, padding:'5px 12px', background:'var(--t1)', color:'var(--bg1)', borderRadius:'var(--r)', cursor:'pointer', fontWeight:500 } }, '+ Subir',
                h('input', { type:'file', accept:'.pdf,.jpg,.jpeg,.png', style:{ display:'none' }, onChange:e=>{ if(e.target.files[0])handleUpload(def,e.target.files[0]); } })
              ),
        );
      })
    ),
  );
}

export function CompanyProfile({ company, onSave, onBack, onRequestDelete, user, logFn, config }) {
  const [c, sC]       = useState(JSON.parse(JSON.stringify(company)));
  const handleAIResult = (data) => {
    if (data.razonSocial) sC(x=>({...x,razonSocial:data.razonSocial}));
    if (data.nombreComercial) sC(x=>({...x,nombreComercial:data.nombreComercial}));
    if (data.rfc) sC(x=>({...x,rfc:data.rfc}));
    if (data.domicilioFiscal) sC(x=>({...x,domicilio:data.domicilioFiscal}));
    if (data.representanteLegal) sC(x=>({...x,representanteLegal:data.representanteLegal}));
    if (data.telefono) sC(x=>({...x,telefono:data.telefono}));
    if (data.correo) sC(x=>({...x,correo:data.correo}));
  };
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState('');
  const [newSocio, setNewSocio] = useState({ nombre:'', porcentaje:'' });
  const actaRef = useRef(null), csfRef = useRef(null);
  const set = (k,v) => sC(p=>({...p,[k]:v}));

  const handleActa = async file => {
    setParsing(true); setParseMsg('Analizando acta constitutiva...');
    try {
      const text=await extractPdfText(file), found=parseActa(text);
      const updated={...c}; let msg='Acta constitutiva — campos detectados:\n',n=0;
      if(found.name&&!c.name){updated.name=found.name;msg+='• Razón social\n';n++;}
      if(found.rfc&&!c.rfc){updated.rfc=found.rfc;msg+='• RFC: '+found.rfc+'\n';n++;}
      if(found.notario){updated.notario=found.notario;msg+='• Notario\n';n++;}
      if(found.notaria){updated.notaria=found.notaria;msg+='• Notaría\n';n++;}
      if(found.escritura){updated.escritura=found.escritura;msg+='• Escritura\n';n++;}
      if(found.estado){updated.estado=found.estado;msg+='• Estado\n';n++;}
      if(found.objetoSocial){updated.objetoSocial=found.objetoSocial;msg+='• Objeto social\n';n++;}
      if(found.socios?.length){updated.socios=found.socios;msg+='• '+found.socios.length+' socio(s)\n';n++;}
      if(n===0)msg='No se detectó información automáticamente.';
      else msg+='\n'+n+' campo(s) llenados.';
      sC(updated); setParseMsg(msg);
    } catch(e){ setParseMsg('Error: '+e.message); }
    setParsing(false);
  };

  const handleCSF = async file => {
    setParsing(true); setParseMsg('Analizando constancia fiscal...');
    try {
      const text=await extractPdfText(file), found=parseConstanciaFiscal(text);
      const updated={...c}; let msg='Constancia fiscal — campos detectados:\n',n=0;
      if(found.rfc){updated.rfc=found.rfc;msg+='• RFC: '+found.rfc+'\n';n++;}
      if(found.name&&!c.name){updated.name=found.name;msg+='• Razón social\n';n++;}
      if(found.regimen){updated.regimen=found.regimen;msg+='• Régimen\n';n++;}
      if(found.situacion){updated.situacion=found.situacion;msg+='• Situación\n';n++;}
      if(found.cp){updated.cp=found.cp;msg+='• CP: '+found.cp+'\n';n++;}
      if(found.address&&!c.address){updated.address=found.address;msg+='• Domicilio\n';n++;}
      if(n===0)msg='No se detectó información automáticamente.';
      sC(updated); setParseMsg(msg);
    } catch(e){ setParseMsg('Error: '+e.message); }
    setParsing(false);
  };

  const addSocio = () => { if(!newSocio.nombre)return; sC(p=>({...p,socios:[...(p.socios||[]),{nombre:newSocio.nombre,porcentaje:parseFloat(newSocio.porcentaje)||0}]})); setNewSocio({nombre:'',porcentaje:''}); };
  const rmSocio  = i => sC(p=>({...p,socios:(p.socios||[]).filter((_,j)=>j!==i)}));
  const sumSocios = (c.socios||[]).reduce((s,x)=>s+(x.porcentaje||0),0);
  const save = () => { onSave(c); if(logFn)logFn(user,c.id?'actualizó':'creó','empresa',c.id||'new',c.name||''); onBack(); };

  return h('div', null,
    h('div', { style:{ display:'flex', alignItems:'center', gap:8, marginBottom:6 } },
      h('span', { onClick:onBack, style:{ fontSize:12, color:'var(--blue)', cursor:'pointer' } }, 'Empresas'),
      h('span', { style:{ fontSize:12, color:'var(--t2)' } }, '/'),
      h('span', { style:{ fontSize:12 } }, c.name||'Nueva empresa'),
    ),
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { style:{ fontSize:20, fontWeight:500 } }, c.name||'Configurar empresa'),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:onBack }, 'Cancelar'),
        h('button', { className:'bp', onClick:save }, 'Guardar empresa'),
      ),
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8 } }, 'Cargar acta constitutiva (PDF)'),
        h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } }, 'Detecta: notario, notaría, escritura, estado, socios.'),
        h('div', { className:'drop', onClick:()=>actaRef.current&&actaRef.current.click(), onDragOver:e=>{e.preventDefault();e.currentTarget.classList.add('over');}, onDragLeave:e=>e.currentTarget.classList.remove('over'), onDrop:e=>{e.preventDefault();e.currentTarget.classList.remove('over');if(e.dataTransfer.files[0])handleActa(e.dataTransfer.files[0]);} },
          h('input', { ref:actaRef, type:'file', accept:'.pdf', style:{ display:'none' }, onChange:e=>e.target.files[0]&&handleActa(e.target.files[0]) }),
          h('div', { style:{ fontSize:12, color:'var(--t2)' } }, parsing?'Procesando...':'Arrastra el acta o haz clic'),
        ),
      ),
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8 } }, 'Cargar constancia fiscal (PDF)'),
        h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } }, 'Detecta: RFC, régimen, situación, CP, domicilio.'),
        h('div', { className:'drop', onClick:()=>csfRef.current&&csfRef.current.click(), onDragOver:e=>{e.preventDefault();e.currentTarget.classList.add('over');}, onDragLeave:e=>e.currentTarget.classList.remove('over'), onDrop:e=>{e.preventDefault();e.currentTarget.classList.remove('over');if(e.dataTransfer.files[0])handleCSF(e.dataTransfer.files[0]);} },
          h('input', { ref:csfRef, type:'file', accept:'.pdf', style:{ display:'none' }, onChange:e=>e.target.files[0]&&handleCSF(e.target.files[0]) }),
          h('div', { style:{ fontSize:12, color:'var(--t2)' } }, parsing?'Procesando...':'Arrastra la CSF o haz clic'),
        ),
      ),
    ),
    parseMsg && h('pre', { style:{ fontSize:12, background:'var(--bg2)', padding:12, borderRadius:'var(--r)', whiteSpace:'pre-wrap', lineHeight:1.6, marginBottom:16 } }, parseMsg),
    h('div', { style:{ marginBottom:16, padding:'12px 14px', background:'var(--bg2)', borderRadius:'var(--r)', display:'flex', alignItems:'center', gap:12, border:'.5px solid var(--b3)' } },
      h('span', { style:{ fontSize:20 } }, String.fromCodePoint(0x1F916)),
      h('div', { style:{ flex:1 } },
        h('div', { style:{ fontSize:12, fontWeight:600 } }, 'Analizar documento con IA'),
        h('div', { style:{ fontSize:11, color:'var(--t2)' } }, 'Sube el acta constitutiva o CSF y GPT-4 llenara los campos automaticamente')
      ),
      h(AIAnalyzerButton, { config, tipo:'empresa', label:'Subir y analizar', onResult:handleAIResult })
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos generales'),
        h(Inp, { label:'Razón social', value:c.name||'', onChange:v=>set('name',v) }),
        h(Inp, { label:'RFC', value:c.rfc||'', onChange:v=>set('rfc',v) }),
        h(Inp, { label:'Régimen fiscal', value:c.regimen||'', onChange:v=>set('regimen',v) }),
        h(Inp, { label:'Domicilio fiscal', value:c.address||'', onChange:v=>set('address',v), textarea:true }),
        h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
          h(Inp, { label:'CP', value:c.cp||'', onChange:v=>set('cp',v) }),
          h(Inp, { label:'Estado', value:c.estado||'', onChange:v=>set('estado',v) }),
        ),
        h(Inp, { label:'Situación en el padrón', value:c.situacion||'', onChange:v=>set('situacion',v), placeholder:'Activo' }),
      ),
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos notariales'),
        h(Inp, { label:'Notario público', value:c.notario||'', onChange:v=>set('notario',v) }),
        h(Inp, { label:'Notaría', value:c.notaria||'', onChange:v=>set('notaria',v) }),
        h(Inp, { label:'Número de escritura', value:c.escritura||'', onChange:v=>set('escritura',v) }),
        h(Inp, { label:'Fecha de escritura', value:c.fechaEscritura||'', onChange:v=>set('fechaEscritura',v), type:'date' }),
      ),
    ),
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8 } }, 'Objeto social'),
      h(Inp, { value:c.objetoSocial||'', onChange:v=>set('objetoSocial',v), textarea:true }),
    ),
    h('div', { className:'card', style:{ marginBottom:20 } },
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 } },
        h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Socios / Accionistas'),
        (c.socios||[]).length>0 && h('span', { style:{ fontSize:11, color:sumSocios===100?'var(--green)':'var(--red)' } }, 'Suma: ',sumSocios,'%'),
      ),
      (c.socios||[]).map((s,i) =>
        h('div', { key:i, style:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'.5px solid var(--b3)', fontSize:13 } },
          h('span', null, s.nombre), h('span', { style:{ fontWeight:500 } }, s.porcentaje,'%'),
          h('button', { onClick:()=>rmSocio(i), style:{ fontSize:11, color:'var(--red)', background:'transparent', border:'none', cursor:'pointer' } }, 'x'),
        )
      ),
      h('div', { style:{ display:'flex', gap:8, alignItems:'flex-end', marginTop:10 } },
        h('div', { style:{ flex:1 } }, h('label', { style:{ fontSize:11, color:'var(--t2)' } }, 'Nombre'), h('input', { value:newSocio.nombre, onChange:e=>setNewSocio(p=>({...p,nombre:e.target.value})) })),
        h('div', { style:{ width:100 } }, h('label', { style:{ fontSize:11, color:'var(--t2)' } }, '%'), h('input', { type:'number', value:newSocio.porcentaje, onChange:e=>setNewSocio(p=>({...p,porcentaje:e.target.value})) })),
        h('button', { onClick:addSocio }, '+ Agregar'),
      ),
    ),
    h(EmpresaDocsCard, { company:c, onUpdate:sC }),
    onRequestDelete && h('div', { className:'card', style:{ borderLeft:'3px solid #E24B4A', marginBottom:20 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8, color:'#E24B4A' } }, 'Zona de peligro'),
      h('button', { onClick:onRequestDelete, style:{ background:'transparent', color:'#E24B4A', border:'1px solid #E24B4A', fontSize:13, padding:'8px 18px', fontWeight:500 } }, '🗑 Eliminar esta empresa'),
    ),
  );
}

export default function Companies({ companies, setCompanies, projects, user, logFn }) {
  const [sel, setSel]             = useState(null);
  const [deleteState, setDeleteState] = useState(null);
  const requestDelete = c => setDeleteState({ company:c, relatedProjects:projects.filter(p=>p.company===c.name) });
  const confirmDelete = () => { const c=deleteState.company; setCompanies(companies.filter(x=>x.id!==c.id)); if(logFn)logFn(user,'eliminó','empresa',c.id,c.name); setDeleteState(null); setSel(null); };

  if (sel !== null) {
    const co = sel==='new'
      ? {id:uid('emp'),name:'',rfc:'',address:'',notario:'',notaria:'',escritura:'',fechaEscritura:'',estado:'',objetoSocial:'',socios:[],regimen:'',cp:'',situacion:''}
      : companies.find(c=>c.id===sel);
    if (!co) { setSel(null); return null; }
    return h('div', null,
      h(CompanyProfile, { company:co, onSave:c=>{ const ex=companies.find(x=>x.id===c.id); setCompanies(ex?companies.map(x=>x.id===c.id?c:x):[...companies,c]); }, onBack:()=>setSel(null), onRequestDelete:sel==='new'?null:()=>requestDelete(co), user, logFn }),
      deleteState && renderDeleteModal(deleteState,setDeleteState,confirmDelete),
    );
  }

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { style:{ fontSize:20, fontWeight:500 } }, 'Empresas licitantes'),
      h('button', { className:'bp', onClick:()=>setSel('new') }, '+ Nueva empresa'),
    ),
    companies.length===0
      ? h(EmptyState, { icon:'◈', title:'No tienes empresas registradas', description:'Sube el acta constitutiva para llenar los datos automáticamente.', actionLabel:'+ Crear primera empresa', onAction:()=>setSel('new') })
      : h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))', gap:16 } },
          companies.map(c => {
            const related=projects.filter(p=>p.company===c.name);
            return h('div', { key:c.id, className:'card', style:{ cursor:'pointer', position:'relative' }, onClick:()=>setSel(c.id) },
              h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12, gap:12 } },
                h('div', { style:{ flex:1, minWidth:0 } },
                  h('div', { style:{ fontSize:15, fontWeight:500, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis' } }, c.name||'(Sin nombre)'),
                  h('div', { style:{ fontSize:12, color:'var(--t2)' } }, c.rfc||'Sin RFC', ' · ', c.regimen||'Sin régimen'),
                ),
                h('button', { onClick:e=>{ e.stopPropagation(); requestDelete(c); }, style:{ flexShrink:0, fontSize:11, padding:'4px 10px', color:'#E24B4A', background:'transparent', border:'.5px solid #E24B4A33' } }, '🗑 Eliminar'),
              ),
              h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', fontSize:12 } },
                [['Notario',c.notario],['Notaría',c.notaria],['Escritura',c.escritura],['Estado',c.estado]].map(([l,v],i) =>
                  h('div', { key:i, style:{ padding:'6px 0', borderTop:'.5px solid var(--b3)' } },
                    h('div', { style:{ color:'var(--t2)', fontSize:11 } }, l),
                    h('div', null, v||'—'),
                  )
                )
              ),
              h('div', { style:{ marginTop:8, paddingTop:8, borderTop:'.5px solid var(--b3)', fontSize:12, color:'var(--t2)', display:'flex', justifyContent:'space-between' } },
                h('span', null, (c.socios||[]).length,' socio(s)'),
                related.length>0 && h('span', { style:{ color:'var(--blue)', fontWeight:500 } }, related.length,' proyecto(s)'),
              ),
            );
          })
        ),
    deleteState && renderDeleteModal(deleteState,setDeleteState,confirmDelete),
  );
}

function renderDeleteModal(state, setState, onConfirm) {
  const { company:c, relatedProjects:related } = state;
  if (related.length > 0)
    return h(InfoModal, { title:'No se puede eliminar', message:'La empresa "'+c.name+'" tiene '+related.length+' proyecto(s) asociado(s). Cambia la empresa de esos proyectos primero.', onClose:()=>setState(null) });
  return h(DeleteConfirmModal, { title:'¿Eliminar empresa?', message:'Vas a eliminar la empresa "'+(c.name||'sin nombre')+'".', warning:'Esta acción no se puede deshacer.', confirmLabel:'Sí, eliminar empresa', onConfirm, onCancel:()=>setState(null) });
}
