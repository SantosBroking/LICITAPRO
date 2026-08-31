// document_health.test.js — Node nativo (`node --test`), sin bundler.
// Ejecutar desde src/: `node --test lib/document_health.test.js`
// (o desde la raíz del repo: `node --test src/lib/document_health.test.js`
// -- Node resuelve el "type":"module" de src/package.json por directorio,
// sin afectar la raíz CommonJS de api//server/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDocumentHealth, SEVERIDAD } from './document_health.js';

function proyectoBase(overrides) {
  return {
    id: 'proj-test',
    status: 'prospecto',
    docs: [],
    cotizacion: {},
    ordenesCompra: [],
    ...overrides,
  };
}

test('proyecto en prospecto sin nada capturado: solo "bases" aplica, y en INFO (no PENDIENTE/CRITICO)', () => {
  const health = computeDocumentHealth(proyectoBase({ status: 'prospecto' }));
  const bases = health.items.find(i => i.key === 'bases');
  assert.equal(bases.aplica, true);
  assert.equal(bases.presente, false);
  assert.equal(bases.severidad, SEVERIDAD.INFO);
  // El resto de renglones (propuesta, fallo, contrato, OC, facturación,
  // entrega, cobro) todavía no aplican en 'prospecto'.
  health.items.filter(i => i.key !== 'bases').forEach(i => assert.equal(i.aplica, false, i.key));
});

test('documento presente nunca genera severidad, sin importar el rank del estatus', () => {
  const health = computeDocumentHealth(proyectoBase({
    status: 'cobrado',
    docs: [{ category: 'Bases' }],
  }));
  const bases = health.items.find(i => i.key === 'bases');
  assert.equal(bases.presente, true);
  assert.equal(bases.severidad, null);
});

test('estatus "perdida" limita toda severidad a INFO, aunque el rank histórico fuera avanzado', () => {
  const health = computeDocumentHealth(proyectoBase({ status: 'perdida' }));
  health.pendientes.forEach(p => assert.equal(p.severidad, SEVERIDAD.INFO));
  assert.equal(health.resumen.CRITICO, 0);
  assert.equal(health.resumen.PENDIENTE, 0);
});

test('estatus "cancelada" limita toda severidad a INFO', () => {
  const health = computeDocumentHealth(proyectoBase({ status: 'cancelada' }));
  health.pendientes.forEach(p => assert.equal(p.severidad, SEVERIDAD.INFO));
  assert.equal(health.resumen.CRITICO, 0);
});

test('nunca modifica el objeto project de entrada (sin mutación)', () => {
  const project = proyectoBase({ status: 'contrato' });
  const antes = JSON.stringify(project);
  computeDocumentHealth(project);
  assert.equal(JSON.stringify(project), antes);
});

test('orden de pendientes: CRITICO antes que PENDIENTE antes que INFO', () => {
  const health = computeDocumentHealth(proyectoBase({ status: 'cobrado' }));
  const severidades = health.pendientes.map(p => p.severidad);
  const rank = { CRITICO: 0, PENDIENTE: 1, INFO: 2 };
  for (let i = 1; i < severidades.length; i++) {
    assert.ok(rank[severidades[i]] >= rank[severidades[i - 1]]);
  }
});

// ── Caso de aceptación explícito de la misión GO-LIVE-02 (corregido en v2
// por Control Tower contra el dato productivo real): proyecto "Patrullas
// Chimalhuacán" (MCHI/FORTA/LPN/030/2026), estatus operativo 'cobrado',
// CON 7 órdenes de compra reales registradas en project.ordenesCompra[]
// (aquí representadas con una sola OC, ya que la señal del motor es
// length > 0 -- no hace falta reproducir las 7), bases presentes y
// cotización/propuesta capturada, pero SIN evidencia documental
// localizada en LicitaPro de fallo/contrato/facturación de venta/entrega/
// cobro. Debe: (a) NUNCA tocar project.status (el motor es de solo
// lectura); (b) mostrar el estatus operativo COBRADO como distinto de la
// salud documental, que debe salir INCOMPLETA con 5 hallazgos CRITICO. ──
test('Chimalhuacán: estatus operativo COBRADO, 7 OCs reales, documentación INCOMPLETA (5 CRITICO) sin alterar el status', () => {
  const chimalhuacan = proyectoBase({
    id: 'proj-chimalhuacan',
    name: 'Patrullas Chimalhuacán',
    numLicitacion: 'MCHI/FORTA/LPN/030/2026',
    status: 'cobrado',
    tipoOperacion: 'Licitación pública',
    docs: [{ category: 'Bases' }],
    cotizacion: { partidas: [{ activo: true, cantidad: 5 }] },
    // Dato productivo real confirmado por Control Tower: 7 OCs registradas.
    // La señal del motor (ordenes_compra.detectar) es (ordenesCompra||[]).length>0
    // -- una sola OC representativa basta para probar esa señal; no se
    // requiere reconstruir las 7 completas.
    ordenesCompra: [{ id: 'oc-1', folio: 'OC-001', partidas: [] }],
  });
  const statusAntes = chimalhuacan.status;

  const health = computeDocumentHealth(chimalhuacan);

  // El motor nunca toca el estatus operativo -- documental e operativo son
  // conceptos separados a propósito.
  assert.equal(chimalhuacan.status, statusAntes);

  assert.equal(health.total, 8); // en 'cobrado' (rank más alto no-final), los 8 renglones aplican
  assert.equal(health.completos, 3); // bases (doc) + propuesta (cotización) + órdenes de compra (7 OCs reales -> length>0)
  assert.ok(health.completos < health.total, 'la documentación debe salir INCOMPLETA, no completa');

  const porKey = Object.fromEntries(health.items.map(i => [i.key, i]));
  assert.equal(porKey.bases.presente, true);
  assert.equal(porKey.propuesta.presente, true);
  assert.equal(porKey.ordenes_compra.presente, true);
  ['fallo', 'contrato', 'facturacion', 'entrega', 'cobro'].forEach(key => {
    assert.equal(porKey[key].presente, false, key);
    assert.equal(porKey[key].severidad, SEVERIDAD.CRITICO, key);
  });
  assert.equal(health.resumen.CRITICO, 5);
});

// ── CORRECCIÓN 3: venta privada no debe exigir Bases ni Fallo (no existen
// en ese modelo), pero sigue exigiendo Propuesta/OC/Facturación/Entrega/
// Cobro según la etapa -- mismo motor, sin requisitos inventados. ──
test('venta privada: Bases y Fallo nunca aplican; el resto de renglones sigue la misma matriz', () => {
  const ventaPrivada = proyectoBase({
    status: 'cobrado',
    tipoOperacion: 'Venta privada',
  });
  const health = computeDocumentHealth(ventaPrivada);
  const porKey = Object.fromEntries(health.items.map(i => [i.key, i]));

  assert.equal(porKey.bases.aplica, false);
  assert.equal(porKey.bases.severidad, null);
  assert.equal(porKey.fallo.aplica, false);
  assert.equal(porKey.fallo.severidad, null);

  // Contrato/OC/Facturación/Entrega/Cobro/Propuesta siguen aplicando igual
  // que en un procedimiento público al mismo rank -- sin cambio de criterio.
  ['propuesta', 'contrato', 'ordenes_compra', 'facturacion', 'entrega', 'cobro'].forEach(key => {
    assert.equal(porKey[key].aplica, true, key);
  });
  assert.equal(health.total, 6); // 8 renglones - bases - fallo
});
