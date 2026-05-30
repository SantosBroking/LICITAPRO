// Auth.js — Login / registro con Supabase Auth
import { h, useState } from '../lib/core.js';
import { signIn, signUp } from '../lib/supabase.js';

export default function AuthScreen() {
  const [mode, setMode]       = useState('login');
  const [email, setEmail]     = useState('');
  const [pwd, setPwd]         = useState('');
  const [name, setName]       = useState('');
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (!email || !pwd) { setErr('Email y contraseña son obligatorios'); return; }
    setLoading(true); setErr('');
    try {
      if (mode === 'login') {
        await signIn(email, pwd);
      } else {
        if (!name) { setErr('El nombre es obligatorio'); setLoading(false); return; }
        if (pwd.length < 6) { setErr('Contraseña mínimo 6 caracteres'); setLoading(false); return; }
        await signUp(email, pwd, name);
        setErr('✅ Cuenta creada. Revisa tu email para confirmar.');
        setLoading(false); return;
      }
    } catch (e) { setErr(e.message || 'Error de autenticación'); }
    setLoading(false);
  };

  const onKey = e => { if (e.key === 'Enter') go(); };

  const errStyle = {
    background: err.startsWith('✅') ? '#E1F5EE' : '#FCEBEB',
    color:      err.startsWith('✅') ? '#085041' : '#791F1F',
    fontSize: 12, padding: '10px 14px', borderRadius: 6,
    marginBottom: 14, lineHeight: 1.5,
  };

  return h('div', { style: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20, background:'var(--bg3)' } },
    h('div', { style: { width:400, background:'var(--bg1)', borderRadius:12, padding:'2.5rem', border:'.5px solid var(--b3)' } },
      h('div', { style: { textAlign:'center', marginBottom:24 } },
        h('div', { style: { fontSize:11, letterSpacing:2, color:'var(--t2)', textTransform:'uppercase', marginBottom:4 } }, 'MSMS CORP'),
        h('div', { style: { fontSize:22, fontWeight:500, marginBottom:4 } }, 'LicitaPro'),
        h('div', { style: { fontSize:13, color:'var(--t2)' } }, mode === 'login' ? 'Inicia sesión para continuar' : 'Crea tu cuenta'),
      ),
      err && h('div', { style: errStyle }, err),
      mode === 'register' && h('div', { style: { marginBottom:14 } },
        h('label', { style: { display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Nombre completo'),
        h('input', { value:name, onChange:e=>setName(e.target.value), placeholder:'Tu nombre' }),
      ),
      h('div', { style: { marginBottom:14 } },
        h('label', { style: { display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Email'),
        h('input', { type:'email', value:email, onChange:e=>setEmail(e.target.value), placeholder:'tu@email.com', onKeyDown:onKey }),
      ),
      h('div', { style: { marginBottom:20 } },
        h('label', { style: { display:'block', fontSize:12, color:'var(--t2)', marginBottom:4 } }, 'Contraseña'),
        h('input', { type:'password', value:pwd, onChange:e=>setPwd(e.target.value), onKeyDown:onKey }),
      ),
      h('button', { className:'bp', onClick:go, disabled:loading, style:{ width:'100%', padding:'10px', fontSize:14 } },
        loading ? 'Cargando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'
      ),
      h('div', { style: { textAlign:'center', marginTop:16, fontSize:12, color:'var(--t2)' } },
        mode === 'login'
          ? h('span', null, '¿Sin cuenta? ', h('span', { style:{ color:'var(--blue)', cursor:'pointer' }, onClick:()=>{ setMode('register'); setErr(''); } }, 'Crear una'))
          : h('span', null, '¿Ya tienes cuenta? ', h('span', { style:{ color:'var(--blue)', cursor:'pointer' }, onClick:()=>{ setMode('login'); setErr(''); } }, 'Iniciar sesión'))
      ),
    )
  );
}
