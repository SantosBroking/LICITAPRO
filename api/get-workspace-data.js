const SUPA_URL = 'https://lzogvusabogzitwnlttb.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6b2d2dXNhYm9neml0d25sdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjY0NDEsImV4cCI6MjA5NTg0MjQ0MX0.IbX6NCBOOMdl9CAjn82GlOlIpRgolLZf_kLso35UK58';
// Mismo valor que src/lib/supabase.js:WORKSPACE_ID — duplicado a propósito,
// siguiendo la misma convención ya usada en api/admin-users.js y
// api/ai-proxy.js (cada endpoint serverless declara sus propias constantes,
// no importa src/lib/supabase.js).
const WORKSPACE_ID = '31daca2f-17ff-4ce1-83ca-99e2b31094b7';

// Fase 2E1 — endpoint de SOLO LECTURA, en paralelo a dbLoad() (que sigue
// intacto). Devuelve projects/vehicles/companies/config/auditLog del
// workspace, sanitizados según el rol real del usuario (nunca el que el
// cliente diga tener). Reutiliza sanitizeProjectForRole/sanitizeVehicleForRole
// de src/lib/data_sanitize.js vía import() dinámico -- ESM, no se reescribe
// su lógica. Mismo patrón de auth que api/admin-users.js: token real de
// Supabase Auth -> perfil en user_profiles -> solo entonces se consulta con
// SUPABASE_SERVICE_ROLE_KEY (nunca expuesta al cliente).
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Método no permitido' });

  // ── Sesión real ──
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok:false, error:'Falta sesión' });

  let authUser;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });
    authUser = await r.json();
  } catch(e) { return res.status(401).json({ ok:false, error:'No se pudo verificar la sesión' }); }

  // ── Perfil activo -- el rol SIEMPRE sale de aquí, nunca del cliente ──
  let profile;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/user_profiles?id=eq.${authUser.id}&select=email,role,active`,
      { headers:{ apikey:SUPA_ANON_KEY, Authorization:`Bearer ${token}` } });
    if (!r.ok) return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' });
    const rows = await r.json();
    profile = rows && rows[0];
  } catch(e) { return res.status(403).json({ ok:false, error:'No se pudo verificar el perfil' }); }
  if (!profile) return res.status(403).json({ ok:false, error:'No existe un perfil para este usuario' });
  if (!profile.active) return res.status(403).json({ ok:false, error:'Cuenta inactiva' });
  if (profile.role !== 'admin' && profile.role !== 'empleado') {
    return res.status(403).json({ ok:false, error:'Rol no reconocido' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ ok:false, error:'No se puede procesar la solicitud' });

  const appUser = { role: profile.role }; // shape mínimo que getPermissions() necesita (ver permissions.js)
  const isAdmin = profile.role === 'admin';

  // ── Reutilizar la sanitización YA VALIDADA de src/lib/data_sanitize.js ──
  // import() dinámico porque este archivo es CommonJS (sin "type":"module"
  // en package.json, que no se toca) y data_sanitize.js/permissions.js son
  // ESM. Probado: Node 22.x resuelve esto sin error (con una advertencia de
  // rendimiento por reparseo, no un fallo) -- ver reporte de diagnóstico.
  let sanitizeProjectForRole, sanitizeVehicleForRole, removeSensitiveKeysDeep;
  try {
    const mod = await import('../src/lib/data_sanitize.js');
    sanitizeProjectForRole = mod.sanitizeProjectForRole;
    sanitizeVehicleForRole = mod.sanitizeVehicleForRole;
    removeSensitiveKeysDeep = mod.removeSensitiveKeysDeep;
    if (typeof sanitizeProjectForRole !== 'function' || typeof sanitizeVehicleForRole !== 'function' || typeof removeSensitiveKeysDeep !== 'function') {
      throw new Error('Exports esperados no encontrados en data_sanitize.js');
    }
  } catch(e) {
    console.error('[get-workspace-data] No se pudo cargar data_sanitize.js:', e.message);
    return res.status(500).json({ ok:false, error:'No se pudo procesar la sanitización de datos' });
  }

  // ── Consultas -- mismo criterio que dbLoad() en src/lib/supabase.js ──
  const restHeaders = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  async function fetchTable(table, extraQuery = '') {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?user_id=eq.${WORKSPACE_ID}&select=data${extraQuery}`, { headers:restHeaders });
      if (!r.ok) { console.error(`[get-workspace-data] ${table} error HTTP ${r.status}`); return []; }
      return await r.json();
    } catch(e) { console.error(`[get-workspace-data] ${table} excepción:`, e.message); return []; }
  }
  function dedupById(arr) {
    const seen = new Set();
    return arr.filter(x => { if (!x || seen.has(x.id)) return false; seen.add(x.id); return true; });
  }

  let projectsRaw, vehiclesRaw, companiesRaw, configRaw, auditRaw;
  try {
    [projectsRaw, vehiclesRaw, companiesRaw, configRaw, auditRaw] = await Promise.all([
      fetchTable('projects'),
      fetchTable('vehicles'),
      fetchTable('companies'),
      fetchTable('config', '&limit=1'),
      // audit_log: solo se pide si el rol es admin -- ver decisión documentada
      // más abajo; evita traer del todo lo que no se va a poder devolver.
      isAdmin ? fetchTable('audit_log', '&order=created_at.desc&limit=200') : Promise.resolve([]),
    ]);
  } catch(e) {
    console.error('[get-workspace-data] Error consultando tablas:', e.message);
    return res.status(502).json({ ok:false, error:'No se pudo consultar el workspace' });
  }

  const projects  = dedupById(projectsRaw.map(r => r.data));
  const vehicles  = dedupById(vehiclesRaw.map(r => r.data));
  const companies = dedupById(companiesRaw.map(r => r.data));
  const config    = (configRaw && configRaw[0] && configRaw[0].data) || null;
  const auditLog  = auditRaw.map(r => r.data);

  // ── Decisión: companies y config van igual para ambos roles ──
  // companies: data_sanitize.js NO tiene (ni tuvo nunca) una función
  // sanitizeCompanyForRole -- confirmado en el diagnóstico de Fase 2E. Hoy
  // App.js ya pasa `companies` sin filtrar a ambos roles. Mismo criterio aquí.
  // config: shape real confirmado en src/lib/constants.js (DEFAULT_CONFIG) y
  // customProducts (catálogo) -- ningún campo de costo/precio interno. Mismo
  // criterio: sin cambios para ningún rol.
  //
  // Decisión: audit_log SOLO para admin, [] para empleado.
  // Motivo (hallazgo de este diagnóstico, no una regla ya existente):
  // `details` de cada entrada es texto libre (ver src/App.js `log()`); se
  // confirmaron casos como "actualizó factura facturaAgencia" + folio
  // (src/views/Vehicles.js:392) y notas de proyecto truncadas a 60
  // caracteres (src/views/Projects.js:484) que podrían llegar a mencionar
  // datos sensibles según lo que escriba quien las genera. La vista 'audit'
  // ya es admin-only en permissions.js (VISTAS_EMPLEADO no la incluye) --
  // este endpoint solo cierra la misma puerta también en la respuesta de
  // red, en vez de dejarla abierta y ocultarla nada más en la UI.

  const data = isAdmin
    ? { projects, vehicles, companies, config, auditLog }
    : {
        // HALLAZGO (Fase 2E1, no corregido en data_sanitize.js a propósito --
        // no estaba autorizado modificar ese archivo): sanitizeProjectForRole
        // solo limpia project.cotizacion y project.docs. NO toca
        // project.ordenesCompra, que también trae costoMSMS embebido (mismo
        // vector ya documentado del correo de aprobación de OC). Confirmado
        // con prueba simulada: sin esta segunda capa, "costoMSMS" aparecía
        // 1 vez en la respuesta de empleado por esta vía. Se cierra aquí
        // aplicando removeSensitiveKeysDeep (ya existía, exportada, sin uso
        // activo hasta ahora) como defensa adicional -- no reemplaza a
        // sanitizeProjectForRole, se aplica DESPUÉS, como está documentado
        // en su propio comentario en data_sanitize.js.
        projects: projects.map(p => removeSensitiveKeysDeep(sanitizeProjectForRole(p, appUser))),
        vehicles: vehicles.map(v => removeSensitiveKeysDeep(sanitizeVehicleForRole(v, appUser))),
        companies,
        config,
        auditLog: [],
      };

  return res.status(200).json({
    ok: true,
    user: { id: authUser.id, email: profile.email, role: profile.role },
    data,
  });
};
