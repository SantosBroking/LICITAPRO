// inbox_firma_emails.js — Fase 3D-B3
//
// Correos del flujo NUEVO de firma dentro de Inbox / Centro de
// aprobaciones (inbox_items type='firma_documento'). Reutiliza los
// helpers genéricos ya existentes en src/lib/firmas.js (wrapEmail,
// tablaDoc, btnLink, esc, enviar) -- ninguno de ellos depende de
// project.firmas[], son genéricos (reciben strings/HTML planos), por eso
// es seguro reutilizarlos aquí sin acoplar este flujo nuevo al legacy.
//
// IMPORTANTE: este archivo es 100% independiente del flujo legacy de
// Firmas.js/project.firmas[] -- nunca se llama desde ahí, y nada de lo
// que hay aquí toca ese sistema. Los textos de estos correos apuntan al
// Inbox / Centro de aprobaciones (no a "Firmas", que ya no es un módulo
// de navegación principal desde Fase 3D-B1.2).
//
// Nunca se incluye en el cuerpo de estos correos: utilidad, margen,
// montoGanar, flujo, corrida, project_financials, facturaIntermedia,
// facturaGobierno, ni ocSettings -- solo referencias livianas (folios,
// nombres, estatus), igual que el resto del sistema de Inbox.

import { wrapEmail, tablaDoc, btnLink, esc, enviar } from './firmas.js';

const LINK_APP = 'https://licitapro-beta.vercel.app/?view=inbox';

// A. Se crea una firma de OC nueva -- avisar al firmante asignado.
// Destinatario: assigned_to (el campo real que ya valida el servidor
// para ownership, ver api/inbox-update.js) -- data.firmanteEmail es
// siempre el mismo valor en la creación actual (Projects.js), se usa
// solo como respaldo si por algún motivo assigned_to viniera vacío.
export async function avisarFirmaRequeridaInbox({ documentoFolio, folioProyecto, proyectoNombre, firmanteEmail, firmanteNombre }) {
  const destinatario = firmanteEmail;
  if (!destinatario) return; // sin destinatario real, no se envía nada (nunca se inventa uno)
  const docAdaptado = { titulo: 'Orden de Compra', folio: documentoFolio };
  const cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola' + (firmanteNombre?' '+esc(firmanteNombre):'') + ',</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hay una Orden de Compra pendiente de tu firma en el <strong>Centro de aprobaciones</strong>.</p>'
    + tablaDoc(docAdaptado, proyectoNombre)
    + (folioProyecto ? '<p style="font-size:12px;color:#888;margin:0 0 16px">Folio de proyecto: <span style="font-family:monospace">' + esc(folioProyecto) + '</span></p>' : '')
    + '<div style="background:#E6F1FB;border-radius:10px;padding:14px 16px;font-size:13px;color:#1A4480;line-height:1.6">Entra a LicitaPro &rarr; <strong>Inbox / Centro de aprobaciones</strong> &rarr; pestaña <strong>Firmas</strong> para verla y subir el documento firmado cuando lo tengas.</div>'
    + btnLink(LINK_APP, 'Abrir Centro de aprobaciones');
  return enviar(destinatario, 'Firma requerida — OC ' + (documentoFolio||''), wrapEmail('Firma requerida', cuerpo), undefined);
}

// B. El firmante sube el documento firmado -- avisar a quien creó la
// solicitud (created_by), que requiere visto bueno final.
export async function avisarDocumentoFirmadoSubidoInbox({ documentoFolio, folioProyecto, proyectoNombre, subidoPorEmail, subidoPorNombre, creadorEmail }) {
  const destinatario = creadorEmail;
  if (!destinatario) return;
  const docAdaptado = { titulo: 'Orden de Compra', folio: documentoFolio };
  const cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola,</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px"><strong>' + esc(subidoPorNombre || subidoPorEmail || 'El firmante') + '</strong> subió el documento firmado. Requiere visto bueno final para cerrarse.</p>'
    + tablaDoc(docAdaptado, proyectoNombre)
    + (folioProyecto ? '<p style="font-size:12px;color:#888;margin:0 0 16px">Folio de proyecto: <span style="font-family:monospace">' + esc(folioProyecto) + '</span></p>' : '')
    + '<div style="background:#F1ECF9;border-radius:10px;padding:14px 16px;font-size:13px;color:#4A2A7A;line-height:1.6">Entra a LicitaPro &rarr; <strong>Inbox / Centro de aprobaciones</strong> &rarr; pestaña <strong>Firmas</strong> para revisar el documento y dar el visto bueno final.</div>'
    + btnLink(LINK_APP, 'Abrir Centro de aprobaciones');
  return enviar(destinatario, 'Documento firmado subido — ' + (documentoFolio||''), wrapEmail('Documento firmado · por revisar', cuerpo), undefined);
}

// C. Admin da el visto bueno final -- avisar a quien creó la solicitud y,
// si es distinto, también al firmante (ambos suelen querer confirmación
// de que quedó cerrado). Se envía a un conjunto de emails único (sin
// duplicar si coinciden).
export async function avisarVistoBuenoFinalInbox({ documentoFolio, folioProyecto, proyectoNombre, creadorEmail, firmanteEmail }) {
  const destinatarios = [...new Set([creadorEmail, firmanteEmail].filter(Boolean))];
  if (!destinatarios.length) return;
  const docAdaptado = { titulo: 'Orden de Compra', folio: documentoFolio };
  const cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola,</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Se dio el <strong>visto bueno final</strong> a esta Orden de Compra. Queda <strong>cerrada</strong> y liberada para reimpresión si aplica.</p>'
    + tablaDoc(docAdaptado, proyectoNombre)
    + (folioProyecto ? '<p style="font-size:12px;color:#888;margin:0 0 16px">Folio de proyecto: <span style="font-family:monospace">' + esc(folioProyecto) + '</span></p>' : '')
    + btnLink(LINK_APP, 'Ver en Centro de aprobaciones');
  return enviar(destinatarios, 'Firma aprobada — ' + (documentoFolio||''), wrapEmail('Firma completada', cuerpo), undefined);
}

// D. Admin rechaza o pide cambios -- avisar a quien creó la solicitud.
export async function avisarFirmaRechazadaInbox({ documentoFolio, folioProyecto, proyectoNombre, creadorEmail, comentario, esRechazo }) {
  const destinatario = creadorEmail;
  if (!destinatario) return;
  const docAdaptado = { titulo: 'Orden de Compra', folio: documentoFolio };
  const tituloAccion = esRechazo ? 'rechazada' : 'con cambios solicitados';
  const cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola,</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">La solicitud de firma fue marcada como <strong style="color:#E24B4A">' + tituloAccion + '</strong>.</p>'
    + tablaDoc(docAdaptado, proyectoNombre)
    + (comentario ? '<div style="background:#FBEAEA;border-radius:10px;padding:14px 16px;font-size:13px;color:#8A2A2A;line-height:1.6"><strong>Comentario:</strong> ' + esc(comentario) + '</div>' : '')
    + btnLink(LINK_APP, 'Ver en Centro de aprobaciones');
  return enviar(destinatario, (esRechazo?'Firma rechazada — ':'Cambios solicitados — ') + (documentoFolio||''), wrapEmail('Firma ' + tituloAccion, cuerpo), undefined);
}
