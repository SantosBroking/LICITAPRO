// Orden visual canónico de equipo según el catálogo.
// No muta cotizaciones ni cambia cálculos: solo define el orden de presentación.

export function buildCatalogOrderMap(baseProducts = [], customProducts = []) {
  const map = new Map();
  let pos = 0;

  // Los productos base conservan exactamente el orden en catalog.js.
  for (const p of baseProducts || []) {
    if (!p?.id || map.has(p.id)) continue;
    map.set(p.id, pos++);
  }

  // Un override personalizado de un producto base conserva su posición.
  // Los productos nuevos personalizados se agregan después, en el orden
  // configurado en customProducts (que es el orden visible de catálogo).
  for (const p of customProducts || []) {
    if (!p?.id || map.has(p.id)) continue;
    map.set(p.id, pos++);
  }

  return map;
}

export function compareEquipmentByCatalog(a, b, orderMap) {
  const fallback = Number.MAX_SAFE_INTEGER;
  const ai = orderMap?.get(a?.productoId) ?? fallback;
  const bi = orderMap?.get(b?.productoId) ?? fallback;
  if (ai !== bi) return ai - bi;

  // Elementos legacy/sin producto conocido: orden estable y predecible.
  const ac = String(a?.cat || '');
  const bc = String(b?.cat || '');
  const catCmp = ac.localeCompare(bc, 'es', { numeric:true, sensitivity:'base' });
  if (catCmp !== 0) return catCmp;

  const an = String(a?.nombre || '');
  const bn = String(b?.nombre || '');
  const nameCmp = an.localeCompare(bn, 'es', { numeric:true, sensitivity:'base' });
  if (nameCmp !== 0) return nameCmp;

  return String(a?.id || '').localeCompare(String(b?.id || ''), 'es', { numeric:true, sensitivity:'base' });
}

export function sortEquipmentByCatalog(items, orderMap) {
  return [...(items || [])].sort((a,b)=>compareEquipmentByCatalog(a,b,orderMap));
}
