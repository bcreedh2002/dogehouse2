// Execute the real Supabase SQL against PostgreSQL (PGlite), with auth.uid fixtures.
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333';
await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;grant usage on schema public,auth to anon,authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values('${owner}','salesandinfo@thedogehouse.com',null),('${alice}','alice@example.com',now()),('${bob}','bob@example.com',now());`);
const schema=fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'),migration=fs.readFileSync(path.join(__dirname,'../supabase/owner-access.sql'),'utf8');
await db.exec(schema);await db.exec(migration);assert.equal((await db.query('select * from public.dogehouse_owners')).rows.length,0,'Unconfirmed owner must not be granted access.');
await db.exec(`update auth.users set email_confirmed_at=now() where id='${owner}'`);await db.exec(migration);await db.exec(migration);assert.equal((await db.query('select * from public.dogehouse_owners')).rows.length,1);
async function as(role,uid,work){await db.exec(`set role ${role};set request.jwt.claim.sub='${uid||''}'`);try{return await work();}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
const payload=JSON.stringify({version:2,studio:{nameplate:'BUDDY',roofType:'metal'},preview:{}});
await as('authenticated',alice,()=>db.query('insert into public.dogehouse_builds(user_id,name,build) values($1,$2,$3)',[alice,'Alice design',payload]));
await as('authenticated',bob,()=>db.query('insert into public.dogehouse_builds(user_id,name,build) values($1,$2,$3)',[bob,'Bob design',payload]));
await as('authenticated',alice,async()=>{
 assert.equal((await db.query('select * from public.dogehouse_builds')).rows.length,1);
 assert.equal((await db.query('select public.is_dogehouse_owner() as owner')).rows[0].owner,false);
 await assert.rejects(()=>db.query('select * from public.dogehouse_customer_designs(0,25)'),e=>e.code==='42501');
 await assert.rejects(()=>db.query('insert into public.dogehouse_owners(user_id) values($1)',[alice]),e=>e.code==='42501');
 await assert.rejects(()=>db.query('select * from public.dogehouse_owners'),e=>e.code==='42501');
 await assert.rejects(()=>db.query('insert into public.dogehouse_builds(user_id,name,build) values($1,$2,$3)',[bob,'Spoof',payload]),e=>e.code==='42501');
 assert.equal((await db.query('delete from public.dogehouse_builds where user_id=$1 returning id',[bob])).rows.length,0);
});
await as('authenticated',owner,async()=>{
 assert.equal((await db.query('select public.is_dogehouse_owner() as owner')).rows[0].owner,true);
 assert.equal((await db.query('select * from public.dogehouse_builds')).rows.length,2);
 const records=(await db.query('select * from public.dogehouse_customer_designs(0,25)')).rows;assert.equal(records.length,2);assert.deepEqual(records.map(r=>r.customer_email).sort(),['alice@example.com','bob@example.com']);
 assert.equal((await db.query('select * from public.dogehouse_customer_designs(1,1)')).rows.length,1);
 assert.equal((await db.query('delete from public.dogehouse_builds where user_id=$1 returning id',[alice])).rows.length,0,'Owner has read access, not permission to delete customer designs.');
});
await as('anon',null,async()=>{await assert.rejects(()=>db.query('select * from public.dogehouse_builds'),e=>e.code==='42501');await assert.rejects(()=>db.query('select * from public.dogehouse_customer_designs(0,25)'),e=>e.code==='42501');});
await as('authenticated',alice,async()=>{assert.equal((await db.query('delete from public.dogehouse_builds where user_id=$1 returning id',[alice])).rows.length,1);});
console.log('PASS: real PostgreSQL policies, confirmed-owner grant, migration repeatability, customer isolation, owner read-only access, paging, anonymous denial, spoofed insert denial, and privilege-escalation denial. Live Supabase JWT authentication is not simulated here.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
