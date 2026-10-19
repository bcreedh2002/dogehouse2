import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {siteConfig} from '../_shared/site-config.ts';
import {limitedBody} from '../_shared/payments.ts';
const {siteUrl,allowedOrigins}=siteConfig(Deno.env.get('SITE_URL'),Deno.env.get('ALLOWED_ORIGINS'));
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(!allowedOrigins.includes(origin))return new Response('Origin denied',{status:403});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply({error:'POST required'},405);
 try{
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const {data:identity,error:identityError}=await admin.auth.getUser(token||'');
  if(identityError||!identity.user?.email_confirmed_at||identity.user.email?.toLowerCase()!=='salesandinfo@thedogehouse.com')return reply({error:'Owner access required'},403);
  // Use the caller JWT for SQL owner authorization and state/version checks.
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:owner,error:ownerError}=await caller.rpc('is_dogehouse_owner');
  if(ownerError||owner!==true)return reply({error:'Owner access required'},403);
  let body;try{body=JSON.parse(await limitedBody(request,4096));}catch{return reply({error:'Invalid request'},400);}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.orderId||''))return reply({error:'Invalid order'},400);
  if(body.action==='cancel'){
   const {data:attempts,error}=await admin.from('dogehouse_payment_attempts').select('*').eq('order_id',body.orderId).eq('status','pending');if(error)throw error;
   const key=Deno.env.get('STRIPE_SECRET_KEY')||'',live=Deno.env.get('STRIPE_LIVE_MODE')==='true';
   if(attempts.length&&!key.startsWith(live?'sk_live_':'sk_test_'))throw Error('Stripe mode mismatch');
   for(const attempt of attempts){
    // Missing sessions may represent interrupted creation; do not cancel blindly.
    if(!attempt.session_id)return reply({error:'Checkout needs reconciliation before cancellation.'},409);
    const response=await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(attempt.session_id)+'/expire',{method:'POST',headers:{Authorization:'Bearer '+key,'Stripe-Version':'2024-06-20'},signal:AbortSignal.timeout(20000)});
    let session=await response.json();
    if(!response.ok){
     const lookup=await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(attempt.session_id),{headers:{Authorization:'Bearer '+key,'Stripe-Version':'2024-06-20'},signal:AbortSignal.timeout(20000)});
     if(!lookup.ok)throw Error('Checkout lookup failed');session=await lookup.json();
    }
    if(session.status!=='expired'||session.payment_status==='paid')return reply({error:'Checkout completed or is still active. Refresh payment status before cancelling.'},409);
    const recorded=await admin.rpc('record_dogehouse_payment',{p_attempt_id:attempt.id,p_session_id:session.id,p_amount_cents:session.amount_total,p_paid:false,p_intent_id:null});if(recorded.error)throw recorded.error;
   }
   const {error:cancelError}=await caller.rpc('manage_dogehouse_order',{p_order_id:body.orderId,p_expected_version:body.version,p_status:'cancelled',p_fulfillment_status:body.fulfillment});
   if(cancelError)return reply({error:cancelError.message},409);return reply({cancelled:true});
  }
  if(body.action!=='approve'&&body.action!=='notify')return reply({error:'Invalid action'},400);
  if(body.action==='approve'){
   if(!Number.isSafeInteger(body.amountCents)||body.amountCents<50||body.amountCents>10000000)return reply({error:'Invalid final total'},400);
   const {error}=await caller.rpc('approve_dogehouse_quote',{p_order_id:body.orderId,p_amount_cents:body.amountCents});if(error)return reply({error:error.message},409);
  }
  const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('ORDER_EMAIL_FROM');
  if(!key||!from)return reply({approved:true,emailStatus:'unconfigured'});
  const {data:claimed,error:claimError}=await admin.rpc('claim_dogehouse_quote_email',{p_order_id:body.orderId});if(claimError)throw claimError;
  const order=Array.isArray(claimed)?claimed[0]:claimed;if(!order?.id)return reply({approved:true,emailStatus:'unchanged'});
  let sent=false;
  try{
   const {data,error}=await admin.auth.admin.getUserById(order.user_id);if(error||!data.user?.email)throw Error('Customer unavailable');
   const link=new URL(siteUrl);link.hash='orders';
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'quote-'+order.id},body:JSON.stringify({from,to:[data.user.email],subject:'Your DogeHouse quote is ready',text:'Your final DogeHouse total is $'+(order.approved_total_cents/100).toFixed(2)+', including shipping and tax. Sign in to review your order and pay: '+link.href}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Email delivery failed');sent=true;
  }catch{sent=false;}
  const {error:finishError}=await admin.from('dogehouse_orders').update({quote_email_status:sent?'sent':'failed'}).eq('id',order.id).eq('quote_email_attempts',order.quote_email_attempts).eq('quote_email_status','sending');if(finishError)throw finishError;
  return reply({approved:true,emailStatus:sent?'sent':'failed'});
 }catch{return reply({error:'Service unavailable. Refresh the order before retrying.'},503);}
});
