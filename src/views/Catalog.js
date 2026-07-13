// Catalog.js — Catálogo de equipo con productos personalizados
import { h, useState, useRef } from '../lib/core.js';
import { NumInput, StorageImg } from '../ui/primitives.js';
import { CATALOG_PRODUCTS } from '../lib/catalog.js';
import { CATALOG_IMAGES } from '../lib/catalog_images.js';
import { getPermissions } from '../lib/permissions.js'; // Fase 2A4 — cerrar fuga de costo interno en Catálogo
import { uid } from '../lib/utils.js';
import { uploadImageToStorage, isBase64 } from '../lib/supabase.js';

// Comprime imagen a máx 300px y calidad 50% para no saturar Supabase
async function compressImage(dataURL, maxPx=300, quality=0.5) {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height, 1));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}
import { Inp } from '../ui/primitives.js';

const CATS_BASE = ['00 Vehículos', ...new Set(CATALOG_PRODUCTS.map(p => p.cat))];
const EMPTY_PROD = () => ({ id:'', cat:'', catNew:'', sub:'', nom:'', desc:'', prov:'', vis:true, price:0, photo:'' });

function ProductForm({ prod, onSave, onCancel, existingCats, allProducts, user }) {
  const [p, sP] = useState({ ...EMPTY_PROD(), ...prod });
  const [preview, setPreview] = useState(prod.photo || '');
  const imgRef = useRef(null);
  const set = (k,v) => sP(x=>({...x,[k]:v}));

  const handlePhoto = (file) => {
    if (!file) return;
    if (file.size > 3*1024*1024) { alert('Imagen muy grande (máx. 3MB)'); return; }
    const r = new FileReader();
    r.onload = async e => { const compressed = await compressImage(e.target.result); setPreview(compressed); set('photo', compressed); };
    r.readAsDataURL(file);
  };

  const cats = [...new Set([...existingCats, ...CATS_BASE])];
  const cat = p.catNew || p.cat;

  const doSave = () => {
    const finalCat = p.esVehiculo ? '00 Vehículos' : cat;
    const autoNom = p.esVehiculo ? [p.v_marca,p.v_modelo,p.v_version,p.v_ano].filter(Boolean).join(' ') : '';
    const finalNom = p.nom.trim() || autoNom;
    if (!finalNom) { alert('Agrega al menos la marca y modelo del vehículo'); return; }
    if (!finalCat.trim()) { alert('La categoría es obligatoria'); return; }
    onSave({ ...p, nom:finalNom, cat:finalCat, id: p.id || ('custom-' + uid('prd')) });
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
      h(Inp, { label:'Proveedor', value:p.prov, onChange:v=>set('prov',v), placeholder:'Nombre del proveedor' }),
      getPermissions(user).verCostosInternos && h('div', { style:{ marginBottom:14 } },
        h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:5, fontWeight:500 } }, 'Precio base (con IVA)'),
        h(NumInput, { value:p.price||0, onChange:v=>set('price',v) }),
      ),
    ),
    h('div', { style:{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg2)', borderRadius:'var(--r)', marginBottom:14 } },
      h('input', { type:'checkbox', checked:p.vis, onChange:e=>set('vis',e.target.checked), id:'chk-vis' }),
      h('label', { htmlFor:'chk-vis', style:{ fontSize:13, cursor:'pointer' } }, 'Visible en cotización cliente'),
      h('span', { style:{ fontSize:11, color:'var(--t3)' } }, p.vis ? '(aparece en PDF del cliente)' : '(solo uso interno)'),
    ),

    // ── Modelo de vehículo ──
    h('div', { style:{ border:'1px solid var(--b1)', borderRadius:'var(--rl)', padding:14, marginBottom:14 } },
      h('label', { style:{ display:'flex', gap:8, alignItems:'center', cursor:'pointer', marginBottom:p.esVehiculo?12:0 } },
        h('input', { type:'checkbox', checked:!!p.esVehiculo, onChange:e=>{
          const v = e.target.checked;
          sP(x=>({...x, esVehiculo:v, cat:v?'00 Vehículos':x.cat}));
        } }),
        h('span', { style:{ fontSize:13, fontWeight:500 } }, '🚗 Es un modelo de vehículo'),
        h('span', { style:{ fontSize:11, color:'var(--t3)', marginLeft:4 } }, '— aparece como opción rápida en las partidas de la cotización'),
      ),
      p.esVehiculo && h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10 } },
        h(Inp, { label:'Tipo', value:p.v_tipo||'', onChange:v=>set('v_tipo',v), placeholder:'Pickup patrulla' }),
        h(Inp, { label:'Marca', value:p.v_marca||'', onChange:v=>{ sP(x=>({...x,v_marca:v,nom:[v,x.v_modelo,x.v_version,x.v_ano].filter(Boolean).join(' ')||x.nom})); }, placeholder:'Nissan' }),
        h(Inp, { label:'Modelo', value:p.v_modelo||'', onChange:v=>{ sP(x=>({...x,v_modelo:v,nom:[x.v_marca,v,x.v_version,x.v_ano].filter(Boolean).join(' ')||x.nom})); }, placeholder:'Frontier' }),
        h(Inp, { label:'Versión', value:p.v_version||'', onChange:v=>{ sP(x=>({...x,v_version:v,nom:[x.v_marca,x.v_modelo,v,x.v_ano].filter(Boolean).join(' ')||x.nom})); }, placeholder:'LE TA 4x4' }),
        h(Inp, { label:'Año', value:p.v_ano||'', onChange:v=>{ sP(x=>({...x,v_ano:v,nom:[x.v_marca,x.v_modelo,x.v_version,v].filter(Boolean).join(' ')||x.nom})); }, placeholder:'2026' }),
      ),
    ),

    // ── Kit: este producto incluye varios productos ──
    h('div', { style:{ border:'1px solid var(--b1)', borderRadius:'var(--rl)', padding:14, marginBottom:14 } },
      h('div', { style:{ display:'flex', alignItems:'center', gap:10, marginBottom:(p.kitItems&&p.kitItems.length)||p._esKit?12:0 } },
        h('input', { type:'checkbox', id:'chk-kit',
          checked: !!((p.kitItems && p.kitItems.length) || p._esKit),
          onChange:e=>{ if(e.target.checked){ set('_esKit',true); if(!p.kitItems) set('kitItems',[]); } else { set('_esKit',false); set('kitItems',[]); } } }),
        h('label', { htmlFor:'chk-kit', style:{ fontSize:13, cursor:'pointer', fontWeight:500 } }, 'Este producto es un kit (incluye varios productos)'),
      ),
      ((p.kitItems && p.kitItems.length) || p._esKit) && h('div', null,
        h('div', { style:{ fontSize:11, color:'var(--t2)', marginBottom:8 } }, 'Selecciona los productos que incluye este kit (' + ((p.kitItems||[]).length) + ' seleccionados):'),
        h('div', { style:{ maxHeight:240, overflowY:'auto', border:'1px solid var(--b1)', borderRadius:'var(--r)', padding:'4px 0' } },
          (allProducts||[])
            .filter(x => x.id !== p.id && !(x.kitItems && x.kitItems.length))  // no kits anidados, no a sí mismo
            .map(x => {
              const sel = (p.kitItems||[]).includes(x.id);
              return h('label', { key:x.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', cursor:'pointer', fontSize:12, background:sel?'var(--bg2)':'transparent' } },
                h('input', { type:'checkbox', checked:sel, onChange:()=>{
                  const cur = p.kitItems || [];
                  set('kitItems', sel ? cur.filter(id=>id!==x.id) : [...cur, x.id]);
                } }),
                h('span', { style:{ color:'var(--t3)', minWidth:54, fontSize:10 } }, x.cat),
                h('span', null, x.nom),
              );
            }),
        ),
      ),
    ),
  );
}


// ── KitManager ────────────────────────────────────────────────
function KitEditor({ kit, allProducts, existingCats, onSave, onCancel }) {
  const isNew = !kit.id;
  const [nom, setNom]         = useState(kit.nom || '');
  const [cat, setCat]         = useState(kit.cat || existingCats[0] || '');
  const [items, setItems]     = useState(kit.kitItems || []);
  const [search, setSearch]   = useState('');

  const toggleItem = (id) => setItems(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);

  const doSave = () => {
    if (!nom.trim()) { alert('El kit necesita un nombre.'); return; }
    if (items.length === 0) { alert('Agrega al menos un producto al kit.'); return; }
    onSave({ ...kit, id: kit.id || ('kit-'+uid('k')), nom, cat, kitItems: items, sub:'Kit', vis:true });
  };

  const candidates = allProducts
    .filter(x => !(x.kitItems && x.kitItems.length) && x.id !== kit.id)
    .filter(x => !search || x.nom.toLowerCase().includes(search.toLowerCase()) || (x.cat||'').toLowerCase().includes(search.toLowerCase()));

  return h('div', { className:'card', style:{ maxWidth:680 } },
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 } },
      h('div', { className:'page-title' }, isNew ? 'Nuevo kit' : 'Editar kit: '+kit.nom),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:onCancel }, 'Cancelar'),
        h('button', { className:'bp', onClick:doSave }, 'Guardar kit'),
      ),
    ),
    h('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 } },
      h(Inp, { label:'Nombre del kit *', value:nom, onChange:setNom, placeholder:'Kit patrulla completo...' }),
      h('div', null,
        h('label', { style:{ display:'block', fontSize:12, color:'var(--t2)', marginBottom:5, fontWeight:500 } }, 'Categoría'),
        h('select', { value:cat, onChange:e=>setCat(e.target.value), style:{ width:'100%', fontSize:13 } },
          existingCats.map(c => h('option', { key:c, value:c }, c)),
        ),
      ),
    ),
    h('div', { style:{ marginBottom:10, display:'flex', alignItems:'center', gap:10 } },
      h('div', { style:{ fontSize:13, fontWeight:500 } }, 'Productos del kit'),
      h('span', { style:{ fontSize:11, color:'var(--blue)', fontWeight:500, background:'var(--blue-bg)', padding:'2px 8px', borderRadius:99 } }, items.length+' seleccionados'),
    ),
    h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar producto...', style:{ marginBottom:8, width:'100%', maxWidth:300 } }),
    h('div', { style:{ maxHeight:320, overflowY:'auto', border:'1px solid var(--b1)', borderRadius:'var(--r)' } },
      candidates.length === 0 && h('div', { style:{ padding:20, textAlign:'center', color:'var(--t3)', fontSize:12 } }, 'No hay productos.'),
      candidates.map(x => {
        const sel = items.includes(x.id);
        return h('label', { key:x.id, style:{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', cursor:'pointer', borderBottom:'1px solid var(--b1)', background:sel?'var(--blue-bg)':'transparent' } },
          h('input', { type:'checkbox', checked:sel, onChange:()=>toggleItem(x.id), style:{ accentColor:'var(--blue)' } }),
          (x.photo || CATALOG_IMAGES[x.id]) && h(StorageImg, { src:x.photo||CATALOG_IMAGES[x.id], style:{ width:36, height:36, objectFit:'contain', borderRadius:4, flexShrink:0 } }),
          h('div', null,
            h('div', { style:{ fontSize:12, fontWeight:sel?600:400 } }, x.nom),
            h('div', { style:{ fontSize:10, color:'var(--t3)' } }, x.cat),
          ),
        );
      }),
    ),
  );
}

function KitManager({ allProducts, customProds, existingCats, onSaveKit, onDeleteKit, onRestoreKit }) {
  const [editing, setEditing] = useState(null); // null | 'new' | kitObject

  // Todos los kits: estáticos + custom (custom sobrescribe mismo id)
  const staticKits = CATALOG_PRODUCTS.filter(p => p.kitItems && p.kitItems.length > 0);
  const customKits = customProds.filter(p => p.kitItems && p.kitItems.length > 0);
  const overrideIds = new Set(customKits.filter(p => CATALOG_PRODUCTS.find(x=>x.id===p.id)).map(p=>p.id));
  const allKits = [
    ...staticKits.map(k => customKits.find(x=>x.id===k.id) || k),
    ...customKits.filter(p => !CATALOG_PRODUCTS.find(x=>x.id===p.id)),
  ];

  if (editing) {
    return h(KitEditor, {
      kit: editing === 'new' ? {} : editing,
      allProducts,
      existingCats,
      onSave: (kit) => { onSaveKit(kit); setEditing(null); },
      onCancel: () => setEditing(null),
    });
  }

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
      h('div', null,
        h('div', { className:'page-title' }, '🧩 Gestión de kits'),
        h('div', { style:{ fontSize:12, color:'var(--t2)' } }, 'Los kits agrupan varios productos en la cotización. Se expanden automáticamente en el PDF.'),
      ),
      h('button', { className:'bp', onClick:()=>setEditing('new') }, '+ Nuevo kit'),
    ),
    allKits.length === 0 && h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)', fontSize:13 } }, 'No hay kits. Crea uno con el botón de arriba.'),
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:12 } },
      allKits.map(k => {
        const isOverride = overrideIds.has(k.id);
        const isStaticOnly = !!CATALOG_PRODUCTS.find(x=>x.id===k.id) && !isOverride;
        const comps = (k.kitItems||[]).map(id => allProducts.find(p=>p.id===id)).filter(Boolean);
        return h('div', { key:k.id, className:'card' },
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 } },
            h('div', null,
              h('div', { style:{ fontSize:14, fontWeight:600 } }, k.nom),
              h('div', { style:{ fontSize:11, color:'var(--t2)', marginTop:2 } }, k.cat,
                isOverride && h('span', { style:{ marginLeft:6, color:'var(--amber)', fontWeight:500 } }, '· personalizado'),
                isStaticOnly && h('span', { style:{ marginLeft:6, color:'var(--t3)' } }, '· base'),
              ),
            ),
            h('div', { style:{ display:'flex', gap:6, flexShrink:0 } },
              h('button', { onClick:()=>setEditing({...k}),
                style:{ fontSize:11, padding:'4px 10px', color:'var(--blue)', background:'var(--bg1)', border:'1px solid var(--blue-border)', borderRadius:'var(--r)', cursor:'pointer' } }, '✏ Editar'),
              isOverride && h('button', { onClick:()=>{ if(confirm('¿Restaurar este kit a su versión original?')) onRestoreKit(k.id); },
                style:{ fontSize:11, padding:'4px 10px', color:'var(--t2)', background:'var(--bg1)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '↩ Restaurar'),
              !isStaticOnly && !isOverride && h('button', { onClick:()=>{ if(confirm('¿Eliminar este kit?')) onDeleteKit(k.id); },
                style:{ fontSize:11, padding:'4px 10px', color:'var(--red)', background:'var(--bg1)', border:'1px solid #E24B4A55', borderRadius:'var(--r)', cursor:'pointer' } }, '🗑 Eliminar'),
            ),
          ),
          h('div', { style:{ fontSize:11, color:'var(--t3)', marginBottom:8 } }, comps.length + ' productos:'),
          h('div', { style:{ display:'flex', flexWrap:'wrap', gap:4 } },
            comps.map(c => h('span', { key:c.id, style:{ fontSize:10, padding:'2px 8px', background:'var(--bg2)', borderRadius:99, border:'1px solid var(--b1)' } }, c.nom)),
            comps.length === 0 && h('span', { style:{ fontSize:11, color:'var(--t3)', fontStyle:'italic' } }, 'Sin componentes'),
          ),
        );
      }),
    ),
  );
}

export default function CatalogView({ config, onSaveConfig, user }) {
  const customProds   = config?.customProducts || [];
  const hiddenProds   = config?.hiddenProducts  || [];
  // Productos editados (mismos IDs que estáticos) sobreescriben el original
  const overrides = {};
  customProds.forEach(p => { if (CATALOG_PRODUCTS.find(x=>x.id===p.id)) overrides[p.id]=p; });
  const allProds = [
    ...CATALOG_PRODUCTS
      .filter(p => !hiddenProds.includes(p.id))
      .map(p => overrides[p.id] || p),
    ...customProds.filter(p => !CATALOG_PRODUCTS.find(x=>x.id===p.id)),
  ];
  const cats = [...new Set(allProds.map(p => p.cat))];

  const [sel, setSel]       = useState(cats[0]);
  const [search, setSearch] = useState('');
  const [form, setForm]     = useState(null);
  const [kitView, setKitView] = useState(false); // null | 'new' | product

  const prods = allProds.filter(p =>
    p.cat === sel && (!search || p.nom.toLowerCase().includes(search.toLowerCase()) || (p.sub||'').toLowerCase().includes(search.toLowerCase()))
  );

  const saveProduct = async (prod) => {
    let safeProd = { ...prod };
    // Fase 2A4/Commit 6: el precio del catálogo se convierte literalmente en
    // costoConIVA al agregarse a una cotización -- es un dato reservado.
    // Empleado NUNCA puede crear un producto nuevo (ni "Agregar producto" ni
    // "Duplicar", que también genera un id nuevo) -- no existe forma segura
    // de capturar ese dato sin verlo. Se bloquea por completo, no se guarda
    // con un valor forzado en cero (eso contaminaría el catálogo).
    const puedeVerCostos = getPermissions(user).verCostosInternos;
    const esProductoNuevo = !allProds.find(x => x.id === safeProd.id);
    if (!puedeVerCostos && esProductoNuevo) {
      alert('Solo admin puede crear productos de catálogo porque requieren costo interno.');
      return;
    }
    if (!puedeVerCostos) {
      // Edición de un producto YA existente -- se preserva el precio
      // original exacto, nunca se acepta lo que traiga el formulario, sin
      // importar que el input esté oculto (segunda capa, protege incluso
      // si se manipula el payload).
      const original = allProds.find(x => x.id === safeProd.id);
      safeProd.price = original.price;
    }
    // Fotos del catálogo: guardar como base64 comprimido (no Storage)
    // Son ~15KB comprimidas — OK en BD; Storage es para PDFs/XMLs grandes
    if (safeProd.photo && isBase64(safeProd.photo)) {
      safeProd.photo = await compressImage(safeProd.photo, 300, 0.5);
    }
    const finalUpdated = customProds.find(x=>x.id===safeProd.id)
      ? customProds.map(x=>x.id===safeProd.id?safeProd:x)
      : [...customProds, safeProd];
    await onSaveConfig({ ...config, customProducts: finalUpdated });
    setSel(safeProd.cat);
    setForm(null);
  };

  // Duplicar un producto/modelo: crea una copia con ID nuevo y abre el formulario para ajustarla
  const duplicateProduct = (prod) => {
    const copia = {
      ...prod,
      id: 'cust-' + Date.now(),
      nom: (prod.nom || '') + ' (copia)',
      photo: prod.photo || CATALOG_IMAGES[prod.id] || '',
    };
    setForm(copia);
  };

  const saveKit = async (kit) => {
    const finalUpdated = customProds.find(x=>x.id===kit.id)
      ? customProds.map(x=>x.id===kit.id?kit:x)
      : [...customProds, kit];
    await onSaveConfig({ ...config, customProducts: finalUpdated });
  };

  const deleteKit = async (id) => {
    await onSaveConfig({ ...config, customProducts: customProds.filter(x=>x.id!==id) });
  };

  const restoreKit = async (id) => {
    await onSaveConfig({ ...config, customProducts: customProds.filter(x=>x.id!==id) });
  };

  const deleteProduct = async (id) => {
    const isStatic = !!CATALOG_PRODUCTS.find(x => x.id === id);
    const msg = isStatic
      ? '¿Ocultar este producto del catálogo? (puedes restaurarlo desde el botón ↩)'
      : '¿Eliminar este producto personalizado? Esta acción no se puede deshacer.';
    if (!confirm(msg)) return;
    if (isStatic) {
      // Ocultar producto estático
      await onSaveConfig({ ...config, hiddenProducts: [...hiddenProds, id] });
    } else {
      // Eliminar producto personalizado
      await onSaveConfig({ ...config, customProducts: customProds.filter(x => x.id !== id) });
    }
  };

  const restoreProduct = async (id) => {
    // Restaurar a versión original (quitar de customProds y de hiddenProds)
    await onSaveConfig({
      ...config,
      customProducts: customProds.filter(x => x.id !== id),
      hiddenProducts: hiddenProds.filter(x => x !== id),
    });
  };

  if (form) {
    return h(ProductForm, {
      prod: form === 'new' ? EMPTY_PROD() : form,
      existingCats: [...new Set(allProds.map(p => p.cat))],
      onSave: saveProduct,
      onCancel: () => setForm(null),
      user,
    });
  }

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
      h('div', { className:'page-title' }, 'Catálogo de equipo'),
      h('div', { style:{ display:'flex', gap:8 } },
        h('button', { onClick:()=>{ setKitView(k=>!k); setForm(null); }, style:{ fontSize:13, padding:'7px 14px', borderRadius:'var(--r)', border:'1px solid var(--b2)', background:kitView?'var(--t1)':'var(--bg1)', color:kitView?'var(--bg1)':'var(--t1)', cursor:'pointer', fontWeight:500 } }, '🧩 Kits'),
        !kitView && getPermissions(user).verCostosInternos && h('button', { className:'bp', onClick:()=>setForm('new') }, '+ Agregar producto'),
      ),
    ),
    kitView && h(KitManager, { allProducts:allProds, customProds, existingCats:[...new Set(allProds.map(p=>p.cat))], onSaveKit:saveKit, onDeleteKit:deleteKit, onRestoreKit:restoreKit }),
    !kitView && h('input', { value:search, onChange:e=>setSearch(e.target.value), placeholder:'Buscar producto...', style:{ maxWidth:240, marginBottom:16, display:'block' } }),
    !kitView && hiddenProds.length > 0 && h('div', { style:{ marginBottom:12, padding:'8px 12px', background:'var(--amber-bg)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12, display:'flex', alignItems:'center', gap:10 } },
      h('span', null, '👁 '+hiddenProds.length+' producto(s) oculto(s) en esta categoría no aparecen.'),
      h('button', { onClick:async()=>{ if(confirm('¿Restaurar todos los productos ocultos?')) await onSaveConfig({...config, hiddenProducts:[]}); },
        style:{ fontSize:11, padding:'4px 10px', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', background:'white', cursor:'pointer' } }, 'Mostrar todos'),
    ),
    !kitView && h('div', { style:{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 } },
      cats.map(c => h('button', { key:c, className:sel===c?'bp':'', onClick:()=>{ setSel(c); setSearch(''); }, style:{ fontSize:12, padding:'5px 12px' } }, c))
    ),
    !kitView && (() => {
      // Tarjeta de producto (reutilizable)
      const renderProd = prod => {
        const isCustom = !!customProds.find(x => x.id === prod.id);
        return h('div', { key:prod.id, className:'card' },
          h('div', { style:{ display:'flex', justifyContent:'flex-end', gap:4, marginBottom:8, flexWrap:'wrap' } },
            h('button', { onClick:()=>setForm({...prod, photo: prod.photo || CATALOG_IMAGES[prod.id] || ''}),
              style:{ fontSize:11, padding:'4px 10px', color:'var(--blue)', background:'var(--bg1)', border:'1px solid var(--blue-border)', borderRadius:'var(--r)', cursor:'pointer' } }, '✏ Editar'),
            getPermissions(user).verCostosInternos && h('button', { onClick:()=>duplicateProduct(prod),
              style:{ fontSize:11, padding:'4px 10px', color:'var(--t1)', background:'var(--bg1)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '⧉ Duplicar'),
            isCustom && CATALOG_PRODUCTS.find(x=>x.id===prod.id)
              ? h('button', { onClick:()=>restoreProduct(prod.id),
                  style:{ fontSize:11, padding:'4px 10px', color:'var(--t2)', background:'var(--bg1)', border:'1px solid var(--b2)', borderRadius:'var(--r)', cursor:'pointer' } }, '↩ Restaurar')
              : h('button', { onClick:()=>deleteProduct(prod.id),
                  style:{ fontSize:11, padding:'4px 10px', color:'var(--red)', background:'var(--bg1)', border:'1px solid #E24B4A55', borderRadius:'var(--r)', cursor:'pointer' } }, '🗑 Borrar'),
          ),
          (prod.photo || CATALOG_IMAGES[prod.id]) && h(StorageImg, { src:prod.photo || CATALOG_IMAGES[prod.id], style:{ width:'100%', height:120, objectFit:'cover', borderRadius:'var(--r)', marginBottom:10, border:'1px solid var(--b1)' } }),
          h('div', { style:{ fontSize:13, fontWeight:500, marginBottom:3 } }, prod.nom),
          h('div', { style:{ fontSize:11, color:'var(--blue)', marginBottom:4 } }, prod.sub, prod.sub?' · ':'', prod.prov, ' · ID: ', prod.id),
          h('div', { style:{ fontSize:12, color:'var(--t2)', lineHeight:1.5, marginBottom:6 } }, prod.desc),
          h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 } },
            h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:prod.vis?'#E1F5EE':'#F1EFE8', color:prod.vis?'#085041':'#444441' } },
              prod.vis ? 'visible cliente' : 'uso interno'
            ),
            getPermissions(user).verCostosInternos && prod.price>0 && h('span', { style:{ fontSize:12, fontWeight:500, color:'var(--t1)' } }, '$'+prod.price.toLocaleString('es-MX')),
            isCustom && !CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--purple-bg)', color:'var(--purple)' } }, '★ Personalizado'),
            isCustom && CATALOG_PRODUCTS.find(x=>x.id===prod.id) && h('span', { style:{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--amber-bg)', color:'var(--amber)' } }, '✏ Editado'),
          ),
        );
      };
      const gridStyle = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 };

      // Si es la categoría de vehículos, agrupar por marca
      const esVehiculos = sel === '00 Vehículos' || prods.every(p => p.esVehiculo);
      if (esVehiculos && prods.length > 0) {
        const porMarca = {};
        prods.forEach(p => {
          const marca = (p.v_marca || 'Otros').trim() || 'Otros';
          (porMarca[marca] = porMarca[marca] || []).push(p);
        });
        const marcas = Object.keys(porMarca).sort((a,b)=>a.localeCompare(b));
        return h('div', null,
          marcas.map(marca => h('div', { key:marca, style:{ marginBottom:20 } },
            h('div', { style:{ fontSize:13, fontWeight:600, color:'var(--t1)', marginBottom:10, paddingBottom:6, borderBottom:'1px solid var(--b1)', textTransform:'uppercase', letterSpacing:'.4px' } },
              marca, h('span', { style:{ fontSize:11, fontWeight:400, color:'var(--t3)', marginLeft:8, textTransform:'none', letterSpacing:0 } }, porMarca[marca].length+' modelo'+(porMarca[marca].length>1?'s':'')),
            ),
            h('div', { style:gridStyle }, porMarca[marca].map(renderProd)),
          )),
        );
      }
      // Resto de categorías: grid normal
      return h('div', { style:gridStyle }, prods.map(renderProd));
    })(),
    prods.length===0 && h('div', { className:'card', style:{ textAlign:'center', padding:30, color:'var(--t2)' } }, 'Sin resultados'),
  );
}
