// App.js — Estado global, navegación y CRUD (localStorage, sin Supabase)
import { h, useState, useEffect, useRef, useCallback } from './lib/core.js';
import { DEFAULT_CONFIG } from './lib/constants.js';
import { sb, signOut, dbLoad, saveProject, deleteProject, saveVehicle, deleteVehicle, saveCompany, saveConfig, saveAuditLog } from './lib/supabase.js';
import { uid, NOW } from './lib/utils.js';

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
  const [user,      setUser]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [projects,  setProjects]  = useState([]);
  const [vehicles,  setVehicles]  = useState([]);
  const [companies, setCompanies] = useState([]);
  const [config,    setConfig]    = useState(DEFAULT_CONFIG);
  const [audit,     setAudit]     = useState([]);
  const [view,      setView]      = useState('dashboard');
  const [projId,    setProjId]    = useState(null);
  const [projTab,   setProjTab]   = useState('info');
  const _lastProjId = useRef(null);
  const _pending    = useRef(null);
  const _timer      = useRef(null);

  useEffect(() => {
    const _t = setTimeout(() => setLoading(false), 2500);
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session?.user) { setUser(session.user); }
        setLoading(false); return;
      }
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        try {
          const d = await dbLoad(session.user.id);
          setProjects(d.projects);
          setVehicles(d.vehicles);
          setCompanies(d.companies);
          setAudit(d.audit);
          if (d.config) { setConfig(d.config); window._lpConfig = d.config; }
        } catch(e) { console.error('Error cargando datos:', e); }
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
      }
    });
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
      if (toSave) { try { await saveProject(toSave, user?.id); } catch(e){ console.error(e); } }
    }, 800);
  }, [user]);

  const handleDeleteProject = useCallback(async (id) => {
    const p = projects.find(x=>x.id===id);
    setProjects(prev=>prev.filter(x=>x.id!==id));
    setVehicles(prev=>prev.filter(v=>v.projectId!==id));
    try { await deleteProject(id); log(user,'eliminó','proyecto',id,p?.name||''); } catch(e){ console.error(e); }
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

  if (!user) return h(AuthScreen);

  const currentProject = projects.find(p=>p.id===projId);
  const projDetailView = currentProject
    ? h(ProjectDetail, { project:currentProject, vehicles, companies, config, onUpdate:upProject, onSave:handleSaveProject, onDelete:handleDeleteProject, onNav:nav, user, logFn:log, activeTab:projTab, setActiveTab:setProjTab })
    : h('div', { className:'empty' }, h('h3', null, 'Proyecto no encontrado'), h('button', { onClick:()=>nav('projects') }, '← Volver'));

  const content = ({
    dashboard:      h(Dashboard,     { projects, vehicles, companies, onNav:nav }),
    projects:       h(ProjectsList,  { projects, vehicles, onNav:nav }),
    project_new:    h(ProjectForm,   { companies, config, onSave:handleSaveProject, onCancel:()=>nav('projects') }),
    project_detail: projDetailView,
    companies:      h(Companies,     { companies, setCompanies, projects, onSave:async c=>{ const ex=companies.find(x=>x.id===c.id); setCompanies(ex?companies.map(x=>x.id===c.id?c:x):[...companies,c]); try{await saveCompany(c,user?.id);}catch(e){console.error(e);} }, user, logFn:log }),
    catalog:        h(CatalogView),
    reports:        h(Reports,       { projects, vehicles, companies, audit }),
    settings:       h(Settings,      { config, user, onSave:handleSaveConfig }),
    audit:          h(AuditLogView,  { audit }),
  })[view] || h(Dashboard, { projects, vehicles, companies, onNav:nav });

  return h('div', { style:{ display:'flex', minHeight:'100vh', background:'var(--bg3)' } },
    h('aside', { style:{ width:200, background:'var(--bg1)', borderRight:'.5px solid var(--b3)', display:'flex', flexDirection:'column', position:'fixed', top:0, bottom:0, left:0, zIndex:100 } },
      h('div', { style:{ padding:'20px 16px 14px' } },
        h('div', { style:{ fontSize:10, letterSpacing:2, color:'var(--t2)', textTransform:'uppercase', marginBottom:2 } }, 'MSMS CORP'),
        h('div', { style:{ fontSize:16, fontWeight:500 } }, 'LicitaPro'),
      ),
      h('nav', { style:{ flex:1, padding:'0 8px', overflowY:'auto' } },
        NAV_ITEMS.map(item => {
          const active = view===item.id || (item.id==='projects' && view.startsWith('project'));
          return h('button', { key:item.id, onClick:()=>nav(item.id), style:{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 12px', background:active?'var(--bg2)':'transparent', color:active?'var(--t1)':'var(--t2)', fontWeight:active?500:400, borderRadius:'var(--r)', marginBottom:2, fontSize:13, border:'none', cursor:'pointer', textAlign:'left' } },
            h('span', { style:{ opacity:.7 } }, item.icon), item.label,
          );
        })
      ),
      h('div', { style:{ padding:'12px 16px', borderTop:'.5px solid var(--b3)' } },
        h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' } }, user.email),
        h('button', { onClick:signOut, style:{ fontSize:12, padding:'6px 12px', width:'100%', color:'var(--t2)' } }, 'Cerrar sesión'),
      ),
    ),
    h('main', { style:{ flex:1, marginLeft:200, padding:28, maxWidth:'calc(100vw - 200px)', overflow:'hidden' } }, content),
  );
}
