const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333';
await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',now()),('${alice}','alice@example.com',now()),('${bob}','bob@example.com',now());`);
for(const file of ['schema.sql','owner-access.sql','orders.sql','orders.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
async function as(role,uid,work){await db.exec(`set role ${role};set request.jwt.claim.sub='${uid||''}'`);try{return await work();}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
const request='44444444-4444-4444-8444-444444444444';
const create=(uid,rid=request,name='Original')=>db.query('select * from public.create_dogehouse_order($1,$2,$3,$4,$5)',[uid,rid,name,JSON.stringify({version:2,studio:{nameplate:'BUDDY'}}),34900]);
let id;
await as('service_role',null,async()=>{id=(await create(alice)).rows[0].id;assert.equal((await create(alice,request,'Changed')).rows[0].name,'Original');await create(bob);assert.equal((await db.query('select count(*)::int as count from dogehouse_orders')).rows[0].count,2);
assert.equal((await db.query('select * from claim_dogehouse_order_email($1)',[id])).rows[0].email_status,'sending');assert.equal((await db.query('select * from claim_dogehouse_order_email($1)',[id])).rows[0].id,null);
await db.query("update dogehouse_orders set email_claimed_at=now()-interval '3 minutes' where id=$1",[id]);assert.equal((await db.query('select * from claim_dogehouse_order_email($1)',[id])).rows[0].email_attempts,2);
await db.query("update dogehouse_orders set email_status='failed',email_attempts=5 where id=$1",[id]);assert.equal((await db.query('select * from claim_dogehouse_order_email($1)',[id])).rows[0].id,null);
for(let n=1;n<=4;n++)await create(alice,`55555555-5555-4555-8555-${String(n).padStart(12,'0')}`);
await assert.rejects(()=>create(alice,'66666666-6666-4666-8666-666666666666'),e=>e.code==='P0001');assert.equal((await create(alice)).rows[0].id,id,'Existing requests remain retryable after the rate limit.');});
await as('authenticated',alice,async()=>{assert.equal((await db.query('select * from dogehouse_orders')).rows.length,5);assert.equal((await db.query('select * from dogehouse_builds')).rows.length,0,'Orders are separate from saves.');
for(const sql of ["insert into dogehouse_orders(user_id,request_id,name,build,total_cents) values('"+alice+"','"+request+"','Spoof','{}',1)","update dogehouse_orders set total_cents=1","delete from dogehouse_orders",'select * from dogehouse_customer_orders(0,25)','select * from claim_dogehouse_order_email(\''+id+'\')'])await assert.rejects(()=>db.query(sql),e=>e.code==='42501');await assert.rejects(()=>create(bob),e=>e.code==='42501');});
await as('authenticated',bob,async()=>assert.equal((await db.query('select * from dogehouse_orders')).rows.length,1));
await as('authenticated',owner,async()=>{assert.equal((await db.query('select * from dogehouse_customer_orders(0,25)')).rows.length,6);assert.equal((await db.query('select * from dogehouse_customer_orders(1,1)')).rows.length,1);await assert.rejects(()=>db.query("update dogehouse_orders set status='confirmed'"),e=>e.code==='42501');});
await as('anon',null,async()=>{await assert.rejects(()=>db.query('select * from dogehouse_orders'),e=>e.code==='42501');await assert.rejects(()=>create(alice),e=>e.code==='42501');});
console.log('PASS: actual order SQL, repeatable migration, immutable snapshots/idempotency, atomic email claim/lease/limit, request rate limit, separate saves/orders, customer isolation, owner read-only listing, denied anonymous access and browser mutation.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
