-- Opslag voor de Kerstlijst-app. De tabel staat in een niet-blootgesteld schema;
-- de app kan er alleen bij via twee functies die een geheim wachtwoord controleren.
create schema if not exists kerstlijst;

create table if not exists kerstlijst.store (
  id int primary key default 1 check (id = 1),
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists kerstlijst.config (
  key text primary key,
  value text not null
);
alter table kerstlijst.store enable row level security;
alter table kerstlijst.config enable row level security;
revoke all on schema kerstlijst from anon, authenticated;

-- Zet het geheim (zelfde waarde als KL_STORE_SECRET op Render):
-- insert into kerstlijst.config(key, value) values ('store_secret', '<geheim>')
--   on conflict (key) do update set value = excluded.value;

create or replace function public.kl_get(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from kerstlijst.config where key = 'store_secret') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return coalesce((select doc from kerstlijst.store where id = 1), '{}'::jsonb);
end $$;

create or replace function public.kl_put(p_secret text, p_doc jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from kerstlijst.config where key = 'store_secret') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into kerstlijst.store (id, doc, updated_at) values (1, p_doc, now())
  on conflict (id) do update set doc = excluded.doc, updated_at = now();
end $$;

revoke all on function public.kl_get(text) from public;
revoke all on function public.kl_put(text, jsonb) from public;
grant execute on function public.kl_get(text) to anon, authenticated;
grant execute on function public.kl_put(text, jsonb) to anon, authenticated;

-- Ochtendronde (Render gratis slaapt, dus Supabase wekt de app en start de agent).
-- 06:00 UTC = 07:00 Brusselse wintertijd.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- select cron.schedule('kerstlijst-wake', '55 5 * * *', $$ select net.http_get('https://<app>.onrender.com/api/health', timeout_milliseconds := 90000) $$);
-- select cron.schedule('kerstlijst-run', '0 6 * * *', $$ select net.http_post('https://<app>.onrender.com/api/run', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('Content-Type','application/json','x-admin-token','<ADMIN_TOKEN>'), 90000) $$);
-- select cron.schedule('kerstlijst-keepalive', '*/5 6 * * *', $$ select net.http_get('https://<app>.onrender.com/api/health', timeout_milliseconds := 90000) $$);
