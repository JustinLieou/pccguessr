-- 0001_schema.sql — schemas, tables, indexes, constraints.
-- Run order: 0001 -> 0002 -> 0003 -> 0004 -> 0005 -> seed.sql (then seed_denylist.sql).

create schema if not exists private;   -- NOT exposed through the API (see docs/SETUP.md)

-- ---------------------------------------------------------------- private.settings
create table if not exists private.settings (
  id                 int primary key default 1 check (id = 1),
  allowed_domains    text[] not null,
  round_time_limit_s int  not null default 120 check (round_time_limit_s > 0),
  grace_s            int  not null default 5   check (grace_s >= 0),
  games_per_day      int  not null default 20  check (games_per_day > 0),
  score_k_m          numeric not null default 200 check (score_k_m > 0)
);
-- Singleton row. TO CONFIRM: allowed domains.
insert into private.settings (id, allowed_domains)
values (1, array['pcci.edu', 'students.pcci.edu'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------- private.name_denylist
create table if not exists private.name_denylist (
  term text primary key check (term = lower(term) and length(btrim(term)) > 0),
  whole_word boolean not null default false   -- true: match only as a whole word (letters-only boundaries)
);
alter table private.name_denylist add column if not exists whole_word boolean not null default false;

-- ---------------------------------------------------------------- public.profiles
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text,
  is_admin        boolean not null default false,   -- set ONLY via SQL editor
  is_hidden       boolean not null default false,
  created_at      timestamptz not null default now(),
  name_updated_at timestamptz
);
create unique index if not exists profiles_display_name_lower_key
  on public.profiles (lower(display_name));

-- ---------------------------------------------------------------- public.locations (SECRET)
create table if not exists public.locations (
  id         bigint generated always as identity primary key,
  name       text not null,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  pano_id    text not null unique,
  heading    double precision not null default 0 check (heading between 0 and 360),
  pitch      double precision not null default 0 check (pitch between -90 and 90),
  zoom       double precision not null default 1,
  active     boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- public.games
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        text not null check (status in ('active','completed','abandoned','voided')),
  current_round int  not null default 1 check (current_round between 1 and 5),
  total_score   int  not null default 0,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  flagged       boolean not null default false,
  flag_reasons  text[] not null default '{}',
  voided_by     uuid,
  voided_at     timestamptz,
  void_reason   text
);
create unique index if not exists games_one_active_per_user on public.games (user_id) where status = 'active';
create index if not exists games_user_started_idx on public.games (user_id, started_at);
create index if not exists games_status_finished_idx on public.games (status, finished_at);

-- ---------------------------------------------------------------- public.rounds
create table if not exists public.rounds (
  game_id     uuid not null references public.games (id) on delete cascade,
  round_no    int  not null check (round_no between 1 and 5),
  location_id bigint not null references public.locations (id),
  revealed_at timestamptz,
  guessed_at  timestamptz,
  guess_lat   double precision,
  guess_lng   double precision,
  distance_m  double precision,
  score       int check (score between 0 and 5000),
  timed_out   boolean not null default false,
  primary key (game_id, round_no),
  unique (game_id, location_id)
);
create index if not exists rounds_location_idx on public.rounds (location_id);
