// AIAnalyzerButton.js — Botón reutilizable para análisis IA de documentos
import { h, useState, useRef } from '../lib/core.js';
import { analyzeDocument } from '../lib/ai_analyzer.js';

export function AIAnalyzerButton({ config, tipo, onResult, label }) {
  const [status, setStatus] = useState('idle'); // idle | loading | error | done
  const [error, setError]   = useState('');
  const inputRef = useRef(null);

  const apiKey = config?.ia?.openaiKey;

  const handleFile = async (e) => {
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
    e.target.value = '';
  };

  const icons = { idle: '🤖', loading: '⏳', done: '✅', error: '❌' };
  const texts = { 
    idle: label || 'Analizar con IA', 
    loading: 'Analizando...', 
    done: '¡Datos extraídos!', 
    error: 'Error' 
  };
  const colors = {
    idle: { background:'var(--accent)', color:'white' },
    loading: { background:'var(--b2)', color:'var(--t2)' },
    done: { background:'#1D9E75', color:'white' },
    error: { background:'#FCEBEB', color:'#e24b4a' },
  };

  return h('div', null,
    h('input', { 
      ref: inputRef, type:'file', accept:'.pdf,.png,.jpg,.jpeg', 
      style:{ display:'none' }, onChange: handleFile 
    }),
    h('button', {
      onClick: () => status === 'idle' && inputRef.current?.click(),
      disabled: status === 'loading',
      style: { 
        ...colors[status], 
        border:'none', borderRadius:'var(--r)', 
        padding:'7px 14px', fontSize:12, cursor: status === 'loading' ? 'wait' : 'pointer',
        display:'flex', alignItems:'center', gap:6, fontWeight:500
      }
    },
      h('span', null, icons[status]),
      h('span', null, texts[status])
    ),
    status === 'error' && h('div', { 
      style:{ fontSize:11, color:'#e24b4a', marginTop:6, maxWidth:300, lineHeight:1.4 } 
    }, error)
  );
}
