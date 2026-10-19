-- Apply AFTER schema, owner-access, orders, order-management and payments.
begin;
alter table public.dogehouse_orders add column if not exists payment_review_required boolean not null default false;
alter table public.dogehouse_orders add column if not exists quote_email_status text not null default 'queued' check(quote_email_status in ('queued','sending','sent','failed'));
alter table public.dogehouse_orders add column if not exists quote_email_attempts integer not null default 0;
alter table public.dogehouse_orders add column if not exists quote_email_claimed_at timestamptz;
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
 if p_status='confirmed' and current_order.approved_total_cents is null then
  raise exception 'Approve the final quote before confirming' using errcode='22023';
 end if;
 if p_status='cancelled' and (current_order.payment_status in ('paid','partially_refunded') or exists(select 1 from public.dogehouse_payment_attempts a where a.order_id=p_order_id and a.status='pending')) then
  raise exception 'Refund payment or expire and reconcile checkout before cancelling' using errcode='22023';
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
drop function if exists public.dogehouse_managed_customer_orders(integer,integer);
create function public.dogehouse_managed_customer_orders(p_offset integer default 0,p_limit integer default 25)
returns table(id uuid,user_id uuid,name text,build jsonb,total_cents integer,status text,email_status text,
 fulfillment_status text,status_version integer,updated_at timestamptz,created_at timestamptz,customer_email text,approved_total_cents integer,payment_status text,quote_email_status text,payment_review_required boolean)
language plpgsql stable security definer set search_path=''
as $$ begin
 if not public.is_dogehouse_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 return query select o.id,o.user_id,o.name,o.build,o.total_cents,o.status,o.email_status,
  o.fulfillment_status,o.status_version,o.updated_at,o.created_at,u.email::text,o.approved_total_cents,o.payment_status,o.quote_email_status,o.payment_review_required
 from public.dogehouse_orders o join auth.users u on u.id=o.user_id
 order by o.created_at desc,o.id desc offset greatest(coalesce(p_offset,0),0) limit greatest(1,least(coalesce(p_limit,25),100));
end; $$;
revoke all on function public.dogehouse_managed_customer_orders(integer,integer) from public,anon;
grant execute on function public.dogehouse_managed_customer_orders(integer,integer) to authenticated;
create or replace function public.approve_dogehouse_quote(p_order_id uuid,p_amount_cents integer)
returns void language plpgsql security definer set search_path='' as $$
declare o public.dogehouse_orders;
begin
 if not public.is_dogehouse_owner() or not exists(select 1 from auth.users u where u.id=(select auth.uid()) and lower(u.email)='salesandinfo@thedogehouse.com' and u.email_confirmed_at is not null) then raise exception 'Owner access required' using errcode='42501'; end if;
 if p_amount_cents is null or p_amount_cents not between 50 and 10000000 then raise exception 'Invalid final amount'; end if;
 select * into o from public.dogehouse_orders where id=p_order_id for update;
 if not found or o.status='cancelled' then raise exception 'Order unavailable'; end if;
 if o.approved_total_cents is not null then
  if o.approved_total_cents=p_amount_cents then return; end if;
  raise exception 'Approved quotes cannot be changed; create a new order request';
 end if;
 update public.dogehouse_orders set approved_total_cents=p_amount_cents,status='confirmed',status_version=status_version+1,updated_at=now(),updated_by=(select auth.uid()) where id=p_order_id;
end; $$;
revoke all on function public.approve_dogehouse_quote(uuid,integer) from public,anon;
grant execute on function public.approve_dogehouse_quote(uuid,integer) to authenticated;

-- A pending checkout blocks cancellation until Stripe confirms it expired or paid.
-- Both paths acquire the order lock first, preventing cancellation/payment races.
create or replace function public.claim_dogehouse_quote_email(p_order_id uuid)
returns public.dogehouse_orders language sql security definer set search_path='' as $$
 update public.dogehouse_orders set quote_email_status='sending',quote_email_attempts=quote_email_attempts+1,quote_email_claimed_at=now()
 where id=p_order_id and status='confirmed' and approved_total_cents is not null and quote_email_attempts<5
 and (quote_email_status in ('queued','failed') or (quote_email_status='sending' and quote_email_claimed_at<now()-interval '2 minutes')) returning *;
$$;
revoke all on function public.claim_dogehouse_quote_email(uuid) from public,anon,authenticated;
grant execute on function public.claim_dogehouse_quote_email(uuid) to service_role;

create or replace function public.record_dogehouse_payment(p_attempt_id uuid,p_session_id text,p_amount_cents integer,p_paid boolean,p_intent_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.dogehouse_payment_attempts;
begin
 select * into a from public.dogehouse_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'Unknown payment'; end if;
 perform 1 from public.dogehouse_orders where id=a.order_id for update;
 select * into a from public.dogehouse_payment_attempts where id=p_attempt_id for update;
 if a.amount_cents<>p_amount_cents or (a.session_id is not null and a.session_id<>p_session_id) then raise exception 'Payment mismatch'; end if;
 if a.status='paid' then return; end if;
 if p_paid and (a.status<>'pending' or p_intent_id is null) then raise exception 'Unexpected payment state'; end if;
 update public.dogehouse_payment_attempts set session_id=p_session_id,status=case when p_paid then 'paid' else 'expired' end,payment_intent_id=case when p_paid then p_intent_id else null end where id=a.id;
 if p_paid then update public.dogehouse_orders set payment_status='paid',payment_review_required=(status='cancelled'),status='confirmed',status_version=status_version+1,updated_at=now() where id=a.order_id; end if;
end; $$;
revoke all on function public.record_dogehouse_payment(uuid,text,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.record_dogehouse_payment(uuid,text,integer,boolean,text) to service_role;

-- Payload cap includes both preview images. Serialize saves per account.
create table if not exists public.dogehouse_build_save_events(user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create index if not exists dogehouse_build_save_events_user_time on public.dogehouse_build_save_events(user_id,created_at);
alter table public.dogehouse_build_save_events enable row level security;
revoke all on public.dogehouse_build_save_events from public,anon,authenticated;
create or replace function public.limit_dogehouse_build_save()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if octet_length(new.build::text)>1500000 then raise exception 'Saved design is too large' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,1));
 if (select count(*) from public.dogehouse_build_save_events where user_id=new.user_id and created_at>now()-interval '1 hour')>=20 then
  raise exception 'Save limit reached. Try again later.' using errcode='22023';
 end if;
 new.created_at=now();
 delete from public.dogehouse_build_save_events where user_id=new.user_id and created_at<=now()-interval '1 hour';
 insert into public.dogehouse_build_save_events(user_id) values(new.user_id);
 return new;
end; $$;
revoke all on function public.limit_dogehouse_build_save() from public,anon,authenticated;
drop trigger if exists dogehouse_build_save_limit on public.dogehouse_builds;
create trigger dogehouse_build_save_limit before insert on public.dogehouse_builds for each row execute function public.limit_dogehouse_build_save();
commit;
