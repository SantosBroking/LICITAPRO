# DRIVE-0 — Inventario real del Google Drive actual

> Lectura realizada sin modificar Google Drive. Este documento complementa `DRIVE_0_ARQUITECTURA.md` y evita diseñar sobre supuestos.

## 1. Hallazgo principal

Ya existe una carpeta real **`LICITAPRO DRIVE`** en la raíz de Mi unidad.

- Folder ID: `1jqV9xEEqNYZkNt7hc3gIlL-ZkoORV2kj`
- No hay Shared Drives accesibles actualmente desde la cuenta conectada.
- La carpeta aparece compartida, pero el conector no expone aquí una lista confiable de permisos individuales; no se debe asumir quién tiene acceso.

Conclusión: DRIVE-1 no debe crear otra raíz `LICITAPRO DRIVE`. Debe enlazarse a la existente, después de validar permisos y cuenta técnica.

## 2. Estructura raíz real

La raíz actual contiene:

```text
LICITAPRO DRIVE
├── 00_ADMIN_SISTEMA
├── 01_CORPORATIVO_GRUPO
├── 02_EMPRESAS_LICITANTES
├── 03_PROYECTOS
├── 05_CATALOGOS
├── 06_PLANTILLAS
├── 99_ARCHIVO
├── PROVEEDORES
└── REVISAR TERCEROS
```

Diferencias contra el Manual Maestro actual:

- El manual propone `01_EMPRESAS_LICITANTES`, `02_PROYECTOS`, `03_PROVEEDORES`, `04_CATALOGOS`, `05_PLANTILLAS`.
- El Drive real usa numeración diferente y agrega `00_ADMIN_SISTEMA` y `01_CORPORATIVO_GRUPO`.
- `PROVEEDORES` y `REVISAR TERCEROS` existen sin prefijo numérico.

**No renombrar ni mover nada en DRIVE-0.** Primero se debe decidir cuál estructura se declara canónica y cómo migrar sin romper referencias.

## 3. Proyectos existentes en `03_PROYECTOS`

Se identificaron al menos tres carpetas de proyecto:

```text
BRO-2026-LIC-001_CHIMALHUACAN_PATRULLAS
BRO-2026-LIC-002_PUEBLA_VEHICULOS
SATHRI_CUERNAVACA_AC-SADMON-DGRM-DA-LP-010-2026
```

Esto confirma que ya existe uso operativo real y que la nomenclatura de proyecto no es uniforme todavía.

## 4. Dos estructuras documentales reales distintas

### A. Chimalhuacán / Puebla

Ambos usan una estructura compacta prácticamente idéntica:

```text
01_BASES
02_ANEXOS
03_COTIZACIONES
04_OC
05_FACTURAS_COMPRA
06_FACTURAS_VENTA
07_FALLOS_CONTRATOS
08_EVIDENCIA_ENTREGA
09_COMUNICACION_OFICIAL
99_EXPEDIENTE_FINAL
```

Hallazgos:

- `04_OC` es el nombre real, no `04_ORDENES_DE_COMPRA`.
- Existe `09_COMUNICACION_OFICIAL`, que no estaba en la estructura simplificada del Manual Maestro.

### B. SATHRI Cuernavaca

Usa una estructura mucho más detallada y orientada al ciclo completo de licitación:

```text
01_BASES
02_ADMINISTRATIVO
03_TECNICO
04_COTIZACIONES
05_PROPUESTA_FINAL
06_AUDITORIA
07_PRESENTACION
08_FALLO_CONTRATO
09_OC
10_FACTURAS_COMPRA
11_FACTURACION_Y_COBRO
12_ENTREGA_EVIDENCIA
13_COMUNICACION_OFICIAL
99_EXPEDIENTE_FINAL
```

Además contiene archivos de control en la raíz del proyecto, entre ellos `ESTATUS.md` y `PENDIENTES_EXTERNOS.md`.

## 5. Implicación de arquitectura

No existe hoy una única plantilla real de proyecto.

Por lo tanto DRIVE-1 no debe crear carpetas usando una lista fija universal sin antes definir **plantillas documentales versionadas**.

Modelo recomendado:

```js
project.drive = {
  folderId: "...",
  templateKey: "licitacion_completa",
  templateVersion: 1,
  ...
}
```

Plantillas iniciales candidatas:

- `licitacion_compacta` — patrón Chimalhuacán/Puebla.
- `licitacion_completa` — patrón SATHRI Cuernavaca.
- `venta_privada` — por definir con casos reales antes de implementarla.

No crear una plantilla `venta_privada` por imaginación; debe derivarse de un expediente real.

## 6. Decisiones actualizadas para DRIVE-0

1. **Raíz existente:** reutilizar `LICITAPRO DRIVE`; no crear otra.
2. **Ubicación:** hoy vive en Mi unidad, no en Shared Drive.
3. **Plantillas:** la estructura por proyecto debe ser versionada y seleccionable, no una lista universal rígida.
4. **Nombres de carpetas:** no usarlos como identificador técnico; usar IDs de Drive.
5. **Migración:** no renombrar carpetas existentes hasta tener un mapa de IDs y una regla de compatibilidad.
6. **Seguridad:** antes de conectar la app debe auditarse quién puede abrir directamente `LICITAPRO DRIVE`, porque el acceso directo a Drive puede saltarse los permisos de LicitaPro.

## 7. Siguiente verificación antes de DRIVE-1

Falta validar:

- Permisos reales de `LICITAPRO DRIVE` y de `03_PROYECTOS`.
- Si la cuenta conectada es la cuenta corporativa que se usará en producción o solo una cuenta operativa temporal.
- Qué plantilla debe ser el estándar para nuevas licitaciones.
- Si Chimalhuacán/Puebla y Cuernavaca representan dos tipos de proyecto deliberados o dos generaciones distintas de organización documental.

Hasta resolver eso, no se debe automatizar creación, renombrado ni migración de carpetas.
