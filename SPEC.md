# PCCguessr — Technical Spec (v1)

Contract for implementation. **Sonnet** implements code; **Haiku** writes bulk content (marked `[HAIKU]`).
"MUST" = required for acceptance. Anything marked **TO CONFIRM** is a placeholder Justin fills in later.

## 0. Summary

GeoGuessr-style game for Pensacola Christian College students. Player sees a Google Street View
panorama somewhere on campus, clicks a guess on a campus map, gets scored by distance. 5 rounds per game.

- Frontend: static site on GitHub Pages. Plain HTML + native ES modules. **No build step, no npm, no bundler.**
  Libraries via CDN with pinned versions: `https://esm.sh/@supabase/supabase-js@2.45.4` (or newest 2.x at
  implementation time, pinned exactly). Google Maps via the official dynamic `importLibrary` bootstrap loader.
- Backend: Supabase (Auth, Postgres, RLS, RPC). **No Edge Functions in v1.**
- All game logic, scoring, and timing is server-side in Postgres `SECURITY DEFINER` functions.
- Map default center: `30.4735, -87.2286`, zoom 17. Timezone for "day"/"week": `America/Chicago`.

## 1. File layout (exact)

```
pccguessr/
  SPEC.md                      this file
  README.md                    short overview + link to docs/SETUP.md
  .nojekyll                    empty; disables Jekyll on GitHub Pages
  index.html                   login (email -> 6-digit code)
  play.html                    game screen
  results.html                 end-of-game summary (?game=<uuid>)
  leaderboard.html             all-time + weekly tabs
  profile.html                 display name, my stats, sign out
  admin.html                   admin tools (locations, names, games)
  privacy.html                 [HAIKU] privacy notice / what data is stored
  css/style.css                single stylesheet, mobile-first
  js/config.js                 public config (see §6)
  js/supabase.js               creates & exports the single Supabase client
  js/auth.js                   requireAuth(), requireAdmin(), signOut(), session helpers
  js/maps.js                   loadGoogleMaps() via importLibrary bootstrap; campus bounds constants
  js/ui.js                     DOM helpers, toast/error display, escape-safe rendering
  js/strings.js                [HAIKU] all user-facing copy + error-code -> message map
  js/login.js                  index.html logic
  js/play.js                   play.html logic
  js/results.js                results.html logic
  js/leaderboard.js            leaderboard.html logic
  js/profile.js                profile.html logic
  js/admin.js                  admin.html logic
  supabase/migrations/
    0001_schema.sql            schemas, tables, indexes, constraints
    0002_rls.sql               enable RLS, revokes, policies
    0003_game_functions.sql    helpers + player RPCs
    0004_admin_functions.sql   admin RPCs
    0005_auth_hooks.sql        before-user-created hook + auth.users triggers
  supabase/seed.sql            allowed domains, name denylist (no locations)
  docs/SETUP.md                step-by-step Supabase/Google/GitHub setup (see §10)
```

Every page MUST work when served from a project subpath (`https://<user>.github.io/pccguessr/`):
use **relative** links and imports only (`./js/play.js`, `./leaderboard.html`).

## 2. Database schema

Schemas: `public` (exposed via API, but tables locked — see §2.6), `private` (NOT in Supabase "Exposed schemas").
All timestamps `timestamptz`. All time reads in functions use `clock_timestamp()`.

### 2.1 `private.settings` (single row)
| column | type | notes |
|---|---|---|
| id | int PK default 1, check id=1 | singleton |
| allowed_domains | text[] not null | lowercase, exact match. Seed: `{'pcci.edu','students.pcci.edu'}` **TO CONFIRM** |
| round_time_limit_s | int not null default 120 | |
| grace_s | int not null default 5 | network latency allowance |
| games_per_day | int not null default 20 | counts every started game (incl. abandoned) |
| score_k_m | numeric not null default 200 | scoring decay constant (§3.3) |

### 2.2 `public.profiles`
| column | type | notes |
|---|---|---|
| id | uuid PK references auth.users on delete cascade | |
| display_name | text unique (case-insensitive via unique index on lower()) null | null until set |
| is_admin | boolean not null default false | set only via SQL editor |
| is_hidden | boolean not null default false | hidden from leaderboards |
| created_at | timestamptz default now() | |
| name_updated_at | timestamptz | |

No email column (email lives only in `auth.users`). Row auto-created by trigger on `auth.users` insert.

### 2.3 `public.locations` — SECRET
| column | type | notes |
|---|---|---|
| id | bigint identity PK | |
| name | text not null | admin label, e.g. "Library steps" — never sent to players before guess |
| lat, lng | double precision not null | **SECRET**: the pano's actual position (from `getPosition()`) |
| pano_id | text not null unique | |
| heading | double precision not null default 0 | 0–360 |
| pitch | double precision not null default 0 | -90–90 |
| zoom | double precision not null default 1 | |
| active | boolean not null default true | |
| created_by | uuid references profiles | |
| created_at | timestamptz default now() | |

### 2.4 `public.games`
| column | type | notes |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| user_id | uuid not null references profiles on delete cascade | |
| status | text not null check in ('active','completed','abandoned','voided') | |
| current_round | int not null default 1 | 1..5 |
| total_score | int not null default 0 | |
| started_at | timestamptz not null | |
| finished_at | timestamptz | set when status -> completed |
| flagged | boolean not null default false | plausibility (§4) |
| flag_reasons | text[] not null default '{}' | |
| voided_by, voided_at, void_reason | uuid, timestamptz, text | |

Partial unique index: `unique (user_id) where status = 'active'` (one active game per user).
Indexes: `(user_id, started_at)`, `(status, finished_at)`.

### 2.5 `public.rounds`
| column | type | notes |
|---|---|---|
| game_id | uuid references games on delete cascade | PK (game_id, round_no) |
| round_no | int check 1..5 | |
| location_id | bigint not null references locations | **SECRET until guessed** |
| revealed_at | timestamptz | timer start; set when pano info is sent to client |
| guessed_at | timestamptz | |
| guess_lat, guess_lng | double precision | null if timed out |
| distance_m | double precision | |
| score | int | 0..5000 |
| timed_out | boolean not null default false | |

Unique `(game_id, location_id)` (no repeat location in a game).

### 2.6 Access control (RLS) — the rule is "no direct table access; everything via RPC"
- `alter table ... enable row level security` on **all** public tables, with **no policies** for
  `anon`/`authenticated` (= deny all).
- `revoke all on public.profiles, public.locations, public.games, public.rounds from anon, authenticated;`
- `revoke all on schema private from anon, authenticated, public;`
- Every RPC is `SECURITY DEFINER`, `set search_path = ''` (fully qualify all names), and starts with
  `auth.uid()` null-check (raise `PCCG_NOT_AUTHENTICATED`).
- `revoke execute on function ... from public, anon;` then `grant execute ... to authenticated;` for every
  player/admin RPC. Hook function: grant only to `supabase_auth_admin`.
- Admin RPCs call `private.assert_admin()` first (raises `PCCG_FORBIDDEN` unless `profiles.is_admin`).
- Private helpers (`private.*`) are not executable by anon/authenticated.

Rationale: table-level policies cannot hide individual columns (answer lat/lng) cleanly; RPCs return exactly
what a player may see at that moment.

## 3. Game flow (server-side RPCs)

Errors: `raise exception '<CODE>'` with these exact codes (client maps code -> text via `js/strings.js`):
`PCCG_NOT_AUTHENTICATED, PCCG_FORBIDDEN, PCCG_NO_DISPLAY_NAME, PCCG_DAILY_LIMIT, PCCG_NOT_ENOUGH_LOCATIONS,
PCCG_GAME_NOT_FOUND, PCCG_GAME_NOT_ACTIVE, PCCG_WRONG_ROUND, PCCG_ROUND_NOT_REVEALED, PCCG_ALREADY_GUESSED,
PCCG_BAD_COORDS, PCCG_BAD_NAME, PCCG_NAME_TAKEN`.

Pano payload (`pano`) shape returned to clients — **never includes lat/lng, location id, or name**:
`{ "game_id", "round_no", "pano_id", "heading", "pitch", "zoom", "revealed_at", "server_now", "time_limit_s" }`

### 3.1 Player RPCs
1. **`start_game() returns jsonb`**
   - Requires profile with non-null `display_name` (else `PCCG_NO_DISPLAY_NAME`).
   - Lock profile row (`for update`) to serialize per user.
   - Count games with `started_at` in the current America/Chicago calendar day; if `>= games_per_day` -> `PCCG_DAILY_LIMIT`.
   - Any existing `active` game -> `PCCG_GAME_IN_PROGRESS` (amended: client resumes via `get_active_game`; `abandon_game()` RPC forfeits it; abandoned games never rank and still count toward the daily cap).
   - Requires >= 5 active locations (else `PCCG_NOT_ENOUGH_LOCATIONS`). Pick 5 distinct at random
     (`order by random()`), preferring locations not used in the user's last 3 games when possible.
   - Insert game + 5 rounds (location chosen, `revealed_at` null). Reveal round 1 (set `revealed_at`).
   - Returns `pano` for round 1.
2. **`get_active_game() returns jsonb`** — for page reload. Returns `null` if none; else the current round's
   `pano` (with original `revealed_at`, so the timer is NOT reset) and `total_score`. If current round already
   guessed (result screen was showing), returns `{ "awaiting_next": true, game_id, round_no, total_score }`.
3. **`submit_guess(p_game_id uuid, p_round_no int, p_lat double precision, p_lng double precision) returns jsonb`**
   - Lock game row `for update`. Must belong to caller (`PCCG_GAME_NOT_FOUND` otherwise — don't leak existence),
     status `active` (`PCCG_GAME_NOT_ACTIVE`), `p_round_no = current_round` (`PCCG_WRONG_ROUND`),
     round revealed (`PCCG_ROUND_NOT_REVEALED`), not already guessed (`PCCG_ALREADY_GUESSED`).
   - `p_lat/p_lng` both null = explicit timeout (client timer hit 0). If non-null: must be finite,
     lat in [-90,90], lng in [-180,180] (`PCCG_BAD_COORDS`).
   - `elapsed = clock_timestamp() - revealed_at`. If null guess OR `elapsed > time_limit_s + grace_s`:
     `timed_out=true, score=0`, guess columns stored null, distance null. (Late guesses are rejected by scoring 0,
     and the game still advances so it can't get stuck.)
   - Else compute haversine distance (R = 6371000 m) and score (§3.3).
   - Update round, add to `total_score`. Run plausibility checks (§4.2).
   - If round 5: `status='completed'`, `finished_at=clock_timestamp()`. Else `current_round += 1`
     (next round NOT revealed yet).
   - Returns `{ round_no, timed_out, distance_m, score, answer: {lat, lng}, total_score, game_status, next_round_no|null }`.
4. **`next_round(p_game_id uuid) returns jsonb`** — reveals `current_round` (sets `revealed_at`) and returns its `pano`.
   Idempotent: if already revealed, returns it with the original `revealed_at`. Errors if game not active/owned.
5. **`get_game_summary(p_game_id uuid) returns jsonb`** — owner (or admin) only; only for `completed`/`voided`
   games. Returns status, total_score, flagged (admin only), and per round: guess lat/lng, answer lat/lng,
   distance, score, timed_out, location name.
6. **`get_my_profile() returns jsonb`** — display_name, is_admin, games_completed, best_score, best_week_score, games_today, games_per_day.
7. **`set_display_name(p_name text) returns jsonb`** — rules in §5.2.
8. **`get_leaderboard(p_scope text, p_limit int default 50) returns table(rank int, display_name text, best_score int, finished_at timestamptz, is_me boolean)`**
   - `p_scope in ('all','week')`; `p_limit` clamped to 1..100.
   - Source: `games` where `status='completed'` (voided/abandoned/active excluded) joined to profiles where
     `not is_hidden and display_name is not null`.
   - Per user: best `total_score`; tie-break earliest `finished_at`. Rank with `rank()` over `best_score desc`.
   - `week`: `finished_at >= date_trunc('week', now() at time zone 'America/Chicago') at time zone 'America/Chicago'` (Monday 00:00 Central).
   - Also return caller's own row if outside top N (client shows it below the table).

**Why `next_round` is separate** (deliberate deviation from "submit_guess returns next pano"): if the next pano
were returned with the result, the player could study it during the results screen, or the timer would run
while they read results. Revealing on demand starts the timer exactly when the pano is shown.

### 3.2 Timing
- Server is the only clock. Client countdown = `time_limit_s - (server_now - revealed_at)` adjusted by local
  offset measured at response time. When it hits 0, client calls `submit_guess(..., null, null)`.
- A player who closes the tab simply leaves an `active` game; it is abandoned on next `start_game`.

### 3.3 Scoring
`score = 5000` if `d <= 10 m`; else `score = round(5000 * exp(-d / k))`, **k = 200 m**, min 0. Max game = 25,000.
Reference points (campus ~1 km across): 25 m ≈ 4412, 50 m ≈ 3894, 100 m ≈ 3033, 200 m ≈ 1839, 500 m ≈ 410,
1 km ≈ 34. Rewards building-level precision; across-campus misses ≈ 0. `k` lives in `private.settings`.

## 4. Threat model (honest)

### 4.1 Assets & adversaries
Assets: leaderboard integrity, student emails, Google/Supabase quota/billing. Adversaries: curious/competitive
students with DevTools; outsiders trying to sign up; spammers abusing OTP email.

### 4.2 Cheating — residual risk ACCEPTED
**The client necessarily learns the answer.** Street View must load the pano in the browser; `pano_id` is
resolvable to coordinates (`panorama.getPosition()`, `StreetViewService.getPanorama({pano})`). A cheater with
DevTools can extract the exact location every round. This cannot be fixed without server-rendered imagery, which
Google's ToS forbids (no downloading/caching imagery). Mitigations (all MUST be implemented):
1. Send `pano_id` + POV only; never lat/lng, name, or location id before the guess.
2. StreetViewPanorama options: `addressControl:false, showRoadLabels:false, linksControl:false, clickToGo:false,
   disableDefaultUI:true` then re-enable only `zoomControl` and `panControl`; `motionTracking:false`,
   `fullscreenControl:false`. No movement (single pano) in v1. Hide Google logo/terms? **No** — attribution must stay visible.
3. Guess map: `mapTypeId:'satellite'` (no labels), `disableDefaultUI:true` + `zoomControl`, `clickableIcons:false`,
   `streetViewControl:false` (prevents Pegman revealing blue coverage lines), restrict to campus bounds
   (`restriction: { latLngBounds, strictBounds:false }`, minZoom 15).
4. Answers revealed only after guess; next pano only on `next_round`; server time limit 120 s.
5. Plausibility flags set in `submit_guess` (game is flagged, not blocked; flagged games still rank until voided):
   - `fast_perfect`: elapsed < 3 s and score >= 4900.
   - `fast_game`: completed game with total elapsed (sum of round elapsed) < 30 s.
   - `too_accurate`: completed game where all 5 rounds have distance < 5 m.
6. Admin flagged-games queue; admin can void a game (removes it from boards) and hide a user.
7. Daily game cap (20) limits rerolling for easy location sets.

### 4.3 Other threats & controls
| Threat | Control |
|---|---|
| Non-PCC signup | Server-side domain check in before-user-created hook + `auth.users` insert trigger (§5.1) |
| Switching email to non-PCC after signup | `before update of email on auth.users` trigger enforces same domain rule |
| Client-side check bypass | Client check is UX only; server enforces |
| Reading answers via REST | Tables revoked; RLS on with no policies; only RPCs |
| Privilege escalation to admin | No RPC writes `is_admin`; set only in SQL editor |
| XSS via display names | Server whitelist regex; client renders all user data with `textContent` (never `innerHTML`) |
| OTP brute force / email spam | Supabase Auth rate limits; OTP expiry 600 s; custom SMTP with its own limits |
| API key abuse | Maps key HTTP-referrer restricted + API-restricted; daily quota cap + budget alert |
| Leaked service_role key | Never in repo/client. Only anon key is shipped |
| Third-party script tampering | Pinned CDN versions; CSP `<meta>`: `script-src 'self' https://esm.sh https://maps.googleapis.com https://maps.gstatic.com` (+ `'unsafe-inline'` only if the Maps bootstrap snippet requires it — prefer putting it in `js/maps.js`); `connect-src 'self' https://*.supabase.co https://esm.sh https://*.googleapis.com https://*.gstatic.com`; `img-src 'self' data: https:`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`. Loosen only what testing proves Maps needs; document each addition. **Amended (review):** per Google's Maps JS API CSP guidance the shipped meta tags also allow `script-src 'unsafe-eval' blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com`, `connect-src https://*.google.com data: blob:`, plus `frame-src https://*.google.com; worker-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'`. |

## 5. Auth & accounts

### 5.1 Email OTP + domain enforcement
- Client: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`, then
  `supabase.auth.verifyOtp({ email, token, type: 'email' })`. Code input: 6 digits, `inputmode="numeric"`,
  `autocomplete="one-time-code"`. Resend button disabled for 60 s.
- Email template ("Magic Link" and "Confirm signup") MUST contain `{{ .Token }}` and MUST NOT contain
  `{{ .ConfirmationURL }}` (school filters rewrite links).
- `private.email_domain_allowed(p_email text) returns boolean`: `lower(split_part(p_email,'@',2)) = any(allowed_domains)`;
  rejects null/empty and emails with != 1 `@`. Exact domain match only (no subdomain wildcards).
- **Primary gate:** `public.hook_before_user_created(event jsonb) returns jsonb` registered in Auth → Hooks →
  "Before User Created" (Postgres). Reads `event->'user'->>'email'`. Allowed -> return `'{}'::jsonb`. Denied ->
  return `jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Only PCC email addresses can sign up.'))`.
  `grant execute ... to supabase_auth_admin; revoke ... from authenticated, anon, public;` and
  `grant usage on schema private to supabase_auth_admin; grant select on private.settings to supabase_auth_admin`.
- **Defense in depth:** `before insert` and `before update of email` triggers on `auth.users` calling the same check,
  raising exception if denied. `after insert` trigger creates the `profiles` row.
- Client also validates the domain against `ALLOWED_DOMAINS` purely for UX.

### 5.2 Display names
- Regex `^[A-Za-z0-9][A-Za-z0-9 _.-]{1,18}[A-Za-z0-9]$` (3–20 chars, no leading/trailing space/punct);
  collapse internal runs of spaces; reject if contains (case-insensitive) any term in `private.name_denylist(term text)`
  -> `PCCG_BAD_NAME`. Case-insensitive unique -> `PCCG_NAME_TAKEN`. Must not look like an email (no `@`; already excluded by regex).
- User must set a name before first game (play.html redirects to profile.html on `PCCG_NO_DISPLAY_NAME`).
- `[HAIKU]` seeds `private.name_denylist` in `seed.sql` (profanity/slurs/impersonation like `admin`, `pcc`, `official`, `staff`).

## 6. `js/config.js`
```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';      // public by design; RLS/RPC protect data
export const GOOGLE_MAPS_KEY = 'YOUR-MAPS-KEY';         // public by design; MUST be referrer + API restricted
export const ALLOWED_DOMAINS = ['pcci.edu', 'students.pcci.edu']; // TO CONFIRM; display/UX only, not security
export const CAMPUS_CENTER = { lat: 30.4735, lng: -87.2286 };
export const CAMPUS_BOUNDS = { north: 30.4800, south: 30.4670, east: -87.2200, west: -87.2370 }; // TO CONFIRM
export const ROUNDS_PER_GAME = 5; // display only; server is authoritative
```
Safe to commit: all of the above. **Never** commit or reference: `service_role` key, DB password, SMTP/Resend API key,
JWT secret. Header comment in the file MUST say this.
Google key restrictions: Application = HTTP referrers `https://<user>.github.io/pccguessr/*` (+ `http://localhost:*/*`
for dev); API restrictions = **Maps JavaScript API only** (Street View in Maps JS is included).

## 7. Pages

Shared: header nav (Play, Leaderboard, Profile, Admin only if `is_admin`), sign-out, footer link to privacy.html,
text "Unofficial student project — not affiliated with or endorsed by PCC" (until approval obtained). No PCC logos/seals.
All pages except index/privacy call `requireAuth()` (redirect to `./index.html` if no session).

- **index.html** — email field -> "Send code" -> code field -> "Verify". Shows domain hint. If already signed in,
  redirect to play.html. Errors from `strings.js`.
- **play.html** — on load: `get_active_game()`; if active, resume; else "Start game" button -> `start_game()`.
  Layout: Street View fills screen; guess map in corner (expands on hover/tap on mobile); "Guess" button enabled
  after a marker is placed; round `n/5`, total score, countdown. After submit: show answer marker + guess marker +
  line between, distance (m), round score; "Next round" -> `next_round()`; after round 5 -> results.html?game=id.
  Handle `PCCG_DAILY_LIMIT`, `PCCG_NO_DISPLAY_NAME` (-> profile.html).
- **results.html** — `get_game_summary`; map with all 5 guess/answer pairs; table per round; total; links Play again / Leaderboard.
- **leaderboard.html** — tabs All-time / This week; top 50; highlight `is_me`; own rank below if not in top 50.
- **profile.html** — set/change display name (show rules), stats from `get_my_profile`, games remaining today, sign out.
- **admin.html** — `requireAdmin()` (client-side gate is cosmetic; RPCs enforce). Three sections:
  1. *Locations*: map of campus; click -> `StreetViewService.getPanorama({ location, radius: 30, source: DEFAULT })`.
     If none: show "No Street View here". If found: show live panorama preview; admin sets POV by dragging, enters name,
     "Save" stores the **pano's own** `getPosition()` lat/lng (not the clicked point), `pano_id`, current heading/pitch/zoom.
     List all locations (name, active toggle, delete-if-unused, "Preview"). "Check all" button re-queries each
     `pano_id` and lists ones that no longer resolve (to deactivate).
  2. *Players*: search by display name; rename (force a new valid name), hide/unhide.
  3. *Games*: flagged games queue (player, score, reasons, per-round elapsed), "Void" with reason.

### 7.1 Admin RPCs (all `private.assert_admin()` first)
`admin_list_locations()`, `admin_upsert_location(p_id bigint null, p_name, p_lat, p_lng, p_pano_id, p_heading, p_pitch, p_zoom)`,
`admin_set_location_active(p_id, p_active)`, `admin_delete_location(p_id)` (only if no rounds reference it),
`admin_search_players(p_query)`, `admin_rename_player(p_user_id, p_name)` (same validation as §5.2),
`admin_set_hidden(p_user_id, p_hidden)`, `admin_list_flagged_games(p_limit)`, `admin_void_game(p_game_id, p_reason)`.
Admins are granted manually: `update public.profiles set is_admin = true where id = (select id from auth.users where email = '...');`

## 8. Campus policy note (put in README.md and docs/SETUP.md)
This is a school-branded service that collects student email addresses. Before inviting students or announcing it,
Justin SHOULD get written approval from PCC (IT department and Student Life), and confirm: allowed domains, whether
Street View imagery of campus may be used in a game, data retention, and whether an "official" tie-in is wanted.
Until approved: no official logos, seals, or names implying endorsement; label as an unofficial student project; keep
the site unlisted and test only with consenting friends. privacy.html `[HAIKU]` states: data stored (email, display name,
game history), purpose, no sale/sharing, deletion on request (admin deletes user in Supabase dashboard; cascades).

## 9. Ops limits
- Supabase default SMTP is heavily rate-limited (a few emails/hour) — **custom SMTP is required** (Resend, verified
  sender domain, SPF/DKIM). Auth settings: email OTP length 6, OTP expiry 600 s, disable all other providers,
  disable anonymous sign-ins, Site URL = GitHub Pages URL.
- Google: Dynamic Street View loads are billed per panorama (~5+ per game). Set a daily quota cap on Maps JavaScript API
  and a billing budget alert in Google Cloud.

## 10. docs/SETUP.md must cover (numbered, copy-pasteable)
1. Create Supabase project; run migrations 0001–0005 then seed.sql in SQL editor, in order.
2. Ensure `private` is NOT in API exposed schemas.
3. Auth: email provider on, OTP length/expiry, templates using `{{ .Token }}`, custom SMTP (Resend), rate limits, Site URL.
4. Auth → Hooks: enable Before User Created → Postgres → `public.hook_before_user_created`.
5. Google Cloud: enable Maps JavaScript API, create key, referrer + API restrictions, quota + budget.
6. Fill `js/config.js`; confirm domains in both `config.js` and `private.settings`.
7. Sign up, then grant self admin via SQL; add >= 5 locations in admin.html.
8. GitHub Pages: deploy from `main` / root; add `.nojekyll`.
9. Local dev: `python3 -m http.server 8000` from repo root.
10. Campus approval (§8).

## 11. Acceptance checklist (Sonnet MUST satisfy all)
- [ ] File layout exactly as §1; no build step; all imports relative or pinned CDN URLs; works under `/pccguessr/` subpath.
- [ ] Migrations run cleanly in order on a fresh Supabase project; re-running seed is idempotent (`on conflict do nothing`).
- [ ] As `authenticated`, `select * from locations|rounds|games|profiles` via REST returns permission error / zero rows.
- [ ] No RPC response contains `lat`/`lng`/`name`/`location_id` of a round before that round is guessed (grep RPC SQL to verify).
- [ ] Every RPC: `SECURITY DEFINER`, `set search_path = ''`, auth.uid() check, execute revoked from `public, anon`.
- [ ] Signup with `x@gmail.com` fails server-side even when client check is bypassed (call `signInWithOtp` from console).
- [ ] Changing email to a non-allowed domain via `updateUser` fails.
- [ ] Email contains a 6-digit code and no link; `verifyOtp` with type `email` logs in.
- [ ] `start_game` with an active game returns `PCCG_GAME_IN_PROGRESS` (amended); `abandon_game()` abandons it; partial unique index prevents two active games.
- [ ] 21st `start_game` in one Central-time day returns `PCCG_DAILY_LIMIT`.
- [ ] `submit_guess` rejects wrong round, double guess, unrevealed round, other user's game, bad coords with the listed codes.
- [ ] Guess after 125 s scores 0 with `timed_out=true`; game still advances; null guess = timeout.
- [ ] Concurrent double-submit (two parallel calls) records exactly one guess (row lock).
- [ ] Score formula: d=0→5000, d=200→1839, d=1000→34 (test with SQL `select` on helper).
- [ ] Next pano only obtainable via `next_round`; reload mid-round resumes with original timer.
- [ ] Only `completed` games appear on leaderboards; voided games and hidden users disappear immediately.
- [ ] Weekly board resets Monday 00:00 America/Chicago.
- [ ] Plausibility flags set per §4.2; admin can void; non-admin calling any `admin_*` gets `PCCG_FORBIDDEN`.
- [ ] Display name validation per §5.2 on server; all user text rendered via `textContent`.
- [ ] Street View has no address box, road labels, movement links, or Pegman on guess map; Google attribution visible.
- [ ] Admin saves pano's actual position + pano_id; cannot save a point without coverage.
- [ ] `config.js` contains only public values with a warning comment; no secrets anywhere in repo.
- [ ] CSP meta tag present on every page; site functions with it.
- [ ] "Unofficial student project" disclaimer and privacy link on every page; no PCC logos.
- [ ] Mobile (375 px wide) playable: map expands on tap, buttons reachable.
