// Firmas.js — Buzón del flujo de autorizaciones (5 estados)
import { h, useState, useRef } from '../lib/core.js';
import { EmptyState } from '../ui/primitives.js';
import { TODAY } from '../lib/utils.js';
import { getPermissions } from '../lib/permissions.js'; // Fase 1C
import { uploadFileToStorage, abrirArchivo } from '../lib/supabase.js';
import { ESTADO_INFO, aprobar, rechazar, reenviar, subirFirmadoDoc, vistoFinal, devolver,
         avisarFirma, avisarRechazo, avisarVistoFinal, avisarAprobacion } from '../lib/firmas.js';
import { ordenCompraPdfBase64, documentoMembretadoPdfBase64 } from '../lib/pdf_export.js';

const LINK_APP = 'https://licitapro-beta.vercel.app/?view=firmas';

export default function FirmasView({ projects, companies, user, onUpdateProject, onNav }) {
  const [busyId, setBusyId] = useState(null);
  const [genPdfId, setGenPdfId] = useState(null);
  const fileRefs = useRef({});

  const esJefe = getPermissions(user).isAdmin;
  const miEmail = (user?.email||'').toLowerCase();
  const miNombre = user?.name || user?.email || 'Usuario';
  const jefeEmail = 'santiago@brokingroup.com'; // aprobador único

  // Juntar todos los documentos en flujo de todos los proyectos
  const todos = [];
  projects.forEach(p => (p.firmas||[]).forEach(f => { if (f.estatus) todos.push({ ...f, proyecto:p }); }));
  todos.sort((a,b)=>(b.fechaCreacion||'').localeCompare(a.fechaCreacion||''));

  // Buzones según rol
  // Jefe: "Por aprobar" = en_aprobacion + en_visto. Empleado: "Míos" = los que creó. Responsable: "Por firmar" = en_firma asignados a mí.
  const porAprobar = todos.filter(f => f.estatus==='en_aprobacion' || f.estatus==='en_visto');
  const porFirmar  = todos.filter(f => f.estatus==='en_firma' && (f.responsable?.email||'').toLowerCase()===miEmail);
  const mios       = todos.filter(f => (f.creadoPor?.email||'').toLowerCase()===miEmail);

  // Pestaña activa por defecto según rol
  const tabsDisp = [];
  if (esJefe) tabsDisp.push(['aprobar','Por aprobar ('+porAprobar.length+')']);
  tabsDisp.push(['firmar','Por firmar ('+porFirmar.length+')']);
  tabsDisp.push(['mios','Míos ('+mios.length+')']);
  tabsDisp.push(['todos','Todos']);
  const [tab, setTab] = useState(esJefe ? 'aprobar' : 'firmar');

  const lista = tab==='aprobar'?porAprobar : tab==='firmar'?porFirmar : tab==='mios'?mios : todos;

  // Helper: actualizar un doc dentro de su proyecto
  const actualizarDoc = (proy, docId, nuevoDoc) => {
    onUpdateProject({ ...proy, firmas:(proy.firmas||[]).map(f=>f.id===docId?nuevoDoc:f) });
  };

  // Genera el PDF del documento (OC o membretado) para adjuntarlo al correo del responsable
  const generarPdfAdjunto = async (d) => {
    try {
      if (d.tipo === 'oc' && d.ocId) {
        const proy = d.proyecto;
        const oc = (proy.ordenesCompra||[]).find(o => o.id === d.ocId);
        if (!oc) return null;
        const cot2 = proy.cotizacion || {};
        const partidas = (oc.partidas||[]).map(op => {
          const orig = (cot2.partidas||[]).find(p=>p.id===op.id) || {};
          return { ...orig, ...op, costoMSMS: op.precioUnit || orig.costoMSMS || 0 };
        });
        const companyObj = (companies||[]).find(c => c.name === proy.company);
        const { base64, filename } = await ordenCompraPdfBase64({
          project: { ...proy, ocProveedor:{ name:oc.proveedor, rfc:oc.proveedorRfc, address:oc.proveedorAddress }, cotizacion:{ ...cot2, agenciaProveedor:oc.proveedor } },
          partidas, condiciones: oc.condiciones||[], folio: oc.folio, companyObj,
        });
        return { base64, filename };
      }
      if (d.tipo === 'documento' && d.docMembretadoId) {
        const empresa = (companies||[]).find(c => c.id === d.empresaId);
        const docM = empresa && (empresa.documentosMembretados||[]).find(x => x.id === d.docMembretadoId);
        if (!empresa || !docM) return null;
        return await documentoMembretadoPdfBase64({ empresa, titulo:docM.titulo, cuerpo:docM.cuerpo, folio:docM.folio });
      }
    } catch(e) { console.warn('No se pudo generar el PDF adjunto:', e); }
    return null;
  };

  // ── Acciones del jefe ──
  const doAprobar = async (d) => {
    setGenPdfId(d.id);
    const nuevo = aprobar(d, miNombre);
    actualizarDoc(d.proyecto, d.id, nuevo);
    const pdf = await generarPdfAdjunto(d);
    setGenPdfId(null);
    try { await avisarFirma({ doc:nuevo, proyectoNombre:d.proyecto.name, linkApp:LINK_APP, pdfBase64:pdf?.base64, pdfNombre:pdf?.filename }); } catch(e){ console.warn(e); }
    alert(pdf ? '✅ Aprobado. Se notificó a '+(d.responsable?.nombre||d.responsable?.email||'el responsable')+' con el documento adjunto para firmar.'
              : '✅ Aprobado. Se notificó a '+(d.responsable?.nombre||d.responsable?.email||'el responsable')+', pero el PDF no se pudo adjuntar (puede reimprimirlo desde el sistema).');
  };
  const doRechazar = async (d) => {
    const motivo = prompt('Motivo del rechazo (se le enviará al empleado):');
    if (motivo===null) return;
    const nuevo = rechazar(d, miNombre, motivo);
    actualizarDoc(d.proyecto, d.id, nuevo);
    try { await avisarRechazo({ doc:nuevo, proyectoNombre:d.proyecto.name, comentario:motivo }); } catch(e){ console.warn(e); }
    alert('Documento rechazado. Se notificó a '+(d.creadoPor?.nombre||'el empleado')+'.');
  };
  const doVistoFinal = (d) => {
    if (!confirm('¿Dar visto final? El documento quedará cerrado y archivado.')) return;
    actualizarDoc(d.proyecto, d.id, vistoFinal(d, miNombre));
    alert('✅ Visto final dado. Documento completado y archivado en el expediente.');
  };
  const doDevolver = async (d) => {
    const motivo = prompt('¿Por qué lo devuelves? (volverá a estado "en firma"):');
    if (motivo===null) return;
    actualizarDoc(d.proyecto, d.id, devolver(d, miNombre, motivo));
  };

  // ── Acción del responsable ──
  const doSubirFirmado = async (d, file) => {
    if (!file) return;
    setBusyId(d.id);
    try {
      const path = 'firmas/'+d.proyecto.id+'/'+d.id+'-'+file.name;
      const url = await uploadFileToStorage(path, file);
      const nuevo = subirFirmadoDoc(d, { url:url||'', nombre:file.name, size:file.size, tipo:file.type||'' }, miNombre);
      actualizarDoc(d.proyecto, d.id, nuevo);
      try { await avisarVistoFinal({ doc:nuevo, proyectoNombre:d.proyecto.name, jefeEmail, linkApp:LINK_APP }); } catch(e){ console.warn(e); }
      alert('✅ Documento firmado subido. Se notificó al jefe para su visto final.');
    } catch(e) { console.error(e); alert('Error al subir el documento firmado'); }
    setBusyId(null);
  };

  // ── Acción del empleado (reenviar tras rechazo) ──
  const doReenviar = async (d) => {
    const nuevo = reenviar(d, miNombre);
    actualizarDoc(d.proyecto, d.id, nuevo);
    try { await avisarAprobacion({ doc:nuevo, proyectoNombre:d.proyecto.name, jefeEmail, linkApp:LINK_APP }); } catch(e){ console.warn(e); }
    alert('Reenviado a aprobación.');
  };

  const verFirmado = (d) => { if (d.archivoFirmado?.url) abrirArchivo(d.archivoFirmado.url); };
  const quitar = (d) => { if(confirm('¿Eliminar este documento del flujo? No se puede deshacer.')) onUpdateProject({ ...d.proyecto, firmas:(d.proyecto.firmas||[]).filter(f=>f.id!==d.id) }); };

  const iconoTipo = (t) => t==='oc'?'🛒':t==='acta'?'📋':t==='documento'?'📝':'📄';

  return h('div', { className:'main-content' },
    h('h1', { style:{ fontSize:22, fontWeight:600, margin:0 } }, 'Firmas y autorizaciones'),
    h('p', { style:{ fontSize:13, color:'var(--t2)', marginTop:6, marginBottom:20 } },
      esJefe ? 'Aprueba los documentos antes de que salgan y da el visto final cuando estén firmados.' : 'Aquí ves los documentos que debes firmar y el estado de los que creaste.'),

    // Pestañas
    h('div', { style:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' } },
      tabsDisp.map(([k,label]) =>
        h('button', { key:k, onClick:()=>setTab(k),
          style:{ fontSize:13, padding:'7px 14px', borderRadius:'var(--r)', cursor:'pointer',
            background: tab===k?'var(--t1)':'var(--bg2)', color: tab===k?'#fff':'var(--t2)',
            border:'1px solid '+(tab===k?'var(--t1)':'var(--b2)') } }, label)
      ),
    ),

    lista.length===0
      ? h('div', { className:'card' }, h(EmptyState, { icon:'◭', title:'Nada por aquí', description:'No hay documentos en esta vista.' }))
      : h('div', { style:{ display:'flex', flexDirection:'column', gap:12 } },
          lista.map(d => {
            const info = ESTADO_INFO[d.estatus] || ESTADO_INFO.en_aprobacion;
            const esElFirmado = d.estatus==='en_visto'; // en aprobar, distinguir aprobación inicial vs visto final
            return h('div', { key:d.id, className:'card', style:{ borderLeft:'3px solid '+info.color } },
              h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' } },
                h('div', { style:{ flex:1, minWidth:0 } },
                  h('div', { style:{ fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' } },
                    h('span', null, iconoTipo(d.tipo)),
                    h('span', null, d.titulo),
                    d.folio && h('span', { style:{ fontSize:11, fontWeight:400, color:'var(--t3)', fontFamily:'monospace' } }, d.folio),
                  ),
                  h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:4 } },
                    '📁 ', h('span', { style:{ color:'var(--blue)', cursor:'pointer' }, onClick:()=>onNav&&onNav('project_detail',d.proyecto.id) }, d.proyecto.name),
                  ),
                  h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } },
                    'Creó: '+(d.creadoPor?.nombre||'—')+' · Firma: '+(d.responsable?.nombre||d.responsable?.email||'—')),
                  d.comentarioRechazo && d.estatus==='rechazado' && h('div', { style:{ fontSize:12, color:'#E24B4A', marginTop:6, padding:'6px 10px', background:'#FBEAEA', borderRadius:6 } }, '❌ '+d.comentarioRechazo),
                ),
                h('span', { style:{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:10, whiteSpace:'nowrap', background:info.color+'22', color:info.color } }, info.icono+' '+info.label),
              ),
              // Acciones según estado y rol
              h('div', { style:{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' } },
                // JEFE aprobando (paso 2)
                esJefe && d.estatus==='en_aprobacion' && h('div', { style:{ display:'flex', gap:8 } },
                  h('button', { className:'bp', disabled:genPdfId===d.id, onClick:()=>doAprobar(d) }, genPdfId===d.id?'Generando PDF...':'✅ Aprobar'),
                  h('button', { onClick:()=>doRechazar(d), disabled:genPdfId===d.id, style:{ fontSize:13, padding:'8px 14px', background:'transparent', border:'1px solid #E24B4A55', borderRadius:'var(--r)', cursor:'pointer', color:'var(--red)' } }, '❌ Rechazar'),
                ),
                // JEFE visto final (paso 4)
                esJefe && d.estatus==='en_visto' && h('div', { style:{ display:'flex', gap:8, flexWrap:'wrap' } },
                  d.archivoFirmado?.url && h('button', { onClick:()=>verFirmado(d), style:{ fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '📄 Ver firmado'),
                  h('button', { className:'bp', onClick:()=>doVistoFinal(d) }, '✅ Visto bueno final'),
                  h('button', { onClick:()=>doDevolver(d), style:{ fontSize:13, padding:'8px 14px', background:'transparent', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer', color:'var(--t2)' } }, 'Devolver'),
                ),
                // RESPONSABLE firmando (paso 3)
                d.estatus==='en_firma' && (d.responsable?.email||'').toLowerCase()===miEmail && h('div', null,
                  h('input', { ref:el=>fileRefs.current[d.id]=el, type:'file', accept:'application/pdf,image/*', style:{ display:'none' }, onChange:e=>{ doSubirFirmado(d, e.target.files[0]); e.target.value=''; } }),
                  h('button', { className:'bp', disabled:busyId===d.id, onClick:()=>fileRefs.current[d.id]&&fileRefs.current[d.id].click() }, busyId===d.id?'Subiendo...':'📎 Subir documento firmado'),
                ),
                // EMPLEADO tras rechazo (reenviar)
                d.estatus==='rechazado' && (d.creadoPor?.email||'').toLowerCase()===miEmail && h('button', { className:'bp', onClick:()=>doReenviar(d) }, '↻ Corregido, reenviar a aprobación'),
                // Completado: ver firmado
                d.estatus==='completado' && d.archivoFirmado?.url && h('button', { onClick:()=>verFirmado(d), style:{ fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '📄 Ver firmado'),
                // Eliminar (siempre disponible para jefe)
                esJefe && h('button', { onClick:()=>quitar(d), style:{ fontSize:12, padding:'8px 12px', background:'transparent', border:'none', cursor:'pointer', color:'var(--red)', marginLeft:'auto' } }, 'Eliminar'),
              ),
              // Historial
              (d.historial||[]).length>1 && h('details', { style:{ marginTop:10 } },
                h('summary', { style:{ fontSize:11, color:'var(--t3)', cursor:'pointer' } }, 'Ver historial'),
                h('div', { style:{ marginTop:8, fontSize:11, color:'var(--t2)' } },
                  (d.historial||[]).map((hh,i) => h('div', { key:i, style:{ padding:'3px 0' } },
                    '• '+hh.fecha+' — '+hh.accion+(hh.por?' por '+hh.por:'')+(hh.comentario?': '+hh.comentario:''))),
                ),
              ),
            );
          })
        )
  );
}
