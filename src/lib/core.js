// ─────────────────────────────────────────────────────────────
// core.js  —  React sin htm, sin eval, sin CSP issues
//             Usa React.createElement directamente via h()
// ─────────────────────────────────────────────────────────────
import {
  createElement,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  memo,
  Fragment,
} from 'react';

/**
 * h(type, props, ...children)
 * Alias de React.createElement — reemplaza html`...` de htm.
 * Sin eval, sin new Function, compatible con cualquier CSP.
 */
export const h = createElement;

export {
  createElement,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  memo,
  Fragment,
};
