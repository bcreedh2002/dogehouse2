const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 const {siteConfig}=await import('../supabase/functions/_shared/site-config.ts');
 const attempts=new Map(),sessions=new Map(),payments=new Map(),calls=[],requests=[];let failExpire=false,failCleanup=false,creates=0;
 const env={STRIPE_SECRET_KEY:'sk_test_synthetic',SITE_URL:'https://example.com/'};
 const make=(id,extra={})=>{const a={id,order_id:'order',amount_cents:30000,session_id:null,status:'pending',created_at:new Date().toISOString(),...extra};attempts.set(id,a);return a;};
 const provider=(a,extra={})=>({id:'cs_'+a.id,mode:'payment',livemode:false,metadata:{dogehouse_attempt_id:a.id,dogehouse_order_id:a.order_id},status:'open',payment_status:'unpaid',currency:'usd',amount_total:30000,payment_intent:null,url:'https://checkout.stripe.com/c/pay/test',...extra});
 const admin={auth:{admin:{getUserById:async()=>({data:{user:{email:'verified@example.com'}}})}},
  from(table){let filters=[],update=null;const run=()=>{let data=table==='dogehouse_orders'?[{id:'order',user_id:'server-user'}]:[...attempts.values()];data=data.filter(row=>filters.every(([k,v])=>row[k]===v));if(update)data.forEach(row=>Object.assign(row,update));return {data,error:null};};
   const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},is:(k,v)=>{filters.push([k,v]);return q;},update:v=>{update=v;return q;},single:async()=>({...run(),data:run().data[0]}),maybeSingle:async()=>({...run(),data:run().data[0]||null}),then:(ok,bad)=>Promise.resolve(run()).then(ok,bad)};return q;},
  rpc:async(name,args)=>{calls.push([name,args]);if(name==='reconcile_dogehouse_orphan')attempts.get(args.p_attempt_id).status='expired';if(name==='record_dogehouse_payment'){const a=attempts.get(args.p_attempt_id);if(a.status!=='paid'){a.status=args.p_paid?'paid':'expired';a.session_id=args.p_session_id;a.payment_intent_id=args.p_intent_id;}}return {};}
 };
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/payment-backend.ts','utf8').replace(/^import .*;\n/gm,'')).replace('export function paymentBackend','function paymentBackend')+'\nglobalThis.factory=paymentBackend;';
 const context={Deno:{env:{get:k=>env[k]}},createClient:()=>admin,siteConfig,URL,URLSearchParams,AbortSignal,Date,Error,Number,
  fetch:async(url,options)=>{
   requests.push([url,options]);const path=new URL(url).pathname;
   if(path.endsWith('/checkout/sessions')&&options.method==='POST'){
    const id=options.body.get('metadata[dogehouse_attempt_id]');let s=sessions.get('cs_'+id);if(!s){creates++;s=provider(attempts.get(id));sessions.set(s.id,s);}return Response.json(s);
   }
   if(path.endsWith('/checkout/sessions'))return Response.json({data:[...sessions.values()],has_more:false});
   if(path.includes('/payment_intents/'))return Response.json(payments.get(path.split('/').at(-1))||{livemode:false,metadata:{}});
   const exp=path.endsWith('/expire'),sid=path.split('/').at(exp?-2:-1),s=sessions.get(sid);
   if(exp&&failExpire){Object.assign(s,{status:'complete',payment_status:'paid',payment_intent:'pi_race'});return Response.json({error:'provider error'},{status:400});}if(exp&&failCleanup)return Response.json({error:'provider error'},{status:400});
   if(!s)return Response.json({error:'unknown'},{status:404});
   if(exp){if(s.payment_status==='paid')return Response.json({error:'complete'},{status:400});s.status='expired';}
   return Response.json(s);
  }};
 vm.runInNewContext(code,context);const backend=context.factory().backend;
 const a=make('a');await backend.checkout(a);await backend.checkout({...a,session_id:null});
 assert.equal(creates,1,'interrupted bind/retry reuses Stripe idempotency key');
 const body=requests.find(([,o])=>o.body?.get('customer_email'))[1].body;
 assert.equal(body.get('customer_email'),'verified@example.com');assert.equal(body.get('line_items[0][price_data][unit_amount]'),'30000');assert.equal(new URL(body.get('success_url')).searchParams.get('checkout'),'success');assert.equal(new URL(body.get('cancel_url')).searchParams.get('checkout'),'cancelled');
 const old=make('old',{created_at:'2020-01-01T00:00:00Z'});sessions.set('cs_old',provider(old));await backend.checkout(old);assert.equal(old.session_id,'cs_old');assert.equal(creates,1,'old orphan is recovered without POST creation');
 const missing=make('missing',{created_at:'2020-01-01T00:00:00Z'});assert.equal((await backend.checkout(missing)).reconciled_without_session,true);assert.equal(missing.status,'expired');assert.equal(creates,1);attempts.delete('missing');
 // Stale expiry must consult Stripe: paid wins, then competing checkout is expired.
 const other=make('other');sessions.set('cs_other',provider(other));other.session_id='cs_other';
 const paid=sessions.get('cs_a');paid.status='complete';paid.payment_status='paid';paid.payment_intent='pi_a';
 await backend.record('a','cs_a',30000,false,null);
 assert.equal(attempts.get('a').status,'paid');assert.equal(attempts.get('a').payment_intent_id,'pi_a');assert.equal(other.status,'expired');
 assert.equal(sessions.get('cs_other').status,'expired');
 const open=make('open',{session_id:'cs_open'});sessions.set('cs_open',provider(open));await assert.rejects(()=>backend.record('open','cs_open',30000,false,null),/Expiry not confirmed/);assert.equal(open.status,'pending');
 // Provider expire loses a race to payment: persist capture and refuse cancellation.
 const race=make('race',{session_id:'cs_race'});sessions.set('cs_race',provider(race));failExpire=true;
 assert.equal(await backend.expire(race),false);assert.equal(race.status,'paid');failExpire=false;
 const retry=make('retry',{session_id:'cs_retry'});sessions.set('cs_retry',provider(retry));failCleanup=true;
 await assert.rejects(()=>backend.record('a','cs_a',30000,true,'pi_a'));assert.equal(a.status,'paid','cleanup failure retains capture');
 failCleanup=false;await backend.record('a','cs_a',30000,true,'pi_a');assert.equal(retry.status,'expired','replayed capture retries cleanup');
 // Charge metadata absent: resolve by PI. Unknown purchase is ignored; known but
 // unrecorded DogeHouse capture stays retryable until completed arrives.
 await backend.refund('pi_a',1000);assert.equal(calls.at(-1)[0],'record_dogehouse_refund');
 const before=calls.length;await backend.refund('pi_unrelated',1000);assert.equal(calls.length,before);
 const early=make('early');payments.set('pi_early',{livemode:false,metadata:{dogehouse_attempt_id:'early'}});await assert.rejects(()=>backend.refund('pi_early',1000),/not yet recorded/);
 sessions.set('cs_early',provider(early,{status:'complete',payment_status:'paid',payment_intent:'pi_early'}));await backend.record('early','cs_early',30000,true,'pi_early');await backend.refund('pi_early',1000);assert.equal(calls.at(-1)[0],'record_dogehouse_refund');
 env.STRIPE_LIVE_MODE='true';assert.throws(()=>context.factory(),/mode must match/);env.STRIPE_SECRET_KEY='sk_live_synthetic';env.SUPABASE_URL='https://jpncaudfzxqjzddyrkss.supabase.co';assert.throws(()=>context.factory(),/forbids live/);
 console.log('PASS: real backend with mocked Stripe/Auth/storage: idempotency, orphan recovery, stale expiry/paid precedence, cancellation, capture-first cleanup/retry and refunds without Charge metadata. No real charges.');
})().catch(error=>{console.error(error);process.exitCode=1});
