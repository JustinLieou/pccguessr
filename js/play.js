import { rpc } from './supabase.js';
import { initPage } from './auth.js';
import { loadGoogleMaps, createGuessMap, makeMarker, CAMPUS_CENTER } from './maps.js';
import { S, errorMessage } from './strings.js';
import { ROUNDS_PER_GAME } from './config.js';
import { $, showAlert, clearAlerts, setBusy, fmtDistance, fmtClock } from './ui.js';

const RESYNC_CODES = ['PCCG_WRONG_ROUND', 'PCCG_GAME_NOT_ACTIVE', 'PCCG_ALREADY_GUESSED', 'PCCG_ROUND_NOT_REVEALED', 'PCCG_GAME_NOT_FOUND'];

const startScreen = $('#start-screen');
const gameScreen = $('#game-screen');
const startAlerts = $('#start-alerts');
const gameAlerts = $('#game-alerts');
const guessBtn = $('#guess-btn');
const panel = $('#guess-panel');
const handle = $('#map-handle');
const resultCard = $('#result-card');
const nextBtn = $('#next-btn');

const st = {
  G: null, map: null, panorama: null,
  gameId: null, roundNo: 0, total: 0, limit: 120, deadline: 0,
  phase: 'idle',            // idle | guessing | result | between
  placed: null, marker: null, overlays: [],
  panoId: null, submitting: false, autoTried: false, timerId: null, lastResult: null,
};

// ------------------------------------------------------------------ helpers
function redirectIfAuth(e) {
  if (e && e.code === 'PCCG_NOT_AUTHENTICATED') { location.replace('./index.html'); return true; }
  if (e && e.code === 'PCCG_NO_DISPLAY_NAME') { location.replace('./profile.html?next=play'); return true; }
  return false;
}

async function ensureMaps() {
  if (st.G) return;
  st.G = await loadGoogleMaps();
}

function setHud() {
  $('#hud-round').textContent = Math.max(1, st.roundNo) + '/' + ROUNDS_PER_GAME;
  $('#hud-score').textContent = st.total.toLocaleString();
}

function showGameScreen() {
  startScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  if (!st.map) st.map = createGuessMap(st.G, $('#guess-map'));
  if (!st.panorama) createPanorama();
  if (!st.mapListener) {
    st.mapListener = st.map.addListener('click', (e) => placeGuess(e.latLng));
  }
}

function createPanorama() {
  const G = st.G;
  st.panorama = new G.StreetViewPanorama($('#pano'), {
    visible: true,
    addressControl: false, showRoadLabels: false, linksControl: false, clickToGo: false,
    disableDefaultUI: true, zoomControl: true, panControl: true,
    motionTracking: false, motionTrackingControl: false, fullscreenControl: false,
    enableCloseButton: false, imageDateControl: false, scrollwheel: true,
  });
  // No movement in v1: if anything (keyboard, etc.) moves us off the round's pano, snap back.
  st.panorama.addListener('pano_changed', () => {
    if (st.panoId && st.panorama.getPano() !== st.panoId) st.panorama.setPano(st.panoId);
  });
  st.panorama.addListener('status_changed', () => {
    const s = st.panorama.getStatus();
    if (s && s !== 'OK') showAlert(gameAlerts, S.panoUnavailable);
  });
}

// ------------------------------------------------------------------ timer
function stopTimer() { clearInterval(st.timerId); st.timerId = null; }

function startTimer() {
  stopTimer();
  tick();
  st.timerId = setInterval(tick, 250);
}

function tick() {
  const remaining = (st.deadline - performance.now()) / 1000;
  $('#hud-time').textContent = fmtClock(remaining);
  $('#timer').classList.toggle('warn', remaining <= 15);
  if (remaining <= 0 && st.phase === 'guessing' && !st.submitting && !st.autoTried) {
    st.autoTried = true;
    submit(true);
  }
}

// ------------------------------------------------------------------ rounds
function clearOverlays() {
  for (const o of st.overlays) { if ('map' in o) o.map = null; }
  st.overlays = [];
  if (st.marker) { st.marker.map = null; st.marker = null; }
  st.placed = null;
}

function startRound(pano, total) {
  const G = st.G;
  showGameScreen();
  clearAlerts(gameAlerts);
  clearOverlays();
  resultCard.classList.add('hidden');
  panel.classList.remove('is-result', 'is-open');
  handle.setAttribute('aria-expanded', 'false');
  handle.textContent = S.mapHandleOpen;
  st.map.setCenter(CAMPUS_CENTER); st.map.setZoom(17);

  st.gameId = pano.game_id;
  st.roundNo = pano.round_no;
  if (typeof total === 'number') st.total = total;
  st.limit = pano.time_limit_s;
  // Timer is server-based: elapsed_s was computed on the server at response time.
  const elapsed = typeof pano.elapsed_s === 'number' ? pano.elapsed_s
    : Math.max(0, (Date.parse(pano.server_now) - Date.parse(pano.revealed_at)) / 1000);
  st.deadline = performance.now() + (st.limit - elapsed) * 1000;
  st.phase = 'guessing'; st.submitting = false; st.autoTried = false;
  st.panoId = pano.pano_id;

  st.panorama.setPano(pano.pano_id);
  st.panorama.setPov({ heading: pano.heading, pitch: pano.pitch });
  st.panorama.setZoom(pano.zoom);
  st.panorama.setVisible(true);

  guessBtn.disabled = true;
  guessBtn.textContent = S.guessBtn;
  setHud();
  startTimer();
}

function placeGuess(latLng) {
  if (st.phase !== 'guessing' || st.submitting) return;
  const pos = { lat: latLng.lat(), lng: latLng.lng() };
  st.placed = pos;
  if (st.marker) st.marker.position = pos;
  else st.marker = makeMarker(st.G, st.map, pos, { kind: 'guess', title: S.guessLabel });
  guessBtn.disabled = false;
}

async function resync() {
  try {
    const g = await rpc('get_active_game');
    if (!g) { st.phase = 'idle'; stopTimer(); gameScreen.classList.add('hidden'); startScreen.classList.remove('hidden'); return; }
    if (g.awaiting_next) { showAwaiting(g); return; }
    startRound(g.pano, g.total_score);
  } catch (e) {
    if (!redirectIfAuth(e)) showAlert(gameAlerts, errorMessage(e));
  }
}

async function submit(auto = false) {
  if (st.phase !== 'guessing' || st.submitting) return;
  if (!auto && !st.placed) return;
  st.submitting = true;
  guessBtn.disabled = true;
  stopTimer();
  clearAlerts(gameAlerts);
  try {
    // At timer expiry an already placed marker is still sent (the server grace window decides);
    // with no marker, a null guess records the timeout.
    const res = await rpc('submit_guess', {
      p_game_id: st.gameId, p_round_no: st.roundNo,
      p_lat: st.placed ? st.placed.lat : null, p_lng: st.placed ? st.placed.lng : null,
    });
    showResult(res);
  } catch (e) {
    st.submitting = false;
    if (redirectIfAuth(e)) return;
    showAlert(gameAlerts, errorMessage(e));
    if (RESYNC_CODES.includes(e.code)) { await resync(); return; }
    guessBtn.disabled = !st.placed;
    startTimer();
  }
}

function showResult(res) {
  const G = st.G;
  st.phase = 'result'; st.submitting = false; st.lastResult = res;
  st.total = res.total_score;
  setHud();
  $('#hud-time').textContent = fmtClock(0);
  $('#timer').classList.remove('warn');
  guessBtn.disabled = true;

  const answer = res.answer;
  const bounds = new G.LatLngBounds();
  st.overlays.push(makeMarker(G, st.map, answer, { kind: 'answer', title: S.answerLabel }));
  bounds.extend(answer);
  if (!res.timed_out && st.placed) {
    bounds.extend(st.placed);
    st.overlays.push(new G.Polyline({
      map: st.map, path: [st.placed, answer], strokeColor: '#ffffff', strokeOpacity: 0.9, strokeWeight: 3, geodesic: true,
    }));
  } else if (st.marker) {
    st.marker.map = null; st.marker = null;   // late guess was rejected; don't show it as if it counted
  }

  panel.classList.add('is-open', 'is-result');
  handle.setAttribute('aria-expanded', 'true');
  handle.textContent = S.mapHandleClose;
  setTimeout(() => { G.event.trigger(st.map, 'resize'); st.map.fitBounds(bounds, 70); if (st.map.getZoom() > 19) st.map.setZoom(19); }, 300);

  $('#result-title').textContent = S.resultTitle(res.round_no);
  $('#result-msg').textContent = res.timed_out ? S.timedOut : S.distanceAway(fmtDistance(res.distance_m));
  $('#result-scores').textContent = S.roundScore(res.score) + '  ·  ' + S.totalScore(res.total_score);
  const done = res.game_status === 'completed';
  nextBtn.textContent = done ? S.seeResults : S.nextRound;
  nextBtn.disabled = false;
  resultCard.classList.remove('hidden');
}

// Game reloaded between rounds: the next pano has not been revealed yet.
function showAwaiting(g) {
  showGameScreen();
  clearOverlays();
  stopTimer();
  st.gameId = g.game_id; st.roundNo = g.round_no; st.total = g.total_score;
  st.phase = 'between'; st.lastResult = null;
  setHud();
  $('#hud-time').textContent = '—';
  $('#timer').classList.remove('warn');
  guessBtn.disabled = true;
  $('#result-title').textContent = S.hudRound + ' ' + g.round_no;
  $('#result-msg').textContent = S.resumePrompt(g.round_no);
  $('#result-scores').textContent = S.totalScore(g.total_score);
  nextBtn.textContent = S.nextRound;
  resultCard.classList.remove('hidden');
}

async function onNext() {
  nextBtn.disabled = true;
  clearAlerts(gameAlerts);
  if (st.lastResult && st.lastResult.game_status === 'completed') {
    location.href = './results.html?game=' + encodeURIComponent(st.gameId);
    return;
  }
  try {
    const pano = await rpc('next_round', { p_game_id: st.gameId });
    startRound(pano, st.total);
  } catch (e) {
    nextBtn.disabled = false;
    if (!redirectIfAuth(e)) showAlert(gameAlerts, errorMessage(e));
  }
}

async function onForfeit() {
  if (!window.confirm(S.confirmForfeit)) return;
  try {
    await rpc('abandon_game');
    location.reload();
  } catch (e) {
    if (!redirectIfAuth(e)) showAlert(gameAlerts, errorMessage(e));
  }
}

async function onStart() {
  const btn = $('#start-btn');
  clearAlerts(startAlerts);
  setBusy(btn, true, S.starting);
  try {
    await ensureMaps();
    const pano = await rpc('start_game');
    st.total = 0;
    startRound(pano, 0);
  } catch (e) {
    if (redirectIfAuth(e)) return;
    if (e.code === 'PCCG_GAME_IN_PROGRESS') {
      // Another tab/device already started a game: resume it instead of starting a new one.
      try {
        const g = await rpc('get_active_game');
        if (g) { await ensureMaps(); if (g.awaiting_next) showAwaiting(g); else startRound(g.pano, g.total_score); return; }
      } catch (e2) { if (redirectIfAuth(e2)) return; }
    }
    showAlert(startAlerts, errorMessage(e));
  } finally {
    setBusy(btn, false);
  }
}

// ------------------------------------------------------------------ init
async function init() {
  const { profile } = await initPage({ active: 'play' });
  if (!profile.display_name) { location.replace('./profile.html?next=play'); return; }
  $('#today').textContent = S.gamesToday(profile.games_today, profile.games_per_day);

  $('#start-btn').addEventListener('click', onStart);
  guessBtn.addEventListener('click', () => submit(false));
  nextBtn.addEventListener('click', onNext);
  $('#forfeit-btn').addEventListener('click', onForfeit);
  handle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    handle.setAttribute('aria-expanded', String(open));
    handle.textContent = open ? S.mapHandleClose : S.mapHandleOpen;
  });
  window.addEventListener('beforeunload', stopTimer);

  try {
    const g = await rpc('get_active_game');
    if (!g) return;
    await ensureMaps();
    if (g.awaiting_next) showAwaiting(g); else startRound(g.pano, g.total_score);
  } catch (e) {
    if (redirectIfAuth(e)) return;
    showAlert(startAlerts, errorMessage(e));
  }
}

init();
