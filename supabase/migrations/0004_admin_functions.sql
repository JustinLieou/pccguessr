-- 0004_admin_functions.sql — admin RPCs. Each starts with private.assert_admin()
-- (which does the auth.uid() null-check and raises PCCG_NOT_AUTHENTICATED / PCCG_FORBIDDEN).
-- Extra error codes used here beyond SPEC §3: PCCG_NOT_FOUND, PCCG_BAD_INPUT, PCCG_LOCATION_IN_USE.

create or replace function public.admin_list_locations() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'lat', l.lat, 'lng', l.lng, 'pano_id', l.pano_id,
      'heading', l.heading, 'pitch', l.pitch, 'zoom', l.zoom, 'active', l.active,
      'created_at', l.created_at,
      'rounds_used', (select count(*) from public.rounds r where r.location_id = l.id)) order by l.id)
    from public.locations l), '[]'::jsonb);
end $$;

create or replace function public.admin_upsert_location(
  p_id bigint, p_name text, p_lat double precision, p_lng double precision, p_pano_id text,
  p_heading double precision, p_pitch double precision, p_zoom double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_pano text := btrim(coalesce(p_pano_id, ''));
  v_heading double precision;
  v_pitch double precision;
  v_zoom double precision;
  v_row public.locations%rowtype;
  v_cur public.locations%rowtype;
begin
  v_uid := private.assert_admin();
  if v_name = '' or length(v_name) > 100 or v_pano = '' or length(v_pano) > 200 then
    raise exception 'PCCG_BAD_INPUT';
  end if;
  if not private.is_finite(p_lat) or not private.is_finite(p_lng)
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'PCCG_BAD_COORDS';
  end if;
  if not private.is_finite(coalesce(p_heading, 0)) or not private.is_finite(coalesce(p_pitch, 0))
     or not private.is_finite(coalesce(p_zoom, 1)) then
    raise exception 'PCCG_BAD_INPUT';
  end if;
  v_heading := coalesce(p_heading, 0);
  v_heading := v_heading - 360 * floor(v_heading / 360);     -- normalise to [0,360)
  v_pitch := least(90, greatest(-90, coalesce(p_pitch, 0)));
  v_zoom := least(5, greatest(0, coalesce(p_zoom, 1)));

  -- A location already used in games must keep its coordinates (past results would change).
  if p_id is not null then
    select * into v_cur from public.locations where id = p_id for update;
  else
    select * into v_cur from public.locations where pano_id = v_pano for update;
  end if;
  if v_cur.id is not null
     and (abs(v_cur.lat - p_lat) > 1e-7 or abs(v_cur.lng - p_lng) > 1e-7)
     and exists (select 1 from public.rounds r where r.location_id = v_cur.id) then
    raise exception 'PCCG_LOCATION_IN_USE';
  end if;

  if p_id is null then
    insert into public.locations (name, lat, lng, pano_id, heading, pitch, zoom, created_by)
    values (v_name, p_lat, p_lng, v_pano, v_heading, v_pitch, v_zoom, v_uid)
    on conflict (pano_id) do update
      set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
          heading = excluded.heading, pitch = excluded.pitch, zoom = excluded.zoom
    returning * into v_row;
  else
    update public.locations
       set name = v_name, lat = p_lat, lng = p_lng, pano_id = v_pano,
           heading = v_heading, pitch = v_pitch, zoom = v_zoom
     where id = p_id returning * into v_row;
    if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.admin_set_location_active(p_id bigint, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  update public.locations set active = coalesce(p_active, false) where id = p_id;
  if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_id, 'active', coalesce(p_active, false));
end $$;

create or replace function public.admin_delete_location(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  if exists (select 1 from public.rounds r where r.location_id = p_id) then
    raise exception 'PCCG_LOCATION_IN_USE';
  end if;
  delete from public.locations where id = p_id;
  if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- Never returns email addresses.
create or replace function public.admin_search_players(p_query text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_q text := coalesce(btrim(p_query), '');
  v_pat text;
begin
  v_uid := private.assert_admin();
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(t.j order by t.created_at desc) from (
      select p.created_at, jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'is_hidden', p.is_hidden, 'is_admin', p.is_admin,
        'created_at', p.created_at,
        'games_completed', (select count(*) from public.games g where g.user_id = p.id and g.status = 'completed')) as j
      from public.profiles p
      where v_q = '' or p.display_name ilike v_pat
      order by p.created_at desc limit 50) t), '[]'::jsonb);
end $$;

create or replace function public.admin_rename_player(p_user_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_name text;
begin
  v_uid := private.assert_admin();
  v_name := private.normalize_name(p_name);
  begin
    update public.profiles set display_name = v_name, name_updated_at = now() where id = p_user_id;
  exception when unique_violation then
    raise exception 'PCCG_NAME_TAKEN';
  end;
  if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_user_id, 'display_name', v_name);
end $$;

create or replace function public.admin_set_hidden(p_user_id uuid, p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  update public.profiles set is_hidden = coalesce(p_hidden, false) where id = p_user_id;
  if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_user_id, 'is_hidden', coalesce(p_hidden, false));
end $$;

create or replace function public.admin_list_flagged_games(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  return coalesce((
    select jsonb_agg(t.j order by t.started_at desc) from (
      select g.started_at, jsonb_build_object(
        'id', g.id, 'user_id', g.user_id, 'display_name', p.display_name, 'status', g.status,
        'total_score', g.total_score, 'flag_reasons', to_jsonb(g.flag_reasons),
        'started_at', g.started_at, 'finished_at', g.finished_at,
        'rounds', (select jsonb_agg(jsonb_build_object(
                     'round_no', r.round_no,
                     'elapsed_s', extract(epoch from (r.guessed_at - r.revealed_at)),
                     'distance_m', r.distance_m, 'score', r.score, 'timed_out', r.timed_out) order by r.round_no)
                   from public.rounds r where r.game_id = g.id)) as j
      from public.games g join public.profiles p on p.id = g.user_id
      where g.flagged and g.status in ('active', 'completed')
      order by g.started_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $$;

create or replace function public.admin_void_game(p_game_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.assert_admin();
  update public.games
     set status = 'voided', voided_by = v_uid, voided_at = now(),
         void_reason = left(btrim(coalesce(p_reason, '')), 500)
   where id = p_game_id and status <> 'voided';
  if not found then raise exception 'PCCG_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_game_id, 'status', 'voided');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_list_locations()',
    'public.admin_upsert_location(bigint,text,double precision,double precision,text,double precision,double precision,double precision)',
    'public.admin_set_location_active(bigint,boolean)', 'public.admin_delete_location(bigint)',
    'public.admin_search_players(text)', 'public.admin_rename_player(uuid,text)',
    'public.admin_set_hidden(uuid,boolean)', 'public.admin_list_flagged_games(int)',
    'public.admin_void_game(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
