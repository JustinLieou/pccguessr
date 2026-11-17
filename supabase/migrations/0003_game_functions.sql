-- 0003_game_functions.sql — private helpers + player RPCs.
-- Every RPC: SECURITY DEFINER, set search_path = '', auth.uid() null-check, execute only for `authenticated`.
-- No RPC returns lat/lng/name/location id of a round before that round is guessed.

-- ================================================================ private helpers
create or replace function private.is_finite(x double precision) returns boolean
language sql immutable set search_path = '' as $$
  select x is not null and x <> 'NaN'::double precision and x <> 'Infinity'::double precision and x <> '-Infinity'::double precision
$$;

create or replace function private.email_domain_allowed(p_email text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_raw text := btrim(coalesce(p_email, ''));
  v_email text;
  v_domains text[];
begin
  -- ASCII only (blocks homoglyph tricks: lower() maps U+0130 'İ' to 'i', so test BEFORE lowercasing);
  -- exactly one '@'; no plus-addressing.
  if v_raw !~ '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+$' then return false; end if;
  v_email := lower(v_raw);
  if position('+' in v_email) > 0 then return false; end if;
  select s.allowed_domains into v_domains from private.settings s where s.id = 1;
  return split_part(v_email, '@', 2) in (
    select lower(btrim(d)) from unnest(coalesce(v_domains, '{}'::text[])) as d);
end $$;

create or replace function private.assert_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then
    raise exception 'PCCG_FORBIDDEN';
  end if;
  return v_uid;
end $$;

create or replace function private.haversine_m(lat1 double precision, lng1 double precision,
                                               lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000.0 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- score = 5000 if d <= 10 m else round(5000 * exp(-d / k)), min 0
create or replace function private.score_for(p_distance_m double precision, p_k numeric default 200)
returns int language sql immutable set search_path = '' as $$
  select case when p_distance_m <= 10 then 5000
              when p_distance_m / p_k::double precision > 50 then 0     -- avoid exp() underflow error
              else greatest(0, round(5000 * exp(-p_distance_m / p_k::double precision)))::int end
$$;

create or replace function private.add_flag(p_game_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.games g
     set flagged = true,
         flag_reasons = case when p_reason = any (g.flag_reasons) then g.flag_reasons
                             else array_append(g.flag_reasons, p_reason) end
   where g.id = p_game_id
$$;

-- Validates + normalises a display name; raises PCCG_BAD_NAME.
create or replace function private.normalize_name(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_name is null then raise exception 'PCCG_BAD_NAME'; end if;
  v := regexp_replace(btrim(p_name, ' '), ' +', ' ', 'g');
  if v !~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{1,18}[A-Za-z0-9]$' then raise exception 'PCCG_BAD_NAME'; end if;
  if exists (
    select 1 from private.name_denylist d
    where (not d.whole_word and (
             strpos(lower(v), d.term) > 0
             or (length(regexp_replace(d.term, '[^a-z0-9]', '', 'g')) > 0
                 and strpos(regexp_replace(lower(v), '[^a-z0-9]', '', 'g'),
                            regexp_replace(d.term, '[^a-z0-9]', '', 'g')) > 0)))
       or (d.whole_word and lower(v) ~ ('(^|[^a-z])' || regexp_replace(d.term, '([^a-z0-9])', '\\\1', 'g') || '([^a-z]|$)'))
  ) then raise exception 'PCCG_BAD_NAME'; end if;
  return v;
end $$;

-- Pano payload. NEVER includes lat/lng, location id or name.
create or replace function private.pano_json(p_game_id uuid, p_round_no int) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'game_id', r.game_id,
    'round_no', r.round_no,
    'pano_id', l.pano_id,
    'heading', l.heading,
    'pitch', l.pitch,
    'zoom', l.zoom,
    'revealed_at', r.revealed_at,
    'server_now', clock_timestamp(),
    'elapsed_s', extract(epoch from (clock_timestamp() - r.revealed_at)),   -- additive helper for the client timer
    'time_limit_s', s.round_time_limit_s)
  from public.rounds r
  join public.locations l on l.id = r.location_id
  cross join private.settings s
  where r.game_id = p_game_id and r.round_no = p_round_no and s.id = 1
$$;

create or replace function private.central_day_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('day', clock_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'
$$;

-- ================================================================ player RPCs
create or replace function public.start_game() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_s private.settings%rowtype;
  v_today int;
  v_recent bigint[];
  v_ids bigint[];
  v_game uuid;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;

  select p.display_name into v_name from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  if v_name is null then raise exception 'PCCG_NO_DISPLAY_NAME'; end if;

  if exists (select 1 from public.games g where g.user_id = v_uid and g.status = 'active') then
    raise exception 'PCCG_GAME_IN_PROGRESS';   -- client resumes via get_active_game(); use abandon_game() to forfeit
  end if;

  select * into v_s from private.settings where id = 1;
  select count(*) into v_today from public.games g
   where g.user_id = v_uid and g.started_at >= private.central_day_start();
  if v_today >= v_s.games_per_day then raise exception 'PCCG_DAILY_LIMIT'; end if;

  if (select count(*) from public.locations l where l.active) < 5 then
    raise exception 'PCCG_NOT_ENOUGH_LOCATIONS';
  end if;

  select coalesce(array_agg(distinct r.location_id), '{}'::bigint[]) into v_recent
    from public.rounds r
   where r.game_id in (select g.id from public.games g where g.user_id = v_uid order by g.started_at desc limit 3);

  select array_agg(x.id) into v_ids from (
    select l.id from public.locations l where l.active
     order by (l.id = any (v_recent)), random() limit 5) x;

  insert into public.games (user_id, status, current_round, started_at)
  values (v_uid, 'active', 1, clock_timestamp())
  returning id into v_game;

  insert into public.rounds (game_id, round_no, location_id)
  select v_game, t.ord::int, t.id from unnest(v_ids) with ordinality as t(id, ord);

  update public.rounds set revealed_at = clock_timestamp() where game_id = v_game and round_no = 1;

  return private.pano_json(v_game, 1);
end $$;

create or replace function public.abandon_game() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  perform 1 from public.profiles p where p.id = v_uid for update;   -- same lock order as start_game
  -- The game already counted toward the daily limit when it was started; abandoned games never rank.
  update public.games set status = 'abandoned' where user_id = v_uid and status = 'active' returning id into v_id;
  return jsonb_build_object('abandoned', v_id is not null, 'game_id', v_id);
end $$;

create or replace function public.get_active_game() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  g public.games%rowtype;
  v_revealed timestamptz;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  select * into g from public.games where user_id = v_uid and status = 'active';
  if not found then return null; end if;
  select r.revealed_at into v_revealed from public.rounds r where r.game_id = g.id and r.round_no = g.current_round;
  if v_revealed is null then
    -- previous round was guessed; next one not revealed yet
    return jsonb_build_object('awaiting_next', true, 'game_id', g.id,
                              'round_no', g.current_round, 'total_score', g.total_score);
  end if;
  return jsonb_build_object('awaiting_next', false, 'game_id', g.id, 'round_no', g.current_round,
                            'total_score', g.total_score, 'pano', private.pano_json(g.id, g.current_round));
end $$;

create or replace function public.submit_guess(p_game_id uuid, p_round_no int,
                                               p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  g public.games%rowtype;
  r public.rounds%rowtype;
  l public.locations%rowtype;
  s private.settings%rowtype;
  v_now timestamptz;
  v_elapsed double precision;
  v_timed_out boolean;
  v_dist double precision;
  v_score int;
  v_next int;
  v_status text;
  v_sum double precision;
  v_total int;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;

  select * into g from public.games where id = p_game_id and user_id = v_uid for update;
  if not found then raise exception 'PCCG_GAME_NOT_FOUND'; end if;

  select * into s from private.settings where id = 1;
  select * into r from public.rounds where game_id = g.id and round_no = p_round_no;
  if not found then raise exception 'PCCG_WRONG_ROUND'; end if;
  if r.guessed_at is not null then raise exception 'PCCG_ALREADY_GUESSED'; end if;
  if g.status <> 'active' then raise exception 'PCCG_GAME_NOT_ACTIVE'; end if;
  if p_round_no <> g.current_round then raise exception 'PCCG_WRONG_ROUND'; end if;
  if r.revealed_at is null then raise exception 'PCCG_ROUND_NOT_REVEALED'; end if;

  if (p_lat is null) <> (p_lng is null) then raise exception 'PCCG_BAD_COORDS'; end if;
  if p_lat is not null then
    -- NaN sorts above every number in Postgres, so the range test also rejects NaN / Infinity.
    if not private.is_finite(p_lat) or not private.is_finite(p_lng)
       or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
      raise exception 'PCCG_BAD_COORDS';
    end if;
  end if;

  select * into l from public.locations where id = r.location_id;

  v_now := clock_timestamp();
  v_elapsed := extract(epoch from (v_now - r.revealed_at));
  v_timed_out := p_lat is null or v_elapsed > (s.round_time_limit_s + s.grace_s);

  if v_timed_out then
    v_dist := null; v_score := 0;
    update public.rounds set guessed_at = v_now, guess_lat = null, guess_lng = null,
           distance_m = null, score = 0, timed_out = true
     where game_id = g.id and round_no = p_round_no;
  else
    v_dist := private.haversine_m(p_lat, p_lng, l.lat, l.lng);
    v_score := private.score_for(v_dist, s.score_k_m);
    update public.rounds set guessed_at = v_now, guess_lat = p_lat, guess_lng = p_lng,
           distance_m = v_dist, score = v_score, timed_out = false
     where game_id = g.id and round_no = p_round_no;
    -- plausibility flags (flag, don't block)
    if v_elapsed < 3 and v_score >= 4900 then perform private.add_flag(g.id, 'fast_perfect'); end if;
  end if;

  if p_round_no >= 5 then
    v_status := 'completed'; v_next := null;
    select sum(extract(epoch from (rr.guessed_at - rr.revealed_at))) into v_sum
      from public.rounds rr where rr.game_id = g.id;
    if v_sum < 30 then perform private.add_flag(g.id, 'fast_game'); end if;
    if (select count(*) from public.rounds rr where rr.game_id = g.id and rr.distance_m < 5) = 5 then
      perform private.add_flag(g.id, 'too_accurate');
    end if;
    update public.games set status = 'completed', finished_at = v_now,
           total_score = total_score + v_score where id = g.id returning total_score into v_total;
  else
    v_status := 'active'; v_next := p_round_no + 1;
    update public.games set current_round = v_next,
           total_score = total_score + v_score where id = g.id returning total_score into v_total;
  end if;

  return jsonb_build_object(
    'round_no', p_round_no, 'timed_out', v_timed_out, 'distance_m', v_dist, 'score', v_score,
    'answer', jsonb_build_object('lat', l.lat, 'lng', l.lng),
    'total_score', v_total, 'game_status', v_status, 'next_round_no', v_next);
end $$;

create or replace function public.next_round(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  g public.games%rowtype;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  select * into g from public.games where id = p_game_id and user_id = v_uid for update;
  if not found then raise exception 'PCCG_GAME_NOT_FOUND'; end if;
  if g.status <> 'active' then raise exception 'PCCG_GAME_NOT_ACTIVE'; end if;
  update public.rounds set revealed_at = clock_timestamp()
   where game_id = g.id and round_no = g.current_round and revealed_at is null;
  return private.pano_json(g.id, g.current_round);
end $$;

create or replace function public.get_game_summary(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  g public.games%rowtype;
  v_rounds jsonb;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  select p.is_admin into v_admin from public.profiles p where p.id = v_uid;
  select * into g from public.games where id = p_game_id;
  if not found or (g.user_id <> v_uid and not coalesce(v_admin, false))
     or g.status not in ('completed', 'voided') then
    raise exception 'PCCG_GAME_NOT_FOUND';
  end if;
  select jsonb_agg(jsonb_build_object(
           'round_no', r.round_no,
           'guess', case when r.guess_lat is null then null
                         else jsonb_build_object('lat', r.guess_lat, 'lng', r.guess_lng) end,
           'answer', jsonb_build_object('lat', l.lat, 'lng', l.lng),
           'distance_m', r.distance_m, 'score', r.score, 'timed_out', r.timed_out,
           'location_name', l.name) order by r.round_no)
    into v_rounds
    from public.rounds r join public.locations l on l.id = r.location_id
   where r.game_id = g.id;
  return jsonb_build_object('game_id', g.id, 'status', g.status, 'total_score', g.total_score,
           'finished_at', g.finished_at, 'rounds', coalesce(v_rounds, '[]'::jsonb))
         || case when coalesce(v_admin, false)
                 then jsonb_build_object('flagged', g.flagged, 'flag_reasons', to_jsonb(g.flag_reasons))
                 else '{}'::jsonb end;
end $$;

create or replace function public.get_my_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_s private.settings%rowtype;
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Chicago') at time zone 'America/Chicago';
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  select * into p from public.profiles where id = v_uid;
  if not found then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  select * into v_s from private.settings where id = 1;
  return jsonb_build_object(
    'display_name', p.display_name,
    'is_admin', p.is_admin,
    'games_completed', (select count(*) from public.games g where g.user_id = v_uid and g.status = 'completed'),
    'best_score', (select max(g.total_score) from public.games g where g.user_id = v_uid and g.status = 'completed'),
    'best_week_score', (select max(g.total_score) from public.games g
                         where g.user_id = v_uid and g.status = 'completed' and g.finished_at >= v_week),
    'games_today', (select count(*) from public.games g
                     where g.user_id = v_uid and g.started_at >= private.central_day_start()),
    'games_per_day', v_s.games_per_day);
end $$;

create or replace function public.set_display_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  v_name := private.normalize_name(p_name);
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  begin
    update public.profiles set display_name = v_name, name_updated_at = now() where id = v_uid;
  exception when unique_violation then
    raise exception 'PCCG_NAME_TAKEN';
  end;
  return jsonb_build_object('display_name', v_name);
end $$;

create or replace function public.get_leaderboard(p_scope text, p_limit int default 50)
returns table (rank int, display_name text, best_score int, finished_at timestamptz, is_me boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_lim int;
  v_since timestamptz;
begin
  if v_uid is null then raise exception 'PCCG_NOT_AUTHENTICATED'; end if;
  if p_scope is null or p_scope not in ('all', 'week') then raise exception 'PCCG_BAD_INPUT'; end if;
  v_lim := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_since := case when p_scope = 'week'
                  then date_trunc('week', now() at time zone 'America/Chicago') at time zone 'America/Chicago'
                  else '-infinity'::timestamptz end;
  return query
  with best as (
    select distinct on (g.user_id) g.user_id as uid, p.display_name as dname,
           g.total_score as score, g.finished_at as fin
      from public.games g join public.profiles p on p.id = g.user_id
     where g.status = 'completed' and g.finished_at >= v_since
       and not p.is_hidden and p.display_name is not null
     order by g.user_id, g.total_score desc, g.finished_at asc
  ), ranked as (
    select b.uid, b.dname, b.score, b.fin,
           (rank() over (order by b.score desc))::int as rk,
           row_number() over (order by b.score desc, b.fin asc) as rn
      from best b
  )
  select q.rk, q.dname, q.score, q.fin, q.me from (
    select x.rk, x.dname, x.score, x.fin, (x.uid = v_uid) as me, x.rn as ord
      from ranked x where x.rn <= v_lim
    union all
    select x.rk, x.dname, x.score, x.fin, true, x.rn
      from ranked x where x.uid = v_uid and x.rn > v_lim
  ) q order by q.ord;
end $$;

-- ================================================================ privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.start_game()', 'public.abandon_game()', 'public.get_active_game()',
    'public.submit_guess(uuid,int,double precision,double precision)', 'public.next_round(uuid)',
    'public.get_game_summary(uuid)', 'public.get_my_profile()', 'public.set_display_name(text)',
    'public.get_leaderboard(text,int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.is_finite(double precision)', 'private.email_domain_allowed(text)', 'private.assert_admin()',
    'private.haversine_m(double precision,double precision,double precision,double precision)',
    'private.score_for(double precision,numeric)', 'private.add_flag(uuid,text)', 'private.normalize_name(text)',
    'private.pano_json(uuid,int)', 'private.central_day_start()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
