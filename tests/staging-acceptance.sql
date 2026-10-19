-- Synthetic transaction only. ROLLBACK removes every test record and auth row.
-- Run only on DogeHouseTest1 after verifying project identity.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('e1111111-1111-4111-8111-111111111111','salesandinfo@thedogehouse.com',now()),
 ('e2222222-2222-4222-8222-222222222222','alice@example.invalid',now()),
 ('e3333333-3333-4333-8333-333333333333','bob@example.invalid',now());
insert into public.dogehouse_owners values('e1111111-1111-4111-8111-111111111111');
insert into public.dogehouse_orders(id,user_id,request_id,name,build,total_cents) values
 ('e4444444-4444-4444-8444-444444444444','e2222222-2222-4222-8222-222222222222',gen_random_uuid(),'Synthetic test','{}',30000);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$ begin
 begin
  perform public.manage_dogehouse_order('e4444444-4444-4444-8444-444444444444',0,'confirmed','not_started');
  raise exception 'FAIL: price-free confirmation succeeded';
 exception when invalid_parameter_value then null; end;
 perform public.approve_dogehouse_quote('e4444444-4444-4444-8444-444444444444',30000);
 if not exists(select 1 from public.dogehouse_managed_customer_orders() where approved_total_cents=30000 and payment_status='unpaid' and status_version=1) then raise exception 'FAIL: dashboard contract'; end if;
end $$;
reset role;
select public.reserve_dogehouse_payment('e4444444-4444-4444-8444-444444444444','e2222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$ begin
 begin
  perform public.manage_dogehouse_order('e4444444-4444-4444-8444-444444444444',1,'cancelled','not_started');
  raise exception 'FAIL: pending checkout cancellation succeeded';
 exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','e3333333-3333-4333-8333-333333333333',true);
do $$ begin
 if exists(select 1 from public.dogehouse_orders) then raise exception 'FAIL: another account sees order'; end if;
 begin
  perform public.approve_dogehouse_quote('e4444444-4444-4444-8444-444444444444',30000);
  raise exception 'FAIL: customer approval succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: hosted SQL dashboard contract, quote-only confirmation, pending checkout cancellation denial, cross-account isolation and non-owner denial; all synthetic records rolled back' as result;
