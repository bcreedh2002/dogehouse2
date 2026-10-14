-- Run after orders.sql. Restrict owner changes to status/progress metadata.
begin;
alter table public.dogehouse_orders
 add column if not exists fulfillment_status text not null default 'not_started',
 add column if not exists status_version integer not null default 0,
 add column if not exists updated_at timestamptz,
 add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.dogehouse_orders drop constraint if exists dogehouse_order_fulfillment_check;
alter table public.dogehouse_orders add constraint dogehouse_order_fulfillment_check
 check(fulfillment_status in ('not_started','in_production','ready','completed'));

create or replace function public.manage_dogehouse_order(
 p_order_id uuid,p_expected_version integer,p_status text,p_fulfillment_status text)
returns table(id uuid,status text,fulfillment_status text,status_version integer,updated_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare current_order public.dogehouse_orders;
begin
 if not public.is_dogehouse_owner() or not exists (
  select 1 from auth.users u where u.id=(select auth.uid())
   and lower(u.email)='salesandinfo@thedogehouse.com' and u.email_confirmed_at is not null
 ) then raise exception 'Owner access required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('requested','confirmed','cancelled')
  or p_fulfillment_status is null or p_fulfillment_status not in ('not_started','in_production','ready','completed') then
  raise exception 'Invalid order status' using errcode='22023';
 end if;
 select o.* into current_order from public.dogehouse_orders o where o.id=p_order_id for update;
 if not found then raise exception 'Order no longer exists' using errcode='P0002'; end if;
 if p_expected_version is null or current_order.status_version<>p_expected_version then
  raise exception 'Order changed. Refresh before updating it.' using errcode='P0001';
 end if;
 if (current_order.status='cancelled' and (p_status<>current_order.status or p_fulfillment_status<>current_order.fulfillment_status))
  or (current_order.status='confirmed' and p_status='requested') then
  raise exception 'This order cannot return to that status' using errcode='22023';
 end if;
 if p_status='cancelled' and current_order.fulfillment_status='completed' and current_order.status<>'cancelled' then
  raise exception 'Completed orders cannot be cancelled' using errcode='22023';
 end if;
 if p_status<>'confirmed' and p_fulfillment_status<>current_order.fulfillment_status then
  raise exception 'Confirm the order before changing fulfillment' using errcode='22023';
 end if;
 if p_status=current_order.status and p_fulfillment_status=current_order.fulfillment_status then
  return query select current_order.id,current_order.status,current_order.fulfillment_status,current_order.status_version,current_order.updated_at;return;
 end if;
 return query update public.dogehouse_orders o
 set status=p_status,fulfillment_status=p_fulfillment_status,status_version=o.status_version+1,updated_at=now(),updated_by=(select auth.uid())
 where o.id=p_order_id returning o.id,o.status,o.fulfillment_status,o.status_version,o.updated_at;
end; $$;
revoke all on function public.manage_dogehouse_order(uuid,integer,text,text) from public,anon;
grant execute on function public.manage_dogehouse_order(uuid,integer,text,text) to authenticated;

-- Separate listing keeps the existing order RPC compatible with older clients.
create or replace function public.dogehouse_managed_customer_orders(p_offset integer default 0,p_limit integer default 25)
returns table(id uuid,user_id uuid,name text,build jsonb,total_cents integer,status text,email_status text,
 fulfillment_status text,status_version integer,updated_at timestamptz,created_at timestamptz,customer_email text)
language plpgsql stable security definer set search_path=''
as $$ begin
 if not public.is_dogehouse_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 return query select o.id,o.user_id,o.name,o.build,o.total_cents,o.status,o.email_status,
  o.fulfillment_status,o.status_version,o.updated_at,o.created_at,u.email::text
 from public.dogehouse_orders o join auth.users u on u.id=o.user_id
 order by o.created_at desc,o.id desc offset greatest(coalesce(p_offset,0),0) limit greatest(1,least(coalesce(p_limit,25),100));
end; $$;
revoke all on function public.dogehouse_managed_customer_orders(integer,integer) from public,anon;
grant execute on function public.dogehouse_managed_customer_orders(integer,integer) to authenticated;
commit;
