// pdf_export.js — Generador de PDFs para LicitaPro
// Tres plantillas: Cotización Cliente, Resumen Retornos, Resumen Interno
import { fmt, pctS } from './utils.js';
import { calcCotizacion } from './calc.js';
import { CATALOG_IMAGES } from './catalog_images.js';
import { CATALOG_PRODUCTS, KIT_MAP } from './catalog.js';

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
  col.c-img  { width: 62px; }
  col.c-nom  { width: 30%; }
  col.c-desc { width: 20%; }
  col.c-cant { width: 38px; }
  col.c-pu   { width: 68px; }
  col.c-sub  { width: 80px; }
  /* Evitar que una fila (con su imagen) se parta entre páginas */
  tr, td { page-break-inside: avoid; break-inside: avoid; }
  td img { page-break-inside: avoid; break-inside: avoid; display: inline-block; vertical-align: middle; }
  thead { display: table-header-group; }
  th { background: #1a1917; color: white; padding: 7px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 7px 10px; border-bottom: .5px solid #e0ddd8; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
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

  const fname = (title || 'cotizacion').replace(/[^a-z0-9áéíóúñ ]/gi, '').replace(/\s+/g, '_') + '.pdf';
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
    // Quitar sombra/margen exterior solo durante la captura
    const prevShadow = el.style.boxShadow, prevMargin = el.style.margin;
    el.style.boxShadow = 'none'; el.style.margin = '0';
    win.html2pdf().set({
      margin: 0,
      filename: fname,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' },
    }).from(el).save().then(() => {
      el.style.boxShadow = prevShadow; el.style.margin = prevMargin;
      btn.textContent = 'Descargar PDF'; btn.disabled = false;
    }).catch((e) => {
      el.style.boxShadow = prevShadow; el.style.margin = prevMargin;
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
export async function printCotizacionCliente({ project, cot, calc, config }) {
  const emp = config?.empresa || {};
  // Catálogo en vivo: productos base + personalizados del config
  const liveCatMap = {};
  [...CATALOG_PRODUCTS, ...(config?.customProducts || [])].forEach(p => { liveCatMap[p.id] = p; });

  // Pre-cargar fotos URL a base64 para que html2pdf pueda embebedlas
  const imgCache = {};
  const preloadImg = async (url) => {
    if (!url || url.startsWith('data:') || imgCache[url]) return;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      imgCache[url] = await new Promise(r => { const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(blob); });
    } catch(e) { imgCache[url] = url; }
  };
  // Recopilar fotos de vehículos — prioriza catálogo en vivo sobre snapshot guardado
  const allFotos = (cot.partidas||[]).map(p => {
    const live = liveCatMap[p.vehiculoId]?.photo || '';
    return live || p.foto || '';
  }).filter(Boolean);
  await Promise.all([...new Set(allFotos)].map(preloadImg));
  const resolveImg = (url) => {
    if (!url) return '';
    if (imgCache[url]) return imgCache[url];      // ya cargada como base64
    if (url.startsWith('data:')) return url;      // ya es base64
    return url;                                   // URL (fallback, se carga en el img)
  };

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

  const partRows = activeParts.map(p => {
    const pi = parseInt(p.id.replace('P','')) - 1;
    const qty = p.cantidad || 0;
    const vehSIVA_unit = (p.costoMSMS || 0) / (1 + IVA);
    const eqSIVA_unit = (cot.equipo || []).filter(e => e.usar && e.vis).reduce((s,e) => {
      const cnt = (e.cnts && e.cnts[pi]) || 0;
      return s + (e.llevaIVA ? (e.costoConIVA||0)/(1+IVA) : (e.costoConIVA||0)) * cnt;
    }, 0);
    const costoUnit = vehSIVA_unit + eqSIVA_unit;
    let pvUnit = 0;
    if (p.modoPrecio === 'Techo presupuestal') pvUnit = (p.techo||0) > 0 ? (p.techo||0)/(1+IVA) : costoUnit;
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
  <div class="empresa-info">
    <div style="font-size:14px;font-weight:700;color:#1a1917;margin-bottom:4px">${emp.nombreComercial||emp.razonSocial||'MSMS CORP'}</div>
    <div>${emp.razonSocial||''}</div>
    <div>${emp.rfc||''}</div>
    <div>${emp.direccion||''}</div>
    <div>${emp.telefono||''} ${emp.correo?'• '+emp.correo:''}</div>
  </div>
  <div class="cot-title">
    <h1>COTIZACIÓN</h1>
    <div style="font-size:22px;font-weight:300;color:#3b6cf4;margin-top:4px">${cot.folio||'—'}</div>
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
  ${project.ubicacion&&!project.municipio?`<div><div class="label">Ubicación</div><div class="value">${project.ubicacion}</div></div>`:''}
  ${cot.condicionesComerciales?`<div style="grid-column:1/-1"><div class="label">Condiciones</div><div class="value">${cot.condicionesComerciales}</div></div>`:''}
</div>

${partRows.map(({p, qty, pvUnit, subtotal, eqItems, pi}) => `
<div class="section">
  <div class="partida-header">PARTIDA ${p.id}: ${p.marca} ${p.modelo} ${p.version||''} &nbsp;•&nbsp; ${qty} unidad(es)</div>
  <table>
    <colgroup>
      <col class="c-num"/><col class="c-img"/><col class="c-nom"/>
      <col class="c-desc"/><col class="c-cant"/><col class="c-pu"/><col class="c-sub"/>
    </colgroup>
    <thead><tr>
      <th>#</th><th></th><th>Concepto</th><th>Descripción</th>
      <th style="text-align:center">Cant.</th>
      <th style="text-align:right">P.Unit s/IVA</th>
      <th style="text-align:right">Subtotal</th>
    </tr></thead>
    <tbody>
      <tr>
        <td style="text-align:center;color:#6b6862">1</td>
        <td style="text-align:center;padding:4px">${(()=>{const foto=resolveImg(liveCatMap[p.vehiculoId]?.photo||p.foto||'');return foto?`<img src="${foto}" style="width:54px;height:44px;object-fit:contain;border-radius:3px;" />`:'';})()}</td>
        <td><strong>Vehículo base con equipamiento</strong></td>
        <td>${p.tipo||''} ${p.marca||''} ${p.modelo||''} ${p.version||''} ${p.ano||''}</td>
        <td style="text-align:center">${qty}</td>
        <td style="text-align:right">${fmt(pvUnit)}</td>
        <td style="text-align:right">${fmt(pvUnit * qty)}</td>
      </tr>
      ${(() => {
        let rowNum = 2;
        return eqItems.map((e,i) => {
        const kitItems = effKitMap[e.productoId];
        if (kitItems && kitItems.length > 0) {
          const allCat = [...CATALOG_PRODUCTS, ...(config?.customProducts || [])];
          const comps = kitItems.map(kid => allCat.find(p => p.id === kid)).filter(Boolean);
          return comps.map((comp, ci) => {
            const img = comp.photo || CATALOG_IMAGES[comp.id];
            const num = rowNum++;
            return `<tr>
              <td style="text-align:center;color:#6b6862;font-size:10px">${num}</td>
              <td style="text-align:center;padding:4px">${img ? `<img src="${img}" style="width:54px;height:54px;object-fit:contain;border-radius:3px;" />` : ''}</td>
              <td style="font-weight:600;font-size:11px">${comp.nom}</td>
              <td style="font-size:10px;color:#6b6862">${comp.desc||''}</td>
              <td style="text-align:center">${(e.cnts&&e.cnts[pi])!=null?(e.cnts[pi]||0):1}</td>
              <td></td><td></td>
            </tr>`;
          }).join('');
        } else {
          const img = CATALOG_IMAGES[e.productoId];
          const num = rowNum++;
          return `<tr>
            <td style="text-align:center;color:#6b6862;font-size:10px">${num}</td>
            <td style="text-align:center;padding:4px">${img ? `<img src="${img}" style="width:54px;height:54px;object-fit:contain;border-radius:3px;" />` : ''}</td>
            <td style="font-weight:600;font-size:11px">${e.nombre}</td>
            <td style="font-size:10px;color:#6b6862">${e.descripcion||''}</td>
            <td style="text-align:center">${(e.cnts&&e.cnts[pi])!=null?(e.cnts[pi]||0):1}</td>
            <td style="text-align:right"></td>
            <td style="text-align:right"></td>
          </tr>`;
        }
      }).join('');
      })()}
    </tbody>
    <tfoot>
      <tr class="total-row"><td colspan="5"></td><td style="text-align:right">Subtotal:</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
      <tr class="total-row"><td colspan="5"></td><td style="text-align:right">IVA (16%):</td><td style="text-align:right">${fmt(subtotal*IVA)}</td></tr>
      <tr class="total-row"><td colspan="5"></td><td style="text-align:right"><strong>TOTAL c/IVA:</strong></td><td style="text-align:right"><strong style="color:#3b6cf4">${fmt(subtotal*(1+IVA))}</strong></td></tr>
    </tfoot>
  </table>
</div>
`).join('')}

<div class="total-section">
  <div class="total-box">
    <table>
      <tr><td>Subtotal s/IVA:</td><td class="right">${fmt(calc.ventaSIVA)}</td></tr>
      <tr><td>IVA (16%):</td><td class="right">${fmt(calc.ivaVenta)}</td></tr>
      <tr class="total-row"><td><strong>TOTAL CONTRATO c/IVA:</strong></td><td class="right"><strong style="font-size:14px;color:#3b6cf4">${fmt(calc.ventaTotal)}</strong></td></tr>
    </table>
  </div>
</div>

${cot.condicionesComerciales ? `<div style="background:#f6f6f4;padding:12px 16px;border-radius:6px;font-size:10px;color:#6b6862;margin-bottom:20px"><strong>Condiciones comerciales:</strong> ${cot.condicionesComerciales}</div>` : ''}

<div class="firma">
  <div class="firma-line">${emp.responsable||'_______________________'}<br>${emp.cargo||'Responsable comercial'}<br>${emp.nombreComercial||'MSMS CORP'}</div>
  <div class="firma-line">_______________________<br>Representante autorizado<br>${project.dependencia||'Cliente'}</div>
</div>

<div class="footer">
  <span>${emp.razonSocial||'MSMS CORP'} • ${emp.rfc||''}</span>
  <span>Generado: ${new Date().toLocaleDateString('es-MX')}</span>
</div>
</div></body></html>`;

  openPrint(html);
}

// ══════════════════════════════════════════════════════════════
// 2. RESUMEN RETORNOS
// ══════════════════════════════════════════════════════════════
export function printResumenRetornos({ project, cot, calc }) {
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
<style>${BASE_CSS}</style></head><body>

<div class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1917;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px">
  <span style="font-weight:500">Resumen Retornos — ${cot.folio||''}</span>
  <span style="display:flex;gap:8px"><button onclick="try{window.close()}catch(e){};setTimeout(function(){if(history.length>1)history.back()},100)" style="background:transparent;color:white;border:1px solid rgba(255,255,255,.4);padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">← Cerrar</button><button onclick="window.print()" style="background:white;color:#1a1917;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:500">Imprimir / Guardar PDF</button></span>
</div>
<div class="sheet">

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a1917">
  <div>
    <h1>Resumen de Retornos</h1>
    <div style="color:#6b6862;margin-top:4px">Para entrega al responsable del retorno</div>
  </div>
  <div style="text-align:right;font-size:22px;font-weight:300;color:#3b6cf4">${cot.folio||'—'}</div>
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
      if(p.modoPrecio==='Techo presupuestal')pvUnit=(p.techo||0)>0?(p.techo||0)/(1+IVA):costoUnit;
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

<div class="footer">
  <span>MSMS CORP — Documento confidencial</span>
  <span>Generado: ${new Date().toLocaleDateString('es-MX')}</span>
</div>
</div></body></html>`;

  openPrint(html);
}

// ══════════════════════════════════════════════════════════════
// 3. RESUMEN INTERNO
// ══════════════════════════════════════════════════════════════
export function printResumenInterno({ project, cot, calc }) {
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
    <div class="kpi"><div class="k-label">Costo total c/IVA</div><div class="k-value">${fmt(calc.costoTotalCIVA)}</div></div>
    <div class="kpi"><div class="k-label">Costo total s/IVA</div><div class="k-value">${fmt(calc.costoTotalSIVA)}</div></div>
  </div>
</div>

<div class="section">
  <h2>Utilidad y margen</h2>
  <div class="kpi-grid">
    <div class="kpi ${calc.utilBruta>0?'green':'red'}"><div class="k-label">Utilidad bruta s/IVA</div><div class="k-value" style="color:${calc.utilBruta>0?'#1D9E75':'#e24b4a'}">${fmt(calc.utilBruta)}</div></div>
    <div class="kpi"><div class="k-label">IVA a utilidad</div><div class="k-value">${fmt(calc.ivaAUtilidad)}</div></div>
    <div class="kpi ${calc.utilNeta>0?'green':'red'}"><div class="k-label">UTILIDAD NETA</div><div class="k-value" style="color:${calc.utilNeta>0?'#1D9E75':'#e24b4a'};font-size:20px">${fmt(calc.utilNeta)}</div></div>
    <div class="kpi"><div class="k-label">Margen sobre costo (bruto)</div><div class="k-value" style="color:${calc.margen>=.2?'#1D9E75':calc.margen>=.1?'#d97706':'#e24b4a'}">${pctS(calc.margen)}</div></div>
    <div class="kpi"><div class="k-label">Margen sobre costo (neto)</div><div class="k-value" style="color:${calc.margenNeto>=.2?'#1D9E75':calc.margenNeto>=.1?'#d97706':'#e24b4a'}">${pctS(calc.margenNeto)}</div></div>
  </div>
</div>

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
        if(p.modoPrecio==='Techo presupuestal')pvUnit=(p.techo||0)>0?(p.techo||0)/(1+IVA):costoUnit;
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
