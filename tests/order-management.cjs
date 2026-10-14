const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
const owner='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222',otherOwner='33333333-3333-4333-8333-333333333333';
await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',now()),('${customer}','customer@example.com',now()),('${otherOwner}','other@example.com',now());`);
for(const file of ['schema.sql','owner-access.sql','orders.sql','order-management.sql','order-management.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
await db.query('insert into dogehouse_owners(user_id) values($1)',[otherOwner]);
const build={version:2,studio:{roofShape:'gable',nameplate:'BUDDY'},preview:{backLeft:'original-back',frontRight:'original-front'},customer:{customerEmail:'contact@example.com'}};
const orders=await db.query('insert into dogehouse_orders(user_id,request_id,name,build,total_cents) values($1,gen_random_uuid(),$2,$3,42900),($1,gen_random_uuid(),$2,$3,42900),($1,gen_random_uuid(),$2,$3,42900) returning *',[customer,'Original design',JSON.stringify(build)]);const id=orders.rows[0].id,cancelId=orders.rows[1].id,raceId=orders.rows[2].id;
async function as(role,uid,work){await db.exec(`set role ${role};set request.jwt.claim.sub='${uid||''}'`);try{return await work();}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
const manage=(order,version,status,stage)=>db.query('select * from manage_dogehouse_order($1,$2,$3,$4)',[order,version,status,stage]);
for(const user of [customer,otherOwner])await as('authenticated',user,async()=>{await assert.rejects(()=>manage(id,0,'confirmed','not_started'),e=>e.code==='42501');await assert.rejects(()=>db.query("update dogehouse_orders set status='confirmed'"),e=>e.code==='42501');});
await as('anon',null,()=>assert.rejects(()=>manage(id,0,'confirmed','not_started'),e=>e.code==='42501'));
await as('authenticated',owner,async()=>{
const race=await Promise.allSettled([manage(raceId,0,'confirmed','not_started'),manage(raceId,0,'cancelled','not_started')]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.find(result=>result.status==='rejected').reason.code,'P0001');
await assert.rejects(()=>manage(id,0,'requested','in_production'),e=>e.code==='22023');await assert.rejects(()=>manage(id,0,'paid','not_started'),e=>e.code==='22023');
let result=(await manage(id,0,'confirmed','not_started')).rows[0];assert.equal(result.status_version,1);assert.equal(result.status,'confirmed');assert.ok(result.updated_at);
await assert.rejects(()=>manage(id,0,'cancelled','not_started'),e=>e.code==='P0001','Stale versions must not overwrite confirmation.');
assert.equal((await manage(id,1,'confirmed','not_started')).rows[0].status_version,1,'No-op must not increment version.');
await assert.rejects(()=>manage(id,1,'requested','not_started'),e=>e.code==='22023');
for(const [version,stage] of [[1,'in_production'],[2,'ready'],[3,'completed']]){result=(await manage(id,version,'confirmed',stage)).rows[0];assert.equal(result.fulfillment_status,stage);assert.equal(result.status_version,version+1);}
await assert.rejects(()=>manage(id,4,'cancelled','completed'),e=>e.code==='22023');
assert.equal((await manage(cancelId,0,'cancelled','not_started')).rows[0].status,'cancelled');await assert.rejects(()=>manage(cancelId,1,'confirmed','not_started'),e=>e.code==='22023');
const stored=(await db.query('select * from dogehouse_orders where id=$1',[id])).rows[0];assert.deepEqual(stored.build,build);assert.equal(stored.total_cents,42900);assert.equal(stored.name,'Original design');assert.equal(stored.user_id,customer);assert.equal(stored.email_status,'queued');assert.equal(stored.updated_by,owner);
assert.equal((await db.query('select * from dogehouse_managed_customer_orders(0,25)')).rows[0].status_version!==undefined,true);assert.equal((await db.query('select * from dogehouse_customer_orders(0,25)')).rows.length,3,'Older order listing stays compatible.');
});
await as('authenticated',customer,async()=>{const records=(await db.query('select status,fulfillment_status from dogehouse_orders')).rows;assert.ok(records.some(r=>r.status==='confirmed'&&r.fulfillment_status==='completed'));await assert.rejects(()=>db.query('select * from dogehouse_managed_customer_orders(0,25)'),e=>e.code==='42501');});
console.log('PASS: repeatable migration; owner-only status RPC; customer/anonymous/other-owner denial; stale version protection; confirmation/cancellation/fulfillment rules; immutable design/price/identity/email; customer progress visibility; compatible older listing.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
