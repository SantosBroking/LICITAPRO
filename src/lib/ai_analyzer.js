// ai_analyzer.js — Análisis de documentos con Claude (Anthropic)
// Claude acepta PDFs nativamente. Soporta acta, reformas y CSF.

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const PROMPTS = {
  bases: `Eres experto en licitaciones públicas mexicanas. Analiza este documento y responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"tipoProcedimiento":"Licitación Pública Nacional/Internacional/Invitación/Adjudicación directa","numeroLicitacion":"","dependencia":"","descripcion":"","tipoProducto":"","ubicacion":"","presupuestoEstimado":null,"partidas":[{"id":"P1","descripcion":"","cantidad":0}],"fechaPublicacion":null,"fechaJuntaAclaraciones":null,"fechaPresentacion":null,"fechaFallo":null,"fechaContrato":null,"notas":""}
Las fechas en formato YYYY-MM-DD o null si no aparecen.`,

  empresa: `Eres experto en documentos legales mexicanos (actas constitutivas y reformas). Si hay reformas, usa los datos MÁS RECIENTES.

IMPORTANTE: "razonSocial" es el NOMBRE de la empresa (ejemplo: SATHRI, GRUPO SURMAN). NUNCA pongas el tipo de sociedad (S.A. de C.V., S.A.P.I. de C.V.) en razonSocial — eso va en regimenCapital.

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"razonSocial":"","nombreComercial":"","rfc":"","regimenFiscal":"","regimenCapital":"","domicilioFiscal":"","codigoPostal":"","ciudad":"","estado":"","representanteLegal":"","cargoRepresentante":"","telefono":"","correo":"","notario":"","numeroEscritura":"","fechaConstitucion":null,"fechaUltimaReforma":null,"objetoSocial":""}`,

  constancia: `Analiza esta Constancia de Situación Fiscal (CSF) del SAT mexicano.

LEE CON CUIDADO LOS CAMPOS:
- "razonSocial" = el valor del campo "Denominación/Razón Social" (el nombre corto, ejemplo: SATHRI, GRUPO SURMAN). NUNCA pongas aquí el "Régimen Capital".
- "regimenCapital" = el valor del campo "Régimen Capital" (ejemplo: SOCIEDAD ANONIMA PROMOTORA DE INVERSION DE CAPITAL VARIABLE)
- "domicilioFiscal" = combina: [Tipo Vialidad] [Nombre Vialidad] [Núm Ext], [Núm Int], COL. [Colonia]. Ejemplo: "CALLE AMORES 1722, TORRE B 202, COL. DEL VALLE CENTRO"
- "ciudad" = campo "Municipio o Demarcación Territorial"
- "estado" = campo "Entidad Federativa"
- "regimenFiscal" = el régimen de la sección "Regímenes" (ejemplo: Régimen General de Ley Personas Morales)
- fechas en formato YYYY-MM-DD

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"razonSocial":"","nombreComercial":"","rfc":"","regimenFiscal":"","regimenCapital":"","domicilioFiscal":"","codigoPostal":"","ciudad":"","estado":"","telefono":"","correo":"","fechaInicioOperaciones":null,"estatus":""}`
};

// Llamada a Claude con reintento automático en 429
async function callClaudeAPI(contentBlock, prompt, apiKey, retries = 2) {
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
      max_tokens: 1500,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
    })
  });

  if (response.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 6000));
    return callClaudeAPI(contentBlock, prompt, apiKey, retries - 1);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || ('Error ' + response.status);
    if (response.status === 401) throw new Error('API key inválida. Revisa tu key de Anthropic en Configuración → 🤖 Inteligencia Artificial.');
    if (response.status === 429) throw new Error('Límite de solicitudes alcanzado. Espera 1 minuto e intenta de nuevo.');
    if (response.status === 413) throw new Error('El archivo es muy grande. Usa un PDF con menos páginas.');
    throw new Error('Error de Claude: ' + msg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || '';
  try {
    return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch {
    throw new Error('Claude no devolvió datos válidos. El PDF puede estar escaneado sin texto legible.');
  }
}

// Detecta el tipo real del documento por nombre de archivo
function detectTipo(file, tipo) {
  if (tipo !== 'empresa') return tipo;
  const n = file.name.toLowerCase();
  if (n.includes('constancia') || n.includes('csf') || n.includes('fiscal') || n.includes('sat'))
    return 'constancia';
  return 'empresa';
}

export async function analyzeDocument(file, tipo, apiKey) {
  if (!apiKey) throw new Error('Agrega tu API Key de Anthropic en Configuración → 🤖 Inteligencia Artificial.');

  const base64 = await fileToBase64(file);
  const dataB64 = base64.split(',')[1];

  let mediaType = 'application/pdf';
  if (file.type.startsWith('image/')) mediaType = file.type;
  else if (file.name.toLowerCase().endsWith('.png')) mediaType = 'image/png';
  else if (file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) mediaType = 'image/jpeg';

  const tipoFinal = detectTipo(file, tipo);
  const prompt = PROMPTS[tipoFinal] || PROMPTS.empresa;

  const contentBlock = (mediaType === 'application/pdf')
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataB64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: dataB64 } };

  return await callClaudeAPI(contentBlock, prompt, apiKey);
}

// Múltiples documentos (acta + reformas): analiza cada uno, combina lo más reciente
export async function analyzeMultipleDocuments(files, tipo, apiKey) {
  const results = [];
  for (const file of files) {
    results.push(await analyzeDocument(file, tipo, apiKey));
    if (files.length > 1) await new Promise(r => setTimeout(r, 2000));
  }
  if (results.length === 1) return results[0];

  const merged = { ...results[0] };
  for (let i = 1; i < results.length; i++) {
    Object.keys(results[i]).forEach(k => { if (results[i][k]) merged[k] = results[i][k]; });
  }
  return merged;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
}
