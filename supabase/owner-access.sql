-- Run after schema.sql in Supabase SQL Editor. Does not expose customer designs publicly.
begin;
create table if not exists public.dogehouse_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.dogehouse_owners enable row level security;
revoke all on public.dogehouse_owners from public, anon, authenticated;

create or replace function public.is_dogehouse_owner()
returns boolean language sql stable security definer
set search_path = ''
as $$ select exists(select 1 from public.dogehouse_owners where user_id = (select auth.uid())); $$;
revoke all on function public.is_dogehouse_owner() from public, anon;
grant execute on function public.is_dogehouse_owner() to authenticated;

drop policy if exists "Owners read customer designs" on public.dogehouse_builds;
create policy "Owners read customer designs" on public.dogehouse_builds
for select to authenticated using ((select public.is_dogehouse_owner()));

create or replace function public.dogehouse_customer_designs(p_offset integer default 0, p_limit integer default 25)
returns table(id uuid, user_id uuid, name text, build jsonb, created_at timestamptz, customer_email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_dogehouse_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  return query select b.id, b.user_id, b.name, b.build, b.created_at, u.email::text
  from public.dogehouse_builds b join auth.users u on u.id = b.user_id
  order by b.created_at desc, b.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(1, least(coalesce(p_limit, 25), 100));
end; $$;
revoke all on function public.dogehouse_customer_designs(integer, integer) from public, anon;
grant execute on function public.dogehouse_customer_designs(integer, integer) to authenticated;

-- Owner membership is granted here, never through a public browser setting.
-- Create and confirm this account on the website first, then rerun this script.
insert into public.dogehouse_owners(user_id)
select id from auth.users
where lower(email) = 'salesandinfo@thedogehouse.com' and email_confirmed_at is not null
on conflict do nothing;
commit;

-- Verify the owner grant. Expect exactly one row; zero means the account is not confirmed yet.
select u.email from public.dogehouse_owners o join auth.users u on u.id=o.user_id
where lower(u.email) = 'salesandinfo@thedogehouse.com';
