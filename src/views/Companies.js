// Companies.js — Empresas licitantes
import { h, useState, useRef } from '../lib/core.js';
import { AIAnalyzerButton } from '../ui/AIAnalyzerButton.js';
import { EMPRESA_BASE_DOCS } from '../lib/constants.js';
import { TODAY, uid, dlFile, fmtBytes } from '../lib/utils.js';
import { Inp, EmptyState, DeleteConfirmModal, InfoModal } from '../ui/primitives.js';

export function EmpresaDocsCard({ company, onUpdate }) {
  const docs = company.baseDocs || [];
  const getDoc = id => docs.find(d=>d.id===id)||null;
  const handleUpload = async (def, file) => {
    let fileData = null;
    if (def.storeFile) {
      if (file.size>10*1024*1024){alert('Archivo muy grande (máx. 10MB). Para archivos grandes, comprime el PDF.');return;}
      try{fileData=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});}catch(e){alert('Error: '+e.message);return;}
    }
    const newDoc={id:def.id,name:def.name,category:def.category,status:'guardado',uploadDate:TODAY(),fileName:file.name,fileSize:file.size,fileData,expirationDate:'',notes:''};
    const updated=docs.find(d=>d.id===def.id)?docs.map(d=>d.id===def.id?newDoc:d):[...docs,newDoc];
    onUpdate({...company,baseDocs:updated});
  };
  const rmDoc  = id   => onUpdate({...company,baseDocs:docs.filter(d=>d.id!==id)});
  const setExp = (id,date) => onUpdate({...company,baseDocs:docs.map(d=>d.id===id?{...d,expirationDate:date}:d)});

  // Reformas (almacenamiento dinámico, sin análisis)
  const reformas = company.reformas || [];
  const fileToB64 = (file) => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});

  const addReforma = async (file) => {
    // Si es ZIP, descomprimir y guardar todos los PDFs de adentro
    const esZip = file.name.toLowerCase().endsWith('.zip') || file.type==='application/zip' || file.type==='application/x-zip-compressed';
    if (esZip) {
      if (!window.JSZip) { alert('No se pudo cargar el lector de ZIP. Recarga la página.'); return; }
      try {
        const zip = await window.JSZip.loadAsync(file);
        const pdfEntries = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.pdf') && !f.name.startsWith('__MACOSX'));
        if (!pdfEntries.length) { alert('El ZIP no contiene PDFs.'); return; }
        const nuevas = [];
        for (const entry of pdfEntries) {
          const blob = await entry.async('blob');
          if (blob.size > 10*1024*1024) { alert('Omitido (muy grande, máx 10MB): ' + entry.name); continue; }
          const fileData = await fileToB64(blob);
          const nombre = entry.name.split('/').pop();
          nuevas.push({ id:'ref-'+Date.now()+'-'+Math.random().toString(36).slice(2,7), name:nombre, fileData, fileSize:blob.size, uploadDate:TODAY() });
        }
        if (nuevas.length) onUpdate({...company, reformas:[...reformas, ...nuevas]});
        alert('Se agregaron ' + nuevas.length + ' PDF(s) del ZIP.');
      } catch(e) { alert('Error al leer el ZIP: ' + e.message); }
      return;
    }
    // PDF individual
    if (file.size>10*1024*1024){alert('Archivo muy grande (máx. 10MB). Comprime el PDF.');return;}
    let fileData=null;
    try{ fileData=await fileToB64(file); }catch(e){ alert('Error: '+e.message); return; }
    const nueva={ id:'ref-'+Date.now(), name:file.name, fileData, fileSize:file.size, uploadDate:TODAY() };
    onUpdate({...company, reformas:[...reformas, nueva]});
  };
  const rmReforma = id => onUpdate({...company, reformas:reformas.filter(r=>r.id!==id)});
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

    // Reformas del acta (almacenamiento)
    h('div', { style:{ marginTop:16, paddingTop:16, borderTop:'1px solid var(--b1)' } },
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 } },
        h('div', null,
          h('div', { style:{ fontSize:13, fontWeight:500 } }, 'Reformas del acta', reformas.length>0?(' ('+reformas.length+')'):''),
          h('div', { style:{ fontSize:11, color:'var(--t2)' } }, 'Sube PDFs individuales o un ZIP con varias reformas adentro.'),
        ),
        h('label', { style:{ fontSize:11, padding:'5px 12px', background:'var(--t1)', color:'var(--bg1)', borderRadius:'var(--r)', cursor:'pointer', fontWeight:500, flexShrink:0 } }, '+ Subir PDF o ZIP',
          h('input', { type:'file', accept:'.pdf,.zip', style:{ display:'none' }, onChange:e=>{ if(e.target.files[0])addReforma(e.target.files[0]); e.target.value=''; } })
        ),
      ),
      reformas.length>0 && h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } },
        reformas.map((r,i) => h('div', { key:r.id, style:{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:'var(--r)', border:'.5px solid var(--b3)' } },
          h('span', { style:{ fontSize:11, color:'var(--t3)', flexShrink:0 } }, (i+1)+'.'),
          h('div', { style:{ flex:1, minWidth:0 } },
            h('div', { style:{ fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, r.name),
            h('div', { style:{ fontSize:10, color:'var(--t2)' } }, fmtBytes(r.fileSize), ' · ', r.uploadDate),
          ),
          r.fileData && h('button', { onClick:()=>dlFile(r.fileData,r.name), style:{ fontSize:11, padding:'4px 10px', color:'var(--blue)', flexShrink:0 } }, '⬇'),
          h('button', { onClick:()=>rmReforma(r.id), style:{ fontSize:11, padding:'4px 10px', color:'var(--red)', background:'transparent', border:'.5px solid #E24B4A55', flexShrink:0 } }, 'Quitar'),
        ))
      ),
    ),
  );
}

export function CompanyProfile({ company, onSave, onBack, onRequestDelete, user, logFn, config }) {
  const [c, sC]       = useState(JSON.parse(JSON.stringify(company)));
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState('');
  const [newSocio, setNewSocio] = useState({ nombre:'', porcentaje:'' });
  const set = (k,v) => sC(p=>({...p,[k]:v}));

  const FIELD_LABELS = {
    name:'Razón social', nombreComercial:'Nombre comercial', rfc:'RFC', regimen:'Régimen fiscal',
    address:'Domicilio fiscal', cp:'CP', ciudad:'Ciudad', estado:'Estado',
    representanteLegal:'Representante legal', cargoRepresentante:'Cargo', telefono:'Teléfono',
    correo:'Correo', situacion:'Situación',
  };
  const handleAIResult = (data) => {
    const map = {
      razonSocial:'name', nombreComercial:'nombreComercial', rfc:'rfc', regimenFiscal:'regimen',
      domicilioFiscal:'address', codigoPostal:'cp', ciudad:'ciudad', estado:'estado',
      representanteLegal:'representanteLegal', cargoRepresentante:'cargoRepresentante',
      telefono:'telefono', correo:'correo', estatus:'situacion',
      notario:'notario', numeroEscritura:'escritura', objetoSocial:'objetoSocial',
    };
    const updated = {...c}; const llenados = [];
    Object.entries(map).forEach(([from,to]) => {
      if (data[from]) { updated[to] = data[from]; if (FIELD_LABELS[to]) llenados.push(FIELD_LABELS[to]); }
    });
    sC(updated);
    setParseMsg(llenados.length
      ? '✅ Datos extraídos: ' + llenados.join(', ') + '. Revísalos y guarda la empresa.'
      : 'No se detectaron datos. Revisa que el PDF tenga texto legible (no escaneado).');
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
    h('div', { className:'card', style:{ marginBottom:16, background:'var(--blue-bg)', border:'1px solid var(--blue-border)' } },
      h('div', { style:{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' } },
        h('span', { style:{ fontSize:22 } }, '\ud83e\udd16'),
        h('div', { style:{ flex:1, minWidth:200 } },
          h('div', { style:{ fontSize:13, fontWeight:600, color:'var(--blue)' } }, 'Extraer datos con Claude'),
          h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Sube un documento: el acta constitutiva (trae el objeto social), la \u00faltima reforma (datos vigentes) o la CSF. Claude detecta el tipo y llena los campos. Para solo guardar archivos, usa el Banco de documentos m\u00e1s abajo.'),
        ),
        h(AIAnalyzerButton, { config, tipo:'empresa', label:'Subir y analizar', onResult: handleAIResult }),
      ),
    ),
    parseMsg && h('pre', { style:{ fontSize:12, background:'var(--bg2)', padding:12, borderRadius:'var(--r)', whiteSpace:'pre-wrap', lineHeight:1.6, marginBottom:16 } }, parseMsg),
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
        h(Inp, { label:'Correo de información / contacto', value:c.correoInfo||'', onChange:v=>set('correoInfo',v), placeholder:'contacto@empresa.com', type:'email' }),
        h(Inp, { label:'Correo de contabilidad / contador', value:c.correoContador||'', onChange:v=>set('correoContador',v), placeholder:'contador@empresa.com', type:'email', hint:'Recibirá recordatorios mensuales de documentos a renovar' }),
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

export default function Companies({ companies, setCompanies, projects, onSave, user, logFn, config }) {
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
      h(CompanyProfile, { company:co, config, onSave:c=>{ onSave(c); }, onBack:()=>setSel(null), onRequestDelete:sel==='new'?null:()=>requestDelete(co), user, logFn }),
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
