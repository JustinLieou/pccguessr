// Admin tools. The client-side gate is cosmetic; every RPC enforces admin on the server.
import { rpc } from './supabase.js';
import { initPage } from './auth.js';
import { loadGoogleMaps, makeMarker, MAP_ID, CAMPUS_CENTER } from './maps.js';
import { S, errorMessage } from './strings.js';
import { $, el, clear, showAlert, clearAlerts, setBusy, fmtInt, fmtDate } from './ui.js';

const locAlerts = $('#loc-alerts');
const playerAlerts = $('#player-alerts');
const gameAlerts = $('#game-alerts');

const st = {
  G: null, map: null, svc: null, pano: null,
  clickMarker: null, locMarkers: [], locations: [], editingId: null, editingName: '',
};

function fail(container, e) {
  if (e && e.code === 'PCCG_NOT_AUTHENTICATED') { location.replace('./index.html'); return; }
  if (e && e.code === 'PCCG_FORBIDDEN') { location.replace('./play.html'); return; }
  showAlert(container, errorMessage(e));
}

// ------------------------------------------------------------------ locations
async function initMap() {
  st.G = await loadGoogleMaps();
  const G = st.G;
  st.svc = new G.StreetViewService();
  st.map = new G.Map($('#admin-map'), {
    center: CAMPUS_CENTER, zoom: 17, mapId: MAP_ID, mapTypeId: 'hybrid',
    streetViewControl: false, clickableIcons: false, fullscreenControl: false, gestureHandling: 'greedy',
  });
  st.map.addListener('click', (e) => onMapClick(e.latLng));
}

function sourceOption() {
  return $('#outdoor-only').checked ? st.G.StreetViewSource.OUTDOOR : st.G.StreetViewSource.DEFAULT;
}

async function onMapClick(latLng) {
  clearAlerts(locAlerts);
  if (st.clickMarker) st.clickMarker.position = latLng;
  else st.clickMarker = makeMarker(st.G, st.map, latLng, { kind: 'admin', title: 'Clicked point' });
  try {
    const res = await st.svc.getPanorama({ location: latLng, radius: 50, source: sourceOption() });
    const data = res && res.data ? res.data : res;
    if (!data || !data.location || !data.location.pano) throw Object.assign(new Error('none'), { code: 'ZERO_RESULTS' });
    openPreview({
      panoId: data.location.pano,
      heading: data.tiles && typeof data.tiles.centerHeading === 'number' ? data.tiles.centerHeading : 0,
      pitch: 0, zoom: 1, editingId: null, name: '',
    });
  } catch (e) {
    if (e && (e.code === 'ZERO_RESULTS' || /ZERO_RESULTS/.test(String(e.message)))) {
      $('#preview-wrap').classList.add('hidden');
      showAlert(locAlerts, S.noStreetView, 'error');
    } else {
      console.error(e);
      showAlert(locAlerts, S.genericError);
    }
  }
}

function openPreview({ panoId, heading, pitch, zoom, editingId, name }) {
  const G = st.G;
  st.editingId = editingId;
  st.editingName = name;
  $('#preview-wrap').classList.remove('hidden');
  $('#loc-name').value = name || '';
  $('#loc-save-new').classList.toggle('hidden', editingId === null);
  $('#loc-save').textContent = editingId === null ? S.locSave : S.locSave + ' (update)';
  $('#preview-info').textContent = editingId === null ? '' : S.locEditing(name);
  if (!st.pano) {
    st.pano = new G.StreetViewPanorama($('#admin-pano'), {
      visible: true, addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false,
      enableCloseButton: false,
    });
    st.pano.addListener('pano_changed', updateInfo);
    st.pano.addListener('position_changed', updateInfo);
  }
  st.pano.setPano(panoId);
  st.pano.setPov({ heading, pitch });
  st.pano.setZoom(zoom);
  st.pano.setVisible(true);
  $('#preview-wrap').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updateInfo() {
  const pos = st.pano && st.pano.getPosition();
  const parts = [];
  if (st.editingId !== null) parts.push(S.locEditing(st.editingName));
  parts.push('pano: ' + (st.pano ? st.pano.getPano() : ''));
  if (pos) parts.push(pos.lat().toFixed(6) + ', ' + pos.lng().toFixed(6));
  $('#preview-info').textContent = parts.join('  ·  ');
}

async function saveLocation(asNew) {
  clearAlerts(locAlerts);
  const name = $('#loc-name').value.trim();
  if (!name) { showAlert(locAlerts, errorMessage({ code: 'PCCG_BAD_INPUT' })); return; }
  const panoId = st.pano && st.pano.getPano();
  if (!panoId) { showAlert(locAlerts, S.noStreetView); return; }
  const btns = [$('#loc-save'), $('#loc-save-new')];
  btns.forEach((b) => setBusy(b, true));
  try {
    // Re-resolve the pano by id: its own position (not the clicked point) is what we store.
    let pos;
    try {
      const res = await st.svc.getPanorama({ pano: panoId });
      const data = res && res.data ? res.data : res;
      pos = data.location.latLng;
    } catch (e) {
      showAlert(locAlerts, S.noStreetView);
      return;
    }
    const pov = st.pano.getPov();
    const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
    const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
    await rpc('admin_upsert_location', {
      p_id: asNew ? null : st.editingId, p_name: name, p_lat: lat, p_lng: lng, p_pano_id: panoId,
      p_heading: pov.heading, p_pitch: pov.pitch, p_zoom: st.pano.getZoom(),
    });
    showAlert(locAlerts, S.locSaved, 'success');
    $('#preview-wrap').classList.add('hidden');
    st.editingId = null;
    await loadLocations();
  } catch (e) {
    fail(locAlerts, e);
  } finally {
    btns.forEach((b) => setBusy(b, false));
  }
}

async function loadLocations() {
  try {
    st.locations = await rpc('admin_list_locations');
  } catch (e) { fail(locAlerts, e); return; }
  renderLocations();
}

function renderLocations() {
  const G = st.G;
  st.locMarkers.forEach((m) => { m.map = null; });
  st.locMarkers = [];
  for (const l of st.locations) {
    st.locMarkers.push(makeMarker(G, st.map, { lat: l.lat, lng: l.lng }, { kind: l.active ? 'answer' : 'guess', title: l.name }));
  }
  const table = clear($('#loc-table'));
  table.appendChild(el('thead', null, el('tr', null,
    el('th', { text: 'Name' }), el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Used' }), el('th', { text: '' }))));
  const body = el('tbody');
  if (!st.locations.length) body.appendChild(el('tr', null, el('td', { colspan: 4, class: 'muted', text: 'No locations yet.' })));
  for (const l of st.locations) {
    const actions = el('div', { class: 'row' },
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: S.preview, onclick: () => previewExisting(l) }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: l.active ? S.deactivate : S.activate, onclick: () => toggleActive(l) }),
      l.rounds_used === 0 ? el('button', { class: 'btn btn-danger btn-small', type: 'button', text: S.del, onclick: () => deleteLocation(l) }) : null);
    body.appendChild(el('tr', null,
      el('td', null, l.name, el('div', { class: 'help', text: l.lat.toFixed(5) + ', ' + l.lng.toFixed(5) })),
      el('td', null, el('span', { class: 'badge ' + (l.active ? 'badge-success' : 'badge-danger'), text: l.active ? S.active : S.inactive })),
      el('td', { class: 'num', text: fmtInt(l.rounds_used) }),
      el('td', null, actions)));
  }
  table.appendChild(body);
}

function previewExisting(l) {
  clearAlerts(locAlerts);
  st.map.panTo({ lat: l.lat, lng: l.lng });
  openPreview({ panoId: l.pano_id, heading: l.heading, pitch: l.pitch, zoom: l.zoom, editingId: l.id, name: l.name });
}

async function toggleActive(l) {
  clearAlerts(locAlerts);
  try { await rpc('admin_set_location_active', { p_id: l.id, p_active: !l.active }); await loadLocations(); }
  catch (e) { fail(locAlerts, e); }
}

async function deleteLocation(l) {
  if (!window.confirm(S.confirmDelete)) return;
  clearAlerts(locAlerts);
  try { await rpc('admin_delete_location', { p_id: l.id }); await loadLocations(); }
  catch (e) { fail(locAlerts, e); }
}

async function checkAll() {
  const btn = $('#check-all');
  const status = $('#check-status');
  const out = clear($('#check-results'));
  btn.disabled = true;
  const bad = [];
  const list = st.locations;
  for (let i = 0; i < list.length; i++) {
    status.textContent = S.checking(i + 1, list.length);
    try {
      await st.svc.getPanorama({ pano: list[i].pano_id });
    } catch (e) {
      if (e && (e.code === 'ZERO_RESULTS' || /ZERO_RESULTS/.test(String(e.message)))) bad.push(list[i]);
      else console.error(e);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  status.textContent = S.checkDone(bad.length);
  if (bad.length) {
    const ul = el('ul');
    for (const l of bad) {
      ul.appendChild(el('li', null, l.name + ' ',
        l.active ? el('button', { class: 'btn btn-danger btn-small', type: 'button', text: S.deactivate, onclick: () => toggleActive(l) }) : el('span', { class: 'badge', text: S.inactive })));
    }
    out.appendChild(ul);
  }
  btn.disabled = false;
}

// ------------------------------------------------------------------ players
async function searchPlayers(q) {
  clearAlerts(playerAlerts);
  const list = clear($('#player-list'));
  let players;
  try { players = await rpc('admin_search_players', { p_query: q }); }
  catch (e) { fail(playerAlerts, e); return; }
  if (!players.length) { list.appendChild(el('p', { class: 'muted', text: S.noPlayers })); return; }
  for (const p of players) list.appendChild(playerRow(p, q));
}

function playerRow(p, q) {
  const input = el('input', { type: 'text', maxlength: 20, placeholder: S.newName, 'aria-label': S.newName, style: 'min-width:10rem;flex:1' });
  return el('div', { class: 'card', style: 'padding:.75rem;margin-bottom:.6rem' },
    el('div', { class: 'row' },
      el('strong', { text: p.display_name || '(no name)' }),
      p.is_hidden ? el('span', { class: 'badge badge-danger', text: S.hiddenBadge }) : null,
      p.is_admin ? el('span', { class: 'badge badge-gold', text: 'admin' }) : null,
      el('span', { class: 'muted', text: fmtInt(p.games_completed) + ' games · joined ' + fmtDate(p.created_at) })),
    el('div', { class: 'row', style: 'margin-top:.5rem' }, input,
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: S.rename, onclick: async () => {
        clearAlerts(playerAlerts);
        try { await rpc('admin_rename_player', { p_user_id: p.id, p_name: input.value }); await searchPlayers(q); showAlert(playerAlerts, S.saved, 'success'); }
        catch (e) { fail(playerAlerts, e); }
      } }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: p.is_hidden ? S.unhide : S.hide, onclick: async () => {
        clearAlerts(playerAlerts);
        try { await rpc('admin_set_hidden', { p_user_id: p.id, p_hidden: !p.is_hidden }); await searchPlayers(q); }
        catch (e) { fail(playerAlerts, e); }
      } })));
}

// ------------------------------------------------------------------ games
async function loadFlagged() {
  clearAlerts(gameAlerts);
  const list = clear($('#game-list'));
  let games;
  try { games = await rpc('admin_list_flagged_games', { p_limit: 50 }); }
  catch (e) { fail(gameAlerts, e); return; }
  if (!games.length) { list.appendChild(el('p', { class: 'muted', text: S.noFlagged })); return; }
  for (const g of games) list.appendChild(gameCard(g));
}

function gameCard(g) {
  const reason = el('input', { type: 'text', maxlength: 200, placeholder: S.voidReason, 'aria-label': S.voidReason, style: 'min-width:10rem;flex:1' });
  const rounds = el('tbody');
  for (const r of g.rounds || []) {
    rounds.appendChild(el('tr', null,
      el('td', { text: r.round_no }),
      el('td', { class: 'num', text: r.elapsed_s === null ? S.none : Number(r.elapsed_s).toFixed(1) + ' s' }),
      el('td', { class: 'num', text: r.timed_out ? 'timeout' : (r.distance_m === null ? S.none : Math.round(r.distance_m) + ' m') }),
      el('td', { class: 'num', text: fmtInt(r.score) })));
  }
  return el('div', { class: 'card', style: 'padding:.75rem' },
    el('div', { class: 'row' },
      el('strong', { text: g.display_name || '(no name)' }),
      el('span', { text: fmtInt(g.total_score) + ' pts' }),
      el('span', { class: 'badge', text: g.status }),
      ...(g.flag_reasons || []).map((f) => el('span', { class: 'badge badge-danger', text: f })),
      el('span', { class: 'muted', text: fmtDate(g.finished_at || g.started_at) })),
    el('div', { style: 'overflow-x:auto;margin:.5rem 0' }, el('table', { class: 'results' },
      el('thead', null, el('tr', null, el('th', { text: 'Round' }), el('th', { class: 'num', text: 'Elapsed' }), el('th', { class: 'num', text: 'Distance' }), el('th', { class: 'num', text: 'Score' }))),
      rounds)),
    el('div', { class: 'row' }, reason,
      el('button', { class: 'btn btn-danger btn-small', type: 'button', text: S.voidGame, onclick: async () => {
        clearAlerts(gameAlerts);
        if (!reason.value.trim()) { showAlert(gameAlerts, errorMessage({ code: 'PCCG_BAD_INPUT' })); return; }
        try { await rpc('admin_void_game', { p_game_id: g.id, p_reason: reason.value }); await loadFlagged(); showAlert(gameAlerts, S.voided, 'success'); }
        catch (e) { fail(gameAlerts, e); }
      } })));
}

// ------------------------------------------------------------------ init
async function init() {
  await initPage({ active: 'admin', admin: true });
  $('#player-form').addEventListener('submit', (e) => { e.preventDefault(); searchPlayers($('#player-q').value); });
  $('#loc-save').addEventListener('click', () => saveLocation(false));
  $('#loc-save-new').addEventListener('click', () => saveLocation(true));
  $('#loc-cancel').addEventListener('click', () => { $('#preview-wrap').classList.add('hidden'); st.editingId = null; });
  $('#check-all').addEventListener('click', checkAll);
  searchPlayers('');
  loadFlagged();
  try {
    await initMap();
    await loadLocations();
  } catch (e) {
    showAlert(locAlerts, errorMessage(e));
  }
}

init();
