const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',now()),('${alice}','alice@example.com',now()),('${bob}','bob@example.com',now()),('${other}','other@example.com',now());`);
for(const file of ['schema.sql','owner-access.sql','orders.sql','order-management.sql','payments.sql','launch-hardening.sql','launch-hardening.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
await db.query('insert into dogehouse_owners values($1)',[other]);
async function as(role,id,fn){await db.exec(`set role ${role};set request.jwt.claim.sub='${id||''}'`);try{return await fn()}finally{await db.exec('reset role;reset request.jwt.claim.sub')}}
const create=async()=> (await db.query("insert into dogehouse_orders(user_id,request_id,name,build,total_cents) values($1,gen_random_uuid(),'test','{}',30000) returning id",[alice])).rows[0].id;
const id=await create(),cancel=await create();
const manage=(id,version,status)=>db.query("select * from manage_dogehouse_order($1,$2,$3,'not_started')",[id,version,status]);
await as('authenticated',owner,async()=>{
 await assert.rejects(()=>manage(id,0,'confirmed'),e=>e.code==='22023');
 await db.query('select approve_dogehouse_quote($1,30000)',[id]);
 const row=(await db.query('select * from dogehouse_managed_customer_orders()')).rows.find(r=>r.id===id);
 assert.equal(row.approved_total_cents,30000);assert.equal(row.payment_status,'unpaid');assert.equal(row.quote_email_status,'queued');assert.equal(row.status_version,1);
 await assert.rejects(()=>manage(id,0,'cancelled'),e=>e.code==='P0001');
});
await as('authenticated',other,()=>assert.rejects(()=>db.query('select approve_dogehouse_quote($1,30000)',[cancel]),e=>e.code==='42501'));
let attempt;
await as('service_role',null,async()=>{attempt=(await db.query('select * from reserve_dogehouse_payment($1,$2)',[id,alice])).rows[0];});
await as('authenticated',owner,()=>assert.rejects(()=>manage(id,1,'cancelled'),e=>e.code==='22023'));
await as('service_role',null,async()=>{
 await db.query("select record_dogehouse_payment($1,'cs_test',30000,true,'pi_test')",[attempt.id]);
 const claimed=(await db.query('select * from claim_dogehouse_quote_email($1)',[id])).rows[0];assert.equal(claimed.quote_email_status,'sending');
 assert.equal((await db.query('select * from claim_dogehouse_quote_email($1)',[id])).rows[0]?.id,null);
});
await as('authenticated',owner,()=>assert.rejects(()=>manage(id,2,'cancelled'),e=>e.code==='22023'));
await as('service_role',null,()=>db.query("select record_dogehouse_refund('pi_test',1000)"));
await as('authenticated',owner,()=>assert.rejects(()=>manage(id,2,'cancelled'),e=>e.code==='22023'));
await as('service_role',null,()=>db.query("select record_dogehouse_refund('pi_test',30000)"));
await as('authenticated',owner,async()=>{assert.equal((await manage(id,2,'cancelled')).rows[0].status,'cancelled');assert.equal((await manage(cancel,0,'cancelled')).rows[0].status,'cancelled');});
await as('authenticated',alice,async()=>{
 assert.equal((await db.query('select * from dogehouse_orders')).rows.length,2);
 await assert.rejects(()=>db.query('select * from dogehouse_managed_customer_orders()'),e=>e.code==='42501');
 await assert.rejects(()=>db.query('insert into dogehouse_builds(user_id,name,build) values($1,$2,$3)',[alice,'large',JSON.stringify({x:'x'.repeat(1500001)})]),e=>e.code==='22023');
 for(let n=0;n<20;n++)await db.query("insert into dogehouse_builds(user_id,name,build) values($1,'save','{}')",[alice]);
 await db.query('delete from dogehouse_builds');
 await assert.rejects(()=>db.query("insert into dogehouse_builds(user_id,name,build,created_at) values($1,'limit','{}','2000-01-01')",[alice]),e=>e.code==='22023');
});
await as('authenticated',bob,async()=>{assert.equal((await db.query('select * from dogehouse_orders')).rows.length,0);assert.equal((await db.query('select * from dogehouse_builds')).rows.length,0)});
console.log('PASS: real SQL dashboard contract, immutable quote, owner identity, version checks, pending/paid/refunded cancellation, quote email claim, save cap/rate and two-account isolation');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
