/*
 * PCCguessr public configuration.
 *
 * Everything in this file is PUBLIC by design and safe to commit: the Supabase anon key is protected by
 * RLS + RPC-only access, and the Google Maps key MUST be restricted by HTTP referrer + "Maps JavaScript API" only.
 *
 * NEVER put any of these in this repo or on the client: the Supabase service_role key, the database password,
 * an SMTP / Resend API key, or the JWT secret.
 */
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';      // public by design; RLS/RPC protect data
export const GOOGLE_MAPS_KEY = 'YOUR-MAPS-KEY';         // public by design; MUST be referrer + API restricted
export const ALLOWED_DOMAINS = ['pcci.edu', 'students.pcci.edu']; // TO CONFIRM; display/UX only, not security
export const GOOGLE_MAP_ID = 'YOUR-MAP-ID';           // public; create in Cloud Console > Map Management (JavaScript, Vector)
export const CAMPUS_CENTER = { lat: 30.4735, lng: -87.2286 };
export const CAMPUS_BOUNDS = { north: 30.4800, south: 30.4670, east: -87.2200, west: -87.2370 }; // TO CONFIRM
export const ROUNDS_PER_GAME = 5; // display only; server is authoritative
