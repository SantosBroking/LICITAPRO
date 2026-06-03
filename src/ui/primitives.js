// primitives.js — Componentes UI reutilizables (sin htm, sin eval)
import { h, useState, useEffect } from '../lib/core.js';
import { STATUSES } from '../lib/constants.js';

const s = style => style; // identidad para claridad

export function Badge({ statusId }) {
  const st = STATUSES.find(x => x.id === statusId);
  if (!st) return h('span', { style:{ fontSize:11, color:'var(--t3)' } }, '—');
  return h('span', { style:{ background:st.bg, color:st.tx, fontSize:11, padding:'3px 12px', borderRadius:14, fontWeight:500, whiteSpace:'nowrap', display:'inline-block' } }, st.label);
}

export function AlertChip({ level, text }) {
  if (!level) return null;
  return h('span', { className: level==='r'?'alert-r':'alert-y', style:{ fontSize:11, padding:'3px 10px', borderRadius:12, fontWeight:500, display:'inline-flex', alignItems:'center', gap:6 } }, '● ', text);
}

export function Metric({ label, value, sub, sc, icon }) {
  return h('div', { className:'metric' },
    h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:6, display:'flex', alignItems:'center', gap:5, fontWeight:500, letterSpacing:'.3px', textTransform:'uppercase' } }, icon && h('span', null, icon), label),
    h('div', { style:{ fontSize:22, fontWeight:600, color:'var(--t1)', letterSpacing:'-0.5px', lineHeight:1.2 } }, value),
    sub && h('div', { style:{ fontSize:11, color:sc||'var(--t2)', marginTop:5, fontWeight:400 } }, sub),
  );
}

export function Inp({ label, value, onChange, type, placeholder, options, textarea, hint }) {
  return h('div', { style:{ marginBottom:14 } },
    label && h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:5, fontWeight:500 } }, label),
    options
      ? h('select', { value:value||'', onChange:e=>onChange(e.target.value) },
          h('option', { value:'' }, '— Seleccionar —'),
          options.map(o => h('option', { key:o, value:o }, o))
        )
      : textarea
      ? h('textarea', { value:value||'', onChange:e=>onChange(e.target.value), placeholder:placeholder||'', rows:3, style:{ resize:'vertical' } })
      : h('input', { type:type||'text', value:value==null?'':value, onChange:e=>onChange(e.target.value), placeholder:placeholder||'' }),
    hint && h('div', { style:{ fontSize:11, color:'var(--t3)', marginTop:4 } }, hint),
  );
}

export function NumInput({ value, onChange, style: st, placeholder }) {
  const [local, setLocal] = useState(value===0||value===''||value==null?'':String(value));
  useEffect(() => { setLocal(value===0||value===''||value==null?'':String(value)); }, [value]);
  return h('input', {
    type:'number', value:local, placeholder:placeholder||'0',
    onChange: e => setLocal(e.target.value),
    onBlur: e => { const n=e.target.value===''?0:Number(e.target.value); setLocal(n===0?'':String(n)); onChange(n); },
    style: st||{},
  });
}

export function EmptyState({ title, description, actionLabel, onAction, icon }) {
  return h('div', { className:'empty' },
    icon && h('div', { style:{ fontSize:48, marginBottom:16, opacity:.3 } }, icon),
    h('h3', null, title),
    description && h('p', { style:{ fontSize:13, maxWidth:400, margin:'0 auto 20px' } }, description),
    actionLabel && onAction && h('button', { className:'bp', onClick:onAction }, actionLabel),
  );
}

export function ConfirmAction({ label, onConfirm, style: st={}, dangerous }) {
  const [c, setC] = useState(false);
  if (!c) return h('button', { onClick:()=>setC(true), style:{ ...st, color:dangerous?'#E24B4A':undefined } }, label);
  return h('span', { style:{ display:'inline-flex', gap:6, alignItems:'center' } },
    h('span', { style:{ fontSize:11, color:'var(--t2)' } }, '¿Confirmar?'),
    h('button', { onClick:()=>{ onConfirm(); setC(false); }, style:{ ...st, background:'#E24B4A', color:'#fff', border:'none', fontSize:11, padding:'4px 10px' } }, 'Sí'),
    h('button', { onClick:()=>setC(false), style:{ fontSize:11, padding:'4px 10px' } }, 'No'),
  );
}

export function Modal({ title, children, onClose, maxWidth }) {
  useEffect(() => {
    const fn = e => { if (e.key==='Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return h('div', { onClick:onClose, style:{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20, backdropFilter:'blur(2px)' } },
    h('div', { onClick:e=>e.stopPropagation(), style:{ background:'var(--bg1)', borderRadius:'var(--rl)', padding:'24px 28px', maxWidth:maxWidth||460, width:'100%', border:'.5px solid var(--b2)', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' } },
      title && h('div', { style:{ fontSize:16, fontWeight:500, marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' } },
        title,
        h('button', { onClick:onClose, style:{ background:'transparent', border:'none', fontSize:20, color:'var(--t3)', padding:0, cursor:'pointer', lineHeight:1 } }, '×'),
      ),
      children,
    ),
  );
}

export function DeleteConfirmModal({ title, message, warning, onConfirm, onCancel, confirmLabel }) {
  return h(Modal, { title, onClose:onCancel },
    h('div', { style:{ fontSize:13, lineHeight:1.6, marginBottom:14, whiteSpace:'pre-wrap' } }, message),
    warning && h('div', { style:{ background:'#FCEBEB', color:'#791F1F', fontSize:12, padding:'10px 14px', borderRadius:'var(--r)', marginBottom:16, borderLeft:'3px solid #E24B4A' } }, '⚠ ', warning),
    h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 } },
      h('button', { onClick:onCancel }, 'Cancelar'),
      h('button', { onClick:onConfirm, style:{ background:'#E24B4A', color:'#fff', border:'none', fontWeight:500, padding:'8px 18px' } }, confirmLabel||'Sí, eliminar'),
    ),
  );
}

export function InfoModal({ title, message, details, onClose }) {
  return h(Modal, { title, onClose },
    h('div', { style:{ fontSize:13, lineHeight:1.6, marginBottom:14, whiteSpace:'pre-wrap' } }, message),
    details && h('div', { style:{ background:'var(--bg2)', fontSize:12, padding:'12px 14px', borderRadius:'var(--r)', marginBottom:16, maxHeight:200, overflowY:'auto' } }, details),
    h('div', { style:{ display:'flex', justifyContent:'flex-end' } },
      h('button', { className:'bp', onClick:onClose }, 'Entendido'),
    ),
  );
}
