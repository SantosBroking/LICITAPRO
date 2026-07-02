// firmas.js — Flujo de autorizaciones de 5 estados
// Los documentos en flujo se guardan dentro de cada proyecto en project.firmas[]
//
// ESTADOS:
//   en_aprobacion  → creado por empleado, espera aprobación del jefe
//   rechazado      → el jefe lo rechazó; vuelve al empleado para corregir
//   en_firma       → aprobado; espera que el responsable suba el firmado
//   en_visto       → firmado subido; espera visto final del jefe
//   completado     → visto bueno final; cerrado y archivado

import { uid, TODAY } from './utils.js';

function ahora() { return new Date().toISOString().slice(0,16).replace('T',' '); }

export function nuevoDocFlujo({ tipo, titulo, folio, proyectoId, creadoPorNombre, creadoPorEmail, responsableNombre, responsableEmail, ocId, docMembretadoId, empresaId, notas }) {
  return {
    id: uid('flujo'),
    tipo: tipo || 'documento',
    titulo: titulo || 'Documento',
    folio: folio || '',
    proyectoId: proyectoId || null,
    creadoPor: { nombre: creadoPorNombre||'', email: creadoPorEmail||'' },
    responsable: { nombre: responsableNombre||'', email: responsableEmail||'' },
    estatus: 'en_aprobacion',
    archivoFirmado: null,
    comentarioRechazo: '',
    ocId: ocId || null,
    docMembretadoId: docMembretadoId || null,
    empresaId: empresaId || null,
    notas: notas || '',
    fechaCreacion: TODAY(),
    historial: [{ accion:'creado', por: creadoPorNombre||creadoPorEmail||'', fecha: ahora(), comentario:'' }],
  };
}

export const ESTADO_INFO = {
  en_aprobacion: { label:'En aprobación', color:'#5B8DEF', icono:'⏳' },
  rechazado:     { label:'Rechazado',     color:'#E24B4A', icono:'❌' },
  en_firma:      { label:'En firma',      color:'#EF9F27', icono:'✍️' },
  en_visto:      { label:'En visto final',color:'#9B7EDE', icono:'👁️' },
  completado:    { label:'Completado',    color:'#1D9E75', icono:'✅' },
};

export function aprobar(doc, porNombre) {
  return { ...doc, estatus:'en_firma', historial:[...(doc.historial||[]), { accion:'aprobado', por:porNombre, fecha:ahora(), comentario:'' }] };
}
export function rechazar(doc, porNombre, comentario) {
  return { ...doc, estatus:'rechazado', comentarioRechazo:comentario||'', historial:[...(doc.historial||[]), { accion:'rechazado', por:porNombre, fecha:ahora(), comentario:comentario||'' }] };
}
export function reenviar(doc, porNombre) {
  return { ...doc, estatus:'en_aprobacion', comentarioRechazo:'', historial:[...(doc.historial||[]), { accion:'reenviado', por:porNombre, fecha:ahora(), comentario:'' }] };
}
export function subirFirmadoDoc(doc, archivo, porNombre) {
  return { ...doc, estatus:'en_visto', archivoFirmado:{ ...archivo, subidoPor:porNombre, fecha:TODAY() }, historial:[...(doc.historial||[]), { accion:'firmado', por:porNombre, fecha:ahora(), comentario:'' }] };
}
export function vistoFinal(doc, porNombre) {
  return { ...doc, estatus:'completado', historial:[...(doc.historial||[]), { accion:'visto_final', por:porNombre, fecha:ahora(), comentario:'' }] };
}
export function devolver(doc, porNombre, comentario) {
  return { ...doc, estatus:'en_firma', historial:[...(doc.historial||[]), { accion:'devuelto', por:porNombre, fecha:ahora(), comentario:comentario||'' }] };
}

function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function wrapEmail(titulo, cuerpoHtml) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;background:#f0ede8;font-family:\'Helvetica Neue\',Arial,sans-serif;color:#1a1917">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px">'
    + '<div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e1d8">'
    + '<div style="background:#1a1917;color:#fff;padding:20px 24px">'
    + '<div style="font-size:12px;letter-spacing:.5px;opacity:.7">MSMS CORP · LICITAPRO</div>'
    + '<div style="font-size:18px;font-weight:700;margin-top:4px">' + esc(titulo) + '</div></div>'
    + '<div style="padding:24px">' + cuerpoHtml + '</div>'
    + '<div style="padding:16px 24px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center">Mensaje automático de LicitaPro · MSMS CORP</div>'
    + '</div></div></body></html>';
}

function tablaDoc(doc, proyectoNombre) {
  return '<div style="background:#f7f5f1;border-radius:10px;padding:16px;margin:16px 0">'
    + '<table style="width:100%;font-size:13px;border-collapse:collapse">'
    + '<tr><td style="color:#888;padding:4px 0;width:120px">Documento</td><td style="font-weight:600">' + esc(doc.titulo) + '</td></tr>'
    + (doc.folio?'<tr><td style="color:#888;padding:4px 0">Folio</td><td style="font-family:monospace">' + esc(doc.folio) + '</td></tr>':'')
    + (proyectoNombre?'<tr><td style="color:#888;padding:4px 0">Proyecto</td><td>' + esc(proyectoNombre) + '</td></tr>':'')
    + '</table></div>';
}

function btnLink(linkApp, texto) {
  return linkApp?'<div style="text-align:center;margin-top:20px"><a href="' + esc(linkApp) + '" style="display:inline-block;background:#1a1917;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">' + texto + '</a></div>':'';
}

async function enviar(to, subject, html, attachments) {
  if (!to) throw new Error('Falta destinatario');
  const res = await fetch('/api/send-email', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'MSMS CORP <santiago@brokingroup.com>', to, subject, html, attachments }),
  });
  const data = await res.json().catch(function(){return {};});
  if (!res.ok || !data.ok) throw new Error((data && data.resend && data.resend.message) || (data && data.error) || ('HTTP '+res.status));
  return data.resend;
}

export async function avisarAprobacion(opts) {
  var doc=opts.doc, proyectoNombre=opts.proyectoNombre, jefeEmail=opts.jefeEmail, linkApp=opts.linkApp;
  var cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola,</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px"><strong>' + esc(doc.creadoPor.nombre||'Un empleado') + '</strong> creó un documento que requiere tu aprobación antes de salir.</p>'
    + tablaDoc(doc, proyectoNombre)
    + (doc.notas?'<p style="font-size:13px;color:#555;margin:0 0 16px"><strong>Notas:</strong> ' + esc(doc.notas) + '</p>':'')
    + '<div style="background:#E6F1FB;border-radius:10px;padding:14px 16px;font-size:13px;color:#1A4480;line-height:1.6">Entra a LicitaPro &rarr; <strong>Firmas</strong> &rarr; <strong>Por aprobar</strong> para aprobarlo o rechazarlo.</div>'
    + btnLink(linkApp, 'Revisar ahora');
  return enviar(jefeEmail, 'Por aprobar: ' + doc.titulo + (doc.folio?' ('+doc.folio+')':''), wrapEmail('Documento por aprobar', cuerpo), undefined);
}

export async function avisarFirma(opts) {
  var doc=opts.doc, proyectoNombre=opts.proyectoNombre, pdfBase64=opts.pdfBase64, pdfNombre=opts.pdfNombre, linkApp=opts.linkApp;
  var attachments = pdfBase64 ? [{ filename: pdfNombre||'documento.pdf', content: pdfBase64 }] : undefined;
  var cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola' + (doc.responsable.nombre?' '+esc(doc.responsable.nombre):'') + ',</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">El documento fue <strong>aprobado</strong> y ahora requiere tu firma.' + (pdfBase64?' Adjunto encontrar&aacute;s el PDF.':'') + '</p>'
    + tablaDoc(doc, proyectoNombre)
    + '<div style="background:#FBF3DE;border-radius:10px;padding:14px 16px;font-size:13px;color:#633806;line-height:1.6"><strong>&iquest;Qu&eacute; hacer?</strong><br>1. Firma el documento (f&iacute;sico o digital).<br>2. Entra a LicitaPro &rarr; <strong>Firmas</strong> &rarr; <strong>Por firmar</strong>.<br>3. Sube el documento firmado.</div>'
    + btnLink(linkApp, 'Abrir mi buzón');
  return enviar(doc.responsable.email, 'Por firmar: ' + doc.titulo + (doc.folio?' ('+doc.folio+')':''), wrapEmail('Documento aprobado · por firmar', cuerpo), attachments);
}

export async function avisarRechazo(opts) {
  var doc=opts.doc, proyectoNombre=opts.proyectoNombre, comentario=opts.comentario;
  if (!doc.creadoPor.email) return;
  var cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola' + (doc.creadoPor.nombre?' '+esc(doc.creadoPor.nombre):'') + ',</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Tu documento fue <strong style="color:#E24B4A">rechazado</strong> y necesita correcciones.</p>'
    + tablaDoc(doc, proyectoNombre)
    + (comentario?'<div style="background:#FBEAEA;border-radius:10px;padding:14px 16px;font-size:13px;color:#8A2A2A;line-height:1.6"><strong>Motivo:</strong> ' + esc(comentario) + '</div>':'')
    + '<p style="font-size:13px;color:#555;margin:16px 0 0">Corrige el documento y vu&eacute;lvelo a enviar a aprobaci&oacute;n.</p>';
  return enviar(doc.creadoPor.email, 'Rechazado: ' + doc.titulo, wrapEmail('Documento rechazado', cuerpo), undefined);
}

export async function avisarVistoFinal(opts) {
  var doc=opts.doc, proyectoNombre=opts.proyectoNombre, jefeEmail=opts.jefeEmail, linkApp=opts.linkApp;
  var cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola,</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px"><strong>' + esc(doc.responsable.nombre||'El responsable') + '</strong> subió el documento firmado. Requiere tu visto final para cerrarse.</p>'
    + tablaDoc(doc, proyectoNombre)
    + '<div style="background:#F1ECF9;border-radius:10px;padding:14px 16px;font-size:13px;color:#4A2A7A;line-height:1.6">Entra a LicitaPro &rarr; <strong>Firmas</strong> &rarr; <strong>Por aprobar</strong> para dar el visto bueno.</div>'
    + btnLink(linkApp, 'Dar visto final');
  return enviar(jefeEmail, 'Visto final: ' + doc.titulo + (doc.folio?' ('+doc.folio+')':''), wrapEmail('Documento firmado · visto final', cuerpo), undefined);
}

// Correo: avisar a un empleado que se le asignó un proyecto
export async function avisarAsignacionProyecto(opts) {
  var responsableNombre=opts.responsableNombre, responsableEmail=opts.responsableEmail;
  var proyectoNombre=opts.proyectoNombre, dependencia=opts.dependencia, asignadoPor=opts.asignadoPor;
  var numLicitacion=opts.numLicitacion, fechaFallo=opts.fechaFallo, linkApp=opts.linkApp;
  if (!responsableEmail) throw new Error('El responsable no tiene correo registrado');
  var detalles = '<div style="background:#f7f5f1;border-radius:10px;padding:16px;margin:16px 0">'
    + '<table style="width:100%;font-size:13px;border-collapse:collapse">'
    + '<tr><td style="color:#888;padding:4px 0;width:130px">Proyecto</td><td style="font-weight:600">' + esc(proyectoNombre) + '</td></tr>'
    + (dependencia?'<tr><td style="color:#888;padding:4px 0">Dependencia</td><td>' + esc(dependencia) + '</td></tr>':'')
    + (numLicitacion?'<tr><td style="color:#888;padding:4px 0">No. Licitación</td><td style="font-family:monospace">' + esc(numLicitacion) + '</td></tr>':'')
    + (fechaFallo?'<tr><td style="color:#888;padding:4px 0">Fecha de fallo</td><td>' + esc(fechaFallo) + '</td></tr>':'')
    + '</table></div>';
  var cuerpo = '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola' + (responsableNombre?' '+esc(responsableNombre):'') + ',</p>'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px"><strong>' + esc(asignadoPor||'La dirección') + '</strong> te ha asignado como responsable del siguiente proyecto de licitación:</p>'
    + detalles
    + '<div style="background:#E6F1FB;border-radius:10px;padding:14px 16px;font-size:13px;color:#1A4480;line-height:1.6">'
    + '<strong>Es tu responsabilidad:</strong><br>Recopilar la información y documentación requerida, dar seguimiento a las fechas clave del proceso, y mantener el expediente del proyecto completo y actualizado en LicitaPro.</div>'
    + btnLink(linkApp, 'Ver el proyecto');
  return enviar(responsableEmail, 'Se te asignó el proyecto: ' + proyectoNombre, wrapEmail('Nuevo proyecto asignado', cuerpo), undefined);
}
