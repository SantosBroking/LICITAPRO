# Roadmap — LicitaPro

> Estado vivo. Se actualiza al cerrar cada fase relevante. No sustituye a `DECISIONES_LICITAPRO.md`, que lleva el detalle de qué ya se decidió y qué sigue abierto.

---

## 1. Fases actuales

| Fase | Estado | Rama |
|---|---|---|
| SYS-0 — Manual maestro y sistema de trabajo | ✅ **Completada, mergeada en producción** | `sys0-manual-maestro-licitapro` |
| 3I-2 — Operación con estados de OC + UX móvil profunda | ✅ **Completada, mergeada en producción**, validada visualmente en dispositivo real | `fase3i2-operacion-estados-oc-expediente` |

`main` en producción: `adc8053b0a148f4bffac48596722178a048f9661` — incluye el Centro de Control, Mesa de Ejecución, botón Exportar expediente (sin ZIP real), sistema de servicios formales, **modelo de estados operativos de OC** (requiere firma / solo expediente / cancelada) y la **reestructura móvil profunda** de Dashboard, Proyectos, Centro de Control, Operación/OC, modal de OC, Cotización y Cotización Operativa. Deployment: Ready.

## 2. Pendientes inmediatos

1. **DRIVE-0** — Diseño del ecosistema Google Drive (ver sección 5).
2. **AI-1** — Asistente Operativo de consulta interna (ver `AGENTES_LICITAPRO.md`).
3. **3I-3** — Resumen por proveedor dentro de Operación (quedó pendiente desde 3I-1).
4. **Exportación real de expediente** — ZIP y/o integración con Drive (el botón ya existe en el Centro de Control, pero sin implementación real, ver sección 4.1).
5. **Permitir a empleados cambiar ciertos estados de OC** (marcar enviada/archivada), si se decide — hoy es admin-only por diseño de `data_sanitize.js` (`ordenesCompra[]` no está en su allowlist de escritura para `empleado`); requiere su propia fase de seguridad con sanitización dedicada.

## 3. Evolución a corto plazo

- Definir el modelo real de "partida libre" en Órdenes de Compra (agregar una partida sin origen en la cotización) — evaluado y pospuesto en fases anteriores.
- Revisar Dashboard y Proyectos con foco en limpieza, estética y jerarquía (problema de lógica #9, ver `DECISIONES_LICITAPRO.md`).
- Clarificar el lugar de Servicios en el flujo completo de cotización → OC → expediente (problema de lógica #6).

## 4. Evolución a mediano plazo

### 4.1 Expediente auditable real

Hoy existe el botón "Exportar expediente" en el Centro de Control, pero **sin implementación real** — solo abre un aviso que redirige a la pestaña Expediente. Falta:

- Definir qué documentos entran al expediente final y en qué estructura.
- Decidir si el expediente se genera dentro de LicitaPro (ZIP) o se arma en Google Drive (ver sección 5).
- Evaluar el "paquete bancario" como un tipo de expediente con reglas propias (nunca implementado, siempre pospuesto por riesgo).

### 4.2 Bases y checklist

El checklist de bases actual no tiene fidelidad suficiente (problema de lógica #1). Camino probable: evolucionar hacia un **agente lector de bases** que extraiga requisitos automáticamente en vez de un checklist manual — ver Asistente Documental / Asistente Operativo en `AGENTES_LICITAPRO.md`.

### 4.3 Documentos y Drive

Hoy "Preguntas/documentos" vive dentro de LicitaPro sin conexión a un sistema de archivos real (problema de lógica #2 y #3). La dirección esperada es conectar con Google Drive, creando carpetas por proyecto siguiendo la estructura de `MANUAL_MAESTRO_LICITAPRO.md` sección 8.

### 4.4 Correo y comunicaciones

La vista previa de correo actual es útil pero pasiva (problema de lógica #4). A futuro, un agente podría redactar y preparar el envío. Relacionado con la posible evolución de Inbox hacia Gmail/tareas (problema de lógica #8).

### 4.5 Actividad reciente

No se entiende con claridad hoy (problema de lógica #5) — requiere una revisión de diseño antes de decidir si se mantiene, se rediseña o se elimina.

## 5. Google Drive

Ver estructura propuesta completa en `MANUAL_MAESTRO_LICITAPRO.md` sección 8. Estado: **decisión de arquitectura, no implementada**. Requiere:

1. Decidir el punto de integración técnico (¿Google Drive API vía backend? ¿vinculación manual de carpetas?).
2. Decidir quién crea la estructura de carpetas — automático al crear proyecto, o manual.
3. Decidir cómo se relaciona un documento de Drive con un registro dentro de LicitaPro (¿solo un link? ¿metadata sincronizada?).

## 6. Expediente auditable

Criterio de éxito (ver `MANUAL_MAESTRO_LICITAPRO.md` sección 10): al cierre de un proyecto, debe poder reconstruirse su expediente completo (bases, fallos, cotizaciones, OC, facturas de compra y venta, documentos legales, evidencia operativa) sin buscar nada fuera del sistema. Hoy esto es parcial — los documentos existen dentro del proyecto (`project.docs[]`) pero sin exportación real ni estructura auditable formal.

## 7. Agentes

Ver mapa completo, permisos y orden de construcción en `AGENTES_LICITAPRO.md`. Prioridad de construcción:

1. Asistente Operativo
2. Analista de Lógica del Sistema
3. Programador UX/UI
4. Agente de Catálogo Visual
5. Asistente Documental

Ninguno de los 5 agentes tiene implementación técnica todavía — este roadmap y `AGENTES_LICITAPRO.md` son la base de diseño antes de construir el primero.

## 8. Catálogo visual

Hoy el catálogo de productos (equipo/vehículos) depende de imágenes cargadas manualmente, sin estandarización. El Agente de Catálogo Visual (ver `AGENTES_LICITAPRO.md`) resolvería esto a futuro: fondo blanco, producto centrado, sombra suave, sin texto ni marcas de agua, estilo catálogo profesional — pero es trabajo de fase futura, no iniciado.
