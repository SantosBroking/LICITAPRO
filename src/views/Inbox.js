import { h, useState, useEffect, useRef } from '../lib/core.js';
import { listInboxItems, updateInboxItem, markInboxSeen } from '../lib/supabase.js';
import { getPermissions } from '../lib/permissions.js';

// Fase 2F3 — Inbox / Centro de aprobaciones. Componente autocontenido:
// carga sus propios datos vía listInboxItems() (mismo patrón ya usado por
// otras vistas que importan directo de supabase.js -- Admin.js, Vehicles.js,
// Cotizacion.js, etc.). Nunca recibe ni construye un snapshot de proyecto;
// solo lee lo que ya guardó api/inbox-create.js (referencias livianas).

const TIPO_LABELS = {
  proyecto_nuevo: 'Proyecto nuevo',
  cotizacion_revision: 'Cotización a revisión',
  documento_cargado: 'Documento cargado',
  cambios_solicitados: 'Cambios solicitados',
};
const STATUS_LABELS = {
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  cambios_solicitados: 'Cambios solicitados',
  revisado: 'Revisado',
};
const STATUS_COLORS = {
  pendiente: { bg:'#E6F1FB', tx:'#1A4480' },
  en_revision: { bg:'#FAEEDA', tx:'#633806' },
  aprobado: { bg:'#E1F5EE', tx:'#085041' },
  rechazado: { bg:'#FCEBEB', tx:'#791F1F' },
  cambios_solicitados: { bg:'#FAEEDA', tx:'#633806' },
  revisado: { bg:'#E1F5EE', tx:'#085041' },
};
const ESTATUS_FINALES = ['aprobado', 'rechazado', 'revisado'];

export function Inbox({ user, onNav, projects, onSeenChange }) {
  const [items, setItems] = useState(null); // null = cargando todavía
  const [error, setError] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [comentarios, setComentarios] = useState({});
  const [busyId, setBusyId] = useState(null);
  const isAdmin = getPermissions(user).isAdmin;
  // Fase 2F4: campo de "visto" según el rol -- admin usa seen_by_admin_at,
  // empleado usa seen_by_creator_at (dentro de sus propios pendientes).
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
      // Fase 2F4 -- MVP recomendado: al abrir/recargar el Inbox, se marcan
      // como vistos TODOS los pendientes visibles para este usuario,
      // después de ya haberlos cargado (no antes) -- el usuario alcanza a
      // ver el resaltado de "no leído" en esta visita; en la siguiente
      // carga ya no lo verá (correcto, ya los vio). No se marca por-click-
      // en-item porque con pocos pendientes por proyecto esto es más simple
      // y no se presta a confusión ("¿por qué no se quitó el badge si ya
      // lo abrí?").
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

  if (items === null) return h('div', { className:'empty' }, h('p', null, 'Cargando pendientes...'));

  const filtrados = items.filter(i =>
    (filtroStatus==='todos' || i.status===filtroStatus) &&
    (filtroTipo==='todos' || i.type===filtroTipo)
  );

  return h('div', null,
    h('div', { style:{ fontSize:20, fontWeight:500, marginBottom:4 } }, isAdmin ? 'Inbox / Centro de aprobaciones' : 'Mis pendientes'),
    h('div', { style:{ fontSize:13, color:'var(--t2)', marginBottom:16 } },
      isAdmin ? 'Pendientes de empleados esperando revisión.' : 'Estatus de tus proyectos y cotizaciones enviados a revisión.'),
    error && h('div', { style:{ color:'var(--red)', marginBottom:12, fontSize:13, padding:'8px 12px', background:'#FCEBEB', borderRadius:8 } }, error),
    h('div', { style:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' } },
      h('select', { value:filtroStatus, onChange:e=>setFiltroStatus(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Todos los estatus'),
        Object.keys(STATUS_LABELS).map(s => h('option', { key:s, value:s }, STATUS_LABELS[s])),
      ),
      h('select', { value:filtroTipo, onChange:e=>setFiltroTipo(e.target.value), style:{ fontSize:12, padding:'6px 10px', borderRadius:6, border:'1px solid var(--b2)' } },
        h('option', { value:'todos' }, 'Todos los tipos'),
        Object.keys(TIPO_LABELS).map(t => h('option', { key:t, value:t }, TIPO_LABELS[t])),
      ),
      h('button', { onClick:cargar, style:{ fontSize:12, padding:'6px 12px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, '↻ Actualizar'),
    ),
    filtrados.length===0
      ? h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)', fontSize:13 } }, 'Sin pendientes.')
      : h('div', { style:{ display:'flex', flexDirection:'column', gap:12 } }, filtrados.map(item => {
          const col = STATUS_COLORS[item.status] || STATUS_COLORS.pendiente;
          const proyecto = (projects || []).find(p => p.id === item.project_id);
          const noLeido = sinLeerAlCargarRef.current.has(item.id);
          return h('div', { key:item.id, className:'card', style: noLeido ? { background:'#FFF8F0', borderLeft:'3px solid var(--red)' } : {} },
            h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8, gap:8, flexWrap:'wrap' } },
              h('div', null,
                h('div', { style:{ fontSize:14, fontWeight:noLeido?700:500, display:'flex', alignItems:'center', gap:6 } },
                  noLeido && h('span', { style:{ width:8, height:8, borderRadius:'50%', background:'var(--red)', display:'inline-block', flexShrink:0 } }),
                  item.title,
                ),
                h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } },
                  (TIPO_LABELS[item.type]||item.type), ' · ', (proyecto ? proyecto.name : (item.project_id || '—')),
                  ' · ', (item.created_by||'—'), ' · ', item.created_at ? new Date(item.created_at).toLocaleString('es-MX') : '—'),
              ),
              h('span', { style:{ fontSize:11, padding:'3px 12px', borderRadius:12, background:col.bg, color:col.tx, fontWeight:500, whiteSpace:'nowrap' } }, STATUS_LABELS[item.status]||item.status),
            ),
            item.message && h('div', { style:{ fontSize:13, color:'var(--t1)', marginBottom:8 } }, item.message),
            item.project_id && h('button', { onClick:()=>onNav('project_detail', item.project_id), style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', cursor:'pointer', padding:0, marginBottom:8, display:'block' } }, 'Ver proyecto →'),
            (item.history||[]).length>0 && h('details', { style:{ marginBottom:8 } },
              h('summary', { style:{ fontSize:11, color:'var(--t2)', cursor:'pointer' } }, 'Historial ('+item.history.length+')'),
              h('div', { style:{ marginTop:6, display:'flex', flexDirection:'column', gap:4 } },
                item.history.map((h_,i) => h('div', { key:i, style:{ fontSize:11, color:'var(--t2)' } },
                  h_.por+' — '+(STATUS_LABELS[h_.accion]||h_.accion)+(h_.comentario?' — "'+h_.comentario+'"':'')+' · '+(h_.fecha?new Date(h_.fecha).toLocaleString('es-MX'):''))),
              ),
            ),
            // Fase 2F3: solo admin ve los botones de acción -- "empleado no
            // puede aprobar" también se aplica visualmente aquí, aunque el
            // bloqueo REAL vive en api/inbox-update.js (server-side, nunca
            // solo en la UI).
            isAdmin && !ESTATUS_FINALES.includes(item.status) && h('div', null,
              h('input', { placeholder:'Comentario (opcional)', value:comentarios[item.id]||'', onChange:e=>setComentarios(p=>({...p,[item.id]:e.target.value})), style:{ fontSize:12, padding:'6px 10px', width:'100%', marginBottom:8, border:'1px solid var(--b2)', borderRadius:6 } }),
              h('div', { style:{ display:'flex', gap:8, flexWrap:'wrap' } },
                h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'aprobado'), style:{ fontSize:12, padding:'6px 12px', background:'var(--green)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' } }, 'Aprobar'),
                h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'rechazado'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', color:'var(--red)', border:'1px solid var(--red)', borderRadius:6, cursor:'pointer' } }, 'Rechazar'),
                h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'cambios_solicitados'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Pedir cambios'),
                h('button', { disabled:busyId===item.id, onClick:()=>accionar(item.id,'revisado'), style:{ fontSize:12, padding:'6px 12px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Marcar revisado'),
              ),
            ),
          );
        })),
  );
}
