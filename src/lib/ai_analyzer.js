// ai_analyzer.js — Análisis de documentos con Claude (Anthropic)
// Soporta PDFs nativamente, incluyendo actas con múltiples reformas

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const PROMPTS = {
  bases: `Eres experto en licitaciones públicas mexicanas. Analiza este documento y extrae ÚNICAMENTE el siguiente JSON sin texto adicional, sin markdown, sin backticks:
{
  "tipoProcedimiento": "Licitación Pública Nacional / Internacional / Invitación a cuando menos 3 personas / Adjudicación directa",
  "numeroLicitacion": "número exacto de licitación o convocatoria",
  "dependencia": "nombre completo de la dependencia convocante",
  "descripcion": "descripción del objeto de la licitación",
  "tipoProducto": "tipo de vehículos o productos solicitados",
  "ubicacion": "estado o municipio donde se entregan",
  "presupuestoEstimado": null,
  "partidas": [{"id":"P1","descripcion":"descripción detallada","cantidad":0,"marca":"","modelo":"","especificaciones":""}],
  "fechaPublicacion": "YYYY-MM-DD o null",
  "fechaJuntaAclaraciones": "YYYY-MM-DD o null",
  "fechaPresentacion": "YYYY-MM-DD o null",
  "fechaFallo": "YYYY-MM-DD o null",
  "notas": "información relevante adicional como garantías, requisitos especiales, etc."
}`,

  empresa: `Eres experto en documentos legales mexicanos, especialmente en actas constitutivas y sus reformas.

IMPORTANTE: Este documento puede ser una acta constitutiva con UNA O VARIAS REFORMAS. Si hay reformas, extrae la información MÁS RECIENTE (última reforma). Los datos que más frecuentemente cambian entre reformas son: razón social, socios, representante legal, domicilio y capital social.

Analiza el documento completo y extrae ÚNICAMENTE el siguiente JSON sin texto adicional, sin markdown, sin backticks:
{
  "razonSocial": "razón social completa y vigente (de la última reforma si existe)",
  "nombreComercial": "nombre comercial si existe",
  "rfc": "RFC con homoclave (del CSF si está disponible)",
  "regimenFiscal": "régimen fiscal",
  "domicilioFiscal": "domicilio fiscal completo vigente",
  "codigoPostal": "CP",
  "ciudad": "ciudad",
  "estado": "estado",
  "representanteLegal": "nombre completo del representante legal vigente",
  "cargoRepresentante": "cargo del representante (Administrador Único, Director General, etc.)",
  "telefono": "",
  "correo": "",
  "notario": "nombre del notario del acta constitutiva o última reforma",
  "numeroEscritura": "número de escritura del acta o última reforma",
  "fechaConstitucion": "YYYY-MM-DD de constitución original o null",
  "fechaUltimaReforma": "YYYY-MM-DD de la última reforma o null",
  "numeroDereformas": 0,
  "objetoSocial": "primeras 200 caracteres del objeto social"
}`
};

export async function analyzeDocument(file, tipo, apiKey) {
  if (!apiKey) throw new Error('API key no configurada. Ve a Configuración → Inteligencia Artificial y agrega tu key de Anthropic.');

  const base64 = await fileToBase64(file);
  const dataB64 = base64.split(',')[1];

  let mediaType = 'application/pdf';
  if (file.type.startsWith('image/')) mediaType = file.type;
  else if (file.name.toLowerCase().endsWith('.png')) mediaType = 'image/png';
  else if (file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) mediaType = 'image/jpeg';

  const prompt = PROMPTS[tipo] || PROMPTS.bases;

  const contentBlock = (mediaType === 'application/pdf')
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataB64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: dataB64 } };

  const response = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [ contentBlock, { type: 'text', text: prompt } ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `Error ${response.status}`;
    if (response.status === 401) throw new Error('API key inválida. Ve a Configuración → Inteligencia Artificial y verifica tu key de Anthropic (console.anthropic.com).');
    if (response.status === 429) throw new Error('Demasiadas solicitudes. Espera un momento e intenta de nuevo.');
    if (response.status === 413) throw new Error('El archivo es demasiado grande. Intenta con un PDF de menos páginas.');
    throw new Error('Error de Claude API: ' + msg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || '';

  try {
    const clean = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    throw new Error('Claude no pudo extraer datos estructurados. El documento puede estar escaneado sin OCR o ser ilegible. Detalle: ' + text.substring(0, 300));
  }
}

// Múltiples archivos: analiza cada uno y combina los resultados
export async function analyzeMultipleDocuments(files, tipo, apiKey) {
  const results = [];
  for (const file of files) {
    const result = await analyzeDocument(file, tipo, apiKey);
    results.push(result);
  }

  if (results.length === 1) return results[0];

  // Combinar: el último archivo tiene prioridad (asumiendo orden cronológico)
  const merged = { ...results[0] };
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.razonSocial)         merged.razonSocial = r.razonSocial;
    if (r.representanteLegal)  merged.representanteLegal = r.representanteLegal;
    if (r.domicilioFiscal)     merged.domicilioFiscal = r.domicilioFiscal;
    if (r.fechaUltimaReforma)  merged.fechaUltimaReforma = r.fechaUltimaReforma;
    if (r.notario)             merged.notario = r.notario;
    if (r.numeroEscritura)     merged.numeroEscritura = r.numeroEscritura;
    merged.numeroDereformas = (merged.numeroDereformas || 0) + 1;
  }
  return merged;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
}
