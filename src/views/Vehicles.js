// Vehicles.js — Vehículos, Facturas, Acta entrega, Billing, Docs
import { h, useState, useRef } from '../lib/core.js';
import { analyzeFactura } from '../lib/ai_analyzer.js';
import { uploadFileToStorage as _uploadFile, uploadImageToStorage, isBase64, downloadFile as dlStorage } from '../lib/supabase.js';
// Guard: si Storage no está disponible, devuelve null y el código cae a base64
const uploadFileToStorage = async (path, file) => {
  try { return await _uploadFile(path, file); } catch(e) { console.warn('Storage no disponible:', e); return null; }
};
import { DOC_CATEGORIES, EMPRESA_BASE_DOCS } from '../lib/constants.js';
import { fmt, TODAY, NOW, uid, dlFile, fmtBytes } from '../lib/utils.js';
import { Inp, Metric, EmptyState, ConfirmAction, NumInput } from '../ui/primitives.js';

// ── Parseo de CFDI (XML) ──────────────────────────────────────
function findByLocal(doc, localName) {
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i].localName === localName) return all[i];
  return null;
}
function parseCFDIVehiculo(xmlText) {
  // Intenta extraer VIN/marca/modelo de la descripción de los conceptos
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const conceptos = Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === 'Concepto');
  let desc = '', precio = 0;
  conceptos.forEach(c => {
    const d = c.getAttribute('Descripcion') || '';
    if (d.length > desc.length) { desc = d; precio = Number(c.getAttribute('Importe') || 0); }
  });
  // VIN: 17 caracteres alfanuméricos (sin I, O, Q)
  const vinMatch = desc.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
  return { descripcion: desc, vin: vinMatch ? vinMatch[0].toUpperCase() : '', precio };
}

function parseCFDI(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const comp = findByLocal(doc, 'Comprobante');
  if (!comp) throw new Error('No es un XML de CFDI válido');
  const emisor = findByLocal(doc, 'Emisor');
  const receptor = findByLocal(doc, 'Receptor');
  const tfd = findByLocal(doc, 'TimbreFiscalDigital');
  const imp = findByLocal(doc, 'Impuestos');
  const subtotal = Number(comp.getAttribute('SubTotal') || 0);
  const total    = Number(comp.getAttribute('Total') || 0);
  let iva = imp ? Number(imp.getAttribute('TotalImpuestosTrasladados') || 0) : 0;
  if (!iva) iva = Math.round((total - subtotal) * 100) / 100;
  return {
    folio:    comp.getAttribute('Folio') || comp.getAttribute('Serie') || '',
    fecha:    (comp.getAttribute('Fecha') || '').slice(0, 10),
    emisor:   emisor?.getAttribute('Nombre') || emisor?.getAttribute('Rfc') || '',
    receptor: receptor?.getAttribute('Nombre') || receptor?.getAttribute('Rfc') || '',
    uuid:     tfd?.getAttribute('UUID') || '',
    subtotal, iva, total,
  };
}

// ── VehiclesTab ────────────────────────────────────────────────
export function VehiclesTab({ project, vehicles, onSave, onDelete, onNav, user, logFn }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  if (showForm || editing)
    return h(VehicleForm, { vehicle:editing, projectId:project.id,
      onSave: v => { onSave(v); if(logFn)logFn(user,editing?'actualizó':'agregó','vehículo',v.id,v.vin||v.marca+' '+v.modelo); setShowForm(false); setEditing(null); },
      onSaveMany: arr => { arr.forEach(v => { onSave(v); if(logFn)logFn(user,'agregó','vehículo',v.id,v.vin||v.marca+' '+v.modelo); }); setShowForm(false); setEditing(null); },
      onCancel: () => { setShowForm(false); setEditing(null); },
    });
  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 } },
      h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Vehículos del proyecto'),
      h('button', { className:'bp', onClick:()=>setShowForm(true) }, '+ Agregar vehículo'),
    ),
    vehicles.length===0
      ? h('div', { className:'card' }, h(EmptyState, { icon:'🚓', title:'Sin vehículos registrados', description:'Registra los vehículos del proyecto.', actionLabel:'+ Agregar primer vehículo', onAction:()=>setShowForm(true) }))
      : h('div', { className:'card' },
          h('div', { style:{ overflowX:'auto' } },
            h('table', { style:{ fontSize:13 } },
              h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
                ['VIN','MARCA/MODELO','AÑO','PRECIO','ENTREGA','FACTURAS',''].map(hd => h('td', { key:hd, style:{ padding:'8px 6px', color:'var(--t2)', fontSize:11 } }, hd))
              )),
              h('tbody', null, vehicles.map(v => {
                const fc = (v.facturaAgencia?.folio?1:0)+(v.facturaGobierno?.folio?1:0);
                return h('tr', { key:v.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('vehicle_detail',v.id) },
                  h('td', { style:{ padding:'10px 6px', fontFamily:'monospace', fontSize:11 } }, v.vin||'—'),
                  h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, v.marca,' ',v.modelo, v.version?' · '+v.version:''),
                  h('td', { style:{ padding:'10px 6px' } }, v.ano||'—'),
                  h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(v.precioTotal)),
                  h('td', { style:{ padding:'10px 6px' } },
                    v.statusEntrega && h('span', { style:{ fontSize:11, padding:'2px 8px', borderRadius:10, background:v.statusEntrega==='Entregado'?'#E1F5EE':'#FAEEDA', color:v.statusEntrega==='Entregado'?'#085041':'#633806' } }, v.statusEntrega)
                  ),
                  h('td', { style:{ padding:'10px 6px', fontSize:11, color:fc===2?'var(--green)':'var(--amber)' } }, fc+'/2'),
                  h('td', { style:{ padding:'10px 6px' } },
                    h('div', { style:{ display:'flex', gap:6 } },
                      h('button', { onClick:e=>{ e.stopPropagation(); setEditing(v); }, style:{ fontSize:11, padding:'3px 8px' } }, 'Editar'),
                      h('button', { onClick:e=>{ e.stopPropagation(); if(confirm('¿Eliminar este vehículo'+(v.vin?' ('+v.vin+')':'')+'? Esta acción no se puede deshacer.')){ onDelete(v.id); if(logFn)logFn(user,'eliminó','vehículo',v.id,v.vin||''); } }, style:{ fontSize:11, padding:'3px 8px', color:'var(--red)', border:'.5px solid #E24B4A55', background:'transparent' } }, 'Borrar'),
                    ),
                  ),
                );
              }))
            )
          )
        )
  );
}

// ── VehicleForm ───────────────────────────────────────────────
export function VehicleForm({ vehicle, projectId, onSave, onSaveMany, onCancel }) {
  const [v, sV] = useState(vehicle || { id:uid('VEH'), projectId, marca:'', modelo:'', version:'', ano:'', color:'', vin:'', numMotor:'', numInventario:'', precioUnitario:0, iva:0, precioTotal:0, equipamiento:'', statusDocs:'Pendiente', statusEntrega:'Pendiente', ubicacion:'', observaciones:'', facturaAgencia:{}, facturaEquipo:{}, facturaGobierno:{}, actaEntrega:{} });
  const [lote, setLote] = useState(false);       // modo varios VINs
  const [vinsText, setVinsText] = useState('');   // VINs uno por línea
  const esEdicion = !!vehicle;
  const factRef = useRef(null), factPdfRef = useRef(null);
  const [factMsg, setFactMsg] = useState('');
  const [factBusy, setFactBusy] = useState(false);

  // Crear vehículo(s) desde factura(s) de agencia
  const crearDesdeXMLs = async (files) => {
    const arr = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const fac = parseCFDI(text);
        const veh = parseCFDIVehiculo(text);
        const vehId = uid('VEH');
        const storagePath = `vehiculos/${vehId}/factura-agencia-${file.name}`;
        const url = await uploadFileToStorage(storagePath, file);
        const precioSinIVA = fac.subtotal || 0;
        arr.push({
          id:vehId, projectId,
          marca:'', modelo:'', version:'', ano:'', color:'', numMotor:'', numInventario:'',
          vin: veh.vin || '',
          precioUnitario: precioSinIVA, iva: fac.iva || 0, precioTotal: fac.total || 0,
          equipamiento:'', statusDocs:'Pendiente', statusEntrega:'Pendiente', ubicacion:'', observaciones: veh.descripcion || '',
          facturaAgencia:{ folio:fac.folio, fecha:fac.fecha, emisor:fac.emisor, receptor:fac.receptor, uuid:fac.uuid, subtotal:fac.subtotal, iva:fac.iva, total:fac.total, statusPago:'Pendiente', xmlNombre:file.name, xmlData: url || text },
          facturaGobierno:{}, actaEntrega:{},
        });
      } catch(e) { setFactMsg('Error en '+file.name+': '+e.message); }
    }
    if (arr.length) { onSaveMany(arr); }
  };

  const crearDesdePDF = async (file) => {
    const apiKey = window._lpConfig?.ia?.openaiKey;
    if (!apiKey) { setFactMsg('Agrega tu API Key de Anthropic en Configuración para analizar PDFs.'); return; }
    setFactBusy(true); setFactMsg('🤖 Analizando factura...');
    try {
      const d = await analyzeFactura(file, apiKey);
      // Rellenar el formulario con lo extraído (modo un vehículo)
      sV(p => ({ ...p,
        marca:d.marca||p.marca, modelo:d.modelo||p.modelo, ano:d.ano||p.ano, color:d.color||p.color,
        vin:d.vin||p.vin, numMotor:d.numMotor||p.numMotor,
        precioUnitario:d.subtotal||p.precioUnitario, iva:d.iva||p.iva, precioTotal:d.total||p.precioTotal,
        facturaAgencia:{ folio:d.folio, fecha:d.fecha, emisor:d.emisor, receptor:d.receptor, uuid:d.uuid, subtotal:d.subtotal, iva:d.iva, total:d.total, statusPago:'Pendiente' },
      }));
      setFactBusy(false);
      setFactMsg('✅ Datos extraídos. Revisa y completa lo que falte, luego Guarda.');
    } catch(e) { setFactBusy(false); setFactMsg('Error: '+e.message); }
  };

  const vinsList = vinsText.split('\n').map(s=>s.trim()).filter(Boolean);

  const guardarLote = () => {
    if (vinsList.length === 0) { alert('Agrega al menos un VIN (uno por línea).'); return; }
    const base = { ...v };
    delete base.id; delete base.vin;
    const nuevos = vinsList.map(vin => ({
      ...base, id:uid('VEH'), vin,
      facturaAgencia:{}, facturaEquipo:{}, facturaGobierno:{}, actaEntrega:{},
    }));
    onSaveMany(nuevos);
  };
  const set = (k, val) => sV(p => {
    const u = { ...p, [k]:val };
    if (k==='precioUnitario') { const pu=Number(val)||0; u.iva=Math.round(pu*.16); u.precioTotal=pu+u.iva; }
    return u;
  });
  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
      h('div', { style:{ fontSize:16, fontWeight:500 } }, esEdicion?'Editar vehículo':(lote?('Agregar '+vinsList.length+' vehículo(s)'):'Nuevo vehículo')),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:onCancel }, 'Cancelar'),
        h('button', { className:'bp', onClick:()=> lote ? guardarLote() : onSave(v) }, lote ? ('Crear '+vinsList.length+' vehículo(s)') : 'Guardar'),
      ),
    ),
    !esEdicion && h('div', { style:{ marginBottom:16, padding:'12px 16px', background:'var(--blue-bg)', border:'1px solid var(--blue-border)', borderRadius:'var(--rl)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' } },
      h('label', { style:{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 } },
        h('input', { type:'checkbox', checked:lote, onChange:e=>setLote(e.target.checked) }),
        h('span', { style:{ fontWeight:500 } }, 'Varios vehículos iguales (un VIN por cada uno)'),
      ),
      h('span', { style:{ fontSize:11, color:'var(--t2)' } }, lote ? 'Captura los datos comunes abajo y pega todos los VINs.' : 'Actívalo si vas a registrar muchos coches del mismo modelo.'),
    ),
    !esEdicion && h('div', { style:{ marginBottom:16, padding:'14px 16px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--rl)' } },
      h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:4 } }, '🤖 Crear desde factura de la agencia (Surman)'),
      h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:10 } }, 'Si ya tienes las facturas de los vehículos, súbelas y se crean los vehículos con sus datos y la factura adjunta. El XML es exacto; el PDF lo analiza Claude.'),
      h('div', { style:{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' } },
        h('button', { onClick:()=>factRef.current?.click(),
          style:{ fontSize:12, padding:'8px 14px', border:'1px solid var(--green)', borderRadius:8, background:'var(--bg1)', color:'var(--t1)', cursor:'pointer' } }, '📄 Subir factura(s) XML'),
        h('input', { ref:factRef, type:'file', accept:'.xml', multiple:true, style:{ display:'none' },
          onChange:e=>{ crearDesdeXMLs(Array.from(e.target.files)); e.target.value=''; } }),
        h('button', { onClick:()=>factPdfRef.current?.click(), disabled:factBusy,
          style:{ fontSize:12, padding:'8px 14px', border:'1px solid var(--b2)', borderRadius:8, background:'var(--bg1)', color:'var(--t1)', cursor:'pointer', opacity:factBusy?.6:1 } }, factBusy?'⏳ Analizando...':'🤖 Analizar 1 PDF'),
        h('input', { ref:factPdfRef, type:'file', accept:'.pdf', style:{ display:'none' },
          onChange:e=>{ crearDesdePDF(e.target.files[0]); e.target.value=''; } }),
      ),
      h('div', { style:{ fontSize:10, color:'var(--t3)', marginTop:8 } }, 'XML: puedes subir varias a la vez, crea un vehículo por factura. PDF: rellena este formulario (un vehículo).'),
      factMsg && h('div', { style:{ marginTop:8, fontSize:11, color:factMsg.startsWith('Error')?'var(--red)':'var(--t1)', padding:'6px 10px', background:'var(--bg1)', borderRadius:6 } }, factMsg),
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos del vehículo'),
        h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
          h(Inp, { label:'Marca', value:v.marca, onChange:val=>set('marca',val), placeholder:'Ford' }),
          h(Inp, { label:'Modelo', value:v.modelo, onChange:val=>set('modelo',val) }),
          h(Inp, { label:'Versión', value:v.version, onChange:val=>set('version',val) }),
          h(Inp, { label:'Año', value:v.ano, onChange:val=>set('ano',val), type:'number' }),
          h(Inp, { label:'Color', value:v.color, onChange:val=>set('color',val) }),
          h(Inp, { label:'# Inventario', value:v.numInventario, onChange:val=>set('numInventario',val) }),
        ),
        lote
          ? h('div', { style:{ marginBottom:14 } },
              h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', fontWeight:500, marginBottom:5 } }, 'VINs / Núm. de serie — uno por línea ('+vinsList.length+')'),
              h('textarea', { value:vinsText, onChange:e=>setVinsText(e.target.value), rows:6,
                placeholder:'3FA6P0H7XKR123456\n3FA6P0H7XKR123457\n3FA6P0H7XKR123458', style:{ width:'100%', fontFamily:'monospace', fontSize:12, padding:'8px 10px', border:'1px solid var(--b2)', borderRadius:8, resize:'vertical' } }),
              h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:4 } }, 'Cada línea crea un vehículo con los mismos datos pero distinto VIN.'),
            )
          : h(Inp, { label:'VIN / Núm. de serie', value:v.vin, onChange:val=>set('vin',val), placeholder:'17 caracteres' }),
        !lote && h(Inp, { label:'Núm. de motor', value:v.numMotor, onChange:val=>set('numMotor',val) }),
        h(Inp, { label:'Equipamiento', value:v.equipamiento, onChange:val=>set('equipamiento',val), textarea:true }),
        h(Inp, { label:'Ubicación', value:v.ubicacion, onChange:val=>set('ubicacion',val) }),
      ),
      h('div', null,
        h('div', { className:'card', style:{ marginBottom:16 } },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos económicos'),
          h(Inp, { label:'Precio unitario (sin IVA)', value:v.precioUnitario, onChange:val=>set('precioUnitario',val), type:'number', hint:'El IVA (16%) se calcula automáticamente' }),
          h(Inp, { label:'IVA', value:v.iva, onChange:val=>set('iva',val), type:'number' }),
          h(Inp, { label:'Precio total', value:v.precioTotal, onChange:val=>set('precioTotal',val), type:'number' }),
        ),
        h('div', { className:'card' },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Estatus'),
          h(Inp, { label:'Estatus documentación', value:v.statusDocs, onChange:val=>set('statusDocs',val), options:['Pendiente','En proceso','Completa','Entregada'] }),
          h(Inp, { label:'Estatus entrega', value:v.statusEntrega, onChange:val=>set('statusEntrega',val), options:['Pendiente','En equipamiento','Listo','Entregado'] }),
        ),
      ),
    ),
  );
}

// ── FacturaCard ───────────────────────────────────────────────
export function FacturaCard({ title, subtitle, color, data, onSave }) {
  const [f, sF] = useState({ folio:'', fecha:'', emisor:'', receptor:'', uuid:'', subtotal:0, iva:0, total:0, statusPago:'Pendiente', xmlNombre:'', xmlData:'', ...data });
  const set = (k, v) => sF(p => { const u={...p,[k]:v}; if(k==='subtotal'){const st=Number(v)||0;u.iva=Math.round(st*.16);u.total=st+u.iva;} return u; });
  const hasData = f.folio||f.uuid||f.total>0;
  const save = () => onSave({...f, subtotal:Number(f.subtotal)||0, iva:Number(f.iva)||0, total:Number(f.total)||0});

  const xmlRef = useRef(null), pdfRef = useRef(null);
  const [msg, setMsg] = useState('');
  const [analizando, setAnalizando] = useState(false);

  const handleXML = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const d = parseCFDI(text);
      // Subir a Storage (más eficiente que base64); fallback a base64 si el bucket no existe
      const storagePath = `vehiculos/xml-${Date.now()}-${file.name}`;
      const url = await uploadFileToStorage(storagePath, file);
      sF(p => ({ ...p, ...d, xmlNombre:file.name, xmlData: url || text, xmlPath: url ? storagePath : null }));
      setMsg('✅ XML procesado: folio '+(d.folio||'—')+', total '+fmt(d.total)+(url?' · guardado en Storage':'')+'. Revisa y guarda.');
    } catch(e) { setMsg('Error al leer XML: '+e.message); }
  };

  const handlePDF = async (file) => {
    if (!file) return;
    const apiKey = window._lpConfig?.ia?.openaiKey;
    if (!apiKey) { setMsg('Agrega tu API Key de Anthropic en Configuración para analizar PDFs.'); return; }
    setAnalizando(true); setMsg('🤖 Analizando PDF con Claude...');
    try {
      const d = await analyzeFactura(file, apiKey);
      sF(p => ({ ...p,
        folio:d.folio||p.folio, fecha:d.fecha||p.fecha,
        emisor:d.emisor||p.emisor, receptor:d.receptor||p.receptor,
        uuid:d.uuid||p.uuid,
        subtotal:d.subtotal||p.subtotal, iva:d.iva||p.iva, total:d.total||p.total,
      }));
      setMsg('✅ PDF analizado: folio '+(d.folio||'—')+', total '+fmt(d.total||0)+'. Revisa y guarda.');
    } catch(e) { setMsg('Error: '+e.message); }
    setAnalizando(false);
  };
  return h('div', { className:'card', style:{ borderLeft:'3px solid '+color } },
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 } },
      h('div', null,
        h('div', { style:{ fontSize:14, fontWeight:500 } }, title),
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, subtitle),
      ),
      hasData
        ? h('span', { style:{ fontSize:11, padding:'3px 12px', borderRadius:12, background:['Pagada','Cobrada'].includes(f.statusPago)?'#E1F5EE':'#FAEEDA', color:['Pagada','Cobrada'].includes(f.statusPago)?'#085041':'#633806', fontWeight:500 } }, f.statusPago)
        : h('span', { style:{ fontSize:11, color:'var(--t3)' } }, 'Sin registrar'),
    ),
    // Analizador de factura
    h('div', { style:{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap', alignItems:'center' } },
      h('button', { onClick:()=>xmlRef.current?.click(), style:{ fontSize:12, padding:'7px 12px', border:'1px solid '+color, borderRadius:8, background:'var(--bg1)', color:'var(--t1)', cursor:'pointer' } }, '📄 Subir XML (CFDI)'),
      h('input', { ref:xmlRef, type:'file', accept:'.xml', style:{ display:'none' }, onChange:e=>{ handleXML(e.target.files[0]); e.target.value=''; } }),
      h('button', { onClick:()=>pdfRef.current?.click(), disabled:analizando, style:{ fontSize:12, padding:'7px 12px', border:'1px solid var(--b2)', borderRadius:8, background:'var(--bg1)', color:'var(--t1)', cursor:'pointer', opacity:analizando?.6:1 } }, analizando?'⏳ Analizando...':'🤖 Analizar PDF'),
      h('input', { ref:pdfRef, type:'file', accept:'.pdf', style:{ display:'none' }, onChange:e=>{ handlePDF(e.target.files[0]); e.target.value=''; } }),
      f.xmlNombre && h('span', { style:{ fontSize:11, color:'var(--green)', display:'flex', alignItems:'center', gap:4 } }, '📎 '+f.xmlNombre,
        h('span', { onClick:()=>dlStorage(f.xmlData,f.xmlNombre), style:{ color:'var(--blue)', cursor:'pointer', textDecoration:'underline' } }, 'descargar')),
    ),
    msg && h('div', { style:{ marginTop:8, fontSize:11, color:msg.startsWith('Error')?'var(--red)':'var(--t2)', padding:'6px 10px', background:'var(--bg2)', borderRadius:6 } }, msg),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginTop:14 } },
      h(Inp, { label:'Folio', value:f.folio, onChange:v=>set('folio',v) }),
      h(Inp, { label:'Fecha', value:f.fecha, onChange:v=>set('fecha',v), type:'date' }),
      h(Inp, { label:'Estatus pago', value:f.statusPago, onChange:v=>set('statusPago',v), options:['Pendiente','En revisión','Pagada','Cobrada','Vencida'] }),
      h(Inp, { label:'Emisor', value:f.emisor, onChange:v=>set('emisor',v) }),
      h(Inp, { label:'Receptor', value:f.receptor, onChange:v=>set('receptor',v) }),
      h(Inp, { label:'UUID fiscal', value:f.uuid, onChange:v=>set('uuid',v) }),
      h(Inp, { label:'Subtotal', value:f.subtotal, onChange:v=>set('subtotal',v), type:'number' }),
      h(Inp, { label:'IVA', value:f.iva, onChange:v=>set('iva',v), type:'number' }),
      h(Inp, { label:'Total', value:f.total, onChange:v=>set('total',v), type:'number' }),
    ),
    h('div', { style:{ display:'flex', gap:8, marginTop:10, justifyContent:'flex-end' } },
      h('button', { className:'bp', onClick:save }, 'Guardar factura'),
    ),
  );
}

// ── VehicleDetail ─────────────────────────────────────────────
export function VehicleDetail({ vehicle, project, company, onNav, onUpdate, onDelete, user, logFn }) {
  const [tab, setTab] = useState('info');
  if (!vehicle) return h('div', { className:'empty' }, h('h3', null, 'Vehículo no encontrado'));
  const updFact = (key, fac) => { onUpdate({...vehicle,[key]:fac}); if(logFn)logFn(user,'actualizó factura '+key,'vehículo',vehicle.id,fac.folio||''); };
  const tabs = [{id:'info',l:'Información'},{id:'facturas',l:'Facturación (2)'},{id:'entrega',l:'Acta entrega'}];
  return h('div', null,
    h('div', { style:{ display:'flex', alignItems:'center', gap:8, marginBottom:6 } },
      h('span', { onClick:()=>onNav('projects'), style:{ fontSize:12, color:'var(--blue)', cursor:'pointer' } }, 'Proyectos'),
      h('span', { style:{ fontSize:12, color:'var(--t2)' } }, '/'),
      h('span', { onClick:()=>onNav('project_detail',project?.id), style:{ fontSize:12, color:'var(--blue)', cursor:'pointer' } }, project?.name||'—'),
      h('span', { style:{ fontSize:12, color:'var(--t2)' } }, '/'),
      h('span', { style:{ fontSize:12 } }, vehicle.marca,' ',vehicle.modelo),
    ),
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 } },
      h('div', null,
        h('div', { style:{ fontSize:20, fontWeight:500, marginBottom:4 } }, vehicle.marca,' ',vehicle.modelo,' ',vehicle.version||''),
        h('div', { style:{ fontSize:13, color:'var(--t2)' } }, 'VIN: ', h('span', { style:{ fontFamily:'monospace', color:'var(--t1)' } }, vehicle.vin||'sin asignar'), ' · Año ',vehicle.ano||'—',' · ',vehicle.color||'—'),
      ),
      h(ConfirmAction, { label:'Eliminar', dangerous:true, onConfirm:()=>{ onDelete(vehicle.id); if(logFn)logFn(user,'eliminó','vehículo',vehicle.id,vehicle.vin||''); onNav('project_detail',project.id); } }),
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 } },
      h(Metric, { label:'Precio total', value:fmt(vehicle.precioTotal), sub:'Unit: '+fmt(vehicle.precioUnitario)+' + IVA '+fmt(vehicle.iva) }),
      h(Metric, { label:'Estatus docs', value:vehicle.statusDocs||'—' }),
      h(Metric, { label:'Estatus entrega', value:vehicle.statusEntrega||'—', sc:vehicle.statusEntrega==='Entregado'?'var(--green)':undefined }),
      h(Metric, { label:'Ubicación', value:vehicle.ubicacion||'—' }),
    ),
    h('div', { style:{ display:'flex', gap:2, marginBottom:20, borderBottom:'.5px solid var(--b3)', overflowX:'auto', flexWrap:'nowrap' } },
      tabs.map(t => h('button', { key:t.id, className:'tab'+(tab===t.id?' active':''), onClick:()=>setTab(t.id), style:{ flexShrink:0, whiteSpace:'nowrap' } }, t.l))
    ),
    tab==='info' && h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos del vehículo'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr' } },
        [['Marca',vehicle.marca],['Modelo',vehicle.modelo],['Versión',vehicle.version],['Año',vehicle.ano],['Color',vehicle.color],['VIN',vehicle.vin],['Núm. motor',vehicle.numMotor],['Inventario',vehicle.numInventario],['Ubicación',vehicle.ubicacion]].map(([l,v],i) =>
          h('div', { key:i, style:{ padding:'9px 12px 9px 0', borderBottom:'.5px solid var(--b3)' } },
            h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:2 } }, l),
            h('div', { style:{ fontSize:13, fontFamily:['VIN','Núm. motor'].includes(l)?'monospace':'inherit' } }, v||'—'),
          )
        )
      ),
    ),
    tab==='facturas' && h('div', { style:{ display:'flex', flexDirection:'column', gap:16 } },
      h(FacturaCard, { title:'Factura de la agencia (a la empresa)', subtitle:'La agencia automotriz me factura este vehículo', color:'#5B8DEF', data:vehicle.facturaAgencia||{}, onSave:f=>updFact('facturaAgencia',f) }),
      h(FacturaCard, { title:'Factura al cliente final (gobierno)', subtitle:'Yo facturo el vehículo equipado al cliente', color:'#1D9E75', data:vehicle.facturaGobierno||{}, onSave:f=>updFact('facturaGobierno',f) }),
    ),
    tab==='entrega' && h(ActaEntrega, { vehicle, project, company, onUpdate }),
  );
}

// ── ActaEntrega ───────────────────────────────────────────────
export function ActaEntrega({ vehicle, project, company, onUpdate }) {
  const acta = vehicle.actaEntrega || {};
  const set  = (k, v) => onUpdate({ ...vehicle, actaEntrega: { ...acta, [k]:v } });
  const printActa = () => {
    const w = window.open('', '_blank');
    if (!w) return alert('Permite ventanas emergentes para imprimir el acta');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acta</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 40px;line-height:1.6}h1{text-align:center;font-size:18px;text-transform:uppercase}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:6px 10px;border-bottom:1px solid #eee;font-size:13px}td:first-child{color:#666;width:35%}.sig{flex:1;text-align:center;border-top:1px solid #000;padding-top:8px;font-size:12px}.sigs{display:flex;justify-content:space-between;margin-top:80px;gap:60px}@media print{body{margin:0;padding:20px}}</style></head><body>
<h1>Acta de Entrega-Recepción</h1>
<p>En <strong>${acta.lugar||'___'}</strong>, siendo las <strong>${acta.hora||'____'}</strong> horas del día <strong>${acta.fechaEntrega||new Date().toLocaleDateString('es-MX')}</strong>, se hace constar la entrega del vehículo en el marco del proyecto <strong>"${project?.name||''}"</strong>.</p>
<table>
<tr><td>Marca</td><td><strong>${vehicle.marca||'—'}</strong></td></tr>
<tr><td>Modelo</td><td><strong>${vehicle.modelo||'—'}</strong></td></tr>
<tr><td>Año</td><td>${vehicle.ano||'—'}</td></tr>
<tr><td>Color</td><td>${vehicle.color||'—'}</td></tr>
<tr><td>VIN</td><td style="font-family:monospace"><strong>${vehicle.vin||'—'}</strong></td></tr>
<tr><td>Núm. motor</td><td style="font-family:monospace">${vehicle.numMotor||'—'}</td></tr>
</table>
${acta.observaciones?`<p><strong>Observaciones:</strong> ${acta.observaciones}</p>`:''}
<div class="sigs">
<div class="sig"><strong>${acta.entrega||'_______________________________'}</strong>Entrega — ${company?.name||''}</div>
<div class="sig"><strong>${acta.recibe||'_______________________________'}</strong>Recibe — ${project?.dependencia||''}</div>
</div>
<sc`+`ript>window.onload=()=>setTimeout(()=>window.print(),300);<\/script></body></html>`);
    w.document.close();
  };
  return h('div', null,
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos del acta de entrega'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
        h(Inp, { label:'Lugar de entrega', value:acta.lugar||'', onChange:v=>set('lugar',v), placeholder:'Ciudad, Estado' }),
        h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 } },
          h(Inp, { label:'Fecha', value:acta.fechaEntrega||'', onChange:v=>set('fechaEntrega',v), type:'date' }),
          h(Inp, { label:'Hora', value:acta.hora||'', onChange:v=>set('hora',v), placeholder:'10:00' }),
        ),
        h(Inp, { label:'Quién entrega', value:acta.entrega||'', onChange:v=>set('entrega',v) }),
        h(Inp, { label:'Quién recibe', value:acta.recibe||'', onChange:v=>set('recibe',v) }),
      ),
      h(Inp, { label:'Observaciones', value:acta.observaciones||'', onChange:v=>set('observaciones',v), textarea:true }),
    ),
    h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8 } }, 'Generar acta'),
      h('button', { className:'bp', onClick:printActa }, 'Generar e imprimir acta'),
    ),
  );
}

// ── BillingTab ────────────────────────────────────────────────
export function BillingTab({ project, vehicles, onNav }) {
  const totals = { agencia:{count:0,total:0,pagadas:0}, equipo:{count:0,total:0,pagadas:0}, gobierno:{count:0,total:0,pagadas:0} };
  vehicles.forEach(v => {
    [['agencia','facturaAgencia'],['gobierno','facturaGobierno']].forEach(([k,f]) => {
      const fc=v[f]; if(fc?.folio){totals[k].count++;totals[k].total+=(fc.total||0);if(['Pagada','Cobrada'].includes(fc.statusPago))totals[k].pagadas++;}
    });
  });
  if (vehicles.length===0) return h('div', { className:'card' }, h(EmptyState, { title:'Sin vehículos', description:'Agrega vehículos para gestionar su facturación.' }));
  return h('div', null,
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:20 } },
      [{k:'agencia',l:'De agencia (entrada)',c:'#5B8DEF'},{k:'equipo',l:'De proveedor equipo',c:'#EF9F27'},{k:'gobierno',l:'A cliente final (salida)',c:'#1D9E75'}].map(g =>
        h('div', { key:g.k, className:'card', style:{ borderTop:'3px solid '+g.c } },
          h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:8 } }, g.l),
          h('div', { style:{ fontSize:18, fontWeight:500, marginBottom:6 } }, fmt(totals[g.k].total)),
          h('div', { style:{ fontSize:11, color:'var(--t2)' } }, totals[g.k].count,'/',vehicles.length,' facturas · ',totals[g.k].pagadas,' pagadas'),
        )
      )
    ),
    h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Detalle por vehículo'),
      h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ fontSize:13 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            ['VIN/MOD.','F. AGENCIA','F. CLIENTE','TOTAL'].map(hd => h('td', { key:hd, style:{ padding:'8px 6px', color:'var(--t2)', fontSize:11 } }, hd))
          )),
          h('tbody', null, vehicles.map(v =>
            h('tr', { key:v.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('vehicle_detail',v.id) },
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, v.vin||v.id, h('div', { style:{ fontSize:11, color:'var(--t2)', fontWeight:400 } }, v.marca,' ',v.modelo)),
              ...[v.facturaAgencia,v.facturaGobierno].map((f,i) =>
                h('td', { key:i, style:{ padding:'10px 6px' } },
                  f?.folio
                    ? h('div', null, h('div', { style:{ fontSize:12, fontWeight:500 } }, fmt(f.total)), h('div', { style:{ fontSize:10, color:'var(--t2)' } }, f.folio,' · ',f.statusPago||'—'))
                    : h('span', { style:{ fontSize:11, color:'var(--red)' } }, 'Falta')
                )
              ),
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(v.precioTotal)),
            )
          ))
        )
      )
    ),
  );
}

// ── DocsTab ───────────────────────────────────────────────────
export function DocsTab({ project, onUpdate, user, logFn }) {
  const [newDoc, setNewDoc] = useState({ name:'', category:'Bases', notes:'', date:TODAY() });
  const docs = project.docs || [];
  const addDoc = () => {
    if (!newDoc.name) return;
    onUpdate({ ...project, docs:[...docs, { id:uid('doc'), ...newDoc }] });
    setNewDoc({ name:'', category:'Bases', notes:'', date:TODAY() });
    if (logFn) logFn(user,'registró documento','proyecto',project.id,newDoc.name);
  };
  const rmDoc = id => onUpdate({ ...project, docs:docs.filter(d=>d.id!==id) });
  const byCategory = {};
  docs.forEach(d => { const c=d.category||'Otro'; if(!byCategory[c])byCategory[c]=[]; byCategory[c].push(d); });
  return h('div', null,
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Registrar documento'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12 } },
        h(Inp, { label:'Nombre', value:newDoc.name, onChange:v=>setNewDoc(p=>({...p,name:v})), placeholder:'Propuesta técnica V2' }),
        h(Inp, { label:'Categoría', value:newDoc.category, onChange:v=>setNewDoc(p=>({...p,category:v})), options:DOC_CATEGORIES }),
        h(Inp, { label:'Fecha', value:newDoc.date, onChange:v=>setNewDoc(p=>({...p,date:v})), type:'date' }),
      ),
      h(Inp, { label:'Notas', value:newDoc.notes, onChange:v=>setNewDoc(p=>({...p,notes:v})) }),
      h('button', { className:'bp', onClick:addDoc }, '+ Agregar documento'),
    ),
    docs.length===0
      ? h('div', { className:'card' }, h(EmptyState, { title:'Sin documentos', description:'Lleva un inventario de bases, anexos, propuestas, etc.' }))
      : Object.entries(byCategory).map(([cat,items]) =>
          h('div', { key:cat, className:'card', style:{ marginBottom:12 } },
            h('div', { style:{ fontSize:11, color:'var(--t2)', textTransform:'uppercase', letterSpacing:.5, marginBottom:10, fontWeight:600 } }, cat,' (',items.length,')'),
            items.map(d =>
              h('div', { key:d.id, style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, padding:'10px 0', borderBottom:'.5px solid var(--b3)' } },
                h('div', { style:{ flex:1 } },
                  h('div', { style:{ fontSize:13, fontWeight:500 } }, d.name),
                  d.notes && h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:2 } }, d.notes),
                  h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } }, d.date),
                ),
                h('button', { onClick:()=>rmDoc(d.id), style:{ fontSize:11, color:'var(--red)', background:'transparent', border:'none', cursor:'pointer' } }, 'Quitar'),
              )
            )
          )
        )
  );
}
