// ─────────────────────────────────────────────────────────────
// excel.js  —  Exportación a Excel (usa window.XLSX global)
// ─────────────────────────────────────────────────────────────
import { STATUSES, FINAL_STATUS } from './constants.js';
import { fmt, daysUntil, alertLevel, TODAY } from './utils.js';

/** Crea y descarga un archivo Excel con múltiples hojas */
export function toExcel(sheets, filename) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = XLSX.utils.aoa_to_sheet(s.data);
    if (s.widths)   ws['!cols']   = s.widths.map(w => ({ wch: w }));
    if (s.merges)   ws['!merges'] = s.merges;
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    if (s.currCols) s.currCols.forEach(C => {
      for (let R = 1; R <= range.e.r; R++) {
        const a = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '"$"#,##0.00';
      }
    });
    if (s.pctCols) s.pctCols.forEach(C => {
      for (let R = 1; R <= range.e.r; R++) {
        const a = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '0"%"';
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

// ── Sheet builders ────────────────────────────────────────────

export const shProjects = (projects, vehicles, companies) => ({
  name: 'Proyectos',
  widths: [14,32,22,18,22,18,22,16,18,16,10,16,8,12,12,12,12,12],
  currCols: [11], pctCols: [10],
  data: [
    ['ID','Proyecto','Dependencia','No. licitación','Tipo procedimiento','Tipo producto',
     'Empresa','RFC empresa','Responsable','Estado','Probabilidad','Monto estimado',
     '# Vehículos','F. Publicación','F. Aclaraciones','F. Propuesta','F. Fallo','F. Contrato'],
    ...projects.map(p => {
      const s  = STATUSES.find(x => x.id === p.status);
      const co = companies.find(c => c.name === p.company);
      const vc = vehicles.filter(v => v.projectId === p.id).length;
      return [
        p.id, p.name, p.dependencia||'', p.numLicitacion||'', p.tipoProcedimiento||'',
        p.productType||'', p.company||'', co?.rfc||'', p.responsable||'',
        s ? s.label : p.status, p.probability||0, p.montoEstimado||0, vc,
        p.fechaPublicacion||'', p.fechaAclaraciones||'', p.fechaPropuesta||'',
        p.fechaFallo||'', p.fechaContrato||'',
      ];
    }),
  ],
});

export const shVehicles = (vehicles, projects) => ({
  name: 'Vehículos',
  widths: [20,12,16,16,8,12,16,14,28,14,12,14,16,16,16,14,14,14,14],
  currCols: [9,10,11],
  data: [
    ['VIN','Marca','Modelo','Versión','Año','Color','Núm. motor','Inventario',
     'Proyecto','Precio unit.','IVA','Total','Estatus docs','Estatus entrega',
     'Ubicación','F. Agencia','F. Equipo','F. Cliente','Acta entrega'],
    ...vehicles.map(v => {
      const p = projects.find(x => x.id === v.projectId);
      return [
        v.vin||'', v.marca||'', v.modelo||'', v.version||'', v.ano||'', v.color||'',
        v.numMotor||'', v.numInventario||'', p ? p.name : '—',
        v.precioUnitario||0, v.iva||0, v.precioTotal||0,
        v.statusDocs||'', v.statusEntrega||'', v.ubicacion||'',
        v.facturaAgencia?.folio||'', v.facturaEquipo?.folio||'',
        v.facturaGobierno?.folio||'', v.actaEntrega?.fechaEntrega||'',
      ];
    }),
  ],
});

export const shFacturas = (vehicles, projects) => ({
  name: 'Facturas',
  widths: [25,28,20,18,14,12,22,22,38,14,12,14,14],
  currCols: [9,10,11],
  data: [
    ['Tipo factura','Proyecto','VIN','Marca/Modelo','Folio','Fecha','Emisor',
     'Receptor','UUID','Subtotal','IVA','Total','Estatus pago'],
    ...vehicles.flatMap(v => {
      const p  = projects.find(x => x.id === v.projectId);
      const pn = p ? p.name : '—';
      const mm = `${v.marca||''} ${v.modelo||''}`;
      return [
        ['Agencia → Empresa',     'facturaAgencia'],
        ['Proveedor → Empresa',   'facturaEquipo'],
        ['Empresa → Cliente',     'facturaGobierno'],
      ].filter(([, k]) => v[k]?.folio)
       .map(([tipo, k]) => {
         const f = v[k];
         return [tipo, pn, v.vin||'', mm, f.folio, f.fecha||'', f.emisor||'',
                 f.receptor||'', f.uuid||'', f.subtotal||0, f.iva||0, f.total||0, f.statusPago||''];
       });
    }),
  ],
});

export const shPagos = (vehicles, projects) => ({
  name: 'Estatus de pagos',
  widths: [30,22,16,14,14,14,12],
  currCols: [4],
  data: [
    ['Proyecto','VIN/Mod','Folio cliente','Fecha factura','Monto','Estatus','Días desde factura'],
    ...vehicles.filter(v => v.facturaGobierno?.folio).map(v => {
      const p   = projects.find(x => x.id === v.projectId);
      const f   = v.facturaGobierno;
      const dias = f.fecha ? Math.floor((new Date() - new Date(f.fecha)) / (1000*60*60*24)) : 0;
      return [p ? p.name : '—', v.vin||(v.marca+' '+v.modelo), f.folio, f.fecha||'',
              f.total||0, f.statusPago||'Pendiente', dias];
    }),
  ],
});

export const shEntregas = (vehicles, projects) => ({
  name: 'Entregas',
  widths: [28,18,22,16,18,14,24],
  data: [
    ['Proyecto','VIN','Marca/Modelo','Estatus entrega','Ubicación','Fecha entrega','Recibe'],
    ...vehicles.map(v => {
      const p = projects.find(x => x.id === v.projectId);
      return [p ? p.name : '—', v.vin||'', `${v.marca} ${v.modelo}`,
              v.statusEntrega||'', v.ubicacion||'',
              v.actaEntrega?.fechaEntrega||'', v.actaEntrega?.recibe||''];
    }),
  ],
});

export const shEmpresas = (companies) => ({
  name: 'Empresas',
  widths: [28,16,22,14,32,8,16,24,22,12,12,40,40],
  data: [
    ['Empresa','RFC','Régimen','Situación','Domicilio','CP','Estado',
     'Notario','Notaría','Escritura','F. escritura','Objeto social','Socios'],
    ...companies.map(c => [
      c.name||'', c.rfc||'', c.regimen||'', c.situacion||'', c.address||'',
      c.cp||'', c.estado||'', c.notario||'', c.notaria||'', c.escritura||'',
      c.fechaEscritura||'', c.objetoSocial||'',
      (c.socios||[]).map(s => `${s.nombre} (${s.porcentaje}%)`).join('; '),
    ]),
  ],
});

export const shAlertas = (projects) => ({
  name: 'Alertas',
  widths: [32,22,14,8,16],
  data: [
    ['Proyecto','Tipo de fecha','Fecha','Días','Nivel'],
    ...projects.flatMap(p =>
      [
        ['Junta aclaraciones',   p.fechaAclaraciones],
        ['Presentación propuesta',p.fechaPropuesta],
        ['Fallo',                p.fechaFallo],
        ['Firma contrato',       p.fechaContrato],
      ]
      .filter(([, d]) => alertLevel(d))
      .map(([l, d]) => [p.name, l, d, daysUntil(d), alertLevel(d) === 'r' ? 'Crítico' : 'Próximo'])
    ).sort((a, b) => a[3] - b[3]),
  ],
});

export const shAuditoria = (audit) => ({
  name: 'Bitácora',
  widths: [20,22,18,14,22,40],
  data: [
    ['Fecha y hora','Usuario','Acción','Entidad','ID','Detalles'],
    ...audit.map(a => [
      new Date(a.timestamp).toLocaleString('es-MX'),
      a.userName||'', a.action||'', a.entity||'', a.entityId||'', a.details||'',
    ]),
  ],
});

export const shSumEjecutivo = (projects, vehicles, companies) => {
  const d   = TODAY();
  const ac  = projects.filter(p => !FINAL_STATUS.includes(p.status));
  const won = projects.filter(p => ['ganada','contrato','entrega','facturado','cobrado'].includes(p.status));
  const lost= projects.filter(p => p.status === 'perdida');
  const cancel = projects.filter(p => p.status === 'cancelada');
  const dec = won.length + lost.length;
  const conv = dec > 0 ? Math.round(won.length / dec * 100) : 0;
  const vTotal  = vehicles.length;
  const facGob  = vehicles.filter(v => v.facturaGobierno?.folio).length;
  const cobrado = vehicles.filter(v => v.facturaGobierno?.statusPago === 'Cobrada').length;
  const entregados = vehicles.filter(v => v.statusEntrega === 'Entregado').length;
  const totalAFact  = vehicles.reduce((s, v) => s + (v.precioTotal||0), 0);
  const yaFact      = vehicles.filter(v => v.facturaGobierno?.folio)
                              .reduce((s, v) => s + (v.facturaGobierno.total||0), 0);
  const yaCob       = vehicles.filter(v => v.facturaGobierno?.statusPago === 'Cobrada')
                              .reduce((s, v) => s + (v.facturaGobierno.total||0), 0);
  return {
    name: 'Resumen ejecutivo',
    widths: [36,16,18], currCols: [2],
    data: [
      ['REPORTE EJECUTIVO — LICITAPRO','',''],
      ['Generado', new Date().toLocaleString('es-MX'), ''],
      ['',''],
      ['INDICADORES GENERALES','',''],
      ['Indicador','Cantidad','Monto'],
      ['Proyectos totales', projects.length,''],
      ['Proyectos activos', ac.length, ac.reduce((s,p)=>s+(p.montoEstimado||0),0)],
      ['Proyectos ganados', won.length, won.reduce((s,p)=>s+(p.montoEstimado||0),0)],
      ['Proyectos perdidos', lost.length, lost.reduce((s,p)=>s+(p.montoEstimado||0),0)],
      ['Proyectos cancelados', cancel.length,''],
      ['Tasa de conversión', `${conv}%`,''],
      ['',''],
      ['VEHÍCULOS Y ENTREGAS','',''],
      ['Vehículos totales', vTotal,''],
      ['Entregados', `${entregados}/${vTotal}`,''],
      ['Facturados al cliente', `${facGob}/${vTotal}`,''],
      ['Cobrados', `${cobrado}/${vTotal}`,''],
      ['',''],
      ['FACTURACIÓN','',''],
      ['Total estimado','', totalAFact],
      ['Ya facturado','', yaFact],
      ['Por facturar','', totalAFact - yaFact],
      ['Ya cobrado','', yaCob],
      ['Por cobrar','', yaFact - yaCob],
      ['',''],
      ['POR ESTATUS','',''],
      ['Estatus','Proyectos','Monto'],
      ...STATUSES
        .map(s => { const it=projects.filter(p=>p.status===s.id); return it.length ? [s.label, it.length, it.reduce((sum,p)=>sum+(p.montoEstimado||0),0)] : null; })
        .filter(Boolean),
      ['',''],
      ['POR DEPENDENCIA','',''],
      ['Dependencia','Proyectos','Monto'],
      ...[...new Set(projects.map(p=>p.dependencia).filter(Boolean))]
        .map(dep => { const it=projects.filter(p=>p.dependencia===dep); return [dep, it.length, it.reduce((sum,p)=>sum+(p.montoEstimado||0),0)]; }),
    ],
  };
};
