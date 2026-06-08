export const config = { runtime: 'edge' };

const RESEND_API = 'https://api.resend.com/emails';

const RECIPIENTS = [
  'mauricio@brokingroup.com',
];

function mesActual() {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const now = new Date();
  return `${meses[now.getMonth()]} ${now.getFullYear()}`;
}

export default async function handler(req) {
  // Verificar cron secret para evitar llamadas no autorizadas
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const mes = mesActual();

  const html = `
    <p>Estimado equipo de Broking and Brands,</p>
    <p>Para integrarlos como proveedor en un proceso de licitación pública, necesitamos la siguiente documentación:</p>
    <ul>
      <li>Constancia de Situación Fiscal (RFC vigente)</li>
      <li>Acta Constitutiva y poder notarial del representante legal</li>
      <li>Identificación oficial del representante legal</li>
      <li>Comprobante de domicilio fiscal (máx. 3 meses)</li>
      <li>Estados de cuenta bancarios (últimos 3 meses)</li>
      <li>Opinión de cumplimiento SAT (positiva y vigente)</li>
      <li>Alta en el IMSS y última determinación de cuotas</li>
      <li>Catálogo de productos/servicios con precios unitarios</li>
    </ul>
    <p>Favor de enviar a la brevedad, tenemos fechas límite del proceso.</p>
    <p>Quedamos al pendiente.</p>
    <p>Santiago Mansur<br>santiago@brokingroup.com</p>
  `;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Santiago Mansur <santiago@brokingroup.com>',
        to: RECIPIENTS,
        subject: `Solicitud de documentación para licitación — ${mes}`,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    return new Response(JSON.stringify({ ok: true, id: data.id, mes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
