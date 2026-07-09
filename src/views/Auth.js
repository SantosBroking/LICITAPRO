// Auth.js — Login con Supabase Auth real (Fase 0B). Sin registro libre.
import { h, useState } from '../lib/core.js';
import { signIn } from '../lib/supabase.js';

export default function AuthScreen({ error: externalError }) {
  const [email, setEmail]     = useState('');
  const [pwd, setPwd]         = useState('');
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (!email || !pwd) { setErr('Email y contraseña son obligatorios'); return; }
    setLoading(true); setErr('');
    try {
      // Dispara el inicio de sesión real. App.js escucha el cambio de sesión
      // (onAuthStateChange) y se encarga de cargar el perfil y los datos —
      // no hace falta hacer nada más aquí tras un login exitoso.
      await signIn(email, pwd);
    } catch (e) {
      setErr(e.message || 'Error de autenticación');
      setLoading(false);
    }
  };

  const onKey = e => { if (e.key === 'Enter') go(); };

  const shownError = err || externalError || '';
  const errStyle = {
    background: '#FCEBEB',
    color: '#791F1F',
    fontSize: 12, padding: '10px 14px', borderRadius: 6,
    marginBottom: 14, lineHeight: 1.5,
  };

  return h('div', { style: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20, background:'var(--bg3)' } },
    h('div', { style: { width:400, background:'var(--bg1)', borderRadius:12, padding:'2.5rem', border:'.5px solid var(--b3)' } },
      h('div', { style: { textAlign:'center', marginBottom:24 } },
        h('div', { style: { fontSize:11, letterSpacing:2, color:'var(--t2)', textTransform:'uppercase', marginBottom:4 } }, 'MSMS CORP'),
        h('div', { style: { fontSize:22, fontWeight:500, marginBottom:4 } }, 'LicitaPro'),
        h('div', { style: { fontSize:13, color:'var(--t2)' } }, 'Inicia sesión para continuar'),
      ),
      shownError && h('div', { style: errStyle }, shownError),
      h('div', { style: { marginBottom:14 } },
        h('label', { style: { display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Email'),
        h('input', { type:'email', value:email, onChange:e=>setEmail(e.target.value), placeholder:'tu@email.com', onKeyDown:onKey }),
      ),
      h('div', { style: { marginBottom:20 } },
        h('label', { style: { display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Contraseña'),
        h('input', { type:'password', value:pwd, onChange:e=>setPwd(e.target.value), onKeyDown:onKey }),
      ),
      h('button', { className:'bp', onClick:go, disabled:loading, style:{ width:'100%', padding:'10px', fontSize:14 } },
        loading ? 'Iniciando sesión...' : 'Iniciar sesión'
      ),
    )
  );
}
