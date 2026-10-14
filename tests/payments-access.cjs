const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333';
 await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',now()),('${alice}','alice@example.com',now()),('${bob}','bob@example.com',now());`);
 for(const file of ['schema.sql','owner-access.sql','orders.sql','payments.sql','payments.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 async function as(role,uid,work){await db.exec(`set role ${role};set request.jwt.claim.sub='${uid||''}'`);try{return await work()}finally{await db.exec('reset role;reset request.jwt.claim.sub');}}
 const order=(await db.query('select * from create_dogehouse_order($1,$2,$3,$4,$5)',[alice,bob,'Buddy','{}',34900])).rows[0].id;
 const approve=amount=>db.query('select approve_dogehouse_quote($1,$2)',[order,amount]);
 const reserve=user=>db.query('select * from reserve_dogehouse_payment($1,$2)',[order,user]);
 await as('service_role',null,()=>assert.rejects(()=>reserve(alice)));
 await as('authenticated',alice,async()=>{
  await assert.rejects(()=>approve(1),e=>e.code==='42501');
  await assert.rejects(()=>reserve(alice),e=>e.code==='42501');
  await assert.rejects(()=>db.query("update dogehouse_orders set payment_status='paid'"),e=>e.code==='42501');
  await assert.rejects(()=>db.query('select * from dogehouse_payment_attempts'),e=>e.code==='42501');
 });
 await as('authenticated',owner,async()=>{
  await assert.rejects(()=>approve(49));await assert.rejects(()=>approve(null));await approve(42000);await approve(42000);await assert.rejects(()=>approve(42001));
  assert.equal((await db.query('select * from dogehouse_customer_orders()')).rows[0].approved_total_cents,42000);
 });
 let attempt;
 const record=(id,session,amount,paid,intent)=>db.query('select record_dogehouse_payment($1,$2,$3,$4,$5)',[id,session,amount,paid,intent]);
 await as('service_role',null,async()=>{
  await assert.rejects(()=>reserve(bob));attempt=(await reserve(alice)).rows[0];assert.equal(attempt.amount_cents,42000);
  assert.equal((await reserve(alice)).rows[0].id,attempt.id,'Duplicate checkout requests share one attempt');
  await assert.rejects(()=>record(attempt.id,'cs_1',1,true,'pi_1'));
  await record(attempt.id,'cs_1',42000,false,null);
  await assert.rejects(()=>record(attempt.id,'cs_1',42000,true,'pi_1'),'Expired attempts cannot later charge');
  const next=(await reserve(alice)).rows[0];assert.notEqual(next.id,attempt.id);
  await db.query('update dogehouse_payment_attempts set session_id=$1 where id=$2',['cs_2',next.id]);
  await assert.rejects(()=>record(next.id,'cs_spoof',42000,true,'pi_2'));
  await record(next.id,'cs_2',42000,true,'pi_2');await record(next.id,'cs_2',42000,true,'pi_2');
  await record(next.id,'cs_2',42000,false,null); // Old expiry delivery cannot undo payment.
  assert.equal((await db.query('select payment_status from dogehouse_orders where id=$1',[order])).rows[0].payment_status,'paid');
  await assert.rejects(()=>reserve(alice));
  const refund=amount=>db.query('select record_dogehouse_refund($1,$2)',['pi_2',amount]);
  await refund(10000);await refund(5000);assert.equal((await db.query('select payment_status from dogehouse_orders where id=$1',[order])).rows[0].payment_status,'partially_refunded');
  await refund(42000);await refund(10000);assert.equal((await db.query('select payment_status from dogehouse_orders where id=$1',[order])).rows[0].payment_status,'refunded');
  await assert.rejects(()=>refund(42001));await assert.rejects(()=>reserve(alice));
 });
 await as('authenticated',bob,async()=>assert.equal((await db.query('select * from dogehouse_orders')).rows.length,0));
 await as('anon',null,async()=>{await assert.rejects(()=>approve(42000),e=>e.code==='42501');await assert.rejects(()=>db.query('select * from dogehouse_orders'),e=>e.code==='42501');});
 console.log('PASS: payment migration repeatability, owner-only immutable quotes, customer isolation, server-only checkout/payment/refund writes, stable attempts, expiry renewal, amount/session checks, duplicate/out-of-order events and monotonic refunds.');
 }finally{await db.close()}})().catch(error=>{console.error(error);process.exitCode=1;});
