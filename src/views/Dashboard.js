// Dashboard.js — Panel principal con KPIs y alertas
import { h, useMemo } from '../lib/core.js';
import { STATUSES, FINAL_STATUS } from '../lib/constants.js';
import { fmt, fmtNum, daysUntil, alertLevel } from '../lib/utils.js';
import { Metric, Badge, AlertChip, EmptyState } from '../ui/primitives.js';

export default function Dashboard({ projects, vehicles, companies, onNav }) {
  const ac   = projects.filter(p => !FINAL_STATUS.includes(p.status));
  const won  = projects.filter(p => ['ganada','contrato','entrega','facturado','cobrado'].includes(p.status));
  const lost = projects.filter(p => p.status === 'perdida');
  const pipeline  = ac.reduce((s,p) => s+(p.montoEstimado||0), 0);
  const wonTotal  = won.reduce((s,p) => s+(p.montoEstimado||0), 0);
  const totalVeh  = vehicles.length;
  const vehUnfact = vehicles.filter(v => !v.facturaGobierno?.folio).length;
  const decided   = won.length + lost.length;
  const conv      = decided > 0 ? Math.round(won.length/decided*100) : 0;

  const upcomingAlerts = [];
  projects.forEach(p => {
    [['Aclaraciones',p.fechaAclaraciones],['Propuesta',p.fechaPropuesta],['Fallo',p.fechaFallo],['Contrato',p.fechaContrato]]
      .forEach(([label,date]) => {
        const lvl = alertLevel(date);
        if (lvl) upcomingAlerts.push({ label, date, level:lvl, days:daysUntil(date), project:p });
      });
  });
  upcomingAlerts.sort((a,b) => a.days - b.days);

  if (projects.length === 0)
    return h('div', null,
      h('div', { className:'page-title', style:{ marginBottom:20 } }, 'Panel de control'),
      h(EmptyState, { icon:'◻', title:'Aún no tienes proyectos', description:'Empieza registrando tu primer proyecto de licitación.', actionLabel:'+ Crear primer proyecto', onAction:()=>onNav('project_new') }),
    );

  return h('div', null,
    h('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 } },
      h('div', { className:'page-title' }, 'Panel de control'),
      h('button', { className:'bp', onClick:()=>onNav('project_new') }, '+ Nuevo proyecto'),
    ),
    h('div', { className:'grid-5', style:{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 } },
      h(Metric, { label:'Pipeline activo', value:fmt(pipeline), sub:ac.length+' proyectos' }),
      h(Metric, { label:'Ganado / contratado', value:fmt(wonTotal), sub:won.length+' proyectos', sc:'var(--green)' }),
      h(Metric, { label:'Total vehículos', value:fmtNum(totalVeh), sub:vehUnfact+' sin facturar', sc:vehUnfact>0?'var(--amber)':'var(--green)' }),
      h(Metric, { label:'Tasa conversión', value:conv+'%', sub:decided+' decididos' }),
      h(Metric, { label:'Proyectos activos', value:ac.length }),
    ),
    upcomingAlerts.length > 0 && h('div', { className:'card', style:{ marginBottom:20 } },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:12 } }, '⚠ Alertas y vencimientos próximos'),
      h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } },
        upcomingAlerts.slice(0,8).map((a,i) =>
          h('div', { key:i, onClick:()=>onNav('project_detail',a.project.id), className:a.level==='r'?'alert-r':'alert-y',
            style:{ padding:'8px 12px', borderRadius:'var(--r)', fontSize:12, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' } },
            h('div', null, h('strong', null, a.project.name), ' — ', a.label, ': ', a.date),
            h('div', { style:{ fontWeight:500 } }, a.days<0?'Vencido hace '+(-a.days)+'d':a.days===0?'HOY':'En '+a.days+'d'),
          )
        )
      ),
    ),
    h('div', { className:'card' },
      h('div', { style:{ fontSize:14, fontWeight:500, marginBottom:14 } }, 'Proyectos'),
      h('div', { style:{ overflowX:'auto' } },
        h('table', { style:{ fontSize:13 } },
          h('thead', null, h('tr', { style:{ borderBottom:'.5px solid var(--b3)' } },
            ['PROYECTO','DEPENDENCIA','EMPRESA','MONTO','ESTADO','FALLO'].map(hd =>
              h('th', { key:hd, style:{ padding:'10px 8px', color:'var(--t3)', fontSize:11, fontWeight:600, letterSpacing:'.4px', textAlign:'left', borderBottom:'1px solid var(--b1)' } }, hd)
            )
          )),
          h('tbody', null, projects.map(p => {
            const alF = alertLevel(p.fechaFallo);
            return h('tr', { key:p.id, onClick:()=>onNav('project_detail',p.id), style:{ borderBottom:'.5px solid var(--b3)', cursor:'pointer' } },
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, p.name),
              h('td', { style:{ padding:'10px 6px', color:'var(--t2)' } }, p.dependencia||'—'),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:'var(--t2)' } }, p.company||'—'),
              h('td', { style:{ padding:'10px 6px', fontWeight:500 } }, fmt(p.montoEstimado)),
              h('td', { style:{ padding:'10px 6px' } }, h(Badge, { statusId:p.status })),
              h('td', { style:{ padding:'10px 6px', fontSize:12, color:alF==='r'?'var(--red)':alF==='y'?'var(--amber)':'var(--t2)' } }, p.fechaFallo||'—'),
            );
          }))
        )
      )
    ),
  );
}
