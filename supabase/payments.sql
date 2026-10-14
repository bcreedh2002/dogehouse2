-- Run after orders.sql. Amounts are USD cents and include shipping and tax.
begin;
alter table public.dogehouse_orders add column if not exists approved_total_cents integer check(approved_total_cents between 50 and 10000000);
alter table public.dogehouse_orders add column if not exists payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid','partially_refunded','refunded'));
create table if not exists public.dogehouse_payment_attempts(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.dogehouse_orders(id),
 amount_cents integer not null check(amount_cents between 50 and 10000000),
 provider text not null default 'stripe' check(provider='stripe'),
 status text not null default 'pending' check(status in ('pending','paid','expired')),
 session_id text unique,
 payment_intent_id text unique,
 refunded_cents integer not null default 0,
 created_at timestamptz not null default now()
);
create unique index if not exists dogehouse_one_pending_payment on public.dogehouse_payment_attempts(order_id) where status='pending';
alter table public.dogehouse_payment_attempts enable row level security;
revoke all on public.dogehouse_payment_attempts from public,anon,authenticated;
grant select,insert,update on public.dogehouse_payment_attempts to service_role;
create or replace function public.approve_dogehouse_quote(p_order_id uuid,p_amount_cents integer)
returns void language plpgsql security definer set search_path='' as $$
declare o public.dogehouse_orders;
begin
 if not public.is_dogehouse_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 if p_amount_cents is null or p_amount_cents not between 50 and 10000000 then raise exception 'Invalid final amount'; end if;
 select * into o from public.dogehouse_orders where id=p_order_id for update;
 if not found or o.status='cancelled' then raise exception 'Order unavailable'; end if;
 if o.approved_total_cents is not null then
  if o.approved_total_cents=p_amount_cents then return; end if;
  raise exception 'Approved quotes cannot be changed; create a new order request';
 end if;
 update public.dogehouse_orders set approved_total_cents=p_amount_cents,status='confirmed' where id=p_order_id;
end; $$;
revoke all on function public.approve_dogehouse_quote(uuid,integer) from public,anon;
grant execute on function public.approve_dogehouse_quote(uuid,integer) to authenticated;
create or replace function public.reserve_dogehouse_payment(p_order_id uuid,p_user_id uuid)
returns public.dogehouse_payment_attempts language plpgsql security definer set search_path='' as $$
declare o public.dogehouse_orders; a public.dogehouse_payment_attempts;
begin
 select * into o from public.dogehouse_orders where id=p_order_id for update;
 if not found or o.user_id<>p_user_id or o.status<>'confirmed' or o.approved_total_cents is null or o.payment_status<>'unpaid' then raise exception 'Order is not payable'; end if;
 select * into a from public.dogehouse_payment_attempts where order_id=p_order_id and status='pending';
 if found then return a; end if;
 insert into public.dogehouse_payment_attempts(order_id,amount_cents) values(p_order_id,o.approved_total_cents) returning * into a;
 return a;
end; $$;
revoke all on function public.reserve_dogehouse_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_dogehouse_payment(uuid,uuid) to service_role;
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
 if p_paid then update public.dogehouse_orders set payment_status='paid' where id=a.order_id; end if;
end; $$;
revoke all on function public.record_dogehouse_payment(uuid,text,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.record_dogehouse_payment(uuid,text,integer,boolean,text) to service_role;
create or replace function public.record_dogehouse_refund(p_intent_id text,p_refunded_cents integer)
returns void language plpgsql security definer set search_path='' as $$
declare a public.dogehouse_payment_attempts;
begin
 select * into a from public.dogehouse_payment_attempts where payment_intent_id=p_intent_id;
 if not found then raise exception 'Payment not yet recorded'; end if;
 perform 1 from public.dogehouse_orders where id=a.order_id for update;
 select * into a from public.dogehouse_payment_attempts where id=a.id for update;
 if a.status<>'paid' or p_refunded_cents not between 0 and a.amount_cents then raise exception 'Invalid refund'; end if;
 update public.dogehouse_payment_attempts set refunded_cents=greatest(refunded_cents,p_refunded_cents) where id=a.id;
 update public.dogehouse_orders set payment_status=case when greatest(a.refunded_cents,p_refunded_cents)=a.amount_cents then 'refunded' when greatest(a.refunded_cents,p_refunded_cents)>0 then 'partially_refunded' else 'paid' end where id=a.order_id;
end; $$;
revoke all on function public.record_dogehouse_refund(text,integer) from public,anon,authenticated;
grant execute on function public.record_dogehouse_refund(text,integer) to service_role;
-- Replace the owner listing to expose quote/payment status.
drop function public.dogehouse_customer_orders(integer,integer);
create function public.dogehouse_customer_orders(p_offset integer default 0,p_limit integer default 25)
returns table(id uuid,user_id uuid,name text,build jsonb,total_cents integer,status text,email_status text,created_at timestamptz,customer_email text,approved_total_cents integer,payment_status text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_dogehouse_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 return query select o.id,o.user_id,o.name,o.build,o.total_cents,o.status,o.email_status,o.created_at,u.email::text,o.approved_total_cents,o.payment_status
 from public.dogehouse_orders o join auth.users u on u.id=o.user_id
 order by o.created_at desc,o.id desc offset greatest(coalesce(p_offset,0),0) limit greatest(1,least(coalesce(p_limit,25),100));
end; $$;
revoke all on function public.dogehouse_customer_orders(integer,integer) from public,anon;
grant execute on function public.dogehouse_customer_orders(integer,integer) to authenticated;
commit;
