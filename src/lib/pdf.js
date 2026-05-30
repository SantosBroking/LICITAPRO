// ─────────────────────────────────────────────────────────────
// pdf.js  —  Extracción y parsing de documentos legales PDF
//            Usa window.pdfjsLib (cargado como script global)
// ─────────────────────────────────────────────────────────────

/** Extrae todo el texto de un PDF */
export async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();
    text += tc.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}

/** Parsea texto de acta constitutiva */
export function parseActa(text) {
  const r = {};
  const t = text.replace(/\s+/g, ' ');
  let m;

  m = t.match(/(?:Notari[oa]\s+P[uú]blic[oa])[^,]*?(?:Lic(?:enciado)?\.?\s*)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})/i);
  if (m) r.notario = m[1].trim();

  m = t.match(/Notar[ií]a\s+P[uú]blica\s+(?:N[uú]mero|No\.?)\s*(\d+)/i);
  if (m) r.notaria = `Notaría Pública No. ${m[1]}`;

  m = t.match(/[Ee]scritura\s+(?:P[uú]blica\s+)?(?:N[uú]mero|No\.?)\s*([\d,\.]+)/i);
  if (m) r.escritura = m[1];

  m = t.match(/(?:Estado\s+(?:Libre\s+y\s+Soberano\s+)?de|estado\s+de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/i);
  if (m) r.estado = m[1].trim();

  m = t.match(/[Oo]bjeto\s+[Ss]ocial[:\s]+([^.]{10,300})/);
  if (m) r.objetoSocial = m[1].trim();

  m = t.match(/R\.?F\.?C\.?\s*[:\s]*([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})/i);
  if (m) r.rfc = m[1].toUpperCase();

  m = t.match(/(?:denominaci[oó]n|raz[oó]n\s+social)[^\"\u201C\u201D]*[\"\u201C]([^\"\u201D]+)[\"\u201D]/i);
  if (m) r.name = m[1].trim();

  const socRe = /(?:socio|accionista|(?:C\.|Sr\.?\s))\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})[\s,]*(?:con\s+)?(\d+(?:\.\d+)?)\s*%/gi;
  const socios = [];
  let sm;
  while ((sm = socRe.exec(t)) !== null)
    socios.push({ nombre: sm[1].trim(), porcentaje: parseFloat(sm[2]) });
  if (socios.length > 0) r.socios = socios;

  return r;
}

/** Parsea texto de constancia de situación fiscal */
export function parseConstanciaFiscal(text) {
  const r = {};
  const t = text.replace(/\s+/g, ' ');
  let m;

  m = t.match(/R\.?F\.?C\.?\s*[:\s]*([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})/i);
  if (m) r.rfc = m[1].toUpperCase();

  m = t.match(/(?:Denominaci[oó]n|Raz[oó]n)\s+(?:o\s+raz[oó]n\s+social|social)[:\s]+([A-ZÁÉÍÓÚÑ0-9\s\.,&]+?)(?=\s+(?:R[eé]gimen|Fecha|Estatus|C[oó]digo))/i);
  if (m) r.name = m[1].trim();

  m = t.match(/R[eé]gimen[:\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ\s,]+?)(?=\s+(?:Fecha|Estatus|Domicilio|C[oó]digo))/i);
  if (m) r.regimen = m[1].trim();

  m = t.match(/Fecha\s+de\s+inicio\s+de\s+operaciones[:\s]+(\d{1,2}\s+de\s+[a-zA-Z]+\s+de\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/i);
  if (m) r.fechaInicioOperaciones = m[1].trim();

  m = t.match(/Estatus\s+(?:en\s+el\s+padr[oó]n)?[:\s]+([A-Z][A-Za-záéíóúñ\s]+?)(?=\s+(?:Fecha|R[eé]gimen|C[oó]digo|Domicilio))/i);
  if (m) r.situacion = m[1].trim();

  m = t.match(/C[oó]digo\s+postal[:\s]+(\d{5})/i);
  if (m) r.cp = m[1];

  m = t.match(/Domicilio\s+(?:fiscal\s+)?[:\s]*([A-Z0-9].*?)(?=\s+(?:Actividad|R[eé]gimen|Obligaciones))/i);
  if (m) r.address = m[1].trim().slice(0, 200);

  return r;
}
