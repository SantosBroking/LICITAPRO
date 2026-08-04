// PurchaseOrders.js — Fase 3G-B
//
// Módulo global "Órdenes de Compra": lista combinada de OCs nuevas
// (public.purchase_orders) + OCs legacy (project.ordenesCompra[], solo
// lectura/acciones limitadas -- NO se migran, NO se tocan). Permite crear
// OC independiente (sin proyecto) o ligada a un proyecto existente, ambas
// vía purchase_orders. El generador legacy dentro de Projects.js NO se
// toca -- este módulo es adicional, no un reemplazo (Opción C híbrida
// aprobada por Santiago).
import { h, useState, useEffect } from '../lib/core.js';
import {
  listPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, cancelPurchaseOrder,
  createInboxItem, listInboxItems,
} from '../lib/supabase.js';
import { avisarFirmaRequeridaInbox } from '../lib/inbox_firma_emails.js';
import { getPermissions } from '../lib/permissions.js';
import { fmt } from '../lib/utils.js';
import { printOrdenCompra } from '../lib/pdf_export.js';

const IVA = 0.16;

// Construye el adaptador EN MEMORIA para reutilizar buildOrdenCompraHTML
// (via printOrdenCompra) sin persistir ningún proyecto falso. Confirmado
// en el diagnóstico: buildOrdenCompraHTML ya maneja folioProyecto/
// numLicitacion/dependencia ausentes de forma condicional -- no hace
// falta tocar pdf_export.js en absoluto.
function adaptarOCParaPDF(oc, project) {
  const partidasPDF = (oc.partidas || []).map(p => ({
    id: p.id,
    tipo: p.tipo === 'equipo' ? 'Equipo' : p.tipo === 'servicio' ? 'Servicio' : (p.tipo || 'Otro'),
    marca: p.descripcion || 'Sin descripción',
    modelo: '', version: '', ano: '', color: '',
    cantidad: Number(p.cantidad || 0),
    costoMSMS: Number(p.precioUnit || 0),
    origen: (p.tipo === 'equipo') ? 'cotizacion_equipo' : (p.tipo === 'servicio') ? 'servicio_manual' : undefined,
    imageUrl: p.imageUrl || '',
  }));
  const adaptedProject = project
    ? { ...project } // OC ligada: usar el proyecto real tal cual (folioProyecto/dependencia/numLicitacion reales)
    : {
        // OC independiente -- adaptador mínimo, NUNCA persistido.
        name: '', dependencia: 'OC independiente', numLicitacion: '',
        folioProyecto: null, company: oc.data?.empresaNombre || '',
        responsable: '', ocProveedor: { name: oc.proveedor_nombre, rfc: oc.proveedor_rfc, address: oc.data?.proveedorDireccion || '' },
        cotizacion: { agenciaProveedor: oc.proveedor_nombre },
      };
  return { project: adaptedProject, partidas: partidasPDF, condiciones: oc.condiciones || [], folio: oc.folio, companyObj: null };
}

function calcularTotales(partidas) {
  let subtotal = 0;
  (partidas||[]).forEach(p => { subtotal += Number(p.precioUnit||0) * Number(p.cantidad||0); });
  const iva = subtotal * IVA;
  return { subtotal, iva, total: subtotal + iva };
}

const ESTATUS_LABELS = { borrador:'Borrador', en_aprobacion:'En aprobación', en_firma:'En firma', cerrada:'Cerrada', cancelada:'Cancelada' };

export function PurchaseOrders({ user, onNav, projects, companies, config }) {
  const perms = getPermissions(user);
  const isAdmin = perms.isAdmin;
  const [items, setItems] = useState([]);
  const [inboxItems, setInboxItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todas');
  const [showNueva, setShowNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const [ocs, inbox] = await Promise.all([listPurchaseOrders(), listInboxItems()]);
      setItems(ocs);
      setInboxItems((inbox && inbox.items) || []);
    } catch(e) { console.error('[PurchaseOrders] Error al cargar:', e); }
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  // OCs legacy -- de solo lectura, tomadas de project.ordenesCompra[] en
  // cada proyecto visible. NO se migran, NO se tocan -- se muestran
  // combinadas con las nuevas para dar visibilidad global real.
  const legacyItems = [];
  (projects||[]).forEach(p => {
    (p.ordenesCompra||[]).forEach(oc => {
      legacyItems.push({ ...oc, __legacy:true, __project:p, project_id:p.id, folio:oc.folio, proveedor_nombre:oc.proveedor, total:null, status:null });
    });
  });

  const inboxPorOC = id => inboxItems.find(i => i.type==='firma_documento' && i.data && (i.data.ocId===id));
  const firmaStatusDeOC = oc => {
    const item = inboxPorOC(oc.id);
    if (!item) return 'pendiente';
    if (['aprobado','cerrado'].includes(item.status) || (item.data && ['firmado','visto_final'].includes(item.data.firmaStatus))) return 'firmado';
    if (item.data && item.data.firmaStatus==='pendiente_firma') return 'en_firma';
    return 'pendiente';
  };

  const todosItems = [...items, ...legacyItems];
  const aplicarFiltro = list => {
    switch(filtro) {
      case 'borrador': return list.filter(o=>o.status==='borrador');
      case 'aprobacion_firma': return list.filter(o=>['en_aprobacion','en_firma'].includes(o.status));
      case 'cerradas': return list.filter(o=>o.status==='cerrada');
      case 'canceladas': return list.filter(o=>o.status==='cancelada');
      case 'independientes': return list.filter(o=>!o.project_id);
      case 'ligadas': return list.filter(o=>!!o.project_id && !o.__legacy);
      case 'legacy': return list.filter(o=>o.__legacy);
      default: return list;
    }
  };
  const visibles = aplicarFiltro(todosItems);

  const descargarPDF = (oc) => {
    const project = oc.project_id ? (projects||[]).find(p=>p.id===oc.project_id) : null;
    printOrdenCompra(adaptarOCParaPDF(oc, project));
  };

  const enviarAFirma = async (oc) => {
    const soloAdmins = (config?.equipo||[]).filter(u => getPermissions({role:u.role}).verCostosInternos);
    let firmanteEmail = user?.email, firmanteNombre = user?.name;
    if (soloAdmins.length > 1) {
      const opciones = soloAdmins.map((e,i)=>`${i+1}. ${e.name} (${e.email})`).join('\n');
      const sel = prompt('¿Quién firmará esta Orden de Compra?\n\n'+opciones);
      if (sel===null) return;
      const idx = parseInt(sel,10)-1;
      if (!soloAdmins[idx]) { alert('Opción no válida.'); return; }
      firmanteEmail = soloAdmins[idx].email; firmanteNombre = soloAdmins[idx].name;
    }
    try {
      await createInboxItem({
        type: 'firma_documento',
        title: 'Firma de OC ' + oc.folio,
        message: 'Se requiere firma de la Orden de Compra ' + oc.folio + (oc.proveedor_nombre?' (proveedor: '+oc.proveedor_nombre+')':'') + '.',
        project_id: oc.project_id || null,
        assigned_to: firmanteEmail,
        data: {
          documentoTipo: 'orden_compra', documentoFolio: oc.folio,
          folioProyecto: oc.project_id ? ((projects||[]).find(p=>p.id===oc.project_id)?.folioProyecto || null) : null,
          source: 'purchase_order', ocId: oc.id, firmaStatus: 'pendiente_firma',
        },
      });
      try { await avisarFirmaRequeridaInbox({ documentoFolio: oc.folio, folioProyecto:null, proyectoNombre:'', firmanteEmail, firmanteNombre }); }
      catch(eCorreo) { console.error('[PurchaseOrders] Firma creada, correo no se pudo enviar:', eCorreo); }
      await cargar();
      alert('✅ Orden de Compra ' + oc.folio + ' enviada al Centro de aprobaciones.');
    } catch(e) { alert('No se pudo enviar a firma: ' + e.message); }
  };

  const cancelar = async (oc) => {
    if (!confirm('¿Cancelar la Orden de Compra ' + oc.folio + '? Esta acción no se puede deshacer.')) return;
    try { await cancelPurchaseOrder(oc.id); await cargar(); }
    catch(e) { alert('No se pudo cancelar: ' + e.message); }
  };

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 } },
      h('div', { className:'page-title' }, 'Órdenes de Compra'),
      h('button', { className:'bp', onClick:()=>setShowNueva(true) }, '+ Nueva OC independiente'),
    ),
    h('div', { style:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' } },
      [['todas','Todas'],['borrador','Borrador'],['aprobacion_firma','En aprobación/firma'],['cerradas','Cerradas/firmadas'],['canceladas','Canceladas'],['independientes','Independientes'],['ligadas','Ligadas a proyecto'],['legacy','Legacy']].map(([id,label]) =>
        h('button', { key:id, onClick:()=>setFiltro(id), style:{ fontSize:12, padding:'6px 12px', borderRadius:'var(--r)', border:'1px solid var(--b2)', cursor:'pointer', background:filtro===id?'var(--blue)':'transparent', color:filtro===id?'#fff':'var(--t1)' } }, label)
      ),
    ),
    cargando
      ? h('div', { style:{ padding:20, textAlign:'center', color:'var(--t3)' } }, 'Cargando...')
      : visibles.length === 0
      ? h('div', { style:{ padding:20, textAlign:'center', color:'var(--t3)' } }, 'No hay órdenes de compra en este filtro.')
      : h('div', { style:{ overflowX:'auto' } },
          h('table', { style:{ width:'100%', fontSize:12, borderCollapse:'collapse' } },
            h('thead', null, h('tr', { style:{ textAlign:'left', borderBottom:'1px solid var(--b2)' } },
              ['Folio','Proveedor','Proyecto','Fecha','Total','Estatus','Origen','Firma','Acciones'].map(c => h('th', { key:c, style:{ padding:'8px 6px' } }, c)),
            )),
            h('tbody', null, visibles.map(oc => h('tr', { key:(oc.__legacy?'legacy-':'')+oc.id, style:{ borderBottom:'1px solid var(--b3)' } },
              h('td', { style:{ padding:'8px 6px', fontFamily:'monospace' } }, oc.folio),
              h('td', { style:{ padding:'8px 6px' } }, oc.proveedor_nombre || '—'),
              h('td', { style:{ padding:'8px 6px' } }, oc.project_id
                ? h('span', { style:{ color:'var(--blue)', cursor:'pointer' }, onClick:()=>onNav('project_detail', oc.project_id) }, (projects||[]).find(p=>p.id===oc.project_id)?.name || oc.project_id)
                : h('span', { style:{ color:'var(--t3)' } }, 'Independiente')),
              h('td', { style:{ padding:'8px 6px' } }, oc.fecha || '—'),
              h('td', { style:{ padding:'8px 6px', textAlign:'right' } }, oc.total!=null ? fmt(oc.total) : '—'),
              h('td', { style:{ padding:'8px 6px' } }, oc.__legacy ? 'Legacy' : (ESTATUS_LABELS[oc.status]||oc.status)),
              h('td', { style:{ padding:'8px 6px' } }, oc.__legacy ? 'Legacy' : (oc.project_id?'Ligada':'Independiente')),
              h('td', { style:{ padding:'8px 6px' } }, oc.__legacy ? '—' : firmaStatusDeOC(oc)),
              h('td', { style:{ padding:'8px 6px', display:'flex', gap:6, flexWrap:'wrap' } },
                h('button', { onClick:()=>descargarPDF(oc), style:{ fontSize:11 } }, '📄 PDF'),
                !oc.__legacy && oc.status==='borrador' && h('button', { onClick:()=>enviarAFirma(oc), style:{ fontSize:11, color:'var(--blue)' } }, '✍ Enviar a firma'),
                !oc.__legacy && isAdmin && oc.status!=='cancelada' && oc.status!=='cerrada' && h('button', { onClick:()=>cancelar(oc), style:{ fontSize:11, color:'var(--red)' } }, '✕ Cancelar'),
              ),
            ))),
          ),
        ),
    showNueva && h(ModalNuevaOC, { companies, onClose:()=>setShowNueva(false), onCreated: async ()=>{ setShowNueva(false); await cargar(); }, projects }),
  );
}

function ModalNuevaOC({ companies, onClose, onCreated, projects }) {
  const [ligarProyecto, setLigarProyecto] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [empresaNombre, setEmpresaNombre] = useState((companies&&companies[0]&&companies[0].name)||'');
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [proveedorRfc, setProveedorRfc] = useState('');
  const [proveedorEmail, setProveedorEmail] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [partidas, setPartidas] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const agregarPartida = (tipo) => setPartidas(p => [...p, { id:'p'+(p.length+1)+'-'+Date.now(), tipo, descripcion:'', cantidad:1, precioUnit:0, proveedor:'' }]);
  const updPartida = (id,k,v) => setPartidas(p => p.map(x=>x.id===id?{...x,[k]:v}:x));
  const removePartida = id => setPartidas(p => p.filter(x=>x.id!==id));

  const totales = calcularTotales(partidas);

  const guardar = async () => {
    if (!proveedorNombre.trim()) { alert('El nombre del proveedor es obligatorio.'); return; }
    if (partidas.length === 0) { alert('Agrega al menos una partida.'); return; }
    setGuardando(true);
    try {
      const proyecto = ligarProyecto ? (projects||[]).find(p=>p.id===projectId) : null;
      if (ligarProyecto && !proyecto) { alert('Selecciona un proyecto válido.'); setGuardando(false); return; }
      if (ligarProyecto && !proyecto.folioProyecto) { alert('Ese proyecto no tiene folio maestro todavía -- no se puede ligar una OC.'); setGuardando(false); return; }
      const payload = {
        project_id: ligarProyecto ? projectId : null,
        company_id: (companies||[]).find(c=>c.name===empresaNombre)?.id || null,
        proveedor_nombre: proveedorNombre, proveedor_rfc: proveedorRfc, proveedor_email: proveedorEmail,
        fecha, moneda: 'MXN', subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
        partidas, condiciones: [],
        empresaNombre, // solo para calcular el prefijo del folio, no se persiste como columna
        folioProyecto: ligarProyecto ? proyecto.folioProyecto : undefined,
      };
      await createPurchaseOrder(payload);
      onCreated();
    } catch(e) { alert('No se pudo crear la Orden de Compra: ' + e.message); }
    setGuardando(false);
  };

  return h('div', { style:{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 } },
    h('div', { style:{ background:'var(--bg1)', borderRadius:'var(--rl)', padding:20, maxWidth:640, width:'100%', maxHeight:'90vh', overflowY:'auto' } },
      h('div', { style:{ fontSize:16, fontWeight:600, marginBottom:14 } }, 'Nueva Orden de Compra'),
      h('label', { style:{ display:'flex', alignItems:'center', gap:8, marginBottom:12, fontSize:13 } },
        h('input', { type:'checkbox', checked:ligarProyecto, onChange:e=>setLigarProyecto(e.target.checked) }), 'Ligar a un proyecto existente',
      ),
      ligarProyecto && h('select', { value:projectId, onChange:e=>setProjectId(e.target.value), style:{ width:'100%', marginBottom:10 } },
        h('option', { value:'' }, 'Selecciona un proyecto...'),
        (projects||[]).filter(p=>p.folioProyecto).map(p => h('option', { key:p.id, value:p.id }, p.name+' ('+p.folioProyecto+')')),
      ),
      h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:12 } },
        h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Empresa compradora'),
          h('select', { value:empresaNombre, onChange:e=>setEmpresaNombre(e.target.value), style:{ width:'100%' } }, (companies||[]).map(c=>h('option', { key:c.id, value:c.name }, c.name)))),
        h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Proveedor *'), h('input', { value:proveedorNombre, onChange:e=>setProveedorNombre(e.target.value), style:{ width:'100%' } })),
        h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'RFC proveedor'), h('input', { value:proveedorRfc, onChange:e=>setProveedorRfc(e.target.value), style:{ width:'100%' } })),
        h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Correo proveedor'), h('input', { value:proveedorEmail, onChange:e=>setProveedorEmail(e.target.value), style:{ width:'100%' } })),
        h('div', null, h('div', { style:{ fontSize:10, color:'var(--t3)', marginBottom:3 } }, 'Fecha'), h('input', { type:'date', value:fecha, onChange:e=>setFecha(e.target.value), style:{ width:'100%' } })),
      ),
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:8 } }, 'Partidas'),
      h('div', { style:{ display:'flex', gap:8, marginBottom:10 } },
        h('button', { onClick:()=>agregarPartida('equipo'), style:{ fontSize:11 } }, '+ Producto/equipo'),
        h('button', { onClick:()=>agregarPartida('servicio'), style:{ fontSize:11 } }, '+ Servicio'),
        h('button', { onClick:()=>agregarPartida('otro'), style:{ fontSize:11 } }, '+ Partida libre'),
      ),
      partidas.map(p => h('div', { key:p.id, style:{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', padding:'8px 10px', marginBottom:6, border:'.5px solid var(--b2)', borderRadius:'var(--r)' } },
        h('span', { style:{ fontSize:10, color:'var(--t3)', width:60 } }, p.tipo),
        h('input', { value:p.descripcion, onChange:e=>updPartida(p.id,'descripcion',e.target.value), placeholder:'Descripción', style:{ flex:2, fontSize:12, minWidth:120 } }),
        h('input', { type:'number', value:p.cantidad, onChange:e=>updPartida(p.id,'cantidad',Number(e.target.value)||0), placeholder:'Cant.', style:{ width:60, fontSize:12 } }),
        h('input', { type:'number', value:p.precioUnit, onChange:e=>updPartida(p.id,'precioUnit',Number(e.target.value)||0), placeholder:'P.Unit', style:{ width:90, fontSize:12 } }),
        h('input', { value:p.proveedor, onChange:e=>updPartida(p.id,'proveedor',e.target.value), placeholder:'Proveedor (opcional)', style:{ flex:1, fontSize:12, minWidth:100 } }),
        h('button', { onClick:()=>removePartida(p.id), style:{ fontSize:11, color:'var(--red)' } }, '✕'),
      )),
      h('div', { style:{ textAlign:'right', fontSize:12, marginTop:10, marginBottom:14 } },
        h('div', null, 'Subtotal: ', fmt(totales.subtotal)),
        h('div', null, 'IVA (16%): ', fmt(totales.iva)),
        h('div', { style:{ fontWeight:700 } }, 'Total: ', fmt(totales.total)),
      ),
      h('div', { style:{ display:'flex', justifyContent:'flex-end', gap:8 } },
        h('button', { onClick:onClose }, 'Cancelar'),
        h('button', { className:'bp', disabled:guardando, onClick:guardar }, guardando?'Guardando...':'Crear Orden de Compra'),
      ),
    ),
  );
}
