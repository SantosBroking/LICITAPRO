import { h, useState, useEffect, useRef } from '../lib/core.js';
import { listInboxItems, updateInboxItem, markInboxSeen, createInboxItem, commentOnInboxItem } from '../lib/supabase.js';
import { getPermissions } from '../lib/permissions.js';
import { normalizeProjectName } from '../lib/utils.js';
import {
  INBOX_TIPOS, INBOX_TIPO_LABELS, INBOX_ESTATUS, INBOX_ESTATUS_LABELS,
  INBOX_PRIORIDADES, INBOX_PRIORIDAD_LABELS, INBOX_ACCIONES, INBOX_ACCION_LABELS,
  esProyectoPerdido,
} from '../lib/constants.js';

// Fase 2F3/2G — Inbox / Centro de aprobaciones / Peticiones internas.
// Componente autocontenido: carga sus propios datos vía listInboxItems()
// (mismo patrón ya usado por otras vistas que importan directo de
// supabase.js -- Admin.js, Vehicles.js, Cotizacion.js, etc.). Nunca recibe
// ni construye un snapshot de proyecto; solo lee/crea referencias livianas
// (data jsonb con allowlist explícita, ver api/inbox-create.js).

const STATUS_COLORS = {
  pendiente: { bg:'#E6F1FB', tx:'#1A4480' },
  en_revision: { bg:'#FAEEDA', tx:'#633806' },
  aprobado: { bg:'#E1F5EE', tx:'#085041' },
  rechazado: { bg:'#FCEBEB', tx:'#791F1F' },
  cambios_solicitados: { bg:'#FAEEDA', tx:'#633806' },
  revisado: { bg:'#E1F5EE', tx:'#085041' },
  cerrado: { bg:'var(--bg2)', tx:'var(--t2)' },
};
const PRIORIDAD_COLORS = {
  baja: { bg:'var(--bg2)', tx:'var(--t2)' },
  media: { bg:'#E6F1FB', tx:'#1A4480' },
  alta: { bg:'#FAEEDA', tx:'#633806' },
  urgente: { bg:'#FCEBEB', tx:'#791F1F' },
};
const ESTATUS_FINALES = ['aprobado', 'rechazado', 'revisado', 'cerrado'];

const formatearFecha = (f) => f ? new Date(f).toLocaleString('es-MX') : '—';

function BadgeEstatus({ status }) {
  const col = STATUS_COLORS[status] || STATUS_COLORS.pendiente;
  return h('span', { style:{ fontSize:11, padding:'3px 12px', borderRadius:12, background:col.bg, color:col.tx, fontWeight:500, whiteSpace:'nowrap' } }, INBOX_ESTATUS_LABELS[status]||status);
}
function BadgePrioridad({ prioridad }) {
  if (!prioridad) return null;
  const col = PRIORIDAD_COLORS[prioridad] || PRIORIDAD_COLORS.media;
  return h('span', { style:{ fontSize:10, padding:'2px 9px', borderRadius:10, background:col.bg, color:col.tx, fontWeight:600, whiteSpace:'nowrap' } }, (INBOX_PRIORIDAD_LABELS[prioridad]||prioridad).toUpperCase());
}

export function Inbox({ user, onNav, projects, onSeenChange }) {
  const [items, setItems] = useState(null); // null = cargando todavía
  const [error, setError] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroPrioridad, setFiltroPrioridad] = useState('todos');
  const [filtroProyecto, setFiltroProyecto] = useState('todos');
  const [filtroCreador, setFiltroCreador] = useState('todos');
  const [soloNoLeidos, setSoloNoLeidos] = useState(false);
  const [comentarios, setComentarios] = useState({});
  const [respuestas, setRespuestas] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [expandidoId, setExpandidoId] = useState(null);
  const [showNueva, setShowNueva] = useState(false);
  const isAdmin = getPermissions(user).isAdmin;
  // Fase 2F4: campo de "visto" según el rol -- admin usa seen_by_admin_at,
  // empleado usa seen_by_creator_at (dentro de sus propios pendientes o
  // los que le asignen, Fase 2G).
  const campoVisto = isAdmin ? 'seen_by_admin_at' : 'seen_by_creator_at';
  // "Foto" de qué estaba sin leer AL MOMENTO de cargar esta vez -- se usa
  // solo para el resaltado visual, y no se recalcula hasta la PRÓXIMA
  // carga (cargar()) -- así el usuario alcanza a VER qué era nuevo antes
  // de que marcarlo como visto (en segundo plano, justo después) lo
  // vuelva indistinguible en esta misma visita.
  const sinLeerAlCargarRef = useRef(new Set());

  const cargar = async () => {
    setError('');
    try {
      const { items: nuevos } = await listInboxItems();
      sinLeerAlCargarRef.current = new Set(nuevos.filter(i => !i[campoVisto]).map(i => i.id));
      setItems(nuevos);
      // Fase 2F4 -- MVP: al abrir/recargar el Inbox, se marcan como vistos
      // TODOS los pendientes visibles para este usuario, después de ya
      // haberlos cargado (nunca antes).
      if (sinLeerAlCargarRef.current.size > 0) {
        markInboxSeen({ all:true })
          .then(() => { if (onSeenChange) onSeenChange(); })
          .catch(e => console.error('[Inbox] No se pudo marcar como visto:', e));
      }
    } catch(e) {
      console.error('[Inbox] Error al cargar:', e);
      setError('No se pudo cargar el inbox: ' + e.message);
      setItems([]);
    }
  };
  useEffect(() => { cargar(); }, []);

  const accionar = async (id, status) => {
    setBusyId(id);
    try { await updateInboxItem(id, status, comentarios[id] || ''); await cargar(); }
    catch(e) { alert('Error al actualizar: ' + e.message); }
    setBusyId(null);
  };

  const responder = async (id) => {
    const mensaje = (respuestas[id]||'').trim();
    if (!mensaje) return;
    setBusyId(id);
    try {
      await commentOnInboxItem(id, mensaje);
      setRespuestas(p => ({ ...p, [id]: '' }));
      await cargar();
      if (onSeenChange) onSeenChange();
    } catch(e) { alert('Error al responder: ' + e.message); }
    setBusyId(null);
  };

  if (items === null) return h('div', { className:'empty' }, h('p', null, 'Cargando pendientes...'));

  // Fase 2G -- filtros ampliados: estatus, tipo, prioridad, proyecto,
  // creado por, no leídos/todos.
  const creadores = [...new Set(items.map(i=>i.created_by).filter(Boolean))];
  const filtrados = items.filter(i =>
    (filtroStatus==='todos' || i.status===filtroStatus) &&
    (filtroTipo==='todos' || i.type===filtroTipo) &&
    (filtroPrioridad==='todos' || (i.data&&i.data.prioridad)===filtroPrioridad) &&
    (filtroProyecto==='todos' || i.project_id===filtroProyecto) &&
    (filtroCreador==='todos' || i.created_by===filtroCreador) &&
    (!soloNoLeidos || sinLeerAlCargarRef.current.has(i.id))
  );

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10, marginBottom:4 } },
      h('div', null,
        h('div', { style:{ fontSize:20, fontWeight:500 } }, isAdmin ? 'Inbox / Centro de aprobaciones' : 'Mis pendientes'),
        h('div', { style:{ fontSize:13, color:'var(--t2)' } },
          isAdmin ? 'Peticiones de empleados esperando revisión.' : 'Tus peticiones y las que te asignen.'),
      ),
      h('button', { onClick:()=>setShowNueva(true), style:{ fontSize:12, padding:'8px 16px', background:'var(--blue)', color:'#fff', border:'none', borderRadius:'var(--r)', cursor:'pointer', fontWeight:500 } }, '+ Nueva petición'),
    ),
    h('div', { style:{ height:12 } }),
    error && h('div', { style:{ color:'var(--red)', marginBottom:12, fontSize:13, padding:'8px 12px', background:'#FCEBEB', borderRadius:8 } }, error),

    // ══ Filtros ══
    h('div', { style:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' } },
      h('select', { value:filtroStatus, onChange:e=>setFiltroStatus(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Todos los estatus'),
        INBOX_ESTATUS.map(s => h('option', { key:s, value:s }, INBOX_ESTATUS_LABELS[s])),
      ),
      h('select', { value:filtroTipo, onChange:e=>setFiltroTipo(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Todos los tipos'),
        INBOX_TIPOS.map(t => h('option', { key:t, value:t }, INBOX_TIPO_LABELS[t])),
      ),
      h('select', { value:filtroPrioridad, onChange:e=>setFiltroPrioridad(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Toda prioridad'),
        INBOX_PRIORIDADES.map(p => h('option', { key:p, value:p }, INBOX_PRIORIDAD_LABELS[p])),
      ),
      h('select', { value:filtroProyecto, onChange:e=>setFiltroProyecto(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)', maxWidth:180 } },
        h('option', { value:'todos' }, 'Todos los proyectos'),
        (projects||[]).map(p => h('option', { key:p.id, value:p.id }, normalizeProjectName(p.name))),
      ),
      isAdmin && h('select', { value:filtroCreador, onChange:e=>setFiltroCreador(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Todos los creadores'),
        creadores.map(c => h('option', { key:c, value:c }, c)),
      ),
      h('label', { style:{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--t2)', cursor:'pointer' } },
        h('input', { type:'checkbox', checked:soloNoLeidos, onChange:e=>setSoloNoLeidos(e.target.checked) }),
        'Solo no leídos',
      ),
      h('button', { onClick:cargar, style:{ fontSize:12, padding:'6px 12px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, '↻ Actualizar'),
    ),

    filtrados.length===0
      ? h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)', fontSize:13 } }, 'Sin pendientes con estos filtros.')
      : h('div', { style:{ display:'flex', flexDirection:'column', gap:10 } }, filtrados.map(item => {
          const proyecto = (projects || []).find(p => p.id === item.project_id);
          const noLeido = sinLeerAlCargarRef.current.has(item.id);
          const prioridad = item.data && item.data.prioridad;
          const expandido = expandidoId === item.id;
          return h('div', { key:item.id, className:'card', style: noLeido ? { background:'#FFF8F0', borderLeft:'3px solid var(--red)' } : {} },
            // ── Cabecera de tarjeta (siempre visible, clic expande/colapsa) ──
            h('div', { onClick:()=>setExpandidoId(expandido?null:item.id), style:{ cursor:'pointer' } },
              h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap' } },
                h('div', { style:{ minWidth:0, flex:1 } },
                  h('div', { style:{ fontSize:14, fontWeight:noLeido?700:500, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' } },
                    noLeido && h('span', { style:{ width:8, height:8, borderRadius:'50%', background:'var(--red)', display:'inline-block', flexShrink:0 } }),
                    item.title,
                    h(BadgePrioridad, { prioridad }),
                  ),
                  h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:3 } },
                    (INBOX_TIPO_LABELS[item.type]||item.type), ' · ', (proyecto ? normalizeProjectName(proyecto.name) : (item.project_id || 'sin proyecto')),
                    ' · ', (item.created_by||'—'), ' · ', item.created_at ? new Date(item.created_at).toLocaleString('es-MX') : '—'),
                  !expandido && item.message && h('div', { style:{ fontSize:12, color:'var(--t1)', marginTop:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, item.message),
                ),
                h(BadgeEstatus, { status:item.status }),
              ),
            ),

            // ── Detalle expandido ──
            expandido && h('div', { style:{ marginTop:12, paddingTop:12, borderTop:'.5px solid var(--b3)' } },
              item.message && h('div', { style:{ fontSize:13, color:'var(--t1)', marginBottom:10, whiteSpace:'pre-wrap' } }, item.message),
              h('div', { style:{ display:'flex', gap:14, flexWrap:'wrap', fontSize:11, color:'var(--t2)', marginBottom:10 } },
                item.data?.accionSolicitada && h('div', null, 'Acción solicitada: ', h('b', null, INBOX_ACCION_LABELS[item.data.accionSolicitada]||item.data.accionSolicitada)),
                item.data?.referenciaLabel && h('div', null, 'Referencia: ', h('b', null, item.data.referenciaLabel)),
                item.data?.dueDate && h('div', null, 'Fecha límite: ', h('b', null, item.data.dueDate)),
                item.assigned_to && h('div', null, 'Asignado a: ', h('b', null, item.assigned_to)),
              ),
              item.project_id && h('button', { onClick:(e)=>{e.stopPropagation();onNav('project_detail', item.project_id);}, style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', cursor:'pointer', padding:0, marginBottom:10, display:'block' } }, 'Ver proyecto →'),
              (item.history||[]).length>0 && h('div', { style:{ marginBottom:10 } },
                h('div', { style:{ fontSize:11, color:'var(--t2)', fontWeight:600, marginBottom:6 } }, 'Historial ('+item.history.length+')'),
                h('div', { style:{ display:'flex', flexDirection:'column', gap:4 } },
                  item.history.map((h_,i) => h('div', { key:i, style:{ fontSize:11, color:'var(--t2)' } },
                    h('b', null, h_.por), ' — ', (h_.accion==='comentario'?'comentó':(INBOX_ESTATUS_LABELS[h_.accion]||h_.accion)), (h_.comentario?': "'+h_.comentario+'"':''), ' · ', formatearFecha(h_.fecha))),
                ),
              ),
              // ── Botones admin ──
              isAdmin && !ESTATUS_FINALES.includes(item.status) && h('div', { onClick:e=>e.stopPropagation() },
                h('input', { placeholder:'Comentario (opcional)', value:comentarios[item.id]||'', onChange:e=>setComentarios(p=>({...p,[item.id]:e.target.value})), style:{ fontSize:12, padding:'6px 10px', width:'100%', marginBottom:8, border:'1px solid var(--b2)', borderRadius:6, boxSizing:'border-box' } }),
                h('div', { style:{ display:'flex', gap:8, flexWrap:'wrap' } },
                  h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'aprobado'), style:{ fontSize:12, padding:'6px 12px', background:'var(--green)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' } }, 'Aprobar'),
                  h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'rechazado'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', color:'var(--red)', border:'1px solid var(--red)', borderRadius:6, cursor:'pointer' } }, 'Rechazar'),
                  h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'cambios_solicitados'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Pedir cambios'),
                  h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'revisado'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Marcar revisado'),
                  h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'cerrado'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Cerrar'),
                ),
              ),
              // ── Responder comentario -- ambos roles, en lo suyo/asignado
              // (empleado) o cualquiera (admin); nunca cambia estatus ──
              h('div', { onClick:e=>e.stopPropagation(), style:{ marginTop: (isAdmin && !ESTATUS_FINALES.includes(item.status)) ? 10 : 0 } },
                h('div', { style:{ display:'flex', gap:8 } },
                  h('input', { placeholder:'Responder / comentar...', value:respuestas[item.id]||'', onChange:e=>setRespuestas(p=>({...p,[item.id]:e.target.value})), style:{ fontSize:12, padding:'6px 10px', flex:1, border:'1px solid var(--b2)', borderRadius:6, boxSizing:'border-box' } }),
                  h('button', { disabled:busyId===item.id || !(respuestas[item.id]||'').trim(), onClick:()=>responder(item.id), style:{ fontSize:12, padding:'6px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Responder'),
                ),
              ),
            ),
          );
        })),

    showNueva && h(NuevaPeticionModal, { projects, onClose:()=>setShowNueva(false), onCreated:async ()=>{ setShowNueva(false); await cargar(); if (onSeenChange) onSeenChange(); } }),
  );
}

// Fase 2G — modal simple para crear una petición nueva. Disponible para
// ambos roles. Envía SIEMPRE vía createInboxItem() -> api/inbox-create.js,
// que valida/sanea todo server-side (nunca se confía en lo que arme este
// formulario).
function NuevaPeticionModal({ projects, onClose, onCreated }) {
  const [projectId, setProjectId] = useState('');
  const [tipo, setTipo] = useState('otro');
  const [prioridad, setPrioridad] = useState('media');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [accion, setAccion] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorForm, setErrorForm] = useState('');

  const enviar = async () => {
    if (!titulo.trim()) { setErrorForm('Falta el título.'); return; }
    setEnviando(true);
    setErrorForm('');
    try {
      const proyecto = (projects||[]).find(p=>p.id===projectId);
      await createInboxItem({
        type: tipo,
        title: titulo.trim(),
        message: descripcion.trim() || null,
        project_id: projectId || null,
        data: {
          prioridad,
          ...(accion ? { accionSolicitada: accion } : {}),
          ...(dueDate ? { dueDate } : {}),
          ...(proyecto ? { proyectoNombre: normalizeProjectName(proyecto.name) } : {}),
          source: 'inbox_manual',
        },
      });
      onCreated();
    } catch(e) { setErrorForm('No se pudo crear la petición: ' + e.message); }
    setEnviando(false);
  };

  return h('div', { style:{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }, onClick:onClose },
    h('div', { className:'card', style:{ maxWidth:460, width:'100%', maxHeight:'85vh', overflowY:'auto' }, onClick:e=>e.stopPropagation() },
      h('div', { style:{ fontSize:16, fontWeight:500, marginBottom:14 } }, 'Nueva petición'),
      errorForm && h('div', { style:{ color:'var(--red)', fontSize:12, marginBottom:10, padding:'6px 10px', background:'#FCEBEB', borderRadius:6 } }, errorForm),
      h('div', { style:{ display:'flex', flexDirection:'column', gap:10 } },
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Proyecto (opcional)'),
          h('select', { value:projectId, onChange:e=>setProjectId(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
            h('option', { value:'' }, '— Sin proyecto —'),
            // Hotfix -- no se ofrecen proyectos perdidos/cancelados para
            // CREAR una petición nueva (el filtro de búsqueda de arriba,
            // en cambio, sigue listando todos, para poder encontrar
            // peticiones ya existentes de un proyecto que ya se perdió).
            (projects||[]).filter(p=>!esProyectoPerdido(p.status)).map(p => h('option', { key:p.id, value:p.id }, normalizeProjectName(p.name))),
          ),
        ),
        h('div', { style:{ display:'flex', gap:8 } },
          h('div', { style:{ flex:1 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Tipo'),
            h('select', { value:tipo, onChange:e=>setTipo(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
              INBOX_TIPOS.map(t => h('option', { key:t, value:t }, INBOX_TIPO_LABELS[t])),
            ),
          ),
          h('div', { style:{ flex:1 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Prioridad'),
            h('select', { value:prioridad, onChange:e=>setPrioridad(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
              INBOX_PRIORIDADES.map(p => h('option', { key:p, value:p }, INBOX_PRIORIDAD_LABELS[p])),
            ),
          ),
        ),
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Título'),
          h('input', { value:titulo, onChange:e=>setTitulo(e.target.value), placeholder:'Ej: Necesito aprobación de precio', style:{ fontSize:13, padding:'7px 9px', width:'100%', boxSizing:'border-box' } }),
        ),
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Descripción / mensaje'),
          h('textarea', { value:descripcion, onChange:e=>setDescripcion(e.target.value), rows:3, style:{ fontSize:13, padding:'7px 9px', width:'100%', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical' } }),
        ),
        h('div', { style:{ display:'flex', gap:8 } },
          h('div', { style:{ flex:1 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Acción solicitada (opcional)'),
            h('select', { value:accion, onChange:e=>setAccion(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
              h('option', { value:'' }, '—'),
              INBOX_ACCIONES.map(a => h('option', { key:a, value:a }, INBOX_ACCION_LABELS[a])),
            ),
          ),
          h('div', { style:{ flex:1 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Fecha límite (opcional)'),
            h('input', { type:'date', value:dueDate, onChange:e=>setDueDate(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } }),
          ),
        ),
      ),
      h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 } },
        h('button', { onClick:onClose, style:{ fontSize:12, padding:'7px 14px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Cancelar'),
        h('button', { disabled:enviando, onClick:enviar, style:{ fontSize:12, padding:'7px 16px', background:'var(--blue)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', opacity:enviando?.7:1 } }, enviando?'Enviando...':'Crear petición'),
      ),
    ),
  );
}
