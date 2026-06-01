# LicitaPro · MSMS CORP

Sistema de gestión de licitaciones y cotizaciones para patrullas y vehículos equipados.

## Estructura del proyecto

```
index.html              ← Entrada, import map, CSS global
src/
  lib/
    core.js             ← React + html (htm binding), hooks
    constants.js        ← STATUSES, catálogos, configs
    catalog.js          ← 74 productos en 9 categorías
    utils.js            ← fecha, formato, uid, alertas, archivos
    calc.js             ← calcCotizacion, newCotizacion
    supabase.js         ← cliente, auth, CRUD
    pdf.js              ← extracción acta constitutiva y CSF
    excel.js            ← builders de reportes Excel (9 hojas)
  ui/
    primitives.js       ← Badge, Metric, Inp, Modal, NumInput…
  views/
    Auth.js             ← Login / registro Supabase
    Catalog.js          ← Vista del catálogo MSMS
    Cotizacion.js       ← 5 sub-tabs de cotización
    Companies.js        ← Empresas licitantes + PDF parsing
    Bases.js            ← Checklist y datos de las bases
    Vehicles.js         ← Vehículos, facturas, acta entrega, billing, docs
    Dashboard.js        ← Panel principal con KPIs y alertas
    Projects.js         ← Lista, formulario y detalle de proyecto
    Admin.js            ← Reportes, configuración y bitácora
  App.js                ← Estado global, navegación, CRUD
  main.js               ← Mount de React
```

## Deploy en Vercel (flujo estándar)

1. Sube todos los archivos a tu repositorio de GitHub.
2. Conecta el repo en [vercel.com](https://vercel.com) → New Project.
3. **Sin configuración de build** — déjalo todo por defecto.
4. Vercel detecta automáticamente que es un sitio estático.
5. Click en Deploy. Listo en ≈ 30 segundos.

> **Nota:** El proyecto usa módulos ES nativos (`<script type="module">`).
> Funciona perfectamente en Vercel (servido por HTTP). No se puede
> abrir con doble clic en el archivo local, solo vía el servidor de Vercel
> o un servidor local (`npx serve .`).

## Bug-fixes incluidos

| # | Descripción | Dónde |
|---|-------------|-------|
| 1 | Tabs del proyecto no se resetean al volver al mismo proyecto | `App.js` → `_lastProjectId` ref |
| 2 | Tabs principales sin superposición en proyectos | `Projects.js` → `overflowX:auto, flexShrink:0` |
| 3 | NavButtons no se recrea en cada render (no desmonta) | `Cotizacion.js` → `renderNavButtons()` función directa |
| 4 | Sub-tab de cotización con estado local de respaldo | `Cotizacion.js` → `_localTab` + `useEffect` de sync |

## Tecnología

- **React 18** via `esm.sh` (módulos ES, sin npm)
- **htm** — JSX sin compilador (`html\`…\`` template literals)
- **Supabase** — Auth + base de datos PostgreSQL
- **pdfjs** — Parsing de actas constitutivas y CSF
- **SheetJS (XLSX)** — Exportación de reportes Excel
- **Sin build** — Deploy directo de archivos fuente a Vercel

## Base de datos (Supabase)

Tablas requeridas: `projects`, `vehicles`, `companies`, `user_config`, `audit_logs`.
Todas con RLS habilitado y políticas por `user_id`.

```sql
-- Grants mínimos si los datos no cargan
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
```
 
