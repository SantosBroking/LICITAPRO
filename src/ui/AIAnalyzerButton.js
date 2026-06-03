// AIAnalyzerButton.js — Botón reutilizable para análisis IA de documentos
import { h, useState } from '../lib/core.js';
import { analyzeDocument } from '../lib/ai_analyzer.js';

export function AIAnalyzerButton({ config, tipo, onResult, label }) {
  const [status, setStatus] = useState('idle');
  const [error, setError]   = useState('');

  const apiKey = config?.ia?.openaiKey || window._lpConfig?.ia?.openaiKey;

  const handleClick = () => {
    if (status === 'loading') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!apiKey) {
        setError('Agrega tu API Key de OpenAI en Configuración → Inteligencia Artificial');
        setStatus('error');
        return;
      }
      setStatus('loading');
      setError('');
      try {
        const result = await analyzeDocument(file, tipo, apiKey);
        setStatus('done');
        onResult(result);
        setTimeout(() => setStatus('idle'), 3000);
      } catch(err) {
        setStatus('error');
        setError(err.message);
      }
    };
    input.click();
  };

  const icons = { idle: '🤖', loading: '⏳', done: '✅', error: '❌' };
  const texts = {
    idle: label || 'Analizar con IA',
    loading: 'Analizando...',
    done: '¡Datos extraídos!',
    error: 'Error — reintentar'
  };
  const colors = {
    idle:    { background:'var(--accent)', color:'white' },
    loading: { background:'var(--b2)', color:'var(--t2)', cursor:'wait' },
    done:    { background:'#1D9E75', color:'white' },
    error:   { background:'#FCEBEB', color:'#e24b4a', border:'1px solid #e24b4a' },
  };

  return h('div', null,
    h('button', {
      onClick: handleClick,
      style: {
        ...colors[status],
        border: colors[status].border || 'none',
        borderRadius: 'var(--r)',
        padding: '8px 16px',
        fontSize: 12,
        cursor: status === 'loading' ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 500,
        whiteSpace: 'nowrap'
      }
    },
      h('span', null, icons[status]),
      h('span', null, texts[status])
    ),
    status === 'error' && h('div', {
      style: { fontSize: 11, color: '#e24b4a', marginTop: 6, maxWidth: 300, lineHeight: 1.4 }
    }, error)
  );
}
