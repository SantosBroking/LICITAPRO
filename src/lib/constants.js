// ─────────────────────────────────────────────────────────────
// constants.js  —  Toda la configuración estática del dominio
// ─────────────────────────────────────────────────────────────

export const STATUSES = [
  {id:'prospecto',    label:'Prospecto',              color:'#7F77DD',bg:'#EEEDFE',tx:'#3C3489'},
  {id:'analisis',     label:'En análisis',            color:'#5B8DEF',bg:'#E6F1FB',tx:'#1A4480'},
  {id:'preparacion',  label:'En preparación',         color:'#EF9F27',bg:'#FAEEDA',tx:'#633806'},
  {id:'aclaraciones', label:'Junta aclaraciones',     color:'#9B6FBF',bg:'#F1E8FA',tx:'#4A2E66'},
  {id:'presentada',   label:'Propuesta presentada',   color:'#378ADD',bg:'#E6F1FB',tx:'#0C447C'},
  {id:'evaluacion',   label:'En evaluación',          color:'#5DCAA5',bg:'#E1F5EE',tx:'#085041'},
  {id:'ganada',       label:'Ganada',                 color:'#1D9E75',bg:'#E1F5EE',tx:'#085041'},
  {id:'contrato',     label:'Contratado',             color:'#0A8C5C',bg:'#D7F0E5',tx:'#04432D'},
  {id:'entrega',      label:'En entrega',             color:'#0D9DB5',bg:'#D8F0F5',tx:'#054954'},
  {id:'facturado',    label:'Facturado',              color:'#2D7F4A',bg:'#DEF0E2',tx:'#15401F'},
  {id:'cobrado',      label:'Cobrado',                color:'#1D9E75',bg:'#C8E9D9',tx:'#085041'},
  {id:'perdida',      label:'Perdida',                color:'#E24B4A',bg:'#FCEBEB',tx:'#791F1F'},
  {id:'cancelada',    label:'Cancelada',              color:'#888780',bg:'#F1EFE8',tx:'#444441'},
];

export const KANBAN_COLS  = ['prospecto','analisis','preparacion','aclaraciones','presentada','evaluacion','ganada','contrato','entrega','facturado'];
export const FINAL_STATUS = ['cobrado','perdida','cancelada'];

export const TIPOS_PROCEDIMIENTO = [
  'Licitación pública nacional','Licitación pública internacional',
  'Invitación a tres','Adjudicación directa','Concurso abierto','Subasta inversa',
];

export const DEPENDENCIAS_COMUNES = [
  'Gobierno Federal','Gobierno Estatal','Gobierno Municipal',
  'Iniciativa Privada','Paraestatal','Seguridad Pública',
];

// Fase 3F -- categorías de proyecto/producto. Se AGREGAN las nuevas
// (pedidas explícitamente) al final de la lista legacy -- ningún valor
// viejo se quita ni se renombra, así que proyectos existentes con
// 'Patrullas y vehículos'/'Uniformes'/etc. siguen mostrando exactamente
// lo mismo en el dropdown y en cualquier resumen/exportación a Excel.
export const TIPOS_PRODUCTO = [
  'Patrullas y vehículos','Uniformes','Chalecos balísticos',
  'Equipo táctico','Armamento','Tecnología','Construcción','Otro',
  'Vehículos','Vehículos equipados','Equipamiento vehicular','Equipo / productos','Servicios','Mixto',
];

// Normaliza CUALQUIER valor de project.productType (legacy o nuevo) a una
// categoría funcional interna, usada para decidir lenguaje de PDFs y
// filtros -- nunca para gates de seguridad ni cálculos financieros (esto
// es puramente de presentación/clasificación). Valor desconocido/vacío
// -> 'otro', nunca rompe con un valor legacy no contemplado.
const MAPA_CATEGORIA_PROYECTO = {
  'Patrullas y vehículos': 'vehiculos',
  'Vehículos': 'vehiculos',
  'Vehículos equipados': 'vehiculos_equipados',
  'Equipamiento vehicular': 'equipamiento_vehicular',
  'Equipo / productos': 'equipo',
  'Servicios': 'servicios',
  'Mixto': 'mixto',
};
export function categoriaProyecto(productType) {
  return MAPA_CATEGORIA_PROYECTO[productType] || 'otro';
}
export const CATEGORIA_PROYECTO_LABELS = {
  vehiculos: 'Vehículos',
  vehiculos_equipados: 'Vehículos equipados',
  equipamiento_vehicular: 'Equipamiento vehicular',
  equipo: 'Equipo / productos',
  servicios: 'Servicios',
  mixto: 'Mixto',
  otro: 'Otro',
};

export const ESTATUS_COSTO = ['Confirmado','Estimado','Heredado','Pendiente MSM','Vencido'];
export const MODOS_PRECIO  = ['Utilidad deseada $','Utilidad deseada %','Techo presupuestal'];
// Fase 2F2: 'Facturas proveedor/origen' es una categoría NUEVA, explícita,
// para separar visualmente lo que antes era ambiguo bajo 'Facturas' (podía
// ser tanto factura de compra/proveedor como factura al cliente final). La
// categoría vieja 'Facturas' se deja INTACTA (no se renombra, no se
// elimina) para no romper documentos existentes -- ver data_sanitize.js
// para el criterio de seguridad de cada una.
export const DOC_CATEGORIES = [
  'Convocatoria','Bases','Junta de aclaraciones','Anexo técnico','Anexos administrativos','Anexos legales',
  'Propuesta técnica','Propuesta económica','Acta de apertura','Fallo','Contrato',
  'Cartas','Membretado','Poderes','Constancias fiscales','Opiniones de cumplimiento','Fichas técnicas',
  'Facturas','Facturas proveedor/origen','Órdenes de compra','Fotografías','Comprobantes de entrega','Garantías','Fianzas','Otro',
];

export const EMPRESA_BASE_DOCS = [
  {id:'acta',        name:'Acta constitutiva',                       category:'Legal',        storeFile:true,  hint:'Se guarda en el sistema'},
  {id:'csf',         name:'Constancia de situación fiscal',          category:'Fiscal',       storeFile:true,  hint:'Se guarda — máx. 3 meses'},
  {id:'poder',       name:'Poder notarial del representante',        category:'Legal',        storeFile:false},
  {id:'id_rep',      name:'Identificación oficial del representante',category:'Legal',        storeFile:false},
  {id:'opinion_sat', name:'Opinión de cumplimiento SAT',             category:'Fiscal',       storeFile:false, hint:'Vence cada 30 días'},
  {id:'dom_fiscal',  name:'Comprobante de domicilio fiscal',         category:'Fiscal',       storeFile:false},
  {id:'estado_cuenta',name:'Estado de cuenta bancario (3 meses)',   category:'Financiero',   storeFile:false},
  {id:'imss',        name:'Opinión de cumplimiento IMSS',            category:'Laboral',      storeFile:false},
];

export const CHECKLIST_TEMPLATE_DEFAULT = [
  {id:'t_acreditacion',  name:'Escrito de acreditación de personalidad jurídica', category:'Administrativo'},
  {id:'t_propuesta_tec', name:'Propuesta técnica',                                category:'Técnico'},
  {id:'t_propuesta_eco', name:'Propuesta económica',                              category:'Económico'},
  {id:'t_garantia',      name:'Garantía de seriedad de la propuesta',             category:'Económico'},
  {id:'t_decl_integridad',name:'Declaración de integridad',                      category:'Administrativo'},
  {id:'t_decl_conflicto', name:'Declaración de conflicto de interés',            category:'Administrativo'},
  {id:'t_recibo',        name:'Recibo de pago de bases',                          category:'Administrativo'},
  {id:'t_ficha_tec',     name:'Ficha técnica del vehículo/producto',             category:'Técnico'},
  {id:'t_catalogo',      name:'Catálogo del fabricante',                         category:'Técnico'},
];

export const DEFAULT_CONFIG = {
  groupName:'LICITAPRO',
  currency:'MXN',
  checklistTemplate: CHECKLIST_TEMPLATE_DEFAULT,
  customStatuses: [],
  customProductTypes: [],
};

// ── Fase 2G — Peticiones internas robustas (Inbox) ──────────────────────
// Los 4 tipos originales (Fase 2F3) se mantienen con su nombre exacto, sin
// renombrar -- ya existen pendientes reales en producción con esos valores
// de `type`, renombrarlos rompería su visualización histórica. Los nuevos
// se agregan como tipos adicionales, no reemplazos.
// Fase 3D-A: 'firma_documento' agregado al final -- convivencia con Firmas
// (ver diagnóstico 3D-0). NO reemplaza ni toca project.firmas[]/Firmas.js/
// src/lib/firmas.js -- es solo el tipo nuevo para que, en una fase futura
// (3D-B, no autorizada todavía), las firmas NUEVAS puedan crearse como
// inbox_items en vez de entradas de project.firmas[].
export const INBOX_TIPOS = [
  'proyecto_nuevo', 'cotizacion_revision', 'documento_cargado', 'cambios_solicitados',
  'aprobar_precio', 'revisar_documento', 'aprobar_factura_proveedor', 'cambio_operativo', 'duda_admin', 'alta_proveedor', 'otro',
  'firma_documento',
];
export const INBOX_TIPO_LABELS = {
  proyecto_nuevo: 'Proyecto nuevo',
  cotizacion_revision: 'Cotización a revisión',
  documento_cargado: 'Documento cargado',
  cambios_solicitados: 'Cambios solicitados',
  aprobar_precio: 'Aprobar precio',
  revisar_documento: 'Revisar documento',
  aprobar_factura_proveedor: 'Aprobar factura de proveedor',
  cambio_operativo: 'Cambio operativo',
  duda_admin: 'Duda para admin',
  alta_proveedor: 'Alta de proveedor',
  otro: 'Otro',
  // Fase 3D-B1.2 -- label acortada a 'Firmas' (antes 'Firma de documento')
  // para que se vea claro y corto en el filtro/pestaña de Inbox, tal como
  // se pidió explícitamente. Mismo criterio en tarjeta/detalle (usa la
  // misma constante) -- se ve consistente en ambos lugares.
  firma_documento: 'Firmas',
};
// 'cerrado' es NUEVO en esta fase -- se agrega al final, no se reordena ni
// se quita ninguno de los 6 existentes (compatibilidad con pendientes ya
// creados desde Fase 2F3).
export const INBOX_ESTATUS = ['pendiente', 'en_revision', 'cambios_solicitados', 'aprobado', 'rechazado', 'revisado', 'cerrado'];
export const INBOX_ESTATUS_LABELS = {
  pendiente: 'Pendiente', en_revision: 'En revisión', cambios_solicitados: 'Cambios solicitados',
  aprobado: 'Aprobado', rechazado: 'Rechazado', revisado: 'Revisado', cerrado: 'Cerrado',
};
export const INBOX_PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];
export const INBOX_PRIORIDAD_LABELS = { baja:'Baja', media:'Media', alta:'Alta', urgente:'Urgente' };
// Fase 3D-A: 'firmar' agregado al final -- misma convivencia, sin tocar los 5 existentes.
export const INBOX_ACCIONES = ['aprobar', 'revisar', 'corregir', 'comentar', 'confirmar', 'firmar'];
export const INBOX_ACCION_LABELS = { aprobar:'Aprobar', revisar:'Revisar', corregir:'Corregir', comentar:'Comentar', confirmar:'Confirmar', firmar:'Firmar' };
export const INBOX_REFERENCIA_TIPOS = ['partida', 'equipo', 'documento', 'vehiculo'];

// Fase 3D-A — valores válidos para los campos específicos de
// firma_documento dentro de inbox_items.data (ver diagnóstico 3D-0). Solo
// se usan para VALIDAR en api/inbox-create.js -- ningún flujo real los crea
// todavía (eso es Fase 3D-B, no autorizada).
export const INBOX_DOCUMENTO_TIPOS = ['orden_compra', 'cotizacion', 'documento', 'otro'];
export const INBOX_DOCUMENTO_TIPO_LABELS = { orden_compra:'Orden de compra', cotizacion:'Cotización', documento:'Documento', otro:'Otro' };
export const INBOX_FIRMA_STATUS = ['pendiente_firma', 'firmado', 'visto_final'];
export const INBOX_FIRMA_STATUS_LABELS = { pendiente_firma:'Pendiente de firma', firmado:'Firmado, en espera de visto final', visto_final:'Visto final dado' };

// ── Ocultar proyectos perdidos/cancelados por default en UI (sin borrar
// nada, sin tocar SQL/base de datos). El campo real es `project.status`
// (confirmado en código: STATUSES y GRUPOS.cerradas de Projects.js) --
// los valores que usa esta app HOY son exactamente 'perdida' y
// 'cancelada'. Se agregan variantes adicionales (perdido/lost/cancelado/
// rechazado/rechazada) solo como blindaje defensivo por si algún dato
// legado tuviera otra grafía -- hoy no hay evidencia en el código de que
// se usen, pero normalizar (minúsculas, sin acentos) antes de comparar no
// tiene costo y evita sorpresas futuras.
export const PROYECTO_ESTATUS_PERDIDO = ['perdida', 'perdido', 'lost', 'cancelada', 'cancelado', 'rechazado', 'rechazada'];
export function esProyectoPerdido(status) {
  if (!status || typeof status !== 'string') return false;
  const norm = status.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return PROYECTO_ESTATUS_PERDIDO.includes(norm);
}

