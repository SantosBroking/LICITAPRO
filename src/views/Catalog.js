// Catalog.js — Vista del catálogo de equipo MSMS
import { h, useState } from '../lib/core.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js';

export default function CatalogView() {
  const cats = [...new Set(CATALOG_PRODUCTS.map(p => p.cat))];
  const [sel, setSel]     = useState(cats[0]);
  const [search, setSearch] = useState('');
  const prods = CATALOG_PRODUCTS.filter(p =>
    p.cat === sel && (!search || p.nom.toLowerCase().includes(search.toLowerCase()) || p.sub.toLowerCase().includes(search.toLowerCase()))
  );
  return h('div', null,
    h('div', { style:{ fontSize:20, fontWeight:500, marginBottom:16 } }, 'Catálogo de equipo MSMS'),
    h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar producto...', style:{ maxWidth:240, marginBottom:16, display:'block' } }),
    h('div', { style:{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 } },
      cats.map(c => h('button', { key:c, className:sel===c?'bp':'', onClick:()=>{ setSel(c); setSearch(''); }, style:{ fontSize:12, padding:'5px 12px' } }, c))
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 } },
      prods.map(prod =>
        h('div', { key:prod.id, className:'card' },
          h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:3 } }, prod.nom),
          h('div', { style:{ fontSize:11, color:'var(--blue)', marginBottom:4 } }, prod.sub, ' · ', prod.prov, ' · ID: ', prod.id),
          h('div', { style:{ fontSize:12, color:'var(--t2)', lineHeight:1.5 } }, prod.desc),
          h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:prod.vis?'#E1F5EE':'#F1EFE8', color:prod.vis?'#085041':'#444441' } },
            prod.vis ? 'visible cliente' : 'uso interno'
          ),
        )
      )
    ),
    prods.length===0 && h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)' } }, 'Sin resultados para "', search, '"'),
  );
}
