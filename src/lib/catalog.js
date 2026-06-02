// catalog.js — Catálogo de productos MSMS CORP (actualizado)
// vis:true = visible en cotización cliente
// vis:false = uso interno / mano de obra / logística

export const CATALOG_PRODUCTS = [

  // ── 01 IMAGEN ────────────────────────────────────────────────
  {id:'01-001',cat:'01 Imagen',sub:'Rotulación',     nom:'Rotulación institucional',          desc:'Rotulación institucional completa según manual de imagen.',           prov:'Local', vis:true},
  {id:'01-002',cat:'01 Imagen',sub:'Pintura',        nom:'Pintura institucional',             desc:'Pintura institucional con esquema de la dependencia.',                prov:'Local', vis:true},
  {id:'01-003',cat:'01 Imagen',sub:'Vinil',          nom:'Calcas / vinil',                    desc:'Aplicación de calcas y vinil reflejante.',                            prov:'Local', vis:true},
  {id:'01-004',cat:'01 Imagen',sub:'Identificación', nom:'Números económicos',                desc:'Aplicación de números económicos institucionales.',                   prov:'Local', vis:true},
  {id:'01-005',cat:'01 Imagen',sub:'Kit',            nom:'Kit Imagen institucional completa', desc:'Paquete integral de imagen (pintura, vinil, rotulación, números).',   prov:'Local', vis:true},

  // ── 02 FIERROS ───────────────────────────────────────────────
  {id:'02-006',cat:'02 Fierros',sub:'Estructura',    nom:'Roll bar',                          desc:'Roll bar de seguridad para cabina.',                                  prov:'Taller',vis:true},
  {id:'02-007',cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica',          desc:'Burrera central metálica tubular reforzada.',                         prov:'Taller',vis:true},
  {id:'02-008',cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica sedan',    desc:'Burrera central metálica para sedan.',                                prov:'Taller',vis:true},
  {id:'02-009',cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica van',      desc:'Burrera central metálica para van.',                                  prov:'Taller',vis:true},
  {id:'02-010',cat:'02 Fierros',sub:'Protección',    nom:'Burrera central silicón',           desc:'Burrera central con recubrimiento de silicón.',                       prov:'Taller',vis:true},
  {id:'02-011',cat:'02 Fierros',sub:'Protección',    nom:'Defensa trasera antiderrapante',    desc:'Defensa trasera tubular con superficie antiderrapante.',              prov:'Taller',vis:true},
  {id:'02-012',cat:'02 Fierros',sub:'Protección',    nom:'Protector de ventana tipo rejilla', desc:'Protectores metálicos tipo rejilla para ventanas.',                   prov:'Taller',vis:true},
  {id:'02-013',cat:'02 Fierros',sub:'Interior',      nom:'Mampara Divisora',                  desc:'Mampara separadora entre cabina y área operativa.',                   prov:'Taller',vis:true},
  {id:'02-014',cat:'02 Fierros',sub:'Interior',      nom:'Banca central metálica',            desc:'Banca central trasera metálica para traslado de detenidos.',         prov:'Taller',vis:true},
  {id:'02-015',cat:'02 Fierros',sub:'Soporte',       nom:'Soporte para radio',                desc:'Base de instalación para radio móvil.',                               prov:'Taller',vis:true},
  {id:'02-016',cat:'02 Fierros',sub:'Adaptación',    nom:'Lona con ventanas laterales',       desc:'Lona con ventanas laterales para pick-up.',                           prov:'Taller',vis:true},
  {id:'02-017',cat:'02 Fierros',sub:'Adaptación',    nom:'Adaptación especial',               desc:'Adaptación especial según requerimiento del proyecto.',               prov:'Taller',vis:true},

  // Kits Fierros
  {id:'02-K1',cat:'02 Fierros',sub:'Kit Pickup Full', nom:'Kit fierros Pickup Full',
   desc:'Incluye: Roll bar, Burrera metálica, Defensa trasera, Protector ventana, Banca central, Lona con ventanas, Adaptación especial.',
   prov:'Taller',vis:true,
   kitItems:['02-006','02-007','02-011','02-012','02-014','02-016','02-017']},

  {id:'02-K2',cat:'02 Fierros',sub:'Kit Pickup Leve', nom:'Kit fierros Pickup Leve',
   desc:'Incluye: Roll bar, Burrera metálica, Defensa trasera, Banca central.',
   prov:'Taller',vis:true,
   kitItems:['02-006','02-007','02-011','02-014']},

  {id:'02-K3',cat:'02 Fierros',sub:'Kit SUV Full', nom:'Kit fierros SUV Full',
   desc:'Incluye: Burrera metálica, Defensa trasera, Protector ventana, Mampara divisora, Adaptación especial.',
   prov:'Taller',vis:true,
   kitItems:['02-007','02-011','02-012','02-013','02-017']},

  {id:'02-K4',cat:'02 Fierros',sub:'Kit SUV Leve', nom:'Kit fierros SUV Leve',
   desc:'Incluye: Burrera metálica, Protector de ventana.',
   prov:'Taller',vis:true,
   kitItems:['02-007','02-012']},

  // ── 03 LUCES / SIRENAS ───────────────────────────────────────
  {id:'03-018',cat:'03 Luces / Sirenas',sub:'Torreta',       nom:'Torreta LED roja y azul grande',         desc:'Torreta LED grande roja y azul de techo.',                            prov:'CENTRA/Code3',vis:true},
  {id:'03-019',cat:'03 Luces / Sirenas',sub:'Torreta',       nom:'Torreta LED roja y azul chica',          desc:'Torreta LED chica roja y azul de techo.',                             prov:'CENTRA/Code3',vis:true},
  {id:'03-020',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luz interior',                           desc:'Luz LED interior de emergencia.',                                     prov:'CENTRA/Code3',vis:true},
  {id:'03-021',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Módulo LED flexible',                    desc:'Módulo LED flexible de emergencia.',                                  prov:'CENTRA/Code3',vis:true},
  {id:'03-022',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces laterales LED',                    desc:'Luces LED laterales de emergencia.',                                  prov:'CENTRA/Code3',vis:true},
  {id:'03-023',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces estroboscópicas Torreta',          desc:'Luces estroboscópicas para torreta.',                                 prov:'CENTRA/Code3',vis:true},
  {id:'03-024',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces LED Viseras',                      desc:'Luces LED para viseras del parabrisas.',                              prov:'CENTRA/Code3',vis:true},
  {id:'03-025',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luz LED circular',                       desc:'Luz LED circular de emergencia.',                                     prov:'CENTRA/Code3',vis:true},
  {id:'03-026',cat:'03 Luces / Sirenas',sub:'Sonido',        nom:'Sirena policial con bocina',             desc:'Sirena electrónica multitono con bocina de alta potencia.',            prov:'CENTRA/Code3',vis:true},
  {id:'03-028',cat:'03 Luces / Sirenas',sub:'Control',       nom:'Controlador electrónico de luces y sirena', desc:'Controlador electrónico de luces y sirena.',                       prov:'CENTRA/Code3',vis:true},
  {id:'03-029',cat:'03 Luces / Sirenas',sub:'Control',       nom:'Mando para bocina',                      desc:'Mando de control para bocina.',                                       prov:'CENTRA/Code3',vis:true},
  {id:'03-030',cat:'03 Luces / Sirenas',sub:'Adaptación',    nom:'Adaptación especial luces',              desc:'Adaptación especial de sistema de luces según proyecto.',             prov:'CENTRA/Code3',vis:true},

  // Kits Luces
  {id:'03-K1',cat:'03 Luces / Sirenas',sub:'Kit Patrulla Full', nom:'Kit Sistema integral Patrulla Full',
   desc:'Incluye: Torreta grande, Luz interior, Módulo LED flexible, Luces laterales, Estroboscópicas, LED Viseras, Sirena, Bocina, Controlador, Mando, Adaptación.',
   prov:'CENTRA/Code3',vis:true,
   kitItems:['03-018','03-020','03-021','03-022','03-023','03-024','03-026','03-028','03-029','03-030']},

  {id:'03-K2',cat:'03 Luces / Sirenas',sub:'Kit Patrulla Leve', nom:'Kit Sistema integral Patrulla Leve',
   desc:'Incluye: Torreta grande, Módulo LED flexible, Sirena, Bocina, Controlador, Mando, Adaptación.',
   prov:'CENTRA/Code3',vis:true,
   kitItems:['03-018','03-021','03-026','03-028','03-029','03-030']},

  // ── 04 VIDEO ─────────────────────────────────────────────────
  {id:'04-028',cat:'04 Video',sub:'Sistema',        nom:'Sistema videovigilancia Full',       desc:'Sistema completo de videovigilancia Dahua vehicular con todas las cámaras.',prov:'Dahua',vis:true},
  {id:'04-029',cat:'04 Video',sub:'Sistema',        nom:'Sistema videovigilancia Leve',       desc:'Sistema de videovigilancia Dahua vehicular básico.',                   prov:'Dahua',vis:true},
  {id:'04-030',cat:'04 Video',sub:'Grabación',      nom:'Grabador MNVR',                      desc:'Grabador móvil MNVR Dahua con almacenamiento.',                        prov:'Dahua',vis:true},
  {id:'04-031',cat:'04 Video',sub:'ANPR',           nom:'Cámara ANPR / lectura de placas',    desc:'Sistema de lectura automática de placas (ANPR).',                      prov:'Dahua',vis:true},
  {id:'04-032',cat:'04 Video',sub:'Cámara',         nom:'Cámara domo',                        desc:'Cámara domo vehicular.',                                               prov:'Dahua',vis:true},
  {id:'04-033',cat:'04 Video',sub:'Monitor',        nom:'Monitor táctil vehicular',           desc:'Monitor táctil para visualización del sistema.',                       prov:'Dahua',vis:true},
  {id:'04-034',cat:'04 Video',sub:'Instalación',    nom:'Cableado e integración',             desc:'Cableado e integración del sistema de video.',                         prov:'Dahua',vis:true},
  {id:'04-035',cat:'04 Video',sub:'Adaptación',     nom:'Adaptaciones especiales video',      desc:'Adaptaciones especiales del sistema de video.',                        prov:'Dahua',vis:true},

  // ── 05 RADIO ─────────────────────────────────────────────────
  {id:'05-034',cat:'05 Radio',sub:'Radio',          nom:'Radio móvil',                        desc:'Radio móvil de comunicación.',                                         prov:'Proveedor',vis:true},
  {id:'05-035',cat:'05 Radio',sub:'Radio',          nom:'Radio portátil',                     desc:'Radio portátil de comunicación.',                                      prov:'Proveedor',vis:true},
  {id:'05-036',cat:'05 Radio',sub:'Antena',         nom:'Antena para radio',                  desc:'Antena para radio móvil.',                                             prov:'Proveedor',vis:true},
  {id:'05-037',cat:'05 Radio',sub:'Servicio',       nom:'Programación de radio',              desc:'Programación de frecuencias y configuración.',                         prov:'Proveedor',vis:true},
  {id:'05-038',cat:'05 Radio',sub:'Accesorios',     nom:'Accesorios de radio',                desc:'Accesorios complementarios para radio.',                               prov:'Proveedor',vis:true},
  {id:'05-K1', cat:'05 Radio',sub:'Kit TETRA',      nom:'Kit Radio Hytera TETRA',
   desc:'Terminal móvil digital Hytera MT680 Plus S. Incluye: Radio móvil, Antena, Programación, Accesorios.',
   prov:'Hytera',vis:true,
   kitItems:['05-034','05-036','05-037','05-038']},

  // ── 06 GPS ───────────────────────────────────────────────────
  {id:'06-039',cat:'06 GPS',sub:'Dispositivo',      nom:'GPS vehicular',                      desc:'Dispositivo GPS vehicular.',                                           prov:'Proveedor',vis:true},
  {id:'06-040',cat:'06 GPS',sub:'Antena',           nom:'Antena GPS',                         desc:'Antena externa GPS.',                                                  prov:'Proveedor',vis:true},
  {id:'06-041',cat:'06 GPS',sub:'Plataforma',       nom:'Plataforma de rastreo',              desc:'Suscripción / licencia plataforma de rastreo.',                        prov:'Proveedor',vis:true},
  {id:'06-042',cat:'06 GPS',sub:'Instalación',      nom:'Instalación GPS',                    desc:'Instalación y puesta en marcha de GPS.',                               prov:'Proveedor',vis:true},

  // ── 07 CONSUMIBLES Y EXTRAS ──────────────────────────────────
  {id:'07-043',cat:'07 Consumibles',sub:'Eléctrico', nom:'Fusibles',                          desc:'Fusibles de protección.',                                              prov:'Proveedor',vis:false},
  {id:'07-045',cat:'07 Consumibles',sub:'Cableado',  nom:'Cableado menor',                    desc:'Cableado menor de instalación.',                                       prov:'Proveedor',vis:false},
  {id:'07-046',cat:'07 Consumibles',sub:'Conexión',  nom:'Conectores',                        desc:'Conectores de instalación.',                                           prov:'Proveedor',vis:false},
  {id:'07-049',cat:'07 Consumibles',sub:'General',   nom:'Consumibles generales',             desc:'Consumibles generales de instalación.',                                prov:'Proveedor',vis:true},
  {id:'07-050',cat:'07 Consumibles',sub:'Extra',     nom:'Extras',                            desc:'Conceptos extra según proyecto.',                                      prov:'Proveedor',vis:true},

  // ── 08 MANO DE OBRA ──────────────────────────────────────────
  {id:'08-050',cat:'08 Mano de obra',sub:'Servicio', nom:'Mano de obra general',              desc:'Mano de obra general de equipamiento.',                                prov:'Interna',vis:false},
  {id:'08-051',cat:'08 Mano de obra',sub:'Servicio', nom:'Instalación especial',              desc:'Instalación especial requerida por proyecto.',                         prov:'Interna',vis:false},
  {id:'08-052',cat:'08 Mano de obra',sub:'Servicio', nom:'Integración de sistemas',           desc:'Integración de sistemas y configuración.',                             prov:'Interna',vis:false},
  {id:'08-053',cat:'08 Mano de obra',sub:'Servicio', nom:'Revisión final',                    desc:'Pruebas y revisión final del vehículo.',                               prov:'Interna',vis:false},
  {id:'08-P1', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 1 al equipo',                desc:'Premio 1 al equipo (por unidad).',                                     prov:'Interna',vis:false},
  {id:'08-P2', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 2 al equipo',                desc:'Premio 2 al equipo (por unidad).',                                     prov:'Interna',vis:false},

  // ── 09 TRASLADOS ─────────────────────────────────────────────
  {id:'09-054',cat:'09 Traslados',sub:'Traslado',    nom:'Traslado unitario',                 desc:'Traslado unitario del vehículo.',                                      prov:'Logística',vis:false},
  {id:'09-055',cat:'09 Traslados',sub:'Maniobras',   nom:'Maniobras',                         desc:'Maniobras de carga / descarga.',                                       prov:'Logística',vis:false},
  {id:'09-056',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega local',                     desc:'Entrega local del vehículo.',                                          prov:'Logística',vis:false},
  {id:'09-057',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega foránea',                   desc:'Entrega foránea del vehículo.',                                        prov:'Logística',vis:false},
];

// Mapa de kits para referencia rápida
export const KIT_MAP = {};
CATALOG_PRODUCTS.filter(p => p.kitItems).forEach(p => { KIT_MAP[p.id] = p.kitItems; });
