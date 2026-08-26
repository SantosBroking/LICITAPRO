# DRIVE-0 — Arquitectura Google Drive para LicitaPro

> Estado: diseño propuesto. **No implementado.** Esta fase no modifica producción, SQL, RLS, endpoints, permisos ni lógica de negocio.

## Modelo recomendado

- **ChatGPT:** GPT-5.6 Sol
- **Claude:** Opus para revisión de arquitectura/seguridad; Sonnet para implementación posterior una vez cerrado el diseño.
- **Razón:** DRIVE-0 define identidad documental, permisos, trazabilidad y relación entre LicitaPro y un repositorio externo. Un error aquí puede romper el expediente auditable o exponer documentación sensible.
- **Cómo ahorrar tokens:** revisar únicamente `MANUAL_MAESTRO_LICITAPRO.md`, `DECISIONES_LICITAPRO.md`, `ROADMAP_LICITAPRO.md`, el flujo actual de `project.docs[]` y los puntos de integración necesarios. No revisar módulos financieros ni de OC salvo para validar permisos.

---

## 1. Objetivo

LicitaPro debe ser el **sistema de control** del proyecto y Google Drive el **repositorio del archivo real**. El usuario debe poder entrar a un proyecto en LicitaPro y saber exactamente qué documentos existen, en qué categoría están, quién los incorporó y dónde vive el archivo original.

DRIVE-0 define la arquitectura antes de construir integración técnica.

## 2. Principio de arquitectura

- **LicitaPro controla:** proyecto, permisos, categoría documental, trazabilidad, estado y relación entre registros.
- **Google Drive almacena:** PDFs, Excels, contratos, bases, anexos, facturas, evidencias y demás archivos reales.
- **Supabase no debe convertirse en un segundo Drive.** En la integración objetivo se guardan referencias y metadata; el binario vive en Drive salvo que una función existente requiera temporalmente otra cosa.
- El identificador estable es el **Google Drive file/folder ID**, nunca el nombre del archivo o carpeta.

## 3. Estructura maestra

```text
LICITAPRO DRIVE
├── 01_EMPRESAS_LICITANTES
├── 02_PROYECTOS
├── 03_PROVEEDORES
├── 04_CATALOGOS
├── 05_PLANTILLAS
└── 99_ARCHIVO
```

Cada proyecto dentro de `02_PROYECTOS`:

```text
[FOLIO] - [NOMBRE DEL PROYECTO]
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

Se propone anteponer el **folio** al nombre del proyecto para evitar colisiones y facilitar búsquedas humanas. El ID de Drive seguirá siendo la referencia canónica.

## 4. Creación de carpeta de proyecto

### DRIVE-1 inicial

La primera implementación debe ser **explícita e idempotente**, no automática al crear cualquier prospecto.

En el Centro de Control del proyecto, admin podrá ejecutar:

**Crear expediente en Drive**

Comportamiento esperado:

1. Si el proyecto ya tiene `driveFolderId`, no crear otra carpeta.
2. Verificar que el folder siga existiendo y sea accesible.
3. Si no existe relación, crear carpeta raíz del proyecto + subcarpetas estándar.
4. Guardar la relación estable en LicitaPro.
5. Registrar el evento en bitácora.

Una vez validado el flujo real, se podrá evaluar creación automática para proyectos adjudicados o en participación.

## 5. Relación proyecto ↔ Drive

Modelo conceptual propuesto, **no crear todavía**:

```js
project.drive = {
  folderId: "google-drive-folder-id",
  folderUrl: "...",
  structureVersion: 1,
  createdAt: "ISO_DATE",
  createdBy: "USER_ID",
  lastVerifiedAt: "ISO_DATE"
}
```

Reglas:

- `folderId` es la fuente de verdad.
- `folderUrl` es conveniencia de UI, no identificador.
- `structureVersion` permite evolucionar carpetas futuras sin romper proyectos existentes.
- Nunca reconstruir una relación buscando solo por nombre.

## 6. Relación documento ↔ Drive

Cada registro documental dentro de LicitaPro debe poder apuntar al archivo real de Drive.

Modelo conceptual propuesto:

```js
{
  id: "internal-document-id",
  driveFileId: "google-drive-file-id",
  driveFolderKey: "04_ORDENES_DE_COMPRA",
  name: "OC-001 Proveedor.pdf",
  mimeType: "application/pdf",
  uploadedAt: "ISO_DATE",
  uploadedBy: "USER_ID",
  source: "drive",
  status: "active"
}
```

No almacenar permisos estratégicos dentro de `user_metadata`. La autorización sigue perteneciendo a LicitaPro y su modelo `admin` / `empleado`.

## 7. Punto de integración técnico

Dirección propuesta para DRIVE-1:

- Integración con **Google Drive API exclusivamente desde backend**.
- Ninguna credencial privada de Google debe llegar al navegador.
- LicitaPro envía una intención autenticada al backend: crear carpeta, listar archivos, subir, mover, consultar metadata, etc.
- El backend valida primero la sesión Supabase y el rol/permiso correspondiente.
- Después llama a Drive.

### Credencial Google

DRIVE-0 no fija todavía si se usará:

1. **Service account + Shared Drive corporativo**, o
2. **OAuth de una cuenta corporativa dedicada**.

La decisión depende de cómo esté configurado el Google Workspace real de Broking. Debe verificarse antes de DRIVE-1; no se debe elegir por suposición.

## 8. Seguridad documental — decisión crítica

**No compartir de forma amplia el Drive maestro con empleados solo porque puedan entrar a LicitaPro.**

Razón: existen documentos que pueden contener costos internos, condiciones, facturas u otra información que LicitaPro oculta al rol `empleado`. Si Drive se comparte directamente sin el mismo control, se crea un bypass del modelo de permisos.

Arquitectura recomendada:

- El repositorio maestro queda bajo control corporativo restringido.
- LicitaPro media el acceso documental según rol.
- Si en el futuro se quiere acceso humano directo a Drive para empleados, deberán definirse carpetas/documentos explícitamente compartibles o una estructura de permisos separada.
- Nunca asumir que "si puede ver el proyecto, puede ver todos sus archivos".

## 9. Categorías documentales

Mapeo inicial:

| Tipo en LicitaPro | Carpeta Drive |
|---|---|
| Bases | `01_BASES` |
| Anexos | `02_ANEXOS` |
| Cotizaciones | `03_COTIZACIONES` |
| Órdenes de compra | `04_ORDENES_DE_COMPRA` |
| Facturas de compra | `05_FACTURAS_COMPRA` |
| Facturas de venta | `06_FACTURAS_VENTA` |
| Fallos / contratos | `07_FALLOS_CONTRATOS` |
| Evidencia de entrega | `08_EVIDENCIA_ENTREGA` |
| Expediente cerrado | `99_EXPEDIENTE_FINAL` |

Un documento debe tener **una categoría canónica** dentro de LicitaPro; mover el archivo entre categorías debe actualizar la metadata y quedar trazado.

## 10. Reglas de integridad

1. No crear carpetas duplicadas si ya existe un `folderId` válido.
2. No borrar archivos de Drive desde LicitaPro sin confirmación explícita.
3. Borrar un proyecto en LicitaPro no debe borrar automáticamente su expediente de Drive.
4. Renombrar un proyecto puede renombrar su carpeta, pero el vínculo se conserva por ID.
5. Si un archivo se mueve manualmente dentro de Drive, LicitaPro debe seguir identificándolo por `fileId`.
6. Si un archivo se elimina externamente, LicitaPro debe marcar la referencia como no disponible; no inventar ni recrear silenciosamente el archivo.
7. Toda subida debe registrar proyecto, usuario y fecha.
8. Toda operación Drive relevante debe dejar bitácora.
9. Ningún documento sensible puede quedar accesible por un rol que no debería verlo solo por tener un URL.

## 11. Fases propuestas

### DRIVE-0 — Arquitectura

Este documento. Sin integración funcional.

### DRIVE-1 — Expediente base por proyecto

- Conectar backend a Drive.
- Crear/verificar estructura de proyecto.
- Guardar `folderId`.
- Botón "Abrir expediente" / estado de conexión.
- Bitácora.

### DRIVE-2 — Documentos vinculados

- Subir archivos desde LicitaPro hacia carpeta correcta.
- Listar metadata.
- Abrir/descargar según permisos.
- Detectar referencias rotas.

### DRIVE-3 — Automatización documental

- Guardar automáticamente cotizaciones/OC/PDFs generados por LicitaPro en su carpeta correspondiente.
- Versionado y nomenclatura.

### DRIVE-4 — Expediente auditable

- Construir `99_EXPEDIENTE_FINAL`.
- Checklist de integridad.
- Exportación final y/o ZIP, si sigue siendo necesaria.

## 12. Qué NO se hace en DRIVE-0

- No SQL.
- No RLS.
- No endpoints nuevos.
- No variables/secretos de Google.
- No cambios en producción.
- No se crea todavía ninguna carpeta real en Drive.
- No se modifica `project.docs[]`.
- No se toca `purchase_orders`.
- No se cambia ningún permiso de `admin` / `empleado`.
- No se cambia ningún cálculo financiero.

## 13. Criterio para cerrar DRIVE-0

DRIVE-0 queda listo para implementación cuando estén confirmadas estas cuatro decisiones:

1. **Cuenta/repositorio Google:** Shared Drive corporativo vs cuenta corporativa dedicada.
2. **Acceso humano directo:** quién puede entrar al Drive fuera de LicitaPro.
3. **Creación inicial:** botón admin explícito (recomendado para DRIVE-1) vs automática.
4. **Modelo de metadata:** confirmar que `folderId`/`fileId` son la relación canónica y que LicitaPro no duplicará los binarios.
