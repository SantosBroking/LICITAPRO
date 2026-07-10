const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODELOS_PERMITIDOS = ['claude-sonnet-4-6'];
const TIPOS_PERMITIDOS = ['bases', 'factura', 'constancia', 'empresa', 'redaccion', 'chat', 'desconocido'];
const MAX_TOKENS_LIMITE = 4000;
const MAX_MESSAGES = 20;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4MB, por debajo del límite real de Vercel (~4.5MB)

// Fase 0E — la API key de Anthropic vive solo aquí (process.env), nunca en el
// cliente. Este endpoint verifica sesión real de Supabase + perfil activo
// antes de llamar a Anthropic, y registra un log OBLIGATORIO (no opcional)
// antes de cada llamada, usando SUPABASE_SERVICE_ROLE_KEY.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Método no permitido' });

  // ── Sesión: anon key + token del usuario ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok:false, error:'Falta sesión' });

  let authUser;
  try {
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userResp.ok) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });
    authUser = await userResp.json();
  } catch (e) {
    return res.status(401).json({ ok:false, error:'No se pudo verificar la sesión' });
  }

  let profile;
  try {
    const profResp = await fetch(
      `${SUPA_URL}/rest/v1/user_profiles?id=eq.${authUser.id}&select=email,role,active`,
      { headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const rows = await profResp.json();
    profile = rows && rows[0];
  } catch (e) {
    return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' });
  }
  if (!profile || !profile.active) {
    return res.status(403).json({ ok:false, error:'Cuenta inactiva o sin perfil' });
  }

  // ── Validar cuerpo ──
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { model, maxTokens, messages, system, tipo } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok:false, error:'Falta el contenido a analizar' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ ok:false, error:'Demasiados mensajes en la solicitud' });
  }

  // Tamaño sobre TODO lo que se le manda a Anthropic (messages + system)
  const payloadParaMedir = system ? { messages, system } : { messages };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payloadParaMedir), 'utf8');
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ ok:false, error:'El documento es demasiado grande para procesarse por este medio' });
  }

  const tipoFinal = TIPOS_PERMITIDOS.includes(tipo) ? tipo : 'desconocido';

  if (model && !MODELOS_PERMITIDOS.includes(model)) {
    return res.status(400).json({ ok:false, error:'Modelo no permitido' });
  }
  const modeloFinal = model || MODELOS_PERMITIDOS[0];

  let tokensFinal = Number(maxTokens);
  if (!Number.isFinite(tokensFinal) || tokensFinal < 1) tokensFinal = 1500;
  tokensFinal = Math.min(tokensFinal, MAX_TOKENS_LIMITE);

  // ── Ambas keys obligatorias ──
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anthropicKey) return res.status(500).json({ ok:false, error:'ANTHROPIC_API_KEY no configurada' });
  if (!serviceKey)   return res.status(500).json({ ok:false, error:'No se puede registrar el uso de IA. No se procesará la solicitud.' });

  // ── Log obligatorio ANTES de llamar a Anthropic. Si falla, no se llama. ──
  const logId = 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  try {
    const startResp = await fetch(`${SUPA_URL}/rest/v1/ai_logs`, {
      method: 'POST',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: logId,
        user_id: '31daca2f-17ff-4ce1-83ca-99e2b31094b7',
        actor_email: profile.email,
        actor_role: profile.role,
        tipo: tipoFinal,
        model: modeloFinal,
        status: 'started',
      }),
    });
    if (!startResp.ok) {
      return res.status(500).json({ ok:false, error:'No se pudo registrar el uso de IA. Intenta de nuevo.' });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error:'No se pudo registrar el uso de IA. Intenta de nuevo.' });
  }

  // ── Llamar a Anthropic ──
  const payload = { model: modeloFinal, max_tokens: tokensFinal, messages };
  if (system) payload.system = system;

  let anthropicResp, data, status = 'error', errMsg = '';
  try {
    anthropicResp = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': anthropicKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify(payload),
    });
    data = await anthropicResp.json();
    status = anthropicResp.ok ? 'success' : 'error';
    if (!anthropicResp.ok) errMsg = (data.error && data.error.message) || ('HTTP ' + anthropicResp.status);
  } catch (e) {
    errMsg = e.message; // nunca el prompt
  }

  // ── Actualizar el mismo log con el resultado final (mejor esfuerzo) ──
  try {
    await fetch(`${SUPA_URL}/rest/v1/ai_logs?id=eq.${logId}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        status,
        error: errMsg ? errMsg.slice(0, 300) : null,
      }),
    });
  } catch (e) {
    console.warn('[ai_logs] no se pudo actualizar el estado final:', e.message);
  }

  if (!anthropicResp || !anthropicResp.ok) {
    return res.status((anthropicResp && anthropicResp.status) || 500).json({ ok:false, error: errMsg || 'Error al llamar a Claude' });
  }
  return res.status(200).json({ ok:true, data });
};
