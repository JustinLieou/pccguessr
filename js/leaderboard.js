import { rpc } from './supabase.js';
import { initPage } from './auth.js';
import { S, errorMessage } from './strings.js';
import { $, $$, el, clear, showAlert, clearAlerts, fmtInt, fmtDate } from './ui.js';

const LIMIT = 50;
const alerts = $('#alerts');
const board = $('#board');
const loading = $('#loading');
let reqId = 0;

function row(r, withRank = true) {
  const rankCell = el('td', { class: 'rank rank-' + r.rank });
  if (r.rank <= 3) rankCell.appendChild(el('span', { class: 'medal', text: String(r.rank) }));
  else rankCell.appendChild(document.createTextNode(String(r.rank)));
  const nameCell = el('td', null, r.display_name, r.is_me ? ' ' : null, r.is_me ? el('span', { class: 'badge badge-gold', text: S.lbYou }) : null);
  return el('tr', { class: (r.rank === 1 ? 'rank-1 ' : '') + (r.is_me ? 'is-me' : ''), style: r.is_me ? 'font-weight:700;outline:2px solid var(--gold);outline-offset:-2px' : null },
    rankCell, nameCell, el('td', { class: 'score', text: fmtInt(r.best_score) }), el('td', { text: fmtDate(r.finished_at) }));
}

function render(rows) {
  clear(board);
  if (!rows.length) { board.appendChild(el('div', { class: 'card', text: S.lbEmpty })); return; }
  const top = rows.slice(0, LIMIT);
  const extra = rows.length > LIMIT ? rows[LIMIT] : null;   // caller's own row when outside the top N
  const tbody = el('tbody');
  top.forEach((r) => tbody.appendChild(row(r)));
  if (extra) {
    tbody.appendChild(el('tr', null, el('td', { colspan: 4, class: 'muted', style: 'text-align:center', text: '⋮' })));
    tbody.appendChild(row(extra));
  }
  board.appendChild(el('div', { style: 'overflow-x:auto' }, el('table', { class: 'leaderboard' },
    el('thead', null, el('tr', null, el('th', { text: S.colRank }), el('th', { text: S.colPlayer }),
      el('th', { class: 'score', text: S.colBest }), el('th', { text: S.colDate }))),
    tbody)));
}

async function load(scope) {
  const id = ++reqId;
  clearAlerts(alerts);
  clear(board);
  loading.classList.remove('hidden');
  $('#week-note').classList.toggle('hidden', scope !== 'week');
  try {
    const rows = await rpc('get_leaderboard', { p_scope: scope, p_limit: LIMIT });
    if (id !== reqId) return;
    render(rows || []);
  } catch (e) {
    if (id !== reqId) return;
    if (e.code === 'PCCG_NOT_AUTHENTICATED') { location.replace('./index.html'); return; }
    showAlert(alerts, errorMessage(e));
  } finally {
    if (id === reqId) loading.classList.add('hidden');
  }
}

async function init() {
  await initPage({ active: 'leaderboard' });
  const tabs = $$('.tabs [role="tab"]');
  for (const t of tabs) {
    t.addEventListener('click', () => {
      tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === t)); x.classList.toggle('is-active', x === t); });
      load(t.dataset.scope);
    });
  }
  load('all');
}

init();
