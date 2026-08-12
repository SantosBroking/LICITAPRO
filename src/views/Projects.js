import { printCotizacionCliente, printResumenRetornos, printResumenInterno, printOrdenCompra } from '../lib/pdf_export.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js'; // Fase 3E-0 — OC de equipo
import { CATALOG_IMAGES } from '../lib/catalog_images.js'; // Fase 3E-0.1 — foto de equipo en OC
import { nuevoDocFlujo, avisarAprobacion, avisarAsignacionProyecto, avisarCambioEstatus } from '../lib/firmas.js';
import { avisarFirmaRequeridaInbox } from '../lib/inbox_firma_emails.js'; // Fase 3D-B3
import { calcCotizacion } from '../lib/calc.js';
// Projects.js — Lista, formulario y detalle de proyecto
import { h, useState, useMemo, useCallback, useRef, useEffect } from '../lib/core.js';
import { STATUSES, FINAL_STATUS, KANBAN_COLS, TIPOS_PROCEDIMIENTO, DEPENDENCIAS_COMUNES, TIPOS_PRODUCTO, esProyectoPerdido, categoriaProyecto, CATEGORIA_PROYECTO_LABELS } from '../lib/constants.js';
import { fmt, daysUntil, alertLevel, TODAY, NOW, uid, normalizeProjectName, generarFolioProyecto, generarFolioOC, generarFolioCotizacion } from '../lib/utils.js';
import { Badge, AlertChip, Inp, EmptyState, ConfirmAction, NumInput, DeleteConfirmModal } from '../ui/primitives.js';
import { getPermissions, canProjectTab, getAllowedSubTabs } from '../lib/permissions.js'; // Fase 1C + fix navegación + Fase 2A6 (sub-nav de Operación)
import { sb, createInboxItem, listInboxItems } from '../lib/supabase.js'; // Fase 1C — directorio de usuarios activos; Fase 3D-B1 — creación de firma_documento; Fase 3D-B1.1 — reconocer firmas de OC en Inbox
import CotizacionTab from './Cotizacion.js';
import CotizacionOperativa from './CotizacionOperativa.js'; // Fase 2A4
import BasesPreparacion from './Bases.js';
import { VehiclesTab, VehicleDetail, BillingTab, DocsTab } from './Vehicles.js';
import Flujo from './Flujo.js';
import { AIAnalyzerButton } from '../ui/AIAnalyzerButton.js';

// Fase 2A6 -- Navegación Esencial v1: de 10 a 4 tabs principales. El
// contenido de 'operacion' se agrega en un commit posterior de esta misma
// rama (Vehículos/Facturación/Flujo) -- hasta entonces, el tab existe en
// el menú pero su contenido se completa en el siguiente commit.
// Fase 2A6 (cierre): el id interno sigue siendo 'docs' (persistencia/legacy
// map no se tocan), pero el label visible pasa a 'Expediente' porque ahora
// agrupa Documentos + Bases + Preguntas como sub-pestañas internas.
const PROJ_TABS = [{id:'resumen',l:'Resumen'},{id:'cotizacion',l:'Cotización'},{id:'operacion',l:'Operación'},{id:'docs',l:'Expediente'}];

const GRUPOS = {
  proyecciones: ['prospecto','analisis','preparacion','aclaraciones','presentada','evaluacion'],
  nuestros:     ['ganada','contrato','entrega','facturado','cobrado'],
  cerradas:     ['perdida','cancelada'],
};

export function ProjectsList({ projects, vehicles, onNav, onUpdate, user }) {
  const [view, setView]     = useState('table');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [empresa, setEmpresa] = useState('all');
  // Fase 3F -- filtro de categoría de proyecto (vehículos/equipo/servicios/
  // mixto/etc.), mismo patrón que empresa/status. 'all' = sin filtrar.
  const [categoria, setCategoria] = useState('all');
  const [sort, setSort]     = useState('etapa');
  const [grupo, setGrupo]   = useState('todos');
  const [soloMios, setSoloMios] = useState(false);
  // Hotfix -- proyectos perdidos/cancelados NO se muestran por default en
  // la pantalla principal (sin borrar nada): quedan colapsados detrás de
  // este toggle, igual que ya existía la sección "Cerradas" pero ahora
  // arranca oculta.
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  const miNombre = user?.name || '';

  // Orden por etapa del pipeline (ganados primero, luego avanzados, prospectos al final)
  const etapaRank = id => { const i = STATUSES.findIndex(s=>s.id===id); return i<0 ? 99 : i; };
  // Ganados/avanzados primero → invertimos el rank para que 'cobrado/ganada' suban
  const etapaOrder = id => {
    const ganados = ['cobrado','facturado','entrega','contrato','ganada'];
    const gi = ganados.indexOf(id);
    if (gi >= 0) return gi; // 0..4 arriba del todo
    return 10 + etapaRank(id); // el resto después, en orden de pipeline
  };

  const empresasUnicas = useMemo(()=>[...new Set(projects.map(p=>p.company).filter(Boolean))].sort(),[projects]);

  const aplicarFiltros = (list) => {
    if(soloMios && miNombre) list=list.filter(p=>p.responsable===miNombre);
    if(search){const q=search.toLowerCase();list=list.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.dependencia||'').toLowerCase().includes(q)||(p.numLicitacion||'').toLowerCase().includes(q));}
    if(empresa!=='all')list=list.filter(p=>p.company===empresa);
    if(categoria!=='all')list=list.filter(p=>categoriaProyecto(p.productType)===categoria);
    if(status!=='all')list=list.filter(p=>p.status===status);
    if(sort==='recent')list.sort((a,b)=>b.id>a.id?1:-1);
    else if(sort==='amount')list.sort((a,b)=>(b.montoEstimado||0)-(a.montoEstimado||0));
    else if(sort==='deadline')list.sort((a,b)=>(daysUntil(a.fechaFallo)??9999)-(daysUntil(b.fechaFallo)??9999));
    else if(sort==='etapa')list.sort((a,b)=>etapaOrder(a.status)-etapaOrder(b.status));
    return list;
  };

  // Activos (no cerrados) vs cerrados (perdida/cancelada). Hotfix: usa el
  // helper compartido esProyectoPerdido (normalizado) -- para los datos
  // reales de hoy ('perdida'/'cancelada') el resultado es idéntico a
  // GRUPOS.cerradas.includes(p.status), solo más resiliente a variantes.
  const esCerrado = p => esProyectoPerdido(p.status);
  const visible = useMemo(() => {
    let list=[...projects];
    if(grupo!=='todos')list=list.filter(p=>(GRUPOS[grupo]||[]).includes(p.status));
    return aplicarFiltros(list);
  },[projects,search,status,empresa,sort,grupo,soloMios]);

  const activos  = useMemo(()=>aplicarFiltros(visible.filter(p=>!esCerrado(p))),[visible]);
  const cerrados = useMemo(()=>aplicarFiltros(visible.filter(esCerrado)),[visible]);

  const grpCount = id => id==='todos' ? projects.length : projects.filter(p=>(GRUPOS[id]||[]).includes(p.status)).length;
  const kanbanCols = grupo==='todos' ? KANBAN_COLS : (GRUPOS[grupo]||KANBAN_COLS);
  const sumaVisible = visible.reduce((s,p)=>s+(p.montoEstimado||0),0);
  const sumaGanados = projects.filter(p=>GRUPOS.nuestros.includes(p.status)).reduce((s,p)=>s+(p.montoEstimado||0),0);

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
    h('div', { style:{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' } },
      [['proyecciones','📈 Proyecciones'],['nuestros','✅ Ya nuestros'],['cerradas','Cerradas'],['todos','Todos']].map(g=>
        h('button', { key:g[0], className: grupo===g[0]?'bp':'', onClick:()=>setGrupo(g[0]), style:{ fontSize:12, padding:'6px 14px' } }, g[1]+' ('+grpCount(g[0])+')')
      )
    ),
    h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:16, display:'flex', gap:16, flexWrap:'wrap', rowGap:6 } },
      h('span', null, 'Pipeline visible: ', h('strong', { style:{ color:'var(--t1)' } }, fmt(sumaVisible)), ' · ', visible.length, ' proyecto(s)'),
      sumaGanados>0 && h('span', null, '✅ Ganado/contratado: ', h('strong', { style:{ color:'#1D9E75' } }, fmt(sumaGanados))),
    ),
    h('div', { className:'filtros-bar', style:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' } },
      miNombre && h('button', { onClick:()=>setSoloMios(!soloMios),
        style:{ fontSize:13, padding:'6px 14px', borderRadius:'var(--r)', cursor:'pointer', whiteSpace:'nowrap',
          background: soloMios?'var(--t1)':'var(--bg2)', color: soloMios?'#fff':'var(--t2)',
          border:'1px solid '+(soloMios?'var(--t1)':'var(--b2)'), fontWeight: soloMios?600:400 } },
        soloMios?'★ Mis proyectos':'☆ Mis proyectos'),
      h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar...', style:{ maxWidth:200, minWidth:140 } }),
      h('select', { value:empresa, onChange:e=>setEmpresa(e.target.value), style:{ maxWidth:200, minWidth:160 } },
        h('option', { value:'all' }, '🏢 Todas las empresas'),
        empresasUnicas.map(c=>h('option',{key:c,value:c},c))
      ),
      // Fase 3F -- filtro de categoría de proyecto (vehículos/equipo/
      // servicios/mixto/etc.), mismo patrón visual que el de empresa.
      h('select', { value:categoria, onChange:e=>setCategoria(e.target.value), style:{ maxWidth:190, minWidth:170 } },
        h('option', { value:'all' }, '📦 Todas las categorías'),
        Object.entries(CATEGORIA_PROYECTO_LABELS).map(([k,label])=>h('option',{key:k,value:k},label))
      ),
      h('select', { value:status, onChange:e=>setStatus(e.target.value), style:{ maxWidth:170, minWidth:150 } },
        h('option', { value:'all' }, '— Todos los estados —'),
        STATUSES.map(s=>h('option',{key:s.id,value:s.id},s.label))
      ),
      h('select', { value:sort, onChange:e=>setSort(e.target.value), style:{ maxWidth:180, minWidth:160 } },
        h('option', { value:'etapa' }, 'Por etapa (ganados ↑)'),
        h('option', { value:'recent' }, 'Más recientes'),
        h('option', { value:'amount' }, 'Mayor monto'),
        h('option', { value:'deadline' }, 'Fallo próximo'),
      ),
      (empresa!=='all'||status!=='all'||search) && h('button', { onClick:()=>{ setEmpresa('all'); setStatus('all'); setSearch(''); }, style:{ fontSize:12, padding:'5px 12px', color:'var(--t2)' } }, '✕ Limpiar filtros'),
      h('div', { className:'filtro-spacer', style:{ flex:1 } }),
      h('div', { className:'view-toggle', style:{ display:'flex', gap:8 } },
        h('button', { className:view==='table'?'bp':'', onClick:()=>setView('table'), style:{ fontSize:12, padding:'5px 12px' } }, '≡ Tabla'),
        h('button', { className:view==='kanban'?'bp':'', onClick:()=>setView('kanban'), style:{ fontSize:12, padding:'5px 12px' } }, '⎌ Kanban'),
      ),
    ),
    view==='table' && (() => {
      const headerRow = h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
        ['PROYECTO','DEPENDENCIA','EMPRESA','MONTO','ESTADO','FALLO',''].map(hd=>h('th',{key:hd,style:{padding:'10px 8px',color:'var(--t3)',fontSize:11,fontWeight:600,letterSpacing:'.4px',textAlign:'left',whiteSpace:'nowrap',borderBottom:'1px solid var(--b1)'}},hd))
      ));
      const esJefe = getPermissions(user).isAdmin;
      const cambiarEstatus = async (p, nuevoStatus) => {
        if (nuevoStatus === p.status) return;
        const stAnt = STATUSES.find(s=>s.id===p.status);
        const stNue = STATUSES.find(s=>s.id===nuevoStatus);
        const quien = user?.name || user?.email || 'Usuario';
        const entrada = { de:p.status, a:nuevoStatus, por:quien, fecha:new Date().toISOString().slice(0,16).replace('T',' ') };
        const actualizado = { ...p, status:nuevoStatus, statusHistory:[...(p.statusHistory||[]), entrada] };
        onUpdate && onUpdate(actualizado);
        // Si quien cambia NO es el jefe (es un empleado), avisar al jefe
        if (!esJefe) {
          try {
            await avisarCambioEstatus({
              proyectoNombre:p.name, estatusAnterior:stAnt?.label||p.status, estatusNuevo:stNue?.label||nuevoStatus,
              cambiadoPor:quien, jefeEmail:'santiago@brokingroup.com', linkApp:'https://licitapro-beta.vercel.app/?view=project_detail&project='+p.id,
            });
          } catch(e) { console.warn(e); }
        }
      };
      const statusSelect = (p, maxW) => {
        const stRow=STATUSES.find(s=>s.id===p.status);
        return h('select', {
          value:p.status,
          onClick:e=>e.stopPropagation(),
          onChange:e=>{ e.stopPropagation(); cambiarEstatus(p, e.target.value); },
          style:{ fontSize:12, fontWeight:600, padding:'4px 8px', borderRadius:'var(--r)', border:'1px solid '+(stRow?stRow.color:'var(--b1)'), background:stRow?stRow.bg:'var(--bg2)', color:stRow?stRow.tx:'var(--t1)', cursor:'pointer', maxWidth:maxW||170 }
        }, STATUSES.map(s=>h('option',{key:s.id,value:s.id,style:{background:'#fff',color:'#18181b'}}, s.label)));
      };
      // Fila de tabla (desktop)
      const renderRow = p => {
        const alF=alertLevel(p.fechaFallo);
        return h('tr', { key:p.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('project_detail',p.id) },
          h('td', { style:{ padding:'10px 6px', fontWeight:500, maxWidth:220 } },
            h('div', { style:{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textTransform:'uppercase' } }, p.name),
            p.folioProyecto && h('div', { style:{ fontSize:10, color:'var(--t3)' } }, p.folioProyecto),
            // Fase 3F -- insignia de categoría, solo si el proyecto ya
            // está clasificado (categoria !== 'otro') -- no agrega ruido
            // a proyectos legacy sin clasificar.
            categoriaProyecto(p.productType)!=='otro' && h('div', { style:{ fontSize:9, color:'var(--t2)', background:'var(--bg2)', display:'inline-block', padding:'1px 6px', borderRadius:8, marginTop:2 } }, CATEGORIA_PROYECTO_LABELS[categoriaProyecto(p.productType)]),
            p.numLicitacion && h('div', { style:{ fontSize:11, color:'var(--t2)' } }, p.numLicitacion),
          ),
          h('td', { style:{ padding:'10px 6px', color:'var(--t2)', fontSize:12 } }, p.dependencia||'—'),
          h('td', { style:{ padding:'10px 6px', fontSize:12, color:'var(--t2)' } }, p.company||'—'),
          h('td', { style:{ padding:'10px 6px', fontWeight:500, whiteSpace:'nowrap' } }, fmt(p.montoEstimado)),
          h('td', { style:{ padding:'10px 6px' }, onClick:e=>e.stopPropagation() }, statusSelect(p)),
          h('td', { style:{ padding:'10px 6px', fontSize:12, whiteSpace:'nowrap', color:alF==='r'?'var(--red)':alF==='y'?'var(--amber)':'var(--t2)' } }, p.fechaFallo||'—'),
          h('td', { style:{ padding:'10px 6px' } }, h('button', { onClick:e=>{ e.stopPropagation(); onNav('project_detail',p.id); }, style:{ fontSize:11, padding:'3px 8px', whiteSpace:'nowrap' } }, 'Abrir →')),
        );
      };
      // Tarjeta (móvil)
      const renderCard = p => {
        const alF=alertLevel(p.fechaFallo);
        const dleft=daysUntil(p.fechaFallo);
        return h('div', { key:p.id, onClick:()=>onNav('project_detail',p.id),
          style:{ padding:'12px 0', borderBottom:'.5px solid var(--b3)', cursor:'pointer' } },
          // Línea 1: nombre + monto
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, marginBottom:4 } },
            h('div', { style:{ flex:1, minWidth:0 } },
              h('div', { style:{ fontWeight:600, fontSize:14, lineHeight:1.25, textTransform:'uppercase' } }, p.name),
              p.folioProyecto && h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:2 } }, p.folioProyecto),
              p.numLicitacion && h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:1 } }, p.numLicitacion),
            ),
            h('div', { style:{ fontWeight:600, fontSize:14, whiteSpace:'nowrap', flexShrink:0 } }, fmt(p.montoEstimado)),
          ),
          // Línea 2: dependencia + empresa
          (p.dependencia||p.company) && h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:8, display:'-webkit-box', WebkitLineClamp:1, WebkitBoxOrient:'vertical', overflow:'hidden' } },
            [p.company, p.dependencia].filter(Boolean).join(' · ')
          ),
          // Línea 3: estado (editable) + fallo
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }, onClick:e=>e.stopPropagation() },
            statusSelect(p, 200),
            p.fechaFallo
              ? h('div', { style:{ fontSize:11, textAlign:'right', flexShrink:0, color:alF==='r'?'var(--red)':alF==='y'?'var(--amber)':'var(--t2)' } },
                  h('div', { style:{ fontWeight:500 } }, 'Fallo ',p.fechaFallo),
                  dleft!=null && dleft>=0 && h('div', { style:{ fontSize:10 } }, dleft===0?'¡Hoy!':'faltan '+dleft+'d'),
                  dleft!=null && dleft<0 && h('div', { style:{ fontSize:10 } }, 'hace '+Math.abs(dleft)+'d'),
                )
              : h('div', { style:{ fontSize:11, color:'var(--t3)' } }, 'Sin fecha'),
          ),
        );
      };
      const tablaCard = (lista, emptyMsg) => h('div', null,
        // Tabla desktop
        h('div', { className:'hide-mobile', style:{ overflowX:'auto' } },
          h('table', { style:{ fontSize:13 } }, headerRow,
            h('tbody', null, lista.length===0 ? h('tr', null, h('td', { colSpan:7, style:{ padding:'16px 8px', color:'var(--t3)', fontSize:12 } }, emptyMsg)) : lista.map(renderRow))
          )
        ),
        // Tarjetas móvil
        h('div', { className:'show-mobile', style:{ display:'none' } },
          lista.length===0 ? h('div', { style:{ padding:'16px 0', color:'var(--t3)', fontSize:12 } }, emptyMsg) : lista.map(renderCard)
        ),
      );
      return h('div', null,
        h('div', { className:'card' }, tablaCard(activos, 'No hay proyectos activos con estos filtros.')),
        // Hotfix -- perdidos/cancelados ya NO se muestran automáticamente:
        // arrancan colapsados detrás de este botón (sin borrar nada, solo
        // ocultos por default). Mismo contenido/tabla de siempre una vez
        // que se despliega.
        cerrados.length>0 && h('div', { style:{ marginTop:16 } },
          h('button', { onClick:()=>setMostrarCerradas(m=>!m), style:{ fontSize:12, color:'var(--t2)', background:'transparent', border:'1px solid var(--b2)', borderRadius:'var(--r)', padding:'6px 12px', cursor:'pointer' } },
            (mostrarCerradas?'▾ ':'▸ ')+'Cerradas — perdidas y canceladas ('+cerrados.length+')'),
          mostrarCerradas && h('div', { className:'card', style:{ marginTop:8, opacity:.85 } }, tablaCard(cerrados, '')),
        ),
      );
    })(),
    view==='kanban' && h('div', { style:{ overflowX:'auto', WebkitOverflowScrolling:'touch' } },
      h('div', { style:{ display:'flex', gap:12, minWidth:'max-content', paddingBottom:12 } },
        kanbanCols.map(colId => {
          const s=STATUSES.find(x=>x.id===colId), cols=visible.filter(p=>p.status===colId);
          return h('div', { key:colId, style:{ width:220, flexShrink:0 } },
            h('div', { style:{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:.5, color:s?.tx||'var(--t2)', background:s?.bg||'var(--bg2)', padding:'6px 12px', borderRadius:'var(--r)', marginBottom:8 } }, s?.label||colId,' (',cols.length,')'),
            cols.map(p => h('div', { key:p.id, className:'card', style:{ marginBottom:8, cursor:'pointer', fontSize:13 }, onClick:()=>onNav('project_detail',p.id) },
              h('div', { style:{ fontWeight:500, marginBottom:4, lineHeight:1.3, textTransform:'uppercase' } }, p.name),
              p.folioProyecto && h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:4 } }, p.folioProyecto),
              categoriaProyecto(p.productType)!=='otro' && h('div', { style:{ fontSize:9, color:'var(--t2)', background:'var(--bg2)', display:'inline-block', padding:'1px 6px', borderRadius:8, marginBottom:4 } }, CATEGORIA_PROYECTO_LABELS[categoriaProyecto(p.productType)]),
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

export function ProjectForm({ project, companies, config, onSave, onCancel, user, onSaveConfig, projects }) {
  const isE = !!project;
  const [p, sP] = useState(project || { id:uid('proj'), name:'', dependencia:'', nivelGobierno:'', municipio:'', company:'', numLicitacion:'', status:'prospecto', tipoProcedimiento:'', productType:'Patrullas y vehículos', responsable:'', montoEstimado:0, probability:50, description:'', observaciones:'', fechaPublicacion:'', fechaAclaraciones:'', fechaPropuesta:'', fechaFallo:'', fechaContrato:'', clienteEmpresaId:'', clienteRfc:'', clienteDomicilio:'', clienteCorreo:'', clienteTelefono:'', notes:[], activity:[], preguntas:[], docs:[], preparation:{}, cotizacion:{}, folioProyecto:'', tipoOperacion:'Licitación pública' });
  const set = (k,v) => sP(prev=>({...prev,[k]:v}));
  const [basesMsg, setBasesMsg] = useState('');
  // ── Fase 1C: directorio de usuarios activos (user_profiles), reemplaza config.equipo ──
  const [usuariosActivos, setUsuariosActivos] = useState([]);
  useEffect(() => {
    let cancel = false;
    sb.from('user_profiles').select('name,email').eq('active', true).then(({ data }) => {
      if (!cancel && data) setUsuariosActivos(data);
    });
    return () => { cancel = true; };
  }, []);
  // ── Cliente fiscal: reusar empresas guardadas (config.proveedores, compartido con OC) ──
  const empresasGuardadas = (config && config.proveedores) || [];
  const [csfMsg, setCsfMsg] = useState('');
  const [csfAnalizando, setCsfAnalizando] = useState(false);
  const clienteFileRef = useRef(null);
  const seleccionarCliente = (id) => {
    if (!id) { sP(prev=>({...prev, clienteEmpresaId:'', clienteRfc:'', clienteDomicilio:'', clienteCorreo:'', clienteTelefono:'' })); return; }
    const e = empresasGuardadas.find(x=>x.id===id);
    if (!e) return;
    sP(prev=>({ ...prev, clienteEmpresaId:e.id, dependencia:e.name||prev.dependencia, clienteRfc:e.rfc||'', clienteDomicilio:e.address||'', clienteCorreo:e.correo||prev.clienteCorreo||'', clienteTelefono:e.telefono||prev.clienteTelefono||'' }));
  };
  const persistirEmpresaCliente = async (emp) => {
    if (!onSaveConfig || (!emp.name && !emp.rfc)) return emp;
    const cfg = config || {};
    const lista = cfg.proveedores || [];
    const existe = lista.find(x => (emp.rfc && x.rfc===emp.rfc) || (!emp.rfc && x.name===emp.name));
    let nuevos, id;
    if (existe) { id = existe.id; nuevos = lista.map(x => x===existe ? {...x, ...emp} : x); }
    else { id = 'prov-'+Date.now(); nuevos = [...lista, { id, ...emp }]; }
    await onSaveConfig({ ...cfg, proveedores: nuevos });
    return { ...emp, id };
  };
  const analizarCSFCliente = async (file) => {
    if (!file) return;
    setCsfAnalizando(true); setCsfMsg('Analizando constancia...');
    try {
      const { analyzeDocument } = await import('../lib/ai_analyzer.js');
      const data = await analyzeDocument(file, 'constancia');
      const emp = {
        name: data.razonSocial || '',
        rfc:  data.rfc || '',
        address: [data.domicilioFiscal, data.codigoPostal, data.ciudad, data.estado].filter(Boolean).join(', '),
        correo: data.correo || '',
        telefono: data.telefono || '',
      };
      const guardada = await persistirEmpresaCliente(emp);
      sP(prev=>({ ...prev, clienteEmpresaId:guardada.id||'', dependencia:emp.name||prev.dependencia, clienteRfc:emp.rfc, clienteDomicilio:emp.address, clienteCorreo:emp.correo||prev.clienteCorreo, clienteTelefono:emp.telefono||prev.clienteTelefono }));
      setCsfMsg('✓ Datos extraídos y empresa guardada (disponible también en OC)');
    } catch(e) { console.error(e); setCsfMsg('❌ No se pudo analizar: '+e.message); }
    setCsfAnalizando(false);
  };
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
  const doSave = async () => {
    if(!p.name.trim()){alert('El nombre del proyecto es obligatorio');return;}
    // Ajuste solicitado -- el nombre del proyecto se guarda ya en
    // MAYÚSCULAS uniforme (crear y editar comparten este mismo doSave).
    // Solo el nombre -- dependencia/numLicitacion/descripciones/etc. NO
    // se tocan. `p` es const (useState) -- no se reasigna, se construye
    // un objeto nuevo para lo que realmente se envía a guardar.
    let pParaGuardar = { ...p, name: normalizeProjectName(p.name) };
    // Fase 3C-1 -- folio interno maestro: se genera SOLO al crear (!isE),
    // y SOLO si todavía no trae uno (por si acaso se llama doSave() dos
    // veces, o el usuario ya lo trae de algún flujo futuro) -- nunca se
    // regenera ni se sobreescribe un folio ya existente. Al editar
    // (isE===true) nunca se toca este campo, sea cual sea su valor.
    if (!isE && !pParaGuardar.folioProyecto) {
      pParaGuardar.folioProyecto = generarFolioProyecto(pParaGuardar.company, pParaGuardar.tipoOperacion, new Date().getFullYear(), projects);
    }
    // Fase 3C-2 -- folio DERIVADO de cotización: solo hay UNA cotización
    // por proyecto en el modelo actual (sin historial de versiones, ver
    // diagnóstico) -- así que siempre es {folioProyecto}-COT-01. Se
    // persiste en cotizacion.folio SOLO si el proyecto acaba de recibir
    // folioProyecto (creación nueva) Y cotizacion.folio todavía está
    // vacío -- nunca se sobreescribe un folio ya tecleado manualmente.
    if (!isE && pParaGuardar.folioProyecto && !(pParaGuardar.cotizacion && pParaGuardar.cotizacion.folio)) {
      pParaGuardar.cotizacion = { ...(pParaGuardar.cotizacion||{}), folio: generarFolioCotizacion(pParaGuardar.folioProyecto, 1) };
    }
    // ¿Cambió el responsable? Si es uno nuevo (distinto al original), ofrecer avisarle
    const respAnterior = project?.responsable || '';
    const respNuevo = p.responsable || '';
    let avisar = false;
    if (respNuevo && respNuevo !== respAnterior) {
      const emp = usuariosActivos.find(e => e.name === respNuevo);
      if (emp && emp.email) {
        avisar = confirm('¿Enviar correo a '+respNuevo+' avisándole que es responsable de este proyecto?');
        if (avisar) {
          try {
            await avisarAsignacionProyecto({
              responsableNombre:emp.name, responsableEmail:emp.email,
              proyectoNombre:pParaGuardar.name, dependencia:p.dependencia, numLicitacion:p.numLicitacion, fechaFallo:p.fechaFallo,
              asignadoPor:(user?.name||user?.email||'La dirección'), linkApp:'https://licitapro-beta.vercel.app/?view=project_detail&project='+p.id,
            });
            alert('✅ Correo enviado a '+emp.email);
          } catch(e) { alert('El proyecto se guardará, pero el correo no se pudo enviar: '+e.message); }
        }
      }
    }
    await onSave(pParaGuardar,true);
  };
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
        // Fase 3C-1 -- clasifica el TIPO del folio interno maestro
        // (LIC/VTA/COM/OTR). No existía ningún campo real que distinguiera
        // esto antes (confirmado: tipoProcedimiento solo describe métodos
        // de licitación pública, nunca "venta privada"/"compra interna").
        // Default 'Licitación pública' -- cubre el caso de uso actual, que
        // es 100% licitación pública. Valores en español legible, mismo
        // criterio que TIPOS_PROCEDIMIENTO/TIPOS_PRODUCTO (Inp no soporta
        // labels separadas del value, así que se usa el string legible
        // directamente como valor almacenado).
        h(Inp, { label:'Tipo de operación', value:p.tipoOperacion||'Licitación pública', onChange:v=>set('tipoOperacion',v), options:['Licitación pública','Venta privada','Compra interna','Otro'] }),
        h(Inp, { label:'Nivel de gobierno', value:p.nivelGobierno, onChange:v=>set('nivelGobierno',v), options:[...DEPENDENCIAS_COMUNES,...(config?.customStatuses||[])] }),
        h(Inp, { label:'Dependencia (nombre)', value:p.dependencia, onChange:v=>set('dependencia',v), placeholder:'Dirección de Desarrollo Urbano…' }),
        h(Inp, { label:'Municipio / Ciudad', value:p.municipio||'', onChange:v=>set('municipio',v), placeholder:'Tultitlán, Tlalnepantla…' }),
        h(Inp, { label:'Empresa licitante', value:p.company, onChange:v=>set('company',v), options:companies.map(c=>c.name) }),
        h(Inp, { label:'Núm. de licitación', value:p.numLicitacion, onChange:v=>set('numLicitacion',v), placeholder:'LA-019GYN999-E1-2025' }),
        (() => {
          if (usuariosActivos.length === 0) return h(Inp, { label:'Responsable', value:p.responsable, onChange:v=>set('responsable',v), placeholder:'Sin usuarios activos disponibles' });
          // Desplegable con los usuarios activos + valor legado si el responsable
          // actual no está en la lista (no se pierde, no se normaliza, no se
          // hace fuzzy matching — se conserva tal cual, Fase 1 Revisión 4).
          const opciones = usuariosActivos.map(u=>u.name);
          if (p.responsable && !opciones.includes(p.responsable)) opciones.push(p.responsable);
          return h(Inp, { label:'Responsable', value:p.responsable||'', onChange:v=>set('responsable',v), options:opciones });
        })(),
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
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:4 } }, '🏛️ Datos fiscales del cliente'),
          h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:14 } }, 'Para cotizaciones dirigidas a una empresa. Elige una empresa guardada o sube su Constancia de Situación Fiscal (queda ligada con las de OC).'),
          // Selector de empresa guardada
          empresasGuardadas.length > 0 && h('div', { style:{ marginBottom:12 } },
            h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:3 } }, 'Empresa guardada'),
            h('select', { value:p.clienteEmpresaId||'', onChange:e=>seleccionarCliente(e.target.value), style:{ fontSize:13, width:'100%', padding:'8px' } },
              h('option', { value:'' }, '— Seleccionar empresa / capturar manual —'),
              empresasGuardadas.map(e=>h('option', { key:e.id, value:e.id }, e.name+(e.rfc?' · '+e.rfc:''))),
            ),
          ),
          // Subir CSF
          h('div', { style:{ marginBottom:14 } },
            h('input', { ref:clienteFileRef, type:'file', accept:'application/pdf,image/*', style:{ display:'none' }, onChange:e=>{ analizarCSFCliente(e.target.files[0]); e.target.value=''; } }),
            h('button', { type:'button', disabled:csfAnalizando, onClick:()=>clienteFileRef.current&&clienteFileRef.current.click(), style:{ fontSize:12, padding:'7px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:csfAnalizando?'wait':'pointer' } }, csfAnalizando?'Analizando...':'📎 Subir Constancia de Situación Fiscal'),
            csfMsg && h('div', { style:{ fontSize:11, color: csfMsg.startsWith('❌')?'var(--red)':'var(--green)', marginTop:6 } }, csfMsg),
          ),
          // Campos fiscales editables
          h('div', { className:'mob-2col', style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
            h(Inp, { label:'Razón social / Cliente', value:p.dependencia, onChange:v=>set('dependencia',v), placeholder:'Nombre de la empresa cliente' }),
            h(Inp, { label:'RFC', value:p.clienteRfc||'', onChange:v=>set('clienteRfc',v), placeholder:'XAXX010101000' }),
            h('div', { style:{ gridColumn:'1/-1' } }, h(Inp, { label:'Domicilio fiscal', value:p.clienteDomicilio||'', onChange:v=>set('clienteDomicilio',v), placeholder:'Calle, número, colonia, CP, ciudad' })),
            h(Inp, { label:'Correo', value:p.clienteCorreo||'', onChange:v=>set('clienteCorreo',v), placeholder:'contacto@empresa.com' }),
            h(Inp, { label:'Teléfono', value:p.clienteTelefono||'', onChange:v=>set('clienteTelefono',v), placeholder:'55 1234 5678' }),
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

export function ProjectDetail({ project, vehicles, companies, config, projects, onSaveConfig, onSaveCompany, onUpdate, onDelete, onSave, onNav, user, logFn, activeTab, setActiveTab, cotSubTab, setCotSubTab, operacionSubTab, setOperacionSubTab, docsSubTab, setDocsSubTab }) {
  const [showEdit, setShowEdit]     = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showOC, setShowOC]         = useState(false);
  // Fase 3I-1b -- aviso de "Exportar expediente". El botón existe desde
  // ahora en el Centro de Control (no es un botón muerto: siempre lleva a
  // Expediente), pero la exportación real (ZIP/paquete bancario) queda
  // explícitamente fuera de alcance por ahora.
  const [showExportarExp, setShowExportarExp] = useState(false);
  const [note, setNote]             = useState('');
  const [pregunta, setPregunta]     = useState('');
  // cotTab (sub-pestaña de Cotización) ya NO es estado local — se levantó a
  // App.js (cotSubTab/setCotSubTab) para que persista correctamente al
  // recargar la página, igual que ya pasaba con projTab/activeTab.
  const [selVehicle, setSelVehicle] = useState(null);
  const tab    = activeTab || 'info';
  const setTab = useCallback(t=>{ if(setActiveTab)setActiveTab(t); },[setActiveTab]);
  // ── Fase 1C: directorio de usuarios activos (user_profiles), reemplaza config.equipo ──
  const [usuariosActivosDetalle, setUsuariosActivosDetalle] = useState([]);
  useEffect(() => {
    let cancel = false;
    sb.from('user_profiles').select('name,email,role').eq('active', true).then(({ data }) => {
      if (!cancel && data) setUsuariosActivosDetalle(data);
    });
    return () => { cancel = true; };
  }, []);
  // Fase 3D-B1.1 -- las firmas de OC NUEVAS ya no se guardan en
  // project.firmas[] (Fase 3D-B1), sino como inbox_items. Para que
  // ocAprobada()/enFlujo() (más abajo) reconozcan AMBOS mundos sin romper
  // el legacy, se consulta Inbox UNA vez por proyecto -- mismo patrón ya
  // usado en CotizacionOperativa.js para su badge de estatus (reutiliza
  // listInboxItems(), sin endpoint nuevo). Solo se filtra localmente por
  // type/source/ocId -- nunca se piden ni se muestran datos financieros
  // aquí, es la misma respuesta ya sanitizada de siempre.
  const [inboxFirmasOC, setInboxFirmasOC] = useState([]);
  useEffect(() => {
    let cancel = false;
    listInboxItems()
      .then(({ items }) => {
        if (cancel) return;
        const propias = (items||[]).filter(i =>
          i.type==='firma_documento' && i.data && i.data.source==='orden_compra' && i.project_id===project.id
        );
        setInboxFirmasOC(propias);
      })
      .catch(e => console.error('[ProjectDetail] No se pudo consultar firmas de OC en Inbox:', e));
    return () => { cancel = true; };
  }, [project.id]);
  const company = companies.find(c=>c.name===project.company);
  // Fase 3I-1 -- helpers de estatus de firma ELEVADOS al nivel de
  // ProjectDetail. Antes vivían anidados dentro de la IIFE de la pestaña
  // Operación (inaccesibles desde el header/cards). Se movieron aquí SIN
  // ningún cambio de lógica -- byte por byte la misma implementación --
  // para que las cards de resumen y la pestaña Operación usen la MISMA
  // fuente de verdad, en vez de duplicar la regla en dos lugares.
  const inboxFirmaDeOC = oc => inboxFirmasOC.find(i =>
    (i.data && i.data.ocId === oc.id) || (i.data && !i.data.ocId && i.data.documentoFolio === oc.folio)
  );
  const ocAprobada = oc => {
    if ((project.firmas||[]).some(f => f.ocId===oc.id && (f.estatus==='en_firma' || f.estatus==='en_visto' || f.estatus==='completado'))) return true;
    const item = inboxFirmaDeOC(oc);
    if (!item) return false;
    if (['aprobado', 'cerrado'].includes(item.status)) return true;
    if (item.data && ['firmado', 'visto_final'].includes(item.data.firmaStatus)) return true;
    return false;
  };
  const enFlujo = oc => {
    const legacy = (project.firmas||[]).find(f => f.ocId===oc.id && f.estatus!=='completado');
    if (legacy) return legacy;
    const item = inboxFirmaDeOC(oc);
    if (!item) return undefined;
    if (['pendiente', 'en_revision', 'cambios_solicitados'].includes(item.status)) return item;
    if (item.data && item.data.firmaStatus === 'pendiente_firma') return item;
    return undefined;
  };

  // ── Fase 3I-2 -- Estados operativos de OC ────────────────────────────
  // Criterio de negocio nuevo: NO todas las OC requieren firma. Algunas se
  // emiten, se mandan al proveedor y solo quedan como soporte documental.
  //
  // Modelo NO DESTRUCTIVO: se agregan dos campos OPCIONALES a cada OC
  // (`requiereFirma` y `estadoOperativo`). Las OC legacy no los tienen, y
  // todo se DERIVA de los datos que ya existen -- ninguna OC existente se
  // migra, se reescribe ni se rompe.
  //
  // `requiereFirma` ausente => true (comportamiento histórico: hasta hoy
  // toda OC se trataba como si fuera a firma). Solo se marca false cuando
  // el usuario lo elige explícitamente.
  const ocRequiereFirma = oc => oc.requiereFirma !== false;

  // Estado operativo efectivo. Si la OC tiene `estadoOperativo` guardado,
  // manda ese -- EXCEPTO cuando la realidad de la firma lo supera (una OC
  // marcada 'emitida' que ya volvió firmada debe leerse como 'firmada').
  // Si no lo tiene (legacy), se deriva por completo.
  const estadoOperativoOC = oc => {
    if (oc.estadoOperativo === 'cancelada') return 'cancelada';
    if (ocAprobada(oc)) return 'firmada';
    if (enFlujo(oc)) return 'en_firma';
    if (oc.estadoOperativo) return oc.estadoOperativo;
    // Legacy / sin estado guardado: si no requiere firma, es soporte
    // documental ya emitido; si sí la requiere, está emitida esperando
    // que alguien la mande a firma.
    return 'emitida';
  };
  const ESTADO_OP_LABEL = {
    borrador: 'Borrador',
    emitida: 'Emitida',
    enviada_proveedor: 'Enviada al proveedor',
    en_firma: 'En firma',
    firmada: 'Firmada',
    archivada_expediente: 'Archivada',
    cancelada: 'Cancelada',
  };
  // Etiqueta de FIRMA -- independiente del estado operativo.
  const estadoFirmaOC = oc => {
    if (estadoOperativoOC(oc) === 'cancelada') return '—';
    if (!ocRequiereFirma(oc)) return 'No requerida';
    if (ocAprobada(oc)) return 'Firmada';
    if (enFlujo(oc)) return 'Pendiente';
    return 'Sin enviar';
  };
  // Etiqueta de EXPEDIENTE -- una OC cuenta como "en expediente" cuando ya
  // volvió firmada (soporte con firma) o cuando se archivó explícitamente.
  const estadoExpedienteOC = oc => {
    const e = estadoOperativoOC(oc);
    if (e === 'archivada_expediente' || e === 'firmada') return 'En expediente';
    if (e === 'cancelada') return '—';
    return 'Pendiente';
  };
  // ¿Cuenta como PENDIENTE de atención? Una OC marcada explícitamente como
  // "solo expediente" y ya archivada NO es pendiente -- ese es justamente
  // el punto del criterio nuevo.
  const ocEsPendiente = oc => {
    const e = estadoOperativoOC(oc);
    if (['firmada', 'archivada_expediente', 'cancelada'].includes(e)) return false;
    if (e === 'en_firma') return false; // ya está en curso, se cuenta aparte
    return true;
  };
  // Cambiar el estado operativo de una OC: ver setEstadoOC más abajo
  // (se declara después de updProject, del que depende).
  // Fase 0C: solo admin ve costos/utilidad/márgenes (pestaña Cotización) y
  // puede borrar proyectos definitivamente.
  const isAdmin = getPermissions(user).isAdmin;
  const updProject = useCallback(updated=>onUpdate(updated),[onUpdate]);
  // Fase 3I-2 -- cambiar el estado operativo de una OC. Declarado AQUÍ (no
  // junto a los demás helpers de estado) porque depende de updProject.
  // ADMIN-ONLY a propósito: se confirmó empíricamente que
  // data_sanitize.js NO permite a empleado escribir en
  // project.ordenesCompra[] (se preserva del original), así que un botón
  // para empleado se perdería en silencio. Mejor no ofrecerlo.
  const setEstadoOC = (oc, nuevoEstado) => {
    updProject({
      ...project,
      ordenesCompra: (project.ordenesCompra||[]).map(o =>
        o.id === oc.id ? { ...o, estadoOperativo: nuevoEstado } : o
      ),
    });
  };
  const cotRef = useRef(project.cotizacion||{});
  cotRef.current = project.cotizacion || {};
  const pVehicles  = vehicles.filter(v=>v.projectId===project.id);
  const alerts = [];
  [['Aclaraciones',project.fechaAclaraciones],['Propuesta',project.fechaPropuesta],['Fallo',project.fechaFallo],['Contrato',project.fechaContrato]]
    .forEach(([l,d])=>{ const lv=alertLevel(d); if(lv)alerts.push({label:l,date:d,level:lv,days:daysUntil(d)}); });

  // ── Fase 3I-1 -- Centro de Control: datos DERIVADOS de lo que ya existe.
  // No se crea ningún campo, tabla ni obligación nueva -- todo se calcula
  // en memoria a partir del proyecto y de inboxFirmasOC ya cargado.
  const ccOCs = project.ordenesCompra || [];
  // Fase 3I-2 -- los contadores ahora respetan el criterio nuevo: una OC
  // marcada como "solo expediente" y ya archivada NO cuenta como
  // pendiente, y las canceladas se separan.
  const ccOCsFirmadas    = ccOCs.filter(oc => estadoOperativoOC(oc)==='firmada');
  const ccOCsEnFirma     = ccOCs.filter(oc => estadoOperativoOC(oc)==='en_firma');
  const ccOCsExpediente  = ccOCs.filter(oc => estadoOperativoOC(oc)==='archivada_expediente');
  const ccOCsCanceladas  = ccOCs.filter(oc => estadoOperativoOC(oc)==='cancelada');
  const ccOCsSinEnviar   = ccOCs.filter(oc => ocEsPendiente(oc));
  // Total de OCs -- SOLO admin (precioUnit es costo interno, mismo criterio
  // que sanitizeOrdenCompraForRole ya aplica). Para empleado queda null y
  // la card simplemente no muestra el monto.
  const ccTotalOCs = isAdmin
    ? ccOCs.reduce((s,oc)=>s+(oc.partidas||[]).reduce((s2,p)=>s2+(Number(p.precioUnit)||0)*(Number(p.cantidad)||0),0),0)
    : null;
  const ccCot = project.cotizacion || {};
  const ccNumPartidas  = (ccCot.partidas||[]).filter(p=>p.activo && (p.cantidad||0)>0).length;
  const ccNumEquipo    = (ccCot.equipo||[]).filter(e=>e.usar).length;
  const ccNumServicios = (ccCot.servicios||[]).filter(s=>s.usar).length;
  const ccHayCotizacion = ccNumPartidas>0 || ccNumEquipo>0 || ccNumServicios>0;
  const ccNumDocs = (project.docs||[]).length;

  // Pendientes -- mensajes derivados de datos existentes, nunca de reglas
  // nuevas. Cada uno corresponde a algo que el usuario realmente puede
  // resolver dentro de la app tal como está hoy.
  const ccPendientes = [];
  if (!project.dependencia)  ccPendientes.push({ t:'Sin cliente / dependencia asignada.', nivel:'aviso' });
  if (!project.company)      ccPendientes.push({ t:'Sin empresa operadora asignada.', nivel:'aviso' });
  if (!project.responsable)  ccPendientes.push({ t:'Sin responsable asignado.', nivel:'aviso' });
  if (!ccHayCotizacion)      ccPendientes.push({ t:'Aún no hay partidas, equipo ni servicios capturados en la cotización.', nivel:'aviso' });
  if (ccHayCotizacion && ccOCs.length===0) ccPendientes.push({ t:'Hay cotización capturada pero todavía no se genera ninguna orden de compra.', nivel:'aviso' });
  if (ccOCsSinEnviar.length>0) ccPendientes.push({ t:ccOCsSinEnviar.length+' orden(es) de compra sin cerrar: envíalas a firma o márcalas en expediente.', nivel:'aviso' });
  if (ccOCsEnFirma.length>0)   ccPendientes.push({ t:ccOCsEnFirma.length+' orden(es) de compra esperando firma.', nivel:'info' });

  const addNote = () => {    if (!note.trim()) return;
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

  // Cambiar estatus del proyecto y registrarlo en la actividad (para seguimiento)
  const cambiarEstatus = (nuevoStatus) => {
    if (nuevoStatus === project.status) return;
    const stAnt = STATUSES.find(s=>s.id===project.status);
    const stNue = STATUSES.find(s=>s.id===nuevoStatus);
    const quien = user?.name || user?.email || 'Usuario';
    const entrada = { id:uid('act'), tipo:'estatus', texto:'Cambió el estatus de "'+(stAnt?.label||project.status)+'" a "'+(stNue?.label||nuevoStatus)+'"', author:quien, date:NOW() };
    updProject({ ...project, status:nuevoStatus, activity:[entrada, ...(project.activity||[])] });
    if(logFn)logFn(user,'cambió estatus a '+(stNue?.label||nuevoStatus),'proyecto',project.id,project.name);
  };

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

  if(showEdit) return h(ProjectForm, { project, companies, config, user, projects, onSaveConfig, onSave:async(updated)=>{ await onSave(updated); setShowEdit(false); }, onCancel:()=>setShowEdit(false) });
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
      h('span', { style:{ fontSize:12, textTransform:'uppercase' } }, project.name),
      project.folioProyecto && h('span', { style:{ fontSize:11, color:'var(--t3)' } }, '· ', project.folioProyecto),
    ),
    // Header
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 } },
      h('div', { style:{ minWidth:0, flex:1 } },
        h('div', { style:{ fontSize:22, fontWeight:600, marginBottom:6, lineHeight:1.25, letterSpacing:'-0.4px', textTransform:'uppercase' } }, project.name),
        // Fase 3I-1 -- línea de contexto ejecutiva: folio · cliente ·
        // categoría de proyecto, todo en un renglón legible de un vistazo.
        h('div', { style:{ fontSize:12.5, color:'var(--t2)', marginBottom:10, lineHeight:1.5 } },
          [
            project.folioProyecto,
            project.dependencia,
            categoriaProyecto(project.productType)!=='otro' ? CATEGORIA_PROYECTO_LABELS[categoriaProyecto(project.productType)] : null,
            project.tipoOperacion,
          ].filter(Boolean).join(' · ')
        ),
        h('div', { style:{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' } },
          h(Badge, { statusId:project.status }),
          project.responsable && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, 'Responsable: ', project.responsable),
          project.company && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, '· ', project.company),
          project.numLicitacion && h('span', { style:{ fontSize:11, color:'var(--t2)', fontFamily:'monospace' } }, project.numLicitacion),
          alerts.map((a,i)=>h(AlertChip, { key:i, level:a.level, text:a.label+': '+a.date })),
        ),
      ),
      h('div', { className:'acciones-row', style:{ display:'flex', gap:8, flexWrap:'wrap' } },
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
          await onSave(copia, true);
        }}, '⧉ Duplicar'),
        isAdmin && h('button', { onClick:()=>setShowDelete(true), style:{ color:'#E24B4A' } }, 'Eliminar'),
      ),
    ),
    // Fase 3I-1 -- Centro de Control: 4 cards de resumen que reemplazan
    // los KPIs genéricos anteriores (Monto/Probabilidad/Empresa/Vehículos/
    // Responsable -- empresa y responsable ya subieron al header, y monto/
    // probabilidad siguen visibles en la pestaña Resumen). Todo derivado
    // de datos existentes.
    h('div', { className:'grid-4', style:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 } },
      h('div', { className:'metric' },
        h('div', { className:'section-label', style:{ marginBottom:6 } }, 'Cotización'),
        h('div', { style:{ fontSize:18, fontWeight:600, lineHeight:1.2 } }, ccHayCotizacion ? (ccNumPartidas+ccNumEquipo+ccNumServicios) : '—'),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:4 } },
          ccHayCotizacion
            ? [ccNumPartidas?ccNumPartidas+' vehículo(s)':null, ccNumEquipo?ccNumEquipo+' equipo':null, ccNumServicios?ccNumServicios+' servicio(s)':null].filter(Boolean).join(' · ')
            : 'Sin capturar'),
      ),
      h('div', { className:'metric' },
        h('div', { className:'section-label', style:{ marginBottom:6 } }, 'Órdenes de compra'),
        h('div', { style:{ fontSize:18, fontWeight:600, lineHeight:1.2 } }, ccOCs.length),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:4 } },
          ccOCs.length===0 ? 'Ninguna generada'
            : [ccOCsFirmadas.length?ccOCsFirmadas.length+' firmada(s)':null, ccOCsEnFirma.length?ccOCsEnFirma.length+' en firma':null, ccOCsExpediente.length?ccOCsExpediente.length+' en expediente':null, ccOCsSinEnviar.length?ccOCsSinEnviar.length+' sin cerrar':null, ccOCsCanceladas.length?ccOCsCanceladas.length+' cancelada(s)':null].filter(Boolean).join(' · ')),
      ),
      h('div', { className:'metric' },
        h('div', { className:'section-label', style:{ marginBottom:6 } }, isAdmin ? 'Total en OCs' : 'Documentos'),
        h('div', { style:{ fontSize:18, fontWeight:600, lineHeight:1.2 } }, isAdmin ? fmt(ccTotalOCs) : ccNumDocs),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:4 } }, isAdmin ? 'Suma de órdenes generadas' : (ccNumDocs===1?'archivo cargado':'archivos cargados')),
      ),
      h('div', { className:'metric' },
        h('div', { className:'section-label', style:{ marginBottom:6 } }, 'Pendientes'),
        h('div', { style:{ fontSize:18, fontWeight:600, lineHeight:1.2, color: ccPendientes.length>0 ? 'var(--amber)' : 'var(--green)' } }, ccPendientes.length),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:4 } }, ccPendientes.length===0 ? 'Todo en orden' : 'Ver detalle abajo'),
      ),
    ),

    // Fase 3I-1 -- bloque de pendientes derivados + acciones rápidas.
    // Fase 3I-1b -- corrección de alcance: SÍ existe un botón "Exportar
    // expediente" (abre un aviso con acción real a Expediente), pero la
    // exportación real -- ZIP completo, paquete bancario, separación
    // documental avanzada -- sigue explícitamente FUERA de alcance.
    (ccPendientes.length>0) && h('div', { style:{ marginBottom:16, padding:'14px 16px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--rl)' } },
      h('div', { className:'section-label', style:{ color:'#78350f' } }, 'Pendientes del proyecto'),
      h('ul', { style:{ margin:0, paddingLeft:18 } },
        ccPendientes.map((p,i)=>h('li', { key:i, style:{ fontSize:12, color:'#78350f', lineHeight:1.7 } }, p.t)),
      ),
    ),
    h('div', { className:'acciones-row', style:{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' } },
      h('button', { onClick:()=>setTab('cotizacion') }, 'Ir a Cotización'),
      h('button', { onClick:()=>setTab('operacion') }, 'Ir a Operación'),
      h('button', { onClick:()=>setTab('docs') }, 'Ir a Expediente'),
      h('button', { onClick:()=>setShowExportarExp(true) }, 'Exportar expediente'),
      h('button', { onClick:()=>{ setTab('operacion'); setShowOC(true); } }, '+ Generar OC'),
      h('button', { onClick:()=>onNav('inbox') }, 'Ver aprobaciones'),
    ),
    // Tabs — filtradas con canProjectTab(t.id, user) desde permissions.js.
    // La lista de pestañas admin-only (cotizacion, facturacion, flujo) vive
    // ahí, no aquí — evita duplicar esa lista en dos archivos.
    h('div', { style:{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--b1)', overflowX:'auto', flexWrap:'nowrap', WebkitOverflowScrolling:'touch', scrollbarWidth:'none', msOverflowStyle:'none' } },
      PROJ_TABS.filter(t=>canProjectTab(t.id, user)).map(t=>h('button',{key:t.id,className:'tab'+(tab===t.id?' active':''),onClick:()=>setTab(t.id),style:{flexShrink:0,whiteSpace:'nowrap'}},t.l))
    ),
    // Info
    // Fase 2A6: Resumen fusiona lo que antes eran 3 tabs separados
    // (Información + Borrador + Actividad) -- mismo contenido, sin
    // reinventar nada, solo reubicado bajo un solo tab principal.
    tab==='resumen' && h('div', null,
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
      // Historial de cambios de estatus
      (project.statusHistory||[]).length > 0 && h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, '📊 Historial de estatus'),
        [...(project.statusHistory||[])].reverse().map((hh,i) => {
          const stDe = STATUSES.find(s=>s.id===hh.de);
          const stA = STATUSES.find(s=>s.id===hh.a);
          return h('div', { key:i, style:{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'.5px solid var(--b3)', fontSize:12, flexWrap:'wrap' } },
            h('div', null,
              h('span', { style:{ color:'var(--t3)' } }, (stDe?.label||hh.de||'inicio')),
              h('span', { style:{ margin:'0 6px', color:'var(--t3)' } }, '→'),
              h('span', { style:{ fontWeight:600, color:stA?.color||'var(--t1)' } }, stA?.label||hh.a),
            ),
            h('div', { style:{ color:'var(--t3)', fontSize:11 } }, hh.por+' · '+hh.fecha),
          );
        }),
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
      // Borrador -- mismo componente BorradorTab de siempre, sin cambios
      // de lógica, ahora como sección dentro de Resumen en vez de tab propio.
      h('div', { style:{ marginTop:24, paddingTop:20, borderTop:'1px solid var(--b2)' } },
        h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.4px' } }, 'Notas internas / Borrador'),
        h(BorradorTab, { project, config, onUpdate:updProject, logFn }),
      ),
      // Actividad -- mismo contenido de siempre (notas de seguimiento),
      // ahora como bloque compacto dentro de Resumen en vez de tab propio.
      h('div', { style:{ marginTop:24, paddingTop:20, borderTop:'1px solid var(--b2)' } },
        h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.4px' } }, 'Actividad reciente'),
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
    )),
    // Fase 2A6: Operación fusiona Vehículos + Facturación + Flujo de Pagos
    // bajo un solo tab principal, con su propia sub-navegación interna.
    // Facturación y Flujo siguen siendo admin-only -- ahora ese gate vive
    // en getAllowedSubTabs('operacion', user) en vez de a nivel de tab
    // completo (mismo patrón que Cotización desde Fase 2A4). Ninguno de
    // los 3 componentes (VehiclesTab, BillingTab, Flujo) cambió su lógica
    // interna -- solo se re-envuelven aquí.
    tab==='operacion' && (() => {
      const opSubTabsPermitidas = getAllowedSubTabs('operacion', user);
      const opSubTab = (opSubTabsPermitidas.includes(operacionSubTab) ? operacionSubTab : opSubTabsPermitidas[0]) || 'vehiculos';
      const OP_LABELS = { vehiculos:'Vehículos', facturacion:'Facturación', flujo:'Flujo de Pagos' };
      return h('div', null,
        opSubTabsPermitidas.length > 1 && h('div', { style:{ display:'flex', gap:6, marginBottom:16, borderBottom:'1px solid var(--b1)', paddingBottom:2, overflowX:'auto' } },
          opSubTabsPermitidas.map(st => h('button', {
            key:st,
            onClick:()=>setOperacionSubTab && setOperacionSubTab(st),
            style:{ fontSize:12, padding:'7px 14px', borderRadius:'var(--r) var(--r) 0 0', border:'none', borderBottom: opSubTab===st?'2px solid var(--blue)':'2px solid transparent', background:'transparent', color: opSubTab===st?'var(--blue)':'var(--t2)', fontWeight: opSubTab===st?600:400, cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' },
          }, OP_LABELS[st] || st)),
        ),
        opSubTab==='vehiculos' && h(VehiclesTab, { project, vehicles:pVehicles, onSave:v=>onNav('save_vehicle',v), onDelete:id=>onNav('delete_vehicle',id), onNav:(view,id)=>{ if(view==='vehicle_detail')setSelVehicle(id); else onNav(view,id); }, user, logFn }),
        opSubTab==='facturacion' && h(BillingTab, { project, vehicles:pVehicles, onNav:(view,id)=>{ if(view==='vehicle_detail'){ setSelVehicle(id); } else { onNav(view,id); } } }),
        opSubTab==='flujo' && h(Flujo, { project, onUpdate:updProject }),
      );
    })(),
    // Cotización — Fase 2A4: admin ve CotizacionTab completa (costos,
    // márgenes, PDF interno/cliente, OC); empleado ve CotizacionOperativa,
    // un componente completamente distinto, sin ningún dato/cálculo
    // financiero en su alcance. `project` que reciben ambos ya viene
    // decidido por App.js (raw para admin, saneado para empleado) — este
    // bloque no necesita sanear nada por su cuenta.
    tab==='cotizacion' && isAdmin && h('div', null,
      h('div', { style:{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', paddingBottom:14, borderBottom:'.5px solid var(--b3)' } },
        h('div', { style:{ fontSize:11, color:'var(--t2)', alignSelf:'center', marginRight:4 } }, 'Exportar PDF:'),
        h('button', { onClick:async ()=>{ const c=cotRef.current; const cc=calcCotizacion(c); await printCotizacionCliente({project,cot:c,calc:cc,config:window._lpConfig,companyObj:company}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--blue)44', color:'var(--blue)', background:'#3b6cf408' } }, '📄 Cotización cliente'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenRetornos({project,cot:c,calc:cc,companyObj:company}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--amber)44', color:'var(--amber)', background:'#d9770608' } }, '📋 Resumen retornos'),
        h('button', { onClick:()=>{ const c=project.cotizacion||{}; const cc=calcCotizacion(c); printResumenInterno({project,cot:c,calc:cc,companyObj:company}); }, style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--t3)44', color:'var(--t2)' } }, '🔒 Corrida financiera interna'),
        h('button', { onClick:()=>setShowOC(true), style:{ fontSize:11, padding:'5px 12px', border:'.5px solid #1D9E7544', color:'#1D9E75', background:'#1D9E7508' } }, '🛒 Orden de compra'),
      ),
      h(CotizacionTab, { project, onUpdate:(updated)=>{ cotRef.current=updated.cotizacion||{}; updProject(updated); }, activeTab:cotSubTab, setActiveTab:setCotSubTab, config, onSaveConfig }),
    ),
    // Cotización Operativa — empleado. Sin botones de PDF/OC/IA financiera;
    // ninguno de esos vive dentro de CotizacionOperativa.js en absoluto.
    tab==='cotizacion' && !isAdmin && h(CotizacionOperativa, { key:project.id, project, onUpdate:updProject, activeTab:cotSubTab, setActiveTab:setCotSubTab, user, logFn }),
    // Fase 2A6 (cierre): Expediente fusiona Bases + Documentos + Preguntas
    // bajo el tab principal 'docs' (id interno sin cambios, label visible
    // 'Expediente'), con su propia sub-navegación interna -- mismo patrón
    // que Operación (Fase 2A6) y Cotización (Fase 2A4). Ninguno de los 3
    // bloques (BasesPreparacion, OC+DocsTab, Preguntas) cambió su lógica
    // interna -- solo se re-envuelven aquí, reubicados sin reprogramar nada.
    tab==='docs' && (() => {
      const expSubTabsPermitidas = getAllowedSubTabs('docs', user);
      const expSubTab = (expSubTabsPermitidas.includes(docsSubTab) ? docsSubTab : expSubTabsPermitidas[0]) || 'documentos';
      const EXP_LABELS = { documentos:'Documentos', bases:'Bases', preguntas:'Preguntas' };
      return h('div', null,
        expSubTabsPermitidas.length > 1 && h('div', { style:{ display:'flex', gap:6, marginBottom:16, borderBottom:'1px solid var(--b1)', paddingBottom:2, overflowX:'auto' } },
          expSubTabsPermitidas.map(st => h('button', {
            key:st,
            onClick:()=>setDocsSubTab && setDocsSubTab(st),
            style:{ fontSize:12, padding:'7px 14px', borderRadius:'var(--r) var(--r) 0 0', border:'none', borderBottom: expSubTab===st?'2px solid var(--blue)':'2px solid transparent', background:'transparent', color: expSubTab===st?'var(--blue)':'var(--t2)', fontWeight: expSubTab===st?600:400, cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' },
          }, EXP_LABELS[st] || st)),
        ),
        // Bases -- bloque BasesPreparacion sin cambios, antes vivía en su
        // propio tab principal ('bases'), ahora reubicado como sub-pestaña.
        expSubTab==='bases' && h(BasesPreparacion, { project, config, onUpdate:updProject, user, logFn }),
        // Documentos -- OC generadas + DocsTab, sin cambios.
        expSubTab==='documentos' && h('div', null,
      // Órdenes de Compra generadas
      (project.ordenesCompra||[]).length > 0 && (() => {
        const esJefeDetalle = getPermissions(user).isAdmin;
        // Fase 3D-B1.1 -- ambos "mundos" reconocidos: legacy
        // (project.firmas[], sin tocar, sigue funcionando exactamente
        // igual para firmas viejas) + nuevo (inbox_items tipo
        // firma_documento con data.source==='orden_compra', creados desde
        // Fase 3D-B1). Match por data.ocId si existe; si faltara (no
        // debería, pero por si acaso), fallback a data.documentoFolio===
        // oc.folio -- nunca se inventan nombres de status: los valores
        // reales de INBOX_ESTATUS son pendiente/en_revision/
        // cambios_solicitados/aprobado/rechazado/revisado/cerrado.
        // Fase 3I-1 -- inboxFirmaDeOC/ocAprobada/enFlujo ya NO se declaran
        // aquí: viven en el nivel superior de ProjectDetail (misma lógica,
        // movida sin cambios) y llegan por clausura, para que las cards de
        // resumen del Centro de Control y esta pestaña compartan una sola
        // fuente de verdad.
        const reimprimir = oc => {
          // Los empleados solo pueden imprimir OC ya aprobadas por el jefe
          if (!esJefeDetalle && !ocAprobada(oc)) {
            alert('⛔ Esta orden de compra aún no ha sido aprobada por Santiago.\n\nDale "✍ A aprobación" para enviarla. Podrás imprimirla cuando él la apruebe.');
            return;
          }
          const cot2=project.cotizacion||{};
          const parts=(oc.partidas||[]).map(op=>{
            const orig=(cot2.partidas||[]).find(p=>p.id===op.id)||{};
            return {...orig,...op, costoMSMS:op.precioUnit||orig.costoMSMS||0};
          });
          printOrdenCompra({ project:{...project,ocProveedor:{name:oc.proveedor,rfc:oc.proveedorRfc,address:oc.proveedorAddress},cotizacion:{...cot2,agenciaProveedor:oc.proveedor}}, partidas:parts, condiciones:oc.condiciones||[], folio:oc.folio, companyObj:company });
        };
        const eliminar = oc => { if(confirm('¿Eliminar OC '+oc.folio+'?')) updProject({...project,ordenesCompra:(project.ordenesCompra||[]).filter(o=>o.id!==oc.id)}); };
        const equipo = usuariosActivosDetalle;
        const enviarAprobacion = async (oc) => {
          // Fase mini Firmas/OC: una Orden de Compra siempre contiene
          // costos internos -- el firmante SIEMPRE debe ser admin. Se
          // reutiliza el permiso que ya existe (verCostosInternos), no se crea uno
          // nuevo. Se elimina la captura manual para esta acción
          // específica -- antes permitía escribir cualquier correo sin
          // validar rol.
          const soloAdmins = equipo.filter(u => getPermissions({ role: u.role }).verCostosInternos);
          if (soloAdmins.length === 0) {
            alert('No hay ningún admin activo disponible para firmar esta Orden de Compra. Contacta a soporte.');
            return;
          }
          let respNombre = '', respEmail = '';
          if (soloAdmins.length === 1) {
            respNombre = soloAdmins[0].name; respEmail = soloAdmins[0].email;
          } else {
            const opciones = soloAdmins.map((e,i)=>`${i+1}. ${e.name} (${e.email})`).join('\n');
            const sel = prompt('¿Quién firmará esta Orden de Compra? (solo admins, contiene costos internos)\n\n'+opciones);
            if (sel===null) return;
            const idx = parseInt(sel,10)-1;
            if (!soloAdmins[idx]) { alert('Opción no válida.'); return; }
            respNombre = soloAdmins[idx].name; respEmail = soloAdmins[idx].email;
          }
          // Fase 3D-B1 -- ya NO se crea una entrada en project.firmas[]
          // (legacy, project.firmas[] queda intacto para las firmas
          // existentes). Se crea un inbox_item tipo firma_documento en su
          // lugar -- corte limpio, nunca ambos a la vez. Nombres de campo
          // de `data` exactamente los que ya acepta api/inbox-create.js
          // desde Fase 3D-A, sin tocar ese endpoint.
          // Nota: el correo legacy avisarAprobacion() (a
          // santiago@brokingroup.com) se dejó de llamar a propósito --
          // "no correo de firma todavía" era instrucción explícita de esta
          // fase. Reportado en la entrega, no se decidió en silencio.
          try {
            await createInboxItem({
              type: 'firma_documento',
              title: 'Firma de OC ' + (oc.folio || ''),
              message: 'Se requiere firma de la Orden de Compra ' + (oc.folio||'') + ' (proveedor: ' + (oc.proveedor||'—') + ').',
              project_id: project.id,
              assigned_to: respEmail,
              data: {
                documentoTipo: 'orden_compra',
                documentoFolio: oc.folio || '',
                folioProyecto: project.folioProyecto || '',
                firmante: respNombre,
                firmanteEmail: respEmail,
                firmaStatus: 'pendiente_firma',
                accionSolicitada: 'firmar',
                source: 'orden_compra',
                ocId: oc.id,
              },
            });
            // Fase 3D-B3 -- correo al firmante, disparado desde el
            // CLIENTE tras la creación exitosa del inbox_item (sin tocar
            // api/inbox-update.js ni api/inbox-create.js). Si el correo
            // falla, la solicitud YA quedó creada en Inbox -- se avisa
            // aparte, sin revertir nada.
            try {
              await avisarFirmaRequeridaInbox({
                documentoFolio: oc.folio || '', folioProyecto: project.folioProyecto || '', proyectoNombre: project.name,
                firmanteEmail: respEmail, firmanteNombre: respNombre,
              });
            } catch(eCorreo) { console.error('[3D-B3] Firma creada en Inbox, pero el correo al firmante no se pudo enviar:', eCorreo); }
            alert('✅ Firma de OC ' + (oc.folio||'') + ' enviada al Centro de aprobaciones. ' + respNombre + ' debe firmarla.');
          } catch(e) { alert('No se pudo enviar la solicitud de firma: ' + e.message); }
        };
        const ocsList = [...(project.ordenesCompra||[])].reverse();
        // Fase 3H -- descripción que reconoce los 3 tipos de partida
        // (antes solo mostraba `vehiculo`, quedando vacío para equipo/
        // servicios, que guardan su descripción en `marca`).
        const vehTxt = oc => (oc.partidas||[]).map(p=>`${p.vehiculo || p.marca || p.id} ×${p.cantidad}`).join(' | ');
        // Total de la OC -- solo admin (precioUnit es costo interno, mismo
        // criterio que sanitizeOrdenCompraForRole ya aplica).
        const totalOC = oc => (oc.partidas||[]).reduce((s,p)=>s+(Number(p.precioUnit)||0)*(Number(p.cantidad)||0),0);
        // Estatus de firma legible, derivado de las MISMAS funciones ya
        // existentes (ocAprobada/enFlujo) -- no inventa ningún estado nuevo.
        // Fase 3I-2 -- el antiguo `estatusFirma` se eliminó: lo reemplazan
        // las 3 dimensiones del modelo nuevo (estadoOperativoOC /
        // estadoFirmaOC / estadoExpedienteOC), que viven en el nivel
        // superior de ProjectDetail y llegan por clausura.
        return h('div', { className:'card', style:{ marginBottom:14 } },
          // Fase 3I-1 -- Mesa de ejecución: encabezado con el resumen
          // operativo (mismos contadores derivados del Centro de Control,
          // por clausura -- una sola fuente de verdad, sin recalcular).
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:8, marginBottom:4 } },
            h('div', { style:{ fontSize:13, fontWeight:600 } }, '🛒 Órdenes de Compra'),
            ocsList.length>0 && h('div', { style:{ fontSize:11.5, color:'var(--t2)' } },
              ocsList.length, ocsList.length===1?' orden':' órdenes',
              esJefeDetalle ? ' · '+fmt(ccTotalOCs) : '',
            ),
          ),
          ocsList.length>0 && h('div', { style:{ fontSize:11.5, color:'var(--t2)', marginBottom:12 } },
            [ccOCsFirmadas.length?ccOCsFirmadas.length+' firmada(s)':null,
             ccOCsEnFirma.length?ccOCsEnFirma.length+' esperando firma':null,
             ccOCsExpediente.length?ccOCsExpediente.length+' en expediente':null,
             ccOCsSinEnviar.length?ccOCsSinEnviar.length+' sin cerrar':null,
             ccOCsCanceladas.length?ccOCsCanceladas.length+' cancelada(s)':null].filter(Boolean).join(' · ')
          ),
          // Fase 3I-1 -- estado vacío útil (antes la tabla simplemente
          // quedaba sin filas, sin explicar qué hacer).
          ocsList.length === 0 && h('div', { className:'empty', style:{ padding:'32px 20px' } },
            h('h3', null, 'Sin órdenes de compra'),
            h('p', null, 'Aún no hay órdenes de compra para este proyecto. Crea una OC cuando tengas definido qué vas a comprar o contratar.'),
          ),
          // Tabla (desktop)
          ocsList.length > 0 && h('div', { className:'tbl-scroll hide-mobile', style:{ overflowX:'auto' } },
            h('table', { style:{ fontSize:12, width:'100%', borderCollapse:'collapse', minWidth:560 } },
              h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b2)' } },
                ['Folio','Fecha','Proveedor','Partidas','Total','Estado','Firma','Expediente','Acciones'].map(h2=>h('th',{key:h2,style:{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:500,color:'var(--t2)',letterSpacing:'.4px',whiteSpace:'nowrap'}},h2))
              )),
              h('tbody', null, ocsList.map(oc=>
                h('tr', { key:oc.id, style:{ borderBottom:'.5px solid var(--b3)' } },
                  h('td', { style:{ padding:'9px 8px', fontWeight:500, color:'var(--blue)', fontFamily:'monospace', fontSize:11, whiteSpace:'nowrap' } }, oc.folio),
                  h('td', { style:{ padding:'9px 8px', color:'var(--t2)', fontSize:11, whiteSpace:'nowrap' } }, oc.fecha),
                  h('td', { style:{ padding:'9px 8px' } }, oc.proveedor||'—'),
                  h('td', { style:{ padding:'9px 8px', fontSize:11, color:'var(--t2)' } }, vehTxt(oc)),
                  h('td', { style:{ padding:'9px 8px', fontSize:11, whiteSpace:'nowrap', textAlign:'right' } }, esJefeDetalle ? fmt(totalOC(oc)) : '—'),
                  // Fase 3I-2 -- 3 dimensiones separadas: estado operativo,
                  // firma y expediente.
                  h('td', { style:{ padding:'9px 8px', fontSize:11, whiteSpace:'nowrap' } }, ESTADO_OP_LABEL[estadoOperativoOC(oc)]||estadoOperativoOC(oc)),
                  h('td', { style:{ padding:'9px 8px', fontSize:11, whiteSpace:'nowrap', color: estadoFirmaOC(oc)==='No requerida'?'var(--t3)':'var(--t1)' } }, estadoFirmaOC(oc)),
                  h('td', { style:{ padding:'9px 8px', fontSize:11, whiteSpace:'nowrap', color: estadoExpedienteOC(oc)==='En expediente'?'var(--green)':'var(--t2)' } }, estadoExpedienteOC(oc)),
                  h('td', { style:{ padding:'9px 8px', whiteSpace:'nowrap' } },
                    h('button', { style:{ fontSize:11, color:'var(--blue)', padding:'3px 8px' }, onClick:()=>reimprimir(oc) }, '📄 Reimprimir'),
                    // "Enviar a firma" SOLO si la OC realmente la requiere.
                    ocRequiereFirma(oc) && (()=>{ const fl=enFlujo(oc); return h('button', { style:{ fontSize:11, color:fl?'var(--t3)':'var(--green)', padding:'3px 8px', marginLeft:4 }, onClick:()=>enviarAprobacion(oc) }, fl?'⏳ En flujo':'✍ A aprobación'); })(),
                    // Acciones de estado -- ADMIN-ONLY (empleado no puede
                    // escribir en project.ordenesCompra[], confirmado).
                    esJefeDetalle && estadoOperativoOC(oc)!=='cancelada' && estadoOperativoOC(oc)!=='firmada' && h('button', { style:{ fontSize:11, padding:'3px 8px', marginLeft:4 }, onClick:()=>setEstadoOC(oc,'enviada_proveedor') }, '→ Enviada'),
                    esJefeDetalle && estadoExpedienteOC(oc)!=='En expediente' && estadoOperativoOC(oc)!=='cancelada' && h('button', { style:{ fontSize:11, padding:'3px 8px', marginLeft:4 }, onClick:()=>setEstadoOC(oc,'archivada_expediente') }, '📁 En expediente'),
                    h('button', { style:{ fontSize:11, color:'var(--red)', padding:'3px 8px', marginLeft:4 }, onClick:()=>eliminar(oc) }, 'Eliminar'),
                  ),
                )
              )),
            )
          ),
          // Tarjetas (móvil)
          ocsList.length > 0 && h('div', { className:'show-mobile', style:{ display:'none' } },
            ocsList.map(oc => h('div', { key:oc.id, className:'oc-card' },
              h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 } },
                h('span', { style:{ fontWeight:600, color:'var(--blue)', fontFamily:'monospace', fontSize:13 } }, oc.folio),
                h('span', { style:{ fontSize:11, color:'var(--t3)', flexShrink:0 } }, oc.fecha),
              ),
              h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:6 } }, oc.proveedor||'—'),
              // Fase 3I-2b -- los 3 estados en líneas separadas (antes iban
              // concatenados en un renglón que se cortaba en móvil).
              h('div', { style:{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 8px', fontSize:11.5, marginBottom:8 } },
                h('span', { style:{ color:'var(--t3)' } }, 'Estado:'),
                h('span', null, ESTADO_OP_LABEL[estadoOperativoOC(oc)]||estadoOperativoOC(oc)),
                h('span', { style:{ color:'var(--t3)' } }, 'Firma:'),
                h('span', { style:{ color: estadoFirmaOC(oc)==='No requerida'?'var(--t3)':'var(--t1)' } }, estadoFirmaOC(oc)),
                h('span', { style:{ color:'var(--t3)' } }, 'Expediente:'),
                h('span', { style:{ color: estadoExpedienteOC(oc)==='En expediente'?'var(--green)':'var(--t2)' } }, estadoExpedienteOC(oc)),
                esJefeDetalle && h('span', { style:{ color:'var(--t3)' } }, 'Total:'),
                esJefeDetalle && h('span', { style:{ fontWeight:600 } }, fmt(totalOC(oc))),
              ),
              vehTxt(oc) && h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:10, lineHeight:1.5 } }, vehTxt(oc)),
              // Fase 3I-2b -- acciones en fila táctil (.acciones-row las
              // reparte con aire y a ancho completo en pantallas chicas).
              // CORRECCIÓN: "✍ A aprobación" ahora solo aparece si la OC
              // realmente requiere firma -- antes se mostraba SIEMPRE aquí,
              // inconsistente con la tabla desktop de la Fase 3I-2.
              h('div', { className:'acciones-row', style:{ display:'flex', gap:8, flexWrap:'wrap' } },
                h('button', { style:{ fontSize:12, color:'var(--blue)' }, onClick:()=>reimprimir(oc) }, '📄 PDF'),
                ocRequiereFirma(oc) && (()=>{ const fl=enFlujo(oc); return h('button', { style:{ fontSize:12, color:fl?'var(--t3)':'var(--green)' }, onClick:()=>enviarAprobacion(oc) }, fl?'⏳ En flujo':'✍ A firma'); })(),
                esJefeDetalle && estadoOperativoOC(oc)!=='cancelada' && estadoOperativoOC(oc)!=='firmada' && h('button', { style:{ fontSize:12 }, onClick:()=>setEstadoOC(oc,'enviada_proveedor') }, '→ Enviada'),
                esJefeDetalle && estadoExpedienteOC(oc)!=='En expediente' && estadoOperativoOC(oc)!=='cancelada' && h('button', { style:{ fontSize:12 }, onClick:()=>setEstadoOC(oc,'archivada_expediente') }, '📁 Expediente'),
                h('button', { style:{ fontSize:12, color:'var(--red)' }, onClick:()=>eliminar(oc) }, 'Eliminar'),
              ),
            )),
          ),
        );
      })(),
      h(DocsTab, { project, vehicles:pVehicles, companies, config, onSaveCompany, onUpdate:updProject, user, logFn }),
        ),
        // Preguntas -- bloque sin cambios, antes vivía en su propio tab
        // principal ('preguntas'), ahora reubicado como sub-pestaña.
        // project.preguntas[] sigue viviendo exactamente donde ya vivía.
        expSubTab==='preguntas' && h('div', null,
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
      );
    })(),
    // Modal Orden de Compra
    showOC && h(OCModal, { project, companies, config, onSaveConfig, onSaveCompany, onUpdate:updProject, onClose:()=>setShowOC(false), user }),
    // Fase 3I-1b -- aviso de "Exportar expediente". Siempre ofrece una
    // acción real (ir a Expediente) -- nunca es un botón muerto. La
    // exportación real (ZIP/paquete bancario/separación documental) NO se
    // implementa aquí, es una fase aparte.
    showExportarExp && h('div', { style:{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }, onClick:()=>setShowExportarExp(false) },
      h('div', { className:'card', style:{ maxWidth:440, width:'100%' }, onClick:e=>e.stopPropagation() },
        h('div', { style:{ fontSize:16, fontWeight:600, marginBottom:8 } }, 'Exportar expediente'),
        h('div', { style:{ fontSize:13, color:'var(--t2)', lineHeight:1.6, marginBottom:8 } },
          'Esta función preparará un expediente descargable del proyecto. Por ahora puedes revisar y organizar los documentos en la pestaña Expediente.'),
        h('div', { style:{ fontSize:12, color:'var(--t3)', marginBottom:18 } },
          ccNumDocs === 0
            ? 'Este proyecto todavía no tiene documentos cargados.'
            : ccNumDocs + (ccNumDocs===1 ? ' documento cargado en el expediente.' : ' documentos cargados en el expediente.')),
        h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end' } },
          h('button', { onClick:()=>setShowExportarExp(false) }, 'Cerrar'),
          h('button', { className:'bp', onClick:()=>{ setShowExportarExp(false); setTab('docs'); } }, 'Ir a Expediente'),
        ),
      ),
    ),
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
      var r=await fetch('/api/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'LICITAPRO <santiago@brokingroup.com>',to:dest,subject:'Borrador de proyecto — '+(project.name||''),html:html})});
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
// Fase 3E-0 — OC de equipo/productos (no solo vehículos).
// IVA: mismo valor que src/views/Cotizacion.js (0.16) -- no se importa de
// ahí porque esa constante no está exportada; se duplica el valor, no la
// lógica (mismo criterio ya usado en otras partes del sistema).
const IVA_OC = 0.16;

// Convierte cot.equipo[] (shape real: {id, productoId, nombre, marca,
// modelo, cat, usar, costoConIVA, llevaIVA, cnts:[cantidad por partida
// vehicular]}) en partidas COMPATIBLES con buildOrdenCompraHTML
// (pdf_export.js) SIN TOCAR ESE ARCHIVO -- reutiliza exactamente los
// mismos campos que ya lee para vehículos (tipo, marca/modelo/version/ano,
// cantidad, costoMSMS), poniendo la descripción completa del equipo en
// `marca` (los demás campos de "vehículo" quedan vacíos a propósito, el
// join() de pdf_export.js ya filtra los vacíos). costoConIVA se usa
// DIRECTO como costoMSMS -- confirmado en Cotizacion.js que costoConIVA
// siempre representa el precio "con IVA o equivalente" que ya usa el
// mismo cálculo de eqCIVA ahí, sin importar llevaIVA.
function partidasDeEquipoParaOC(cot, cfg) {
  const catalogo = {};
  CATALOG_PRODUCTS.forEach(p => { catalogo[p.id] = p; });
  ((cfg && cfg.customProducts) || []).forEach(p => { catalogo[p.id] = p; });
  return (cot.equipo || [])
    .filter(e => e.usar)
    .map(e => {
      // Fase 3F-1 -- si la suma de cnts[] es 0 (caso "sin vehículos" o
      // simplemente equipo que no está instalado por vehículo), se usa
      // cantidadGlobal como fallback -- mismo criterio ya usado en
      // calc.js/Cotizacion.js. Si AMBOS existen (caso raro, legacy mixto),
      // se prioriza cnts[] tal cual ya se hacía, sin ningún cambio para
      // proyectos de vehículos existentes.
      const cantidadCnts = (e.cnts || []).reduce((s, c) => s + (c || 0), 0);
      const cantidadTotal = cantidadCnts > 0 ? cantidadCnts : Number(e.cantidadGlobal || 0);
      if (cantidadTotal <= 0) return null;
      const prod = catalogo[e.productoId];
      const descripcion = [e.nombre, e.marca, e.modelo].filter(Boolean).join(' — ') || 'Equipo sin nombre';
      // Fase 3E-0.1 -- misma prioridad ya usada en Catalog.js/pdf_export.js:
      // foto propia del producto (customProducts[].photo, base64) primero,
      // luego CATALOG_IMAGES[id] (base64 estático del catálogo base). Si
      // ninguna existe, imageUrl queda '' -- no rompe productos sin foto.
      const imageUrl = (prod && prod.photo) || CATALOG_IMAGES[e.productoId] || '';
      return {
        id: e.id,
        tipo: 'Equipo',
        marca: descripcion, modelo: '', version: '', ano: '', color: '',
        cantidad: cantidadTotal,
        costoMSMS: e.costoConIVA || 0,
        productoId: e.productoId,
        proveedor: (prod && prod.prov) || '',
        origen: 'cotizacion_equipo',
        imageUrl,
      };
    })
    .filter(Boolean);
}

// Fase 3G -- servicios formales (instalación/mantenimiento/config/
// capacitación/etc.) como partida de OC. Mismo patrón exacto que
// partidasDeEquipoParaOC, pero: (a) sin imageUrl obligatoria (los
// servicios no tienen foto de producto), (b) costoMSMS se toma de
// costoUnitario (costo real a pagar al proveedor de ese servicio, mismo
// significado que costoConIVA de equipo).
function partidasDeServiciosParaOC(cot) {
  return (cot.servicios || [])
    .filter(s => s.usar && Number(s.cantidad || 0) > 0)
    .map(s => ({
      id: s.id,
      tipo: 'Servicio',
      marca: [s.nombre, s.descripcion].filter(Boolean).join(' — ') || 'Servicio sin nombre',
      modelo: '', version: '', ano: '', color: '',
      cantidad: Number(s.cantidad || 0),
      costoMSMS: s.costoUnitario || 0,
      proveedor: s.proveedor || '',
      origen: 'servicio_manual',
      imageUrl: '', // los servicios no tienen foto de producto -- nunca obligatoria
    }));
}

function OCModal({ project, companies, config, onSaveConfig, onSaveCompany, onUpdate, onClose, user }) {
  const cot = project.cotizacion || {};
  // Fase 3H -- mismo criterio ya usado en generar() (getPermissions(user)
  // .isAdmin): el precio unitario es costoMSMS, dato de costo interno, y
  // solo admin puede verlo/editarlo en el modal. Empleado edita cantidad
  // y descripción (operativo), nunca precio.
  const esAdmin = getPermissions(user).isAdmin;
  const partidas = (cot.partidas || []).filter(p => p.activo && (p.cantidad||0) > 0);

  // Config global (Supabase) — compartida entre proyectos y dispositivos
  const cfg = config || window._lpConfig || {};
  const ocCfg = cfg.ocSettings || {};

  // PROVEEDORES (a quienes compramos / mandamos OC) — lista propia, distinta de las empresas licitantes
  const proveedores = cfg.proveedores || [];

  // Proveedor: puede venir de uno guardado o escrito a mano
  const provGuardado = project.ocProveedor || {};
  const [prov, setProv] = useState({
    name: provGuardado.name || cot.agenciaProveedor || '',
    rfc:  provGuardado.rfc  || '',
    address: provGuardado.address || '',
  });
  const setProvField = (k,v) => setProv(p=>({...p,[k]:v}));

  // Seleccionar proveedor guardado → llena los datos
  const selectEmpresa = id => {
    const e = proveedores.find(x=>x.id===id);
    if (e) setProv({ name:e.name||'', rfc:e.rfc||'', address:e.address||'' });
  };

  // Guardar/actualizar proveedor en config global
  const persistProveedor = async (p) => {
    if (!p.name && !p.rfc) return;
    if (!onSaveConfig) return;
    const existe = proveedores.find(x => (p.rfc && x.rfc===p.rfc) || (!p.rfc && x.name===p.name));
    let nuevos;
    if (existe) nuevos = proveedores.map(x => x===existe ? {...x, ...p} : x);
    else nuevos = [...proveedores, { id:'prov-'+Date.now(), ...p }];
    const newCfg = { ...cfg, proveedores: nuevos };
    window._lpConfig = newCfg;
    await onSaveConfig(newCfg);
  };

  // Analizar Constancia de Situación Fiscal
  const [analizando, setAnalizando] = useState(false);
  const [analMsg, setAnalMsg] = useState('');
  const analizarConstancia = async (file) => {
    if (!file) return;
    setAnalizando(true); setAnalMsg('Analizando constancia…');
    try {
      const { analyzeDocument } = await import('../lib/ai_analyzer.js');
      const data = await analyzeDocument(file, 'constancia');
      const nuevo = {
        name: data.razonSocial || prov.name,
        rfc:  data.rfc || prov.rfc,
        address: [data.domicilioFiscal, data.codigoPostal, data.ciudad, data.estado].filter(Boolean).join(', ') || prov.address,
      };
      setProv(nuevo);
      // Guardar como PROVEEDOR (si no existe ese RFC) para tenerlo en el desplegable
      if (nuevo.rfc || nuevo.name) {
        const yaExiste = proveedores.find(e=>(nuevo.rfc && e.rfc===nuevo.rfc) || (!nuevo.rfc && e.name===nuevo.name));
        await persistProveedor(nuevo);
        setAnalMsg(yaExiste ? '✓ Datos extraídos (proveedor ya estaba guardado)' : '✓ Datos extraídos y proveedor guardado');
      } else {
        setAnalMsg('✓ Datos extraídos');
      }
    } catch(e) {
      setAnalMsg('❌ '+(e.message||'Error al analizar'));
    }
    setAnalizando(false);
    setTimeout(()=>setAnalMsg(''), 5000);
  };

  // Selección de partidas
  const [selParts, setSelParts] = useState(partidas.map(p => p.id));
  const togglePart = id => setSelParts(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  // Fase 3H -- OC dentro de proyecto v2. La fuente deja de ser EXCLUYENTE
  // (antes: o vehículos, o equipo, o servicios) y pasa a ser una pestaña
  // de NAVEGACIÓN sobre un único carrito acumulativo: se puede seleccionar
  // de las 3 fuentes y crear UNA SOLA OC mixta. `fuenteOC` ahora solo
  // controla qué lista se está viendo, nunca qué se incluye en la OC --
  // eso lo determina exclusivamente lo seleccionado en cada lista.
  const [fuenteOC, setFuenteOC] = useState('vehiculos');
  // Fase 3I-2 -- ¿esta OC requiere firma? Default true = comportamiento
  // histórico (hasta ahora toda OC se trataba como si fuera a firma).
  const [requiereFirma, setRequiereFirma] = useState(true);
  const equipoPartidas = partidasDeEquipoParaOC(cot, cfg);
  const [selEquipo, setSelEquipo] = useState([]);
  const toggleEquipo = id => setSelEquipo(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  const serviciosPartidas = partidasDeServiciosParaOC(cot);
  const [selServicios, setSelServicios] = useState([]);
  const toggleServicio = id => setSelServicios(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  // Fase 3H -- overrides editables ANTES de crear la OC. Nunca mutan la
  // cotización original: son un mapa {idPartida: {cantidad?, costoMSMS?,
  // marca?, proveedor?}} que se aplica encima al construir partidasSel.
  // Si un campo no está en el override, se usa el valor original tal cual.
  const [overrides, setOverrides] = useState({});
  const setOverride = (id, campo, valor) => setOverrides(o => ({ ...o, [id]: { ...(o[id]||{}), [campo]: valor } }));
  const aplicarOverride = p => {
    const ov = overrides[p.id];
    if (!ov) return p;
    return {
      ...p,
      cantidad: ov.cantidad !== undefined ? ov.cantidad : p.cantidad,
      costoMSMS: ov.costoMSMS !== undefined ? ov.costoMSMS : p.costoMSMS,
      marca: ov.marca !== undefined ? ov.marca : p.marca,
      proveedor: ov.proveedor !== undefined ? ov.proveedor : p.proveedor,
    };
  };

  // Carrito unificado -- lo que REALMENTE va a la OC, de las 3 fuentes a
  // la vez (mixta). Es la única fuente de verdad para generar() y para el
  // resumen de subtotal.
  const partidasSeleccionadas = [
    ...partidas.filter(p => selParts.includes(p.id)),
    ...equipoPartidas.filter(p => selEquipo.includes(p.id)),
    ...serviciosPartidas.filter(p => selServicios.includes(p.id)),
  ].map(aplicarOverride);
  const subtotalOC = partidasSeleccionadas.reduce((s,p) => s + (Number(p.costoMSMS)||0) * (Number(p.cantidad)||0), 0);

  // Direcciones guardadas en config global (+ migración desde localStorage viejo)
  const loadLegacyAddrs = () => { try { return JSON.parse(localStorage.getItem('lp_oc_addresses')||'[]'); } catch{ return []; } };
  const legacyAddrs = loadLegacyAddrs();
  const cfgAddrs = ocCfg.direcciones || [];
  // Une las de Supabase con las viejas de este dispositivo (sin duplicar)
  const mergedAddrs = [...cfgAddrs, ...legacyAddrs.filter(a=>!cfgAddrs.includes(a))].slice(0,15);
  const [addresses, setAddresses] = useState(mergedAddrs);
  const [newAddr, setNewAddr] = useState('');
  const [showAddrInput, setShowAddrInput] = useState(false);

  // Si había direcciones viejas que no estaban en config, súbelas a Supabase una vez
  useEffect(() => {
    if (legacyAddrs.length && legacyAddrs.some(a=>!cfgAddrs.includes(a)) && onSaveConfig) {
      const newOc = { ...ocCfg, direcciones: mergedAddrs };
      const newCfg = { ...cfg, ocSettings: newOc };
      window._lpConfig = newCfg;
      onSaveConfig(newCfg).catch(e=>console.warn('Error migrando direcciones:',e));
    }
  }, []);

  const persistOcCfg = async (partial) => {
    const newOc = { ...ocCfg, ...partial };
    const newCfg = { ...cfg, ocSettings: newOc };
    window._lpConfig = newCfg;
    if (onSaveConfig) { try { await onSaveConfig(newCfg); } catch(e){ console.warn('Error guardando config OC:', e); } }
  };

  const saveAddr = async () => {
    const v = newAddr.trim(); if(!v) return;
    const updated = [v, ...addresses.filter(a=>a!==v)].slice(0,15);
    setAddresses(updated);
    updCond('lugar', v);
    setNewAddr(''); setShowAddrInput(false);
    await persistOcCfg({ direcciones: updated });
  };
  const deleteAddr = async addr => {
    const updated = addresses.filter(a=>a!==addr);
    setAddresses(updated);
    await persistOcCfg({ direcciones: updated });
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
  // Prioridad: condiciones ya guardadas en este proyecto > defaults globales (config) > defaults del sistema
  const condsBase = project.ocCondiciones || ocCfg.condicionesDefault || DEFAULT_CONDS;
  const [conds, setConds] = useState(condsBase);
  const updCond = (id, val) => setConds(cs => cs.map(c => c.id===id ? {...c, value:val} : c));
  const lugarVal = conds.find(c=>c.id==='lugar')?.value || '';
  const [savedMsg, setSavedMsg] = useState('');

  const guardarPredeterminado = async () => {
    // Guarda las condiciones actuales (sin el lugar específico) como default global
    const defaults = conds.map(c => c.id==='lugar' ? {...c, value:''} : c);
    await persistOcCfg({ condicionesDefault: defaults });
    setSavedMsg('✓ Guardado como predeterminado para todos los proyectos');
    setTimeout(()=>setSavedMsg(''), 3000);
  };

  const generar = () => {
    // Fase 3E-0 -- partidasSel viene de la fuente elegida (vehículos,
    // comportamiento ORIGINAL sin cambio; o equipo, nuevo). El resto de
    // generar() no distingue entre las 3 fuentes -- partidasDeEquipoParaOC()/
    // partidasDeServiciosParaOC() ya devuelven partidas con el MISMO shape
    // (tipo/marca/modelo/version/ano/cantidad/costoMSMS) que las de
    // vehículo, compatibles con buildOrdenCompraHTML sin ningún cambio ahí.
    // Fase 3H -- partidasSel viene del carrito unificado (las 3 fuentes a
    // la vez, con overrides ya aplicados) en vez de la fuente excluyente
    // que estaba activa. Esto es lo que habilita la OC MIXTA.
    const partidasSel = partidasSeleccionadas;
    if (!partidasSel.length) { alert('Selecciona al menos una partida (vehículos, equipo o servicios).'); return; }
    // Fase 3C-2 -- si el proyecto tiene folioProyecto (folios maestros,
    // Fase 3C-1), la OC usa el esquema derivado {folioProyecto}-OC-0N,
    // consecutivo real contando las OC ya existentes de ESTE proyecto que
    // ya sigan ese mismo prefijo. Si el proyecto NO tiene folioProyecto
    // (legacy), se mantiene el comportamiento anterior tal cual, sin
    // romper nada -- nunca se sobreescribe un folio ya asignado a una OC
    // existente, esto solo aplica a una OC NUEVA.
    let folio;
    if (project.folioProyecto) {
      const prefijoOC = project.folioProyecto + '-OC-';
      let maxIdx = 0;
      (project.ordenesCompra || []).forEach(o => {
        if (o.folio && typeof o.folio === 'string' && o.folio.startsWith(prefijoOC)) {
          const num = parseInt(o.folio.slice(prefijoOC.length), 10);
          if (!isNaN(num) && num > maxIdx) maxIdx = num;
        }
      });
      folio = generarFolioOC(project.folioProyecto, maxIdx + 1);
    } else {
      folio = 'OC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5);
    }
    const proyConProv = { ...project, ocProveedor: prov, cotizacion:{ ...cot, agenciaProveedor:prov.name } };
    // Guardar OC en el expediente del proyecto
    const nuevaOC = {
      id: folio,
      folio,
      fecha: new Date().toISOString().slice(0,10),
      // Fase 3I-2 -- estado documental/operativo de la OC. Se guardan
      // explícitamente al crear para que no haya ambigüedad; las OC
      // legacy sin estos campos siguen funcionando por derivación.
      requiereFirma,
      estadoOperativo: 'emitida',
      proveedor: prov.name,
      proveedorRfc: prov.rfc,
      proveedorAddress: prov.address,
      partidas: partidasSel.map(p => {
        const base = { id:p.id, vehiculo:[p.marca,p.modelo,p.version].filter(Boolean).join(' '), tipo:p.tipo, cantidad:p.cantidad, precioUnit:p.costoMSMS||0 };
        // Fase 3E-0 -- para vehículo, `base` se queda TAL CUAL como
        // siempre (ninguna clave nueva) -- la reimpresión sigue
        // encontrando `orig` en cot2.partidas por el mismo id, de ahí saca
        // marca/modelo/version/ano/color sin cambio. IMPORTANTE: no se
        // agrega `marca:undefined` aquí -- el spread {...orig,...op} en
        // reimprimir() SÍ sobreescribiría orig.marca con undefined si la
        // clave existiera aunque su valor fuera undefined (comportamiento
        // real de JS, no es lo mismo omitir una clave que ponerla en
        // undefined). Para EQUIPO sí se agrega `marca` real, porque su id
        // nunca hace match en cot2.partidas (son ids de equipo, no de
        // vehículo) -- sin esto, la reimpresión no tendría de dónde sacar
        // la descripción a mostrar.
        // Fase 3G -- la condición se amplió de 'p.origen===cotizacion_equipo'
        // a 'p.origen' (cualquier valor truthy) para cubrir también
        // 'servicio_manual' con el mismo criterio exacto: su id tampoco
        // hace match en cot2.partidas (son ids de servicio, no de
        // vehículo), así que necesita los mismos campos guardados
        // explícitamente para que la reimpresión funcione.
        if (p.origen) {
          return { ...base, marca:p.marca, productoId:p.productoId, proveedor:p.proveedor, origen:p.origen, imageUrl:p.imageUrl||'' };
        }
        return base;
      }),
      condiciones: conds,
    };
    const ocs = [...(project.ordenesCompra||[]).filter(o=>o.id!==folio), nuevaOC];
    onUpdate({ ...project, ocProveedor: prov, ordenesCompra: ocs, ocCondiciones: conds });
    const esJefe = getPermissions(user).isAdmin;
    if (esJefe) {
      // El jefe puede imprimir directo
      printOrdenCompra({ project: proyConProv, partidas: partidasSel, condiciones: conds, folio, companyObj: companies.find(c=>c.name===project.company) });
    } else {
      // Empleado: NO se imprime. Debe pasar por aprobación del jefe.
      alert('✅ Orden de compra creada.\n\nComo no eres administrador, esta OC NO se puede imprimir hasta que Santiago la apruebe. Ve a la lista de OC y dale "✍ A aprobación" para enviarla.');
    }
    onClose();
  };

  const inputStyle = { fontSize:12, padding:'6px 10px' };
  const secLabel = { fontSize:12, fontWeight:500, color:'var(--t2)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' };

  return h('div', { style:{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
    onClick: e => { if(e.target===e.currentTarget) onClose(); } },
    h('div', { className:'oc-modal', style:{ background:'var(--bg1)', borderRadius:'var(--rl)', width:'100%', maxWidth:640, maxHeight:'92vh', overflow:'auto', WebkitOverflowScrolling:'touch', padding:24, display:'flex', flexDirection:'column', gap:16 } },

      // Header
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center' } },
        h('div', { style:{ fontSize:15, fontWeight:600 } }, '🛒 Orden de Compra'),
        h('button', { onClick:onClose, style:{ background:'transparent', border:'none', fontSize:18, cursor:'pointer', color:'var(--t2)' } }, '✕'),
      ),

      // Proveedor (datos de la empresa que vende — Surman, etc.)
      h('div', null,
        h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, gap:8, flexWrap:'wrap' } },
          h('div', { style:{ ...secLabel, marginBottom:0 } }, 'Proveedor (vendedor)'),
          h('label', { style:{ fontSize:11, padding:'5px 12px', border:'.5px solid var(--blue)', color:'var(--blue)', borderRadius:'var(--r)', cursor: analizando?'wait':'pointer', background:'#3b6cf408' } },
            analizando ? '⏳ Analizando…' : '📄 Analizar constancia (CSF)',
            h('input', { type:'file', accept:'application/pdf,image/*', style:{ display:'none' }, disabled:analizando, onChange:e=>{ analizarConstancia(e.target.files[0]); e.target.value=''; } }),
          ),
        ),
        proveedores.length > 0 && h('select', {
          value:'', onChange:e=>{ if(e.target.value) selectEmpresa(e.target.value); },
          style:{ ...inputStyle, width:'100%', marginBottom:8, color:'var(--t2)' }
        },
          h('option', { value:'' }, '— Elegir proveedor guardado —'),
          proveedores.map(e=>h('option', { key:e.id, value:e.id }, e.name+(e.rfc?(' · '+e.rfc):''))),
        ),
        analMsg && h('div', { style:{ fontSize:11, color: analMsg[0]==='❌'?'#E24B4A':'#1D9E75', marginBottom:8 } }, analMsg),
        h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:8 } },
          h('div', null,
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Empresa / Razón social'),
            h('input', { value:prov.name, onChange:e=>setProvField('name',e.target.value), placeholder:'Ej: Grupo Surman', style:{ ...inputStyle, width:'100%' } }),
          ),
          h('div', null,
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'RFC'),
            h('input', { value:prov.rfc, onChange:e=>setProvField('rfc',e.target.value.toUpperCase()), placeholder:'Ej: SME050105T59', maxLength:13, style:{ ...inputStyle, width:'100%', textTransform:'uppercase' } }),
          ),
        ),
        h('div', { style:{ marginTop:8 } },
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Domicilio fiscal'),
          h('input', { value:prov.address, onChange:e=>setProvField('address',e.target.value), placeholder:'Calle, número, colonia, CP, ciudad', style:{ ...inputStyle, width:'100%' } }),
        ),
        // Guardar proveedor escrito a mano
        (prov.name || prov.rfc) && h('button', {
          onClick: async ()=>{ await persistProveedor(prov); setAnalMsg('✓ Proveedor guardado'); setTimeout(()=>setAnalMsg(''),3000); },
          style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', padding:'6px 0 0', cursor:'pointer' }
        }, '+ Guardar este proveedor para futuras OC'),
      ),

      // Fase 3H -- pestañas de navegación (no excluyentes): se puede
      // seleccionar de las 3 a la vez para una OC mixta. El contador
      // muestra cuántas partidas de cada fuente ya están en el carrito.
      h('div', null,
        h('div', { style:secLabel }, 'Partidas de la orden'),
        // Fase 3H-1 -- ayuda visual: explica que se pueden combinar
        // fuentes en una sola OC (el cambio de comportamiento más
        // importante de la Fase 3H, que no era evidente en la UI).
        h('div', { style:{ fontSize:11.5, color:'var(--t2)', lineHeight:1.5, marginBottom:10 } },
          'Selecciona una o varias partidas para armar la orden de compra. Puedes combinar vehículos, equipo y servicios en una misma OC.'),
        h('div', { style:{ display:'flex', gap:8, marginBottom:8 } },
          [['vehiculos','🚓 Vehículos',selParts.length],['equipo','📦 Equipo',selEquipo.length],['servicios','🛠️ Servicios',selServicios.length]].map(([id,label,n]) =>
            h('button', { key:id, onClick:()=>setFuenteOC(id), style:{ flex:1, padding:'8px 12px', fontSize:12, fontWeight:500, borderRadius:'var(--r)', border:'1px solid var(--b2)', cursor:'pointer', background:fuenteOC===id?'var(--blue)':'transparent', color:fuenteOC===id?'#fff':'var(--t1)' } },
              label, n>0 ? ' ('+n+')' : '')
          ),
        ),
        // Fase 3H-1 -- explicación corta debajo de las pestañas: aclara
        // que cambiar de pestaña NO pierde lo ya seleccionado.
        h('div', { style:{ fontSize:11, color:'var(--t3)', lineHeight:1.5, marginBottom:12 } },
          'Las partidas seleccionadas se acumulan en el resumen. Puedes ajustar cantidad, descripción, proveedor',
          esAdmin ? ' y precio' : '',
          ' antes de crear la OC.'),
      ),

      // Fase 3H -- fila editable reutilizable para las 3 fuentes.
      // Cantidad y descripción son editables para cualquier rol (operativo);
      // el PRECIO UNITARIO solo para admin -- es costoMSMS, dato de costo
      // interno, mismo criterio que sanitizeOrdenCompraForRole ya aplica
      // sobre precioUnit en las OC guardadas.
      (() => {
        const lista = fuenteOC==='vehiculos' ? partidas : fuenteOC==='equipo' ? equipoPartidas : serviciosPartidas;
        const sel   = fuenteOC==='vehiculos' ? selParts : fuenteOC==='equipo' ? selEquipo : selServicios;
        const toggle= fuenteOC==='vehiculos' ? togglePart : fuenteOC==='equipo' ? toggleEquipo : toggleServicio;
        const vacio = fuenteOC==='vehiculos' ? 'No hay partidas activas con vehículos en esta cotización.'
                    : fuenteOC==='equipo'    ? 'No hay equipo con cantidad asignada. Ve a la pestaña "Equipo" de Cotización.'
                    :                          'No hay servicios con cantidad asignada. Ve a la pestaña "Servicios" de Cotización.';
        if (lista.length === 0) return h('div', { style:{ fontSize:12, color:'var(--t3)', padding:'10px 0' } }, vacio);
        return h('div', null, lista.map(p => {
          const activo = sel.includes(p.id);
          const v = aplicarOverride(p);
          const desc = fuenteOC==='vehiculos' ? (p.id+' · '+([p.marca,p.modelo,p.version].filter(Boolean).join(' ')||'Vehículo sin definir')) : v.marca;
          return h('div', { key:p.id, style:{ padding:'9px 12px', marginBottom:6, borderRadius:'var(--r)', border:'.5px solid '+(activo?'var(--blue)':'var(--b2)'), background: activo?'var(--bg2)':'transparent' } },
            h('label', { style:{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' } },
              h('input', { type:'checkbox', checked:activo, onChange:()=>toggle(p.id), style:{ width:15, height:15, accentColor:'var(--blue)', flexShrink:0 } }),
              p.imageUrl && h('img', { src:p.imageUrl, style:{ width:36, height:36, objectFit:'contain', borderRadius:4, flexShrink:0, border:'1px solid var(--b1)' } }),
              h('div', { style:{ flex:1, minWidth:0 } },
                h('div', { style:{ fontSize:13, fontWeight:500 } }, desc),
                h('div', { style:{ fontSize:11, color:'var(--t2)' } }, v.cantidad,' unidad(es)', v.proveedor?' · '+v.proveedor:'', esAdmin?' · '+fmt((Number(v.costoMSMS)||0)*(Number(v.cantidad)||0)):''),
              ),
            ),
            // Campos editables -- solo se muestran si la partida está
            // seleccionada, para no saturar la lista.
            activo && h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:8, marginTop:8, paddingTop:8, borderTop:'.5px solid var(--b3)' } },
              h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Cantidad'),
                h('input', { type:'number', value:v.cantidad, onChange:e=>setOverride(p.id,'cantidad',Number(e.target.value)||0), style:{ ...inputStyle, width:'100%', boxSizing:'border-box' } })),
              esAdmin && h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Precio unitario'),
                h('input', { type:'number', value:v.costoMSMS, onChange:e=>setOverride(p.id,'costoMSMS',Number(e.target.value)||0), style:{ ...inputStyle, width:'100%', boxSizing:'border-box' } })),
              fuenteOC!=='vehiculos' && h('div', { style:{ gridColumn:'1/-1' } }, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Descripción'),
                h('input', { value:v.marca, onChange:e=>setOverride(p.id,'marca',e.target.value), style:{ ...inputStyle, width:'100%', boxSizing:'border-box' } })),
              fuenteOC!=='vehiculos' && h('div', { style:{ gridColumn:'1/-1' } }, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Proveedor de esta partida (opcional)'),
                h('input', { value:v.proveedor||'', onChange:e=>setOverride(p.id,'proveedor',e.target.value), style:{ ...inputStyle, width:'100%', boxSizing:'border-box' } })),
            ),
          );
        }));
      })(),

      // Fase 3H-1 -- resumen del carrito SIEMPRE visible (antes solo
      // aparecía con partidas), para que el estado vacío sea explícito y
      // no parezca que falta algo por cargar.
      h('div', { style:{ padding:'10px 12px', borderRadius:'var(--r)', background:'var(--bg2)', border:'.5px solid '+(partidasSeleccionadas.length>0?'var(--b2)':'var(--b3)') } },
        h('div', { style:secLabel }, 'Partidas seleccionadas'),
        partidasSeleccionadas.length === 0
          ? h('div', { style:{ fontSize:12, color:'var(--t3)' } }, 'Aún no has seleccionado partidas para esta OC.')
          : h('div', null,
              h('div', { style:{ fontSize:12, fontWeight:600, marginBottom:4 } }, partidasSeleccionadas.length, ' partida(s) seleccionada(s)'),
              h('div', { style:{ fontSize:11, color:'var(--t2)' } },
                selParts.length>0 ? selParts.length+' vehículo(s). ' : '',
                selEquipo.length>0 ? selEquipo.length+' de equipo. ' : '',
                selServicios.length>0 ? selServicios.length+' servicio(s). ' : '',
              ),
              esAdmin && h('div', { style:{ fontSize:13, fontWeight:600, marginTop:6 } }, 'Subtotal estimado: ', fmt(subtotalOC)),
            ),
      ),

      // Fase 3I-2 -- no todas las OC requieren firma. Algunas se emiten,
      // se mandan al proveedor y solo quedan como soporte documental.
      h('div', null,
        h('div', { style:secLabel }, '¿Esta orden requiere firma?'),
        h('div', { style:{ display:'flex', gap:8, marginBottom:6 } },
          h('button', { onClick:()=>setRequiereFirma(true), style:{ flex:1, padding:'8px 12px', fontSize:12, fontWeight:500, borderRadius:'var(--r)', border:'1px solid var(--b2)', cursor:'pointer', background:requiereFirma?'var(--blue)':'transparent', color:requiereFirma?'#fff':'var(--t1)' } }, 'Sí, enviar a firma'),
          h('button', { onClick:()=>setRequiereFirma(false), style:{ flex:1, padding:'8px 12px', fontSize:12, fontWeight:500, borderRadius:'var(--r)', border:'1px solid var(--b2)', cursor:'pointer', background:!requiereFirma?'var(--blue)':'transparent', color:!requiereFirma?'#fff':'var(--t1)' } }, 'No, solo expediente'),
        ),
        h('div', { style:{ fontSize:11, color:'var(--t3)', lineHeight:1.5, marginBottom:12 } },
          requiereFirma
            ? 'Se podrá enviar por el flujo de firma desde el Centro de aprobaciones.'
            : 'Quedará como soporte documental interno. No se pedirá firma ni contará como pendiente.'),
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

      h('div', { style:{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center', paddingTop:8, borderTop:'.5px solid var(--b2)', flexWrap:'wrap' } },
        h('div', { style:{ display:'flex', flexDirection:'column', gap:2 } },
          h('button', { onClick:guardarPredeterminado, style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'.5px solid var(--blue)44', padding:'5px 10px', borderRadius:'var(--r)' } }, '★ Guardar condiciones como predeterminadas'),
          savedMsg && h('span', { style:{ fontSize:10, color:'#1D9E75' } }, savedMsg),
        ),
        h('div', { style:{ display:'flex', gap:8, alignItems:'center' } },
          h('button', { onClick:onClose }, 'Cancelar'),
          // Fase 3H-1 -- el botón se deshabilita visual y funcionalmente
          // con el carrito vacío. La validación dentro de generar()
          // (alert) SE MANTIENE como respaldo -- este disabled es una
          // capa de UX encima, no la reemplaza.
          h('button', {
            className:'bp',
            onClick:generar,
            disabled: partidasSeleccionadas.length === 0,
            title: partidasSeleccionadas.length === 0 ? 'Selecciona al menos una partida para crear la OC' : '',
            style: partidasSeleccionadas.length === 0 ? { opacity:.5, cursor:'not-allowed' } : {},
          }, '📄 Generar OC'),
        ),
        partidasSeleccionadas.length === 0 && h('div', { style:{ fontSize:11, color:'var(--t3)', textAlign:'right', marginTop:6 } },
          'Selecciona al menos una partida para crear la OC'),
      ),
    ),
  );
}
