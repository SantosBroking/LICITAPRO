# Agentes — LicitaPro

> Diseño de los agentes de IA que operarán dentro o alrededor de LicitaPro. Ninguno tiene implementación técnica todavía (ver `ROADMAP_LICITAPRO.md`). Este documento es la base de diseño y las reglas que deberá respetar cada uno cuando se construya.

---

## 1. Mapa de agentes y orden de construcción

| # | Agente | Rol resumido |
|---|---|---|
| 1 | **Asistente Operativo** | Responde preguntas sobre proyectos, OCs, facturas, proveedores, costos históricos y pendientes |
| 2 | **Analista de Lógica del Sistema** | Detecta inconsistencias del sistema y propone cambios — nunca programa |
| 3 | **Programador UX/UI** | Implementa los cambios de interfaz propuestos por el Analista — en rama, nunca en producción sin autorización |
| 4 | **Agente de Catálogo Visual** | Estandariza imágenes de producto para el catálogo |
| 5 | **Asistente Documental** | Ordena, renombra y clasifica documentos/facturas; conecta con Drive |

El orden refleja la prioridad de construcción: el Asistente Operativo es el más directamente útil para la operación diaria (responder preguntas reales sobre proyectos y costos), mientras que Catálogo Visual y Asistente Documental dependen de que exista primero una base de datos/documentos bien organizada.

---

## 2. Asistente Operativo

**Rol:** responde preguntas en lenguaje natural sobre el estado operativo y financiero histórico del sistema.

**Ejemplos de uso real:**
- "¿Cuál es el promedio de precio de tumbaburros SUV que hemos comprado?"
- "Dame la factura de tal unidad del proyecto Chimalhuacán."
- "¿Qué proyectos tienen OCs pendientes de firma?"

**Acciones permitidas:**
- Leer proyectos, cotizaciones, órdenes de compra, catálogo, documentos y facturas.
- Calcular agregados (promedios, totales, conteos) sobre datos históricos.
- Responder en lenguaje natural con datos reales del sistema.

**Acciones prohibidas:**
- Escribir o modificar cualquier dato.
- Mostrar finanzas estratégicas (`utilidad`, `margen`, `montoGanar`, `corrida`, `flujo`, `project_financials`) a un usuario sin permiso — el agente **hereda el rol del usuario que pregunta**, nunca actúa con permisos propios superiores.
- Inventar cifras si el dato no existe en el sistema — debe decir explícitamente que no tiene esa información.

**Aprobación humana necesaria:** ninguna para consultas de lectura. Si en el futuro se le da capacidad de acción (crear recordatorio, marcar pendiente), esa acción específica requiere aprobación explícita del usuario en el momento.

---

## 3. Analista de Lógica del Sistema

**Rol:** revisa el sistema (flujos, datos, UX) y detecta cosas que no tienen sentido lógico o de negocio. Propone cambios.

**Acciones permitidas:**
- Leer código y documentación del sistema.
- Identificar inconsistencias (p. ej. un flujo que no lleva a ningún lado, un estado que nunca se limpia, una regla de negocio contradictoria).
- Redactar propuestas de cambio, con su razonamiento.

**Acciones prohibidas:**
- **Nunca programa.** No escribe ni modifica código de la aplicación.
- No decide unilateralmente implementar algo — siempre presenta la propuesta primero.

**Aprobación humana necesaria:** el Analista **se comunica con Santiago o el Director antes de recomendar implementación** — es decir, incluso la recomendación formal de pasar algo al Programador UX/UI requiere validación humana previa, no solo la implementación final.

---

## 4. Programador UX/UI

**Rol:** recibe propuestas ya validadas del Analista de Lógica y las implementa como cambios de interfaz.

**Acciones permitidas:**
- Trabajar en rama, siguiendo el protocolo de `CLAUDE_PROTOCOLO_TRABAJO.md`.
- Modificar `index.html` (CSS) y componentes de vista (`src/views/*.js`) dentro del alcance autorizado.
- Proponer y ejecutar pruebas de regresión antes de entregar.

**Acciones prohibidas:**
- **Nunca toca producción sin autorización** — ni merge ni push a `main` sin aprobación explícita en el turno correspondiente.
- No cambia lógica de negocio, cálculos, permisos ni sanitización salvo que sea el objetivo explícito y autorizado de la fase.
- No implementa cambios que el Analista de Lógica no haya propuesto y Santiago/Director no haya aprobado.

**Aprobación humana necesaria:** para cada merge a producción, siempre — sin excepción, tal como aplica hoy a Claude actuando como este mismo rol.

---

## 5. Agente de Catálogo Visual

**Rol:** recibe una imagen (o busca una referencia) de un producto y la estandariza para el catálogo de LicitaPro.

**Reglas de estandarización:**
- Fondo blanco.
- Producto centrado.
- Sombra suave.
- Sin texto sobre la imagen.
- Sin marcas de agua.
- Estilo catálogo profesional (consistente con el resto del catálogo).

**Acciones permitidas:**
- Procesar/generar la imagen estandarizada.
- Subir la imagen resultante al catálogo de productos.
- Dejar la imagen disponible para futuras cotizaciones.

**Acciones prohibidas:**
- No inventa productos ni especificaciones — solo procesa la imagen que se le da o la referencia que se le pide buscar.
- No sube nada al catálogo sin que quede claro a qué producto/SKU corresponde.
- No reemplaza una imagen existente sin confirmación.

**Aprobación humana necesaria:** revisión antes de publicar en el catálogo si el producto ya tenía una imagen previa (evitar sobreescrituras silenciosas).

---

## 6. Asistente Documental

**Rol:** sube, ordena, renombra y clasifica documentos y facturas dentro del ecosistema de LicitaPro + Google Drive.

**Acciones permitidas:**
- Recibir documentos/facturas subidos por el usuario.
- Detectar automáticamente: proyecto, proveedor, unidad y tipo de documento al que corresponde.
- Renombrar archivos según una convención consistente.
- Ordenar/mover archivos dentro de la estructura de Drive (ver `MANUAL_MAESTRO_LICITAPRO.md` sección 8).
- Dejar bitácora de cada acción (qué se subió, cuándo, a qué proyecto, quién lo hizo).

**Acciones prohibidas:**
- **No borra documentos ni proyectos sin confirmación explícita** (regla permanente #10 del Manual Maestro).
- No inventa la clasificación si no puede determinarla con confianza razonable — en ese caso, pregunta o deja el documento en una carpeta de "sin clasificar" con aviso al usuario.
- No mueve/renombra documentos ya clasificados sin que el usuario lo pida.

**Aprobación humana necesaria:** para cualquier acción destructiva (borrar, sobreescribir) — siempre. Para clasificación/organización de rutina, puede operar de forma más autónoma una vez validado su criterio.

---

## 7. Reglas transversales para todos los agentes

1. **Todo agente respeta el modelo de permisos** de `MANUAL_MAESTRO_LICITAPRO.md` — nunca hay un atajo que exponga finanzas estratégicas a un rol sin permiso, sin importar qué agente sea o qué tan "interno" parezca el flujo.
2. **Todo agente actúa con el permiso del usuario que lo invoca**, nunca con un permiso propio superior.
3. **Ningún agente toca producción sin autorización humana explícita**, salvo que se decida lo contrario en una fase futura y quede documentado aquí.
4. **Ningún agente inventa datos reales** — proveedores, costos, documentos, bases, especificaciones de producto. Si falta información, se pregunta.
5. **Toda acción de un agente debe quedar registrada** (trazabilidad), consistente con la regla permanente #14 del Manual Maestro.
