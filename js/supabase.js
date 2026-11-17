// Creates and exports the single Supabase client. Pinned exact 2.x version via esm.sh.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export function isConfigured() {
  return typeof SUPABASE_URL === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL)
    && !/YOUR-PROJECT/i.test(SUPABASE_URL)
    && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 20 && !/YOUR-ANON-KEY/i.test(SUPABASE_ANON_KEY);
}

export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export class RpcError extends Error {
  constructor(error) {
    super(error && error.message ? error.message : 'RPC error');
    const m = /PCCG_[A-Z_]+/.exec(this.message);
    this.code = m ? m[0] : null;
    if (!this.code && error && (error.status === 401 || error.code === 'PGRST301')) this.code = 'PCCG_NOT_AUTHENTICATED';
    this.status = error && error.status;
    this.isNetwork = !!error && (error.status === 0 || /fetch|network/i.test(this.message));
  }
}

// Calls an RPC and returns `data`; throws RpcError (with .code) on failure.
export async function rpc(fn, args = {}) {
  if (!supabase) throw new RpcError({ message: 'not configured' });
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    const err = new RpcError({ message: String(e && e.message || e), status: 0 });
    err.isNetwork = true;
    throw err;
  }
  if (res.error) throw new RpcError(res.error);
  return res.data;
}
