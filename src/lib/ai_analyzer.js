// ai_analyzer.js — Análisis de documentos con Claude (Anthropic)
// Claude acepta PDFs nativamente. Soporta acta, reformas y CSF.

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const PROMPTS = {
  bases: `Eres experto en licitaciones públicas mexicanas. Lee el documento con atención.

En las bases suele venir una frase como: "Licitación Pública Nacional ... número LPN-038-26, referente a la adquisición de CAMIÓN DE VOLTEO DE 7M3 NUEVO, MV 4X2, MODELO 2026, solicitado por la DIRECCIÓN DE DESARROLLO URBANO Y MEDIO AMBIENTE".

De ahí extrae:
- "objetoLicitacion" = lo que se va a adquirir (lo que va DESPUÉS de "adquisición de" o "referente a" y ANTES de "solicitado por"). Ej: "CAMIÓN DE VOLTEO DE 7M3 NUEVO, MV 4X2, MODELO 2026". Este es el nombre principal del proyecto.
- "dependencia" = la unidad que solicita (lo que va DESPUÉS de "solicitado por la/el"). Ej: "DIRECCIÓN DE DESARROLLO URBANO Y MEDIO AMBIENTE".
- "nivelGobierno" = uno de: "Gobierno Federal", "Gobierno Estatal", "Gobierno Municipal", "Paraestatal" — según quién convoca. Si no es claro, déjalo en "".
- "tipoProcedimiento" = ej. "Licitación Pública Nacional", "Invitación a cuando menos 3 personas", "Adjudicación directa".
- "numeroLicitacion" = el número/clave exacto. Ej: "LPN-038-26".

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"objetoLicitacion":"","numeroLicitacion":"","dependencia":"","nivelGobierno":"","tipoProcedimiento":"","tipoProducto":"","ubicacion":"","presupuestoEstimado":null,"fechaPublicacion":null,"fechaJuntaAclaraciones":null,"fechaPresentacion":null,"fechaFallo":null,"fechaContrato":null,"notas":""}
Las fechas en formato YYYY-MM-DD o null.`,

  empresa: `Eres experto en documentos legales mexicanos (actas constitutivas y reformas). Si hay reformas, usa los datos MÁS RECIENTES.

IMPORTANTE: "razonSocial" es el NOMBRE de la empresa (ejemplo: SATHRI, GRUPO SURMAN). NUNCA pongas el tipo de sociedad (S.A. de C.V., S.A.P.I. de C.V.) en razonSocial — eso va en regimenCapital.

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"razonSocial":"","nombreComercial":"","rfc":"","regimenFiscal":"","regimenCapital":"","domicilioFiscal":"","codigoPostal":"","ciudad":"","estado":"","representanteLegal":"","cargoRepresentante":"","telefono":"","correo":"","notario":"","numeroEscritura":"","fechaConstitucion":null,"fechaUltimaReforma":null,"objetoSocial":""}`,

  factura: `Analiza esta factura mexicana (CFDI) de un vehículo. Extrae datos fiscales Y del vehículo.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks:
{"folio":"","fecha":null,"emisor":"","receptor":"","uuid":"","subtotal":null,"iva":null,"total":null,"vin":"","marca":"","modelo":"","ano":"","color":"","numMotor":""}
- "folio" = folio o número de factura
- "fecha" = formato YYYY-MM-DD
- "emisor" = razón social de quien emite (la agencia/proveedor)
- "receptor" = razón social de quien recibe
- "uuid" = folio fiscal UUID (36 caracteres con guiones)
- subtotal, iva, total = números sin símbolos
- "vin" = NIV o número de serie del vehículo (17 caracteres), búscalo en la descripción del concepto
- "marca", "modelo", "ano", "color", "numMotor" = datos del vehículo si aparecen en la descripción
- Si algún campo del vehículo no aparece, déjalo como cadena vacía`,

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
  if (tipo !== 'empresa') return tipo;  // factura, constancia, bases pasan directo
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
export async function analyzeFactura(file, apiKey) {
  return analyzeDocument(file, 'factura', apiKey);
}

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
