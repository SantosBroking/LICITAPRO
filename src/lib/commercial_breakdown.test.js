import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommercialBreakdown, validateCommercialBreakdown,
  sanitizeCommercialBreakdownForStorage, moneyToCentsNumber,
} from './commercial_breakdown.js';

const baseCot = () => ({
  partidas:[{id:'P1',activo:true,cantidad:1,marca:'Ford',modelo:'Explorer',version:'Police Interceptor',ano:2025}],
  equipo:[
    {id:'E1',nombre:'Equipo A',usar:true,vis:true,cnts:[1],costoConIVA:10000,llevaIVA:true},
    {id:'E2',nombre:'Equipo B',usar:true,vis:true,cnts:[1],costoConIVA:30000,llevaIVA:true},
  ],
  servicios:[],
});

test('decimal a centavos evita multiplicación monetaria flotante', () => {
  assert.equal(moneyToCentsNumber('1070000.005'), 107000001);
  assert.equal(moneyToCentsNumber('0.1'), 10);
  assert.equal(moneyToCentsNumber(870000), 87000000);
});

test('caso objetivo 1,070,000 = 870,000 vehículo + 200,000 equipo', () => {
  const cot=baseCot();
  cot.desgloseComercial={vehiclePricesByPartCents:{P1:87000000}};
  const r=buildCommercialBreakdown(cot,1070000);
  assert.equal(r.ok,true);
  assert.equal(r.allocation.totalWithTaxCents,107000000);
  assert.equal(r.allocation.vehicleWithTaxCents,87000000);
  assert.equal(r.allocation.equipmentWithTaxCents,20000000);
  assert.equal(r.allocation.lines.reduce((a,l)=>a+l.grossCents,0),20000000);
  assert.equal(r.allocation.lines[0].grossCents,5000000);
  assert.equal(r.allocation.lines[1].grossCents,15000000);
  assert.equal(r.allocation.subtotalCents+r.allocation.taxCents,107000000);
});

test('bloquea costo faltante o cero', () => {
  const cot=baseCot(); cot.equipo[1].costoConIVA=0;
  cot.desgloseComercial={vehiclePricesByPartCents:{P1:87000000}};
  const r=buildCommercialBreakdown(cot,1070000);
  assert.equal(r.ok,false);
  assert.equal(r.missingCosts.length,1);
  assert.match(r.errors.join(' '),/costo faltante/i);
});

test('redondeo proporcional es determinístico y conserva centavos', () => {
  const cot=baseCot();
  cot.equipo=[
    {id:'A',nombre:'A',usar:true,vis:true,cnts:[1],costoConIVA:1,llevaIVA:true},
    {id:'B',nombre:'B',usar:true,vis:true,cnts:[1],costoConIVA:1,llevaIVA:true},
    {id:'C',nombre:'C',usar:true,vis:true,cnts:[1],costoConIVA:1,llevaIVA:true},
  ];
  cot.desgloseComercial={vehiclePricesByPartCents:{P1:10000}};
  const r=buildCommercialBreakdown(cot,'100.01');
  assert.equal(r.ok,true);
  assert.deepEqual(r.allocation.lines.map(x=>x.grossCents),[1,0,0]);
  assert.equal(r.allocation.lines.reduce((a,l)=>a+l.grossCents,0),1);
});

test('cantidades múltiples ponderan el costo total del concepto', () => {
  const cot=baseCot();
  cot.partidas[0].cantidad=2;
  cot.equipo=[
    {id:'A',nombre:'A',usar:true,vis:true,cnts:[2],costoConIVA:100,llevaIVA:true},
    {id:'B',nombre:'B',usar:true,vis:true,cnts:[1],costoConIVA:100,llevaIVA:true},
  ];
  cot.desgloseComercial={vehiclePricesByPartCents:{P1:10000}};
  const r=buildCommercialBreakdown(cot,800);
  assert.equal(r.ok,true);
  assert.equal(r.allocation.lines[0].grossCents,40000);
  assert.equal(r.allocation.lines[1].grossCents,20000);
  assert.equal(r.allocation.lines[0].quantity,4);
  assert.equal(r.allocation.lines[1].quantity,2);
});

test('tratamiento fiscal mixto: IVA 16% y sin IVA', () => {
  const cot=baseCot();
  cot.equipo=[
    {id:'A',nombre:'Material',usar:true,vis:true,cnts:[1],costoConIVA:100,llevaIVA:true},
    {id:'B',nombre:'Mano obra',usar:true,vis:true,cnts:[1],costoConIVA:100,llevaIVA:false},
  ];
  cot.desgloseComercial={vehiclePricesByPartCents:{P1:11600}};
  const r=buildCommercialBreakdown(cot,316);
  assert.equal(r.ok,true);
  const taxable=r.allocation.lines.find(x=>x.sourceId==='A');
  const exempt=r.allocation.lines.find(x=>x.sourceId==='B');
  assert.equal(taxable.grossCents,10000);
  assert.equal(taxable.netCents,8621);
  assert.equal(taxable.taxCents,1379);
  assert.equal(exempt.netCents,10000);
  assert.equal(exempt.taxCents,0);
  assert.equal(r.allocation.subtotalCents+r.allocation.taxCents,r.allocation.totalWithTaxCents);
});

test('sanitización de storage elimina claves internas inventadas', () => {
  const clean=sanitizeCommercialBreakdownForStorage({
    enabled:true,vehiclePricesByPartCents:{P1:87000000},internalCost:123,
    allocation:{basisHash:'abc',totalWithTaxCents:107000000,vehicleWithTaxCents:87000000,equipmentWithTaxCents:20000000,
      subtotalCents:92241379,taxCents:14758621,secretMargin:0.3,vehicles:[],
      lines:[{key:'equipment:E1',sourceType:'equipment',sourceId:'E1',name:'X',quantity:1,taxable:true,taxRateBps:1600,
        grossCents:20000000,netCents:17241379,taxCents:2758621,unitGrossCents:20000000,unitNetCents:17241379,internalCostCents:1000}]}
  });
  assert.equal('internalCost' in clean,false);
  assert.equal('secretMargin' in clean.allocation,false);
  assert.equal('internalCostCents' in clean.allocation.lines[0],false);
});

test('validación detecta cambios posteriores y exige recalcular', () => {
  const cot=baseCot(); cot.desgloseComercial={enabled:true,vehiclePricesByPartCents:{P1:87000000}};
  const r=buildCommercialBreakdown(cot,1070000);
  cot.desgloseComercial={enabled:true,vehiclePricesByPartCents:{P1:87000000},allocation:r.allocation};
  assert.equal(validateCommercialBreakdown(cot,1070000).ok,true);
  cot.equipo[0].costoConIVA=11000;
  const v=validateCommercialBreakdown(cot,1070000);
  assert.equal(v.ok,false);
  assert.match(v.errors.join(' '),/recalcula/i);
});
