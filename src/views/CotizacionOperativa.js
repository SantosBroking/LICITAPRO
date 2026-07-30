// CotizacionOperativa.js — Fase 2A4: vista operativa de Cotización para
// empleados. No incluir datos internos ni cálculos reservados.
//
// Deliberadamente separada de Cotizacion.js (CotizacionTab, admin-only) —
// ver diagnóstico de Fase 2A4: CotizacionTab recalcula cifras internas en
// cada edición, y sus campos operativos/reservados viven entrelazados en
// el mismo bloque de render. Reutilizarla con datos reducidos produciría
// resultados incorrectos, no solo un riesgo de confidencialidad.
//
// Este archivo nunca debe:
// - importar el motor de cálculo de cotización, la generación de PDF, el
//   flujo de firmas, ni el analizador/agente de IA;
// - leer, mostrar ni editar ningún dato reservado, ni condiciones internas
//   de venta;
// - mostrar botones de exportación reservada, IA con acceso reservado, ni flujo de
//   aprobación de compra.
//
// project que recibe ya viene saneado por App.js (sanitizeProjectForRole)
// antes de llegar aquí — este componente no necesita sanear nada por su
// cuenta, pero tampoco debe asumir que puede leer datos reservados si
// alguna vez cambiara ese contrato.

import { h, useState, useEffect } from '../lib/core.js';
import { StorageImg, NumInput } from '../ui/primitives.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js';
import { TODAY } from '../lib/utils.js';
import { createInboxItem, listInboxItems } from '../lib/supabase.js';
import { INBOX_PRIORIDADES, INBOX_PRIORIDAD_LABELS, INBOX_ACCIONES, INBOX_ACCION_LABELS } from '../lib/constants.js';

// Microfix (limpieza UI): 'resumen' ya no es una sub-pestaña ni una franja
// informativa aparte -- se eliminó por completo (repetía el encabezado del
// proyecto ya visible arriba, en Projects.js). Cotización Operativa muestra
// solo tabs → Partidas/Equipo → contenido, sin resumen propio.
const SUBTABS = ['partidas', 'equipo'];
const SUBTAB_LABELS = { partidas: 'Partidas', equipo: 'Equipo' };

// Partida nueva — Fase 2F1A: se agrega costoMSMS/precioLista (costo de
// origen/proveedor, ahora visible/editable para empleado operativo) y
// precioPropuesto (precio de venta PROPUESTO/borrador, nuevo campo, nunca
// alimenta calc.js ni el cálculo oficial de utilidad/margen -- ver
// PARTIDA_CAMPOS_ESTRATEGICOS en data_sanitize.js, que sigue admin-only).
const makePartidaOperativa = (id) => ({ id, activo:false, tipo:'', marca:'', modelo:'', ano:new Date().getFullYear(), version:'', color:'', cantidad:0, vehiculoId:null, foto:'', costoMSMS:0, precioLista:0, precioPropuesto:0 });

export default function CotizacionOperativa({ project, onUpdate, activeTab, setActiveTab, user, logFn }) {
  const [_localTab, _setLocalTab] = useState('partidas');
  // Hotfix -- `tab` SIEMPRE debe ser uno de SUBTABS ('partidas'|'equipo'),
  // nunca un valor legacy/inválido (ej. 'resumen', que dejó de existir en
  // el microfix de limpieza de UI) -- si eso llegara a colarse por
  // cualquier motivo (subTabs con un valor viejo persistido, timing entre
  // proyectos, etc.), ANTES no coincidía con ninguna de las dos ramas de
  // render y la pantalla quedaba en blanco debajo de la barra de tabs, sin
  // ningún error visible. Ahora se autocorrige aquí mismo, sin depender
  // solo de que App.js/sanitizeSubTab lo haya saneado antes de llegar.
  const tabCrudo = activeTab || _localTab;
  const tab = SUBTABS.includes(tabCrudo) ? tabCrudo : 'partidas';
  const setTab = (t) => { _setLocalTab(t); if (setActiveTab) setActiveTab(t); };
  const [showCat, setShowCat] = useState(false);
  const [catSel, setCatSel] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [ultimoEstatusInbox, setUltimoEstatusInbox] = useState(null);
  const [showModalRevision, setShowModalRevision] = useState(false);

  // Hotfix -- soporta cotizaciones MÍNIMAS: { equipo, partidas,
  // estatusRevision } y nada más (sin folio/vendedor/agenciaProveedor/etc.)
  // -- ninguno de esos campos se lee en este archivo salvo con fallback
  // (`cot.folio||'—'`), así que su ausencia nunca debería tronar; se
  // valida explícitamente con Array.isArray() en vez de solo `|| []`, que
  // no protege si el campo viniera con una forma inesperada (objeto en
  // vez de arreglo, por ejemplo). `project` puede llegar undefined/null
  // (proyecto no encontrado, timing, etc.) -- estas constantes usan
  // encadenamiento opcional para nunca tronar en ese caso; el mensaje
  // claro (en vez de renderizar contenido con datos inexistentes) se
  // muestra más abajo, DESPUÉS de todos los hooks (nunca antes -- un
  // return condicional antes de un hook rompe el orden de hooks de React
  // si `project` cambia de undefined a definido entre renders).
  const cot = project?.cotizacion || {};
  const partidas = Array.isArray(cot.partidas) ? cot.partidas : [];
  const equipo = Array.isArray(cot.equipo) ? cot.equipo : [];

  // Fase 2F3: el estatus REAL de revisión vive en inbox_items (fuente de
  // verdad), no en cot.estatusRevision (que es solo un eco local para
  // feedback inmediato al enviar). Se consulta el pendiente más reciente
  // de este proyecto para reflejar aprobaciones/rechazos/cambios
  // solicitados que el admin haya resuelto desde el Inbox.
  useEffect(() => {
    if (!project) return; // hotfix -- sin proyecto, nada que consultar
    let cancelado = false;
    listInboxItems()
      .then(({ items }) => {
        if (cancelado) return;
        const propios = (items||[]).filter(i => i.project_id===project.id && i.type==='cotizacion_revision');
        if (propios.length) {
          propios.sort((a,b) => new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at));
          setUltimoEstatusInbox(propios[0].status);
        }
      })
      .catch(e => console.error('[CotizacionOperativa] No se pudo consultar el estatus de revisión:', e));
    return () => { cancelado = true; };
  }, [project?.id]);

  // Hotfix -- ahora sí, DESPUÉS de todos los hooks: si `project` llega
  // undefined/null, se muestra un mensaje claro en vez de intentar leer
  // sus campos o renderizar contenido inexistente.
  if (!project) {
    return h('div', { className:'empty' }, h('p', null, 'No se pudo cargar este proyecto. Vuelve a Proyectos e inténtalo de nuevo.'));
  }

  const estatusMostrado = ultimoEstatusInbox || cot.estatusRevision || 'borrador';
  const ESTATUS_LABELS = { borrador:'Borrador', pendiente:'Enviada, en espera', en_revision:'En revisión', cambios_solicitados:'Cambios solicitados', aprobado:'Aprobada', rechazado:'Rechazada', revisado:'Revisada' };
  const ESTATUS_COLORES = { borrador:{bg:'var(--bg2)',tx:'var(--t2)'}, pendiente:{bg:'#E6F1FB',tx:'#1A4480'}, en_revision:{bg:'#E6F1FB',tx:'#1A4480'}, cambios_solicitados:{bg:'#FAEEDA',tx:'#633806'}, aprobado:{bg:'#E1F5EE',tx:'#085041'}, rechazado:{bg:'#FCEBEB',tx:'#791F1F'}, revisado:{bg:'#E1F5EE',tx:'#085041'} };

  // No se ejecuta ningún cálculo reservado aquí -- App.js decide si hace
  // falta recalcular el monto estimado tras el merge seguro (Fase 2A4, Commit 4).
  const updCot = (newCot) => { onUpdate({ ...project, cotizacion: newCot }); };

  const updPartida = (id, k, v) => updCot({ ...cot, partidas: partidas.map(p => p.id===id ? {...p,[k]:v} : p) });

  // Fase 2F3 + 2G: "Enviar a revisión" -- crea un pendiente en el Inbox
  // (tabla separada, ver sql/2f3_inbox_items.sql) con SOLO una referencia
  // liviana (folio, nombre de proyecto, conteo de partidas/equipo) + los
  // campos robustos que el modal recolecta (prioridad/mensaje/acción/
  // referencia opcional) -- NUNCA un snapshot de la cotización completa
  // (misma lección de firmas[].proyecto, Fase 2E). Actualiza
  // cot.estatusRevision como eco local inmediato.
  const enviarARevision = async ({ prioridad, mensaje, accionSolicitada, referenciaTipo, referenciaId, referenciaLabel }) => {
    setEnviando(true);
    try {
      await createInboxItem({
        type: 'cotizacion_revision',
        title: 'Cotización de "'+(project.name||'proyecto sin nombre')+'" lista para revisión',
        message: (mensaje && mensaje.trim()) || ('Folio: '+(cot.folio||'—')+' · '+partidas.filter(p=>p.activo).length+' partida(s) · '+equipo.length+' equipo(s).'),
        project_id: project.id,
        data: {
          folio: cot.folio||'', proyectoNombre: project.name||'',
          partidasActivas: partidas.filter(p=>p.activo).length, equipoCount: equipo.length,
          prioridad: prioridad || 'media',
          ...(accionSolicitada ? { accionSolicitada } : {}),
          ...(referenciaTipo ? { referenciaTipo, referenciaId, referenciaLabel } : {}),
          source: 'cotizacion_operativa',
        },
      });
      updCot({ ...cot, estatusRevision: 'en_revision' });
      setUltimoEstatusInbox('en_revision');
      if (logFn) logFn(user, 'envió a revisión', 'cotización', project.id, project.name||'');
      setShowModalRevision(false);
    } catch(e) { alert('No se pudo enviar a revisión: ' + e.message); }
    setEnviando(false);
  };

  // Fase 2F1A: catálogo de EQUIPO disponible para agregar -- mismo criterio
  // de construcción que Cotizacion.js (base + personalizados del config,
  // sin ocultos, sin vehículos), solo lectura, no se modifica el catálogo
  // desde aquí (crear/editar productos sigue siendo exclusivo de Catalog.js,
  // admin-only, sin cambios).
  const hiddenProds = window._lpConfig?.hiddenProducts || [];
  const customProds = (window._lpConfig?.customProducts || []).filter(x => !x.esVehiculo);
  const overridesEquipo = {};
  customProds.forEach(p => { if (CATALOG_PRODUCTS.find(x=>x.id===p.id)) overridesEquipo[p.id]=p; });
  const catalogEquipoDisponible = [
    ...CATALOG_PRODUCTS.filter(p=>!hiddenProds.includes(p.id)).map(p=>overridesEquipo[p.id]||p),
    ...customProds.filter(p=>!CATALOG_PRODUCTS.find(x=>x.id===p.id)),
  ];
  const catsEquipo = [...new Set(catalogEquipoDisponible.map(p=>p.cat))];
  const catSelActual = catSel || catsEquipo[0] || null;

  // Proveedor no se persiste en el equipo de la cotización (mismo shape que
  // Cotizacion.js/admin) -- se busca en vivo contra el catálogo por
  // productoId, solo para mostrarlo aquí. No cambia el shape guardado.
  const provDeProducto = (productoId) => catalogEquipoDisponible.find(p=>p.id===productoId)?.prov || '—';

  const addEquipoDesdeCatalogo = (prod) => {
    if (equipo.some(e=>e.productoId===prod.id)) return;
    updCot({ ...cot, equipo:[...equipo, {
      id:'EQ'+Date.now(), productoId:prod.id, nombre:prod.nom, cat:prod.cat,
      marca:'', modelo:'', unidad:'pz', usar:true, vis:prod.vis,
      costoConIVA:prod.price||0, llevaIVA:prod.cat!=='08 Mano de obra',
      cnts:new Array(partidas.length).fill(0), est:'Estimado', fechaCosto:TODAY(), notas:'',
      precioPropuesto:0,
    }] });
  };
  const removeEquipoDesdeCatalogo = (eid) => updCot({ ...cot, equipo: equipo.filter(e=>e.id!==eid) });

  // Agregar SÍ es seguro (confirmado en Fase 2A2: una partida nueva se
  // guarda sin ningún dato reservado, nunca inventado). Quitar NO se
  // implementa en este commit -- sanitizeProjectUpdateForRole preserva
  // conservadoramente cualquier partida del original ausente del incoming
  // (decisión documentada desde 2A2), así que un "quitar" aquí se
  // revertiría solo en el guardado. Se documenta como pendiente real, no
  // se implementa a medias.
  const addPartida = () => {
    const nums = partidas.map(p => parseInt((p.id||'').replace('P',''))).filter(n => !isNaN(n));
    const next = nums.length ? Math.max(...nums)+1 : partidas.length+1;
    const nueva = makePartidaOperativa('P'+next);
    // Mismo comportamiento que Cotizacion.js: extender cnts de cada equipo
    // para mantenerlo alineado por posición con el arreglo de partidas.
    const equipoActualizado = equipo.map(e => ({ ...e, cnts:[...(e.cnts||new Array(partidas.length).fill(0)), 0] }));
    updCot({ ...cot, partidas:[...partidas, nueva], equipo:equipoActualizado });
  };

  // Selector de vehículo del catálogo — mismo selector visual que admin
  // (confirmado sin datos reservados en la tarjeta), pero copiando SOLO
  // campos operativos.
  const catalogVehiculos = [...(window._lpConfig?.customProducts||[])].filter(x=>x.esVehiculo);
  const selectVehiculo = (pid, veh) => updCot({ ...cot, partidas: partidas.map(p => p.id!==pid ? p : {
    ...p,
    vehiculoId: veh ? veh.id : null, foto: veh ? (veh.photo||'') : '',
    tipo: veh ? (veh.v_tipo||p.tipo) : p.tipo, marca: veh ? (veh.v_marca||'') : p.marca,
    modelo: veh ? (veh.v_modelo||'') : p.modelo, version: veh ? (veh.v_version||'') : p.version,
    ano: veh ? (Number(veh.v_ano)||p.ano) : p.ano,
  })});

  const updEquipo = (eid, k, v) => updCot({ ...cot, equipo: equipo.map(e => e.id===eid ? {...e,[k]:v} : e) });
  const updCnts = (eid, pi, v) => updCot({ ...cot, equipo: equipo.map(e => {
    if (e.id!==eid) return e;
    const cnts = [...(e.cnts||new Array(partidas.length).fill(0))];
    cnts[pi] = Number(v)||0;
    return { ...e, cnts };
  })});
  // "Todas" — aplica ese equipo a TODAS las partidas existentes: cantidad
  // mínima 1 donde esté en 0/vacío, sin bajar ninguna que ya tuviera más de
  // 1. Solo toca `cnts` -- nunca costoConIVA/precioPropuesto/proveedor ni
  // ningún otro campo del equipo. El índice usa el mismo criterio de
  // numeración (P-número - 1) que ya usa updCnts/la tabla de abajo, para
  // que quede alineado con TODAS las partidas (activas o no), no solo las
  // filtradas visualmente.
  const aplicarEquipoATodasLasPartidas = (eid) => updCot({ ...cot, equipo: equipo.map(e => {
    if (e.id!==eid) return e;
    const cnts = [...(e.cnts||new Array(partidas.length).fill(0))];
    partidas.forEach(p => {
      const pi = parseInt((p.id||'').replace('P',''), 10) - 1;
      if (isNaN(pi) || pi < 0) return;
      const actual = cnts[pi] || 0;
      cnts[pi] = actual > 1 ? actual : 1;
    });
    return { ...e, cnts };
  })});

  return h('div', null,
    // Fase 2F3: estatus de revisión + botón "Enviar a revisión" -- franja
    // compacta, no una sub-pestaña (mismo criterio que el microfix de
    // limpieza de Cotización Operativa: nada de resúmenes repetidos).
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 } },
      h('span', { style:{ fontSize:11, padding:'4px 12px', borderRadius:12, background:(ESTATUS_COLORES[estatusMostrado]||ESTATUS_COLORES.borrador).bg, color:(ESTATUS_COLORES[estatusMostrado]||ESTATUS_COLORES.borrador).tx, fontWeight:500 } }, 'Estatus: '+(ESTATUS_LABELS[estatusMostrado]||estatusMostrado)),
      h('button', { disabled:enviando, onClick:()=>setShowModalRevision(true), style:{ fontSize:12, padding:'7px 14px', background:'var(--blue)', color:'#fff', border:'none', borderRadius:'var(--r)', cursor:enviando?'wait':'pointer', opacity:enviando?.7:1 } }, enviando?'Enviando...':'Enviar a revisión'),
    ),
    h('div', { style:{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--b1)', overflowX:'auto' } },
      SUBTABS.map(t => h('button', { key:t, className:'tab'+(tab===t?' active':''), onClick:()=>setTab(t), style:{ flexShrink:0, whiteSpace:'nowrap' } }, SUBTAB_LABELS[t]))
    ),

    // ══ Partidas operativas ══
    tab==='partidas' && h('div', null,
      h('div', { style:{ display:'flex', justifyContent:'flex-end', marginBottom:12 } },
        h('button', { onClick:addPartida, style:{ fontSize:12, padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--blue)', color:'var(--blue)', background:'var(--bg1)', cursor:'pointer', fontWeight:500 } }, '+ Partida'),
      ),
      partidas.length===0 && h('div', { className:'empty' }, h('p', null, 'Sin partidas todavía.')),
      partidas.map(p => h('div', { key:p.id, className:'card', style:{ marginBottom:8, borderLeft:p.activo?'3px solid var(--blue)':'3px solid transparent', opacity:p.activo?1:.5 } },
        h('div', { style:{ display:'flex', alignItems:'center', gap:10, marginBottom:p.activo?12:0 } },
          h('input', { type:'checkbox', checked:p.activo, onChange:e=>updPartida(p.id,'activo',e.target.checked), style:{ width:15, height:15, cursor:'pointer', accentColor:'var(--blue)' } }),
          p.foto ? h(StorageImg, { src:p.foto, style:{ width:36, height:28, objectFit:'contain', borderRadius:4, flexShrink:0 } })
                 : h('span', { style:{ fontSize:10, color:'var(--t3)', padding:'2px 6px', background:'var(--bg2)', borderRadius:4 } }, '🚗 sin seleccionar'),
          h('span', { style:{ fontWeight:600, fontSize:14, color:p.activo?'var(--blue)':'var(--t3)' } }, p.id),
          p.activo && p.cantidad>0 && p.tipo && h('span', { style:{ fontSize:12, color:'var(--t2)' } }, p.cantidad,' × ',p.tipo,' ',p.marca,' ',p.modelo),
          !p.activo && h('span', { style:{ fontSize:12, color:'var(--t3)' } }, 'Inactiva'),
        ),
        p.activo && h('div', null,
          catalogVehiculos.length > 0 && h('div', { style:{ marginBottom:12 } },
            h('div', { style:{ fontSize:10, color:'var(--t2)', fontWeight:600, marginBottom:6 } }, 'Modelo de vehículo (catálogo)'),
            h('div', { style:{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 } },
              catalogVehiculos.map(veh => {
                const sel = p.vehiculoId === veh.id;
                return h('div', { key:veh.id, onClick:()=>selectVehiculo(p.id, sel?null:veh),
                  style:{ flexShrink:0, width:90, cursor:'pointer', borderRadius:10, border:'2px solid '+(sel?'var(--blue)':'var(--b2)'),
                    background:sel?'var(--blue-bg)':'var(--bg1)', padding:6, textAlign:'center' } },
                  veh.photo
                    ? h(StorageImg, { src:veh.photo, style:{ width:56, height:44, objectFit:'contain', borderRadius:6, display:'block', margin:'0 auto 4px' } })
                    : h('div', { style:{ width:56, height:44, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, margin:'0 auto 4px' } }, '🚗'),
                  h('div', { style:{ fontSize:9, fontWeight:sel?600:400, color:sel?'var(--blue)':'var(--t1)', lineHeight:1.2, wordBreak:'break-word' } },
                    veh.nom || (veh.v_marca+' '+veh.v_modelo)),
                );
              }),
            ),
          ),
          h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:8, marginBottom:8 } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Tipo de vehículo'),
              h('select', { value:p.tipo||'', onChange:e=>updPartida(p.id,'tipo',e.target.value), style:{ fontSize:12, padding:'5px 7px' } },
                h('option', { value:'' }, '— Seleccionar —'),
                ['Pickup patrulla','Sedán patrulla','SUV patrulla','SUV mando','Pickup especial','Sedan administrativo','Furgoneta','Motocicleta','Otro'].map(o=>h('option',{key:o},o))
              )
            ),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Marca'), h('input', { value:p.marca||'', onChange:e=>updPartida(p.id,'marca',e.target.value), style:{ fontSize:12 }, placeholder:'Ford' })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Modelo'), h('input', { value:p.modelo||'', onChange:e=>updPartida(p.id,'modelo',e.target.value), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Año'), h('input', { type:'number', value:p.ano||'', onChange:e=>updPartida(p.id,'ano',Number(e.target.value)), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Versión'), h('input', { value:p.version||'', onChange:e=>updPartida(p.id,'version',e.target.value), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Color'), h('input', { value:p.color||'', onChange:e=>updPartida(p.id,'color',e.target.value), style:{ fontSize:12 }, placeholder:'Ej: Blanco' })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Cantidad'), h(NumInput, { value:p.cantidad, onChange:v=>updPartida(p.id,'cantidad',v), style:{ fontSize:13, padding:'6px 8px', fontWeight:500 } })),
          ),
          // Fase 2F1A: costo de origen/proveedor y precio de venta propuesto
          // -- visibles/editables para empleado operativo. Nunca se muestra
          // ni se calcula margen/utilidad aquí.
          h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8, marginTop:4, paddingTop:10, borderTop:'.5px dashed var(--b3)' } },
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Costo de origen (proveedor)'), h(NumInput, { value:p.costoMSMS||0, onChange:v=>updPartida(p.id,'costoMSMS',v), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, 'Precio de lista (catálogo)'), h(NumInput, { value:p.precioLista||0, onChange:v=>updPartida(p.id,'precioLista',v), style:{ fontSize:12 } })),
            h('div', null, h('div', { style:{ fontSize:10, color:'var(--blue)', marginBottom:2, fontWeight:600 } }, 'Precio de venta propuesto'), h(NumInput, { value:p.precioPropuesto||0, onChange:v=>updPartida(p.id,'precioPropuesto',v), style:{ fontSize:12, fontWeight:500 } })),
          ),
        ),
      )),
    ),

    // ══ Equipo operativo — Fase 2F1A + microfix de layout: misma
    // estructura visual que Cotizacion.js/admin (tabla única: Usar | Todas |
    // Producto | Costo | Precio | cantidades por partida | IVA | Estatus |
    // quitar), con el mismo criterio de columnas seguras que ya definió
    // data_sanitize.js (EQUIPO_CAMPOS_COSTO_PROVEEDOR: costoConIVA/llevaIVA/
    // est/fechaCosto -- todos ya visibles/editables para operativo desde
    // Fase 2F1A). Deliberadamente SIN replicar: el panel "Cotización de
    // solo equipamiento" (soloEquipo/modoEquipo/margenEquipo/montoGanar) ni
    // la columna "Margen %" (margenPropio) -- son 100% estratégicos, admin-only,
    // nunca deben aparecer aquí. ══
    tab==='equipo' && h('div', null,
      h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 } },
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Cantidades = por unidad del vehículo'),
        h('button', { onClick:()=>setShowCat(!showCat), style:{ fontSize:12, color:'var(--blue)', border:'.5px solid var(--blue)44', padding:'5px 12px', borderRadius:'var(--r)', background:'transparent', cursor:'pointer' } }, showCat?'Ocultar catálogo':'+ Del catálogo'),
      ),
      showCat && h('div', { className:'card', style:{ marginBottom:12 } },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:8 } }, 'Catálogo — clic en + para agregar'),
        h('div', { style:{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:8 } },
          catsEquipo.map(c=>h('button',{key:c,style:{fontSize:11,padding:'4px 10px',background:catSelActual===c?'var(--t1)':'transparent',color:catSelActual===c?'var(--bg1)':'var(--t2)',border:'.5px solid var(--b2)',borderRadius:'var(--r)',cursor:'pointer'},onClick:()=>setCatSel(c)},c)),
        ),
        h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:6 } },
          catalogEquipoDisponible.filter(p=>p.cat===catSelActual).map(prod=>{
            const ya = equipo.some(e=>e.productoId===prod.id);
            return h('div', { key:prod.id, style:{ padding:'7px 10px', background:ya?'#E1F5EE':'var(--bg2)', borderRadius:'var(--r)', border:'.5px solid var(--b3)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 } },
              h('div', { style:{ minWidth:0 } },
                h('div', { style:{ fontSize:12, fontWeight:ya?500:400, color:ya?'#085041':'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, prod.nom),
                h('div', { style:{ fontSize:10, color:'var(--t2)' } }, (prod.prov||'—'), prod.price ? ' · $'+Number(prod.price).toLocaleString('es-MX') : ''),
              ),
              h('button', { onClick:()=>ya?removeEquipoDesdeCatalogo(equipo.find(e=>e.productoId===prod.id)?.id):addEquipoDesdeCatalogo(prod), style:{ fontSize:12, padding:'3px 8px', flexShrink:0, color:ya?'#085041':'var(--t1)', fontWeight:ya?500:400, border:'none', background:'transparent', cursor:'pointer' } }, ya?'✓':'+'),
            );
          }),
        ),
      ),
      equipo.length===0 && h('div', { className:'card', style:{ textAlign:'center', padding:'30px', color:'var(--t2)', fontSize:13 } }, 'Sin equipo. Abre el catálogo arriba.'),
      equipo.length > 0 && h('div', { className:'card' }, h('div', { className:'tbl-scroll' },
        h('table', { style:{ fontSize:12, minWidth:700 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:30 } }, 'Usar'),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:60 } }, 'Todas'),
            h('td', { style:{ padding:'6px 8px', color:'var(--t2)', fontSize:10 } }, 'Producto'),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:95 } }, 'Costo proveedor'),
            h('td', { style:{ padding:'6px 4px', color:'var(--blue)', fontSize:10, width:95 } }, 'Precio propuesto'),
            ...partidas.filter(p=>p.activo).map(p=>h('td',{key:p.id,style:{padding:'6px 4px',color:'var(--blue)',fontSize:10,width:52,textAlign:'center'}},p.id,h('br'),h('span',{style:{fontSize:9,color:'var(--t3)'}},p.cantidad,' uds'))),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:38, textAlign:'center' } }, 'IVA'),
            h('td', { style:{ padding:'6px 4px', color:'var(--t2)', fontSize:10, width:115 } }, 'Estatus'),
            h('td', { style:{ padding:'6px 4px', width:24 } }),
          )),
          h('tbody', null, [...equipo].sort((a,b)=>(a.cat||'').localeCompare(b.cat||'','es',{numeric:true})).map(e => {
            const estBg = e.est==='Confirmado'?'#E1F5EE':e.est==='Vencido'?'#FCEBEB':'#FAEEDA';
            const estTx = e.est==='Confirmado'?'#085041':e.est==='Vencido'?'#791F1F':'#633806';
            return h('tr', { key:e.id, style:{ borderBottom:'.5px solid var(--b3)', opacity:e.usar?1:.45 } },
              h('td', { style:{ padding:'6px 4px', textAlign:'center' } },
                h('input', { type:'checkbox', checked:e.usar, onChange:ev=>updEquipo(e.id,'usar',ev.target.checked), style:{ width:14, height:14, accentColor:'var(--blue)' } }),
              ),
              h('td', { style:{ padding:'4px 4px', textAlign:'center' } },
                h('button', { onClick:()=>aplicarEquipoATodasLasPartidas(e.id), title:'Poner cantidad 1 en todas las partidas que estén en 0, sin bajar las que ya tengan más',
                  style:{ fontSize:10, padding:'2px 7px', borderRadius:6, border:'1px solid var(--blue-border)', color:'var(--blue)', background:'transparent', cursor:'pointer', whiteSpace:'nowrap' } }, '✓ Todas'),
              ),
              h('td', { style:{ padding:'6px 8px' } },
                h('div', { style:{ fontWeight:e.usar?500:400 } }, e.nombre),
                h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:2 } }, e.cat),
                h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:4 } }, 'Proveedor: ', provDeProducto(e.productoId)),
                h('div', { style:{ display:'flex', gap:4, flexWrap:'wrap' } },
                  h('input', { value:e.marca||'', onChange:ev=>updEquipo(e.id,'marca',ev.target.value), placeholder:'Marca', style:{ fontSize:10, padding:'2px 5px', width:80, border:'1px solid var(--b2)', borderRadius:5 } }),
                  h('input', { value:e.modelo||'', onChange:ev=>updEquipo(e.id,'modelo',ev.target.value), placeholder:'Modelo', style:{ fontSize:10, padding:'2px 5px', width:90, border:'1px solid var(--b2)', borderRadius:5 } }),
                  h('input', { value:e.unidad||'pz', onChange:ev=>updEquipo(e.id,'unidad',ev.target.value), placeholder:'Unidad', style:{ fontSize:10, padding:'2px 5px', width:44, border:'1px solid var(--b2)', borderRadius:5 } }),
                ),
              ),
              h('td', { style:{ padding:'6px 4px' } }, h(NumInput, { value:e.costoConIVA||0, onChange:v=>updEquipo(e.id,'costoConIVA',v), style:{ width:90, fontSize:11, padding:'3px 5px' } })),
              h('td', { style:{ padding:'6px 4px' } }, h(NumInput, { value:e.precioPropuesto||0, onChange:v=>updEquipo(e.id,'precioPropuesto',v), style:{ width:90, fontSize:11, padding:'3px 5px', fontWeight:500 } })),
              ...partidas.filter(p=>p.activo).map(p => { const pi=parseInt((p.id||'').replace('P',''))-1; return h('td',{key:p.id,style:{padding:'6px 4px',textAlign:'center'}}, h(NumInput,{value:(e.cnts&&e.cnts[pi])||0,onChange:v=>updCnts(e.id,pi,v),style:{width:46,fontSize:11,padding:'3px 4px',textAlign:'center'}})); }),
              h('td', { style:{ padding:'6px 4px', textAlign:'center' } }, h('input', { type:'checkbox', checked:e.llevaIVA, onChange:ev=>updEquipo(e.id,'llevaIVA',ev.target.checked), style:{ width:14, height:14 } })),
              h('td', { style:{ padding:'6px 4px' } },
                h('select', { value:e.est||'Estimado', onChange:ev=>updEquipo(e.id,'est',ev.target.value), style:{ fontSize:10, padding:'3px 5px', background:estBg, color:estTx, border:'none', borderRadius:8, cursor:'pointer', width:'100%' } },
                  ['Confirmado','Estimado','Heredado','Pendiente MSM','Vencido'].map(o=>h('option',{key:o},o))
                ),
              ),
              h('td', { style:{ padding:'6px 4px' } }, h('button', { onClick:()=>removeEquipoDesdeCatalogo(e.id), style:{ background:'transparent', border:'none', color:'var(--red)', cursor:'pointer', fontSize:14, padding:'2px 4px' } }, '×')),
            );
          })),
        ),
      )),
    ),
    showModalRevision && h(ModalEnviarRevision, {
      partidasActivas: partidas.filter(p=>p.activo), equipo, enviando,
      onCancel:()=>setShowModalRevision(false), onSubmit:enviarARevision,
    }),
  );
}

// Fase 2G — modal simple para "Enviar a revisión": prioridad, mensaje,
// acción solicitada, y una referencia opcional (proyecto completo, una
// partida activa específica, o un equipo específico). Nunca manda datos
// financieros -- solo id/etiqueta de la referencia elegida, igual que el
// resto de `data` en inbox_items (allowlist server-side en
// api/inbox-create.js, esto es solo la recolección en UI).
function ModalEnviarRevision({ partidasActivas, equipo, enviando, onCancel, onSubmit }) {
  const [prioridad, setPrioridad] = useState('media');
  const [mensaje, setMensaje] = useState('');
  const [accion, setAccion] = useState('');
  const [referencia, setReferencia] = useState(''); // '' = proyecto completo; 'P:<id>' o 'E:<id>'

  const enviar = () => {
    let referenciaTipo, referenciaId, referenciaLabel;
    if (referencia.startsWith('P:')) {
      const id = referencia.slice(2);
      const p = partidasActivas.find(x=>x.id===id);
      referenciaTipo = 'partida'; referenciaId = id; referenciaLabel = p ? (p.id+' — '+(p.tipo||p.marca||'')) : id;
    } else if (referencia.startsWith('E:')) {
      const id = referencia.slice(2);
      const e = equipo.find(x=>x.id===id);
      referenciaTipo = 'equipo'; referenciaId = id; referenciaLabel = e ? e.nombre : id;
    }
    onSubmit({ prioridad, mensaje, accionSolicitada: accion || undefined, referenciaTipo, referenciaId, referenciaLabel });
  };

  return h('div', { style:{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }, onClick:onCancel },
    h('div', { className:'card', style:{ maxWidth:440, width:'100%', maxHeight:'85vh', overflowY:'auto' }, onClick:e=>e.stopPropagation() },
      h('div', { style:{ fontSize:16, fontWeight:500, marginBottom:14 } }, 'Enviar cotización a revisión'),
      h('div', { style:{ display:'flex', flexDirection:'column', gap:10 } },
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Prioridad'),
          h('select', { value:prioridad, onChange:e=>setPrioridad(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
            INBOX_PRIORIDADES.map(p => h('option', { key:p, value:p }, INBOX_PRIORIDAD_LABELS[p])),
          ),
        ),
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Mensaje para admin'),
          h('textarea', { value:mensaje, onChange:e=>setMensaje(e.target.value), rows:3, placeholder:'Ej: Ya quedó lista, solo falta confirmar el equipo de la partida P2', style:{ fontSize:13, padding:'7px 9px', width:'100%', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical' } }),
        ),
        h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Acción solicitada (opcional)'),
          h('select', { value:accion, onChange:e=>setAccion(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
            h('option', { value:'' }, '—'),
            INBOX_ACCIONES.map(a => h('option', { key:a, value:a }, INBOX_ACCION_LABELS[a])),
          ),
        ),
        (partidasActivas.length>0 || equipo.length>0) && h('div', null,
          h('div', { style:{ fontSize:10, color:'var(--t2)', marginBottom:3 } }, 'Referencia (opcional)'),
          h('select', { value:referencia, onChange:e=>setReferencia(e.target.value), style:{ fontSize:12, padding:'6px 8px', width:'100%', boxSizing:'border-box' } },
            h('option', { value:'' }, 'Cotización completa'),
            partidasActivas.map(p => h('option', { key:'P:'+p.id, value:'P:'+p.id }, 'Partida '+p.id+(p.tipo?' — '+p.tipo:''))),
            equipo.map(e => h('option', { key:'E:'+e.id, value:'E:'+e.id }, 'Equipo — '+e.nombre)),
          ),
        ),
      ),
      h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 } },
        h('button', { onClick:onCancel, style:{ fontSize:12, padding:'7px 14px', background:'transparent', border:'1px solid var(--b2)', borderRadius:6, cursor:'pointer' } }, 'Cancelar'),
        h('button', { disabled:enviando, onClick:enviar, style:{ fontSize:12, padding:'7px 16px', background:'var(--blue)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', opacity:enviando?.7:1 } }, enviando?'Enviando...':'Enviar a revisión'),
      ),
    ),
  );
}
