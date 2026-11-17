-- 0005_auth_hooks.sql — domain enforcement (hook + auth.users triggers) and profile auto-creation.
-- After running, enable Auth -> Hooks -> "Before User Created" -> Postgres -> public.hook_before_user_created.

-- Primary gate: Before User Created hook.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if private.email_domain_allowed(event -> 'user' ->> 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Only PCC email addresses can sign up.'));
end $$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.email_domain_allowed(text) to supabase_auth_admin;

-- Defense in depth: triggers on auth.users.
create or replace function private.enforce_email_domain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.email_domain_allowed(new.email) then
    raise exception 'Only PCC email addresses can sign up.' using errcode = '42501';
  end if;
  -- pending email change (Supabase stores it in email_change until confirmed)
  if coalesce(to_jsonb(new) ->> 'email_change', '') <> ''
     and not private.email_domain_allowed(to_jsonb(new) ->> 'email_change') then
    raise exception 'Only PCC email addresses can sign up.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

revoke all on function private.enforce_email_domain() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists pccg_before_insert_domain on auth.users;
create trigger pccg_before_insert_domain before insert on auth.users
  for each row execute function private.enforce_email_domain();

drop trigger if exists pccg_before_update_email_domain on auth.users;
create trigger pccg_before_update_email_domain before update of email, email_change on auth.users
  for each row when (new.email is distinct from old.email
                     or to_jsonb(new) ->> 'email_change' is distinct from to_jsonb(old) ->> 'email_change')
  execute function private.enforce_email_domain();

drop trigger if exists pccg_after_insert_profile on auth.users;
create trigger pccg_after_insert_profile after insert on auth.users
  for each row execute function private.handle_new_user();
