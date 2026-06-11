// email_reminders.js — Recordatorios mensuales vía Resend API
const RESEND_API = 'https://api.resend.com/emails';
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function buildEmailHTML(company, mesAnio) {
  const docs = [
    { nom:'Constancia de Situación Fiscal (CSF) actualizada', hint:'SAT — vigencia 3 meses' },
    { nom:'Opinión de Cumplimiento SAT',                      hint:'Vence cada 30 días' },
    { nom:'Opinión de Cumplimiento IMSS',                     hint:'Vence cada 30 días' },
    { nom:'Estado de cuenta bancario',                        hint:'Últimos 3 meses' },
  ];
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f5;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e8e4de;overflow:hidden">
    <div style="background:#18181b;padding:20px 24px">
      <div style="color:#fff;font-size:11px;letter-spacing:2px;opacity:.6;text-transform:uppercase;margin-bottom:4px">MSMS CORP</div>
      <div style="color:#fff;font-size:18px;font-weight:600">Actualizar información de ${company.name || 'la empresa'}</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:#18181b;margin:0 0 6px">Estimado equipo,</p>
      <p style="font-size:14px;color:#18181b;margin:0 0 20px">
        Es el inicio de <strong>${mesAnio}</strong>. Solicitamos que actualicen y compartan la siguiente información vigente de
        <strong>${company.name || 'la empresa'}</strong>:
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
        ${docs.map((d,i)=>`
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:#f7f7f5;border-radius:8px;border:1px solid #e8e4de">
          <div style="background:#18181b;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;margin-top:1px">${i+1}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:#18181b">${d.nom}</div>
            <div style="font-size:11px;color:#71717a;margin-top:2px">${d.hint}</div>
          </div>
        </div>`).join('')}
      </div>
      <p style="font-size:13px;color:#71717a;margin:0;line-height:1.6">
        Por favor envía los documentos actualizados a tu contacto en MSMS CORP a la brevedad.<br>
        Si tienes alguna duda, no dudes en comunicarte con nosotros.
      </p>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #e8e4de;background:#f7f7f5">
      <p style="font-size:11px;color:#a1a1aa;margin:0">Correo enviado automáticamente por LicitaPro · MSMS CORP · ${mesAnio}</p>
    </div>
  </div>
</body>
</html>`;
}

// Obtiene todos los destinatarios de una empresa (lista dinámica)
export function getRecipients(company) {
  const all = [...(company.correosNotificacion || [])];
  if (company.correoContador && !all.includes(company.correoContador)) all.push(company.correoContador);
  if (company.correoInfo    && !all.includes(company.correoInfo))    all.push(company.correoInfo);
  return all.filter(Boolean);
}

export async function sendReminderEmail(company, config) {
  const to = getRecipients(company);
  if (!to.length)  throw new Error(`La empresa "${company.name}" no tiene correos de notificación configurados`);

  const now     = new Date();
  const mesAnio = MESES[now.getMonth()] + ' ' + now.getFullYear();
  const subject = `Actualizar información — ${company.name || 'Empresa'} | ${mesAnio}`;

  // Se envía por el servidor (Resend bloquea llamadas directas desde el navegador)
  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      from: 'MSMS CORP <santiago@brokingroup.com>',
      to,
      subject,
      html: buildEmailHTML(company, mesAnio),
    }),
  });

  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.ok) {
    const msg = data?.resend?.message || data?.error || ('HTTP ' + res.status);
    throw new Error('Error al enviar: ' + msg);
  }
  return data.resend;
}

export async function sendMonthlyReminders(companies, config) {
  const results = { sent:[], failed:[] };
  for (const c of companies) {
    if (!getRecipients(c).length) continue;
    try {
      await sendReminderEmail(c, config);
      results.sent.push(c.name || c.id);
    } catch(e) {
      results.failed.push({ name: c.name, error: e.message });
    }
  }
  return results;
}

export function shouldSendMonthlyReminder(lastSent) {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return now.getDate() === 1 && lastSent !== key;
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
