// App.js — Estado global, navegación y CRUD
import { h, useState, useEffect, useRef, useCallback } from './lib/core.js';
import { DEFAULT_CONFIG } from './lib/constants.js';
import { sb, authSb, signOut, buildAppUser, WORKSPACE_ID, dbLoad, saveProject, deleteProject, saveVehicle, deleteVehicle, saveCompany, saveConfig, saveAuditLog, saveProjectFinancials } from './lib/supabase.js';
import { calcCotizacion } from './lib/calc.js'; // Fase 0C — solo se USA, calc.js no se modifica
import { getPermissions, canView, sanitizeView, canProjectTab, sanitizeProjectTab } from './lib/permissions.js'; // Fase 1C — permisos centralizados
import { uid, NOW } from './lib/utils.js';
import { sendMonthlyReminders, shouldSendMonthlyReminder, currentMonthKey } from './lib/email_reminders.js';

import AuthScreen  from './views/Auth.js';
import Dashboard   from './views/Dashboard.js';
import CatalogView from './views/Catalog.js';
import Companies   from './views/Companies.js';
import { ProjectsList, ProjectForm, ProjectDetail } from './views/Projects.js';
import { Reports, Settings, AuditLogView } from './views/Admin.js';
import FirmasView from './views/Firmas.js';

const NAV_ITEMS = [
  { id:'dashboard', label:'Dashboard', icon:'◈' },
  { id:'projects',  label:'Proyectos', icon:'◉' },
  { id:'firmas',    label:'Firmas',    icon:'◫' },
  { id:'companies', label:'Empresas',  icon:'◎' },
  { id:'catalog',   label:'Catálogo',  icon:'◳' },
  { id:'reports',   label:'Reportes',  icon:'◑' },
  { id:'settings',  label:'Config.',   icon:'⚙' },
  { id:'audit',     label:'Bitácora',  icon:'◷' },
];

// Fix Persistencia + Seguridad de Navegación — calcula una navegación EFECTIVA
// (segura) de forma síncrona, en el mismo render, antes de decidir qué
// componente construir. Usa los helpers puros de permissions.js, pero conoce
// `projects` (vive en App.js) — por eso no está en permissions.js.
// Se reutiliza tanto para decidir qué renderizar como para decidir qué
// guardar en localStorage (nunca se guarda ni se renderiza el valor crudo).
function sanitizeNavigation({ view, projId, projTab, projects, user, loading }) {
  if (loading) return { view, projId, projTab }; // defensivo — en la práctica inalcanzable, ver nota en el render

  let safeView = sanitizeView(view, user);

  if (safeView === 'project_detail') {
    const proyectoValido = projId && projects.some(p => p.id === projId);
    if (!proyectoValido) safeView = 'projects'; // proyecto inexistente o sin id -> lista, no dashboard
  }

  const safeProjId  = safeView === 'project_detail' ? projId : null;
  const safeProjTab = safeView === 'project_detail' ? sanitizeProjectTab(projTab, user) : projTab;

  return { view: safeView, projId: safeProjId, projTab: safeProjTab };
}

export default function App() {
  const [user,      setUser]      = useState(null); // null hasta que onAuthStateChange confirme la sesión
  const [loading,   setLoading]   = useState(true);
  const [projects,  setProjects]  = useState([]);
  const [vehicles,  setVehicles]  = useState([]);
  const [companies, setCompanies] = useState([]);
  const [config,    setConfig]    = useState(DEFAULT_CONFIG);
  const [audit,     setAudit]     = useState([]);
  const _urlParams = (() => { try { return new URLSearchParams(window.location.search); } catch(e){ return new URLSearchParams(); } })();
  const _viewInicial = _urlParams.get('view') || 'dashboard';
  const [view,      setView]      = useState(_viewInicial);
  const [projId,    setProjId]    = useState(null);
  const [projTab,   setProjTab]   = useState('info');
  // ── Fix Persistencia + Seguridad de Navegación ──
  const _lastUserKey          = useRef(null);   // último userKey visto (sync, detecta cambio de usuario de inmediato)
  const _navRestoreAttempted  = useRef(false);  // ¿ya se intentó restaurar para el usuario actual?
  // BUGFIX: `loading===false` NO garantiza que `projects` ya refleje el
  // arreglo fresco en el render en curso (carrera real detectada: puede
  // haber un render intermedio donde loading ya cambió pero projects aún
  // no). Este ref se marca de forma síncrona, en el mismo bloque de código
  // donde se llama setProjects(...) dentro de loadData — es una señal
  // fiable de "el fetch de datos ya corrió de verdad", sin depender de
  // suposiciones sobre en qué commit exacto aparece cada state.
  const _projectsEverLoaded   = useRef(false);
  const [navPersistenceReady, setNavPersistenceReady] = useState(false);
  const [navReadyUserKey,     setNavReadyUserKey]     = useState(null); // para qué usuario está "listo" el guardado
  const _lastProjId    = useRef(null);
  const _pending       = useRef(null);
  const _timer         = useRef(null);
  const [authError, setAuthError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItemsPermitidos = NAV_ITEMS.filter(item => canView(item.id, user));
  const MOBILE_NAV = navItemsPermitidos.slice(0, 5); // de la lista YA filtrada, no de NAV_ITEMS crudo
  // Compatibilidad temporal (Fase 0B): todo usuario real sigue leyendo el
  // mismo workspace compartido. Se retira cuando exista el modelo de
  // organización/empresa (Fase 1). Ver nota en supabase.js.
  const getUID = () => user?.workspaceId || WORKSPACE_ID;
  window._lpGetUID = getUID;
  const isAdmin = getPermissions(user).isAdmin;
  const userName = user?.name || user?.email?.split('@')[0] || 'Usuario';

  const reloadData = async () => {
    const uid = getUID();
    try {
      const d = await dbLoad(uid);
      console.log('reloadData result:', {projects: d.projects?.length, companies: d.companies?.length});
      setProjects(d.projects || []);
      setVehicles(d.vehicles || []);
      setCompanies(d.companies || []);
      if (d.config) { setConfig(d.config); window._lpConfig = d.config; }
    } catch(e) { console.error('reloadData error:', e); alert('Error al recargar: ' + e.message); }
  };
  window.__reloadData = reloadData;

  const loadData = useCallback(async (u) => {
    try {
      const d = await dbLoad(u.workspaceId || u.id);
        setProjects(d.projects || []);
        _projectsEverLoaded.current = true; // señal síncrona — el fetch ya corrió, sin importar cuándo se refleje el render
        setVehicles(d.vehicles || []);
        setCompanies(d.companies || []);
        setAudit(d.audit || []);
        if (d.config) { setConfig(d.config); window._lpConfig = d.config;
          // Auto-envío mensual si es día 1 y no se envió este mes
          const cfg = d.config;
          if (shouldSendMonthlyReminder(cfg?.notif?.lastReminderSent)) {
            const comps = (d.companies || []);
            const withEmail = comps.filter(c => c.correoContador);
            if (withEmail.length > 0) {
              sendMonthlyReminders(comps, cfg)
                .then(async r => {
                  if (r.sent.length > 0) {
                    const newCfg = { ...cfg, notif: { ...cfg.notif, lastReminderSent: currentMonthKey() } };
                    try { await saveConfig(newCfg, '31daca2f-17ff-4ce1-83ca-99e2b31094b7'); } catch(e){}
                    console.log('Recordatorios enviados:', r.sent);
                  }
                })
                .catch(e => console.error('Error recordatorios:', e));
            }
          }
        }
    } catch(e) { console.error('Error cargando datos:', e); }
  }, []);

  useEffect(() => {
    // Resuelve una sesión de Supabase Auth: carga el perfil (user_profiles),
    // bloquea si está inactivo o no existe, y arma el objeto "user" que usa
    // el resto de la app (name, role, workspaceId).
    const resolveSession = async (session) => {
      if (!session?.user) { setUser(null); setLoading(false); return; }
      setAuthError('');
      try {
        const appUser = await buildAppUser(session.user);
        setUser(appUser);
        setLoading(true);
        await loadData(appUser);
      } catch (e) {
        console.error('Perfil inválido o inactivo:', e.message);
        setAuthError(e.message);
        setUser(null);
        try { await signOut(); } catch(_e) {}
      } finally {
        setLoading(false);
      }
    };

    const { data: { subscription } } = authSb.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        resolveSession(session);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setProjects([]); setVehicles([]); setCompanies([]); setAudit([]);
        // Fix Persistencia + Seguridad de Navegación — limpiar toda la
        // navegación guardada y reiniciar el control de persistencia.
        Object.keys(localStorage).filter(k => k.startsWith('licitapro_nav_')).forEach(k => localStorage.removeItem(k));
        _lastUserKey.current = null;
        _navRestoreAttempted.current = false;
        _projectsEverLoaded.current = false;
        setNavPersistenceReady(false);
        setNavReadyUserKey(null);
        setLoading(false);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // Si la URL trae ?view=project_detail&project=ID, abrir ese proyecto al cargar
  const _urlProcesada = useRef(false);
  useEffect(() => {
    if (loading || _urlProcesada.current) return;
    const pid = _urlParams.get('project');
    if (pid && projects.find(p => p.id === pid)) {
      _urlProcesada.current = true;
      setProjId(pid); _lastProjId.current = pid; setView('project_detail');
    } else if (_viewInicial !== 'dashboard') {
      _urlProcesada.current = true;
    }
    // Limpiar los parámetros de la URL para que no se reprocesen al navegar
    if ((_urlParams.get('view') || _urlParams.get('project'))) {
      try { window.history.replaceState({}, '', window.location.pathname); } catch(e){}
    }
  }, [loading, projects]);

  // ═══ Fix Persistencia + Seguridad de Navegación ═══

  // ── RESTAURACIÓN — una sola vez por usuario ──
  useEffect(() => {
    const userKey = user?.id || user?.email || null; // user.id siempre existe (buildAppUser); email es respaldo defensivo, no se usa en la práctica

    if (userKey !== _lastUserKey.current) {
      _lastUserKey.current = userKey;
      _navRestoreAttempted.current = false;
      setNavPersistenceReady(false);
      setNavReadyUserKey(null);
    }

    if (_navRestoreAttempted.current) return;
    if (loading) return;
    if (!userKey) { _navRestoreAttempted.current = true; setNavPersistenceReady(true); setNavReadyUserKey(null); return; }

    const huboDeepLink = !!(_urlParams.get('view') || _urlParams.get('project'));

    if (!huboDeepLink) {
      try {
        const saved = JSON.parse(localStorage.getItem('licitapro_nav_' + userKey) || 'null');
        if (saved && saved.ts && (Date.now() - saved.ts) < 1000*60*60*24*7) { // vigencia: 7 días
          if (saved.projId) {
            // BUGFIX: no concluir todavía que el proyecto "no existe" solo
            // porque `projects` esté vacío en este render — podría ser que
            // loadData() no haya alcanzado a reflejarse aquí, aunque
            // `loading` ya diga false. Se espera a la señal síncrona real
            // (_projectsEverLoaded) antes de decidir — y, importante, NO se
            // marca _navRestoreAttempted aquí, así que este efecto se
            // reintenta solo en el siguiente render cuando `projects`
            // cambie de verdad.
            if (!_projectsEverLoaded.current) return;

            const existe = projects.some(pr => pr.id === saved.projId);
            if (existe) {
              setProjId(saved.projId);
              setProjTab(sanitizeProjectTab(saved.projTab, user));
              setView('project_detail');
            }
            // Si no existe (y projects YA está confirmado como cargado de
            // verdad), se deja el default — correcto, ya no es una carrera.
          } else {
            const targetView = sanitizeView(saved.view, user);
            if (targetView !== 'dashboard') setView(targetView);
          }
        }
      } catch(e) {}
    }
    // Si hubo deep-link, no se toca nada aquí — el efecto de deep-link de
    // arriba ya hizo su trabajo; las guardias de abajo (y el guard de
    // pre-render en el cuerpo del componente) validan el resultado contra
    // el rol, sin duplicar esa lógica aquí.

    _navRestoreAttempted.current = true;
    setNavPersistenceReady(true);
    setNavReadyUserKey(userKey);
  }, [loading, user, projects]);

  // ── GUARDIAS — corren siempre, sin importar el origen del cambio.
  // Sincronizan el estado interno; el guard de pre-render (en el cuerpo del
  // componente) es la barrera real que evita renderizar algo prohibido. ──
  useEffect(() => {
    if (loading) return;
    const safe = sanitizeView(view, user);
    if (safe !== view) setView(safe);
  }, [view, user, loading]);

  useEffect(() => {
    if (loading) return;
    const safe = sanitizeProjectTab(projTab, user);
    if (safe !== projTab) setProjTab(safe);
  }, [projTab, user, loading]);

  // ── GUARDADO — solo navegación SANEADA, nunca cruda, y solo si el
  // "listo" corresponde al usuario actual (protege contra herencia entre
  // usuarios distintos en la misma pestaña sin recargar). ──
  useEffect(() => {
    const userKey = user?.id || user?.email || null;
    if (!navPersistenceReady) return;
    if (!userKey) return;
    if (userKey !== navReadyUserKey) return;

    const { view: safeView, projId: safeProjId, projTab: safeProjTab } =
      sanitizeNavigation({ view, projId, projTab, projects, user, loading });

    try {
      localStorage.setItem('licitapro_nav_' + userKey, JSON.stringify({
        view: safeView, projId: safeProjId, projTab: safeProjTab, ts: Date.now()
      }));
    } catch(e) {}
  }, [view, projId, projTab, user, navPersistenceReady, navReadyUserKey, projects, loading]);

  const log = useCallback((u, action, entity, entityId, details='') => {
    const entry = { id:uid('log'), timestamp:NOW(), userId:u?.id||'local', userName:u?.email||'Usuario', action, entity, entityId, details };
    setAudit(prev => [entry,...prev].slice(0,500));
    saveAuditLog(entry, u?.id).catch(()=>{});
  }, []);

  const nav = useCallback((dest, id) => {
    if (dest === 'project_detail') {
      if (id !== _lastProjId.current) { setProjTab('info'); _lastProjId.current = id; }
      setProjId(id); setView('project_detail'); // 'project_detail' permitido para ambos roles; el guard de pre-render valida projId
    } else if (dest === 'project_new') {
      _lastProjId.current = null; setView('project_new');
    } else if (dest === 'save_vehicle') {
      handleSaveVehicle(id);
    } else if (dest === 'delete_vehicle') {
      handleDeleteVehicle(id);
    } else if (dest === 'update_vehicle') {
      handleSaveVehicle(id);
    } else {
      setView(canView(dest, user) ? dest : 'dashboard'); // NUEVO: valida antes de setear
      if (dest !== 'project_detail') setProjId(null);
    }
    // NOTA (hallazgo, no corregido aquí): handleSaveVehicle/handleDeleteVehicle
    // están declarados MÁS ABAJO en este archivo (líneas ~340/345) y ellos
    // mismos son useCallback(..., [user]) — cambian de identidad cuando
    // cambia el usuario. No se agregan a las dependencias de este nav()
    // porque, al estar declarados después, haría que useCallback lance
    // "Cannot access before initialization" (temporal dead zone). Esto ya
    // era así ANTES de este fix (nav() ya tenía deps:[] y ya cerraba sobre
    // las instancias originales de esas dos funciones) — no se agrava ni se
    // corrige en este cambio; queda señalado para una revisión aparte,
    // fuera del alcance de persistencia/seguridad de navegación.
  }, [user]);

  // Fase 0C — Opción B: si quien guarda es admin y el proyecto tiene cotización
  // capturada, calcula el resultado financiero (calcCotizacion, sin modificar
  // calc.js) y lo persiste en project_financials (RLS admin-only). No toca
  // Cotizacion.js. Si falla, no debe romper el guardado normal del proyecto.
  const maybeSaveFinancials = async (p) => {
    if (!isAdmin || !p?.cotizacion) return;
    try {
      const financials = calcCotizacion(p.cotizacion);
      await saveProjectFinancials(p.id, financials);
    } catch (e) { console.warn('No se pudo actualizar project_financials:', e.message); }
  };

  const handleSaveProject = useCallback(async (p, navigate) => {
    setProjects(prev => { const ex=prev.find(x=>x.id===p.id); return ex?prev.map(x=>x.id===p.id?p:x):[p,...prev]; });
    if (navigate) nav('project_detail', p.id);
    try { await saveProject(p, getUID()); await maybeSaveFinancials(p); log(user,'guardó','proyecto',p.id,p.name); } catch(e){ console.error(e); }
  }, [user, nav, log]);

  const upProject = useCallback((updated) => {
    setProjects(prev => prev.map(p => p.id===updated.id ? updated : p));
    _pending.current = updated;
    if (_timer.current) clearTimeout(_timer.current);
    _timer.current = setTimeout(async () => {
      const toSave = _pending.current;
      const uid = getUID();
      if (toSave && uid) { try { await saveProject(toSave, uid); await maybeSaveFinancials(toSave); } catch(e){ console.error(e); } }
    }, 800);
  }, [user]);

  const handleDeleteProject = useCallback(async (id) => {
    const p = projects.find(x=>x.id===id);
    // CANCELAR cualquier guardado pendiente para este proyecto antes de borrarlo
    if (_timer.current) { clearTimeout(_timer.current); _timer.current = null; }
    if (_pending.current?.id === id) { _pending.current = null; }
    setProjects(prev=>prev.filter(x=>x.id!==id));
    setVehicles(prev=>prev.filter(v=>v.projectId!==id));
    try {
      await deleteProject(id, getUID());
      log(user,'eliminó','proyecto',id,p?.name||'');
    } catch(e) {
      console.error('Error al eliminar proyecto:', e);
      try {
        const d = await dbLoad(getUID());
        setProjects(d.projects || []);
        setVehicles(d.vehicles || []);
      } catch(_) {}
      alert('Error al eliminar: ' + e.message);
    }
  }, [projects, user, log]);

  const handleSaveVehicle = useCallback(async (v) => {
    setVehicles(prev => { const ex=prev.find(x=>x.id===v.id); return ex?prev.map(x=>x.id===v.id?v:x):[...prev,v]; });
    try { await saveVehicle(v, getUID()); } catch(e){ console.error(e); }
  }, [user]);

  const handleDeleteVehicle = useCallback(async (id) => {
    setVehicles(prev=>prev.filter(v=>v.id!==id));
    try { await deleteVehicle(id); } catch(e){ console.error(e); }
  }, [user]);

  const handleSaveConfig = useCallback(async (cfg) => {
    setConfig(cfg); window._lpConfig = cfg;
    try { await saveConfig(cfg, getUID()); } catch(e){ console.error(e); throw e; }
  }, [user]);

  if (loading)
    return h('div', { style:{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', fontSize:13 } }, 'Cargando LicitaPro…');

  // El login ya no necesita un callback manual: signIn() dispara el evento
  // real de Supabase Auth, y el efecto de arriba (resolveSession) se encarga
  // de cargar el perfil y los datos en cuanto la sesión se confirma.
  if (!user) return h(AuthScreen, { error: authError });

  // ── Guard de pre-render (Fix Persistencia + Seguridad de Navegación) ──
  // Se calcula de forma síncrona, en este mismo render, ANTES de decidir qué
  // construir — por eso nunca existe un frame donde se renderice una vista
  // prohibida: el contenido nunca llega a construirse con el valor crudo.
  const { view: effectiveView, projId: effectiveProjId, projTab: effectiveProjTab } =
    sanitizeNavigation({ view, projId, projTab, projects, user, loading });

  const currentProject = projects.find(p=>p.id===effectiveProjId);
  const projDetailView = currentProject
    ? h(ProjectDetail, { project:currentProject, vehicles, companies, config, onSaveConfig:handleSaveConfig, onSaveCompany:async c=>{ const ex=companies.find(x=>x.id===c.id||x.rfc===c.rfc); setCompanies(ex?companies.map(x=>(x.id===c.id||x.rfc===c.rfc)?{...x,...c}:x):[...companies,c]); try{ await saveCompany(c, getUID()); log(user, ex?'actualizó':'creó', 'empresa', c.id, c.name); }catch(e){ console.error('Error guardando empresa:', e); } }, onUpdate:upProject, onSave:handleSaveProject, onDelete:handleDeleteProject, onNav:nav, user, logFn:log, activeTab:effectiveProjTab, setActiveTab:setProjTab })
    : h('div', { className:'empty' }, h('h3', null, 'Proyecto no encontrado'), h('button', { onClick:()=>nav('projects') }, '← Volver'));

  const content = ({
    dashboard:      h(Dashboard,     { projects, vehicles, companies, onNav:nav, onUpdate:upProject }),
    projects:       h(ProjectsList,  { projects, vehicles, onNav:nav, onUpdate:p=>handleSaveProject(p,false), user }),
    project_new:    h(ProjectForm,   { companies, config, user, onSaveConfig:handleSaveConfig, onSave:handleSaveProject, onCancel:()=>nav('projects') }),
    project_detail: projDetailView,
    companies:      h(Companies,     { companies, setCompanies, projects, config, appConfig:config, onUpdateProject:(p)=>handleSaveProject(p,false), onSave:async c=>{ const ex=companies.find(x=>x.id===c.id); setCompanies(ex?companies.map(x=>x.id===c.id?c:x):[...companies,c]); try{ await saveCompany(c, getUID()); log(user, ex?'actualizó':'creó', 'empresa', c.id, c.name); }catch(e){ console.error('Error guardando empresa:', e); } }, user, logFn:log }),
    catalog:        h(CatalogView, { config, onSaveConfig:handleSaveConfig }),
    firmas:         h(FirmasView,    { projects, companies, user, onUpdateProject:(p)=>handleSaveProject(p,false), onNav:nav }),
    reports:        h(Reports,       { projects, vehicles, companies, audit }),
    settings:       h(Settings,      { config, user, onSave:handleSaveConfig }),
    audit:          h(AuditLogView,  { audit }),
  })[effectiveView] || h(Dashboard, { projects, vehicles, companies, onNav:nav, onUpdate:upProject });


  return h('div', { style:{ display:'flex', minHeight:'100vh', background:'var(--bg3)' } },

    // Sidebar desktop
    h('aside', { className:'sidebar' },
      h('div', { className:'sidebar-logo' },
        h('div', { className:'sidebar-brand' }, 'MSMS CORP'),
        h('div', { className:'sidebar-name' }, 'LicitaPro'),
        h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:4, textTransform:'capitalize' } }, new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' })),
      ),
      h('nav', { style:{ flex:1, padding:'10px 8px', overflowY:'auto' } },
        navItemsPermitidos.map(item => {
          const active = effectiveView===item.id || (item.id==='projects' && effectiveView.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>nav(item.id), className:'nav-item' + (active?' active':'') },
            h('span', { className:'nav-icon' }, item.icon),
            item.label,
          );
        })
      ),
      h('div', { className:'sidebar-footer' },
        h('div', { className:'sidebar-email' }, user.email),
        h('button', { onClick:()=>signOut(), style:{ fontSize:12, padding:'6px 12px', width:'100%', color:'var(--t2)', textAlign:'left' } }, 'Cerrar sesión'),
      ),
    ),

    // Header móvil
    h('div', { className:'mobile-header' },
      h('button', { onClick:()=>setMobileMenuOpen(true), style:{ border:'none', background:'transparent', fontSize:22, cursor:'pointer', padding:'4px 6px' } }, '☰'),
      h('div', { className:'mobile-header-title' }, 'LicitaPro'),
      h('button', { className:'bp', onClick:()=>nav('project_new'), style:{ fontSize:12, padding:'6px 12px' } }, '+ Nuevo'),
    ),

    // Drawer móvil
    mobileMenuOpen && h('div', { className:'mobile-drawer open' },
      h('div', { className:'mobile-drawer-overlay', onClick:()=>setMobileMenuOpen(false) }),
      h('div', { className:'mobile-drawer-panel' },
        h('div', { style:{ marginBottom:20 } },
          h('div', { className:'sidebar-brand' }, 'MSMS CORP'),
          h('div', { className:'sidebar-name' }, 'LicitaPro'),
          h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:4, textTransform:'capitalize' } }, new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' })),
        ),
        navItemsPermitidos.map(item => {
          const active = effectiveView===item.id || (item.id==='projects' && effectiveView.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>{ nav(item.id); setMobileMenuOpen(false); }, className:'nav-item' + (active?' active':''), style:{ marginBottom:2 } },
            h('span', { className:'nav-icon' }, item.icon),
            item.label,
          );
        }),
        h('div', { style:{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--b1)' } },
          h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:8 } }, user.email),
          h('button', { onClick:()=>signOut(), style:{ fontSize:12, padding:'6px 12px', width:'100%', color:'var(--t2)', textAlign:'left' } }, 'Cerrar sesión'),
        ),
      ),
    ),

    // Nav inferior móvil
    h('div', { className:'mobile-nav' },
      h('div', { className:'mobile-nav-inner' },
        MOBILE_NAV.map(item => {
          const active = effectiveView===item.id || (item.id==='projects' && effectiveView.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>nav(item.id), className:'mobile-nav-btn' + (active?' active':'') },
            h('span', { className:'nav-dot' }, item.icon),
            item.label,
          );
        })
      ),
    ),

    // Contenido principal
    h('main', { className:'main-content' }, content),
  );
}
