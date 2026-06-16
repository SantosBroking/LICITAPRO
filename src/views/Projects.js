import { printCotizacionCliente, printResumenRetornos, printResumenInterno, printOrdenCompra } from '../lib/pdf_export.js';
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

const PROJ_TABS = [{id:'info',l:'Información'},{id:'cotizacion',l:'Cotización MSMS'},{id:'flujo',l:'Flujo de Pagos'},{id:'bases',l:'Bases'},{id:'vehiculos',l:'Vehículos'},{id:'facturacion',l:'Facturación'},{id:'docs',l:'Documentos'},{id:'preguntas',l:'Preguntas'},{id:'borrador',l:'Borrador'},{id:'activity',l:'Actividad'}];

const GRUPOS = {
  proyecciones: ['prospecto','analisis','preparacion','aclaraciones','presentada','evaluacion'],
  nuestros:     ['ganada','contrato','entrega','facturado','cobrado'],
  cerradas:     ['perdida','cancelada'],
};

export function ProjectsList({ projects, vehicles, onNav, onUpdate }) {
  const [view, setView]     = useState('table');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort]     = useState('recent');
  const [grupo, setGrupo]   = useState('todos');
  const visible = useMemo(() => {
    let list=[...projects];
    if(search){const q=search.toLowerCase();list=list.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.dependencia||'').toLowerCase().includes(q)||(p.numLicitacion||'').toLowerCase().includes(q));}
    if(grupo!=='todos')list=list.filter(p=>(GRUPOS[grupo]||[]).includes(p.status));
    if(status!=='all')list=list.filter(p=>p.status===status);
    if(sort==='recent')list.sort((a,b)=>b.id>a.id?1:-1);
    if(sort==='amount')list.sort((a,b)=>(b.montoEstimado||0)-(a.montoEstimado||0));
    if(sort==='deadline')list.sort((a,b)=>(daysUntil(a.fechaFallo)??9999)-(daysUntil(b.fechaFallo)??9999));
    return list;
  },[projects,search,status,sort,grupo]);

  const grpCount = id => id==='todos' ? projects.length : projects.filter(p=>(GRUPOS[id]||[]).includes(p.status)).length;
  const kanbanCols = grupo==='todos' ? KANBAN_COLS : (GRUPOS[grupo]||KANBAN_COLS);
  const sumaVisible = visible.reduce((s,p)=>s+(p.montoEstimado||0),0);

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
    h('div', { style:{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' } },
      [['proyecciones','📈 Proyecciones'],['nuestros','✅ Ya nuestros'],['cerradas','Cerradas'],['todos','Todos']].map(g=>
        h('button', { key:g[0], className: grupo===g[0]?'bp':'', onClick:()=>setGrupo(g[0]), style:{ fontSize:12, padding:'6px 14px' } }, g[1]+' ('+grpCount(g[0])+')')
      )
    ),
    h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:14 } },
      'Suma de montos estimados: ', h('strong', { style:{ color:'var(--t1)' } }, fmt(sumaVisible)),
      ' · ', visible.length, ' proyecto(s)'
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
            const stRow=STATUSES.find(s=>s.id===p.status);
            return h('tr', { key:p.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('project_detail',p.id) },
              h('td', { style:{ padding:'10px 6px', fontWeight:500, maxWidth:220 } },
                h('div', { style:{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, p.name),
                p.numLicitacion && h('div', { style:{ fontSize:11, color:'var(--t2)' } }, p.numLicitacion),
              ),
              h('td', { style:{ padding:'10px 6px', color:'var(--t2)', fontSize:12 } }, p.dependencia||'—'),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:'var(--t2)' } }, p.company||'—'),
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(p.montoEstimado)),
              h('td', { style:{ padding:'10px 6px' }, onClick:e=>e.stopPropagation() },
                h('select', {
                  value:p.status,
                  onClick:e=>e.stopPropagation(),
                  onChange:e=>{ e.stopPropagation(); onUpdate && onUpdate({...p, status:e.target.value}); },
                  style:{ fontSize:12, fontWeight:600, padding:'4px 8px', borderRadius:'var(--r)', border:'1px solid '+(stRow?stRow.color:'var(--b1)'), background:stRow?stRow.bg:'var(--bg2)', color:stRow?stRow.tx:'var(--t1)', cursor:'pointer', maxWidth:170 }
                }, STATUSES.map(s=>h('option',{key:s.id,value:s.id,style:{background:'#fff',color:'#18181b'}}, s.label)))
              ),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:alF==='r'?'var(--red)':alF==='y'?'var(--amber)':'var(--t2)' } }, p.fechaFallo||'—'),
              h('td', { style:{ padding:'10px 6px' } }, h('button', { onClick:e=>{ e.stopPropagation(); onNav('project_detail',p.id); }, style:{ fontSize:11, padding:'3px 8px' } }, 'Abrir →')),
            );
          }))
        )
      )
    ),
    view==='kanban' && h('div', { style:{ overflowX:'auto' } },
      h('div', { style:{ display:'flex', gap:12, minWidth:'max-content', paddingBottom:12 } },
        kanbanCols.map(colId => {
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

export function ProjectDetail({ project, vehicles, companies, config, onSaveConfig, onUpdate, onDelete, onSave, onNav, user, logFn, activeTab, setActiveTab }) {
  const [showEdit, setShowEdit]     = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showOC, setShowOC]         = useState(false);
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
        h('button', { onClick:async ()=>{
          const now = new Date().toISOString().slice(0,10);
          const newId = 'proj-'+Date.now();
          const copia = {
            ...project,
            id: newId,
            name: 'Copia de '+project.name,
            status: 'prospecto',
            createdAt: now,
            updatedAt: now,
            // resetear folio y fechas de seguimiento sensibles
            folio: undefined,
            fechaFallo: undefined,
            fechaContrato: undefined,
          };
          await onUpdate(copia);
          onNav('project_detail', newId);
        }}, '⧉ Duplicar'),
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
    tab==='flujo' && h(Flujo, { project, onUpdate:updProject }),
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
        h('button', { onClick:async ()=>{ const c=cotRef.current; const cc=calcCotizacion(c); await printCotizacionCliente({project,cot:c,calc:cc,config:window._lpConfig}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--blue)44', color:'var(--blue)', background:'#3b6cf408' } }, '📄 Cotización cliente'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenRetornos({project,cot:c,calc:cc}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--amber)44', color:'var(--amber)', background:'#d9770608' } }, '📋 Resumen retornos'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenInterno({project,cot:c,calc:cc}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--t3)44', color:'var(--t2)' } }, '🔒 Resumen interno'),
        h('button', { onClick:()=>setShowOC(true), style:{ fontSize:11, padding:'5px 12px', border:'.5px solid #1D9E7544', color:'#1D9E75', background:'#1D9E7508' } }, '🛒 Orden de compra'),
      ),
      h(CotizacionTab, { project, onUpdate:(updated)=>{ cotRef.current=updated.cotizacion||{}; updProject(updated); }, activeTab:cotTab, setActiveTab:setCotTab, config, onSaveConfig }),
    ),
    // Bases
    tab==='bases' && h(BasesPreparacion, { project, config, onUpdate:updProject, user, logFn }),
    // Vehículos
    tab==='vehiculos' && h(VehiclesTab, { project, vehicles:pVehicles, onSave:v=>onNav('save_vehicle',v), onDelete:id=>onNav('delete_vehicle',id), onNav:(view,id)=>{ if(view==='vehicle_detail')setSelVehicle(id); else onNav(view,id); }, user, logFn }),
    // Facturación
    tab==='facturacion' && h(BillingTab, { project, vehicles:pVehicles, onNav:(view,id)=>{ if(view==='vehicle_detail')setSelVehicle(id); } }),
    // Documentos
    tab==='docs' && h('div', null,
      // Órdenes de Compra generadas
      (project.ordenesCompra||[]).length > 0 && h('div', { className:'card', style:{ marginBottom:14 } },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:10 } }, '🛒 Órdenes de Compra'),
        h('table', { style:{ fontSize:12, width:'100%', borderCollapse:'collapse' } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b2)' } },
            ['Folio','Fecha','Proveedor','Vehículos','Acciones'].map(h2=>h('th',{key:h2,style:{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:500,color:'var(--t2)',letterSpacing:'.4px'}},h2))
          )),
          h('tbody', null, [...(project.ordenesCompra||[])].reverse().map(oc=>
            h('tr', { key:oc.id, style:{ borderBottom:'.5px solid var(--b3)' } },
              h('td', { style:{ padding:'9px 8px', fontWeight:500, color:'var(--blue)', fontFamily:'monospace', fontSize:11 } }, oc.folio),
              h('td', { style:{ padding:'9px 8px', color:'var(--t2)', fontSize:11 } }, oc.fecha),
              h('td', { style:{ padding:'9px 8px' } }, oc.proveedor||'—'),
              h('td', { style:{ padding:'9px 8px', fontSize:11, color:'var(--t2)' } },
                (oc.partidas||[]).map(p=>`${p.id} · ${p.vehiculo||''} ×${p.cantidad}`).join(' | ')
              ),
              h('td', { style:{ padding:'9px 8px' } },
                h('button', { style:{ fontSize:11, color:'var(--blue)', padding:'3px 8px' },
                  onClick:()=>{
                    const cot2=project.cotizacion||{};
                    const parts=(oc.partidas||[]).map(op=>{
                      const orig=(cot2.partidas||[]).find(p=>p.id===op.id)||{};
                      return {...orig,...op, costoMSMS:op.precioUnit||orig.costoMSMS||0};
                    });
                    printOrdenCompra({ project:{...project,cotizacion:{...cot2,agenciaProveedor:oc.proveedor}}, partidas:parts, condiciones:oc.condiciones||[] });
                  }
                }, '📄 Reimprimir'),
                h('button', { style:{ fontSize:11, color:'var(--red)', padding:'3px 8px', marginLeft:4 },
                  onClick:()=>{ if(confirm('¿Eliminar OC '+oc.folio+'?')) updProject({...project,ordenesCompra:(project.ordenesCompra||[]).filter(o=>o.id!==oc.id)}); }
                }, 'Eliminar'),
              ),
            )
          )),
        ),
      ),
      h(DocsTab, { project, onUpdate:updProject, user, logFn }),
    ),
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
    // Borrador
    tab==='borrador' && h(BorradorTab, { project, config, onUpdate:updProject, logFn }),
    // Modal Orden de Compra
    showOC && h(OCModal, { project, onUpdate:updProject, onClose:()=>setShowOC(false) }),
    // Modal eliminar
    showDelete && h(DeleteConfirmModal, { title:'¿Eliminar proyecto?', message:'Vas a eliminar el proyecto "'+project.name+'".\n\nSe eliminarán también todos los vehículos asociados.', warning:'Esta acción no se puede deshacer.', confirmLabel:'Sí, eliminar proyecto', onConfirm:()=>{ onDelete(project.id); setShowDelete(false); onNav('projects'); }, onCancel:()=>setShowDelete(false) }),
  );
}

// ── Pestaña Borrador: compila info de bases, fechas, vehículos, probabilidad y status; lo envía por correo al equipo ──
function fechasBorrador(p){
  return [['Publicación',p.fechaPublicacion],['Junta de aclaraciones',p.fechaAclaraciones],['Presentación de propuesta',p.fechaPropuesta],['Fallo',p.fechaFallo],['Contrato',p.fechaContrato]].filter(function(r){return r[1];});
}

function buildBorradorHTML(project, intro){
  var p=project, cot=p.cotizacion||{};
  var st=STATUSES.find(function(s){return s.id===p.status;});
  var stLabel=st?st.label:(p.status||'—');
  var partidas=(cot.partidas||[]).filter(function(x){return x.activo && ((x.cantidad||0)>0 || x.tipo || x.vehiculoId);});
  var equipo=cot.equipo||[];
  var totalCoches=partidas.reduce(function(s,x){return s+(x.cantidad||0);},0);
  var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  var fechasRows=fechasBorrador(p).map(function(r){return '<tr><td style="padding:4px 14px 4px 0;color:#666;">'+esc(r[0])+'</td><td style="padding:4px 0;font-weight:600;">'+esc(r[1])+'</td></tr>';}).join('');
  if(!fechasRows) fechasRows='<tr><td style="padding:4px 0;color:#999;">Sin fechas registradas</td></tr>';

  var partidasHtml=partidas.map(function(x){
    var pi=parseInt(String(x.id).replace('P',''),10)-1;
    var carac=[x.tipo,[x.marca,x.modelo,x.ano,x.version].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
    var eqs=equipo.filter(function(e){return ((e.cnts&&e.cnts[pi])||0)>0;}).map(function(e){return '<li>'+esc(e.nombre)+(e.cnts[pi]>1?(' × '+e.cnts[pi]):'')+'</li>';}).join('');
    return '<div style="margin:10px 0;padding:12px 14px;border:1px solid #e5e5e5;border-radius:8px;">'
      +'<div style="font-weight:600;margin-bottom:4px;">'+esc(x.id)+' · '+esc(carac||'Vehículo sin definir')+' — '+(x.cantidad||0)+' unidad(es)</div>'
      +(eqs?('<div style="font-size:13px;color:#444;">Equipamiento:</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px;color:#444;">'+eqs+'</ul>'):'<div style="font-size:13px;color:#999;">Sin equipamiento capturado</div>')
      +'</div>';
  }).join('');
  if(!partidasHtml) partidasHtml='<div style="color:#999;">No hay vehículos capturados en la cotización todavía.</div>';

  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;">'
    +(intro?('<p style="white-space:pre-wrap;">'+esc(intro)+'</p>'):'')
    +'<h2 style="margin:0 0 4px;">'+esc(p.name||'Proyecto')+'</h2>'
    +'<div style="color:#666;margin-bottom:14px;">'+esc(p.dependencia||'')+(p.numLicitacion?(' · '+esc(p.numLicitacion)):'')+'</div>'
    +'<table style="border-collapse:collapse;margin-bottom:16px;font-size:14px;">'
      +'<tr><td style="padding:4px 14px 4px 0;color:#666;">Status</td><td style="padding:4px 0;font-weight:600;">'+esc(stLabel)+'</td></tr>'
      +'<tr><td style="padding:4px 14px 4px 0;color:#666;">Probabilidad de ganar</td><td style="padding:4px 0;font-weight:600;">'+(p.probability!=null?esc(p.probability)+'%':'—')+'</td></tr>'
      +'<tr><td style="padding:4px 14px 4px 0;color:#666;">Tipo de procedimiento</td><td style="padding:4px 0;">'+esc(p.tipoProcedimiento||'—')+'</td></tr>'
      +'<tr><td style="padding:4px 14px 4px 0;color:#666;">Monto estimado</td><td style="padding:4px 0;">'+esc(fmt(p.montoEstimado||0))+'</td></tr>'
      +'<tr><td style="padding:4px 14px 4px 0;color:#666;">Total de vehículos</td><td style="padding:4px 0;font-weight:600;">'+totalCoches+'</td></tr>'
    +'</table>'
    +'<h3 style="margin:0 0 6px;">Fechas clave</h3>'
    +'<table style="border-collapse:collapse;margin-bottom:16px;font-size:14px;">'+fechasRows+'</table>'
    +'<h3 style="margin:0 0 6px;">Vehículos y características</h3>'
    +partidasHtml
    +(p.description?('<h3 style="margin:16px 0 6px;">Descripción</h3><p style="white-space:pre-wrap;font-size:14px;color:#333;">'+esc(p.description)+'</p>'):'')
    +(p.observaciones?('<h3 style="margin:16px 0 6px;">Observaciones</h3><p style="white-space:pre-wrap;font-size:14px;color:#333;">'+esc(p.observaciones)+'</p>'):'')
    +'</div>';
}

function buildBorradorText(project, intro){
  var p=project, cot=p.cotizacion||{};
  var st=STATUSES.find(function(s){return s.id===p.status;});
  var stLabel=st?st.label:(p.status||'—');
  var partidas=(cot.partidas||[]).filter(function(x){return x.activo && ((x.cantidad||0)>0 || x.tipo || x.vehiculoId);});
  var equipo=cot.equipo||[];
  var totalCoches=partidas.reduce(function(s,x){return s+(x.cantidad||0);},0);
  var L=[];
  if(intro){ L.push(intro); L.push(''); }
  L.push(p.name||'Proyecto');
  var enc=[p.dependencia,p.numLicitacion].filter(Boolean).join(' · '); if(enc) L.push(enc);
  L.push('');
  L.push('Status: '+stLabel);
  L.push('Probabilidad de ganar: '+(p.probability!=null?(p.probability+'%'):'—'));
  L.push('Tipo de procedimiento: '+(p.tipoProcedimiento||'—'));
  L.push('Monto estimado: '+fmt(p.montoEstimado||0));
  L.push('Total de vehículos: '+totalCoches);
  L.push('');
  L.push('FECHAS CLAVE');
  var fechas=fechasBorrador(p);
  if(fechas.length) fechas.forEach(function(r){ L.push('- '+r[0]+': '+r[1]); });
  else L.push('- Sin fechas registradas');
  L.push('');
  L.push('VEHÍCULOS Y CARACTERÍSTICAS');
  if(partidas.length){
    partidas.forEach(function(x){
      var pi=parseInt(String(x.id).replace('P',''),10)-1;
      var carac=[x.tipo,[x.marca,x.modelo,x.ano,x.version].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
      L.push(x.id+' · '+(carac||'Vehículo sin definir')+' — '+(x.cantidad||0)+' unidad(es)');
      var eqs=equipo.filter(function(e){return ((e.cnts&&e.cnts[pi])||0)>0;}).map(function(e){return e.nombre+(e.cnts[pi]>1?(' x'+e.cnts[pi]):'');});
      if(eqs.length) L.push('   Equipamiento: '+eqs.join(', '));
    });
  } else L.push('Sin vehículos capturados.');
  if(p.description){ L.push(''); L.push('DESCRIPCIÓN'); L.push(p.description); }
  if(p.observaciones){ L.push(''); L.push('OBSERVACIONES'); L.push(p.observaciones); }
  return L.join('\n');
}

function BorradorTab(props){
  var project=props.project, onUpdate=props.onUpdate, logFn=props.logFn;
  var toState=useState(project.borradorTo||''), to=toState[0], setTo=toState[1];
  var introState=useState(''), intro=introState[0], setIntro=introState[1];
  var sendState=useState(false), sending=sendState[0], setSending=sendState[1];
  var msgState=useState(''), msg=msgState[0], setMsg=msgState[1];
  var html=buildBorradorHTML(project, intro);

  var enviar=async function(){
    var dest=to.split(/[\s,;]+/).filter(function(x){return x.indexOf('@')>-1;});
    if(!dest.length){ setMsg('⚠ Pon al menos un correo válido del equipo'); return; }
    setSending(true); setMsg('');
    try{
      var r=await fetch('/api/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'MSMS CORP <santiago@brokingroup.com>',to:dest,subject:'Borrador de proyecto — '+(project.name||''),html:html})});
      var d=await r.json().catch(function(){return {};});
      if(!r.ok||!d.ok) throw new Error((d&&d.resend&&d.resend.message)||(d&&d.error)||('HTTP '+r.status));
      setMsg('✅ Borrador enviado a: '+dest.join(', '));
      if(onUpdate) onUpdate(Object.assign({},project,{borradorTo:to}));
      if(logFn) logFn('Borrador del proyecto enviado por correo a '+dest.join(', '));
    }catch(e){ setMsg('❌ '+(e.message||e)); }
    setSending(false);
  };

  var copiar=async function(){
    var texto=buildBorradorText(project, intro);
    try{
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html],{type:'text/html'}),
          'text/plain': new Blob([texto],{type:'text/plain'})
        })]);
        setMsg('📋 Copiado con formato — pégalo en tu correo');
      } else if(navigator.clipboard){
        await navigator.clipboard.writeText(texto);
        setMsg('📋 Copiado como texto');
      } else { setMsg('No se pudo copiar'); }
    }catch(e){
      try{ await navigator.clipboard.writeText(texto); setMsg('📋 Copiado como texto'); }
      catch(e2){ setMsg('No se pudo copiar'); }
    }
  };

  return h('div', null,
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:600, marginBottom:4 } }, 'Enviar borrador al equipo'),
      h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } }, 'Compila la información de las bases, fechas clave, vehículos con sus características, probabilidad de ganar y status, y lo envía por correo.'),
      h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Correos del equipo (separados por coma)'),
      h('input', { value:to, onChange:function(e){setTo(e.target.value);}, placeholder:'martin@brokingroup.com, thiago@brokingroup.com', style:{ width:'100%', marginBottom:12 } }),
      h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Mensaje breve (opcional)'),
      h('textarea', { value:intro, onChange:function(e){setIntro(e.target.value);}, rows:2, placeholder:'Equipo, les comparto el borrador de este proyecto…', style:{ width:'100%', resize:'vertical', marginBottom:12 } }),
      h('div', { style:{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' } },
        h('button', { className:'bp', onClick:enviar, disabled:sending }, sending?'Enviando…':'📧 Enviar al equipo'),
        h('button', { onClick:copiar }, 'Copiar'),
        msg && h('span', { style:{ fontSize:12, color: msg[0]==='✅'?'#1D9E75':(msg[0]==='❌'?'#E24B4A':'var(--t2)') } }, msg),
      ),
    ),
    h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:6 } }, 'Vista previa del correo:'),
    h('div', { className:'card', dangerouslySetInnerHTML:{ __html: html } }),
  );
}

// ── Modal Orden de Compra ─────────────────────────────────────
function OCModal({ project, onUpdate, onClose }) {
  const cot = project.cotizacion || {};
  const partidas = (cot.partidas || []).filter(p => p.activo && (p.cantidad||0) > 0);

  // Proveedor editable
  const [proveedor, setProveedor] = useState(cot.agenciaProveedor || 'Grupo Surman');

  // Selección de partidas
  const [selParts, setSelParts] = useState(partidas.map(p => p.id));
  const togglePart = id => setSelParts(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  // Direcciones guardadas en localStorage
  const ADDR_KEY = 'lp_oc_addresses';
  const loadAddrs = () => { try { return JSON.parse(localStorage.getItem(ADDR_KEY)||'[]'); } catch{ return []; } };
  const [addresses, setAddresses] = useState(loadAddrs);
  const [newAddr, setNewAddr] = useState('');
  const [showAddrInput, setShowAddrInput] = useState(false);

  const saveAddr = () => {
    const v = newAddr.trim(); if(!v) return;
    const updated = [v, ...addresses.filter(a=>a!==v)].slice(0,10);
    localStorage.setItem(ADDR_KEY, JSON.stringify(updated));
    setAddresses(updated);
    updCond('lugar', v);
    setNewAddr(''); setShowAddrInput(false);
  };
  const deleteAddr = addr => {
    const updated = addresses.filter(a=>a!==addr);
    localStorage.setItem(ADDR_KEY, JSON.stringify(updated));
    setAddresses(updated);
  };

  // Condiciones editables — forma de pago con default
  const DEFAULT_CONDS = [
    { id:'forma_pago',   label:'Forma de pago',             value:'Transferencia electrónica' },
    { id:'anticipo',     label:'Anticipo',                  value:'' },
    { id:'plazo',        label:'Plazo de entrega',          value:'' },
    { id:'lugar',        label:'Lugar de entrega',          value:'' },
    { id:'garantia',     label:'Garantía',                  value:'' },
    { id:'vigencia',     label:'Vigencia de la OC',         value:'' },
    { id:'facturacion',  label:'Condiciones de facturación', value:'' },
    { id:'penalizacion', label:'Penalización por retraso',  value:'' },
    { id:'notas',        label:'Notas adicionales',         value:'' },
  ];
  const [conds, setConds] = useState(project.ocCondiciones || DEFAULT_CONDS);
  const updCond = (id, val) => setConds(cs => cs.map(c => c.id===id ? {...c, value:val} : c));
  const lugarVal = conds.find(c=>c.id==='lugar')?.value || '';

  const generar = () => {
    const partidasSel = partidas.filter(p => selParts.includes(p.id));
    if (!partidasSel.length) { alert('Selecciona al menos una partida.'); return; }
    const folio = 'OC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5);
    const proyConProv = { ...project, cotizacion:{ ...cot, agenciaProveedor:proveedor } };
    // Guardar OC en el expediente del proyecto
    const nuevaOC = {
      id: folio,
      folio,
      fecha: new Date().toISOString().slice(0,10),
      proveedor,
      partidas: partidasSel.map(p=>({ id:p.id, vehiculo:[p.marca,p.modelo,p.version].filter(Boolean).join(' '), tipo:p.tipo, cantidad:p.cantidad, precioUnit:p.costoMSMS||0 })),
      condiciones: conds,
    };
    const ocs = [...(project.ordenesCompra||[]).filter(o=>o.id!==folio), nuevaOC];
    onUpdate({ ...project, ordenesCompra: ocs, ocCondiciones: conds });
    printOrdenCompra({ project: proyConProv, partidas: partidasSel, condiciones: conds });
  };

  const inputStyle = { fontSize:12, padding:'6px 10px' };
  const secLabel = { fontSize:12, fontWeight:500, color:'var(--t2)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' };

  return h('div', { style:{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
    onClick: e => { if(e.target===e.currentTarget) onClose(); } },
    h('div', { style:{ background:'var(--bg1)', borderRadius:'var(--rl)', width:'100%', maxWidth:640, maxHeight:'92vh', overflow:'auto', padding:24, display:'flex', flexDirection:'column', gap:16 } },

      // Header
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center' } },
        h('div', { style:{ fontSize:15, fontWeight:600 } }, '🛒 Orden de Compra'),
        h('button', { onClick:onClose, style:{ background:'transparent', border:'none', fontSize:18, cursor:'pointer', color:'var(--t2)' } }, '✕'),
      ),

      // Proveedor
      h('div', null,
        h('div', { style:secLabel }, 'Proveedor'),
        h('input', { value:proveedor, onChange:e=>setProveedor(e.target.value), placeholder:'Ej: Grupo Surman', style:{ ...inputStyle, width:'100%' } }),
      ),

      // Selector de partidas
      h('div', null,
        h('div', { style:secLabel }, 'Vehículos a incluir'),
        partidas.length === 0
          ? h('div', { style:{ fontSize:12, color:'var(--t3)', padding:'10px 0' } }, 'No hay partidas activas con vehículos en esta cotización.')
          : partidas.map(p => h('label', { key:p.id, style:{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', marginBottom:6, borderRadius:'var(--r)', border:'.5px solid var(--b2)', cursor:'pointer', background: selParts.includes(p.id)?'var(--bg2)':'transparent' } },
              h('input', { type:'checkbox', checked:selParts.includes(p.id), onChange:()=>togglePart(p.id), style:{ width:15, height:15, accentColor:'var(--blue)', flexShrink:0 } }),
              h('div', null,
                h('div', { style:{ fontSize:13, fontWeight:500 } }, p.id,' · ',[p.marca,p.modelo,p.version].filter(Boolean).join(' ')||'Vehículo sin definir'),
                h('div', { style:{ fontSize:11, color:'var(--t2)' } }, (p.cantidad||0),' unidad(es) · ',(p.tipo||'')),
              ),
            ))
      ),

      // Condiciones
      h('div', null,
        h('div', { style:secLabel }, 'Condiciones de compra'),
        h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } },
          conds.map(c => {
            // Campo especial: Lugar de entrega
            if (c.id === 'lugar') return h('div', { key:'lugar' },
              h('div', { style:{ display:'grid', gridTemplateColumns:'160px 1fr', gap:8, alignItems:'flex-start', marginBottom:4 } },
                h('div', { style:{ fontSize:12, color:'var(--t2)', paddingTop:7 } }, c.label),
                h('div', null,
                  // Dirección actual
                  h('input', { value:lugarVal, onChange:e=>updCond('lugar',e.target.value), placeholder:'Selecciona o escribe…', style:{ ...inputStyle, width:'100%', marginBottom:4 } }),
                  // Direcciones guardadas
                  addresses.length > 0 && h('div', { style:{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:4 } },
                    addresses.map(a => h('div', { key:a, style:{ display:'flex', alignItems:'center', gap:2, background:'var(--bg2)', border:'.5px solid var(--b2)', borderRadius:'var(--r)', padding:'2px 6px 2px 8px', cursor:'pointer' } },
                      h('span', { style:{ fontSize:11, color: a===lugarVal?'var(--blue)':'var(--t2)', fontWeight: a===lugarVal?500:400 }, onClick:()=>updCond('lugar',a) }, a.length>40?a.slice(0,38)+'…':a),
                      h('button', { onClick:()=>deleteAddr(a), style:{ background:'transparent', border:'none', color:'var(--t3)', cursor:'pointer', fontSize:12, padding:'0 2px', lineHeight:1 } }, '✕'),
                    ))
                  ),
                  // Nueva dirección
                  showAddrInput
                    ? h('div', { style:{ display:'flex', gap:4 } },
                        h('input', { value:newAddr, onChange:e=>setNewAddr(e.target.value), placeholder:'Escribe la dirección completa…', style:{ ...inputStyle, flex:1 }, onKeyDown:e=>{ if(e.key==='Enter') saveAddr(); if(e.key==='Escape') setShowAddrInput(false); } }),
                        h('button', { onClick:saveAddr, className:'bp', style:{ fontSize:11, padding:'5px 10px' } }, 'Guardar'),
                        h('button', { onClick:()=>setShowAddrInput(false), style:{ fontSize:11, padding:'5px 10px' } }, 'Cancelar'),
                      )
                    : h('button', { onClick:()=>setShowAddrInput(true), style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', padding:0, cursor:'pointer' } }, '+ Guardar dirección'),
                ),
              ),
            );
            // Resto de campos normales
            return h('div', { key:c.id, style:{ display:'grid', gridTemplateColumns:'160px 1fr', gap:8, alignItems:'center' } },
              h('div', { style:{ fontSize:12, color:'var(--t2)' } }, c.label),
              h('input', { value:c.value, placeholder:'Escribe aquí…', onChange:e=>updCond(c.id, e.target.value), style:inputStyle }),
            );
          })
        ),
      ),

      h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:8, borderTop:'.5px solid var(--b2)' } },
        h('button', { onClick:onClose }, 'Cancelar'),
        h('button', { className:'bp', onClick:generar }, '📄 Generar OC'),
      ),
    ),
  );
}
