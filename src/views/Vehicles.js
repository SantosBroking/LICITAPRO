// Vehicles.js — Vehículos, Facturas, Acta entrega, Billing, Docs
import { h, useState, useRef } from '../lib/core.js';
import { analyzeFactura } from '../lib/ai_analyzer.js';
import { uploadFileToStorage as _uploadFile, uploadImageToStorage, isBase64, downloadFile as dlStorage, abrirArchivo, signedUrl, createInboxItem } from '../lib/supabase.js';
import { getPermissions } from '../lib/permissions.js'; // Fase 2A0 — contención visible
// Guard: si Storage no está disponible, devuelve null y el código cae a base64
const uploadFileToStorage = async (path, file) => {
  try { return await _uploadFile(path, file); } catch(e) { console.warn('Storage no disponible:', e); return null; }
};
import { DOC_CATEGORIES, EMPRESA_BASE_DOCS } from '../lib/constants.js';
import { fmt, TODAY, NOW, uid, dlFile, fmtBytes } from '../lib/utils.js';
import { Inp, Metric, EmptyState, ConfirmAction, NumInput } from '../ui/primitives.js';
import { DocumentosMembretados } from './Companies.js';
import { printDocumentoMembretado } from '../lib/pdf_export.js';

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
// Exporta la lista de vehículos a CSV (Excel) con toda su información
function exportarExcel(vehicles, project, user) {
  const esc = (val) => {
    const s = (val==null?'':String(val));
    return /["\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  // Fase 2A0 -- el CSV se construye desde columnas permitidas por rol, nunca
  // desde el objeto completo del vehiculo. Empleado exporta version operativa
  // (exportVehiculosOperativo); admin exporta con columnas financieras ademas
  // (exportVehiculosCompleto).
  const colsOperativas = [
    ['VIN', v=>v.vin],
    ['Marca', v=>v.marca],
    ['Modelo', v=>v.modelo],
    ['Versión', v=>v.version],
    ['Año', v=>v.ano],
    ['Color', v=>v.color],
    ['Núm. motor', v=>v.numMotor],
    ['Núm. inventario', v=>v.numInventario],
    ['Estatus entrega', v=>v.statusEntrega],
    ['Estatus documentación', v=>v.statusDocs],
    ['Ubicación', v=>v.ubicacion],
    ['Equipamiento', v=>v.equipamiento],
    ['Acta firmada', v=>v.actaEntrega?.archivoFirmado?.url?'Sí':'No'],
    ['Observaciones', v=>v.observaciones],
  ];
  const colsFinancieras = [
    ['Precio unitario', v=>v.precioUnitario],
    ['IVA', v=>v.iva],
    ['Precio total', v=>v.precioTotal],
    ['Factura compra (folio)', v=>v.facturaAgencia?.folio],
    ['Factura compra (total)', v=>v.facturaAgencia?.total],
    ['Factura compra (estatus)', v=>v.facturaAgencia?.statusPago],
    ['Factura reventa (folio)', v=>v.facturaIntermedia?.folio],
    ['Factura reventa (total)', v=>v.facturaIntermedia?.total],
    ['Factura equipo (folio)', v=>v.facturaEquipo?.folio],
    ['Factura cliente (folio)', v=>v.facturaGobierno?.folio],
    ['Factura cliente (total)', v=>v.facturaGobierno?.total],
    ['Factura cliente (estatus)', v=>v.facturaGobierno?.statusPago],
  ];
  const cols = getPermissions(user).verVehiculosFinancieros ? [...colsOperativas, ...colsFinancieras] : colsOperativas;
  const filas = [cols.map(c=>esc(c[0])).join(',')];
  vehicles.forEach(v => filas.push(cols.map(c=>esc(c[1](v))).join(',')));
  const csv = '\uFEFF' + filas.join('\r\n'); // BOM para acentos en Excel
  const nombre = 'Vehiculos_'+(project.name||'proyecto').replace(/[^\w\-]+/g,'_')+'_'+TODAY()+'.csv';
  dlFile('data:text/csv;charset=utf-8,'+encodeURIComponent(csv), nombre);
}

export function VehiclesTab({ project, vehicles, onSave, onDelete, onNav, user, logFn }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  if (showForm || editing)
    return h(VehicleForm, { vehicle:editing, projectId:project.id, user,
      onSave: v => { onSave(v); if(logFn)logFn(user,editing?'actualizó':'agregó','vehículo',v.id,v.vin||v.marca+' '+v.modelo); setShowForm(false); setEditing(null); },
      onSaveMany: arr => { arr.forEach(v => { onSave(v); if(logFn)logFn(user,'agregó','vehículo',v.id,v.vin||v.marca+' '+v.modelo); }); setShowForm(false); setEditing(null); },
      onCancel: () => { setShowForm(false); setEditing(null); },
    });
  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:8, flexWrap:'wrap' } },
      h('div', { style:{ fontSize:14, fontWeight:500 } }, 'Vehículos del proyecto'),
      h('div', { style:{ display:'flex', gap:8 } },
        vehicles.length>0 && h('button', { onClick:()=>exportarExcel(vehicles, project, user), style:{ fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '⬇ Exportar Excel'),
        h('button', { className:'bp', onClick:()=>setShowForm(true) }, '+ Agregar vehículo'),
      ),
    ),
    vehicles.length===0
      ? h('div', { className:'card' }, h(EmptyState, { icon:'🚓', title:'Sin vehículos registrados', description:'Registra los vehículos del proyecto.', actionLabel:'+ Agregar primer vehículo', onAction:()=>setShowForm(true) }))
      : h('div', { className:'card' },
          h('div', { className:'tbl-scroll', style:{ overflowX:'auto', WebkitOverflowScrolling:'touch' } },
            h('table', { style:{ fontSize:13 } },
              h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
                // Fase 2F1B: PRECIO (costo de origen) ahora se muestra con
                // verCostosProveedor (empleado operativo incluido), no con
                // verVehiculosFinancieros (que sigue admin-only, gate real
                // de facturaIntermedia/facturaGobierno más abajo).
                (getPermissions(user).verCostosProveedor
                  ? ['VIN','MARCA/MODELO','AÑO','PRECIO','ENTREGA','FACTURAS','']
                  : ['VIN','MARCA/MODELO','AÑO','ENTREGA','']
                ).map(hd => h('td', { key:hd, style:{ padding:'8px 6px', color:'var(--t2)', fontSize:11 } }, hd))
              )),
              h('tbody', null, vehicles.map(v => {
                const puedeCostos = getPermissions(user).verCostosProveedor;
                const puedeFinanciero = getPermissions(user).verVehiculosFinancieros;
                // Fase 2F1B: el indicador de "facturas completas" ahora
                // cuenta lo que cada rol puede ver -- admin sigue viendo
                // Agencia+Gobierno (las 2 puntas del negocio, sin cambio);
                // empleado ve Agencia+Equipo (las 2 facturas de origen/
                // proveedor que sí puede tener), nunca se le insinúa la
                // existencia de facturaGobierno con este contador.
                const fc = puedeFinanciero
                  ? (v.facturaAgencia?.folio?1:0)+(v.facturaGobierno?.folio?1:0)
                  : (v.facturaAgencia?.folio?1:0)+(v.facturaEquipo?.folio?1:0);
                return h('tr', { key:v.id, style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' }, onClick:()=>onNav('vehicle_detail',v.id) },
                  h('td', { style:{ padding:'10px 6px', fontFamily:'monospace', fontSize:11 } }, v.vin||'—'),
                  h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, v.marca,' ',v.modelo, v.version?' · '+v.version:''),
                  h('td', { style:{ padding:'10px 6px' } }, v.ano||'—'),
                  puedeCostos && h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(v.precioTotal)),
                  h('td', { style:{ padding:'10px 6px' }, onClick:e=>e.stopPropagation() },
                    (() => {
                      const st = v.statusEntrega || 'En agencia/planta';
                      const col = st==='Cobrada'?{bg:'#C8E9D9',tx:'#085041'}:st==='Entregada'?{bg:'#E1F5EE',tx:'#085041'}:st==='En armadora'?{bg:'#FAEEDA',tx:'#633806'}:{bg:'#E6F1FB',tx:'#1A4480'};
                      return h('select', {
                        value: st,
                        onChange: e => onSave({ ...v, statusEntrega: e.target.value }),
                        style: { fontSize:11, fontWeight:500, padding:'3px 22px 3px 10px', borderRadius:10, whiteSpace:'nowrap', background:col.bg, color:col.tx, border:'none', cursor:'pointer', appearance:'none', WebkitAppearance:'none', backgroundImage:'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'10\' viewBox=\'0 0 12 12\'><path d=\'M3 5l3 3 3-3\' stroke=\'%23666\' stroke-width=\'1.5\' fill=\'none\'/></svg>")', backgroundRepeat:'no-repeat', backgroundPosition:'right 6px center' },
                      },
                        ['En agencia/planta','En armadora','Entregada','Cobrada'].map(op => h('option', { key:op, value:op }, op))
                      );
                    })()
                  ),
                  puedeCostos && h('td', { style:{ padding:'10px 6px', fontSize:11, color:fc===2?'var(--green)':'var(--amber)' } }, fc+'/2'),
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
export function VehicleForm({ vehicle, projectId, onSave, onSaveMany, onCancel, user }) {
  const [v, sV] = useState(vehicle || { id:uid('VEH'), projectId, marca:'', modelo:'', version:'', ano:'', color:'', vin:'', numMotor:'', numInventario:'', precioUnitario:0, iva:0, precioTotal:0, equipamiento:'', statusDocs:'Pendiente', statusEntrega:'Pendiente', ubicacion:'', observaciones:'', facturaAgencia:{}, facturaIntermedia:{}, facturaEquipo:{}, facturaGobierno:{}, actaEntrega:{} });
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
        const storagePath = `vehiculos/${vehId}/factura-agencia-${Date.now()}-${file.name}`;
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
    setFactBusy(true); setFactMsg('🤖 Analizando factura...');
    try {
      const d = await analyzeFactura(file);
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
        // Fase 2F1B: costo de origen/proveedor -- ahora visible/editable
        // para empleado operativo (verCostosProveedor), no solo admin.
        getPermissions(user).verCostosProveedor && h('div', { className:'card', style:{ marginBottom:16 } },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos económicos'),
          h(Inp, { label:'Precio unitario (sin IVA)', value:v.precioUnitario, onChange:val=>set('precioUnitario',val), type:'number', hint:'El IVA (16%) se calcula automáticamente' }),
          h(Inp, { label:'IVA', value:v.iva, onChange:val=>set('iva',val), type:'number' }),
          h(Inp, { label:'Precio total', value:v.precioTotal, onChange:val=>set('precioTotal',val), type:'number' }),
        ),
        h('div', { className:'card' },
          h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Estatus'),
          h(Inp, { label:'Estatus documentación', value:v.statusDocs, onChange:val=>set('statusDocs',val), options:['Pendiente','En proceso','Completa','Entregada'] }),
          h(Inp, { label:'Estatus entrega', value:v.statusEntrega, onChange:val=>set('statusEntrega',val), options:['En agencia/planta','En armadora','Entregada','Cobrada'] }),
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
    setAnalizando(true); setMsg('🤖 Analizando PDF con Claude...');
    try {
      const d = await analyzeFactura(file);
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
        h('span', { onClick:async()=>{ const u = await signedUrl(f.xmlData, 3600); if (!u) { alert('No se pudo generar el enlace de descarga.'); return; } dlStorage(u, f.xmlNombre); }, style:{ color:'var(--blue)', cursor:'pointer', textDecoration:'underline' } }, 'descargar')),
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
  const puedeCostos = getPermissions(user).verCostosProveedor;
  const puedeFinanciero = getPermissions(user).verVehiculosFinancieros;
  const updFact = (key, fac) => { onUpdate({...vehicle,[key]:fac}); if(logFn)logFn(user,'actualizó factura '+key,'vehículo',vehicle.id,fac.folio||''); };
  // Fase 2F1B: la pestaña de Facturación ahora se muestra con
  // verCostosProveedor (admin la sigue viendo por verVehiculosFinancieros,
  // que ya implica costos). El número de tarjetas visibles se calcula
  // dinámicamente en vez de un "(2)" fijo, porque ahora varía por rol:
  // admin ve 4 (agencia/equipo/intermedia/gobierno), empleado ve 2
  // (agencia/equipo).
  const numFacturasVisibles = puedeFinanciero ? 4 : (puedeCostos ? 2 : 0);
  const tabs = [{id:'info',l:'Información'}, ...(puedeCostos?[{id:'facturas',l:'Facturación ('+numFacturasVisibles+')'}]:[]), {id:'entrega',l:'Acta entrega'}];
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
    h('div', { className:'grid-4', style:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 } },
      puedeCostos && h(Metric, { label:'Precio total', value:fmt(vehicle.precioTotal), sub:'Unit: '+fmt(vehicle.precioUnitario)+' + IVA '+fmt(vehicle.iva) }),
      h(Metric, { label:'Estatus docs', value:vehicle.statusDocs||'—' }),
      h(Metric, { label:'Estatus entrega', value:vehicle.statusEntrega||'—', sc:['Entregada','Cobrada'].includes(vehicle.statusEntrega)?'var(--green)':undefined }),
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
      // Fase 2F1B: Agencia y Equipo son costo de origen/proveedor -- ahora
      // visibles/editables para empleado operativo (verCostosProveedor).
      puedeCostos && h(FacturaCard, { title:'Factura de la agencia (compra)', subtitle:'La agencia automotriz me factura este vehículo', color:'#5B8DEF', data:vehicle.facturaAgencia||{}, onSave:f=>updFact('facturaAgencia',f) }),
      puedeCostos && h(FacturaCard, { title:'Factura de equipo', subtitle:'Proveedores de equipamiento (torretas, sirenas, etc.)', color:'#3F8F6B', data:vehicle.facturaEquipo||{}, onSave:f=>updFact('facturaEquipo',f) }),
      // Intermedia y Gobierno son estratégicas (estructura entre empresas /
      // venta al cliente final) -- siguen admin-only, sin cambio.
      puedeFinanciero && h(FacturaCard, { title:'Factura de reventa (intermedia)', subtitle:'Venta entre empresas (ej: Broking a SATHRI)', color:'#9B7EDE', data:vehicle.facturaIntermedia||{}, onSave:f=>updFact('facturaIntermedia',f) }),
      puedeFinanciero && h(FacturaCard, { title:'Factura al cliente final (gobierno)', subtitle:'Yo facturo el vehículo equipado al cliente', color:'#1D9E75', data:vehicle.facturaGobierno||{}, onSave:f=>updFact('facturaGobierno',f) }),
    ),
    tab==='entrega' && h(ActaEntrega, { vehicle, project, company, onUpdate }),
  );
}

// ── ActaEntrega ───────────────────────────────────────────────
export function ActaEntrega({ vehicle, project, company, onUpdate }) {
  const acta = vehicle.actaEntrega || {};
  const set  = (k, v) => onUpdate({ ...vehicle, actaEntrega: { ...acta, [k]:v } });
  const [subiendo, setSubiendo] = useState(false);
  const actaFileRef = useRef(null);
  const subirActaFirmada = async (file) => {
    if (!file) return;
    setSubiendo(true);
    try {
      const path = `vehiculos/${vehicle.id}/acta-firmada-${Date.now()}-${file.name}`;
      const url = await uploadFileToStorage(path, file);
      set('archivoFirmado', { url:url||'', nombre:file.name, size:file.size, tipo:file.type||'', fecha:TODAY() });
    } catch(e) { console.error(e); alert('Error al subir el acta'); }
    setSubiendo(false);
  };
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
      // Subir acta firmada
      h('div', { style:{ marginTop:16, paddingTop:16, borderTop:'.5px solid var(--b3)' } },
        h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:8 } }, 'Acta de entrega firmada'),
        acta.archivoFirmado?.url
          ? h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'10px 12px', background:'var(--bg2)', borderRadius:'var(--r)' } },
              h('div', { style:{ minWidth:0 } },
                h('div', { style:{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis' } }, '📄 '+acta.archivoFirmado.nombre),
                h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } }, 'Subida '+acta.archivoFirmado.fecha+(acta.archivoFirmado.size?' · '+fmtBytes(acta.archivoFirmado.size):'')),
              ),
              h('div', { style:{ display:'flex', gap:8, flexShrink:0 } },
                h('button', { onClick:()=>abrirArchivo(acta.archivoFirmado.url), style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', cursor:'pointer' } }, 'Ver'),
                h('button', { onClick:()=>set('archivoFirmado',null), style:{ fontSize:11, color:'var(--red)', background:'transparent', border:'none', cursor:'pointer' } }, 'Quitar'),
              ),
            )
          : h('div', null,
              h('input', { ref:actaFileRef, type:'file', accept:'application/pdf,image/*', style:{ display:'none' }, disabled:subiendo, onChange:e=>{ subirActaFirmada(e.target.files[0]); e.target.value=''; } }),
              h('button', { disabled:subiendo, onClick:()=>actaFileRef.current&&actaFileRef.current.click(), style:{ fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:subiendo?'wait':'pointer' } }, subiendo?'Subiendo...':'📎 Subir acta firmada'),
              h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:6 } }, 'Sube el acta firmada y sellada (PDF o foto).'),
            ),
      ),
    ),
  );
}

// ── BillingTab ────────────────────────────────────────────────
export function BillingTab({ project, vehicles, onNav }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Analiza una factura (PDF o XML), extrae datos y crea/actualiza el vehículo + su factura
  const subirFactura = async (files, tipoFactura) => {
    if (!files || !files.length) return;
    setBusy(true);
    let creados = 0, errores = 0;
    // Mapa local de vehículos tocados en esta tanda (el estado de React no se actualiza entre iteraciones)
    const locales = {};
    vehicles.forEach(v => { if (v.vin) locales[(v.vin||'').trim().toUpperCase()] = { ...v }; });
    for (const file of files) {
      try {
        setMsg('🤖 Analizando '+file.name+'...');
        let datos;
        const esXML = file.name.toLowerCase().endsWith('.xml');
        if (esXML) {
          // CFDI XML: parsear directamente (no requiere IA)
          const text = await file.text();
          datos = parseCFDI(text);
        } else {
          datos = await analyzeFactura(file);
        }
        // Subir el archivo a almacenamiento
        const vehId = uid('VEH');
        const storagePath = `vehiculos/${vehId}/factura-${tipoFactura}-${Date.now()}-${file.name}`;
        const url = await uploadFileToStorage(storagePath, file);
        // Nota automática tipo "Nissan Surman a Broking"
        const nota = [datos.emisor, datos.receptor].filter(Boolean).join(' a ');
        const facObj = {
          folio: datos.folio||'', fecha: datos.fecha||'', emisor: datos.emisor||'', receptor: datos.receptor||'',
          uuid: datos.uuid||'', subtotal: datos.subtotal||0, iva: datos.iva||0, total: datos.total||0,
          statusPago: 'Pendiente', nota, xmlNombre: file.name, xmlData: url || '',
        };
        const vinNorm = (datos.vin||'').trim().toUpperCase();
        const campoFactura = tipoFactura==='agencia' ? 'facturaAgencia' : tipoFactura==='gobierno' ? 'facturaGobierno' : tipoFactura==='intermedia' ? 'facturaIntermedia' : 'facturaEquipo';
        // ¿Ya existe (en estado o en esta tanda) un vehículo con este VIN?
        let existente = vinNorm ? locales[vinNorm] : null;
        // Si la factura no trae VIN (común en reventas) y hay un solo vehículo en el proyecto, asignarla a ese
        if (!existente && !vinNorm) {
          const listaLocal = Object.values(locales);
          if (listaLocal.length === 1) existente = listaLocal[0];
          else if (listaLocal.length > 1) { setMsg('⚠️ La factura no trae VIN y hay varios vehículos. Súbela desde el detalle del vehículo correspondiente.'); errores++; continue; }
        }
        if (existente) {
          const actualizado = { ...existente, [campoFactura]: facObj, vin: existente.vin || vinNorm };
          if (vinNorm) locales[vinNorm] = actualizado;
          onNav('save_vehicle', actualizado);
        } else {
          const nuevo = {
            id: vehId, projectId: project.id,
            marca: datos.marca||'', modelo: datos.modelo||'', version:'', ano: datos.ano||'', color: datos.color||'',
            vin: vinNorm, numMotor: datos.numMotor||'', numInventario:'',
            precioUnitario: datos.subtotal||0, iva: datos.iva||0, precioTotal: datos.total||0,
            equipamiento:'', statusDocs:'Pendiente', statusEntrega:'Pendiente', ubicacion:'', observaciones: nota,
            facturaAgencia:{}, facturaEquipo:{}, facturaIntermedia:{}, facturaGobierno:{}, actaEntrega:{},
            [campoFactura]: facObj,
          };
          if (vinNorm) locales[vinNorm] = nuevo;
          onNav('save_vehicle', nuevo);
        }
        creados++;
      } catch(e) { console.error(e); errores++; setMsg('Error en '+file.name+': '+e.message); }
    }
    setBusy(false);
    if (!errores) setMsg('✅ '+creados+' factura(s) procesada(s). VIN y folio agregados a Vehículos.');
  };

  const totals = { agencia:{count:0,total:0,pagadas:0}, intermedia:{count:0,total:0,pagadas:0}, equipo:{count:0,total:0,pagadas:0}, gobierno:{count:0,total:0,pagadas:0} };
  vehicles.forEach(v => {
    [['agencia','facturaAgencia'],['intermedia','facturaIntermedia'],['gobierno','facturaGobierno']].forEach(([k,f]) => {
      const fc=v[f]; if(fc?.folio){totals[k].count++;totals[k].total+=(fc.total||0);if(['Pagada','Cobrada'].includes(fc.statusPago))totals[k].pagadas++;}
    });
  });

  const btnSubir = (label, tipo, color) => h('label', { style:{ fontSize:12, fontWeight:500, color, background:'var(--bg1)', border:'1px solid '+color+'55', borderRadius:'var(--r)', padding:'8px 14px', cursor:busy?'wait':'pointer', display:'inline-block' } },
    label,
    h('input', { type:'file', accept:'application/pdf,text/xml,.xml', multiple:true, style:{ display:'none' }, disabled:busy, onChange:e=>{ subirFactura(Array.from(e.target.files), tipo); e.target.value=''; } }),
  );

  return h('div', null,
    // Sección de carga de facturas
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:4 } }, 'Subir factura (PDF o XML)'),
      h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:12 } }, 'Se analiza automáticamente: folio, VIN, montos y nota (ej: «Surman a Broking»). El VIN se agrega a Vehículos.'),
      h('div', { style:{ display:'flex', gap:8, flexWrap:'wrap' } },
        btnSubir('📥 Compra (agencia → empresa)', 'agencia', '#5B8DEF'),
        btnSubir('🔄 Reventa (entre empresas)', 'intermedia', '#9B7EDE'),
        btnSubir('🔧 Equipo', 'equipo', '#EF9F27'),
        btnSubir('📤 Venta a cliente final', 'gobierno', '#1D9E75'),
      ),
      msg && h('div', { style:{ fontSize:12, color:msg.startsWith('✅')?'var(--green)':msg.startsWith('⚠️')||msg.startsWith('Error')?'var(--red)':'var(--t2)', marginTop:12, padding:'8px 10px', background:'var(--bg2)', borderRadius:8 } }, msg),
    ),
    vehicles.length===0
      ? h('div', { className:'card' }, h(EmptyState, { title:'Sin vehículos', description:'Sube una factura de agencia para crear el primer vehículo, o agrégalo manualmente en la pestaña Vehículos.' }))
      : h('div', null,
    h('div', { className:'grid-4', style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:20 } },
      [{k:'agencia',l:'Compra (agencia)',c:'#5B8DEF'},{k:'intermedia',l:'Reventa (intermedia)',c:'#9B7EDE'},{k:'equipo',l:'Equipo',c:'#EF9F27'},{k:'gobierno',l:'Venta final',c:'#1D9E75'}].map(g =>
        h('div', { key:g.k, className:'card', style:{ borderTop:'3px solid '+g.c } },
          h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:8 } }, g.l),
          h('div', { style:{ fontSize:18, fontWeight:500, marginBottom:6 } }, fmt(totals[g.k].total)),
          h('div', { style:{ fontSize:11, color:'var(--t2)' } }, totals[g.k].count,'/',vehicles.length,' facturas · ',totals[g.k].pagadas,' pagadas'),
        )
      )
    ),
    h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Detalle por vehículo'),
      h('div', { className:'tbl-scroll', style:{ overflowX:'auto', WebkitOverflowScrolling:'touch' } },
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
      ),
  );
}

// ── DocsTab ───────────────────────────────────────────────────
export function DocsTab({ project, vehicles, companies, config, onSaveCompany, onUpdate, user, logFn }) {
  const [newDoc, setNewDoc] = useState({ name:'', category:'Bases', notes:'', date:TODAY() });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const docs = project.docs || [];
  const vehs = vehicles || [];

  // Documentos automáticos del sistema (facturas de vehículos + órdenes de compra)
  // Fase 2A0 + 2F2: si el usuario no puede ver un tipo de factura, esa
  // entrada ni siquiera se construye — no se genera fileUrl/referencia
  // alguna para empleado, no solo se oculta el link. No debe aparecer ni
  // la fila. Fase 2F2: graduado -- agencia/equipo (costo de origen/
  // proveedor, ya abiertos en 2F1B) usan verCostosProveedor; intermedia/
  // gobierno (estratégicos) siguen exclusivos de verVehiculosFinancieros.
  const autoDocs = [];
  const permsDocs = getPermissions(user);
  vehs.forEach(v => {
    if (permsDocs.verCostosProveedor) {
      [['facturaAgencia','Factura de compra'],['facturaEquipo','Factura de equipo']].forEach(([campo,etiq]) => {
        const f = v[campo];
        if (f && f.folio) autoDocs.push({ id:'auto-'+v.id+'-'+campo, name:etiq+' '+f.folio+' ('+(v.vin||v.marca||'')+')', category:'Facturas', date:f.fecha||'', fileUrl:f.xmlData||'', notes:f.nota||'', auto:true });
      });
    }
    if (permsDocs.verVehiculosFinancieros) {
      [['facturaIntermedia','Factura de reventa'],['facturaGobierno','Factura a cliente']].forEach(([campo,etiq]) => {
        const f = v[campo];
        if (f && f.folio) autoDocs.push({ id:'auto-'+v.id+'-'+campo, name:etiq+' '+f.folio+' ('+(v.vin||v.marca||'')+')', category:'Facturas', date:f.fecha||'', fileUrl:f.xmlData||'', notes:f.nota||'', auto:true });
      });
    }
  });
  (project.ordenesCompra||[]).forEach(oc => {
    autoDocs.push({ id:'auto-oc-'+oc.id, name:'Orden de compra '+oc.folio+' · '+(oc.proveedor||''), category:'Órdenes de compra', date:oc.fecha||'', fileUrl:'', notes:'Generada en el sistema', auto:true });
  });

  // Agregar documento solo como referencia (sin archivo)
  const addDoc = () => {
    if (!newDoc.name) return;
    onUpdate({ ...project, docs:[...docs, { id:uid('doc'), ...newDoc }] });
    setNewDoc({ name:'', category:'Bases', notes:'', date:TODAY() });
    if (logFn) logFn(user,'registró documento','proyecto',project.id,newDoc.name);
  };

  // Subir archivo(s) reales al expediente
  const subirArchivos = async (files) => {
    if (!files || !files.length) return;
    setBusy(true);
    let nuevos = [];
    for (const file of files) {
      try {
        setMsg('Subiendo '+file.name+'...');
        const docId = uid('doc');
        const path = `proyectos/${project.id}/${docId}-${file.name}`;
        const url = await uploadFileToStorage(path, file);
        nuevos.push({
          id: docId, name: file.name, category: newDoc.category, notes: newDoc.notes||'',
          date: newDoc.date||TODAY(), fileUrl: url||'', fileName: file.name, fileSize: file.size, fileType: file.type||'',
        });
      } catch(e) { console.error(e); setMsg('Error con '+file.name); }
    }
    if (nuevos.length) {
      onUpdate({ ...project, docs:[...docs, ...nuevos] });
      if (logFn) logFn(user,'subió '+nuevos.length+' documento(s)','proyecto',project.id,project.name);
      setMsg('✅ '+nuevos.length+' archivo(s) agregado(s) al expediente.');
      setNewDoc(p=>({ ...p, name:'', notes:'' }));
      // Fase 2F2: notificar a admin en el Inbox cuando un EMPLEADO (no
      // admin) carga un documento -- referencia liviana (nombres/categoría),
      // NUNCA el archivo ni su URL real.
      if (!getPermissions(user).isAdmin) {
        try {
          await createInboxItem({
            type: 'documento_cargado',
            title: (nuevos.length>1?nuevos.length+' documentos cargados':'Documento cargado')+' en "'+(project.name||'proyecto sin nombre')+'"',
            message: nuevos.map(d=>d.name+' ('+d.category+')').join(', '),
            project_id: project.id,
            data: { categorias: [...new Set(nuevos.map(d=>d.category))], cantidad: nuevos.length },
          });
        } catch(e) { console.error('[DocsTab] No se pudo notificar en el inbox:', e); }
      }
    }
    setBusy(false);
  };

  const rmDoc = id => { if(confirm('¿Quitar este documento del expediente?')) onUpdate({ ...project, docs:docs.filter(d=>d.id!==id) }); };
  const verDoc = d => {
    // Si es un documento membretado, regenerar el PDF desde la empresa
    if (d.membretadoId) {
      const emp = (companies||[]).find(c => c.id === d.empresaId) || (companies||[]).find(c => c.name === project.company);
      const docM = emp && (emp.documentosMembretados||[]).find(x => x.id === d.membretadoId);
      if (docM) { printDocumentoMembretado({ empresa:emp, titulo:docM.titulo, cuerpo:docM.cuerpo, folio:docM.folio }); return; }
      alert('No se encontró el documento membretado original. Pudo haber sido eliminado desde la empresa.');
      return;
    }
    if (d.fileUrl) abrirArchivo(d.fileUrl);
  };
  const puedeVer = d => !!(d.fileUrl || d.membretadoId);

  // Combinar documentos manuales + automáticos del sistema
  const todosDocs = [...docs, ...autoDocs];
  const totalArchivos = todosDocs.filter(d=>d.fileUrl).length;

  const iconoTipo = (t='') => t.includes('pdf')?'📕':t.includes('image')?'🖼️':t.includes('xml')||t.includes('text')?'📄':t.includes('word')||t.includes('document')?'📘':t.includes('sheet')||t.includes('excel')?'📗':'📎';

  // Clasificar cada documento en uno de los 4 grupos
  const clasifica = (d) => {
    const cat = d.category||'';
    const nom = (d.name||'').toLowerCase();
    if (cat==='Órdenes de compra' || nom.includes('orden de compra')) return 'oc';
    if (cat==='Facturas') {
      if (nom.includes('equipo')) return 'fequipo';
      return 'fvehiculos'; // compra, reventa, venta a cliente
    }
    return 'docs'; // todo lo demás (bases, fallo, contrato, membretado, etc.)
  };
  const grupos = { fvehiculos:[], fequipo:[], oc:[], docs:[] };
  todosDocs.forEach(d => grupos[clasifica(d)].push(d));

  // Render de una fila de documento
  const renderDoc = (d) => h('div', { key:d.id, style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, padding:'10px 0', borderBottom:'.5px solid var(--b3)' } },
    h('div', { style:{ flex:1, minWidth:0 } },
      h('div', { style:{ fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 } },
        h('span', null, d.membretadoId?'📝':d.fileUrl?iconoTipo(d.fileType):'📄'),
        h('span', { style:{ overflow:'hidden', textOverflow:'ellipsis' } }, d.name),
      ),
      d.notes && h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:2 } }, d.notes),
      h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:2 } }, (d.category||'')+(d.date?' · '+d.date:''), d.fileSize?' · '+fmtBytes(d.fileSize):'', d.auto?' · del sistema':(d.fileUrl||d.membretadoId)?'':' · (solo referencia)'),
    ),
    h('div', { style:{ display:'flex', gap:8, flexShrink:0 } },
      puedeVer(d) && h('button', { onClick:()=>verDoc(d), style:{ fontSize:11, color:'var(--blue)', background:'transparent', border:'none', cursor:'pointer' } }, d.membretadoId?'Ver / Imprimir':'Ver'),
      !d.auto && h('button', { onClick:()=>rmDoc(d.id), style:{ fontSize:11, color:'var(--red)', background:'transparent', border:'none', cursor:'pointer' } }, 'Quitar'),
    ),
  );

  // Recuadro colapsable por grupo
  const recuadro = (titulo, icono, lista, color) => h('details', { key:titulo, className:'card', style:{ marginBottom:12, borderLeft:'3px solid '+color }, open:lista.length>0 && lista.length<=8 },
    h('summary', { style:{ cursor:'pointer', fontSize:14, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'space-between', listStyle:'none' } },
      h('span', null, icono+' '+titulo),
      h('span', { style:{ fontSize:12, fontWeight:400, color:'var(--t2)', background:'var(--bg2)', padding:'2px 10px', borderRadius:12 } }, lista.length),
    ),
    lista.length===0
      ? h('div', { style:{ fontSize:12, color:'var(--t3)', padding:'12px 0 4px' } }, 'Sin documentos en esta sección.')
      : h('div', { style:{ marginTop:10 } }, lista.map(renderDoc)),
  );

  return h('div', null,
    // Encabezado del expediente
    h('div', { className:'card', style:{ marginBottom:16, background:'linear-gradient(135deg, var(--bg2), var(--bg1))' } },
      h('div', { style:{ fontSize:15, fontWeight:600, marginBottom:4 } }, '🗂️ Expediente del proyecto'),
      h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Respaldo completo para defensa. ',
        h('strong', null, todosDocs.length+' documentos'),' · ',totalArchivos+' archivos guardados.'),
    ),
    // Subir / registrar
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Agregar al expediente'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 } },
        h(Inp, { label:'Categoría', value:newDoc.category, onChange:v=>setNewDoc(p=>({...p,category:v})), options:DOC_CATEGORIES }),
        h(Inp, { label:'Fecha', value:newDoc.date, onChange:v=>setNewDoc(p=>({...p,date:v})), type:'date' }),
      ),
      h(Inp, { label:'Notas (opcional)', value:newDoc.notes, onChange:v=>setNewDoc(p=>({...p,notes:v})), placeholder:'Ej: Fallo publicado en CompraNet' }),
      // Subir archivo real
      h('div', { style:{ marginTop:12, padding:'14px', border:'1.5px dashed var(--b2)', borderRadius:'var(--r)', textAlign:'center' } },
        h('input', { ref:fileRef, type:'file', multiple:true, accept:'application/pdf,image/*,text/xml,.xml,.doc,.docx,.xls,.xlsx', style:{ display:'none' }, disabled:busy, onChange:e=>{ subirArchivos(Array.from(e.target.files)); e.target.value=''; } }),
        h('button', { className:'bp', disabled:busy, onClick:()=>fileRef.current&&fileRef.current.click() }, busy?'Subiendo...':'📎 Subir archivo(s)'),
        h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:8 } }, 'PDF, imágenes, XML, Word, Excel. Se guarda con la categoría y fecha de arriba.'),
        msg && h('div', { style:{ fontSize:12, color:msg.startsWith('✅')?'var(--green)':'var(--t2)', marginTop:8 } }, msg),
      ),
      // Registrar solo referencia (sin archivo)
      h('details', { style:{ marginTop:12 } },
        h('summary', { style:{ fontSize:12, color:'var(--t2)', cursor:'pointer' } }, 'O registrar solo una referencia sin archivo'),
        h('div', { style:{ display:'flex', gap:8, marginTop:8 } },
          h(Inp, { label:'Nombre del documento', value:newDoc.name, onChange:v=>setNewDoc(p=>({...p,name:v})), placeholder:'Propuesta técnica V2' }),
          h('button', { style:{ alignSelf:'flex-end', whiteSpace:'nowrap', fontSize:13, padding:'8px 14px', background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' }, onClick:addDoc }, '+ Agregar'),
        ),
      ),
    ),
    // Generador de documentos membretados (con la empresa del proyecto)
    (() => {
      const empresaProy = (companies||[]).find(c => c.name === project.company);
      if (!empresaProy) return null;
      return h('details', { className:'card', style:{ marginBottom:12, borderLeft:'3px solid #3B6CF4' } },
        h('summary', { style:{ cursor:'pointer', fontSize:14, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'space-between', listStyle:'none' } },
          h('span', null, '📝 Crear documento membretado'),
          h('span', { style:{ fontSize:11, fontWeight:400, color:'var(--t2)' } }, empresaProy.nombreComercial||empresaProy.name),
        ),
        h('div', { style:{ marginTop:14 } },
          h(DocumentosMembretados, {
            company: empresaProy, projects:[project], config,
            onUpdate: (updated)=>{ if(onSaveCompany) onSaveCompany(updated); },
            onUpdateProject: (p)=>onUpdate(p),
          }),
        ),
      );
    })(),
    // 4 recuadros agrupados
    recuadro('Facturas de vehículos', '🚗', grupos.fvehiculos, '#5B8DEF'),
    recuadro('Facturas de equipo', '🔧', grupos.fequipo, '#EF9F27'),
    recuadro('Órdenes de compra', '🛒', grupos.oc, '#9B7EDE'),
    recuadro('Documentos', '📁', grupos.docs, '#1D9E75'),
  );
}
