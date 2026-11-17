// Session helpers + the shared page bootstrap.
import { supabase, rpc } from './supabase.js';
import { ensureConfigured, renderNav, fatal, halt } from './ui.js';
import { errorMessage } from './strings.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function signOut() {
  try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
  location.replace('./index.html');
}

// Redirects to index.html when signed out (never resolves in that case).
export async function requireAuth() {
  if (!ensureConfigured()) return halt();
  const s = await getSession();
  if (!s) { location.replace('./index.html'); return halt(); }
  return s;
}

export const getMyProfile = () => rpc('get_my_profile');

// Client-side gate is cosmetic; the RPCs enforce admin on the server.
export async function requireAdmin() {
  const session = await requireAuth();
  const profile = await loadProfile();
  if (!profile.is_admin) { location.replace('./play.html'); return halt(); }
  return { session, profile };
}

async function loadProfile() {
  try {
    return await getMyProfile();
  } catch (e) {
    if (e.code === 'PCCG_NOT_AUTHENTICATED') { await signOut(); return halt(); }
    fatal(errorMessage(e), '');
    return halt();
  }
}

// Standard bootstrap for authenticated pages: auth gate, profile, nav. Returns { session, profile }.
export async function initPage({ active, admin = false } = {}) {
  const session = await requireAuth();
  const profile = await loadProfile();
  if (admin && !profile.is_admin) { location.replace('./play.html'); return halt(); }
  renderNav(active, !!profile.is_admin, signOut);
  return { session, profile };
}
