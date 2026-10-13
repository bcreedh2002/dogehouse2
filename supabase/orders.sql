-- Run after schema.sql and owner-access.sql. Customers cannot fabricate or alter orders.
begin;
create table if not exists public.dogehouse_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 name text not null check(char_length(name) between 1 and 80),
 build jsonb not null check(jsonb_typeof(build)='object'),
 total_cents integer not null check(total_cents>=0),
 status text not null default 'requested' check(status in ('requested','confirmed','cancelled')),
 email_status text not null default 'queued' check(email_status in ('queued','sending','sent','failed')),
 email_attempts integer not null default 0,
 email_claimed_at timestamptz,
 email_provider_id text,
 email_error text,
 created_at timestamptz not null default now(),
 unique(user_id,request_id)
);
create index if not exists dogehouse_orders_user_idx on public.dogehouse_orders(user_id,created_at desc);
alter table public.dogehouse_orders enable row level security;
revoke all on public.dogehouse_orders from public,anon,authenticated;
grant select on public.dogehouse_orders to authenticated;
grant select,insert,update on public.dogehouse_orders to service_role;
drop policy if exists "Read own orders" on public.dogehouse_orders;
create policy "Read own orders" on public.dogehouse_orders for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "Owners read orders" on public.dogehouse_orders;
create policy "Owners read orders" on public.dogehouse_orders for select to authenticated using((select public.is_dogehouse_owner()));

create or replace function public.create_dogehouse_order(p_user_id uuid,p_request_id uuid,p_name text,p_build jsonb,p_total_cents integer)
returns public.dogehouse_orders language plpgsql security definer set search_path=''
as $$ declare result public.dogehouse_orders; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into result from public.dogehouse_orders where user_id=p_user_id and request_id=p_request_id;
 if found then return result; end if;
 if (select count(*) from public.dogehouse_orders where user_id=p_user_id and created_at>now()-interval '1 hour')>=5 then
  raise exception 'Order request limit reached' using errcode='P0001';
 end if;
 insert into public.dogehouse_orders(user_id,request_id,name,build,total_cents) values(p_user_id,p_request_id,p_name,p_build,p_total_cents) returning * into result;
 return result;
end; $$;
revoke all on function public.create_dogehouse_order(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.create_dogehouse_order(uuid,uuid,text,jsonb,integer) to service_role;

create or replace function public.claim_dogehouse_order_email(p_order_id uuid)
returns public.dogehouse_orders language sql security definer set search_path=''
as $$ update public.dogehouse_orders set email_status='sending',email_attempts=email_attempts+1,email_claimed_at=now(),email_error=null
where id=p_order_id and email_attempts<5 and (email_status in ('queued','failed') or (email_status='sending' and email_claimed_at<now()-interval '2 minutes')) returning *; $$;
revoke all on function public.claim_dogehouse_order_email(uuid) from public,anon,authenticated;
grant execute on function public.claim_dogehouse_order_email(uuid) to service_role;

create or replace function public.dogehouse_customer_orders(p_offset integer default 0,p_limit integer default 25)
returns table(id uuid,user_id uuid,name text,build jsonb,total_cents integer,status text,email_status text,created_at timestamptz,customer_email text)
language plpgsql stable security definer set search_path=''
as $$ begin
 if not public.is_dogehouse_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 return query select o.id,o.user_id,o.name,o.build,o.total_cents,o.status,o.email_status,o.created_at,u.email::text
 from public.dogehouse_orders o join auth.users u on u.id=o.user_id
 order by o.created_at desc,o.id desc offset greatest(coalesce(p_offset,0),0) limit greatest(1,least(coalesce(p_limit,25),100));
end; $$;
revoke all on function public.dogehouse_customer_orders(integer,integer) from public,anon;
grant execute on function public.dogehouse_customer_orders(integer,integer) to authenticated;
commit;
