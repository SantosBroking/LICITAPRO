// engine/test/testUtils.js
//
// Helper de comparación con tolerancia, per LP-ARCH-002 §E / LP-ENG-001 §11:
// 1e-6 relativo o 0.01 absoluto (lo que sea más permisivo), suficiente para
// absorber acumulación de error de punto flotante en operaciones encadenadas
// (ej. costo/1.16) sin enmascarar un error real de fórmula.

export function assertClose(actual, expected, label) {
  if (actual === null || expected === null) {
    if (actual !== expected) {
      throw new Error(`[${label}] esperado null/valor no coinciden: actual=${actual} expected=${expected}`);
    }
    return;
  }
  const absDiff = Math.abs(actual - expected);
  const relDiff = expected !== 0 ? absDiff / Math.abs(expected) : absDiff;
  const withinTolerance = relDiff <= 1e-6 || absDiff <= 0.01;
  if (!withinTolerance) {
    throw new Error(
      `[${label}] fuera de tolerancia: actual=${actual} expected=${expected} absDiff=${absDiff} relDiff=${relDiff}`
    );
  }
}
