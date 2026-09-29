-- =====================================================================
-- Ashirbad Enterprise – Supabase schema
-- Run once in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: tables/policies are created only if missing.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Administrators: only users listed here may edit content / read leads
-- ---------------------------------------------------------------------
create table if not exists public.admins (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins can see admins" on public.admins;
create policy "admins can see admins" on public.admins
    for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Projects: stage 'live' = homepage carousel; 'sold' / 'completed' = gallery
-- ---------------------------------------------------------------------
create table if not exists public.projects (
    id             uuid primary key default gen_random_uuid(),
    title          text not null,
    slug           text,
    location       text,
    stage          text not null default 'live' check (stage in ('live', 'sold', 'completed')),
    status_label   text,
    plot_size      text,
    carpet_area    text,
    config         text,
    price          text,
    description    text,
    img            text,
    images         jsonb not null default '[]'::jsonb,
    lat            double precision,
    lng            double precision,
    completed_year text,
    sort_order     integer not null default 0,
    sold_at        timestamptz,
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Commercial listings
-- ---------------------------------------------------------------------
create table if not exists public.commercial (
    id         uuid primary key default gen_random_uuid(),
    title      text not null,
    type       text,
    area       text,
    size       text,
    img        text,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Blog posts
-- ---------------------------------------------------------------------
create table if not exists public.posts (
    id           uuid primary key default gen_random_uuid(),
    slug         text not null unique,
    title        text not null,
    category     text,
    author       text,
    excerpt      text,
    content      text,
    cover        text,
    read_time    text,
    published    boolean not null default true,
    published_at date not null default current_date,
    created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Leads (enquiries from the website forms)
-- ---------------------------------------------------------------------
create table if not exists public.leads (
    id         uuid primary key default gen_random_uuid(),
    name       text not null check (char_length(name) between 2 and 120),
    phone      text not null check (char_length(phone) between 8 and 20),
    email      text check (email is null or char_length(email) <= 200),
    interest   text,
    project    text,
    config     text,
    budget     text,
    location   text,
    visit_date date,
    message    text check (message is null or char_length(message) <= 3000),
    source     text,
    utm        jsonb,
    status     text not null default 'New',
    created_at timestamptz not null default now()
);

create index if not exists projects_stage_idx on public.projects (stage, sort_order);
create index if not exists posts_published_idx on public.posts (published, published_at desc);
create index if not exists leads_created_idx on public.leads (created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.projects   enable row level security;
alter table public.commercial enable row level security;
alter table public.posts      enable row level security;
alter table public.leads      enable row level security;

-- Projects & commercial: everyone can read, only admins can write
drop policy if exists "public read projects" on public.projects;
create policy "public read projects" on public.projects for select to anon, authenticated using (true);
drop policy if exists "admin write projects" on public.projects;
create policy "admin write projects" on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read commercial" on public.commercial;
create policy "public read commercial" on public.commercial for select to anon, authenticated using (true);
drop policy if exists "admin write commercial" on public.commercial;
create policy "admin write commercial" on public.commercial for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Posts: visitors see published posts; admins see and edit everything
drop policy if exists "public read posts" on public.posts;
create policy "public read posts" on public.posts for select to anon, authenticated using (published or public.is_admin());
drop policy if exists "admin write posts" on public.posts;
create policy "admin write posts" on public.posts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Leads: anyone may submit a NEW lead, only admins can read / update / delete
drop policy if exists "public insert leads" on public.leads;
create policy "public insert leads" on public.leads for insert to anon, authenticated with check (status = 'New');
drop policy if exists "admin read leads" on public.leads;
create policy "admin read leads" on public.leads for select to authenticated using (public.is_admin());
drop policy if exists "admin update leads" on public.leads;
create policy "admin update leads" on public.leads for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete leads" on public.leads;
create policy "admin delete leads" on public.leads for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Storage bucket for uploaded images (public read, admin write)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "public read media" on storage.objects;
create policy "public read media" on storage.objects for select to anon, authenticated using (bucket_id = 'media');
drop policy if exists "admin upload media" on storage.objects;
create policy "admin upload media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
drop policy if exists "admin update media" on storage.objects;
create policy "admin update media" on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_admin());
drop policy if exists "admin delete media" on storage.objects;
create policy "admin delete media" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- ---------------------------------------------------------------------
-- LAST STEP (run separately after creating your admin user in
-- Authentication → Users → Add user). Replace the email below:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'admin@ashirbadenterprise.com';
-- ---------------------------------------------------------------------
