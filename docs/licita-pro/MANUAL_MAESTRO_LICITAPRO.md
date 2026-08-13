# Manual Maestro — LicitaPro

> Documento base del sistema. Cualquier chat, agente o fase de desarrollo nuevo debe leer este manual antes de proponer o implementar cambios.

---

## 1. Visión

LicitaPro es el **sistema operativo interno** de Broking and Brands Group (y empresas relacionadas, como SATHRI) para controlar de forma integral los proyectos comerciales, licitaciones públicas y ventas privadas del grupo — desde la lectura de bases hasta el expediente auditable final.

No es una herramienta de captura de datos aislada: es el lugar donde vive la verdad operativa y financiera de cada proyecto, con el nivel de control y trazabilidad que exige tanto la operación diaria como una eventual auditoría (bancaria, fiscal o de cliente).

## 2. Alcance

LicitaPro debe permitir, a lo largo del ciclo de vida completo de un proyecto:

- Leer bases de licitación y extraer información relevante.
- Cotizar (vehículos, equipo, servicios, o combinaciones — proyectos mixtos).
- Generar órdenes de compra (ligadas a proyecto; el módulo global e independiente sigue en pausa, ver `DECISIONES_LICITAPRO.md`).
- Evaluar viabilidad financiera (márgenes, utilidad, corrida financiera).
- Dar seguimiento con recordatorios y alertas de fechas próximas.
- Controlar el estatus de cada proyecto a lo largo de todo su ciclo.
- Gestionar catálogos de empresas licitantes, proveedores, vehículos, equipo y servicios.
- Integrar documentos y facturas asociadas al proyecto.
- Generar, al cierre, un **expediente auditable** con todo lo relevante: bases, fallos, cotizaciones, órdenes de compra, facturas de compra y de venta, documentos legales y evidencia operativa.

**Fuera de alcance por ahora** (ver riesgos/decisiones pendientes): exportación ZIP real del expediente, paquete bancario, módulo global de Órdenes de Compra, uso de la tabla `purchase_orders` ya creada en Supabase pero sin código que la use.

## 3. Usuarios

| Usuario | Rol operativo |
|---|---|
| Santiago | Admin — visibilidad total |
| Thiago | Admin — visibilidad total |
| Mauricio | Empleado — operación amplia, sin finanzas estratégicas |
| Eduardo | Empleado — operación amplia, sin finanzas estratégicas |

## 4. Permisos

Modelo de dos roles a nivel de sistema: `admin` y `empleado`. La regla de negocio, tal como está definida hoy:

- **Santiago y Thiago** (rol `admin`) pueden ver y operar todo el sistema sin restricción.
- **Eduardo y Mauricio** (rol `empleado`) pueden operar la gran mayoría del sistema — proyectos, cotizaciones, catálogo, órdenes de compra, documentos, Inbox/firmas — **excepto** las finanzas estratégicas del proyecto.

**Nunca visible para `empleado`**, en ningún módulo, PDF, export ni respuesta de agente:

- `utilidad`
- `margen`
- `montoGanar`
- `corrida` (financiera)
- `flujo` (financiero)
- `project_financials`
- `facturaIntermedia` / `facturaGobierno` (nivel vehículo — estructura interna de facturación)
- `ocSettings` (configuración global de condiciones de OC)
- `condiciones` y `partidas[].precioUnit` dentro de una orden de compra (costo interno)

Este límite de visibilidad está implementado técnicamente en `src/lib/data_sanitize.js` (sanitización server-side por rol) y `src/lib/permissions.js` (control de vistas/pestañas). Cualquier cambio a estos archivos es **fase explícita, nunca incidental** (ver Regla Permanente #5).

## 5. Módulos actuales

| Módulo | Qué hace | Notas |
|---|---|---|
| **Dashboard** | KPIs y alertas de fechas próximas | Pendiente de limpieza visual (ver Roadmap) |
| **Proyectos** | Listado, kanban, detalle de proyecto (Centro de Control) | Detalle rediseñado como centro de control ejecutivo |
| **Cotización (admin)** | Captura de partidas de vehículo, equipo, servicios, condiciones, finanzas | Motor de cálculo en `src/lib/calc.js`, replica fórmulas del Excel original |
| **Cotización Operativa** | Versión simplificada para `empleado`, sin campos estratégicos | Mismo modelo de datos que la cotización admin |
| **Operación / OC** | Generador y listado de órdenes de compra **dentro del proyecto** (legacy, `project.ordenesCompra[]`) | Es el flujo principal vigente — el módulo global fue descartado. Desde 3I-2, cada OC distingue si requiere firma o queda solo como soporte documental/expediente (ver sección 6 y `DECISIONES_LICITAPRO.md`) |
| **Inbox / Centro de aprobaciones** | Flujo de firma de OC (y otros documentos futuros) | No confundir con notificaciones — es un flujo formal de aprobación |
| **Empresas** | Catálogo de empresas operadoras (Broking, SATHRI, etc.) | |
| **Catálogo** | Productos/equipo disponibles para cotizar | Incluye productos custom subidos por el equipo |
| **Config / Bitácora** | Configuración de sistema y auditoría de acciones | |

## 6. Reglas permanentes

1. No tocar producción sin autorización explícita de Santiago.
2. No hacer merge a `main` sin preview, pruebas, rollback y autorización explícita.
3. Todo cambio se hace en rama — nunca directo sobre `main`.
4. Todo cambio reporta: rama, base de `main`, commits, archivos tocados, pruebas realizadas, riesgos pendientes, preview y rollback preparado.
5. No tocar SQL, RLS, endpoints, permisos, sanitización ni cálculos financieros salvo que sea el objetivo explícito de la fase — y en ese caso, con máximo cuidado y pruebas dedicadas.
6. No exponer finanzas estratégicas a Eduardo o Mauricio bajo ninguna circunstancia, ni siquiera de forma indirecta (PDF, agente, exportación).
7. No usar "MSMS" como texto visible en ninguna pantalla, PDF o comunicación con el usuario final (es nomenclatura interna que no debe salir a superficie).
8. No revivir `purchase_orders` ni el módulo global de Órdenes de Compra sin autorización explícita — quedó descartado, aunque la tabla sigue existiendo en Supabase.
9. No inventar datos de empresas, proveedores, vehículos, costos, documentos ni bases — si falta información real, se pregunta, no se rellena.
10. No borrar documentos ni proyectos sin confirmación explícita del usuario.
11. No cambiar cálculos financieros sin prueba numérica que confirme que el resultado no cambió (o que el cambio es exactamente el esperado).
12. No cambiar PDFs sin prueba visual o documental de que el resultado es correcto.
13. Todo agente (humano o IA) debe respetar el modelo de permisos — nunca debe existir un atajo que exponga finanzas estratégicas a un rol que no debería verlas.
14. Todo documento cargado al sistema debe tener trazabilidad: de qué proyecto es, quién lo subió, cuándo.
15. Google Drive se piensa como el ecosistema documental central de LicitaPro (ver sección 8) — LicitaPro es el sistema de control, Drive es donde vive el archivo real.
16. Toda fase de trabajo debe declarar qué modelo de IA (ChatGPT y Claude) conviene usar, para optimizar tiempo y costo (ver sección 7).

## 7. Regla de modelos y tokens

Cada fase de trabajo — sin excepción — debe declarar al inicio:

```
Modelo recomendado:
- ChatGPT: [modelo]
- Claude: [modelo]
- Razón: [por qué ese modelo y no otro]
- Cómo ahorrar tokens: [estrategia concreta para esta fase]
```

**Criterio de selección:**

| Modelo | Cuándo usarlo |
|---|---|
| **Claude Sonnet** | Programación normal, documentación, cambios moderados de UX/UI, fases de tamaño medio |
| **Claude Opus** | Arquitectura compleja, permisos, SQL/RLS, refactors grandes, decisiones críticas de seguridad o de datos |
| **Claude Haiku** | Clasificación, extracción simple, resúmenes, tareas repetitivas de bajo riesgo |
| **ChatGPT GPT-5.5 Thinking** | Estrategia, revisión cruzada, prompts maestros, auditoría de decisiones |
| **Modelo rápido/mini (cualquier proveedor)** | Tareas simples, resúmenes cortos, clasificación trivial |

Ver detalle operativo completo en `CLAUDE_PROTOCOLO_TRABAJO.md`.

## 8. Google Drive como ecosistema documental central

LicitaPro **controla** el proyecto; Google Drive **archiva** los documentos reales del proyecto. La estructura propuesta (aún no implementada — ver Roadmap):

```
LICITAPRO DRIVE
├── 01_EMPRESAS_LICITANTES
├── 02_PROYECTOS
├── 03_PROVEEDORES
├── 04_CATALOGOS
├── 05_PLANTILLAS
└── 99_ARCHIVO
```

Cada proyecto, dentro de `02_PROYECTOS`, debería poder tener su propia estructura:

```
[NOMBRE DEL PROYECTO]
├── 01_BASES
├── 02_ANEXOS
├── 03_COTIZACIONES
├── 04_ORDENES_DE_COMPRA
├── 05_FACTURAS_COMPRA
├── 06_FACTURAS_VENTA
├── 07_FALLOS_CONTRATOS
├── 08_EVIDENCIA_ENTREGA
└── 99_EXPEDIENTE_FINAL
```

Esto es una **decisión de arquitectura documental**, todavía no implementada en código. Ver estado en `DECISIONES_LICITAPRO.md` y planeación en `ROADMAP_LICITAPRO.md`.

## 9. Estado técnico actual

- **Producción:** `main = adc8053b0a148f4bffac48596722178a048f9661`
- **URL:** https://licitapro-beta.vercel.app
- **Funciones Vercel:** 10 / 12 (límite del plan Hobby)
- **Estado del deployment:** Ready.
- **SYS-0** (documentación base) — **mergeado en producción**.
- **3I-2** (estados operativos de OC + UX móvil profunda de Dashboard, Proyectos, Centro de Control, Operación/OC, modal de OC, Cotización y Cotización Operativa) — **mergeado en producción**, validado visualmente en dispositivo real antes del merge.
- **Tabla `purchase_orders`:** existe en Supabase (creada y verificada), pero **sin código que la use** — el módulo global de OC fue descartado explícitamente y no fue tocado por 3I-2.

## 10. Criterios de éxito

LicitaPro se considera exitoso cuando:

1. Cualquier persona del equipo puede entender el estado de un proyecto en segundos (Centro de Control).
2. Ningún dato financiero estratégico se filtra jamás a un rol sin permiso.
3. Al cierre de un proyecto, se puede reconstruir su expediente completo sin buscar información fuera del sistema.
4. Cada cambio de código está probado, documentado y es reversible.
5. El sistema se siente como una herramienta operativa profesional, no como un prototipo.
