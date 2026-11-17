import { rpc } from './supabase.js';
import { initPage, signOut } from './auth.js';
import { S, errorMessage } from './strings.js';
import { $, el, clear, showAlert, clearAlerts, setBusy, fmtInt } from './ui.js';

const alerts = $('#alerts');
const nameInput = $('#name');

function renderStats(p) {
  const stats = clear($('#stats'));
  const left = Math.max(0, (p.games_per_day ?? 0) - (p.games_today ?? 0));
  const items = [
    [S.statGames, fmtInt(p.games_completed)],
    [S.statBest, p.best_score === null ? S.none : fmtInt(p.best_score)],
    [S.statWeek, p.best_week_score === null ? S.none : fmtInt(p.best_week_score)],
    [S.statToday, left + ' / ' + p.games_per_day],
  ];
  for (const [label, value] of items) {
    stats.appendChild(el('div', null, el('div', { class: 'stat', text: value }), el('div', { class: 'muted', text: label })));
  }
}

async function init() {
  const { profile } = await initPage({ active: 'profile' });
  $('#name-rules').textContent = S.nameRules;
  nameInput.value = profile.display_name || '';
  renderStats(profile);
  const next = new URLSearchParams(location.search).get('next');
  if (!profile.display_name) showAlert(alerts, S.nameNeeded);   // no-name users arrive here from play.html

  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlerts(alerts);
    const btn = $('#save-btn');
    setBusy(btn, true);
    try {
      const res = await rpc('set_display_name', { p_name: nameInput.value });
      nameInput.value = res.display_name;
      showAlert(alerts, S.nameSaved, 'success');
      if (next === 'play') setTimeout(() => location.replace('./play.html'), 700);
    } catch (err) {
      if (err.code === 'PCCG_NOT_AUTHENTICATED') { location.replace('./index.html'); return; }
      showAlert(alerts, errorMessage(err));
    } finally {
      setBusy(btn, false);
    }
  });
  $('#signout-btn').addEventListener('click', signOut);
}

init();
