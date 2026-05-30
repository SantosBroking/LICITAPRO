// main.js — Punto de entrada: monta React en #root
import { createElement } from './lib/core.js';
import { createRoot } from 'react-dom/client';
import App from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró #root');
createRoot(root).render(createElement(App));
