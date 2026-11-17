// Google Maps via the official dynamic importLibrary bootstrap loader.
import { GOOGLE_MAPS_KEY, GOOGLE_MAP_ID, CAMPUS_CENTER, CAMPUS_BOUNDS } from './config.js';
import { S } from './strings.js';

export { CAMPUS_CENTER, CAMPUS_BOUNDS };
// AdvancedMarkerElement requires a Map ID. Fall back to Google's DEMO_MAP_ID while config.js still has the placeholder.
const MAP_ID_IS_PLACEHOLDER = typeof GOOGLE_MAP_ID !== 'string' || GOOGLE_MAP_ID.length < 4 || /YOUR-MAP-ID/i.test(GOOGLE_MAP_ID);
if (MAP_ID_IS_PLACEHOLDER) console.warn('PCCguessr: GOOGLE_MAP_ID is not set in js/config.js; using DEMO_MAP_ID (see docs/SETUP.md).');
export const MAP_ID = MAP_ID_IS_PLACEHOLDER ? 'DEMO_MAP_ID' : GOOGLE_MAP_ID;

function userError(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

export function mapsConfigured() {
  return typeof GOOGLE_MAPS_KEY === 'string' && GOOGLE_MAPS_KEY.length > 10 && !/YOUR-MAPS-KEY/i.test(GOOGLE_MAPS_KEY);
}

// Official bootstrap loader (https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
// kept here so no inline <script> is needed under the CSP.
function bootstrap(g) {
  var h, a, k, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary', q = '__ib__', m = document, b = window;
  b = b[c] || (b[c] = {});
  var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams();
  var u = () => h || (h = new Promise(async (f, n) => {
    a = m.createElement('script');
    e.set('libraries', [...r] + '');
    for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), g[k]);
    e.set('callback', c + '.maps.' + q);
    a.src = 'https://maps.' + c + 'apis.com/maps/api/js?' + e;
    d[q] = f;
    a.onerror = () => (h = n(Error(p + ' could not load.')));
    m.head.append(a);
  }));
  if (d[l]) console.warn(p + ' only loads once. Ignoring:', g);
  else d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
}

let loading = null;

// Resolves to the classes the app needs. Rejects with an Error whose message is user-friendly.
export function loadGoogleMaps() {
  if (loading) return loading;
  loading = (async () => {
    if (!mapsConfigured()) throw userError(S.mapsKeyMissing);
    try {
      bootstrap({ key: GOOGLE_MAPS_KEY, v: 'weekly' });
      const [maps, streetView, marker, core] = await Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('streetView'),
        google.maps.importLibrary('marker'),
        google.maps.importLibrary('core'),
      ]);
      return {
        Map: maps.Map, Polyline: maps.Polyline, event: maps.event || google.maps.event,
        StreetViewPanorama: streetView.StreetViewPanorama, StreetViewService: streetView.StreetViewService,
        StreetViewSource: streetView.StreetViewSource || google.maps.StreetViewSource,
        AdvancedMarkerElement: marker.AdvancedMarkerElement, PinElement: marker.PinElement,
        LatLngBounds: core.LatLngBounds,
      };
    } catch (e) {
      console.error(e);
      loading = null;
      throw userError(S.mapsLoadFailed);
    }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Guess map: satellite (no labels), campus-restricted, no Pegman.
export function createGuessMap(G, element, { restrict = true } = {}) {
  return new G.Map(element, {
    center: CAMPUS_CENTER, zoom: 17, minZoom: restrict ? 15 : 3, maxZoom: 21,
    mapId: MAP_ID, mapTypeId: 'satellite',
    disableDefaultUI: true, zoomControl: true,
    clickableIcons: false, streetViewControl: false, fullscreenControl: false, mapTypeControl: false,
    keyboardShortcuts: false, gestureHandling: 'greedy',
    ...(restrict ? { restriction: { latLngBounds: CAMPUS_BOUNDS, strictBounds: false } } : {}),
  });
}

// Round marker with optional text glyph. kind: 'guess' | 'answer' | 'admin'
export function makeMarker(G, map, position, { kind = 'guess', glyph = '', title = '' } = {}) {
  const colors = {
    guess: { background: '#c9a227', borderColor: '#13284c', glyphColor: '#13284c' },
    answer: { background: '#1e8e4e', borderColor: '#0b3d20', glyphColor: '#ffffff' },
    admin: { background: '#c4433f', borderColor: '#5a1010', glyphColor: '#ffffff' },
  }[kind];
  const pin = new G.PinElement({ ...colors, glyph: glyph || undefined });
  return new G.AdvancedMarkerElement({ map, position, content: pin.element, title });
}

export function toLatLng(o) { return { lat: o.lat, lng: o.lng }; }
