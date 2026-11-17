-- seed.sql — idempotent. Allowed domains only. TO CONFIRM with PCC IT.
insert into private.settings (id, allowed_domains)
values (1, array['pcci.edu', 'students.pcci.edu'])
on conflict (id) do nothing;

-- DENYLIST: see seed_denylist.sql
