// ─────────────────────────────────────────────────────────────
// utils.js  —  Helpers de fecha, formato, IDs y archivos
// ─────────────────────────────────────────────────────────────

/** Fecha de hoy YYYY-MM-DD */
export const TODAY = () => new Date().toISOString().split('T')[0];

/** Timestamp ISO completo */
export const NOW = () => new Date().toISOString();

/** Genera un ID único con prefijo */
export const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Formato moneda MXN (sin decimales) */
export const fmt = (n, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n || 0);

/** Número con separador de miles */
export const fmtNum = (n) =>
  new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n || 0);

/** Porcentaje entero */
export const pct = (n) => `${Math.round(n || 0)}%`;

/** Porcentaje con un decimal */
export const pctS = (n) => `${((n || 0) * 100).toFixed(1)}%`;

/** Días hasta una fecha (negativo = ya pasó) */
export const daysUntil = (d) => {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
};

/** Días desde una fecha (para antigüedad de costos) */
export const daysOld = (d) => {
  if (!d) return null;
  return Math.round((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
};

/** Nivel de alerta por fecha: 'r' crítico, 'y' próximo, null sin alerta */
export const alertLevel = (date) => {
  if (!date) return null;
  const d = daysUntil(date);
  if (d === null) return null;
  if (d < 0 || d <= 3) return 'r';
  if (d <= 7) return 'y';
  return null;
};

/** Agrega entrada a bitácora */
export const logAction = (setAudit, user, action, entity, entityId, details) => {
  setAudit((prev) =>
    [
      {
        id: uid('log'),
        timestamp: NOW(),
        userId: user?.id || 'system',
        userName: user?.name || 'Sistema',
        action,
        entity,
        entityId,
        details: details || '',
      },
      ...prev,
    ].slice(0, 500)
  );
};

// ── Utilidades de archivo ─────────────────────────────────────

export const fileToBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

export const dlFile = (data, name) => {
  const a = document.createElement('a');
  a.href = data;
  a.download = name;
  a.click();
};

export const storageMB = () => {
  try {
    let t = 0;
    for (const k in localStorage)
      if (Object.prototype.hasOwnProperty.call(localStorage, k))
        t += localStorage[k].length * 2;
    return (t / 1024 / 1024).toFixed(1);
  } catch {
    return '?';
  }
};

export const fmtBytes = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
};

// Convierte un número a letras en español (para importes de cotización)
export function numeroALetras(num) {
  const n = Math.floor(Math.abs(num || 0));
  const centavos = Math.round((Math.abs(num || 0) - n) * 100);
  const UNI = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE'];
  const DEC = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  const CEN = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  function seccion(x) {
    let t = '';
    const c = Math.floor(x/100), d = Math.floor((x%100)/10), u = x%10;
    if (x === 100) return 'CIEN';
    if (c) t += CEN[c] + ' ';
    const dd = x%100;
    if (dd <= 20) t += UNI[dd];
    else if (dd < 30) t += 'VEINTI' + UNI[u];
    else { t += DEC[d]; if (u) t += ' Y ' + UNI[u]; }
    return t.trim();
  }
  function convertir(x) {
    if (x === 0) return 'CERO';
    let t = '';
    const millones = Math.floor(x/1000000);
    const miles = Math.floor((x%1000000)/1000);
    const resto = x%1000;
    if (millones) t += (millones === 1 ? 'UN MILLÓN' : seccion(millones)+' MILLONES') + ' ';
    if (miles) t += (miles === 1 ? 'MIL' : seccion(miles)+' MIL') + ' ';
    if (resto) t += seccion(resto);
    return t.trim();
  }
  const letras = convertir(n);
  const centStr = String(centavos).padStart(2,'0');
  return `${letras} PESOS ${centStr}/100 M.N.`;
}
