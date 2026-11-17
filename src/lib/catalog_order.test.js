import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogOrderMap, sortEquipmentByCatalog } from './catalog_order.js';

test('respeta el orden exacto del catálogo sin importar el orden de agregado', () => {
  const base=[
    {id:'01-A',cat:'01 Imagen',nom:'A'},
    {id:'01-B',cat:'01 Imagen',nom:'B'},
    {id:'02-C',cat:'02 Fierros',nom:'C'},
  ];
  const map=buildCatalogOrderMap(base,[]);
  const items=[
    {id:'x3',productoId:'02-C',cat:'02 Fierros',nombre:'C'},
    {id:'x2',productoId:'01-B',cat:'01 Imagen',nombre:'B'},
    {id:'x1',productoId:'01-A',cat:'01 Imagen',nombre:'A'},
  ];
  assert.deepEqual(sortEquipmentByCatalog(items,map).map(x=>x.productoId),['01-A','01-B','02-C']);
});

test('override personalizado conserva la posición base y nuevos van al final en su orden', () => {
  const base=[{id:'A'},{id:'B'}];
  const custom=[{id:'B',nom:'override B'},{id:'X'},{id:'Y'}];
  const map=buildCatalogOrderMap(base,custom);
  assert.equal(map.get('A'),0);
  assert.equal(map.get('B'),1);
  assert.equal(map.get('X'),2);
  assert.equal(map.get('Y'),3);
});

test('legacy desconocido queda después de catálogo con fallback determinista', () => {
  const map=buildCatalogOrderMap([{id:'A'}],[]);
  const items=[
    {id:'z',productoId:'legacy-z',cat:'03',nombre:'Z'},
    {id:'a',productoId:'A',cat:'01',nombre:'A'},
    {id:'b',productoId:'legacy-b',cat:'02',nombre:'B'},
  ];
  assert.deepEqual(sortEquipmentByCatalog(items,map).map(x=>x.id),['a','b','z']);
});
