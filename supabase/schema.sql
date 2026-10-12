-- Run once in your Supabase project's SQL editor. Safe to run again.
begin;
create table if not exists public.dogehouse_builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  build jsonb not null check (jsonb_typeof(build) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists dogehouse_builds_user_id_idx on public.dogehouse_builds(user_id);
alter table public.dogehouse_builds enable row level security;
revoke all on public.dogehouse_builds from anon, authenticated;
grant select, insert, delete on public.dogehouse_builds to authenticated;
drop policy if exists "Read own builds" on public.dogehouse_builds;
create policy "Read own builds" on public.dogehouse_builds for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "Save own builds" on public.dogehouse_builds;
create policy "Save own builds" on public.dogehouse_builds for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own builds" on public.dogehouse_builds;
create policy "Delete own builds" on public.dogehouse_builds for delete to authenticated
using ((select auth.uid()) = user_id);
commit;
