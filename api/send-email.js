const RESEND_API = 'https://api.resend.com/emails';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'RESEND_API_KEY no encontrada en el servidor' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { from, to, subject, html } = body || {};

  const dest = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (!dest.length)          return res.status(400).json({ ok: false, error: 'Falta destinatario' });
  if (!subject || !html)     return res.status(400).json({ ok: false, error: 'Falta asunto o contenido' });

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || 'MSMS CORP <santiago@brokingroup.com>',
      to: dest,
      subject,
      html,
    }),
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 500).json({ ok: response.ok, status: response.status, resend: data });
};
