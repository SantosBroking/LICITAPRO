// CotizacionOperativa.js — Fase 2A4: vista de Cotización para empleado.
//
// Deliberadamente separada de Cotizacion.js (CotizacionTab, admin-only) —
// ver diagnóstico de Fase 2A4: CotizacionTab llama calcCotizacion en cada
// edición para recalcular montoEstimado, y sus campos operativos/
// financieros viven entrelazados en el mismo bloque JSX. Reutilizarla con
// datos saneados produciría cifras incorrectas, no solo un riesgo de
// confidencialidad. Este archivo nunca debe:
// - importar calcCotizacion, pdf_export.js, firmas.js, ai_analyzer.js, ni
//   AIAnalyzerButton;
// - usar costoMSMS, costoConIVA, precioLista, utilidadDeseada, utilidadPct,
//   modoPrecio, techo, montoGanar, retornos, fianzas, DPP,
//   condicionesComerciales, ni condicionesLista;
// - mostrar botones de PDF, IA financiera, ni Orden de Compra.
//
// project que recibe ya viene saneado por App.js (sanitizeProjectForRole)
// antes de llegar aquí — este componente no necesita sanear nada por su
// cuenta, pero tampoco debe asumir que puede leer campos financieros si
// alguna vez cambiara ese contrato.

import { h, useState } from '../lib/core.js';
import { Metric } from '../ui/primitives.js';

const SUBTABS = ['resumen', 'partidas', 'equipo'];
const SUBTAB_LABELS = { resumen: 'Resumen', partidas: 'Partidas', equipo: 'Equipo' };

export default function CotizacionOperativa({ project, onUpdate, activeTab, setActiveTab }) {
  const [_localTab, _setLocalTab] = useState(activeTab || 'resumen');
  const tab = activeTab || _localTab;
  const setTab = (t) => { _setLocalTab(t); if (setActiveTab) setActiveTab(t); };

  const cot = project.cotizacion || {};

  return h('div', null,
    h('div', { style:{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--b1)', overflowX:'auto' } },
      SUBTABS.map(t => h('button', { key:t, className:'tab'+(tab===t?' active':''), onClick:()=>setTab(t), style:{ flexShrink:0, whiteSpace:'nowrap' } }, SUBTAB_LABELS[t]))
    ),

    // ══ Resumen operativo ══
    tab==='resumen' && h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12 } },
      h(Metric, { label:'Proyecto', value:project.name || '—' }),
      h(Metric, { label:'Cliente / Dependencia', value:project.dependencia || '—' }),
      h(Metric, { label:'Tipo de procedimiento', value:project.tipoProcedimiento || '—' }),
      h(Metric, { label:'Estatus', value:project.status || '—' }),
      h(Metric, { label:'Responsable', value:project.responsable || '—' }),
      h(Metric, { label:'Monto estimado', value: project.montoEstimado ? ('$'+Number(project.montoEstimado).toLocaleString('es-MX')) : '—' }),
      h(Metric, { label:'Folio de cotización', value: cot.folio || '—' }),
      h(Metric, { label:'Fecha de cotización', value: cot.fechaCotizacion || '—' }),
    ),

    // ══ Partidas — se construye en el siguiente commit ══
    tab==='partidas' && h('div', { className:'empty' }, h('h3', null, 'Partidas'), h('p', null, 'Próximamente.')),

    // ══ Equipo — se construye en el siguiente commit ══
    tab==='equipo' && h('div', { className:'empty' }, h('h3', null, 'Equipo'), h('p', null, 'Próximamente.')),
  );
}
