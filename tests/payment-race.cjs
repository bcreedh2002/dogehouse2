const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',now()),('${alice}','alice@example.com',now()),('${bob}','bob@example.com',now()),('${other}','other@example.com',now());`);
for(const file of ['schema.sql','owner-access.sql','orders.sql','order-management.sql','payments.sql','launch-hardening.sql','launch-hardening.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));

const create=async()=> (await db.query("insert into dogehouse_orders(user_id,request_id,name,build,total_cents,approved_total_cents,status) values($1,gen_random_uuid(),'race','{}',30000,30000,'confirmed') returning id",[alice])).rows[0].id;
const reserve=async id=>(await db.query('select * from reserve_dogehouse_payment($1,$2)',[id,alice])).rows[0];
const record=(a,paid,intent='pi_'+a.id,session='cs_'+a.id,amount=30000)=>db.query('select record_dogehouse_payment($1,$2,$3,$4,$5)',[a.id,session,amount,paid,paid?intent:null]);
const row=async id=>(await db.query('select * from dogehouse_orders where id=$1',[id])).rows[0];
const id=await create(),a=await reserve(id);
await record(a,false);
await db.exec(`set request.jwt.claim.sub='${owner}'`);
await db.query("select * from manage_dogehouse_order($1,0,'cancelled','not_started')",[id]);
await db.exec('reset request.jwt.claim.sub');
// The exact Oct 22 claim: expiration persisted, cancellation committed, then capture delivered.
await record(a,true);
assert.equal((await row(id)).status,'confirmed');assert.equal((await row(id)).payment_status,'paid');assert.equal((await row(id)).payment_review_required,true);
assert.equal((await row(id)).status_version,2);
await record(a,true);await record(a,false);assert.equal((await row(id)).status_version,2,'replay does not increment version');
assert.equal((await reserve(id)).id,a.id,'paid retry reuses captured attempt');
await assert.rejects(()=>record(a,true,'pi_different'));
await assert.rejects(()=>record(a,true,'pi_'+a.id,'cs_spoof'));
await assert.rejects(()=>record(a,true,'pi_'+a.id,'cs_'+a.id,1));
const retry=await create(),old=await reserve(retry);await record(old,false);
const next=await reserve(retry);assert.notEqual(old.id,next.id);assert.equal((await reserve(retry)).id,next.id);
await record(old,true);assert.equal((await reserve(retry)).id,old.id);
assert.equal((await row(retry)).payment_review_required,true,'late capture with another attempt needs review');
const fenced=await create(),pending=await reserve(fenced);
await db.exec(`set request.jwt.claim.sub='${owner}'`);
await assert.rejects(()=>db.query('select begin_dogehouse_cancellation($1,99)',[fenced]));
assert.equal((await row(fenced)).payment_cancellation_requested,false,'stale cancel has no side effects');
assert.equal((await db.query('select begin_dogehouse_cancellation($1,0) as ok',[fenced])).rows[0].ok,true);
await assert.rejects(()=>reserve(fenced),'cancel fence prevents a second checkout');
await record(pending,false);await assert.rejects(()=>reserve(fenced),'no reserve in expiry-to-cancel gap');
await record(pending,true);assert.equal((await row(fenced)).payment_review_required,true);
await assert.rejects(()=>db.query("select * from manage_dogehouse_order($1,0,'cancelled','not_started')",[fenced]));
await db.exec('reset request.jwt.claim.sub');
await db.query('select record_dogehouse_refund($1,1000)',['pi_'+a.id]);await record(a,true);
assert.equal((await row(id)).payment_status,'partially_refunded');
await db.query('select record_dogehouse_refund($1,30000)',['pi_'+a.id]);await record(a,true);
assert.equal((await row(id)).payment_status,'refunded');
// Service reconciliation requires a genuinely old, still unbound pending row.
const orphanOrder=await create(),orphan=await reserve(orphanOrder);
await assert.rejects(()=>db.query('select reconcile_dogehouse_orphan($1)',[orphan.id]));
await db.query("update dogehouse_payment_attempts set created_at=now()-interval '24 hours' where id=$1",[orphan.id]);
await db.query('select reconcile_dogehouse_orphan($1)',[orphan.id]);
assert.notEqual((await reserve(orphanOrder)).id,orphan.id);
await db.exec(`set role authenticated;set request.jwt.claim.sub='${alice}'`);
await assert.rejects(()=>db.query('select reconcile_dogehouse_orphan($1)',[orphan.id]),e=>e.code==='42501');
await assert.rejects(()=>db.query('select begin_dogehouse_cancellation($1,0)',[orphanOrder]),e=>e.code==='42501');
await db.exec('reset role;reset request.jwt.claim.sub');
// A current paid form is denied without changing the row; a pre-payment form
// is a racing cancellation even if the webhook won before the fence RPC.
const won=await create(),winner=await reserve(won);await record(winner,true);
await db.exec(`set request.jwt.claim.sub='${owner}'`);
assert.equal((await db.query('select begin_dogehouse_cancellation($1,1) as ok',[won])).rows[0].ok,false);
assert.equal((await row(won)).payment_review_required,false);
assert.equal((await db.query('select begin_dogehouse_cancellation($1,0) as ok',[won])).rows[0].ok,false);
assert.equal((await row(won)).payment_review_required,true);
await db.exec('reset request.jwt.claim.sub');
// Historical second capture: never lose money evidence or call the whole order
// refunded while another captured intent still has unrefunded funds.
await record(next,true);await db.query('select record_dogehouse_refund($1,30000)',['pi_'+old.id]);
assert.equal((await row(retry)).payment_status,'partially_refunded');
await db.query('select record_dogehouse_refund($1,30000)',['pi_'+next.id]);assert.equal((await row(retry)).payment_status,'refunded');
console.log('PASS: isolated real SQL late capture after cancel/expiry, cancellation fencing, stale versions, repeated/out-of-order events, retry identity and refunds');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
