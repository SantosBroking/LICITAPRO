# Protocolo de trabajo — Claude en LicitaPro

> Este documento describe CÓMO se trabaja en LicitaPro, no QUÉ se construye. Para el qué, ver `ROADMAP_LICITAPRO.md`. Para las reglas de negocio y permisos, ver `MANUAL_MAESTRO_LICITAPRO.md`.

---

## 1. Cómo iniciar una fase

Antes de escribir una sola línea de código:

1. **Confirmar el modelo recomendado** para esta fase específica (ver sección 8 de este documento). Si el usuario no lo especificó, proponerlo.
2. **Confirmar `main` local y `origin/main`** están en el hash esperado. Si no coinciden, detenerse y reportarlo — nunca asumir.
3. **Confirmar working tree limpio** (`git status --short` vacío). Si hay cambios sin confirmar inesperados, investigarlos antes de continuar — nunca descartarlos ni confiarlos a ciegas.
4. **Confirmar el conteo de funciones de Vercel** (`find api -maxdepth 1 -name "*.js" | wc -l`) contra lo esperado.
5. **Crear una rama nueva** desde `main` (o desde la rama de trabajo vigente, si la fase es continuación directa de una rama abierta — justificando por qué).
6. **Leer el alcance explícito**: qué archivos están permitidos, cuáles están prohibidos, qué reglas de negocio no se pueden tocar.

## 2. Cómo diagnosticar

- El diagnóstico va **antes** de programar, siempre.
- Diagnosticar significa **leer el código real** (`grep`, `view`, `sed -n`) — nunca asumir cómo funciona algo por el nombre de una función o el mensaje de un commit anterior.
- Si el pedido presupone algo que el código no confirma (p. ej. "la segunda tabla de partidas" cuando en realidad es otra cosa), **decirlo explícitamente** antes de implementar sobre una premisa incorrecta.
- Si el diagnóstico revela un hallazgo de seguridad relevante (p. ej. que un rol no puede escribir cierto campo), ese hallazgo **determina el diseño** de la solución, no al revés.

## 3. Cómo implementar

- Cambios **mínimos y quirúrgicos** para el objetivo pedido — no aprovechar para "mejorar" cosas fuera de alcance sin autorización.
- Reutilizar handlers y lógica existente siempre que sea posible — nunca duplicar cálculos.
- Si se detecta un bug propio durante la implementación (p. ej. una variable que no existe, un riesgo de TDZ, una condición mal invertida), **corregirlo y documentarlo explícitamente** en el commit — no ocultarlo ni dejarlo pasar.
- Validar sintaxis (`node --check`) de todo archivo tocado antes de dar por terminada la implementación.
- Nunca dejar imports o variables sin uso.

## 4. Cómo probar

Antes de reportar cualquier entrega:

- **Regresión obligatoria**: si la fase toca cotización, órdenes de compra, o cualquier módulo con motor de cálculo, correr pruebas numéricas contra los valores de referencia conocidos — no basta con "no truena".
- **Seguridad obligatoria**: correr el scanner de campos estratégicos (`utilidad`, `margen`, `montoGanar`, `flujo`, `corrida`, `project_financials`, `facturaIntermedia`, `facturaGobierno`, `ocSettings`) contra el rol `empleado` y confirmar que siguen en 0.
- **Alcance obligatorio**: `git diff` contra `main` de los archivos explícitamente prohibidos para esa fase, confirmando 0 líneas.
- **Conteo de funciones**: confirmar que sigue dentro del límite acordado para la fase.
- Ser honesto sobre lo que **no** se pudo probar (p. ej. validación visual real en navegador/teléfono, que este entorno no permite) — nunca reportar como "confirmado visualmente" algo que solo se validó por evidencia de código.

## 5. Cómo entregar

Formato obligatorio de entrega, en este orden:

1. Diagnóstico breve (o confirmación de que ya se hizo en un turno anterior).
2. Solución/estrategia implementada.
3. Archivos tocados (lista exacta).
4. Diff breve (qué cambió, no el diff completo salvo que se pida).
5. Commit (hash + mensaje).
6. Conteo de funciones.
7. Pruebas realizadas (con resultados concretos, no solo "OK").
8. Preview URL.
9. Deployment Ready/Error.
10. Confirmación explícita de las restricciones de la fase (no SQL / no RLS / no endpoints / lo que aplique).
11. Riesgos pendientes — honestos, no minimizados.
12. Rollback preparado (comando exacto, no ejecutado).

## 6. Cómo hacer merge

**Nunca sin autorización explícita.** Cuando el usuario autoriza:

1. Confirmar `main` local y `origin/main` en el hash esperado.
2. Confirmar que la rama contiene exactamente los commits esperados, en el orden esperado.
3. Confirmar archivos tocados y conteo de funciones.
4. Confirmar que los archivos prohibidos siguen en 0 líneas de diff.
5. Re-correr la batería completa de pruebas contra el código real de la rama (no contra memoria de un turno anterior).
6. Restaurar `main` a un working tree limpio.
7. Merge **fast-forward only** (`git merge --ff-only`) — nunca merge commit ni squash salvo instrucción explícita.
8. Push a `origin/main`.
9. Confirmar deployment de producción `Ready`.
10. Reportar: hash final de `main`, archivos incluidos, commits incluidos, confirmación de push, conteo final de funciones, deployment Ready, URL de producción, rollback listo.

## 7. Qué nunca hacer

- Nunca mergear ni hacer push a `main` sin autorización explícita en ese mismo turno.
- Nunca tocar SQL, RLS o Storage sin que sea el objetivo explícito de la fase.
- Nunca ejecutar SQL directamente — Santiago lo ejecuta él mismo en el SQL Editor de Supabase; Claude solo propone el SQL exacto.
- Nunca asumir que `purchase_orders` existe o está en uso sin verificarlo.
- Nunca revivir el módulo global de Órdenes de Compra sin autorización.
- Nunca exponer finanzas estratégicas a `empleado`, bajo ninguna forma (UI, PDF, agente, exportación).
- Nunca inventar datos reales (proveedores, costos, documentos, bases) — si falta información, preguntar.
- Nunca declarar una prueba visual como "confirmada" si solo se validó por evidencia de código.
- Nunca reescribir código de una fase anterior sin necesidad — si algo ya está resuelto, decirlo, no rehacerlo.
- Nunca usar "MSMS" como texto visible al usuario final.

## 8. Recomendación obligatoria de modelos por fase

Toda fase nueva debe declarar, al inicio de la respuesta:

```
Modelo recomendado:
- ChatGPT: [modelo específico]
- Claude: [modelo específico]
- Razón: [1-2 líneas]
- Cómo ahorrar tokens: [estrategia concreta — p. ej. "reutilizar diagnóstico ya hecho en el turno anterior", "no releer archivos ya confirmados sin cambios", "usar Haiku para el resumen final"]
```

Criterio:

| Modelo | Uso típico en LicitaPro |
|---|---|
| Claude Sonnet | Fases de programación estándar, UX/UI, documentación |
| Claude Opus | SQL/RLS, permisos, refactors grandes, decisiones de arquitectura |
| Claude Haiku | Resúmenes, clasificación, extracción simple |
| ChatGPT GPT-5.5 Thinking | Estrategia, auditoría, prompts maestros |
| Modelo rápido/mini | Tareas triviales, resúmenes cortos |
