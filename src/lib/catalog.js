// ─────────────────────────────────────────────────────────────
// catalog.js  —  74 productos MSMS en 9 categorías
// ─────────────────────────────────────────────────────────────

export const CATALOG_PRODUCTS = [
  // 01 IMAGEN
  {id:'01-001',cat:'01 Imagen',sub:'Rotulación',    nom:'Rotulación institucional',        desc:'Rotulación institucional completa según manual de imagen.',prov:'Local',       vis:true},
  {id:'01-002',cat:'01 Imagen',sub:'Pintura',       nom:'Pintura institucional',           desc:'Pintura institucional con esquema de la dependencia.',    prov:'Local',       vis:true},
  {id:'01-003',cat:'01 Imagen',sub:'Vinil',         nom:'Calcas / vinil',                  desc:'Aplicación de calcas y vinil reflejante.',                prov:'Local',       vis:true},
  {id:'01-004',cat:'01 Imagen',sub:'Identificación',nom:'Números económicos',              desc:'Aplicación de números económicos institucionales.',       prov:'Local',       vis:true},
  {id:'01-005',cat:'01 Imagen',sub:'Paquete',       nom:'Imagen institucional completa',   desc:'Paquete integral de imagen (pintura, vinil, números).',   prov:'Local',       vis:true},
  // 02 FIERROS
  {id:'02-006',cat:'02 Fierros',sub:'Estructura',   nom:'Roll bar',                        desc:'Roll bar de seguridad para cabina.',                      prov:'Taller',      vis:true},
  {id:'02-007',cat:'02 Fierros',sub:'Protección',   nom:'Burrera central',                 desc:'Burrera central tubular reforzada.',                      prov:'Taller',      vis:true},
  {id:'02-008',cat:'02 Fierros',sub:'Interior',     nom:'Mampara interior',                desc:'Mampara separadora cabina / área operativa.',             prov:'Taller',      vis:true},
  {id:'02-009',cat:'02 Fierros',sub:'Protección',   nom:'Protector de ventana',            desc:'Protectores metálicos para ventanas traseras.',           prov:'Taller',      vis:true},
  {id:'02-010',cat:'02 Fierros',sub:'Interior',     nom:'Banca central',                   desc:'Banca central trasera para traslado de detenidos.',       prov:'Taller',      vis:true},
  {id:'02-011',cat:'02 Fierros',sub:'Estructura',   nom:'Defensa trasera',                 desc:'Defensa trasera tubular reforzada.',                      prov:'Taller',      vis:true},
  {id:'02-012',cat:'02 Fierros',sub:'Interior',     nom:'Cajonera',                        desc:'Cajonera de almacenamiento equipada.',                    prov:'Taller',      vis:true},
  {id:'02-013',cat:'02 Fierros',sub:'Soporte',      nom:'Porta arma',                      desc:'Soporte porta arma con seguridad.',                       prov:'Taller',      vis:true},
  {id:'02-014',cat:'02 Fierros',sub:'Soporte',      nom:'Porta esposas',                   desc:'Soporte para esposas.',                                   prov:'Taller',      vis:true},
  {id:'02-015',cat:'02 Fierros',sub:'Soporte',      nom:'Soporte para radio',              desc:'Base de instalación para radio móvil.',                   prov:'Taller',      vis:true},
  {id:'02-016',cat:'02 Fierros',sub:'Soporte',      nom:'Soporte para tablet',             desc:'Base abatible para tablet con seguridad.',                prov:'Taller',      vis:true},
  {id:'02-017',cat:'02 Fierros',sub:'Adaptación',   nom:'Adaptación especial',             desc:'Adaptación especial según requerimiento del proyecto.',   prov:'Taller',      vis:true},
  {id:'02-K1', cat:'02 Fierros',sub:'Kit',          nom:'Kit fierros Pickup',              desc:'Roll Bar, Burrera frontal, Banca, Mamparas, Adaptaciones.',prov:'Taller',     vis:true},
  // 03 LUCES
  {id:'03-018',cat:'03 Luces',sub:'Iluminación',    nom:'Barra luminosa',                  desc:'Barra luminosa LED de techo.',                            prov:'CENTRA/Code3',vis:true},
  {id:'03-019',cat:'03 Luces',sub:'Iluminación',    nom:'Baliza',                          desc:'Baliza LED de emergencia.',                               prov:'CENTRA/Code3',vis:true},
  {id:'03-020',cat:'03 Luces',sub:'Iluminación',    nom:'Luz interior',                    desc:'Luz LED interior de emergencia.',                         prov:'CENTRA/Code3',vis:true},
  {id:'03-021',cat:'03 Luces',sub:'Iluminación',    nom:'Luz exterior',                    desc:'Luces LED exteriores de emergencia.',                     prov:'CENTRA/Code3',vis:true},
  {id:'03-022',cat:'03 Luces',sub:'Iluminación',    nom:'Luz perimetral',                  desc:'Iluminación perimetral LED.',                             prov:'CENTRA/Code3',vis:true},
  {id:'03-023',cat:'03 Luces',sub:'Tráfico',        nom:'Barra de tráfico',                desc:'Barra de señalización de tráfico LED.',                   prov:'CENTRA/Code3',vis:true},
  {id:'03-024',cat:'03 Luces',sub:'Sonido',         nom:'Sirena policial',                 desc:'Sirena electrónica multitono.',                           prov:'CENTRA/Code3',vis:true},
  {id:'03-025',cat:'03 Luces',sub:'Sonido',         nom:'Bocina policial',                 desc:'Bocina de alta potencia.',                                prov:'CENTRA/Code3',vis:true},
  {id:'03-026',cat:'03 Luces',sub:'Control',        nom:'Controlador de luces',            desc:'Controlador electrónico de luces y sirena.',              prov:'CENTRA/Code3',vis:true},
  {id:'03-027',cat:'03 Luces',sub:'Sistema',        nom:'Sistema de emergencia',           desc:'Sistema integral de emergencia luces+sirena.',            prov:'CENTRA/Code3',vis:true},
  {id:'03-K1', cat:'03 Luces',sub:'Kit Patrulla',   nom:'Kit Sistema integral Patrulla',   desc:'Barra LED, luces int/ext, perimetral, sirena, bocina, control.',prov:'CENTRA/Code3',vis:true},
  {id:'03-K2', cat:'03 Luces',sub:'Kit Fiscalía',   nom:'Kit Sistema integral Fiscalía',   desc:'Luces LED viceras, int/ext, perimetral, sirena, bocina.',  prov:'CENTRA/Code3',vis:true},
  // 04 VIDEO
  {id:'04-028',cat:'04 Video',sub:'Sistema',        nom:'Sistema videovigilancia Dahua',   desc:'Sistema completo de videovigilancia Dahua vehicular.',    prov:'Dahua',       vis:true},
  {id:'04-029',cat:'04 Video',sub:'Kit',            nom:'Kit de cámaras vehiculares',      desc:'Kit de cámaras interior/exterior vehiculares Dahua.',     prov:'Dahua',       vis:true},
  {id:'04-030',cat:'04 Video',sub:'Grabación',      nom:'Kit de grabación MNVR',           desc:'Grabador móvil MNVR Dahua con almacenamiento.',           prov:'Dahua',       vis:true},
  {id:'04-031',cat:'04 Video',sub:'ANPR',           nom:'Kit ANPR / lectura de placas',    desc:'Sistema de lectura automática de placas (ANPR).',         prov:'Dahua',       vis:true},
  {id:'04-032',cat:'04 Video',sub:'Monitor',        nom:'Monitor táctil vehicular',        desc:'Monitor táctil para visualización del sistema.',          prov:'Dahua',       vis:true},
  {id:'04-033',cat:'04 Video',sub:'Instalación',    nom:'Cableado e integración Dahua',    desc:'Cableado e integración del sistema Dahua.',               prov:'Dahua',       vis:true},
  {id:'04-K1', cat:'04 Video',sub:'Kit Completo',   nom:'Kit videovigilancia Dahua',       desc:'Cámaras, MNVR, ANPR, monitor táctil, cableado.',          prov:'Dahua',       vis:true},
  // 05 RADIO
  {id:'05-034',cat:'05 Radio',sub:'Radio',          nom:'Radio móvil',                     desc:'Radio móvil de comunicación.',                            prov:'Proveedor',   vis:true},
  {id:'05-035',cat:'05 Radio',sub:'Radio',          nom:'Radio portátil',                  desc:'Radio portátil de comunicación.',                         prov:'Proveedor',   vis:true},
  {id:'05-036',cat:'05 Radio',sub:'Antena',         nom:'Antena para radio',               desc:'Antena para radio móvil.',                                prov:'Proveedor',   vis:true},
  {id:'05-037',cat:'05 Radio',sub:'Servicio',       nom:'Programación de radio',           desc:'Programación de frecuencias y configuración.',            prov:'Proveedor',   vis:true},
  {id:'05-038',cat:'05 Radio',sub:'Accesorios',     nom:'Accesorios de radio',             desc:'Accesorios complementarios para radio.',                  prov:'Proveedor',   vis:true},
  {id:'05-K1', cat:'05 Radio',sub:'Kit TETRA',      nom:'Kit Radio Hytera TETRA',          desc:'Terminal móvil digital Hytera MT680 Plus S.',             prov:'Hytera',      vis:false},
  // 06 GPS
  {id:'06-039',cat:'06 GPS',sub:'Dispositivo',      nom:'GPS vehicular',                   desc:'Dispositivo GPS vehicular.',                              prov:'Proveedor',   vis:true},
  {id:'06-040',cat:'06 GPS',sub:'Antena',           nom:'Antena GPS',                      desc:'Antena externa GPS.',                                     prov:'Proveedor',   vis:true},
  {id:'06-041',cat:'06 GPS',sub:'Plataforma',       nom:'Plataforma de rastreo',           desc:'Suscripción / licencia plataforma de rastreo.',           prov:'Proveedor',   vis:true},
  {id:'06-042',cat:'06 GPS',sub:'Instalación',      nom:'Instalación GPS',                 desc:'Instalación y puesta en marcha de GPS.',                  prov:'Proveedor',   vis:true},
  // 07 CONSUMIBLES
  {id:'07-043',cat:'07 Consumibles',sub:'Eléctrico', nom:'Fusibles',                       desc:'Fusibles de protección.',                                 prov:'Proveedor',   vis:false},
  {id:'07-044',cat:'07 Consumibles',sub:'Eléctrico', nom:'Protecciones eléctricas',        desc:'Protecciones eléctricas y disyuntores.',                  prov:'Proveedor',   vis:false},
  {id:'07-045',cat:'07 Consumibles',sub:'Cableado',  nom:'Cableado menor',                 desc:'Cableado menor de instalación.',                          prov:'Proveedor',   vis:false},
  {id:'07-046',cat:'07 Consumibles',sub:'Conexión',  nom:'Conectores',                     desc:'Conectores de instalación.',                              prov:'Proveedor',   vis:false},
  {id:'07-049',cat:'07 Consumibles',sub:'Consumibles',nom:'Consumibles generales',         desc:'Consumibles generales de instalación.',                   prov:'Proveedor',   vis:true},
  // 08 MANO DE OBRA
  {id:'08-050',cat:'08 Mano de obra',sub:'Servicio', nom:'Mano de obra general',           desc:'Mano de obra general de equipamiento.',                   prov:'Interna',     vis:false},
  {id:'08-051',cat:'08 Mano de obra',sub:'Servicio', nom:'Instalación especial',           desc:'Instalación especial requerida por proyecto.',            prov:'Interna',     vis:false},
  {id:'08-052',cat:'08 Mano de obra',sub:'Servicio', nom:'Integración de sistemas',        desc:'Integración de sistemas y configuración.',                prov:'Interna',     vis:false},
  {id:'08-053',cat:'08 Mano de obra',sub:'Servicio', nom:'Revisión final',                 desc:'Pruebas y revisión final del vehículo.',                  prov:'Interna',     vis:false},
  {id:'08-P1', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 1 al equipo',             desc:'Premio 1 al equipo (por unidad).',                        prov:'Interna',     vis:false},
  {id:'08-P2', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 2 al equipo',             desc:'Premio 2 al equipo (por unidad).',                        prov:'Interna',     vis:false},
  // 09 TRASLADOS
  {id:'09-054',cat:'09 Traslados',sub:'Traslado',    nom:'Traslado unitario',              desc:'Traslado unitario del vehículo.',                         prov:'Logística',   vis:false},
  {id:'09-055',cat:'09 Traslados',sub:'Maniobras',   nom:'Maniobras',                      desc:'Maniobras de carga / descarga.',                          prov:'Logística',   vis:false},
  {id:'09-056',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega local',                  desc:'Entrega local del vehículo.',                             prov:'Logística',   vis:false},
  {id:'09-057',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega foránea',                desc:'Entrega foránea del vehículo.',                           prov:'Logística',   vis:false},
];
