// App.js — Estado global, navegación y CRUD
import { h, useState, useEffect, useRef, useCallback } from './lib/core.js';
import { DEFAULT_CONFIG } from './lib/constants.js';
import { sb, authSb, signOut, WORKSPACE_ID, dbLoad, saveProject, deleteProject, saveVehicle, deleteVehicle, saveCompany, saveConfig, saveAuditLog } from './lib/supabase.js';
import { uid, NOW } from './lib/utils.js';
import { sendMonthlyReminders, shouldSendMonthlyReminder, currentMonthKey } from './lib/email_reminders.js';

import AuthScreen  from './views/Auth.js';
import Dashboard   from './views/Dashboard.js';
import CatalogView from './views/Catalog.js';
import Companies   from './views/Companies.js';
import { ProjectsList, ProjectForm, ProjectDetail } from './views/Projects.js';
import { Reports, Settings, AuditLogView } from './views/Admin.js';

const NAV_ITEMS = [
  { id:'dashboard', label:'Dashboard', icon:'◈' },
  { id:'projects',  label:'Proyectos', icon:'◉' },
  { id:'companies', label:'Empresas',  icon:'◎' },
  { id:'catalog',   label:'Catálogo',  icon:'◳' },
  { id:'reports',   label:'Reportes',  icon:'◑' },
  { id:'settings',  label:'Config.',   icon:'⚙' },
  { id:'audit',     label:'Bitácora',  icon:'◷' },
];

export default function App() {
  const [user,      setUser]      = useState({ id: "31daca2f-17ff-4ce1-83ca-99e2b31094b7", email: "santiago@brokingroup.com" });
  const [loading,   setLoading]   = useState(true);
  const [projects,  setProjects]  = useState([]);
  const [vehicles,  setVehicles]  = useState([]);
  const [companies, setCompanies] = useState([]);
  const [config,    setConfig]    = useState(DEFAULT_CONFIG);
  const [audit,     setAudit]     = useState([]);
  const [view,      setView]      = useState('dashboard');
  const [projId,    setProjId]    = useState(null);
  const [projTab,   setProjTab]   = useState('info');
  const _lastProjId    = useRef(null);
  const _pending       = useRef(null);
  const _timer         = useRef(null);
  const _intentionalSignOut = useRef(false);
  const _userId     = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const MOBILE_NAV = NAV_ITEMS.slice(0, 5);
  // Siempre usar el workspaceId para acceder a los datos compartidos del equipo
  const getUID = () => user?.workspaceId || user?.id || JSON.parse(localStorage.getItem("lp_user")||"null")?.workspaceId || "31daca2f-17ff-4ce1-83ca-99e2b31094b7";
  const isAdmin = user?.role === 'admin' || !user?.role; // sin rol = admin (compat)
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

  useEffect(() => {
    const loadData = async (u) => {
      try {
        const d = await dbLoad(u.workspaceId || u.id);
        setProjects(d.projects || []);
        setVehicles(d.vehicles || []);
        setCompanies(d.companies || []);
        setAudit(d.audit || []);
        if (d.config) { setConfig(d.config); window._lpConfig = d.config;
          // Auto-envío mensual si es día 1 y no se envió este mes
          const cfg = d.config;
          if (cfg?.notif?.resendKey && shouldSendMonthlyReminder(cfg?.notif?.lastReminderSent)) {
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
    };

    const { data: { subscription } } = authSb.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          setUser(session.user);
          _userId.current = session.user.id;
          await loadData(session.user);
        }
        setLoading(false);
      } else if (event === 'SIGNED_IN') {
        setUser(session.user);
        _userId.current = session.user.id;
        setLoading(true);
        await loadData(session.user);
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        if (_intentionalSignOut.current) {
          _intentionalSignOut.current = false;
          setUser(null);
          setProjects([]); setVehicles([]); setCompanies([]); setAudit([]);
          setLoading(false);
        }
        // Si no fue intencional, ignorar (refresco de token, cambio de pestaña)
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  const log = useCallback((u, action, entity, entityId, details='') => {
    const entry = { id:uid('log'), timestamp:NOW(), userId:u?.id||'local', userName:u?.email||'Usuario', action, entity, entityId, details };
    setAudit(prev => [entry,...prev].slice(0,500));
    saveAuditLog(entry, u?.id).catch(()=>{});
  }, []);

  const nav = useCallback((dest, id) => {
    if (dest === 'project_detail') {
      if (id !== _lastProjId.current) { setProjTab('info'); _lastProjId.current = id; }
      setProjId(id); setView('project_detail');
    } else if (dest === 'project_new') {
      _lastProjId.current = null; setView('project_new');
    } else if (dest === 'save_vehicle') {
      handleSaveVehicle(id);
    } else if (dest === 'delete_vehicle') {
      handleDeleteVehicle(id);
    } else if (dest === 'update_vehicle') {
      handleSaveVehicle(id);
    } else {
      setView(dest);
      if (dest !== 'project_detail') setProjId(null);
    }
  }, []);

  const handleSaveProject = useCallback(async (p, navigate) => {
    setProjects(prev => { const ex=prev.find(x=>x.id===p.id); return ex?prev.map(x=>x.id===p.id?p:x):[p,...prev]; });
    if (navigate) nav('project_detail', p.id);
    try { await saveProject(p, user?.id); log(user,'guardó','proyecto',p.id,p.name); } catch(e){ console.error(e); }
  }, [user, nav, log]);

  const upProject = useCallback((updated) => {
    setProjects(prev => prev.map(p => p.id===updated.id ? updated : p));
    _pending.current = updated;
    if (_timer.current) clearTimeout(_timer.current);
    _timer.current = setTimeout(async () => {
      const toSave = _pending.current;
      const uid = _userId.current || user?.id || JSON.parse(localStorage.getItem("lp_user")||"null")?.id || "31daca2f-17ff-4ce1-83ca-99e2b31094b7";
      if (toSave && uid) { try { await saveProject(toSave, uid); } catch(e){ console.error(e); } }
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
    try { await saveVehicle(v, user?.id); } catch(e){ console.error(e); }
  }, [user]);

  const handleDeleteVehicle = useCallback(async (id) => {
    setVehicles(prev=>prev.filter(v=>v.id!==id));
    try { await deleteVehicle(id); } catch(e){ console.error(e); }
  }, [user]);

  const handleSaveConfig = useCallback(async (cfg) => {
    setConfig(cfg); window._lpConfig = cfg;
    try { await saveConfig(cfg, user?.id); } catch(e){ console.error(e); throw e; }
  }, [user]);

  if (loading)
    return h('div', { style:{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', fontSize:13 } }, 'Cargando LicitaPro…');

  const handleLogin = async (u) => {
    setUser(u);
    setLoading(true);
    try {
      const d = await dbLoad(u.workspaceId || u.id);
      setProjects(d.projects || []);
      setVehicles(d.vehicles || []);
      setCompanies(d.companies || []);
      setAudit(d.audit || []);
      if (d.config) { setConfig(d.config); window._lpConfig = d.config; }
    } catch(e) { console.error(e); }
    setLoading(false);
  };
  if (!user) return h(AuthScreen, { onLogin: handleLogin });

  const currentProject = projects.find(p=>p.id===projId);
  const projDetailView = currentProject
    ? h(ProjectDetail, { project:currentProject, vehicles, companies, config, onUpdate:upProject, onSave:handleSaveProject, onDelete:handleDeleteProject, onNav:nav, user, logFn:log, activeTab:projTab, setActiveTab:setProjTab })
    : h('div', { className:'empty' }, h('h3', null, 'Proyecto no encontrado'), h('button', { onClick:()=>nav('projects') }, '← Volver'));

  const content = ({
    dashboard:      h(Dashboard,     { projects, vehicles, companies, onNav:nav }),
    projects:       h(ProjectsList,  { projects, vehicles, onNav:nav }),
    project_new:    h(ProjectForm,   { companies, config, onSave:handleSaveProject, onCancel:()=>nav('projects') }),
    project_detail: projDetailView,
    companies:      h(Companies,     { companies, setCompanies, projects, config, appConfig:config, onSave:async c=>{ const ex=companies.find(x=>x.id===c.id); setCompanies(ex?companies.map(x=>x.id===c.id?c:x):[...companies,c]); try{ await saveCompany(c, getUID()); log(user, ex?'actualizó':'creó', 'empresa', c.id, c.name); }catch(e){ console.error('Error guardando empresa:', e); } }, user, logFn:log }),
    catalog:        h(CatalogView, { config, onSaveConfig:handleSaveConfig }),
    reports:        h(Reports,       { projects, vehicles, companies, audit }),
    settings:       h(Settings,      { config, user, onSave:handleSaveConfig }),
    audit:          h(AuditLogView,  { audit }),
  })[view] || h(Dashboard, { projects, vehicles, companies, onNav:nav });

  return h('div', { style:{ display:'flex', minHeight:'100vh', background:'var(--bg3)' } },

    // Sidebar desktop
    h('aside', { className:'sidebar' },
      h('div', { className:'sidebar-logo' },
        h('div', { className:'sidebar-brand' }, 'MSMS CORP'),
        h('div', { className:'sidebar-name' }, 'LicitaPro'),
      ),
      h('nav', { style:{ flex:1, padding:'10px 8px', overflowY:'auto' } },
        NAV_ITEMS.map(item => {
          const active = view===item.id || (item.id==='projects' && view.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>nav(item.id), className:'nav-item' + (active?' active':'') },
            h('span', { className:'nav-icon' }, item.icon),
            item.label,
          );
        })
      ),
      h('div', { className:'sidebar-footer' },
        h('div', { className:'sidebar-email' }, user.email),
        h('button', { onClick:()=>{ _intentionalSignOut.current=true; signOut(); }, style:{ fontSize:12, padding:'6px 12px', width:'100%', color:'var(--t2)', textAlign:'left' } }, 'Cerrar sesión'),
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
        ),
        NAV_ITEMS.map(item => {
          const active = view===item.id || (item.id==='projects' && view.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>{ nav(item.id); setMobileMenuOpen(false); }, className:'nav-item' + (active?' active':''), style:{ marginBottom:2 } },
            h('span', { className:'nav-icon' }, item.icon),
            item.label,
          );
        }),
        h('div', { style:{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--b1)' } },
          h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:8 } }, user.email),
          h('button', { onClick:()=>{ _intentionalSignOut.current=true; signOut(); }, style:{ fontSize:12, padding:'6px 12px', width:'100%', color:'var(--t2)', textAlign:'left' } }, 'Cerrar sesión'),
        ),
      ),
    ),

    // Nav inferior móvil
    h('div', { className:'mobile-nav' },
      h('div', { className:'mobile-nav-inner' },
        MOBILE_NAV.map(item => {
          const active = view===item.id || (item.id==='projects' && view.startsWith('project'));
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
