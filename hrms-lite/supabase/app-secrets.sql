-- The keys the application itself needs, as opposed to the settings HR edits.
-- Kept out of the Settings table on purpose: that one is handed whole to every
-- HR session by bootstrap, and a signing key must never travel to a browser.

set search_path to hrms, public, extensions;

create table if not exists hrms.app_secrets (
  key         text primary key,
  value       text not null,
  created_at  timestamptz not null default now()
);

revoke all on hrms.app_secrets from anon, authenticated;

-- 256 random bits, worked out by Postgres. Nobody types it, nobody reads it
-- back, and it is written once: the "do nothing" means re-running this
-- cannot roll the key and sign everybody out.
insert into hrms.app_secrets (key, value)
values ('token_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;
