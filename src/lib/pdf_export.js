// pdf_export.js — Generador de PDFs para LicitaPro
// Tres plantillas: Cotización Cliente, Resumen Retornos, Resumen Interno
import { fmt, pctS, numeroALetras } from './utils.js';
import { calcCotizacion } from './calc.js';
import { CATALOG_IMAGES } from './catalog_images.js';
import { CATALOG_PRODUCTS, KIT_MAP } from './catalog.js';
import { getCompanyLogo } from './company_logos.js';
import { signedUrl } from './supabase.js';

// Convierte una URL de imagen (incluida storage privado) a base64 para incrustarla en el PDF.
// Si ya es base64 (data:), la devuelve tal cual. Si falla, devuelve cadena vacía.
async function imgABase64(url) {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  try {
    const firmada = await signedUrl(url, 3600);
    const resp = await fetch(firmada);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result || '');
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  } catch(e) { console.warn('No se pudo cargar imagen para PDF:', e); return ''; }
}

const IVA = 0.16;

// ── Estilos base compartidos ──────────────────────────────────
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #1a1917; background: #e8e8e8; margin: 0; padding: 0; }
  .sheet { width: 210mm; min-height: 297mm; padding: 10mm; margin: 50px auto 24px; background: white; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
  h1 { font-size: 18px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
  td { vertical-align: middle; overflow: hidden; }
  col.c-num  { width: 22px; }
  col.c-img  { width: 56px; }
  col.c-nom  { width: 16%; }
  col.c-desc { width: 22%; }
  col.c-cant { width: 30px; }
  col.c-pu   { width: 60px; }
  col.c-sub  { width: 70px; }
  /* Evitar que una fila (con su imagen) se parta entre páginas */
  tr, td { page-break-inside: avoid; break-inside: avoid; }
  td img { page-break-inside: avoid; break-inside: avoid; display: inline-block; vertical-align: middle; }
  thead { display: table-header-group; }
  th { background: #1a1917; color: white; padding: 6px 7px; text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .3px; }
  td { padding: 6px 7px; border-bottom: .5px solid #e0ddd8; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .mm-cell { white-space: nowrap; font-size: 9.5px; }
  .desc-cell { font-size: 8.5px; color: #6b6862; line-height: 1.35; }
  .total-row td { font-weight: 700; background: #f6f6f4; border-top: 1.5px solid #1a1917; }
  .section { margin-bottom: 24px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .label { color: #6b6862; font-size: 10px; margin-bottom: 2px; }
  .value { font-size: 12px; font-weight: 500; }
  .right { text-align: right; }
  .green { color: #1D9E75; }
  .red { color: #e24b4a; }
  .blue { color: #3b6cf4; }
  .amber { color: #d97706; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .confidential { background: #FCEBEB; color: #791F1F; font-size: 10px; padding: 6px 12px; border-radius: 4px; border-left: 3px solid #e24b4a; margin-bottom: 16px; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: .5px solid #e0ddd8; font-size: 10px; color: #a0998f; display: flex; justify-content: space-between; }
  @media print {
    body { background: white; }
    .sheet { width: auto; min-height: 0; padding: 12mm 14mm; margin: 0; box-shadow: none; }
    .no-print { display: none !important; }
  }
`;

// Genera un PDF en segundo plano (iframe oculto) y devuelve su base64, sin mostrar nada en pantalla.
// Útil para adjuntar el documento a un correo automáticamente.
function htmlToPdfBase64(html, filename) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:850px;height:1100px;border:none;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);

    const cleanup = () => { try { document.body.removeChild(iframe); } catch(e){} };
    let intentos = 0;
    const maxIntentos = 40; // ~10s máximo esperando que cargue html2pdf

    const generar = () => {
      const win = iframe.contentWindow;
      if (!win || !win.html2pdf) {
        intentos++;
        if (intentos > maxIntentos) { cleanup(); reject(new Error('No se pudo cargar el generador de PDF')); return; }
        setTimeout(generar, 250);
        return;
      }
      const el = win.document.querySelector('.sheet') || win.document.body;
      win.html2pdf().set({
        margin: 0,
        filename: filename || 'documento.pdf',
        image: { type:'jpeg', quality:0.96 },
        html2canvas: { scale:2, useCORS:true, backgroundColor:'#ffffff' },
        jsPDF: { unit:'mm', format:'a4', orientation:'portrait' },
        pagebreak: { mode:['css'], avoid:'tr' },
      }).from(el).outputPdf('datauristring').then(dataUri => {
        cleanup();
        resolve(dataUri.split(',')[1]); // solo el base64, sin el prefijo data:
      }).catch(e => { cleanup(); reject(e); });
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html.replace('</head>',
      '<scr' + 'ipt src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></scr' + 'ipt>' +
      '</head>'));
    doc.close();
    setTimeout(generar, 400);
  });
}

function openPrint(html, title) {
  // Overlay in-app con generación de PDF propia (sin encabezado/pie del navegador)
  const prev = document.getElementById('lp-print-overlay');
  if (prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.id = 'lp-print-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#e8e8e8;display:flex;flex-direction:column';

  const bar = document.createElement('div');
  bar.style.cssText = 'background:#1a1917;color:#fff;padding:max(10px,env(safe-area-inset-top)) 16px 10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-shrink:0';
  bar.innerHTML =
    '<button id="lpp-back" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45);padding:9px 18px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">← Volver</button>' +
    '<span style="font-weight:500;font-size:13px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (title||'Vista previa') + '</span>' +
    '<button id="lpp-pdf" style="background:#fff;color:#1a1917;border:none;padding:9px 18px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Descargar PDF</button>';

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;width:100%;border:none;background:#e8e8e8';

  overlay.appendChild(bar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html.replace('</head>',
    '<style>.no-print{display:none!important}</style>' +
    '<scr' + 'ipt src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></scr' + 'ipt>' +
    '</head>'));
  doc.close();
  if (title) { try { doc.title = title; } catch(e){} }

  bar.querySelector('#lpp-back').onclick = () => overlay.remove();

  const fname = (title || 'cotizacion').replace(/[^a-z0-9áéíóúñ \-]/gi, '').replace(/\s+/g, '_') + '.pdf';
  bar.querySelector('#lpp-pdf').onclick = () => {
    const win = iframe.contentWindow;
    const el = win.document.querySelector('.sheet');
    const btn = bar.querySelector('#lpp-pdf');
    if (!win.html2pdf || !el) {
      // Fallback: impresión nativa (puede mostrar encabezado en iOS)
      try { win.focus(); win.print(); } catch(e) { window.print(); }
      return;
    }
    btn.textContent = 'Generando...'; btn.disabled = true;
    // Quitar sombra/margen/altura forzada y subir el scroll al inicio antes de capturar
    const prevShadow = el.style.boxShadow, prevMargin = el.style.margin, prevMinH = el.style.minHeight;
    el.style.boxShadow = 'none'; el.style.margin = '0'; el.style.minHeight = 'auto';
    try { win.scrollTo(0, 0); } catch (e) {}
    const restore = () => { el.style.boxShadow = prevShadow; el.style.margin = prevMargin; el.style.minHeight = prevMinH; };
    win.html2pdf().set({
      margin: 0,
      filename: fname,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css'], avoid: 'tr' },
    }).from(el).save().then(() => {
      restore();
      btn.textContent = 'Descargar PDF'; btn.disabled = false;
    }).catch((e) => {
      restore();
      btn.textContent = 'Descargar PDF'; btn.disabled = false;
      alert('Error al generar PDF: ' + (e.message || e));
    });
  };
}

// ── helpers ───────────────────────────────────────────────────
const fmtDate = d => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' }); } 
  catch { return d; }
};

// ══════════════════════════════════════════════════════════════
// 1. COTIZACIÓN CLIENTE
// ══════════════════════════════════════════════════════════════
// Fase 2A0 — IMPORTANTE: este PDF va al cliente externo (gobierno). NUNCA
// debe incluir margen, utilidad, costos internos, retornos ni fianzas — esos
// datos viven exclusivamente en printResumenInterno (admin-only por uso).
// Si en el futuro se agrega una sección nueva aquí, verificar primero que no
// filtre ninguna cifra de costo/utilidad/margen de MSMS/Surman/Broking.
export async function printCotizacionCliente({ project, cot, calc, config, companyObj }) {
  // Datos del encabezado: priorizar la empresa del proyecto (si tiene datos), si no usar la config general
  const cfgEmp = config?.empresa || {};
  const emp = companyObj && companyObj.name ? {
    nombreComercial: companyObj.nombreComercial || companyObj.name,
    razonSocial: companyObj.name || '',
    rfc: companyObj.rfc || '',
    direccion: [companyObj.address, companyObj.cp, companyObj.ciudad, companyObj.estado].filter(Boolean).join(', '),
    telefono: companyObj.telefono || '',
    correo: companyObj.correo || '',
  } : cfgEmp;
  // Catálogo en vivo: productos base + personalizados del config
  const liveCatMap = {};
  [...CATALOG_PRODUCTS, ...(config?.customProducts || [])].forEach(p => { liveCatMap[p.id] = p; });

  // Pre-cargar fotos URL a base64 para que html2pdf pueda embebedlas
  const imgCache = {};
  const preloadImg = async (url) => {
    if (!url || url.startsWith('data:') || imgCache[url]) return;
    try {
      const firmada = await signedUrl(url, 3600);  // firmar para storage privado
      const resp = await fetch(firmada);
      const blob = await resp.blob();
      imgCache[url] = await new Promise(r => { const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(blob); });
    } catch(e) { imgCache[url] = ''; }
  };
  // Diagnóstico de fotos de vehículos
  const debugInfo = (cot.partidas||[]).map(p => ({
    id: p.id,
    vehiculoId: p.vehiculoId || 'NO SELECCIONADO',
    enCatalogo: !!(liveCatMap[p.vehiculoId]),
    photoLen: (liveCatMap[p.vehiculoId]?.photo || p.foto || '').slice(0,30),
  }));
  console.log('[PDF Vehículos]', debugInfo);
  window.__pdfDebug = debugInfo;

  // Recopilar fotos de vehículos — prioriza catálogo en vivo sobre snapshot guardado
  const allFotos = (cot.partidas||[]).map(p => {
    const live = liveCatMap[p.vehiculoId]?.photo || '';
    return live || p.foto || '';
  }).filter(Boolean);
  // Incluir el logo de la empresa y las fotos de equipo (solo las que son URL de storage, no base64 del catálogo)
  const logoEmpresa = getCompanyLogo(project.company, companyObj);
  const fotosEquipo = (cot.equipo||[]).map(e => {
    const live = liveCatMap[e.productoId];
    return (live?.photo) || '';
  }).filter(Boolean);
  const todasImgs = [...new Set([...allFotos, ...fotosEquipo, logoEmpresa].filter(Boolean))];
  await Promise.all(todasImgs.map(preloadImg));
  const resolveImg = (url) => {
    if (!url) return '';
    if (imgCache[url]) return imgCache[url];      // ya cargada como base64
    if (url.startsWith('data:')) return url;      // ya es base64
    return url;                                   // URL (fallback)
  };
  const logoResuelto = resolveImg(logoEmpresa);

  // Función para enriquecer cada entrada de equipo con datos actuales del catálogo
  const liveEq = (e) => {
    const live = liveCatMap[e.productoId];
    if (!live) return e;
    return { ...e, nombre: live.nom || e.nombre, descripcion: live.desc || e.descripcion, cat: live.cat || e.cat, vis: live.vis ?? e.vis };
  };

  // Mapa de kits efectivo: los kits editados en config sobrescriben los del catálogo base
  const effKitMap = { ...KIT_MAP };
  (config?.customProducts || []).forEach(p => {
    if (p.kitItems && p.kitItems.length) effKitMap[p.id] = p.kitItems;
    else if (p._esKit === false && effKitMap[p.id]) delete effKitMap[p.id]; // dejó de ser kit
  });
  const activeParts = (cot.partidas || []).filter(p => p.activo && p.cantidad > 0);

  const soloEq = cot.soloEquipo === true;
  const modoEq = cot.modoEquipo || 'margen';
  const margenGeneral = cot.margenEquipo != null ? cot.margenEquipo : 0.30;
  // Modo "monto a ganar": venta total = monto directo, repartido por unidad (costos ignorados)
  let _totalUnidsMonto = 0;
  if (soloEq && modoEq === 'monto') {
    activeParts.forEach(p => { _totalUnidsMonto += (p.cantidad || 0); });
  }
  const ventaUnitMonto = (_totalUnidsMonto > 0) ? (cot.montoGanar || 0) / _totalUnidsMonto : 0;
  const partRows = activeParts.map(p => {
    const pi = parseInt(p.id.replace('P','')) - 1;
    const qty = p.cantidad || 0;
    const vehSIVA_unit = soloEq ? 0 : (p.costoMSMS || 0) / (1 + IVA);
    const eqSIVA_unit = (cot.equipo || []).filter(e => e.usar && e.vis).reduce((s,e) => {
      const cnt = (e.cnts && e.cnts[pi]) || 0;
      return s + (e.llevaIVA ? (e.costoConIVA||0)/(1+IVA) : (e.costoConIVA||0)) * cnt;
    }, 0);
    const costoUnit = vehSIVA_unit + eqSIVA_unit;
    let pvUnit = 0;
    if (soloEq) {
      if (modoEq === 'monto') {
        pvUnit = ventaUnitMonto; // precio unitario directo (monto / total unidades)
      } else {
        // Precio = suma del equipo con su margen (por pieza/general)
        pvUnit = (cot.equipo || []).filter(e => e.usar && e.vis).reduce((s,e) => {
          const cnt = (e.cnts && e.cnts[pi]) || 0;
          const cSIVA = (e.llevaIVA ? (e.costoConIVA||0)/(1+IVA) : (e.costoConIVA||0)) * cnt;
          const m = (e.margenPropio != null) ? e.margenPropio : margenGeneral;
          return s + cSIVA * (1 + m);
        }, 0);
      }
    }
    else if (p.modoPrecio === 'Techo presupuestal') pvUnit = (p.techo||0) > 0 ? (p.techo||0)/(1+IVA)/qty : costoUnit;
    else if (p.modoPrecio === 'Utilidad deseada %') pvUnit = costoUnit * (1 + (p.utilidadPct||0));
    else pvUnit = costoUnit + (p.utilidadDeseada||0);
    const subtotal = pvUnit * qty;

    // Equipo visible para el cliente
    const eqItems = (cot.equipo||[]).map(liveEq).filter(e => e.usar && e.vis && (e.cnts&&e.cnts[pi]>0)).sort((a,b)=>(a.cat||'').localeCompare(b.cat||'','es',{numeric:true}));

    return { p, qty, pvUnit, subtotal, eqItems, pi };
  });

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Cotización ${cot.folio||''}</title>
<style>${BASE_CSS}
.header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #1a1917; }
.empresa-info { font-size: 10px; color: #6b6862; line-height: 1.7; }
.cot-title { text-align: right; }
.cot-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; background: #f6f6f4; padding: 14px 16px; border-radius: 6px; }
.partida-header { background: #f0ede8; padding: 8px 10px; font-weight: 700; font-size: 11px; margin-bottom: 0; border-radius: 4px 4px 0 0; }
.total-section { display: flex; justify-content: flex-end; margin-bottom: 24px; }
.total-box { min-width: 280px; }
.total-box table { margin-bottom: 0; }
.firma { margin-top: 50px; display: flex; justify-content: space-between; }
.firma-line { border-top: 1px solid #1a1917; width: 200px; padding-top: 8px; text-align: center; font-size: 10px; color: #6b6862; }
</style></head><body>

<div class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1917;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px">
  <span style="font-weight:500">Cotización Cliente — ${cot.folio||''}</span>
  <span style="display:flex;gap:8px"><button onclick="try{window.close()}catch(e){};setTimeout(function(){if(history.length>1)history.back()},100)" style="background:transparent;color:white;border:1px solid rgba(255,255,255,.4);padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">← Cerrar</button><button onclick="window.print()" style="background:white;color:#1a1917;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">Imprimir / Guardar PDF</button></span>
</div>
<div class="sheet">

<div class="header-top">
  <div class="empresa-info" style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0;padding-right:20px">
    ${logoResuelto ? `<img src="${logoResuelto}" style="height:60px;width:auto;max-width:120px;flex-shrink:0;object-fit:contain;background:#ffffff;padding:3px;border-radius:4px" />` : ''}
    <div style="min-width:0">
      <div style="font-size:12px;font-weight:700;color:#1a1917;margin-bottom:3px;line-height:1.3">${emp.nombreComercial||emp.razonSocial||'MSMS CORP'}</div>
      <div style="font-size:9.5px;line-height:1.45">${emp.razonSocial||''}</div>
      <div style="font-size:9.5px;line-height:1.45">${emp.rfc||''}</div>
      <div style="font-size:9.5px;line-height:1.45">${emp.direccion||''}</div>
      <div style="font-size:9.5px;line-height:1.45">${emp.telefono||''} ${emp.correo?'• '+emp.correo:''}</div>
    </div>
  </div>
  <div class="cot-title" style="flex-shrink:0">
    <h1>COTIZACIÓN</h1>
    <div style="font-size:12px;font-weight:500;color:#3b6cf4;margin-top:3px;letter-spacing:.5px">${cot.folio||'—'}</div>
  </div>
</div>

<div class="cot-meta">
  <div><div class="label">Fecha</div><div class="value">${fmtDate(cot.fechaCotizacion)}</div></div>
  <div><div class="label">Vigencia</div><div class="value">${cot.vigenciaDias||20} días naturales</div></div>
  <div>
    <div class="label">Para</div>
    <div class="value">${[cot.municipio||project.municipio, project.nivelGobierno].filter(Boolean).join(' · ') || '—'}</div>
  </div>
  <div>
    <div class="label">Dependencia / Área</div>
    <div class="value">${project.dependencia||'—'}</div>
  </div>
  <div><div class="label">Proyecto</div><div class="value">${project.name||'—'}</div></div>
  ${cot.vendedor?`<div><div class="label">Vendedor</div><div class="value">${cot.vendedor}${cot.vendedorCorreo?`<br><span style="font-size:9px;color:#6b6862">${cot.vendedorCorreo}</span>`:''}</div></div>`:''}
  ${project.ubicacion&&!project.municipio?`<div><div class="label">Ubicación</div><div class="value">${project.ubicacion}</div></div>`:''}
  ${cot.condicionesComerciales?`<div style="grid-column:1/-1"><div class="label">Condiciones</div><div class="value">${cot.condicionesComerciales}</div></div>`:''}
</div>

${partRows.map(({p, qty, pvUnit, subtotal, eqItems, pi}) => `
<div class="section">
  <div class="partida-header">${soloEq ? `EQUIPAMIENTO${(p.marca||p.modelo)?` — para ${p.marca||''} ${p.modelo||''} ${p.version||''}`:''}` : `PARTIDA ${p.id}: ${p.marca} ${p.modelo} ${p.version||''}`} &nbsp;•&nbsp; ${qty} unidad(es)</div>
  <table>
    <colgroup>
      <col class="c-num"/><col class="c-img"/><col class="c-nom"/>
      <col class="c-desc"/><col style="width:10%"/><col style="width:10%"/><col class="c-cant"/><col style="width:5%"/><col class="c-pu"/><col class="c-sub"/>
    </colgroup>
    <thead><tr>
      <th>#</th><th></th><th>Concepto</th><th>Descripción</th>
      <th>Modelo</th><th>Marca</th>
      <th style="text-align:center">Cant.</th>
      <th style="text-align:center">Unidad</th>
      <th style="text-align:right">P.Unit s/IVA</th>
      <th style="text-align:right">Subtotal</th>
    </tr></thead>
    <tbody>
      ${soloEq ? '' : `<tr>
        <td style="text-align:center;color:#6b6862">1</td>
        <td style="text-align:center;padding:4px">${(()=>{const foto=liveCatMap[p.vehiculoId]?.photo||p.foto||'';const r=resolveImg(foto);return r?`<img src="${r}" style="width:58px;height:58px;object-fit:contain;border-radius:3px;" />`:'';})()}</td>
        <td><strong>Vehículo base con equipamiento</strong></td>
        <td class="desc-cell">${p.tipo||''} ${p.marca||''} ${p.modelo||''} ${p.version||''} ${p.ano||''}</td>
        <td class="mm-cell">${p.modelo||''}</td><td class="mm-cell">${p.marca||''}</td>
        <td style="text-align:center">${qty}</td>
        <td style="text-align:center">pz</td>
        <td style="text-align:right">${fmt(pvUnit)}</td>
        <td style="text-align:right">${fmt(pvUnit * qty)}</td>
      </tr>`}
      ${(() => {
        let rowNum = soloEq ? 1 : 2;
        return eqItems.map((e,i) => {
        const kitItems = effKitMap[e.productoId];
        if (kitItems && kitItems.length > 0) {
          const comps = kitItems.map(kid => liveCatMap[kid]).filter(Boolean);
          return comps.map((comp, ci) => {
            const img = comp.photo || CATALOG_IMAGES[comp.id];
            const num = rowNum++;
            return `<tr>
              <td style="text-align:center;color:#6b6862;font-size:10px">${num}</td>
              <td style="text-align:center;padding:4px">${(()=>{const r=resolveImg(img);return r?`<img src="${r}" style="width:58px;height:58px;object-fit:contain;border-radius:3px;" />`:'';})()}</td>
              <td style="font-weight:600;font-size:10px">${comp.nom}</td>
              <td class="desc-cell">${comp.desc||''}</td>
              <td class="mm-cell">${comp.modelo||''}</td><td class="mm-cell">${comp.marca||''}</td>
              <td style="text-align:center">${(e.cnts&&e.cnts[pi])!=null?(e.cnts[pi]||0):1}</td>
              <td style="text-align:center;font-size:9.5px">${e.unidad||'pz'}</td>
              <td></td><td></td>
            </tr>`;
          }).join('');
        } else {
          const liveProd = liveCatMap[e.productoId];
          const img = (liveProd?.photo) || CATALOG_IMAGES[e.productoId];
          const num = rowNum++;
          return `<tr>
            <td style="text-align:center;color:#6b6862;font-size:10px">${num}</td>
            <td style="text-align:center;padding:4px">${(()=>{const r=resolveImg(img);return r?`<img src="${r}" style="width:58px;height:58px;object-fit:contain;border-radius:3px;" />`:'';})()}</td>
            <td style="font-weight:600;font-size:10px">${liveProd?.nom||e.nombre}</td>
            <td class="desc-cell">${liveProd?.desc||e.descripcion||''}</td>
            <td class="mm-cell">${e.modelo||''}</td><td class="mm-cell">${e.marca||''}</td>
            <td style="text-align:center">${(e.cnts&&e.cnts[pi])!=null?(e.cnts[pi]||0):1}</td>
            <td style="text-align:center;font-size:9.5px">${e.unidad||'pz'}</td>
            <td style="text-align:right"></td>
            <td style="text-align:right"></td>
          </tr>`;
        }
      }).join('');
      })()}
    </tbody>
    <tfoot>
      <tr class="total-row"><td colspan="8"></td><td style="text-align:right">Subtotal:</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
      <tr class="total-row"><td colspan="8"></td><td style="text-align:right">IVA (16%):</td><td style="text-align:right">${fmt(subtotal*IVA)}</td></tr>
      <tr class="total-row"><td colspan="8"></td><td style="text-align:right"><strong>TOTAL c/IVA:</strong></td><td style="text-align:right"><strong style="color:#3b6cf4">${fmt(subtotal*(1+IVA))}</strong></td></tr>
    </tfoot>
  </table>
</div>
`).join('')}

<div class="total-section">
  <div class="total-box" style="overflow:hidden;border-radius:8px;border:1px solid #e0ddd8">
    <table style="width:100%;border-collapse:collapse">
      <tr style="background:#f6f6f4"><td style="padding:8px 14px;font-size:11px;color:#3a3835">Subtotal s/IVA:</td><td class="right" style="padding:8px 14px;font-weight:600">${fmt(calc.ventaSIVA)}</td></tr>
      <tr style="background:#f6f6f4"><td style="padding:8px 14px;font-size:11px;color:#3a3835">IVA (16%):</td><td class="right" style="padding:8px 14px;font-weight:600">${fmt(calc.ivaVenta)}</td></tr>
      <tr style="background:#1a1917;color:#fff"><td style="padding:11px 14px;font-size:13px;font-weight:700">TOTAL c/IVA:</td><td class="right" style="padding:11px 14px;font-size:15px;font-weight:700;color:#fff">${fmt(calc.ventaTotal)}</td></tr>
    </table>
  </div>
</div>

<div style="clear:both;background:#1a1917;color:#fff;padding:8px 14px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.3px;margin:8px 0 20px">
  Importe con letra: ${numeroALetras(calc.ventaTotal)}
</div>

${cot.condicionesComerciales ? `<div style="background:#f6f6f4;padding:12px 16px;border-radius:6px;font-size:10px;color:#6b6862;margin-bottom:20px"><strong>Condiciones comerciales:</strong> ${cot.condicionesComerciales}</div>` : ''}
${(cot.condicionesLista||[]).length > 0 ? `<div style="background:#f6f6f4;padding:10px 14px;border-radius:6px;margin-bottom:16px">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#1a1917;margin-bottom:7px">Condiciones</div>
  ${(cot.condicionesLista||[]).map(c => `<div style="margin-bottom:5px;font-size:9px;line-height:1.4;color:#3a3835">${c.titulo?`<strong>${String(c.titulo).replace(/</g,'&lt;')}:</strong> `:''}${String(c.texto||'').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>`).join('')}
</div>` : ''}

<div class="firma">
  <div class="firma-line">${emp.responsable||'_______________________'}<br>${emp.cargo||'Responsable comercial'}<br>${emp.nombreComercial||'MSMS CORP'}</div>
  <div class="firma-line">_______________________<br>Representante autorizado<br>${project.dependencia||'Cliente'}</div>
</div>

<div class="footer" style="flex-direction:column;gap:6px;align-items:stretch">
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;border-top:1px solid #e0ddd8;padding-top:10px">
    <div style="font-size:9px;color:#6b6862;line-height:1.5">
      <strong style="color:#1a1917">${emp.razonSocial||'MSMS CORP'}</strong>${emp.rfc?` &nbsp;·&nbsp; RFC: ${emp.rfc}`:''}<br>
      ${emp.direccion||''}${emp.telefono?`<br>Tel: ${emp.telefono}`:''}${emp.correo?` &nbsp;·&nbsp; ${emp.correo}`:''}
    </div>
    <div style="font-size:9px;color:#a0998f;text-align:right">Generado: ${new Date().toLocaleDateString('es-MX')}</div>
  </div>
</div>
</div></body></html>`;

  const nombreArchivo = (cot.folio || ('Cotizacion ' + (project.name || ''))).trim() || 'Cotizacion';
  openPrint(html, nombreArchivo);
}

// ══════════════════════════════════════════════════════════════
// 2. RESUMEN RETORNOS
// ══════════════════════════════════════════════════════════════
export function printResumenRetornos({ project, cot, calc, companyObj }) {
  const emp = companyObj && companyObj.name ? {
    nombre: companyObj.nombreComercial || companyObj.name,
    razonSocial: companyObj.name || '',
    rfc: companyObj.rfc || '',
    direccion: [companyObj.address, companyObj.cp, companyObj.ciudad, companyObj.estado].filter(Boolean).join(', '),
    contacto: [companyObj.telefono, companyObj.correo].filter(Boolean).join(' · '),
    representante: companyObj.representanteLegal || '',
    cargo: companyObj.cargoRepresentante || '',
  } : { nombre:'MSMS CORP', razonSocial:'', rfc:'', direccion:'', contacto:'', representante:'', cargo:'' };
  const logoRet = getCompanyLogo(project.company, companyObj);
  const activeParts = (cot.partidas||[]).filter(p => p.activo && p.cantidad > 0);
  const retActivos  = (cot.retornos||[]).filter(r => r.activo);

  const calcRetorno = (r) => {
    const val = Number(r.valor||0);
    if (r.base === '% sobre venta c/IVA')  return calc.ventaTotal * val / 100;
    if (r.base === '% sobre venta s/IVA')  return calc.ventaSIVA  * val / 100;
    if (r.base === 'Monto fijo total')      return val;
    if (r.base === 'Monto fijo por unidad') return val * calc.unidades;
    return 0;
  };

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Resumen Retornos ${cot.folio||''}</title>
<style>${BASE_CSS}
  .sheet h2 { font-size:12px; margin-bottom:8px; }
  .sheet table { font-size:11px; }
  .sheet th { font-size:9.5px; padding:6px 8px; }
  .sheet td { font-size:11px; padding:6px 8px; }
  .sheet .section { margin-bottom:18px; }
  .sheet .total-row td { font-size:11px; }
</style></head><body>
<div class="sheet">

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a1917">
  <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0;padding-right:20px">
    ${logoRet ? `<img src="${logoRet}" style="height:60px;width:auto;max-width:120px;flex-shrink:0;object-fit:contain;background:#fff;padding:3px;border-radius:4px" />` : ''}
    <div style="min-width:0">
      <div style="font-size:12px;font-weight:700;line-height:1.3">${emp.nombre}</div>
      ${emp.rfc?`<div style="font-size:9.5px;color:#6b6862;line-height:1.45">${emp.rfc}${emp.direccion?' · '+emp.direccion:''}</div>`:''}
      ${emp.contacto?`<div style="font-size:9.5px;color:#6b6862;line-height:1.45">${emp.contacto}</div>`:''}
      <div style="margin-top:6px"><h1 style="font-size:16px">Resumen de Retornos</h1></div>
      <div style="color:#6b6862;font-size:10px">Para entrega al responsable del retorno</div>
    </div>
  </div>
  <div style="text-align:right;font-size:12px;font-weight:500;color:#3b6cf4;flex-shrink:0;letter-spacing:.5px">${cot.folio||'—'}</div>
</div>

<div class="section">
  <h2>Datos del proyecto</h2>
  <table>
    <tr><td style="color:#6b6862;width:200px">Folio + Versión</td><td><strong>${cot.folio||'—'}</strong></td></tr>
    <tr><td style="color:#6b6862">Nombre del proyecto</td><td><strong>${project.name||'—'}</strong></td></tr>
    <tr><td style="color:#6b6862">Dependencia / Cliente</td><td>${project.dependencia||'—'}</td></tr>
    <tr><td style="color:#6b6862">Fecha cotización</td><td>${fmtDate(cot.fechaCotizacion)}</td></tr>
  </table>
</div>

<div class="section">
  <h2>Vehículos del proyecto</h2>
  <table>
    <thead><tr>
      <th>Partida</th><th>Vehículo</th>
      <th style="text-align:center">Cantidad</th>
      <th style="text-align:right">Precio unit. c/IVA</th>
      <th style="text-align:right">Venta total c/IVA</th>
    </tr></thead>
    <tbody>
    ${activeParts.map(p => {
      const pi = parseInt(p.id.replace('P',''))-1;
      const qty = p.cantidad||0;
      const vehSIVA_unit = (p.costoMSMS||0)/(1+IVA);
      const eqSIVA_unit = (cot.equipo||[]).filter(e=>e.usar).reduce((s,e)=>{const cnt=(e.cnts&&e.cnts[pi])||0;return s+(e.llevaIVA?(e.costoConIVA||0)/(1+IVA):(e.costoConIVA||0))*cnt;},0);
      const costoUnit = vehSIVA_unit + eqSIVA_unit;
      let pvUnit = 0;
      if(p.modoPrecio==='Techo presupuestal')pvUnit=(p.techo||0)>0?(p.techo||0)/(1+IVA)/qty:costoUnit;
      else if(p.modoPrecio==='Utilidad deseada %')pvUnit=costoUnit*(1+(p.utilidadPct||0));
      else pvUnit=costoUnit+(p.utilidadDeseada||0);
      const pvCIVA_unit = pvUnit*(1+IVA);
      const pvCIVA_total = pvCIVA_unit*qty;
      return `<tr>
        <td>${p.id}</td>
        <td>${p.marca} ${p.modelo} ${p.version||''}</td>
        <td style="text-align:center">${qty}</td>
        <td style="text-align:right">${fmt(pvCIVA_unit)}</td>
        <td style="text-align:right"><strong>${fmt(pvCIVA_total)}</strong></td>
      </tr>`;
    }).join('')}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="2"><strong>TOTAL PROYECTO</strong></td>
        <td style="text-align:center"><strong>${calc.unidades}</strong></td>
        <td></td>
        <td style="text-align:right"><strong style="color:#3b6cf4">${fmt(calc.ventaTotal)}</strong></td>
      </tr>
    </tfoot>
  </table>
</div>

<div class="section">
  <h2>Retornos a pagar</h2>
  ${retActivos.length === 0
    ? '<p style="color:#a0998f;padding:20px 0">Sin retornos configurados para este proyecto.</p>'
    : `<table>
    <thead><tr>
      <th>Retorno</th><th>Tipo</th><th>Valor</th>
      <th style="text-align:right">Monto a pagar</th><th>¿Con IVA?</th>
    </tr></thead>
    <tbody>
    ${retActivos.map(r => {
      const monto = calcRetorno(r);
      const tipo = r.base.startsWith('%') ? 'Porcentaje' : 'Monto fijo';
      const val  = r.base.startsWith('%') ? (Number(r.valor||0).toFixed(2)+'%') : fmt(Number(r.valor||0));
      return `<tr>
        <td><strong>${r.nombre||'—'}</strong></td>
        <td>${tipo}</td><td>${val}</td>
        <td style="text-align:right;color:#e24b4a"><strong>${fmt(monto)}</strong></td>
        <td>${r.llevaIVA?'Con IVA':'Sin IVA'}</td>
      </tr>`;
    }).join('')}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="3"><strong>TOTAL RETORNOS</strong></td>
        <td style="text-align:right"><strong style="color:#e24b4a">${fmt(calc.totalRetornos)}</strong></td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <div style="background:#f6f6f4;padding:12px 16px;border-radius:6px;font-size:10px;color:#6b6862;line-height:1.8">
    <strong>Notas:</strong><br>
    • Los montos "Con IVA" incluyen el 16% de IVA.<br>
    • Los montos "Sin IVA" son cantidades netas a pagar.<br>
    • Para retornos por porcentaje, el cálculo se aplica sobre la venta total del proyecto.
  </div>`
  }
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:50px">
  <div style="border-top:1.5px solid #1a1917;padding-top:8px;text-align:center">
    <div style="font-size:11px;font-weight:600">${emp.representante || emp.nombre}</div>
    <div style="font-size:9.5px;color:#6b6862">${emp.cargo ? emp.cargo+' · ' : ''}${emp.nombre}</div>
    <div style="font-size:9px;color:#a0998f;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Entrega el retorno</div>
  </div>
  <div style="border-top:1.5px solid #1a1917;padding-top:8px;text-align:center">
    <div style="font-size:11px;font-weight:600">&nbsp;</div>
    <div style="font-size:9.5px;color:#6b6862">Nombre y firma</div>
    <div style="font-size:9px;color:#a0998f;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Recibe el retorno</div>
  </div>
</div>

<div class="footer">
  <span>${emp.nombre} — Documento confidencial</span>
  <span>Generado: ${new Date().toLocaleDateString('es-MX')}</span>
</div>
</div></body></html>`;

  openPrint(html, 'Resumen Retornos '+(cot.folio||''));
}

// ══════════════════════════════════════════════════════════════
// 3. RESUMEN INTERNO
// ══════════════════════════════════════════════════════════════
export function printResumenInterno({ project, cot, calc, companyObj }) {
  const activeParts = (cot.partidas||[]).filter(p => p.activo && p.cantidad > 0);

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Resumen Interno ${cot.folio||''}</title>
<style>${BASE_CSS}
.kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 20px; }
.kpi { background: #f6f6f4; padding: 12px 14px; border-radius: 6px; border-left: 3px solid #e0ddd8; }
.kpi.green { border-left-color: #1D9E75; }
.kpi.blue  { border-left-color: #3b6cf4; }
.kpi.red   { border-left-color: #e24b4a; }
.kpi .k-label { font-size: 10px; color: #6b6862; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .3px; }
.kpi .k-value { font-size: 16px; font-weight: 700; }
</style></head><body>

<div class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1917;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px">
  <span style="font-weight:500">Resumen Interno — ${cot.folio||''}</span>
  <span style="display:flex;gap:8px"><button onclick="try{window.close()}catch(e){};setTimeout(function(){if(history.length>1)history.back()},100)" style="background:transparent;color:white;border:1px solid rgba(255,255,255,.4);padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">← Cerrar</button><button onclick="window.print()" style="background:white;color:#1a1917;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">Imprimir / Guardar PDF</button></span>
</div>
<div class="sheet">

<div class="confidential">⚠ USO INTERNO MSMS CORP — NO COMPARTIR CON CLIENTE</div>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1a1917">
  <div>
    <h1>Resumen Interno</h1>
    <div style="font-size:16px;font-weight:500;color:#3b6cf4;margin-top:4px">${project.name||'—'}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11px;color:#6b6862">Folio</div>
    <div style="font-size:18px;font-weight:300;color:#3b6cf4">${cot.folio||'—'}</div>
  </div>
</div>

<div class="section">
  <h2>Identificación</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
    ${[['Proyecto',project.name],['Dependencia',project.dependencia],['Responsable',project.responsable],['Fecha cotización',cot.fechaCotizacion],['Vigencia',cot.vigenciaDias+' días'],['Agencia/Proveedor',cot.agenciaProveedor]].map(([l,v])=>`
    <div style="padding:8px 0;border-bottom:.5px solid #e0ddd8">
      <div class="label">${l}</div><div class="value">${v||'—'}</div>
    </div>`).join('')}
  </div>
</div>

<div class="section">
  <h2>Volumen y venta</h2>
  <div class="kpi-grid">
    <div class="kpi blue"><div class="k-label">Venta total c/IVA</div><div class="k-value" style="color:#3b6cf4">${fmt(calc.ventaTotal)}</div></div>
    <div class="kpi"><div class="k-label">Venta total s/IVA</div><div class="k-value">${fmt(calc.ventaSIVA)}</div></div>
    <div class="kpi"><div class="k-label">Total unidades</div><div class="k-value">${calc.unidades}</div></div>
  </div>
</div>

<!-- Fase 2A0: la sección "Utilidad y margen" (utilidad bruta/neta, margen
     bruto/neto sobre costo, costo total c/IVA y s/IVA) se elimina por
     completo de este PDF a propósito. Este documento está pensado para
     el cliente externo (gobierno) — nunca debe revelar costos internos,
     utilidad ni margen de MSMS/Surman/Broking. Esos datos SÍ deben vivir
     únicamente en printResumenInterno (admin-only por uso), no aquí. -->

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <div class="section">
    <h2>Desglose de IVA</h2>
    <table>
      ${[['IVA cobrado en venta',fmt(calc.ivaVenta),''],['IVA acreditable (costos)',fmt(calc.ivaAcreditable),''],['IVA sobrante',fmt(calc.ivaSobrante),'font-weight:600'],['% al SAT',pctS(calc.ivaAlSAT/Math.max(calc.ivaSobrante,1)),'color:#6b6862'],['IVA pagado al SAT',fmt(calc.ivaAlSAT),''],['IVA a utilidad',fmt(calc.ivaAUtilidad),'color:#1D9E75;font-weight:600']].map(([l,v,s])=>`
      <tr><td style="color:#6b6862">${l}</td><td class="right" style="${s}">${v}</td></tr>`).join('')}
    </table>
  </div>
  <div class="section">
    <h2>Costos internos</h2>
    <table>
      ${[['Retornos totales',fmt(calc.totalRetornos),'color:#e24b4a'],['Fianzas / ISR',fmt(calc.totalFianzas),'color:#e24b4a'],['Total costos internos',fmt(calc.totalRetornos+calc.totalFianzas),'font-weight:600;color:#e24b4a']].map(([l,v,s])=>`
      <tr><td style="color:#6b6862">${l}</td><td class="right" style="${s}">${v}</td></tr>`).join('')}
    </table>
    <h2 style="margin-top:16px">Por partida</h2>
    <table>
      <thead><tr><th>Partida</th><th>Vehículo</th><th style="text-align:center">Qty</th><th style="text-align:right">Util. bruta s/IVA</th></tr></thead>
      <tbody>
      ${activeParts.map(p=>{
        const pi=parseInt(p.id.replace('P',''))-1,qty=p.cantidad||0;
        const vehSIVA_unit=(p.costoMSMS||0)/(1+IVA);
        const eqSIVA_unit=(cot.equipo||[]).filter(e=>e.usar).reduce((s,e)=>{const cnt=(e.cnts&&e.cnts[pi])||0;return s+(e.llevaIVA?(e.costoConIVA||0)/(1+IVA):(e.costoConIVA||0))*cnt;},0);
        const costoUnit=vehSIVA_unit+eqSIVA_unit;
        let pvUnit=0;
        if(p.modoPrecio==='Techo presupuestal')pvUnit=(p.techo||0)>0?(p.techo||0)/(1+IVA)/qty:costoUnit;
        else if(p.modoPrecio==='Utilidad deseada %')pvUnit=costoUnit*(1+(p.utilidadPct||0));
        else pvUnit=costoUnit+(p.utilidadDeseada||0);
        const util=(pvUnit-costoUnit)*qty;
        return `<tr><td>${p.id}</td><td style="font-size:10px">${p.marca} ${p.modelo}</td><td style="text-align:center">${qty}</td><td style="text-align:right;color:${util>0?'#1D9E75':'#e24b4a'};font-weight:600">${fmt(util)}</td></tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>
</div>

<div class="footer">
  <span>MSMS CORP — Documento confidencial — No compartir con cliente</span>
  <span>Generado: ${new Date().toLocaleDateString('es-MX')}</span>
</div>
</div></body></html>`;

  openPrint(html);
}

// ── Orden de Compra ───────────────────────────────────────────
function buildOrdenCompraHTML({ project, partidas, condiciones, folio: folioParam, companyObj }) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const hoy = new Date().toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'});
  const folio = folioParam || ('OC-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5));

  const filasVeh = partidas.map(p => {
    const qty    = p.cantidad || 0;
    const puCIVA = p.costoMSMS || 0;          // precio c/IVA que da el usuario
    const puSIVA = puCIVA / (1 + IVA);        // precio s/IVA para desglosar
    const subCIVA = puCIVA * qty;
    const veh = [p.marca, p.modelo, p.version, p.ano].filter(Boolean).join(' ');
    const colorTxt = p.color ? ` <span style="color:#6b6862">— Color: ${esc(p.color)}</span>` : '';
    return `
      <tr>
        <td style="font-size:11px;font-weight:500">${esc(p.tipo||'')}</td>
        <td style="font-size:11px">${esc(veh)}${colorTxt}</td>
        <td style="text-align:center;font-weight:600">${qty}</td>
        <td style="text-align:right">${fmt(puSIVA)}</td>
        <td style="text-align:right;font-weight:600">${fmt(subCIVA)}</td>
      </tr>`;
  }).join('');

  // costoMSMS ya viene c/IVA — el total c/IVA es directo
  const totalCIVA = partidas.reduce((s,p)=>(p.costoMSMS||0)*(p.cantidad||0)+s, 0);
  const totalSIVA = totalCIVA / (1 + IVA);
  const totalIVA  = totalCIVA - totalSIVA;
  const total     = totalCIVA;

  // Condiciones: array de { label, value } — value vacío = espacio en blanco
  const filasCondiciones = (condiciones||[]).map(c => `
    <tr>
      <td style="font-size:10px;color:#6b6862;width:35%;padding:9px 10px;border-bottom:.5px solid #e0ddd8">${esc(c.label)}</td>
      <td style="font-size:11px;font-weight:${c.value?'500':'400'};color:${c.value?'#1a1917':'#b0a89f'};padding:9px 10px;border-bottom:.5px solid #e0ddd8">${esc(c.value||'_______________________________')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Orden de Compra — ${esc(project.name)}</title>
<style>
${BASE_CSS}
.oc-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #1a1917; }
.oc-folio  { text-align:right; }
.oc-folio .num { font-size:22px; font-weight:700; letter-spacing:1px; color:#1a1917; }
.oc-folio .lbl { font-size:10px; color:#6b6862; text-transform:uppercase; letter-spacing:.5px; }
.cond-table { width:100%; border-collapse:collapse; margin-bottom:20px; border:.5px solid #e0ddd8; border-radius:6px; overflow:hidden; }
.sign-grid  { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:40px; }
.sign-box   { border-top:1.5px solid #1a1917; padding-top:8px; }
.sign-label { font-size:10px; color:#6b6862; text-transform:uppercase; letter-spacing:.5px; }
.sign-name  { font-size:11px; font-weight:500; margin-top:4px; }
</style></head><body>
<div class="sheet">

  <div class="oc-header">
    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0;padding-right:20px">
      ${(() => { const logo = getCompanyLogo(project.company || 'Broking and Brands Group', companyObj); return logo ? `<img src="${logo}" style="height:60px;width:auto;max-width:120px;flex-shrink:0;object-fit:contain;background:#ffffff;padding:3px;border-radius:4px" />` : ''; })()}
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:700;letter-spacing:.5px;line-height:1.3">${esc((companyObj && companyObj.name) ? (companyObj.nombreComercial || companyObj.name) : 'BROKING AND BRANDS GROUP S.A. DE C.V.')}</div>
        <div style="font-size:9.5px;color:#6b6862;margin-top:2px;line-height:1.45">${esc((companyObj && companyObj.rfc) ? companyObj.rfc : 'BBG1007304K0')}${(() => { const dir = (companyObj && companyObj.address) ? [companyObj.address, companyObj.cp, companyObj.ciudad, companyObj.estado].filter(Boolean).join(', ') : 'Pedregal 23, Piso 1, Lomas de Chapultepec, CDMX'; return dir ? ' · ' + esc(dir) : ''; })()}</div>
        <div style="font-size:9.5px;color:#6b6862;line-height:1.45">${esc((companyObj && companyObj.telefono) ? companyObj.telefono : '5544432786')}${(() => { const correo = (companyObj && companyObj.correo) ? companyObj.correo : 'santiago@brokingroup.com'; return correo ? ' · ' + esc(correo) : ''; })()}</div>
      </div>
    </div>
    <div class="oc-folio" style="flex-shrink:0">
      <div class="lbl">Orden de Compra</div>
      <div class="num">${esc(folio)}</div>
      <div style="font-size:10px;color:#6b6862;margin-top:2px">${hoy}</div>
    </div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div>
      <div class="label">Proveedor</div>
      <div class="value">${esc(project.ocProveedor?.name || project.cotizacion?.agenciaProveedor || 'Grupo Surman')}</div>
      ${project.ocProveedor?.rfc?`<div style="font-size:10px;color:#6b6862;margin-top:2px">RFC: ${esc(project.ocProveedor.rfc)}</div>`:''}
      ${project.ocProveedor?.address?`<div style="font-size:10px;color:#6b6862;margin-top:1px">${esc(project.ocProveedor.address)}</div>`:''}
    </div>
    <div>
      <div class="label">Proyecto / Licitación</div>
      <div class="value">${esc(project.name)}</div>
      ${project.numLicitacion?`<div style="font-size:10px;color:#6b6862;margin-top:2px">${esc(project.numLicitacion)}</div>`:''}
    </div>
    <div>
      <div class="label">Cliente final</div>
      <div class="value">${esc(project.dependencia||'—')}</div>
    </div>
    <div>
      <div class="label">Responsable</div>
      <div class="value">${esc(project.responsable||'—')}</div>
    </div>
  </div>

  <h2>Vehículos solicitados</h2>
  <table>
    <thead>
      <tr>
        <th>Tipo</th><th>Vehículo</th><th style="text-align:center;width:50px">Cant.</th>
        <th style="text-align:right;width:100px">P. Unit s/IVA</th>
        <th style="text-align:right;width:110px">Subtotal s/IVA</th>
      </tr>
    </thead>
    <tbody>${filasVeh}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="3"></td>
        <td style="text-align:right;font-size:10px;color:#6b6862">Subtotal s/IVA</td>
        <td style="text-align:right">${fmt(totalSIVA)}</td>
      </tr>
      <tr>
        <td colspan="3"></td>
        <td style="text-align:right;font-size:10px;color:#6b6862">IVA (16%)</td>
        <td style="text-align:right">${fmt(totalIVA)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="3"></td>
        <td style="text-align:right;font-size:12px">TOTAL c/IVA</td>
        <td style="text-align:right;font-size:14px;color:#3b6cf4">${fmt(total)}</td>
      </tr>
    </tfoot>
  </table>

  <h2>Condiciones de compra</h2>
  <table class="cond-table"><tbody>${filasCondiciones}</tbody></table>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-label">Autoriza</div>
      <div class="sign-name">${esc(project.responsable||'Santiago Mansur')}</div>
      <div style="font-size:10px;color:#6b6862">Broking and Brands Group</div>
    </div>
    <div class="sign-box">
      <div class="sign-label">Recibe y acepta</div>
      <div class="sign-name">&nbsp;</div>
      <div style="font-size:10px;color:#6b6862">${esc(project.cotizacion?.agenciaProveedor||'Proveedor')}</div>
    </div>
  </div>

  <div class="footer">
    <span>Orden de Compra ${esc(folio)} — ${esc(project.name)}</span>
    <span>Generado: ${hoy}</span>
  </div>

</div></body></html>`;

  return { html, folio };
}

export function printOrdenCompra(args) {
  const { html, folio } = buildOrdenCompraHTML(args);
  openPrint(html, folio);
}

// Genera el PDF de la Orden de Compra como base64 (para adjuntar a correo), sin abrir ventana
export async function ordenCompraPdfBase64(args) {
  const { html, folio } = buildOrdenCompraHTML(args);
  const filename = (folio || 'orden_compra') + '.pdf';
  const base64 = await htmlToPdfBase64(html, filename);
  return { base64, filename };
}

// ── Documento membretado de empresa ───────────────────────────
function buildDocumentoMembretadoHTML({ empresa, titulo, cuerpo, folio }) {
  const emp = empresa || {};
  const logo = getCompanyLogo(emp.name, emp);
  const dir = [emp.address, emp.cp, emp.ciudad, emp.estado].filter(Boolean).join(', ');
  const contacto = [emp.telefono, emp.correo].filter(Boolean).join(' · ');
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cuerpoHtml = esc(cuerpo).replace(/\n/g, '<br>');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo||'Documento')} ${esc(folio||'')}</title>
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1a1917; font-size:12.5px; line-height:1.7; margin:0; padding:2.2cm 2.4cm; }
  .header { display:flex; align-items:flex-start; gap:16px; border-bottom:2px solid #1a1917; padding-bottom:14px; margin-bottom:8px; }
  .header img { height:64px; width:auto; max-width:130px; object-fit:contain; background:#fff; flex-shrink:0; }
  .emp-nombre { font-size:14px; font-weight:700; margin-bottom:3px; }
  .emp-datos { font-size:9.5px; color:#555; line-height:1.5; }
  .folio { font-size:9px; color:#888; text-align:right; margin-bottom:24px; }
  .cuerpo { white-space:normal; margin-top:28px; text-align:justify; }
  .no-print { display:none !important; }
  @media screen { body { max-width:780px; margin:24px auto; padding:24px; } }
</style></head><body>
  <div class="header">
    ${logo ? `<img src="${logo}" />` : ''}
    <div style="flex:1;min-width:0">
      <div class="emp-nombre">${esc(emp.nombreComercial || emp.name || '')}</div>
      <div class="emp-datos">${esc(emp.name||'')}</div>
      ${emp.rfc?`<div class="emp-datos">RFC: ${esc(emp.rfc)}</div>`:''}
      ${dir?`<div class="emp-datos">${esc(dir)}</div>`:''}
      ${contacto?`<div class="emp-datos">${esc(contacto)}</div>`:''}
    </div>
  </div>
  ${folio?`<div class="folio">${esc(folio)}</div>`:'<div style="margin-bottom:24px"></div>'}
  ${titulo?`<div style="text-align:center;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${esc(titulo)}</div>`:''}
  <div class="cuerpo">${cuerpoHtml}</div>
  ${emp.representanteLegal ? `<div style="margin-top:70px;text-align:center">
    <div style="border-top:1px solid #1a1917;width:280px;margin:0 auto;padding-top:6px">
      <div style="font-size:12px;font-weight:700">${esc(emp.representanteLegal)}</div>
      ${emp.cargoRepresentante?`<div style="font-size:10px;color:#555">${esc(emp.cargoRepresentante)}</div>`:''}
      <div style="font-size:10px;color:#555">${esc(emp.nombreComercial || emp.name || '')}</div>
    </div>
  </div>` : ''}
</body></html>`;
}

export function printDocumentoMembretado({ empresa, titulo, cuerpo, folio }) {
  const html = buildDocumentoMembretadoHTML({ empresa, titulo, cuerpo, folio });
  const win = window.open('', '_blank');
  win.document.write(html.replace('</body>', '<script>setTimeout(()=>window.print(),400);</script></body>'));
  win.document.close();
}

// Genera el PDF del documento membretado como base64 (para adjuntar a correo)
export async function documentoMembretadoPdfBase64({ empresa, titulo, cuerpo, folio }) {
  const html = buildDocumentoMembretadoHTML({ empresa, titulo, cuerpo, folio });
  const filename = (folio || titulo || 'documento').replace(/[^a-z0-9áéíóúñ_\-]/gi,'_') + '.pdf';
  const base64 = await htmlToPdfBase64(html, filename);
  return { base64, filename };
}
