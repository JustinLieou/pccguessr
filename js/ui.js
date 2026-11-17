// DOM helpers. Everything here renders with textContent / createTextNode — never innerHTML.
import { S } from './strings.js';
import { isConfigured } from './supabase.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// el('div', {class:'card', onclick: fn, dataset:{a:1}}, 'text', childNode, ...)
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) { btn.textContent = btn.dataset.label; delete btn.dataset.label; }
  }
}

// Inline alert inside a container. kind: 'error' | 'success'. Returns the node. Replaces previous alerts there.
export function showAlert(container, message, kind = 'error') {
  clearAlerts(container);
  const a = el('div', { class: 'alert alert-' + kind, role: kind === 'error' ? 'alert' : 'status', 'data-alert': '1' }, message);
  container.prepend(a);
  return a;
}
export function clearAlerts(container) {
  $$('[data-alert]', container).forEach((n) => n.remove());
}

// Floating message that disappears by itself.
export function toast(message, kind = 'success', ms = 3500) {
  let host = $('#toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', style: 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:1000;display:grid;gap:.5rem;max-width:92vw' });
    document.body.appendChild(host);
  }
  const t = el('div', { class: 'alert alert-' + kind, role: 'status', style: 'margin:0;box-shadow:0 4px 14px rgba(0,0,0,.3)' }, message);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Replaces <main> content with a single message card (used for fatal states).
export function fatal(message, title = S.configTitle) {
  const main = $('main') || document.body;
  clear(main);
  main.className = 'container';
  main.appendChild(el('div', { class: 'card' }, el('h1', { text: title }), el('div', { class: 'alert alert-error', role: 'alert' }, message)));
}

// Returns false (and shows a friendly message) if config.js still has placeholder values.
export function ensureConfigured() {
  if (isConfigured()) return true;
  fatal(S.configMissing);
  return false;
}

export const halt = () => new Promise(() => {});

export function fmtDistance(m) {
  if (m === null || m === undefined) return S.none;
  return m < 1000 ? Math.round(m).toLocaleString() + ' m' : (m / 1000).toFixed(2) + ' km';
}
export function fmtInt(n) {
  return n === null || n === undefined ? S.none : Number(n).toLocaleString();
}
export function fmtDate(iso) {
  if (!iso) return S.none;
  const d = new Date(iso);
  return isNaN(d) ? S.none : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

// Fills the static header nav: marks the current page, adds Admin (if admin) and Sign out.
export function renderNav(active, isAdmin, onSignOut) {
  const nav = $('#nav');
  if (!nav) return;
  $$('a[data-nav]', nav).forEach((a) => {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $$('[data-dyn]', nav).forEach((n) => n.remove());
  if (isAdmin) {
    const a = el('a', { href: './admin.html', 'data-nav': 'admin', 'data-dyn': '1', text: S.navAdmin });
    if (active === 'admin') a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  nav.appendChild(el('a', {
    href: '#', 'data-dyn': '1', role: 'button', text: S.navSignOut,
    onclick: (e) => { e.preventDefault(); onSignOut(); },
  }));
}
