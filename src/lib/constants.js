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

export const TIPOS_PRODUCTO = [
  'Patrullas y vehículos','Uniformes','Chalecos balísticos',
  'Equipo táctico','Armamento','Tecnología','Construcción','Otro',
];

export const ESTATUS_COSTO = ['Confirmado','Estimado','Heredado','Pendiente MSM','Vencido'];
export const MODOS_PRECIO  = ['Utilidad deseada $','Utilidad deseada %','Techo presupuestal'];
export const DOC_CATEGORIES = [
  'Bases','Anexo técnico','Anexos administrativos','Anexos legales',
  'Propuesta técnica','Propuesta económica','Cartas','Poderes',
  'Constancias fiscales','Opiniones de cumplimiento','Fichas técnicas',
  'Facturas','Fotografías','Comprobantes de entrega','Otro',
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
  groupName:'MSMS CORP',
  currency:'MXN',
  checklistTemplate: CHECKLIST_TEMPLATE_DEFAULT,
  customStatuses: [],
  customProductTypes: [],
};
