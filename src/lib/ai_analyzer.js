// ai_analyzer.js — Análisis de documentos con GPT-4o

export async function analyzeDocument(file, tipo, apiKey) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(',')[1];
        const result = await callGPT(base64, tipo, apiKey);
        resolve(result);
      } catch(err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}

const PROMPTS = {
  bases: `Eres experto en licitaciones públicas mexicanas. Analiza este documento y extrae en JSON exacto:
{
  "tipoProcedimiento": "Licitación Pública Nacional/Internacional/Invitación/Adjudicación directa",
  "numeroLicitacion": "número de licitación",
  "dependencia": "nombre de la dependencia convocante",
  "descripcion": "descripción del objeto de la licitación",
  "tipoProducto": "tipo de vehículos o productos",
  "ubicacion": "estado o municipio",
  "presupuestoEstimado": número o null,
  "partidas": [{"id":"P1","descripcion":"descripción","cantidad":número,"marca":"","modelo":""}],
  "fechaPublicacion": "YYYY-MM-DD o null",
  "fechaJuntaAclaraciones": "YYYY-MM-DD o null",
  "fechaPresentacion": "YYYY-MM-DD o null",
  "fechaFallo": "YYYY-MM-DD o null",
  "notas": "info relevante adicional"
}
Responde ÚNICAMENTE con el JSON.`,

  empresa: `Eres experto en documentos legales mexicanos. Analiza este documento (acta constitutiva, CSF, poder notarial, etc.) y extrae en JSON exacto:
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
}
Responde ÚNICAMENTE con el JSON.`
};

async function callGPT(base64, tipo, apiKey) {
  const prompt = PROMPTS[tipo] || PROMPTS.bases;
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}`, detail: 'high' } }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error ${response.status} al conectar con OpenAI`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.trim();
  
  try {
    const clean = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    throw new Error('No se pudo leer la respuesta de IA: ' + text.substring(0, 300));
  }
}
