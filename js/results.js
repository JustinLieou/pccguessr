import { rpc } from './supabase.js';
import { initPage } from './auth.js';
import { loadGoogleMaps, createGuessMap, makeMarker } from './maps.js';
import { S, errorMessage } from './strings.js';
import { $, el, clear, showAlert, isUuid, fmtDistance, fmtInt } from './ui.js';

const alerts = $('#alerts');

async function init() {
  await initPage({ active: 'play' });
  const gameId = new URLSearchParams(location.search).get('game');
  $('#loading').classList.add('hidden');
  if (!isUuid(gameId)) { showAlert(alerts, errorMessage({ code: 'PCCG_GAME_NOT_FOUND' })); return; }

  let sum;
  try {
    sum = await rpc('get_game_summary', { p_game_id: gameId });
  } catch (e) {
    if (e.code === 'PCCG_NOT_AUTHENTICATED') { location.replace('./index.html'); return; }
    showAlert(alerts, errorMessage(e));
    return;
  }
  render(sum);
  $('#content').classList.remove('hidden');
  drawMap(sum).catch((e) => showAlert(alerts, errorMessage(e)));
}

function render(sum) {
  $('#total').textContent = S.totalScore(sum.total_score);
  const notes = clear($('#notes'));
  if (sum.status === 'voided') notes.appendChild(el('div', { class: 'alert alert-error' }, S.voidedNote));
  if (sum.flagged) notes.appendChild(el('div', { class: 'alert alert-error' }, S.flaggedNote + (sum.flag_reasons || []).join(', ')));

  const table = clear($('#results-table'));
  table.appendChild(el('thead', null, el('tr', null,
    el('th', { text: S.colRound }), el('th', { text: S.colPlace }),
    el('th', { class: 'num', text: S.colDistance }), el('th', { class: 'num', text: S.colScore }))));
  const body = el('tbody');
  for (const r of sum.rounds) {
    body.appendChild(el('tr', null,
      el('td', { text: r.round_no }),
      el('td', { text: r.location_name }),
      el('td', { class: 'num', text: r.timed_out ? S.noGuess : fmtDistance(r.distance_m) }),
      el('td', { class: 'num', text: fmtInt(r.score) })));
  }
  table.appendChild(body);
  table.appendChild(el('tfoot', null, el('tr', null,
    el('td', { colspan: 3, text: S.colTotal }), el('td', { class: 'num', text: fmtInt(sum.total_score) }))));
}

async function drawMap(sum) {
  const G = await loadGoogleMaps();
  const map = createGuessMap(G, $('#results-map'), { restrict: false });
  const bounds = new G.LatLngBounds();
  for (const r of sum.rounds) {
    bounds.extend(r.answer);
    makeMarker(G, map, r.answer, { kind: 'answer', glyph: String(r.round_no), title: S.answerLabel + ' ' + r.round_no });
    if (r.guess) {
      bounds.extend(r.guess);
      makeMarker(G, map, r.guess, { kind: 'guess', glyph: String(r.round_no), title: S.guessLabel + ' ' + r.round_no });
      new G.Polyline({ map, path: [r.guess, r.answer], strokeColor: '#ffffff', strokeOpacity: 0.9, strokeWeight: 2, geodesic: true });
    }
  }
  map.fitBounds(bounds, 50);
}

init();
