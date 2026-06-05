import { printCotizacionCliente, printResumenRetornos, printResumenInterno } from '../lib/pdf_export.js';
import { calcCotizacion } from '../lib/calc.js';
// Projects.js — Lista, formulario y detalle de proyecto
import { h, useState, useMemo, useCallback, useRef } from '../lib/core.js';
import { STATUSES, FINAL_STATUS, KANBAN_COLS, TIPOS_PROCEDIMIENTO, DEPENDENCIAS_COMUNES, TIPOS_PRODUCTO } from '../lib/constants.js';
import { fmt, daysUntil, alertLevel, TODAY, NOW, uid } from '../lib/utils.js';
import { Badge, AlertChip, Metric, Inp, EmptyState, ConfirmAction, NumInput, DeleteConfirmModal } from '../ui/primitives.js';
import CotizacionTab from './Cotizacion.js';
import BasesPreparacion from './Bases.js';
import { VehiclesTab, VehicleDetail, BillingTab, DocsTab } from './Vehicles.js';
import Flujo from './Flujo.js';
import { AIAnalyzerButton } from '../ui/AIAnalyzerButton.js';

const PROJ_TABS = [{id:'info',l:'Información'},{id:'activity',l:'Actividad'},{id:'cotizacion',l:'Cotización MSMS'},{id:'bases',l:'Bases'},{id:'vehiculos',l:'Vehículos'},{id:'facturacion',l:'Facturación'},{id:'docs',l:'Documentos'},{id:'preguntas',l:'Preguntas'}];

export function ProjectsList({ projects, vehicles, onNav }) {
  const [view, setView]     = useState('table');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort]     = useState('recent');
  const visible = useMemo(() => {
    let list=[...projects];
    if(search){const q=search.toLowerCase();list=list.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.dependencia||'').toLowerCase().includes(q)||(p.numLicitacion||'').toLowerCase().includes(q));}
    if(status!=='all')list=list.filter(p=>p.status===status);
    if(sort==='recent')list.sort((a,b)=>b.id>a.id?1:-1);
    if(sort==='amount')list.sort((a,b)=>(b.montoEstimado||0)-(a.montoEstimado||0));
    if(sort==='deadline')list.sort((a,b)=>(daysUntil(a.fechaFallo)??9999)-(daysUntil(b.fechaFallo)??9999));
    return list;
  },[projects,search,status,sort]);

  if(projects.length===0) return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', marginBottom:20 } },
      h('div', { className:'page-title' }, 'Proyectos'),
      h('button', { className:'bp', onClick:()=>onNav('project_new') }, '+ Nuevo proyecto'),
    ),
    h(EmptyState, { icon:'◈', title:'Sin proyectos', description:'Crea tu primer proyecto de licitación.', actionLabel:'+ Crear primer proyecto', onAction:()=>onNav('project_new') }),
  );

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
      h('div', { className:'page-title' }, 'Proyectos (',projects.length,')'),
      h('button', { className:'bp', onClick:()=>onNav('project_new') }, '+ Nuevo proyecto'),
    ),
    h('div', { style:{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' } },
      h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar...', style:{ maxWidth:220 } }),
      h('select', { value:status, onChange:e=>setStatus(e.target.value), style:{ maxWidth:180 } },
        h('option', { value:'all' }, '— Todos los estados —'),
        STATUSES.map(s=>h('option',{key:s.id,value:s.id},s.label))
      ),
      h('select', { value:sort, onChange:e=>setSort(e.target.value), style:{ maxWidth:160 } },
        h('option', { value:'recent' }, 'Más recientes'),
        h('option', { value:'amount' }, 'Mayor monto'),
        h('option', { value:'deadline' }, 'Fallo próximo'),
      ),
      h('button', { className:view==='table'?'bp':'', onClick:()=>setView('table'), style:{ fontSize:12, padding:'5px 12px' } }, '≡ Tabla'),
      h('button', { className:view==='kanban'?'bp':'', onClick:()=>setView('kanban'), style:{ fontSize:12, padding:'5px 12px' } }, '⎌ Kanban'),
    ),
    view==='table' && h('div', { className:'card' },
      h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ fontSize:13 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            ['PROYECTO','DEPENDENCIA','EMPRESA','MONTO','ESTADO','FALLO',''].map(hd=>h('th',{key:hd,style:{padding:'10px 8px',color:'var(--t3)',fontSize:11,fontWeight:600,letterSpacing:'.4px',textAlign:'left',borderBottom:'1px solid var(--b1)'}},hd))
          )),
          h('tbody', null, visible.map(p => {
            const alF=alertLevel(p.fechaFallo);
            return h('tr', { key:p.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('project_detail',p.id) },
              h('td', { style:{ padding:'10px 6px', fontWeight:500, maxWidth:220 } },
                h('div', { style:{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, p.name),
                p.numLicitacion && h('div', { style:{ fontSize:11, color:'var(--t2)' } }, p.numLicitacion),
              ),
              h('td', { style:{ padding:'10px 6px', color:'var(--t2)', fontSize:12 } }, p.dependencia||'—'),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:'var(--t2)' } }, p.company||'—'),
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(p.montoEstimado)),
              h('td', { style:{ padding:'10px 6px' } }, h(Badge, { statusId:p.status })),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:alF==='r'?'var(--red)':alF==='y'?'var(--amber)':'var(--t2)' } }, p.fechaFallo||'—'),
              h('td', { style:{ padding:'10px 6px' } }, h('button', { onClick:e=>{ e.stopPropagation(); onNav('project_detail',p.id); }, style:{ fontSize:11, padding:'3px 8px' } }, 'Abrir →')),
            );
          }))
        )
      )
    ),
    view==='kanban' && h('div', { style:{ overflowX:'auto' } },
      h('div', { style:{ display:'flex', gap:12, minWidth:'max-content', paddingBottom:12 } },
        KANBAN_COLS.map(colId => {
          const s=STATUSES.find(x=>x.id===colId), cols=visible.filter(p=>p.status===colId);
          return h('div', { key:colId, style:{ width:220, flexShrink:0 } },
            h('div', { style:{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:.5, color:s?.tx||'var(--t2)', background:s?.bg||'var(--bg2)', padding:'6px 12px', borderRadius:'var(--r)', marginBottom:8 } }, s?.label||colId,' (',cols.length,')'),
            cols.map(p => h('div', { key:p.id, className:'card', style:{ marginBottom:8, cursor:'pointer', fontSize:13 }, onClick:()=>onNav('project_detail',p.id) },
              h('div', { style:{ fontWeight:500, marginBottom:4, lineHeight:1.3 } }, p.name),
              h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:6 } }, p.dependencia||'—'),
              h('div', { style:{ fontSize:12, fontWeight:500 } }, fmt(p.montoEstimado)),
              p.fechaFallo && h('div', { style:{ fontSize:10, color:alertLevel(p.fechaFallo)?'var(--red)':'var(--t3)', marginTop:4 } }, 'Fallo: ',p.fechaFallo),
            )),
          );
        })
      )
    ),
  );
}

export function ProjectForm({ project, companies, config, onSave, onCancel }) {
  const isE = !!project;
  const [p, sP] = useState(project || { id:uid('proj'), name:'', dependencia:'', nivelGobierno:'', municipio:'', company:'', numLicitacion:'', status:'prospecto', tipoProcedimiento:'', productType:'Patrullas y vehículos', responsable:'', montoEstimado:0, probability:50, description:'', observaciones:'', fechaPublicacion:'', fechaAclaraciones:'', fechaPropuesta:'', fechaFallo:'', fechaContrato:'', notes:[], activity:[], preguntas:[], docs:[], preparation:{}, cotizacion:{} });
  const set = (k,v) => sP(prev=>({...prev,[k]:v}));
  const [basesMsg, setBasesMsg] = useState('');
  const handleBasesForm = (data) => {
    sP(prev => ({
      ...prev,
      ...(data.objetoLicitacion       && { name:               data.objetoLicitacion }),
      ...(data.numeroLicitacion       && { numLicitacion:      data.numeroLicitacion }),
      ...(data.dependencia            && { dependencia:        data.dependencia }),
      ...(data.nivelGobierno          && { nivelGobierno:      data.nivelGobierno }),
      ...(data.ubicacion             && { municipio:          data.ubicacion }),
      ...(data.ubicacion             && { ubicacion:           data.ubicacion }),
      ...(data.tipoProcedimiento      && { tipoProcedimiento:  data.tipoProcedimiento }),
      ...(data.tipoProducto           && { productType:        data.tipoProducto }),
      ...(data.objetoLicitacion       && { description:        data.descripcion || data.objetoLicitacion }),
      ...(data.fechaPublicacion       && { fechaPublicacion:   data.fechaPublicacion }),
      ...(data.fechaJuntaAclaraciones && { fechaAclaraciones:  data.fechaJuntaAclaraciones }),
      ...(data.fechaPresentacion      && { fechaPropuesta:     data.fechaPresentacion }),
      ...(data.fechaFallo             && { fechaFallo:         data.fechaFallo }),
      ...(data.fechaContrato          && { fechaContrato:      data.fechaContrato }),
    }));
    const campos = [
      data.objetoLicitacion  && 'nombre/objeto',
      data.numeroLicitacion  && 'No. licitación',
      data.dependencia       && 'dependencia',
      data.nivelGobierno     && 'nivel de gobierno',
      data.tipoProcedimiento && 'tipo procedimiento',
      data.fechaPublicacion  && 'fechas',
    ].filter(Boolean);
    setBasesMsg(campos.length ? '✅ Datos extraídos: ' + campos.join(', ') + '. Revisa y guarda.' : 'No se detectaron datos. Verifica que el PDF sea de bases de licitación.');
  };
  const doSave = async () => { if(!p.name.trim()){alert('El nombre del proyecto es obligatorio');return;} await onSave(p,true); };
  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { className:'page-title' }, isE?'Editar proyecto':'Nuevo proyecto'),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:onCancel }, 'Cancelar'),
        h('button', { className:'bp', onClick:doSave }, 'Guardar proyecto'),
      ),
    ),
    h('div', { style:{ marginBottom:16, padding:'14px 16px', background:'var(--blue-bg)', border:'1px solid var(--blue-border)', borderRadius:'var(--rl)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' } },
      h('span', { style:{ fontSize:22 } }, '🤖'),
      h('div', { style:{ flex:1, minWidth:180 } },
        h('div', { style:{ fontSize:13, fontWeight:600, color:'var(--blue)' } }, 'Llenar desde bases de licitación'),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Sube el PDF de las bases y Claude llenará automáticamente número, dependencia, tipo, descripción y fechas.'),
      ),
      h(AIAnalyzerButton, { config, tipo:'bases', label:'Subir bases', onResult: handleBasesForm }),
    ),
    basesMsg && h('div', { style:{ marginBottom:16, padding:'10px 12px', background:'var(--green-bg)', border:'1px solid var(--green-border)', borderRadius:'var(--r)', fontSize:12, color:'#14532d' } }, basesMsg),
    h('div', { className:'grid-2 mob-1col', style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos principales'),
        h(Inp, { label:'Nombre del proyecto *', value:p.name, onChange:v=>set('name',v), placeholder:'Equipamiento patrullas SSP' }),
        h(Inp, { label:'Nivel de gobierno', value:p.nivelGobierno, onChange:v=>set('nivelGobierno',v), options:[...DEPENDENCIAS_COMUNES,...(config?.customStatuses||[])] }),
        h(Inp, { label:'Dependencia (nombre)', value:p.dependencia, onChange:v=>set('dependencia',v), placeholder:'Dirección de Desarrollo Urbano…' }),
        h(Inp, { label:'Municipio / Ciudad', value:p.municipio||'', onChange:v=>set('municipio',v), placeholder:'Tultitlán, Tlalnepantla…' }),
        h(Inp, { label:'Empresa licitante', value:p.company, onChange:v=>set('company',v), options:companies.map(c=>c.name) }),
        h(Inp, { label:'Núm. de licitación', value:p.numLicitacion, onChange:v=>set('numLicitacion',v), placeholder:'LA-019GYN999-E1-2025' }),
        h(Inp, { label:'Responsable', value:p.responsable, onChange:v=>set('responsable',v) }),
        h(Inp, { label:'Descripción', value:p.description, onChange:v=>set('description',v), textarea:true }),
      ),
      h('div', null,
        h('div', { className:'card', style:{ marginBottom:16 } },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Clasificación y estado'),
          h(Inp, { label:'Estado', value:p.status, onChange:v=>set('status',v), options:STATUSES.map(s=>s.id) }),
          h(Inp, { label:'Tipo de procedimiento', value:p.tipoProcedimiento, onChange:v=>set('tipoProcedimiento',v), options:TIPOS_PROCEDIMIENTO }),
          h(Inp, { label:'Tipo de producto', value:p.productType, onChange:v=>set('productType',v), options:[...TIPOS_PRODUCTO,...(config?.customProductTypes||[])] }),
          h('div', null, h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Monto estimado ($)'), h(NumInput, { value:p.montoEstimado, onChange:v=>set('montoEstimado',v) })),
          h('div', { style:{ marginTop:14 } },
            h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Probabilidad: ',p.probability,'%'),
            h('input', { type:'range', min:0, max:100, step:5, value:p.probability, onChange:e=>set('probability',Number(e.target.value)), style:{ width:'100%', accentColor:'var(--blue)' } }),
          ),
        ),
        h('div', { className:'card' },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Fechas clave'),
          h('div', { className:'mob-2col', style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
            h(Inp, { label:'Publicación', value:p.fechaPublicacion, onChange:v=>set('fechaPublicacion',v), type:'date' }),
            h(Inp, { label:'Aclaraciones', value:p.fechaAclaraciones, onChange:v=>set('fechaAclaraciones',v), type:'date' }),
            h(Inp, { label:'Presentación', value:p.fechaPropuesta, onChange:v=>set('fechaPropuesta',v), type:'date' }),
            h(Inp, { label:'Fallo', value:p.fechaFallo, onChange:v=>set('fechaFallo',v), type:'date' }),
            h(Inp, { label:'Firma contrato', value:p.fechaContrato, onChange:v=>set('fechaContrato',v), type:'date' }),
          ),
        ),
      ),
    ),
  );
}

export function ProjectDetail({ project, vehicles, companies, config, onUpdate, onDelete, onSave, onNav, user, logFn, activeTab, setActiveTab }) {
  const [showEdit, setShowEdit]     = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [note, setNote]             = useState('');
  const [pregunta, setPregunta]     = useState('');
  const [cotTab, setCotTab]         = useState('partidas');
  const [selVehicle, setSelVehicle] = useState(null);
  const tab    = activeTab || 'info';
  const setTab = useCallback(t=>{ if(setActiveTab)setActiveTab(t); },[setActiveTab]);
  const company = companies.find(c=>c.name===project.company);
  const updProject = useCallback(updated=>onUpdate(updated),[onUpdate]);
  const cotRef = useRef(project.cotizacion||{});
  cotRef.current = project.cotizacion || {};
  const pVehicles  = vehicles.filter(v=>v.projectId===project.id);
  const alerts = [];
  [['Aclaraciones',project.fechaAclaraciones],['Propuesta',project.fechaPropuesta],['Fallo',project.fechaFallo],['Contrato',project.fechaContrato]]
    .forEach(([l,d])=>{ const lv=alertLevel(d); if(lv)alerts.push({label:l,date:d,level:lv,days:daysUntil(d)}); });

  const addNote = () => {
    if (!note.trim()) return;
    updProject({...project,notes:[...(project.notes||[]),{id:uid('note'),text:note.trim(),author:user?.name||'Usuario',date:NOW()}]});
    if(logFn)logFn(user,'anotación','proyecto',project.id,note.slice(0,60));
    setNote('');
  };
  const addPregunta = () => {
    if (!pregunta.trim()) return;
    updProject({...project,preguntas:[...(project.preguntas||[]),{id:uid('preg'),text:pregunta.trim(),date:TODAY(),respuesta:''}]});
    setPregunta('');
  };
  const updRespuesta = (id,r) => updProject({...project,preguntas:(project.preguntas||[]).map(q=>q.id===id?{...q,respuesta:r}:q)});

  const [basesAiMsg, setBasesAiMsg] = useState('');
  const handleBasesAI = (data) => {
    const upd = { ...project };
    if (data.objetoLicitacion)        upd.name              = data.objetoLicitacion;
    if (data.numeroLicitacion)        upd.numLicitacion     = data.numeroLicitacion;
    if (data.dependencia)             upd.dependencia       = data.dependencia;
    if (data.nivelGobierno)           upd.nivelGobierno     = data.nivelGobierno;
    if (data.ubicacion)               upd.municipio         = data.ubicacion;
    if (data.tipoProcedimiento)       upd.tipoProcedimiento = data.tipoProcedimiento;
    if (data.tipoProducto)            upd.productType       = data.tipoProducto;
    if (data.objetoLicitacion || data.descripcion) upd.description = data.descripcion || data.objetoLicitacion;
    if (data.fechaPublicacion)        upd.fechaPublicacion  = data.fechaPublicacion;
    if (data.fechaJuntaAclaraciones)  upd.fechaAclaraciones = data.fechaJuntaAclaraciones;
    if (data.fechaPresentacion)       upd.fechaPropuesta    = data.fechaPresentacion;
    if (data.fechaFallo)              upd.fechaFallo        = data.fechaFallo;
    if (data.fechaContrato)           upd.fechaContrato     = data.fechaContrato;
    updProject(upd);
    const campos = [
      data.objetoLicitacion && 'nombre/objeto',
      data.numeroLicitacion && 'No. licitación',
      data.dependencia && 'dependencia',
      data.nivelGobierno && 'nivel de gobierno',
      data.tipoProcedimiento && 'tipo procedimiento',
      data.fechaPublicacion && 'fechas',
    ].filter(Boolean);
    setBasesAiMsg(campos.length ? '✅ Datos extraídos de las bases: ' + campos.join(', ') : 'No se detectaron datos en el PDF.');
  };

  if(showEdit) return h(ProjectForm, { project, companies, config, onSave:async(updated)=>{ await onSave(updated); setShowEdit(false); }, onCancel:()=>setShowEdit(false) });
  if(selVehicle) return h(VehicleDetail, {
    vehicle:vehicles.find(v=>v.id===selVehicle), project, company,
    onNav:(view,id)=>{ if(view==='project_detail'){setSelVehicle(null);setTab('vehiculos');}else onNav(view,id); },
    onUpdate:v=>onNav('update_vehicle',v),
    onDelete:id=>{ onNav('delete_vehicle',id); setSelVehicle(null); setTab('vehiculos'); },
    user, logFn,
  });

  return h('div', null,
    // Breadcrumb
    h('div', { style:{ display:'flex', alignItems:'center', gap:8, marginBottom:6 } },
      h('span', { onClick:()=>onNav('projects'), style:{ fontSize:12, color:'var(--blue)', cursor:'pointer' } }, 'Proyectos'),
      h('span', { style:{ fontSize:12, color:'var(--t2)' } }, '/'),
      h('span', { style:{ fontSize:12 } }, project.name),
    ),
    // Header
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 } },
      h('div', null,
        h('div', { style:{ fontSize:20, fontWeight:600, marginBottom:4, lineHeight:1.3, letterSpacing:'-0.3px' } }, project.name),
        h('div', { style:{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' } },
          h(Badge, { statusId:project.status }),
          project.dependencia && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, project.dependencia),
          project.numLicitacion && h('span', { style:{ fontSize:11, color:'var(--t2)', fontFamily:'monospace' } }, project.numLicitacion),
          alerts.map((a,i)=>h(AlertChip, { key:i, level:a.level, text:a.label+': '+a.date })),
        ),
      ),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:()=>setShowEdit(true) }, 'Editar'),
        h('button', { onClick:()=>setShowDelete(true), style:{ color:'#E24B4A' } }, 'Eliminar'),
      ),
    ),
    // KPIs
    h('div', { className:'grid-5', style:{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 } },
      h(Metric, { label:'Monto estimado', value:fmt(project.montoEstimado) }),
      h(Metric, { label:'Probabilidad', value:project.probability+'%' }),
      h(Metric, { label:'Empresa', value:project.company||'—' }),
      h(Metric, { label:'Vehículos', value:pVehicles.length }),
      h(Metric, { label:'Responsable', value:project.responsable||'—' }),
    ),
    // Tabs
    h('div', { style:{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--b1)', overflowX:'auto', flexWrap:'nowrap', WebkitOverflowScrolling:'touch', scrollbarWidth:'none', msOverflowStyle:'none' } },
      PROJ_TABS.map(t=>h('button',{key:t.id,className:'tab'+(tab===t.id?' active':''),onClick:()=>setTab(t.id),style:{flexShrink:0,whiteSpace:'nowrap'}},t.l))
    ),
    // Info
    tab==='info' && h('div', null,
      h('div', { style:{ marginBottom:16, padding:'14px 16px', background:'var(--blue-bg)', border:'1px solid var(--blue-border)', borderRadius:'var(--rl)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' } },
        h('span', { style:{ fontSize:22 } }, '🤖'),
        h('div', { style:{ flex:1, minWidth:180 } },
          h('div', { style:{ fontSize:13, fontWeight:600, color:'var(--blue)' } }, 'Analizar bases de licitación con Claude'),
          h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, 'Sube el PDF de las bases y se llenarán automáticamente los datos del proyecto y las fechas clave.'),
        ),
        h(AIAnalyzerButton, { config, tipo:'bases', label:'Subir bases', onResult: handleBasesAI }),
      ),
      basesAiMsg && h('div', { style:{ marginBottom:16, padding:'10px 12px', background:'var(--green-bg)', border:'1px solid var(--green-border)', borderRadius:'var(--r)', fontSize:12, color:'#14532d' } }, basesAiMsg),
      h('div', { className:'grid-2 mob-1col', style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos del proyecto'),
        [['Nivel de gobierno',project.nivelGobierno],['Municipio',project.municipio],['Dependencia',project.dependencia],['Tipo procedimiento',project.tipoProcedimiento],['Tipo producto',project.productType],['Empresa',project.company],['Responsable',project.responsable]].map(([l,v],i)=>
          h('div', { key:i, style:{ display:'flex', justifyContent:'space-between', padding:'9px 0', borderBottom:'.5px solid var(--b3)', fontSize:13 } },
            h('span', { style:{ color:'var(--t2)' } }, l), h('span', { style:{ fontWeight:500 } }, v||'—'),
          )
        ),
        project.description && h('div', { style:{ marginTop:12, fontSize:13, lineHeight:1.6 } }, project.description),
      ),
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Fechas clave'),
        [['Publicación',project.fechaPublicacion],['Junta aclaraciones',project.fechaAclaraciones],['Presentación propuesta',project.fechaPropuesta],['Fallo',project.fechaFallo],['Firma de contrato',project.fechaContrato]].map(([l,d],i)=>{
          const lv=alertLevel(d), days=daysUntil(d);
          return h('div', { key:i, style:{ display:'flex', flexDirection:'column', padding:'9px 0', borderBottom:'.5px solid var(--b3)', fontSize:13, gap:3 } },
            h('span', { style:{ color:'var(--t2)', fontSize:11 } }, l),
            h('span', { style:{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' } },
              d ? h('span', { style:{ color:lv==='r'?'var(--red)':lv==='y'?'var(--amber)':'var(--t1)', fontWeight:500 } }, d) : h('span', { style:{ color:'var(--t3)' } }, '—'),
              lv && h('span', { style:{ fontSize:10, padding:'2px 7px', borderRadius:10, fontWeight:600, background:lv==='r'?'var(--red-bg)':'var(--amber-bg)', color:lv==='r'?'#7f1d1d':'#78350f' } }, days<0?'Vencido':days===0?'HOY':'En '+days+'d'),
            ),
          );
        })
      ),
    )),
    // Actividad
    tab==='activity' && h('div', null,
      h('div', { className:'card', style:{ marginBottom:16 } },
        h('div', { style:{ display:'flex', gap:8 } },
          h('input', { value:note, onChange:e=>setNote(e.target.value), placeholder:'Agregar nota de seguimiento…', style:{ flex:1 }, onKeyDown:e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),addNote()) }),
          h('button', { className:'bp', onClick:addNote }, '+ Nota'),
        ),
      ),
      (project.notes||[]).length===0
        ? h(EmptyState, { title:'Sin actividad', description:'Registra notas de seguimiento del proyecto.' })
        : h('div', { className:'card' },
            [...(project.notes||[])].reverse().map(n=>
              h('div', { key:n.id, style:{ padding:'12px 0', borderBottom:'.5px solid var(--b3)' } },
                h('div', { style:{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--t2)', marginBottom:4 } },
                  h('span', null, n.author), h('span', null, new Date(n.date).toLocaleString('es-MX')),
                ),
                h('div', { style:{ fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap' } }, n.text),
              )
            )
          ),
    ),
    // Cotización
    tab==='cotizacion' && h('div', null,
      h('div', { style:{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', paddingBottom:14, borderBottom:'.5px solid var(--b3)' } },
        h('div', { style:{ fontSize:11, color:'var(--t2)', alignSelf:'center', marginRight:4 } }, 'Exportar PDF:'),
        h('button', { onClick:()=>{ const c=cotRef.current; const cc=calcCotizacion(c); printCotizacionCliente({project,cot:c,calc:cc,config:window._lpConfig}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--blue)44', color:'var(--blue)', background:'#3b6cf408' } }, '📄 Cotización cliente'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenRetornos({project,cot:c,calc:cc}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--amber)44', color:'var(--amber)', background:'#d9770608' } }, '📋 Resumen retornos'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenInterno({project,cot:c,calc:cc}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--t3)44', color:'var(--t2)' } }, '🔒 Resumen interno'),
      ),
      h(CotizacionTab, { project, onUpdate:(updated)=>{ cotRef.current=updated.cotizacion||{}; updProject(updated); }, activeTab:cotTab, setActiveTab:setCotTab }),
    ),
    // Bases
    tab==='bases' && h(BasesPreparacion, { project, config, onUpdate:updProject, user, logFn }),
    // Vehículos
    tab==='vehiculos' && h(VehiclesTab, { project, vehicles:pVehicles, onSave:v=>onNav('save_vehicle',v), onDelete:id=>onNav('delete_vehicle',id), onNav:(view,id)=>{ if(view==='vehicle_detail')setSelVehicle(id); else onNav(view,id); }, user, logFn }),
    // Facturación
    tab==='facturacion' && h(BillingTab, { project, vehicles:pVehicles, onNav:(view,id)=>{ if(view==='vehicle_detail')setSelVehicle(id); } }),
    // Documentos
    tab==='docs' && h(DocsTab, { project, onUpdate:updProject, user, logFn }),
    // Preguntas
    tab==='preguntas' && h('div', null,
      h('div', { className:'card', style:{ marginBottom:16 } },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:10 } }, 'Preguntas y aclaraciones'),
        h('div', { style:{ display:'flex', gap:8 } },
          h('input', { value:pregunta, onChange:e=>setPregunta(e.target.value), placeholder:'Pregunta para la junta de aclaraciones…', style:{ flex:1 }, onKeyDown:e=>e.key==='Enter'&&(e.preventDefault(),addPregunta()) }),
          h('button', { className:'bp', onClick:addPregunta }, '+ Agregar'),
        ),
      ),
      (project.preguntas||[]).length===0
        ? h(EmptyState, { title:'Sin preguntas', description:'Registra las preguntas para la junta de aclaraciones.' })
        : h('div', { style:{ display:'flex', flexDirection:'column', gap:12 } },
            (project.preguntas||[]).map((q,i)=>
              h('div', { key:q.id, className:'card' },
                h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 } },
                  h('div', { style:{ fontSize:13, fontWeight:500 } }, i+1,'. ',q.text),
                  h('span', { style:{ fontSize:11, color:'var(--t3)', flexShrink:0, marginLeft:12 } }, q.date),
                ),
                h('textarea', { value:q.respuesta||'', onChange:e=>updRespuesta(q.id,e.target.value), placeholder:'Respuesta de la junta…', rows:2, style:{ resize:'vertical', fontSize:12 } }),
              )
            )
          ),
    ),
    // Modal eliminar
    showDelete && h(DeleteConfirmModal, { title:'¿Eliminar proyecto?', message:'Vas a eliminar el proyecto "'+project.name+'".\n\nSe eliminarán también todos los vehículos asociados.', warning:'Esta acción no se puede deshacer.', confirmLabel:'Sí, eliminar proyecto', onConfirm:()=>{ onDelete(project.id); setShowDelete(false); onNav('projects'); }, onCancel:()=>setShowDelete(false) }),
  );
}
