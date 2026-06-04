// email_reminders.js — Recordatorios mensuales vía Resend API
const RESEND_API = 'https://api.resend.com/emails';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function buildEmailHTML(company, mesAnio) {
  const docs = [
    { nom:'Constancia de Situación Fiscal (CSF)', hint:'SAT — vigencia 3 meses' },
    { nom:'Opinión de Cumplimiento SAT',          hint:'Vence cada 30 días' },
    { nom:'Opinión de Cumplimiento IMSS',         hint:'Vence cada 30 días' },
    { nom:'Estado de cuenta bancario',            hint:'Últimos 3 meses' },
  ];
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f5;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e8e4de;overflow:hidden">
    <div style="background:#18181b;padding:20px 24px">
      <div style="color:#fff;font-size:11px;letter-spacing:2px;opacity:.6;text-transform:uppercase;margin-bottom:4px">MSMS CORP</div>
      <div style="color:#fff;font-size:18px;font-weight:600">Recordatorio de documentos</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:#18181b;margin:0 0 6px">Hola,</p>
      <p style="font-size:14px;color:#18181b;margin:0 0 20px">Es el inicio de <strong>${mesAnio}</strong>. Por favor actualiza y comparte los siguientes documentos de <strong>${company.name || 'la empresa'}</strong>:</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${docs.map(d=>`
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:#f7f7f5;border-radius:8px;border:1px solid #e8e4de">
          <span style="font-size:16px;flex-shrink:0">📄</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#18181b">${d.nom}</div>
            <div style="font-size:11px;color:#71717a;margin-top:2px">${d.hint}</div>
          </div>
        </div>`).join('')}
      </div>
      <p style="font-size:12px;color:#71717a;margin:20px 0 0;line-height:1.6">Por favor envía los documentos actualizados a tu contacto en MSMS CORP a la brevedad. Si tienes alguna duda, no dudes en comunicarte.</p>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #e8e4de;background:#f7f7f5">
      <p style="font-size:11px;color:#a1a1aa;margin:0">Este correo fue enviado automáticamente por LicitaPro · MSMS CORP</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendReminderEmail(company, config) {
  const apiKey  = config?.notif?.resendKey;
  const from    = config?.notif?.fromEmail || 'LicitaPro <notificaciones@msms.com>';
  const to      = company.correoContador;

  if (!apiKey)  throw new Error('Configura tu API Key de Resend en Configuración → 📧 Notificaciones');
  if (!to)      throw new Error(`La empresa "${company.name}" no tiene correo de contador configurado`);

  const now    = new Date();
  const mesAnio = MESES[now.getMonth()] + ' ' + now.getFullYear();
  const subject = `📄 Actualiza documentos de ${company.name || 'tu empresa'} — ${mesAnio}`;

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: buildEmailHTML(company, mesAnio),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error('Error de Resend: ' + (err.message || res.status));
  }
  return await res.json();
}

export async function sendMonthlyReminders(companies, config) {
  const results = { sent:[], failed:[] };
  for (const c of companies) {
    if (!c.correoContador) continue;
    try {
      await sendReminderEmail(c, config);
      results.sent.push(c.name || c.id);
    } catch(e) {
      results.failed.push({ name: c.name, error: e.message });
    }
  }
  return results;
}

// Verifica si corresponde enviar el recordatorio mensual (día 1 del mes)
export function shouldSendMonthlyReminder(lastSent) {
  const now   = new Date();
  const key   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return now.getDate() === 1 && lastSent !== key;
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
