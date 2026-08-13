# Decisiones — LicitaPro

> Registro vivo. Cada decisión arquitectónica o de negocio relevante debe quedar aquí para que futuras fases no la reabran sin saber que ya se discutió.

---

## 1. Decisiones ya tomadas

### Arquitectura y datos

- **`purchase_orders` (tabla en Supabase) existe pero no se usa.** Se creó, se verificó su estructura (22 columnas, RLS, políticas admin-only, `unique(user_id, folio)`), y se llegó a implementar un módulo global de Órdenes de Compra completo — pero se **descartó explícitamente**: no era útil como estaba, no debe aparecer en navegación ni home, y no debe revivirse sin autorización nueva.
- **El flujo principal de Órdenes de Compra es el legacy dentro de proyecto** (`project.ordenesCompra[]`), no un módulo global independiente. Se invirtió esfuerzo en mejorarlo (v2: OC mixta, partidas editables, listado mejorado) en vez de reintentar el módulo global.
- **No toda Orden de Compra requiere firma.** Se agregó el modelo de `requiereFirma` (booleano, default `true` por compatibilidad legacy) y `estadoOperativo` (derivado, no destructivo) para distinguir OCs que van a firma de las que solo quedan como soporte documental/expediente.
- **`ordenesCompra[]` es de escritura admin-only**, confirmado empíricamente en `data_sanitize.js` — un `empleado` no puede modificar el arreglo de OCs de un proyecto (se preserva del original). Esto determinó que las acciones de cambio de estado de OC en la UI sean admin-only.
- **Equipo sin vehículos es un caso real de negocio** (ej. Chimalhuacán: solo se vende equipamiento, no vehículos) — se implementó `cantidadGlobal` como alternativa a `cnts[]` (que depende de partidas de vehículo) para no forzar la existencia de vehículos "falsos" solo para poder capturar cantidad de equipo.
- **Servicios formales** (instalación, mantenimiento, configuración, capacitación, etc.) son un tipo de partida propio (`cot.servicios[]`), separado de equipo y de vehículos, con su propio motor de suma en `calc.js` — independiente del eje vehículo/equipo.
- **El motor financiero (`calc.js`) replica fórmulas exactas del Excel original** de la empresa — cualquier cambio ahí requiere prueba numérica exacta, no solo "no truena".

### Diseño y UX

- **Navegación uniforme sin íconos** — decisión visual explícita: todos los módulos del menú principal se muestran solo con texto, ningún ícono decorativo.
- **Sistema de diseño centralizado en `index.html`** — no hay archivos CSS sueltos ni librería de UI externa; todo el estilado vive en un único bloque `<style>`.
- **Mobile-first real, no CSS sobre desktop comprimido.** Se determinó, después de varias iteraciones fallidas, que compactar/agrandar el markup de escritorio no resuelve la UX móvil — hace falta **markup dedicado** (`.mobile-only` / `.desktop-only`) para las vistas más densas (Cotización, Operación/OC, modal de OC, Inbox).
- **La Corrida financiera (tabla admin-only de análisis) se queda con scroll horizontal controlado en móvil, no se convierte a tarjetas** — decisión explícita: su valor es comparar conceptos contra columnas lado a lado, y las tarjetas destruirían esa comparación.
- **El botón "Exportar expediente" existe en el Centro de Control desde ya**, aunque sin implementación real — abre un aviso que redirige a la pestaña Expediente. Es una señal de producto intencional, no un botón muerto.

### Seguridad

- Los campos estratégicos (`utilidad`, `margen`, `montoGanar`, `flujo`, `corrida`, `project_financials`, `facturaIntermedia`, `facturaGobierno`, `ocSettings`) **no existen como propiedades planas de `project`** en el modelo de datos real — viven anidados (`project.cotizacion.montoGanar`, a nivel vehículo, a nivel config) o son valores **calculados** por `calc.js` bajo demanda, nunca persistidos como campo plano. Cualquier prueba de seguridad debe usar la forma real de los datos, no una forma simplificada inventada.
- `condiciones` y `partidas[].precioUnit` dentro de una Orden de Compra son admin-only — mismo criterio replicado en cualquier nuevo modelo de OC que se proponga.

## 2. Decisiones pendientes

1. **¿Se abre escritura de `ordenesCompra[]` para `empleado`?** Hoy es admin-only por diseño. Si se quiere que Eduardo/Mauricio puedan marcar OCs como enviadas/archivadas sin pasar por un admin, requiere una fase de seguridad dedicada (nueva allowlist + función de sanitización propia para no dejar pasar `precioUnit`).
2. **¿Cómo se implementa el expediente auditable real?** ¿ZIP generado desde LicitaPro, o carpeta armada en Google Drive? Ver Roadmap sección 4.1.
3. **¿Cómo se integra Google Drive técnicamente?** API directa, vinculación manual, o algo intermedio.
4. **¿"Partida libre" en Órdenes de Compra?** — agregar una partida manual sin origen en la cotización. Evaluado varias veces, pospuesto por la complejidad de decidir dónde vive y cómo se reimprime.
5. **¿Evolución del checklist de bases hacia un agente lector?** Ver problema de lógica #1 abajo.

## 3. Problemas de lógica actuales

Registrados tal cual fueron señalados, pendientes de análisis y decisión de producto:

1. **Checklist de bases** no tiene fidelidad suficiente; probablemente debe evolucionar a un agente lector de bases.
2. **Preguntas/documentos** — falta definir si viven dentro de LicitaPro o se conectan con Drive.
3. **Documentos** probablemente deben conectarse con Drive, creando carpetas por proyecto.
4. **Vista previa de correo** es útil, pero a futuro un agente podría redactar y preparar el envío.
5. **Actividad reciente** no se entiende con claridad hoy.
6. **Servicios** existen como tipo de partida formal, pero falta claridad de su lugar completo en el flujo (cotización → OC → expediente).
7. **Agente Claude (dentro de Cotización)** no debe sentirse como una pestaña suelta; debe evolucionar hacia agentes con roles definidos (ver `AGENTES_LICITAPRO.md`).
8. **Inbox** podría conectarse con Gmail, o transformarse en un sistema de tareas/comunicaciones más amplio que solo firmas.
9. **Dashboard y Proyectos** necesitan mayor limpieza, estética y jerarquía visual.

## 4. Preguntas abiertas

- ¿El expediente auditable debe ser un export único al cierre del proyecto, o debe poder generarse/actualizarse en cualquier momento del ciclo de vida?
- ¿Los agentes (una vez construidos) deben vivir dentro de LicitaPro como módulo, o como una capa externa que consulta LicitaPro?
- ¿Qué tan automática debe ser la clasificación de documentos del Asistente Documental antes de requerir confirmación humana?
- ¿La estructura de Drive se crea automáticamente al crear un proyecto en LicitaPro, o es un paso manual separado?
- ¿Vale la pena reconsiderar el módulo global de OC en el futuro con un diseño distinto, o queda descartado permanentemente?
