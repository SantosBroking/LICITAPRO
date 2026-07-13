// catalog.js — Catálogo de productos (actualizado)
// vis:true = visible en cotización cliente
// vis:false = uso interno / mano de obra / logística

export const CATALOG_PRODUCTS = [

  // ── 01 IMAGEN ────────────────────────────────────────────────
  {id:'01-001',cat:'01 Imagen',sub:'Rotulación',     nom:'Rotulación institucional',          desc:'Rotulación exterior para identificar la unidad conforme a la imagen oficial, apegado al manual de identidad.',           prov:'Local', vis:true},
  {id:'01-002',price:15000,cat:'01 Imagen',sub:'Pintura',        nom:'Pintura institucional',             desc:'Pintura vehicular con colores y lineamientos oficiales del proyecto, apegado al manual de identidad.',                prov:'Local', vis:true},
  {id:'01-003',price:6500,cat:'01 Imagen',sub:'Vinil',          nom:'Calcas / vinil',                    desc:'Viniles y calcas de identificación para uso exterior vehicular, apegado al manual de identidad.',                            prov:'Local', vis:true},
  {id:'01-004',price:1500,cat:'01 Imagen',sub:'Identificación', nom:'Números económicos',                desc:'Numeración en vinil para control e identificación operativa, apegado al manual de identidad.',                   prov:'Local', vis:true},
  {id:'01-005',cat:'01 Imagen',sub:'Kit',            nom:'Kit Imagen institucional completa', desc:'Kit integral de rotulación, viniles y números económicos, apegado al manual de identidad.',   prov:'Local', vis:true},

  // ── 02 FIERROS ───────────────────────────────────────────────
  {id:'02-006',price:8300,cat:'02 Fierros',sub:'Estructura',    nom:'Roll bar',                          desc:'Estructura tubular para caja de pickup, fabricada en acabado resistente, apegado al manual de identidad.',                                  prov:'Taller',vis:true},
  {id:'02-007',price:6000,cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica',          desc:'Defensa frontal metálica para protección de la unidad, apegado al manual de identidad.',                         prov:'Taller',vis:true},
  {id:'02-008',price:6000,cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica sedan',    desc:'Defensa frontal metálica para sedán operativo o patrulla, apegado al manual de identidad.',                                prov:'Taller',vis:true},
  {id:'02-009',price:6000,cat:'02 Fierros',sub:'Protección',    nom:'Burrera central metálica van',      desc:'Defensa frontal metálica para van o unidad de transporte, apegado al manual de identidad.',                                  prov:'Taller',vis:true},
  {id:'02-010',price:6000,cat:'02 Fierros',sub:'Protección',    nom:'Burrera central silicón',           desc:'Defensa frontal con acabado tipo silicón para uso urbano, apegado al manual de identidad.',                       prov:'Taller',vis:true},
  {id:'02-011',price:6550,cat:'02 Fierros',sub:'Protección',    nom:'Defensa trasera antiderrapante',    desc:'Defensa o escalón trasero con superficie antiderrapante, apegado al manual de identidad.',              prov:'Taller',vis:true},
  {id:'02-012',price:4400,cat:'02 Fierros',sub:'Protección',    nom:'Protector de ventana tipo rejilla', desc:'Protector metálico para ventanas de unidades policiales, apegado al manual de identidad.',                   prov:'Taller',vis:true},
  {id:'02-013',price:5800,cat:'02 Fierros',sub:'Interior',      nom:'Mampara Divisora',                  desc:'Mampara interior para separar áreas de la unidad, apegado al manual de identidad.',                   prov:'Taller',vis:true},
  {id:'02-014',price:5300,cat:'02 Fierros',sub:'Interior',      nom:'Banca central metálica',            desc:'Banca metálica para área posterior de pickup o patrulla, apegado al manual de identidad.',         prov:'Taller',vis:true},
  {id:'02-015',price:1500,cat:'02 Fierros',sub:'Soporte',       nom:'Soporte para radio',                desc:'Base metálica para montaje seguro de radio, apegado al manual de identidad.',                               prov:'Taller',vis:true},
  {id:'02-016',price:3357.76,cat:'02 Fierros',sub:'Adaptación',    nom:'Lona con ventanas laterales',       desc:'Lona para caja de pickup con ventanas laterales, apegado al manual de identidad.',                           prov:'Taller',vis:true},
  {id:'02-017',price:1000,cat:'02 Fierros',sub:'Adaptación',    nom:'Adaptación especial',               desc:'Modificación metálica especial según requerimiento del proyecto, apegado al manual de identidad.',               prov:'Taller',vis:true},

  // Kits Fierros
  {id:'02-K1',cat:'02 Fierros',sub:'Kit Pickup Full', nom:'Kit fierros Pickup Full',
   desc:'Kit completo de protección y estructuras para pickup patrulla, apegado al manual de identidad.',
   prov:'Taller',vis:true,
   kitItems:['02-006','02-007','02-011','02-012','02-014','02-016','02-017']},

  {id:'02-K2',cat:'02 Fierros',sub:'Kit Pickup Leve', nom:'Kit fierros Pickup Leve',
   desc:'Kit básico de estructuras metálicas para pickup, apegado al manual de identidad.',
   prov:'Taller',vis:true,
   kitItems:['02-006','02-007','02-011','02-014']},

  {id:'02-K3',cat:'02 Fierros',sub:'Kit SUV Full', nom:'Kit fierros SUV Full',
   desc:'Kit completo de estructuras metálicas para SUV patrulla, apegado al manual de identidad.',
   prov:'Taller',vis:true,
   kitItems:['02-007','02-011','02-012','02-013','02-017']},

  {id:'02-K4',cat:'02 Fierros',sub:'Kit SUV Leve', nom:'Kit fierros SUV Leve',
   desc:'Kit básico de protección metálica para SUV, apegado al manual de identidad.',
   prov:'Taller',vis:true,
   kitItems:['02-007','02-012']},

  // ── 03 LUCES / SIRENAS ───────────────────────────────────────
  {id:'03-018',cat:'03 Luces / Sirenas',sub:'Torreta',       nom:'Torreta LED roja y azul grande',         desc:'Torreta LED grande para señalización policial de alta visibilidad, apegado al manual de identidad.',                            prov:'CENTRA/Code3',vis:true},
  {id:'03-019',cat:'03 Luces / Sirenas',sub:'Torreta',       nom:'Torreta LED roja y azul chica',          desc:'Torreta LED compacta para unidades de patrullaje, apegado al manual de identidad.',                             prov:'CENTRA/Code3',vis:true},
  {id:'03-020',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luz interior',                           desc:'Luz interior para mejorar visibilidad dentro de la unidad, apegado al manual de identidad.',                                     prov:'CENTRA/Code3',vis:true},
  {id:'03-021',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Módulo LED flexible',                    desc:'Módulo LED auxiliar para instalación vehicular, apegado al manual de identidad.',                                  prov:'CENTRA/Code3',vis:true},
  {id:'03-022',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces laterales LED',                    desc:'Luces laterales para mayor visibilidad operativa, apegado al manual de identidad.',                                  prov:'CENTRA/Code3',vis:true},
  {id:'03-023',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces estroboscópicas Torreta',          desc:'Luces estroboscópicas para señalización de emergencia, apegado al manual de identidad.',                                 prov:'CENTRA/Code3',vis:true},
  {id:'03-024',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luces LED Viseras',                      desc:'Luces LED para viseras o interiores de unidad, apegado al manual de identidad.',                              prov:'CENTRA/Code3',vis:true},
  {id:'03-025',cat:'03 Luces / Sirenas',sub:'Iluminación',   nom:'Luz LED circular',                       desc:'Luz LED circular para iluminación interior o auxiliar, apegado al manual de identidad.',                                     prov:'CENTRA/Code3',vis:true},
  {id:'03-026',cat:'03 Luces / Sirenas',sub:'Sonido',        nom:'Sirena policial con bocina',             desc:'Sistema de sirena con bocina para advertencia sonora, apegado al manual de identidad.',            prov:'CENTRA/Code3',vis:true},
  {id:'03-028',cat:'03 Luces / Sirenas',sub:'Control',       nom:'Controlador electrónico de luces y sirena', desc:'Controlador para operar luces y sirena desde cabina, apegado al manual de identidad.',                       prov:'CENTRA/Code3',vis:true},
  {id:'03-029',cat:'03 Luces / Sirenas',sub:'Control',       nom:'Mando para bocina',                      desc:'Mando de operación para bocina o funciones sonoras, apegado al manual de identidad.',                                       prov:'CENTRA/Code3',vis:true},
  {id:'03-030',cat:'03 Luces / Sirenas',sub:'Adaptación',    nom:'Adaptación especial luces',              desc:'Integración especial de iluminación según proyecto, apegado al manual de identidad.',             prov:'CENTRA/Code3',vis:true},

  // Kits Luces
  {id:'03-K1',cat:'03 Luces / Sirenas',sub:'Kit Patrulla Full', nom:'Kit Sistema integral Patrulla Full',
   desc:'Kit completo de luces, sirena y controladores, apegado al manual de identidad.',
   prov:'CENTRA/Code3',vis:true,
   kitItems:['03-018','03-020','03-021','03-022','03-023','03-024','03-026','03-028','03-029','03-030']},

  {id:'03-K2',cat:'03 Luces / Sirenas',sub:'Kit Patrulla Leve', nom:'Kit Sistema integral Patrulla Leve',
   desc:'Kit básico de luces y sirena para patrulla, apegado al manual de identidad.',
   prov:'CENTRA/Code3',vis:true,
   kitItems:['03-018','03-021','03-026','03-028','03-029','03-030']},

  // ── 04 VIDEO ─────────────────────────────────────────────────
  {id:'04-028',cat:'04 Video',sub:'Sistema',        nom:'Sistema videovigilancia Full',       desc:'Sistema completo de video vehicular para monitoreo y grabación, apegado al manual de identidad.',prov:'Dahua',vis:true},
  {id:'04-029',cat:'04 Video',sub:'Sistema',        nom:'Sistema videovigilancia Leve',       desc:'Sistema básico de videovigilancia para unidad operativa, apegado al manual de identidad.',                   prov:'Dahua',vis:true},
  {id:'04-030',cat:'04 Video',sub:'Grabación',      nom:'Grabador MNVR',                      desc:'Grabador vehicular para almacenamiento de video en patrulla, apegado al manual de identidad.',                        prov:'Dahua',vis:true},
  {id:'04-031',cat:'04 Video',sub:'ANPR',           nom:'Cámara ANPR / lectura de placas',    desc:'Cámara para lectura automática de placas vehiculares, apegado al manual de identidad.',                      prov:'Dahua',vis:true},
  {id:'04-032',cat:'04 Video',sub:'Cámara',         nom:'Cámara domo',                        desc:'Cámara tipo domo para monitoreo interior o exterior, apegado al manual de identidad.',                                               prov:'Dahua',vis:true},
  {id:'04-033',cat:'04 Video',sub:'Monitor',        nom:'Monitor táctil vehicular',           desc:'Monitor táctil para visualización y control en cabina, apegado al manual de identidad.',                       prov:'Dahua',vis:true},
  {id:'04-034',cat:'04 Video',sub:'Instalación',    nom:'Cableado e integración',             desc:'Cableado e integración de equipos de video vehicular, apegado al manual de identidad.',                         prov:'Dahua',vis:true},
  {id:'04-035',cat:'04 Video',sub:'Adaptación',     nom:'Adaptaciones especiales video',      desc:'Adaptaciones de video según requerimiento del proyecto, apegado al manual de identidad.',                        prov:'Dahua',vis:true},

  // ── 05 RADIO ─────────────────────────────────────────────────
  {id:'05-034',cat:'05 Radio',sub:'Radio',          nom:'Radio móvil',                        desc:'Radio móvil para comunicación operativa en unidad, apegado al manual de identidad.',                                         prov:'Proveedor',vis:true},
  {id:'05-035',cat:'05 Radio',sub:'Radio',          nom:'Radio portátil',                     desc:'Radio portátil para comunicación en campo, apegado al manual de identidad.',                                      prov:'Proveedor',vis:true},
  {id:'05-036',cat:'05 Radio',sub:'Antena',         nom:'Antena para radio',                  desc:'Antena vehicular para mejorar transmisión y recepción, apegado al manual de identidad.',                                             prov:'Proveedor',vis:true},
  {id:'05-037',cat:'05 Radio',sub:'Servicio',       nom:'Programación de radio',              desc:'Configuración de frecuencias y parámetros operativos, apegado al manual de identidad.',                         prov:'Proveedor',vis:true},
  {id:'05-038',cat:'05 Radio',sub:'Accesorios',     nom:'Accesorios de radio',                desc:'Accesorios para instalación y uso de radios, apegado al manual de identidad.',                               prov:'Proveedor',vis:true},
  {id:'05-K1', cat:'05 Radio',sub:'Kit TETRA',      nom:'Kit Radio Hytera TETRA',
   desc:'Terminal móvil digital Hytera MT680 Plus S. Incluye: Radio móvil, Antena, Programación, Accesorios.',
   prov:'Hytera',vis:true,
   kitItems:['05-034','05-036','05-037','05-038']},

  // ── 06 GPS ───────────────────────────────────────────────────
  {id:'06-039',cat:'06 GPS',sub:'Dispositivo',      nom:'GPS vehicular',                      desc:'GPS para rastreo y monitoreo de unidades, apegado al manual de identidad.',                                           prov:'Proveedor',vis:true},
  {id:'06-040',cat:'06 GPS',sub:'Antena',           nom:'Antena GPS',                         desc:'Antena para mejorar recepción del sistema GPS, apegado al manual de identidad.',                                                  prov:'Proveedor',vis:true},
  {id:'06-041',cat:'06 GPS',sub:'Plataforma',       nom:'Plataforma de rastreo',              desc:'Plataforma para monitoreo y control de flotilla, apegado al manual de identidad.',                        prov:'Proveedor',vis:true},
  {id:'06-042',cat:'06 GPS',sub:'Instalación',      nom:'Instalación GPS',                    desc:'Instalación de GPS vehicular ordenada y funcional, apegado al manual de identidad.',                               prov:'Proveedor',vis:true},

  // ── 07 CONSUMIBLES Y EXTRAS ──────────────────────────────────
  {id:'07-043',cat:'07 Consumibles',sub:'Eléctrico', nom:'Fusibles',                          desc:'Fusibles para protección de circuitos eléctricos, apegado al manual de identidad.',                                              prov:'Proveedor',vis:false},
  {id:'07-045',cat:'07 Consumibles',sub:'Cableado',  nom:'Cableado menor',                    desc:'Cableado auxiliar para integración vehicular, apegado al manual de identidad.',                                       prov:'Proveedor',vis:false},
  {id:'07-046',cat:'07 Consumibles',sub:'Conexión',  nom:'Conectores',                        desc:'Conectores eléctricos para instalación segura, apegado al manual de identidad.',                                           prov:'Proveedor',vis:false},
  {id:'07-049',price:4000,cat:'07 Consumibles',sub:'General',   nom:'Consumibles generales',             desc:'Materiales menores para instalación y adaptación, apegado al manual de identidad.',                                prov:'Proveedor',vis:true},
  {id:'07-050',price:1500,cat:'07 Consumibles',sub:'Extra',     nom:'Extras',                            desc:'Conceptos adicionales requeridos por proyecto, apegado al manual de identidad.',                                      prov:'Proveedor',vis:true},

  // ── 08 MANO DE OBRA ──────────────────────────────────────────
  {id:'08-050',price:15000,cat:'08 Mano de obra',sub:'Servicio', nom:'Mano de obra general',              desc:'Servicio de instalación e integración general de equipos, apegado al manual de identidad.',                                prov:'Interna',vis:false},
  {id:'08-051',cat:'08 Mano de obra',sub:'Servicio', nom:'Instalación especial',              desc:'Instalación específica para equipos o adaptaciones especiales, apegado al manual de identidad.',                         prov:'Interna',vis:false},
  {id:'08-052',cat:'08 Mano de obra',sub:'Servicio', nom:'Integración de sistemas',           desc:'Integración de sistemas eléctricos, video, luces o radio, apegado al manual de identidad.',                             prov:'Interna',vis:false},
  {id:'08-053',cat:'08 Mano de obra',sub:'Servicio', nom:'Revisión final',                    desc:'Revisión de funcionamiento y acabados antes de entrega, apegado al manual de identidad.',                               prov:'Interna',vis:false},
  {id:'08-P1', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 1 al equipo',                desc:'Premio 1 al equipo (por unidad).',                                     prov:'Interna',vis:false},
  {id:'08-P2', cat:'08 Mano de obra',sub:'Premio',   nom:'Premio 2 al equipo',                desc:'Premio 2 al equipo (por unidad).',                                     prov:'Interna',vis:false},

  // ── 09 TRASLADOS ─────────────────────────────────────────────
  {id:'09-054',cat:'09 Traslados',sub:'Traslado',    nom:'Traslado unitario',                 desc:'Traslado individual de unidad para equipamiento o entrega, apegado al manual de identidad.',                                      prov:'Logística',vis:false},
  {id:'09-055',cat:'09 Traslados',sub:'Maniobras',   nom:'Maniobras',                         desc:'Maniobras de carga, descarga o acomodo operativo, apegado al manual de identidad.',                                       prov:'Logística',vis:false},
  {id:'09-056',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega local',                     desc:'Entrega local de unidad equipada en zona acordada, apegado al manual de identidad.',                                          prov:'Logística',vis:false},
  {id:'09-057',cat:'09 Traslados',sub:'Entrega',     nom:'Entrega foránea',                   desc:'Entrega foránea de unidad equipada en destino específico, apegado al manual de identidad.',                                        prov:'Logística',vis:false},
];

// Mapa de kits para referencia rápida
export const KIT_MAP = {};
CATALOG_PRODUCTS.filter(p => p.kitItems).forEach(p => { KIT_MAP[p.id] = p.kitItems; });
