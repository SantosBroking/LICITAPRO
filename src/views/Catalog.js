// Catalog.js — Catálogo de equipo MSMS con productos personalizados
import { h, useState, useRef } from '../lib/core.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js';
import { CATALOG_IMAGES } from '../lib/catalog_images.js';
import { uid } from '../lib/utils.js';
import { Inp } from '../ui/primitives.js';

const CATS_BASE = [...new Set(CATALOG_PRODUCTS.map(p => p.cat))];
const EMPTY_PROD = () => ({ id:'', cat:'', catNew:'', sub:'', nom:'', desc:'', prov:'MSMS CORP', vis:true, price:0, photo:'' });

function ProductForm({ prod, onSave, onCancel, existingCats }) {
  const [p, sP] = useState({ ...EMPTY_PROD(), ...prod });
  const [preview, setPreview] = useState(prod.photo || '');
  const imgRef = useRef(null);
  const set = (k,v) => sP(x=>({...x,[k]:v}));

  const handlePhoto = (file) => {
    if (!file) return;
    if (file.size > 3*1024*1024) { alert('Imagen muy grande (máx. 3MB)'); return; }
    const r = new FileReader();
    r.onload = e => { setPreview(e.target.result); set('photo', e.target.result); };
    r.readAsDataURL(file);
  };

  const cats = [...new Set([...existingCats, ...CATS_BASE])];
  const cat = p.catNew || p.cat;

  const doSave = () => {
    if (!p.nom.trim()) { alert('El nombre del producto es obligatorio'); return; }
    if (!cat.trim()) { alert('La categoría es obligatoria'); return; }
    onSave({ ...p, cat, id: p.id || ('custom-' + uid('prd')) });
  };

  return h('div', { className:'card', style:{ maxWidth:600 } },
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { className:'page-title' }, p.id ? 'Editar producto' : 'Nuevo producto'),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:onCancel }, 'Cancelar'),
        h('button', { className:'bp', onClick:doSave }, 'Guardar producto'),
      ),
    ),

    // Foto
    h('div', { style:{ marginBottom:16 } },
      h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:8, fontWeight:500 } }, 'Foto del producto'),
      h('div', { style:{ display:'flex', alignItems:'flex-start', gap:12 } },
        preview
          ? h('div', { style:{ position:'relative', flexShrink:0 } },
              h('img', { src:preview, style:{ width:100, height:100, objectFit:'cover', borderRadius:'var(--r)', border:'1px solid var(--b1)' } }),
              h('button', { onClick:()=>{ setPreview(''); set('photo',''); }, style:{ position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:'50%', background:'var(--red)', color:'#fff', border:'none', cursor:'pointer', fontSize:11, display:'flex', alignItems:'center', justifyContent:'center', padding:0 } }, '✕'),
            )
          : h('div', { onClick:()=>imgRef.current?.click(), className:'drop', style:{ width:100, height:100, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, cursor:'pointer', flexShrink:0 } },
              h('span', { style:{ fontSize:24 } }, '📷'),
              h('span', { style:{ fontSize:10, color:'var(--t2)' } }, 'Subir foto'),
            ),
        h('input', { ref:imgRef, type:'file', accept:'image/*', style:{ display:'none' }, onChange:e=>handlePhoto(e.target.files[0]) }),
        h('div', { style:{ fontSize:11, color:'var(--t3)', lineHeight:1.6 } }, 'Sube una foto del producto (JPG, PNG, máx. 3MB). Se mostrará en la cotización y el catálogo.'),
      ),
    ),

    h(Inp, { label:'Nombre del producto *', value:p.nom, onChange:v=>set('nom',v), placeholder:'Sirena bicolor 100W...' }),

    // Categoría: seleccionar existente o crear nueva
    h('div', { style:{ marginBottom:14 } },
      h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:5, fontWeight:500 } }, 'Categoría'),
      h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 } },
        h('select', { value:p.cat, onChange:e=>{ set('cat',e.target.value); set('catNew',''); }, style:{ fontSize:13 } },
          h('option', { value:'' }, '— Categoría existente —'),
          cats.map(c => h('option', { key:c, value:c }, c)),
        ),
        h('input', { value:p.catNew||'', onChange:e=>{ set('catNew',e.target.value); set('cat',''); }, placeholder:'O escribe nueva categoría...', style:{ fontSize:13 } }),
      ),
    ),

    h(Inp, { label:'Subcategoría', value:p.sub, onChange:v=>set('sub',v), placeholder:'Iluminación, Radio, etc.' }),
    h(Inp, { label:'Descripción', value:p.desc, onChange:v=>set('desc',v), textarea:true, placeholder:'Características técnicas del producto...' }),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
      h(Inp, { label:'Proveedor', value:p.prov, onChange:v=>set('prov',v), placeholder:'MSMS CORP' }),
      h('div', { style:{ marginBottom:14 } },
        h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:5, fontWeight:500 } }, 'Precio base (con IVA)'),
        h('input', { type:'number', value:p.price||0, onChange:e=>set('price',Number(e.target.value)), min:0 }),
      ),
    ),
    h('div', { style:{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg2)', borderRadius:'var(--r)', marginBottom:14 } },
      h('input', { type:'checkbox', checked:p.vis, onChange:e=>set('vis',e.target.checked), id:'chk-vis' }),
      h('label', { htmlFor:'chk-vis', style:{ fontSize:13, cursor:'pointer' } }, 'Visible en cotización cliente'),
      h('span', { style:{ fontSize:11, color:'var(--t3)' } }, p.vis ? '(aparece en PDF del cliente)' : '(solo uso interno)'),
    ),
  );
}

export default function CatalogView({ config, onSaveConfig }) {
  const customProds = config?.customProducts || [];
  // Productos editados (mismos IDs que estáticos) sobreescriben el original
  const overrides = {};
  customProds.forEach(p => { if (CATALOG_PRODUCTS.find(x=>x.id===p.id)) overrides[p.id]=p; });
  const allProds = [
    ...CATALOG_PRODUCTS.map(p => overrides[p.id] || p),
    ...customProds.filter(p => !CATALOG_PRODUCTS.find(x=>x.id===p.id)),
  ];
  const cats = [...new Set(allProds.map(p => p.cat))];

  const [sel, setSel]       = useState(cats[0]);
  const [search, setSearch] = useState('');
  const [form, setForm]     = useState(null); // null | 'new' | product

  const prods = allProds.filter(p =>
    p.cat === sel && (!search || p.nom.toLowerCase().includes(search.toLowerCase()) || (p.sub||'').toLowerCase().includes(search.toLowerCase()))
  );

  const saveProduct = async (prod) => {
    const existing = customProds.find(x => x.id === prod.id);
    // Si es edición de producto estático (mismo ID), reemplazar en overrides
    const isStaticEdit = !!CATALOG_PRODUCTS.find(x => x.id === prod.id);
    const updated = existing || isStaticEdit
      ? customProds.map(x => x.id === prod.id ? prod : x).concat(existing || isStaticEdit ? [] : [prod])
      : [...customProds, prod];
    // Asegurar que si es static edit y no existía en custom, se agregue
    const finalUpdated = customProds.find(x=>x.id===prod.id)
      ? customProds.map(x=>x.id===prod.id?prod:x)
      : [...customProds, prod];
    await onSaveConfig({ ...config, customProducts: finalUpdated });
    // Si es nueva categoría, actualizar la selección
    setSel(prod.cat);
    setForm(null);
  };

  const deleteProduct = async (id) => {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    await onSaveConfig({ ...config, customProducts: customProds.filter(x => x.id !== id) });
  };

  if (form) {
    return h(ProductForm, {
      prod: form === 'new' ? EMPTY_PROD() : form,
      existingCats: [...new Set(allProds.map(p => p.cat))],
      onSave: saveProduct,
      onCancel: () => setForm(null),
    });
  }

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
      h('div', { className:'page-title' }, 'Catálogo de equipo MSMS'),
      h('button', { className:'bp', onClick:()=>setForm('new') }, '+ Agregar producto'),
    ),
    h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar producto...', style:{ maxWidth:240, marginBottom:16, display:'block' } }),
    h('div', { style:{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 } },
      cats.map(c => h('button', { key:c, className:sel===c?'bp':'', onClick:()=>{ setSel(c); setSearch(''); }, style:{ fontSize:12, padding:'5px 12px' } }, c))
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 } },
      prods.map(prod => {
        const isCustom = !!customProds.find(x => x.id === prod.id);
        return h('div', { key:prod.id, className:'card', style:{ position:'relative' } },
          h('div', { style:{ position:'absolute', top:10, right:10, display:'flex', gap:6 } },
            h('button', { onClick:()=>setForm({...prod, photo: prod.photo || CATALOG_IMAGES[prod.id] || ''}), style:{ fontSize:11, padding:'3px 8px', color:'var(--blue)', background:'transparent', border:'.5px solid var(--blue-border)', background:'var(--bg1)' } }, 'Editar'),
            isCustom && CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('button', { onClick:()=>deleteProduct(prod.id), style:{ fontSize:11, padding:'3px 8px', color:'var(--t2)', background:'transparent', border:'.5px solid var(--b2)', background:'var(--bg1)' }, title:'Restaurar original' }, '↩ Restaurar'),
            isCustom && !CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('button', { onClick:()=>deleteProduct(prod.id), style:{ fontSize:11, padding:'3px 8px', color:'var(--red)', background:'transparent', border:'.5px solid #E24B4A55' } }, 'Eliminar'),
          ),
          (prod.photo || CATALOG_IMAGES[prod.id]) && h('img', { src:prod.photo || CATALOG_IMAGES[prod.id], style:{ width:'100%', height:120, objectFit:'cover', borderRadius:'var(--r)', marginBottom:10, border:'1px solid var(--b1)' } }),
          h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:3 } }, prod.nom),
          h('div', { style:{ fontSize:11, color:'var(--blue)', marginBottom:4 } }, prod.sub, prod.sub?' · ':'', prod.prov, ' · ID: ', prod.id),
          h('div', { style:{ fontSize:12, color:'var(--t2)', lineHeight:1.5, marginBottom:6 } }, prod.desc),
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 } },
            h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:prod.vis?'#E1F5EE':'#F1EFE8', color:prod.vis?'#085041':'#444441' } },
              prod.vis ? 'visible cliente' : 'uso interno'
            ),
            prod.price>0 && h('span', { style:{ fontSize:12, fontWeight:500, color:'var(--t1)' } }, '$'+prod.price.toLocaleString('es-MX')),
            isCustom && !CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--purple-bg)', color:'var(--purple)' } }, '★ Personalizado'),
            isCustom && CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--amber-bg)', color:'var(--amber)' } }, '✏ Editado'),
          ),
        );
      })
    ),
    prods.length===0 && h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)' } }, 'Sin resultados'),
  );
}
