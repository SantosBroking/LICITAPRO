// ai_analyzer.js — Análisis de documentos con Claude (Anthropic)
// Claude acepta PDFs nativamente — sin necesidad de extraer texto

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

const PROMPTS = {
  bases: `Eres experto en licitaciones públicas mexicanas. Analiza este documento y extrae ÚNICAMENTE el siguiente JSON sin texto adicional, sin markdown, sin backticks:
{
  "tipoProcedimiento": "Licitación Pública Nacional/Internacional/Invitación/Adjudicación directa",
  "numeroLicitacion": "número exacto de licitación o convocatoria",
  "dependencia": "nombre completo de la dependencia convocante",
  "descripcion": "descripción del objeto de la licitación",
  "tipoProducto": "tipo de vehículos o productos solicitados",
  "ubicacion": "estado o municipio donde se entregan",
  "presupuestoEstimado": null,
  "partidas": [{"id":"P1","descripcion":"descripción","cantidad":0,"marca":"","modelo":""}],
  "fechaPublicacion": "YYYY-MM-DD o null",
  "fechaJuntaAclaraciones": "YYYY-MM-DD o null",
  "fechaPresentacion": "YYYY-MM-DD o null",
  "fechaFallo": "YYYY-MM-DD o null",
  "notas": "información relevante adicional"
}`,

  empresa: `Eres experto en documentos legales mexicanos. Analiza este documento (acta constitutiva, CSF, poder notarial, etc.) y extrae ÚNICAMENTE el siguiente JSON sin texto adicional, sin markdown, sin backticks:
{
  "razonSocial": "razón social completa",
  "nombreComercial": "nombre comercial si existe",
  "rfc": "RFC con homoclave",
  "regimenFiscal": "régimen fiscal",
  "domicilioFiscal": "domicilio fiscal completo",
  "codigoPostal": "CP",
  "ciudad": "ciudad",
  "estado": "estado",
  "representanteLegal": "nombre del representante legal",
  "cargoRepresentante": "cargo del representante",
  "telefono": "",
  "correo": "",
  "notario": "nombre del notario si aplica",
  "numeroEscritura": "número de escritura si aplica",
  "fechaConstitucion": "YYYY-MM-DD o null"
}`
};

export async function analyzeDocument(file, tipo, apiKey) {
  if (!apiKey) throw new Error('API key no configurada. Ve a Configuración → Inteligencia Artificial.');

  // Convertir archivo a base64
  const base64 = await fileToBase64(file);
  const dataB64 = base64.split(',')[1];
  
  // Determinar media type
  let mediaType = 'application/pdf';
  if (file.type.startsWith('image/')) mediaType = file.type;
  else if (file.name.endsWith('.png')) mediaType = 'image/png';
  else if (file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) mediaType = 'image/jpeg';

  const prompt = PROMPTS[tipo] || PROMPTS.bases;

  // Para PDFs usar document block, para imágenes usar image block
  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataB64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: dataB64 } };

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
        content: [
          contentBlock,
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `Error ${response.status}`;
    if (response.status === 401) throw new Error('API key inválida. Verifica tu key de Anthropic en Configuración.');
    if (response.status === 429) throw new Error('Límite de requests alcanzado. Espera un momento e intenta de nuevo.');
    throw new Error('Error de Claude API: ' + msg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || '';

  try {
    const clean = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    throw new Error('No se pudo leer la respuesta: ' + text.substring(0, 200));
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
}
