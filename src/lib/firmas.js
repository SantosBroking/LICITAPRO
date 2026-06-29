// firmas.js — Buzón de pendientes de firma y notificación por correo
// Los pendientes se guardan dentro de cada proyecto en project.firmas[]
// Cada pendiente: { id, tipo, titulo, folio, responsableNombre, responsableEmail,
//                   solicitadoPor, fechaSolicitud, estatus:'pendiente'|'firmado',
//                   archivoFirmado:{url,nombre,fecha}, docMembretadoId, ocId }

import { uid, TODAY } from './utils.js';

export function nuevoPendienteFirma({ tipo, titulo, folio, responsableNombre, responsableEmail, solicitadoPor, docMembretadoId, ocId, empresaId, notas }) {
  return {
    id: uid('firma'),
    tipo: tipo || 'documento',           // 'oc' | 'documento' | 'acta' | 'otro'
    titulo: titulo || 'Documento',
    folio: folio || '',
    responsableNombre: responsableNombre || '',
    responsableEmail: responsableEmail || '',
    solicitadoPor: solicitadoPor || '',
    fechaSolicitud: TODAY(),
    estatus: 'pendiente',
    archivoFirmado: null,
    docMembretadoId: docMembretadoId || null,
    ocId: ocId || null,
    empresaId: empresaId || null,
    notas: notas || '',
  };
}

function buildFirmaEmailHTML({ responsableNombre, titulo, folio, proyectoNombre, solicitadoPor, notas, linkApp }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f0ede8;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1917">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e1d8">
      <div style="background:#1a1917;color:#fff;padding:20px 24px">
        <div style="font-size:12px;letter-spacing:.5px;opacity:.7">MSMS CORP · LICITAPRO</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">Documento pendiente de firma</div>
      </div>
      <div style="padding:24px">
        <p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola${responsableNombre?' '+esc(responsableNombre):''},</p>
        <p style="font-size:14px;line-height:1.6;margin:0 0 16px">Se te ha asignado un documento para tu firma${solicitadoPor?', solicitado por '+esc(solicitadoPor):''}. Adjunto encontrarás el PDF.</p>
        <div style="background:#f7f5f1;border-radius:10px;padding:16px;margin:16px 0">
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="color:#888;padding:4px 0;width:120px">Documento</td><td style="font-weight:600">${esc(titulo)}</td></tr>
            ${folio?`<tr><td style="color:#888;padding:4px 0">Folio</td><td style="font-family:monospace">${esc(folio)}</td></tr>`:''}
            ${proyectoNombre?`<tr><td style="color:#888;padding:4px 0">Proyecto</td><td>${esc(proyectoNombre)}</td></tr>`:''}
          </table>
        </div>
        ${notas?`<p style="font-size:13px;line-height:1.6;color:#555;margin:0 0 16px"><strong>Notas:</strong> ${esc(notas)}</p>`:''}
        <div style="background:#FBF3DE;border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.6;color:#633806">
          <strong>¿Qué tienes que hacer?</strong><br>
          1. Imprime o firma digitalmente el PDF adjunto.<br>
          2. Entra a LicitaPro, ve a tu buzón de <strong>Firmas</strong>.<br>
          3. Sube el documento firmado. El pendiente no se quita hasta que lo subas.
        </div>
        ${linkApp?`<div style="text-align:center;margin-top:20px"><a href="${esc(linkApp)}" style="display:inline-block;background:#1a1917;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">Abrir mi buzón de firmas</a></div>`:''}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center">Este es un mensaje automático de LicitaPro · MSMS CORP</div>
    </div>
  </div>
</body></html>`;
}

function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Envía el correo de solicitud de firma con el PDF adjunto (base64)
export async function enviarSolicitudFirma({ pendiente, proyectoNombre, pdfBase64, pdfNombre, linkApp }) {
  if (!pendiente.responsableEmail) throw new Error('El responsable no tiene correo configurado');

  const attachments = pdfBase64 ? [{ filename: pdfNombre || 'documento.pdf', content: pdfBase64 }] : undefined;
  const subject = `Pendiente de firma: ${pendiente.titulo}${pendiente.folio?' ('+pendiente.folio+')':''}`;
  const html = buildFirmaEmailHTML({
    responsableNombre: pendiente.responsableNombre, titulo: pendiente.titulo, folio: pendiente.folio,
    proyectoNombre, solicitadoPor: pendiente.solicitadoPor, notas: pendiente.notas, linkApp,
  });

  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      from: 'MSMS CORP <santiago@brokingroup.com>',
      to: pendiente.responsableEmail,
      subject, html, attachments,
    }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.ok) {
    const msg = data?.resend?.message || data?.error || ('HTTP ' + res.status);
    throw new Error('Error al enviar: ' + msg);
  }
  return data.resend;
}
