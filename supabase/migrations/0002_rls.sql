-- 0002_rls.sql — "no direct table access; everything via SECURITY DEFINER RPCs".
-- RLS enabled with NO policies = deny all for anon/authenticated. Table owner (postgres) bypasses RLS,
-- which is what the SECURITY DEFINER functions run as.

alter table public.profiles  enable row level security;
alter table public.locations enable row level security;
alter table public.games     enable row level security;
alter table public.rounds    enable row level security;
alter table private.settings       enable row level security;
alter table private.name_denylist  enable row level security;

revoke all on public.profiles, public.locations, public.games, public.rounds from anon, authenticated;
revoke all on private.settings, private.name_denylist from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on schema private from anon, authenticated, public;

-- Future objects created by this role in public get no automatic API access either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
