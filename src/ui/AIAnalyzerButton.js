// AIAnalyzerButton.js — Botón reutilizable para análisis IA de documentos
import { h, useState } from '../lib/core.js';
import { analyzeDocument, analyzeMultipleDocuments } from '../lib/ai_analyzer.js';

export function AIAnalyzerButton({ config, tipo, onResult, label, multiple }) {
  const [status, setStatus] = useState('idle');
  const [error,  setError]  = useState('');
  const [progress, setProgress] = useState('');

  const apiKey = config?.ia?.openaiKey || window._lpConfig?.ia?.openaiKey;

  const handleClick = () => {
    if (status === 'loading') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg';
    input.multiple = !!multiple;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      if (!apiKey) {
        setError('Agrega tu API Key de Anthropic en Configuración → 🤖 Inteligencia Artificial');
        setStatus('error');
        return;
      }
      setStatus('loading');
      setError('');
      try {
        let result;
        if (files.length > 1) {
          setProgress(`Analizando ${files.length} documentos...`);
          result = await analyzeMultipleDocuments(files, tipo, apiKey);
        } else {
          setProgress('Analizando documento...');
          result = await analyzeDocument(files[0], tipo, apiKey);
        }
        setStatus('done');
        setProgress('');
        onResult(result);
        setTimeout(() => setStatus('idle'), 3000);
      } catch(err) {
        setStatus('error');
        setProgress('');
        setError(err.message);
      }
    };
    input.click();
  };

  const icons = { idle:'🤖', loading:'⏳', done:'✅', error:'❌' };
  const texts = {
    idle:    label || 'Analizar con IA',
    loading: progress || 'Analizando...',
    done:    '¡Datos extraídos!',
    error:   'Error — reintentar'
  };
  const styles = {
    idle:    { background:'var(--accent)', color:'#fff', borderColor:'var(--accent)' },
    loading: { background:'var(--bg2)',    color:'var(--t2)', borderColor:'var(--b2)', cursor:'wait' },
    done:    { background:'var(--green)',  color:'#fff', borderColor:'var(--green)' },
    error:   { background:'var(--red-bg)', color:'var(--red)', borderColor:'var(--red-border)' },
  };

  return h('div', null,
    h('button', {
      onClick: handleClick,
      disabled: status === 'loading',
      style: {
        ...styles[status],
        border: '1px solid',
        borderRadius: 'var(--r)',
        padding: '8px 16px',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: status === 'loading' ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }
    },
      h('span', null, icons[status]),
      h('span', null, texts[status])
    ),
    status === 'error' && h('div', {
      style: { fontSize: 11, color: 'var(--red)', marginTop: 6, maxWidth: 340, lineHeight: 1.5, padding:'8px 10px', background:'var(--red-bg)', borderRadius:'var(--r)', border:'1px solid var(--red-border)' }
    }, error)
  );
}
