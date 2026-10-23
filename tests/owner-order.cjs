const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
const {siteConfig}=await import('../supabase/functions/_shared/site-config.ts'),{limitedBody}=await import('../supabase/functions/_shared/payments.ts');
const id='11111111-1111-4111-8111-111111111111';let handler,confirmed=true,owner=true,attempts=[],calls=[],emails=[],expired=true,failMail=false,approved=false,claimed=false;
const order={id,user_id:id,approved_total_cents:30000,quote_email_attempts:1};
const admin={auth:{getUser:async token=>({data:{user:token==='valid'?{email:'salesandinfo@thedogehouse.com',email_confirmed_at:confirmed?'now':null}:null}}),admin:{getUserById:async()=>({data:{user:{email:'customer@example.com'}}})}},
 rpc:async(name,args)=>{calls.push([name,args]);if(name==='claim_dogehouse_quote_email'){if(claimed)return {data:null};claimed=true;return {data:order};}return {};},
 from:()=>({select:()=>({eq:()=>({eq:async()=>({data:attempts})})}),update:value=>({eq:()=>({eq:()=>({eq:async()=>{calls.push(['finish',value]);return {};}})})})})};
const caller={rpc:async(name,args)=>{calls.push([name,args]);if(name==='is_dogehouse_owner')return {data:owner};if(name==='approve_dogehouse_quote')approved=true;if(name==='begin_dogehouse_cancellation')return {data:true};return {};}};
const env={SITE_URL:'https://test.example',SUPABASE_URL:'https://mock.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',STRIPE_SECRET_KEY:'sk_test_synthetic',RESEND_API_KEY:'re_synthetic',ORDER_EMAIL_FROM:'DogeHouse <test@example.com>'};
const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/owner-order/index.ts','utf8').replace(/^import .*;\n/gm,''));
vm.runInNewContext(code,{Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},paymentBackend:()=>({backend:{expire:async attempt=>{if(!attempt.session_id)throw Error('Needs reconciliation');calls.push(['record_dogehouse_payment']);return expired;}}}),createClient:(url,key)=>key==='service'?admin:caller,siteConfig,limitedBody,URL,Response,Request,AbortSignal,Number,JSON,Error,
 fetch:async(url,options)=>{
  if(url.includes('resend.com')){emails.push(JSON.parse(options.body));return new Response('{}',{status:failMail?503:200});}
  return new Response(JSON.stringify({id:'cs_test',status:expired?'expired':'complete',payment_status:expired?'unpaid':'paid',amount_total:30000}),{status:expired||!options.method?200:400});
 }});
const req=(body,token='valid',origin='https://test.example')=>new Request('https://test.example',{method:'POST',headers:{origin,authorization:'Bearer '+token},body:JSON.stringify(body)});
assert.equal((await handler(req({},'bad'))).status,403);
confirmed=false;assert.equal((await handler(req({}))).status,403);confirmed=true;
owner=false;assert.equal((await handler(req({}))).status,403);owner=true;
assert.equal((await handler(req({},'valid','https://evil.example'))).status,403);
assert.equal((await handler(req({action:'approve',orderId:id,amountCents:1}))).status,400);assert.equal(approved,false);
const result=await (await handler(req({action:'approve',orderId:id,amountCents:30000,email:'spoof@example.com'}))).json();assert.equal(result.emailStatus,'sent');assert.equal(approved,true);assert.deepEqual(emails[0].to,['customer@example.com']);assert.ok(emails[0].text.includes('$300.00'));assert.ok(emails[0].text.includes('https://test.example/#orders'));
assert.equal((await (await handler(req({action:'notify',orderId:id}))).json()).emailStatus,'unchanged');assert.equal(emails.length,1);
claimed=false;failMail=true;assert.equal((await (await handler(req({action:'notify',orderId:id}))).json()).emailStatus,'failed');assert.equal(calls.at(-1)[1].quote_email_status,'failed');
attempts=[{id,session_id:null}];assert.equal((await handler(req({action:'cancel',orderId:id,version:1,fulfillment:'not_started'}))).status,503);
attempts=[{id,session_id:'cs_test'}];expired=false;assert.equal((await handler(req({action:'cancel',orderId:id,version:1,fulfillment:'not_started'}))).status,409);
expired=true;assert.equal((await handler(req({action:'cancel',orderId:id,version:1,fulfillment:'not_started'}))).status,200);assert.equal(calls.at(-1)[0],'manage_dogehouse_order');assert.equal(calls.at(-2)[0],'record_dogehouse_payment');
console.log('PASS: actual owner handler with mocked Auth/Stripe/Resend: owner identity and membership, CORS, immutable server email/amount, claim retry, expiry-before-cancel and completed/orphaned session rejection. No real messages or charges.');
})().catch(error=>{console.error(error);process.exitCode=1});
