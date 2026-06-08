// Admin.js — Reportes, Configuración y Bitácora
import { h, useState, useMemo } from '../lib/core.js';
import { STATUSES, DEFAULT_CONFIG } from '../lib/constants.js';
import { toExcel, shProjects, shVehicles, shFacturas, shPagos, shEntregas, shEmpresas, shAlertas, shAuditoria, shSumEjecutivo } from '../lib/excel.js';
import { fmt, storageMB, TODAY } from '../lib/utils.js';
import { Inp, Metric } from '../ui/primitives.js';

export function Reports({ projects, vehicles, companies, audit }) {
  const [status, setStatus]   = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]   = useState('');
  const [generating, setGenerating] = useState(false);
  const filtered = useMemo(() => {
    let list = [...projects];
    if (status!=='all') list=list.filter(p=>p.status===status);
    if (dateFrom) list=list.filter(p=>(p.fechaPublicacion||p.id)>=dateFrom);
    if (dateTo)   list=list.filter(p=>(p.fechaPublicacion||p.id)<=dateTo);
    return list;
  }, [projects,status,dateFrom,dateTo]);
  const filtVehicles = vehicles.filter(v=>filtered.some(p=>p.id===v.projectId));
  const doExport = async () => {
    setGenerating(true);
    try {
      toExcel([shSumEjecutivo(filtered,filtVehicles,companies),shProjects(filtered,vehicles,companies),shVehicles(filtVehicles,filtered),shFacturas(filtVehicles,filtered),shPagos(filtVehicles,filtered),shEntregas(filtVehicles,filtered),shEmpresas(companies),shAlertas(filtered),shAuditoria(audit)],
        `LicitaPro_Reporte_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch(e){ alert('Error: '+e.message); }
    setGenerating(false);
  };
  const ac=projects.filter(p=>!['cobrado','perdida','cancelada'].includes(p.status));
  const won=projects.filter(p=>['ganada','contrato','entrega','facturado','cobrado'].includes(p.status));
  const lost=projects.filter(p=>p.status==='perdida');
  const [migRunning, setMigRunning] = useState(false);
  const [migStatus, setMigStatus]   = useState('');
  const [migDone,   setMigDone]     = useState(false);
  const log = (msg) => setMigStatus(prev => prev + msg + '\n');

  const runMigration = async () => {
    setMigRunning(true); setMigStatus('Iniciando migración...\n'); setMigDone(false);
    let total = 0, migrated = 0, errors = 0;
    const UID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

    // ── 1. Fotos del catálogo (customProducts) ──
    try {
      log('\n📷 Fotos del catálogo...');
      const prods = (cfg?.customProducts || []);
      for (const prod of prods) {
        if (prod.photo && isBase64(prod.photo)) {
          total++;
          try {
            const path = `catalog/${prod.id || uid('prd')}.jpg`;
            const blob = base64ToBlob(prod.photo, 'image/jpeg');
            const url  = await uploadToStorage(path, blob, 'image/jpeg');
            if (url) { prod.photo = url; migrated++; log('  ✓ ' + (prod.nom||prod.id)); }
            else { errors++; log('  ✗ Sin Storage: ' + (prod.nom||prod.id)); }
          } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
        }
      }
      if (migrated > 0) { await onSave({ ...cfg, customProducts: prods }); log('  Guardado en config.'); }
    } catch(e) { log('Error en catálogo: ' + e.message); }

    // ── 2. Vehículos: XMLs de facturas ──
    try {
      log('\n🚗 XMLs de facturas de vehículos...');
      const { data: vRows } = await sb.from('vehicles').select('id,data').eq('user_id', UID);
      for (const row of (vRows||[])) {
        const v = row.data;
        let changed = false;
        for (const key of ['facturaAgencia','facturaGobierno']) {
          const f = v[key];
          if (f?.xmlData && isBase64(f.xmlData)) {
            total++;
            try {
              const path = `vehiculos/${v.id}/${key}-${f.xmlNombre||'factura.xml'}`;
              const blob = base64ToBlob(f.xmlData, 'text/xml');
              const url  = await uploadToStorage(path, blob, 'text/xml');
              if (url) { f.xmlData = url; changed = true; migrated++; log('  ✓ ' + (v.vin||v.id) + ' / ' + key); }
              else { errors++; log('  ✗ Sin Storage: ' + (v.vin||v.id)); }
            } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('vehicles').update({ data: v }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en vehículos: ' + e.message); }

    // ── 3. Documentos de empresas ──
    try {
      log('\n🏢 Documentos de empresas...');
      const { data: cRows } = await sb.from('companies').select('id,data').eq('user_id', UID);
      for (const row of (cRows||[])) {
        const c = row.data;
        let changed = false;
        // Documentos base
        for (const doc of (c.baseDocs||[])) {
          if (doc.fileData && isBase64(doc.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/${doc.id}-${doc.fileName||'doc.pdf'}`;
              const blob = base64ToBlob(doc.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { doc.fileData = url; changed = true; migrated++; log('  ✓ ' + (c.nombre||c.id) + '/' + doc.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        // Reformas
        for (const ref of (c.reformas||[])) {
          if (ref.fileData && isBase64(ref.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/reformas/${ref.id}-${ref.name||'reforma.pdf'}`;
              const blob = base64ToBlob(ref.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { ref.fileData = url; changed = true; migrated++; log('  ✓ Reforma: ' + ref.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('companies').update({ data: c }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en empresas: ' + e.message); }

    log('\n─────────────────────────────');
    log('Total encontrados: ' + total);
    log('Migrados a Storage: ' + migrated);
    log('Errores: ' + errors);
    setMigRunning(false);
    if (migrated > 0) setMigDone(true);
  };

  return h('div', null,
    h('div', { className:'page-title', style:{ marginBottom:16 } }, 'Reportes y exportación'),
    h('div', { className:'grid-4', style:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 } },
      h(Metric, { label:'Proyectos totales', value:projects.length }),
      h(Metric, { label:'Pipeline activo', value:fmt(ac.reduce((s,p)=>s+(p.montoEstimado||0),0)), sub:ac.length+' proyectos' }),
      h(Metric, { label:'Ganado', value:fmt(won.reduce((s,p)=>s+(p.montoEstimado||0),0)), sub:won.length+' proyectos', sc:'var(--green)' }),
      h(Metric, { label:'Perdido', value:lost.length+' proy.', sc:'var(--red)' }),
    ),
    h('div', { className:'card', style:{ marginBottom:16 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Filtros del reporte'),
      h('div', { className:'grid-3', style:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 } },
        h(Inp, { label:'Estado', value:status, onChange:v=>setStatus(v), options:['all',...STATUSES.map(s=>s.id)] }),
        h(Inp, { label:'Desde', value:dateFrom, onChange:v=>setDateFrom(v), type:'date' }),
        h(Inp, { label:'Hasta', value:dateTo, onChange:v=>setDateTo(v), type:'date' }),
      ),
      h('div', { style:{ fontSize:12, color:'var(--t2)', marginTop:8 } }, 'Proyectos en filtro: ', h('strong', null, filtered.length), ' · Vehículos: ', h('strong', null, filtVehicles.length)),
    ),
    h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:8 } }, 'Exportar a Excel (.xlsx)'),
      h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:14, lineHeight:1.6 } }, 'Genera un archivo con 9 hojas: Resumen ejecutivo, Proyectos, Vehículos, Facturas, Pagos, Entregas, Empresas, Alertas, Bitácora.'),
      h('div', { style:{ display:'flex', gap:12, flexWrap:'wrap' } },
        h('button', { className:'bp', onClick:doExport, disabled:generating, style:{ fontSize:14, padding:'10px 20px' } }, generating?'⏳ Generando…':'⬇ Exportar Excel completo'),
        h('button', { onClick:()=>toExcel([shProjects(filtered,vehicles,companies)],`Proyectos_${TODAY()}.xlsx`), style:{ fontSize:13, padding:'10px 16px' } }, 'Solo proyectos'),
        h('button', { onClick:()=>toExcel([shVehicles(filtVehicles,filtered)],`Vehiculos_${TODAY()}.xlsx`), style:{ fontSize:13, padding:'10px 16px' } }, 'Solo vehículos'),
      ),
    ),
    // ── Migración a Storage ──────────────────────────────────────
    h('div', { className:'card', style:{ marginTop:20 } },
      h('div', { style:{ fontSize:14, fontWeight:600, marginBottom:4 } }, '📦 Migrar archivos existentes a Supabase Storage'),
      h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } },
        'Sube a Storage todos los archivos (fotos del catálogo, XMLs de facturas, documentos de empresas) que están guardados como base64 en la base de datos. Los nuevos ya van directo a Storage; este botón migra los que ya estaban guardados antes.'
      ),
      migStatus && h('div', { style:{ marginBottom:10, padding:'10px 14px', background:'var(--bg2)', borderRadius:'var(--r)', fontSize:12, fontFamily:'monospace', whiteSpace:'pre-wrap', maxHeight:200, overflowY:'auto' } }, migStatus),
      h('div', { style:{ display:'flex', gap:10, flexWrap:'wrap' } },
        h('button', { onClick:runMigration, disabled:migRunning,
          style:{ padding:'10px 20px', borderRadius:'var(--r)', background:'var(--blue)', color:'white', border:'none', cursor:migRunning?'wait':'pointer', fontWeight:600, opacity:migRunning?.6:1 } },
          migRunning ? '⏳ Migrando...' : '🚀 Iniciar migración'),
        migDone && h('span', { style:{ fontSize:12, color:'var(--green)', alignSelf:'center' } }, '✅ Migración completada'),
      ),
    ),
  );
}

export function Settings({ config, user, onSave }) {
  const [cfg, setCfg] = useState(JSON.parse(JSON.stringify(config||DEFAULT_CONFIG)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [newPType, setNewPType]   = useState('');
  const set = (k,v) => setCfg(p=>({...p,[k]:v}));
  const doSave = async () => { setSaving(true); setSaved(false); try{ await onSave(cfg); setSaved(true); setTimeout(()=>setSaved(false),2000); }catch(e){alert('Error: '+e.message);} setSaving(false); };
  const addStatus = () => { if(newStatus.trim()){set('customStatuses',[...(cfg.customStatuses||[]),newStatus.trim()]);setNewStatus('');} };
  const rmStatus  = i  => set('customStatuses',(cfg.customStatuses||[]).filter((_,j)=>j!==i));
  const addPType  = () => { if(newPType.trim()){set('customProductTypes',[...(cfg.customProductTypes||[]),newPType.trim()]);setNewPType('');} };
  const rmPType   = i  => set('customProductTypes',(cfg.customProductTypes||[]).filter((_,j)=>j!==i));
  const [migRunning, setMigRunning] = useState(false);
  const [migStatus, setMigStatus]   = useState('');
  const [migDone,   setMigDone]     = useState(false);
  const log = (msg) => setMigStatus(prev => prev + msg + '\n');

  const runMigration = async () => {
    setMigRunning(true); setMigStatus('Iniciando migración...\n'); setMigDone(false);
    let total = 0, migrated = 0, errors = 0;
    const UID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

    // ── 1. Fotos del catálogo (customProducts) ──
    try {
      log('\n📷 Fotos del catálogo...');
      const prods = (cfg?.customProducts || []);
      for (const prod of prods) {
        if (prod.photo && isBase64(prod.photo)) {
          total++;
          try {
            const path = `catalog/${prod.id || uid('prd')}.jpg`;
            const blob = base64ToBlob(prod.photo, 'image/jpeg');
            const url  = await uploadToStorage(path, blob, 'image/jpeg');
            if (url) { prod.photo = url; migrated++; log('  ✓ ' + (prod.nom||prod.id)); }
            else { errors++; log('  ✗ Sin Storage: ' + (prod.nom||prod.id)); }
          } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
        }
      }
      if (migrated > 0) { await onSave({ ...cfg, customProducts: prods }); log('  Guardado en config.'); }
    } catch(e) { log('Error en catálogo: ' + e.message); }

    // ── 2. Vehículos: XMLs de facturas ──
    try {
      log('\n🚗 XMLs de facturas de vehículos...');
      const { data: vRows } = await sb.from('vehicles').select('id,data').eq('user_id', UID);
      for (const row of (vRows||[])) {
        const v = row.data;
        let changed = false;
        for (const key of ['facturaAgencia','facturaGobierno']) {
          const f = v[key];
          if (f?.xmlData && isBase64(f.xmlData)) {
            total++;
            try {
              const path = `vehiculos/${v.id}/${key}-${f.xmlNombre||'factura.xml'}`;
              const blob = base64ToBlob(f.xmlData, 'text/xml');
              const url  = await uploadToStorage(path, blob, 'text/xml');
              if (url) { f.xmlData = url; changed = true; migrated++; log('  ✓ ' + (v.vin||v.id) + ' / ' + key); }
              else { errors++; log('  ✗ Sin Storage: ' + (v.vin||v.id)); }
            } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('vehicles').update({ data: v }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en vehículos: ' + e.message); }

    // ── 3. Documentos de empresas ──
    try {
      log('\n🏢 Documentos de empresas...');
      const { data: cRows } = await sb.from('companies').select('id,data').eq('user_id', UID);
      for (const row of (cRows||[])) {
        const c = row.data;
        let changed = false;
        // Documentos base
        for (const doc of (c.baseDocs||[])) {
          if (doc.fileData && isBase64(doc.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/${doc.id}-${doc.fileName||'doc.pdf'}`;
              const blob = base64ToBlob(doc.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { doc.fileData = url; changed = true; migrated++; log('  ✓ ' + (c.nombre||c.id) + '/' + doc.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        // Reformas
        for (const ref of (c.reformas||[])) {
          if (ref.fileData && isBase64(ref.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/reformas/${ref.id}-${ref.name||'reforma.pdf'}`;
              const blob = base64ToBlob(ref.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { ref.fileData = url; changed = true; migrated++; log('  ✓ Reforma: ' + ref.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('companies').update({ data: c }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en empresas: ' + e.message); }

    log('\n─────────────────────────────');
    log('Total encontrados: ' + total);
    log('Migrados a Storage: ' + migrated);
    log('Errores: ' + errors);
    setMigRunning(false);
    if (migrated > 0) setMigDone(true);
  };

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { style:{ fontSize:20, fontWeight:500 } }, 'Configuración'),
      h('div', { style:{ display:'flex', gap:8, alignItems:'center' } },
        saved && h('span', { style:{ fontSize:12, color:'var(--green)' } }, '✓ Guardado'),
        h('button', { className:'bp', onClick:doSave, disabled:saving }, saving?'Guardando…':'Guardar cambios'),
      ),
    ),
    h('div', { className:'mob-1col', style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 } },
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Organización'),
        h(Inp, { label:'Nombre del grupo', value:cfg.groupName||'', onChange:v=>set('groupName',v) }),
        h(Inp, { label:'Moneda', value:cfg.currency||'MXN', onChange:v=>set('currency',v), options:['MXN','USD','EUR'] }),
        h('div', { className:'card', style:{ background:'var(--bg2)', border:'none' } },
          h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Usuario activo'),
          h('div', { style:{ fontSize:13, fontWeight:500 } }, user?.email||'—'),
        ),
      ),
      h('div', { className:'card', style:{ marginBottom:16 } },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Datos para cotización cliente'),
        h('div', { style:{ fontSize:12, color:'var(--t2)', marginBottom:12 } }, 'Aparecen en el encabezado de la Cotización Cliente PDF.'),
        h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
          h(Inp, { label:'Razón social', value:(cfg.empresa||{}).razonSocial||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),razonSocial:v}) }),
          h(Inp, { label:'Nombre comercial', value:(cfg.empresa||{}).nombreComercial||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),nombreComercial:v}) }),
          h(Inp, { label:'RFC', value:(cfg.empresa||{}).rfc||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),rfc:v}) }),
          h(Inp, { label:'Teléfono', value:(cfg.empresa||{}).telefono||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),telefono:v}) }),
          h(Inp, { label:'Correo', value:(cfg.empresa||{}).correo||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),correo:v}) }),
          h(Inp, { label:'Responsable comercial', value:(cfg.empresa||{}).responsable||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),responsable:v}) }),
          h(Inp, { label:'Cargo', value:(cfg.empresa||{}).cargo||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),cargo:v}) }),
        ),
        h(Inp, { label:'Dirección fiscal', value:(cfg.empresa||{}).direccion||'', onChange:v=>set('empresa',{...(cfg.empresa||{}),direccion:v}) }),
      h('div', { style:{ marginTop:24, paddingTop:20, borderTop:'1px solid var(--b2)' } },
        h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:12 } }, '🤖 Inteligencia Artificial'),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:12 } }, 'API Key de Anthropic (Claude) para análisis automático de bases de licitación y documentos. Obtén tu key en console.anthropic.com'),
        h('div', { style:{ marginBottom:14, padding:'10px 14px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12 } },
          h('div', { style:{ fontWeight:600, marginBottom:4 } }, '⚠ Recuperación: imágenes del catálogo'),
          h('div', { style:{ color:'var(--t2)', marginBottom:8 } }, 'Si la app tarda mucho al cargar, las imágenes del catálogo pueden ser muy pesadas. Usa este botón para limpiarlas.'),
          h('button', { onClick:async ()=>{
            if (!confirm('¿Quitar las fotos del catálogo personalizado? Los productos quedan, solo se eliminan las fotos.')) return;
            const cleaned = {...cfg, customProducts:(cfg.customProducts||[]).map(p=>({...p,photo:''}))};
            try { await onSave(cleaned); alert('✅ Fotos limpiadas. Ya puedes volver a agregar fotos más pequeñas.'); }
            catch(e) { alert('Error: '+e.message); }
          }, style:{ fontSize:12, padding:'6px 14px', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', background:'white', cursor:'pointer' } }, '🗑 Limpiar fotos del catálogo'),
        ),
        h(Inp, { label:'Anthropic API Key', value:(cfg.ia||{}).openaiKey||'', type:'password', onChange:v=>setCfg(c=>({...c,ia:{...(c.ia||{}),openaiKey:v}})) }),
      h('div', { style:{ marginTop:24, paddingTop:20, borderTop:'1px solid var(--b1)' } },
        h('div', { style:{ fontSize:13, fontWeight:600, marginBottom:8 } }, '📧 Notificaciones por correo'),
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:12 } }, 'API Key de Resend (resend.com) para enviar recordatorios mensuales a los contadores de cada empresa. El recordatorio se envía automáticamente el día 1 de cada mes.'),
        h(Inp, { label:'Resend API Key', value:(cfg.notif||{}).resendKey||'', type:'password', onChange:v=>setCfg(c=>({...c,notif:{...(c.notif||{}),resendKey:v}})) }),
        h(Inp, { label:'Correo remitente (debe estar verificado en Resend)', value:(cfg.notif||{}).fromEmail||'', onChange:v=>setCfg(c=>({...c,notif:{...(c.notif||{}),fromEmail:v}})), placeholder:'notificaciones@tudominio.com' }),
        h('div', { style:{ fontSize:10, color:'var(--t3)', marginTop:4 } }, '🔒 Tu API key se guarda encriptada. Obtén tu key en resend.com/api-keys'),
      ),
        h('div', { style:{ fontSize:10, color:'var(--t3)', marginTop:4 } }, '🔒 Tu API key se guarda en tu cuenta. Obtén créditos en console.anthropic.com/settings/billing')
      ),
      ),
      h('div', { className:'card' },
        h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:10 } }, 'Dependencias personalizadas'),
        (cfg.customStatuses||[]).map((s,i) =>
          h('div', { key:i, style:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'.5px solid var(--b3)', fontSize:13 } },
            h('span', null, s),
            h('button', { onClick:()=>rmStatus(i), style:{ fontSize:11, color:'var(--red)', background:'transparent', border:'none', cursor:'pointer' } }, 'Quitar'),
          )
        ),
        h('div', { style:{ display:'flex', gap:8, marginTop:10 } },
          h('input', { value:newStatus, onChange:e=>setNewStatus(e.target.value), placeholder:'Nueva dependencia…', style:{ flex:1 }, onKeyDown:e=>e.key==='Enter'&&addStatus() }),
          h('button', { onClick:addStatus }, '+ Agregar'),
        ),
      ),
    ),
  );
}

export function AuditLogView({ audit }) {
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('all');
  const [page, setPage]     = useState(0);
  const PAGE_SIZE = 50;
  const visible = useMemo(() => {
    let list=[...audit];
    if(search){const q=search.toLowerCase();list=list.filter(a=>(a.action||'').toLowerCase().includes(q)||(a.userName||'').toLowerCase().includes(q)||(a.details||'').toLowerCase().includes(q));}
    if(entity!=='all')list=list.filter(a=>a.entity===entity);
    return list;
  },[audit,search,entity]);
  const page_items = visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const pages = Math.ceil(visible.length/PAGE_SIZE);
  const entities = [...new Set(audit.map(a=>a.entity).filter(Boolean))];
  const [migRunning, setMigRunning] = useState(false);
  const [migStatus, setMigStatus]   = useState('');
  const [migDone,   setMigDone]     = useState(false);
  const log = (msg) => setMigStatus(prev => prev + msg + '\n');

  const runMigration = async () => {
    setMigRunning(true); setMigStatus('Iniciando migración...\n'); setMigDone(false);
    let total = 0, migrated = 0, errors = 0;
    const UID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

    // ── 1. Fotos del catálogo (customProducts) ──
    try {
      log('\n📷 Fotos del catálogo...');
      const prods = (cfg?.customProducts || []);
      for (const prod of prods) {
        if (prod.photo && isBase64(prod.photo)) {
          total++;
          try {
            const path = `catalog/${prod.id || uid('prd')}.jpg`;
            const blob = base64ToBlob(prod.photo, 'image/jpeg');
            const url  = await uploadToStorage(path, blob, 'image/jpeg');
            if (url) { prod.photo = url; migrated++; log('  ✓ ' + (prod.nom||prod.id)); }
            else { errors++; log('  ✗ Sin Storage: ' + (prod.nom||prod.id)); }
          } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
        }
      }
      if (migrated > 0) { await onSave({ ...cfg, customProducts: prods }); log('  Guardado en config.'); }
    } catch(e) { log('Error en catálogo: ' + e.message); }

    // ── 2. Vehículos: XMLs de facturas ──
    try {
      log('\n🚗 XMLs de facturas de vehículos...');
      const { data: vRows } = await sb.from('vehicles').select('id,data').eq('user_id', UID);
      for (const row of (vRows||[])) {
        const v = row.data;
        let changed = false;
        for (const key of ['facturaAgencia','facturaGobierno']) {
          const f = v[key];
          if (f?.xmlData && isBase64(f.xmlData)) {
            total++;
            try {
              const path = `vehiculos/${v.id}/${key}-${f.xmlNombre||'factura.xml'}`;
              const blob = base64ToBlob(f.xmlData, 'text/xml');
              const url  = await uploadToStorage(path, blob, 'text/xml');
              if (url) { f.xmlData = url; changed = true; migrated++; log('  ✓ ' + (v.vin||v.id) + ' / ' + key); }
              else { errors++; log('  ✗ Sin Storage: ' + (v.vin||v.id)); }
            } catch(e) { errors++; log('  ✗ Error: ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('vehicles').update({ data: v }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en vehículos: ' + e.message); }

    // ── 3. Documentos de empresas ──
    try {
      log('\n🏢 Documentos de empresas...');
      const { data: cRows } = await sb.from('companies').select('id,data').eq('user_id', UID);
      for (const row of (cRows||[])) {
        const c = row.data;
        let changed = false;
        // Documentos base
        for (const doc of (c.baseDocs||[])) {
          if (doc.fileData && isBase64(doc.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/${doc.id}-${doc.fileName||'doc.pdf'}`;
              const blob = base64ToBlob(doc.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { doc.fileData = url; changed = true; migrated++; log('  ✓ ' + (c.nombre||c.id) + '/' + doc.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        // Reformas
        for (const ref of (c.reformas||[])) {
          if (ref.fileData && isBase64(ref.fileData)) {
            total++;
            try {
              const path = `empresas/${c.id}/reformas/${ref.id}-${ref.name||'reforma.pdf'}`;
              const blob = base64ToBlob(ref.fileData, 'application/pdf');
              const url  = await uploadToStorage(path, blob, 'application/pdf');
              if (url) { ref.fileData = url; changed = true; migrated++; log('  ✓ Reforma: ' + ref.name); }
              else { errors++; }
            } catch(e) { errors++; log('  ✗ ' + e.message); }
          }
        }
        if (changed) {
          await sb.from('companies').update({ data: c }).eq('id', row.id);
        }
      }
    } catch(e) { log('Error en empresas: ' + e.message); }

    log('\n─────────────────────────────');
    log('Total encontrados: ' + total);
    log('Migrados a Storage: ' + migrated);
    log('Errores: ' + errors);
    setMigRunning(false);
    if (migrated > 0) setMigDone(true);
  };

  return h('div', null,
    h('div', { style:{ fontSize:20, fontWeight:500, marginBottom:16 } }, 'Bitácora de auditoría'),
    h('div', { style:{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' } },
      h('input', { value:search, onChange:e=>{setSearch(e.target.value);setPage(0);}, placeholder:'Buscar...', style:{ maxWidth:240 } }),
      h('select', { value:entity, onChange:e=>{setEntity(e.target.value);setPage(0);} },
        h('option', { value:'all' }, '— Todas las entidades —'),
        entities.map(e=>h('option',{key:e,value:e},e))
      ),
      h('span', { style:{ fontSize:12, color:'var(--t2)', alignSelf:'center' } }, visible.length,' registros'),
    ),
    visible.length===0
      ? h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)' } }, 'Sin registros.')
      : h('div', { className:'card' },
          h('div', { style:{ overflowX:'auto' } },
            h('table', { style:{ fontSize:12 } },
              h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
                ['Fecha','Usuario','Acción','Entidad','Detalles'].map(hd=>h('td',{key:hd,style:{padding:'8px 6px',color:'var(--t2)',fontSize:11}},hd))
              )),
              h('tbody', null, page_items.map((a,i) =>
                h('tr', { key:i, style:{ borderBottom:'.5px solid var(--b3)' } },
                  h('td', { style:{ padding:'9px 6px', whiteSpace:'nowrap', color:'var(--t2)' } }, new Date(a.timestamp).toLocaleString('es-MX')),
                  h('td', { style:{ padding:'9px 6px', fontWeight:500 } }, a.userName||'—'),
                  h('td', { style:{ padding:'9px 6px' } }, a.action||'—'),
                  h('td', { style:{ padding:'9px 6px', fontSize:11, color:'var(--blue)' } }, a.entity||'—'),
                  h('td', { style:{ padding:'9px 6px', color:'var(--t2)', maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, a.details||'—'),
                )
              ))
            )
          ),
          pages>1 && h('div', { style:{ display:'flex', gap:8, justifyContent:'center', marginTop:14, paddingTop:14, borderTop:'.5px solid var(--b3)' } },
            h('button', { onClick:()=>setPage(0), disabled:page===0 }, '«'),
            h('button', { onClick:()=>setPage(p=>Math.max(0,p-1)), disabled:page===0 }, '‹'),
            h('span', { style:{ fontSize:12, color:'var(--t2)', alignSelf:'center' } }, page+1,' / ',pages),
            h('button', { onClick:()=>setPage(p=>Math.min(pages-1,p+1)), disabled:page===pages-1 }, '›'),
            h('button', { onClick:()=>setPage(pages-1), disabled:page===pages-1 }, '»'),
          ),
        )
  );
}
