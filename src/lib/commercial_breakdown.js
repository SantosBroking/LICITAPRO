// Desglose comercial proporcional de cotización.
// Toda la aritmética monetaria se realiza con BigInt en centavos.

export const COMMERCIAL_BREAKDOWN_VERSION = 1;
export const IVA_BPS = 1600;
const BPS = 10000n;
const QUANTITY_SCALE = 10000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function pow10(n) {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= 10n;
  return r;
}

function parseScaled(value, scaleDigits) {
  if (typeof value === 'bigint') return value * pow10(scaleDigits);
  if (value == null || value === '') return 0n;
  const s = String(value).trim();
  const m = s.match(/^([+-])?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!m) throw new Error(`Valor numérico inválido: ${s}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] || '0';
  const frac = m[3] || '';
  const exp = Number(m[4] || 0);
  if (!Number.isInteger(exp) || Math.abs(exp) > 100) throw new Error(`Exponente fuera de rango: ${s}`);
  const digits = BigInt((whole + frac).replace(/^0+(?=\d)/, '') || '0');
  const decimalPlaces = frac.length - exp;
  let scaled;
  if (decimalPlaces <= scaleDigits) {
    scaled = digits * pow10(scaleDigits - decimalPlaces);
  } else {
    const divisor = pow10(decimalPlaces - scaleDigits);
    const q = digits / divisor;
    const r = digits % divisor;
    scaled = q + (r * 2n >= divisor ? 1n : 0n);
  }
  return sign * scaled;
}

export function moneyToCentsBigInt(value) { return parseScaled(value, 2); }
export function moneyToCentsNumber(value) { return safeNumber(moneyToCentsBigInt(value)); }
function quantityToScaled(value) { return parseScaled(value, 4); }

function safeNumber(v) {
  if (v > MAX_SAFE || v < -MAX_SAFE) throw new Error('Importe fuera del rango seguro de JSON');
  return Number(v);
}

function roundDiv(n, d) {
  if (d <= 0n) throw new Error('Divisor inválido');
  if (n < 0n) return -roundDiv(-n, d);
  const q = n / d;
  const r = n % d;
  return q + (r * 2n >= d ? 1n : 0n);
}

function normalizeText(v, max = 160) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function activeParts(cot) {
  return (cot?.partidas || []).filter(p => p?.activo && Number(p?.cantidad || 0) > 0);
}

function partIndex(cot, part, fallbackIndex) {
  const n = parseInt(String(part?.id || '').replace('P', ''), 10);
  return Number.isInteger(n) && n > 0 ? n - 1 : fallbackIndex;
}

function equipmentQuantityScaled(cot, item) {
  const parts = activeParts(cot);
  if (parts.length === 0) return quantityToScaled(item?.cantidadGlobal || 0);
  let total = 0n;
  parts.forEach((p, idx) => {
    const pi = partIndex(cot, p, idx);
    const perVehicle = quantityToScaled(item?.cnts?.[pi] || 0);
    const vehicles = quantityToScaled(p?.cantidad || 0);
    total += roundDiv(perVehicle * vehicles, QUANTITY_SCALE);
  });
  return total;
}

function quantityScaledToNumber(v) { return Number(v) / Number(QUANTITY_SCALE); }
function lineKey(type, id) { return `${type}:${String(id || '')}`; }

export function collectCommercialCostLines(cot) {
  const lines = [];
  (cot?.equipo || []).forEach((e, i) => {
    if (!e?.usar || e?.vis === false) return;
    const qtyScaled = equipmentQuantityScaled(cot, e);
    if (qtyScaled <= 0n) return;
    let unitCostCents = 0n, parseError = null;
    try { unitCostCents = moneyToCentsBigInt(e?.costoConIVA || 0); } catch (err) { parseError = err.message; }
    const id = normalizeText(e?.id || e?.productoId || `eq-${i}`, 100);
    lines.push({
      key:lineKey('equipment', id), sourceType:'equipment', sourceId:id,
      name:normalizeText(e?.nombre || `Equipo ${i + 1}`),
      quantityScaled:qtyScaled, quantity:quantityScaledToNumber(qtyScaled),
      taxable:e?.llevaIVA !== false, taxRateBps:e?.llevaIVA === false ? 0 : IVA_BPS,
      unitInternalCostCents:unitCostCents, parseError,
    });
  });
  (cot?.servicios || []).forEach((s, i) => {
    if (!s?.usar) return;
    const qtyScaled = quantityToScaled(s?.cantidad || 0);
    if (qtyScaled <= 0n) return;
    let unitCostCents = 0n, parseError = null;
    try { unitCostCents = moneyToCentsBigInt(s?.costoUnitario || 0); } catch (err) { parseError = err.message; }
    const id = normalizeText(s?.id || `srv-${i}`, 100);
    lines.push({
      key:lineKey('service', id), sourceType:'service', sourceId:id,
      name:normalizeText(s?.nombre || `Servicio ${i + 1}`),
      quantityScaled:qtyScaled, quantity:quantityScaledToNumber(qtyScaled),
      taxable:s?.llevaIVA !== false, taxRateBps:s?.llevaIVA === false ? 0 : IVA_BPS,
      unitInternalCostCents:unitCostCents, parseError,
    });
  });
  return lines;
}

export function getMissingCommercialCosts(cot) {
  return collectCommercialCostLines(cot)
    .filter(l => l.parseError || l.unitInternalCostCents <= 0n)
    .map(l => ({ key:l.key, sourceType:l.sourceType, sourceId:l.sourceId, name:l.name, error:l.parseError || 'Costo faltante o igual a cero' }));
}

function vehicleRows(cot, vehiclePricesByPartCents = {}) {
  return activeParts(cot).map((p, idx) => {
    const qtyScaled = quantityToScaled(p?.cantidad || 0);
    const partId = normalizeText(p?.id || `P${idx + 1}`, 80);
    const raw = Number(vehiclePricesByPartCents?.[partId] || 0);
    const unitGrossCents = Number.isSafeInteger(raw) && raw >= 0 ? BigInt(raw) : 0n;
    return {
      partId,
      name:normalizeText([p?.marca,p?.modelo,p?.version,p?.ano].filter(Boolean).join(' ') || 'Vehículo'),
      quantityScaled:qtyScaled, quantity:quantityScaledToNumber(qtyScaled),
      unitGrossCents,
      totalGrossCents:roundDiv(unitGrossCents * qtyScaled, QUANTITY_SCALE),
      taxable:true, taxRateBps:IVA_BPS,
    };
  });
}

function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) { hash ^= BigInt(b); hash = (hash * prime) & mask; }
  return hash.toString(16).padStart(16, '0');
}

export function commercialBasisHash(cot) {
  return fnv1a64(collectCommercialCostLines(cot)
    .map(l => `${l.key}|${l.quantityScaled}|${l.unitInternalCostCents}|${l.taxRateBps}`)
    .sort().join('\n'));
}

function deriveTaxFromGross(grossCents, taxRateBps) {
  if (!taxRateBps) return { netCents:grossCents, taxCents:0n };
  const netCents = roundDiv(grossCents * BPS, BPS + BigInt(taxRateBps));
  return { netCents, taxCents:grossCents - netCents };
}

function allocateGrossProportionally(lines, targetGrossCents) {
  if (targetGrossCents < 0n) throw new Error('El importe comercial de equipamiento no puede ser negativo');
  const weighted = lines.map(l => ({ ...l, weight:roundDiv(l.unitInternalCostCents * l.quantityScaled, QUANTITY_SCALE) }));
  const totalWeight = weighted.reduce((a,l)=>a+l.weight,0n);
  if (weighted.length && totalWeight <= 0n) throw new Error('No existe una base de costos válida para distribuir');
  if (!weighted.length) {
    if (targetGrossCents !== 0n) throw new Error('Hay importe comercial de equipamiento pero no existen conceptos visibles con cantidad');
    return [];
  }
  const provisional = weighted.map(l => {
    const numerator = targetGrossCents * l.weight;
    return { ...l, gross:numerator/totalWeight, remainder:numerator%totalWeight };
  });
  let remaining = targetGrossCents - provisional.reduce((a,l)=>a+l.gross,0n);
  const order = [...provisional].sort((a,b)=>a.remainder===b.remainder ? a.key.localeCompare(b.key) : (a.remainder>b.remainder?-1:1));
  for (let i=0; remaining>0n; i++,remaining--) order[i%order.length].gross += 1n;
  const grossByKey = new Map(order.map(l=>[l.key,l.gross]));
  return provisional.map(l => {
    const grossCents = grossByKey.get(l.key) ?? l.gross;
    const {netCents,taxCents}=deriveTaxFromGross(grossCents,l.taxRateBps);
    const unitGrossCents=l.quantityScaled>0n?roundDiv(grossCents*QUANTITY_SCALE,l.quantityScaled):0n;
    const unitNetCents=l.quantityScaled>0n?roundDiv(netCents*QUANTITY_SCALE,l.quantityScaled):0n;
    return {
      key:l.key,sourceType:l.sourceType,sourceId:l.sourceId,name:l.name,quantity:l.quantity,
      taxable:l.taxable,taxRateBps:l.taxRateBps,
      grossCents:safeNumber(grossCents),netCents:safeNumber(netCents),taxCents:safeNumber(taxCents),
      unitGrossCents:safeNumber(unitGrossCents),unitNetCents:safeNumber(unitNetCents),
    };
  });
}

export function buildCommercialBreakdown(cot, totalWithTax, vehiclePricesByPartCents) {
  const errors=[];
  let totalGrossCents;
  try { totalGrossCents=moneyToCentsBigInt(totalWithTax); } catch(e) { return {ok:false,errors:[e.message],missingCosts:[]}; }
  if (totalGrossCents<=0n) errors.push('El total de la cotización debe ser mayor a cero');
  const cfg=vehiclePricesByPartCents || cot?.desgloseComercial?.vehiclePricesByPartCents || {};
  const vehicles=vehicleRows(cot,cfg);
  vehicles.forEach(v=>{if(v.unitGrossCents<=0n) errors.push(`Falta el precio comercial c/IVA de ${v.partId}`);});
  const vehicleGrossCents=vehicles.reduce((a,v)=>a+v.totalGrossCents,0n);
  const equipmentGrossCents=totalGrossCents-vehicleGrossCents;
  if(equipmentGrossCents<0n) errors.push('El precio comercial de los vehículos supera el total de la cotización');
  const missingCosts=getMissingCommercialCosts(cot);
  if(missingCosts.length) errors.push(`Hay ${missingCosts.length} concepto(s) comercial(es) con costo faltante o igual a cero`);
  const totals={totalWithTaxCents:safeNumber(totalGrossCents),vehicleWithTaxCents:safeNumber(vehicleGrossCents),equipmentWithTaxCents:safeNumber(equipmentGrossCents)};
  if(errors.length) return {ok:false,errors,missingCosts,totals};
  let lines;
  try { lines=allocateGrossProportionally(collectCommercialCostLines(cot),equipmentGrossCents); }
  catch(e) { return {ok:false,errors:[e.message],missingCosts,totals}; }
  const vehiclePublic=vehicles.map(v=>{
    const t=deriveTaxFromGross(v.totalGrossCents,v.taxRateBps);
    const u=deriveTaxFromGross(v.unitGrossCents,v.taxRateBps);
    return {partId:v.partId,name:v.name,quantity:v.quantity,taxable:true,taxRateBps:IVA_BPS,
      grossCents:safeNumber(v.totalGrossCents),netCents:safeNumber(t.netCents),taxCents:safeNumber(t.taxCents),
      unitGrossCents:safeNumber(v.unitGrossCents),unitNetCents:safeNumber(u.netCents)};
  });
  const subtotal=vehiclePublic.reduce((a,v)=>a+BigInt(v.netCents),0n)+lines.reduce((a,l)=>a+BigInt(l.netCents),0n);
  const tax=vehiclePublic.reduce((a,v)=>a+BigInt(v.taxCents),0n)+lines.reduce((a,l)=>a+BigInt(l.taxCents),0n);
  if(subtotal+tax!==totalGrossCents) throw new Error('Error interno: el desglose no reconcilia con el total');
  return {ok:true,errors:[],missingCosts:[],allocation:{
    basisHash:commercialBasisHash(cot),totalWithTaxCents:safeNumber(totalGrossCents),
    vehicleWithTaxCents:safeNumber(vehicleGrossCents),equipmentWithTaxCents:safeNumber(equipmentGrossCents),
    subtotalCents:safeNumber(subtotal),taxCents:safeNumber(tax),generatedAt:new Date().toISOString(),
    vehicles:vehiclePublic,lines,
  }};
}

function safeInteger(v,min=0,max=Number.MAX_SAFE_INTEGER) {
  const n=Number(v); return Number.isSafeInteger(n)&&n>=min&&n<=max?n:0;
}

export function sanitizeCommercialBreakdownForStorage(value) {
  const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const vehiclePricesByPartCents={};
  if(v.vehiclePricesByPartCents&&typeof v.vehiclePricesByPartCents==='object'&&!Array.isArray(v.vehiclePricesByPartCents)){
    Object.entries(v.vehiclePricesByPartCents).forEach(([k,val])=>{const key=normalizeText(k,80);if(key)vehiclePricesByPartCents[key]=safeInteger(val);});
  }
  let allocation=null;
  const a=v.allocation;
  if(a&&typeof a==='object'&&!Array.isArray(a)){
    const lines=Array.isArray(a.lines)?a.lines.slice(0,500).map(l=>({
      key:normalizeText(l?.key,180),sourceType:l?.sourceType==='service'?'service':'equipment',
      sourceId:normalizeText(l?.sourceId,120),name:normalizeText(l?.name,180),quantity:Number(l?.quantity||0),
      taxable:!!l?.taxable,taxRateBps:safeInteger(l?.taxRateBps,0,10000),
      grossCents:safeInteger(l?.grossCents),netCents:safeInteger(l?.netCents),taxCents:safeInteger(l?.taxCents),
      unitGrossCents:safeInteger(l?.unitGrossCents),unitNetCents:safeInteger(l?.unitNetCents),
    })).filter(l=>l.key&&l.sourceId&&Number.isFinite(l.quantity)&&l.quantity>=0):[];
    const vehicles=Array.isArray(a.vehicles)?a.vehicles.slice(0,100).map(x=>({
      partId:normalizeText(x?.partId,80),name:normalizeText(x?.name,180),quantity:Number(x?.quantity||0),
      taxable:true,taxRateBps:IVA_BPS,grossCents:safeInteger(x?.grossCents),netCents:safeInteger(x?.netCents),
      taxCents:safeInteger(x?.taxCents),unitGrossCents:safeInteger(x?.unitGrossCents),unitNetCents:safeInteger(x?.unitNetCents),
    })).filter(x=>x.partId&&Number.isFinite(x.quantity)&&x.quantity>=0):[];
    allocation={basisHash:normalizeText(a.basisHash,64),totalWithTaxCents:safeInteger(a.totalWithTaxCents),
      vehicleWithTaxCents:safeInteger(a.vehicleWithTaxCents),equipmentWithTaxCents:safeInteger(a.equipmentWithTaxCents),
      subtotalCents:safeInteger(a.subtotalCents),taxCents:safeInteger(a.taxCents),generatedAt:normalizeText(a.generatedAt,40),vehicles,lines};
  }
  return {version:COMMERCIAL_BREAKDOWN_VERSION,enabled:v.enabled===true,vehiclePricesByPartCents,allocation};
}

export function validateCommercialBreakdown(cot,totalWithTax) {
  const cfg=sanitizeCommercialBreakdownForStorage(cot?.desgloseComercial);
  if(!cfg.enabled) return {ok:true,enabled:false,config:cfg,errors:[],missingCosts:[]};
  const missingCosts=getMissingCommercialCosts(cot),errors=[];
  if(!cfg.allocation) errors.push('Falta calcular la distribución proporcional');
  let totalCents=0;
  try{totalCents=moneyToCentsNumber(totalWithTax);}catch(e){errors.push(e.message);}
  if(cfg.allocation){
    if(cfg.allocation.basisHash!==commercialBasisHash(cot)) errors.push('Los costos, cantidades o tratamiento fiscal cambiaron; recalcula el desglose');
    if(cfg.allocation.totalWithTaxCents!==totalCents) errors.push('El total de la cotización cambió; recalcula el desglose');
    const vehicleTotal=safeNumber(vehicleRows(cot,cfg.vehiclePricesByPartCents).reduce((a,v)=>a+v.totalGrossCents,0n));
    if(cfg.allocation.vehicleWithTaxCents!==vehicleTotal) errors.push('El precio comercial del vehículo cambió; recalcula el desglose');
    const grossLines=(cfg.allocation.lines||[]).reduce((a,l)=>a+safeInteger(l.grossCents),0);
    const grossVehicles=(cfg.allocation.vehicles||[]).reduce((a,l)=>a+safeInteger(l.grossCents),0);
    if(grossLines+grossVehicles!==cfg.allocation.totalWithTaxCents) errors.push('El desglose guardado no reconcilia con su total');
    if(cfg.allocation.subtotalCents+cfg.allocation.taxCents!==cfg.allocation.totalWithTaxCents) errors.push('Subtotal e IVA del desglose no reconcilian con su total');
  }
  if(missingCosts.length) errors.push(`Hay ${missingCosts.length} concepto(s) con costo faltante o igual a cero`);
  return {ok:errors.length===0,enabled:true,config:cfg,allocation:cfg.allocation,errors,missingCosts};
}
