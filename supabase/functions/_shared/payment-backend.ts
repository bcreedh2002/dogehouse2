import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import type {PaymentBackend} from './payments.ts';
export function paymentBackend():{backend:PaymentBackend;live:boolean}{
 const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')||'';
 const live=Deno.env.get('STRIPE_LIVE_MODE')==='true';
 if(!stripeKey.startsWith(live?'sk_live_':'sk_test_'))throw Error('Stripe key and payment mode must match');
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const siteUrl=Deno.env.get('SITE_URL')||'https://bcreedh2002.github.io/dogehouse2/dogehouse-launch.html';
 const site=new URL(siteUrl);if(site.protocol!=='https:'&&site.hostname!=='127.0.0.1'&&site.hostname!=='localhost')throw Error('HTTPS site required');
 const allowedOrigins=(Deno.env.get('ALLOWED_ORIGINS')||site.origin).split(',').map(value=>value.trim());
 async function stripe(path:string,body?:URLSearchParams,idempotency?:string){
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+stripeKey,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotency!}:{})},body,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Stripe request failed');return response.json();
 }
 const backend:PaymentBackend={
  siteUrl,allowedOrigins,
  async authenticate(token){const {data,error}=await admin.auth.getUser(token);return !error&&data.user?.email_confirmed_at?data.user.id:null;},
  async reserve(orderId,userId){const {data,error}=await admin.rpc('reserve_dogehouse_payment',{p_order_id:orderId,p_user_id:userId});if(error)throw error;return Array.isArray(data)?data[0]:data;},
  async checkout(attempt){
   if(attempt.session_id)return stripe('checkout/sessions/'+encodeURIComponent(attempt.session_id));
   // Stripe idempotency expires after 24 hours. Fail closed on an orphaned older
   // attempt instead of risking two chargeable sessions after an interrupted save.
   const {data:stored,error:readError}=await admin.from('dogehouse_payment_attempts').select('created_at').eq('id',attempt.id).single();
   if(readError||Date.now()-Date.parse(stored.created_at)>23*60*60*1000)throw Error('Payment attempt needs reconciliation');
   const returnUrl=new URL(siteUrl);returnUrl.hash='orders';
   const body=new URLSearchParams({
    mode:'payment','payment_method_types[0]':'card',
    'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(attempt.amount_cents),
    'line_items[0][price_data][product_data][name]':'DogeHouse approved order',
    'line_items[0][quantity]':'1',client_reference_id:attempt.order_id,
    'metadata[dogehouse_attempt_id]':attempt.id,'metadata[dogehouse_order_id]':attempt.order_id,
    'payment_intent_data[metadata][dogehouse_attempt_id]':attempt.id,
    'payment_intent_data[metadata][dogehouse_order_id]':attempt.order_id,
    success_url:returnUrl.href,cancel_url:returnUrl.href
   });
   const session=await stripe('checkout/sessions',body,'dogehouse-'+attempt.id);
   const {error}=await admin.from('dogehouse_payment_attempts').update({session_id:session.id}).eq('id',attempt.id).is('session_id',null);
   if(error)throw error;return session;
  },
  async record(attemptId,sessionId,amount,paid,intent){const {error}=await admin.rpc('record_dogehouse_payment',{p_attempt_id:attemptId,p_session_id:sessionId,p_amount_cents:amount,p_paid:paid,p_intent_id:intent});if(error)throw error;},
  async refund(intent,amount){const {error}=await admin.rpc('record_dogehouse_refund',{p_intent_id:intent,p_refunded_cents:amount});if(error)throw error;}
 };
 return {backend,live};
}
