import {siteConfig} from './site-config.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import type {Attempt,PaymentBackend} from './payments.ts';
export function paymentBackend():{backend:PaymentBackend;live:boolean}{
 const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')||'';
 const live=Deno.env.get('STRIPE_LIVE_MODE')==='true';
 if(!stripeKey.startsWith(live?'sk_live_':'sk_test_'))throw Error('Stripe key and payment mode must match');
 const projectUrl=Deno.env.get('SUPABASE_URL')||'';
 if(live&&new URL(projectUrl).hostname==='jpncaudfzxqjzddyrkss.supabase.co')throw Error('DogeHouseTest1 forbids live payments');
 const admin=createClient(projectUrl,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {siteUrl,allowedOrigins}=siteConfig(Deno.env.get('SITE_URL'),Deno.env.get('ALLOWED_ORIGINS'));
 async function stripe(path:string,body?:URLSearchParams,idempotency?:string){
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+stripeKey,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded',...(idempotency?{'Idempotency-Key':idempotency}:{})}:{})},body,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Stripe request failed');return response.json();
 }
 function validate(session:any,attempt:Attempt){
  if(session.livemode!==live||session.mode!=='payment'||session.currency!=='usd'||session.amount_total!==attempt.amount_cents||session.metadata?.dogehouse_attempt_id!==attempt.id||session.metadata?.dogehouse_order_id!==attempt.order_id||typeof session.id!=='string'||(attempt.session_id&&attempt.session_id!==session.id))throw Error('Checkout mismatch');
  return session;
 }
 async function bind(attempt:Attempt,session:any){
  validate(session,attempt);
  const {error}=await admin.from('dogehouse_payment_attempts').update({session_id:session.id}).eq('id',attempt.id).is('session_id',null);
  if(error)throw error;return session;
 }
 const backend:PaymentBackend={
  siteUrl,allowedOrigins,
  async authenticate(token){const {data,error}=await admin.auth.getUser(token);return !error&&data.user?.email_confirmed_at?data.user.id:null;},
  async reserve(orderId,userId){const {data,error}=await admin.rpc('reserve_dogehouse_payment',{p_order_id:orderId,p_user_id:userId});if(error)throw error;return Array.isArray(data)?data[0]:data;},
  async checkout(attempt){
   if(attempt.session_id)return validate(await stripe('checkout/sessions/'+encodeURIComponent(attempt.session_id)),attempt);
   const {data:stored,error:readError}=await admin.from('dogehouse_payment_attempts').select('created_at').eq('id',attempt.id).single();
   if(readError||!stored||!Number.isFinite(Date.parse(stored.created_at)))throw Error('Payment attempt needs reconciliation');
   // Outside Stripe's idempotency window, ONLY recover an existing session. Never
   // create again or declare an orphan expired merely because it is old.
   if(Date.now()-Date.parse(stored.created_at)>23*60*60*1000){
    let cursor='';
    for(let page=0;page<10;page++){
     const query=new URLSearchParams({limit:'100','created[gte]':String(Math.floor(Date.parse(stored.created_at)/1000)-60),...(cursor?{starting_after:cursor}:{})});
     const list=await stripe('checkout/sessions?'+query);
     const matches=list.data.filter((s:any)=>s.metadata?.dogehouse_attempt_id===attempt.id);
     if(matches.length>1)throw Error('Multiple sessions require operator reconciliation');
     if(matches.length)return bind(attempt,matches[0]);
     if(!list.has_more){
      const {error}=await admin.rpc('reconcile_dogehouse_orphan',{p_attempt_id:attempt.id});if(error)throw error;
      return {id:'',url:null,status:'expired',payment_status:'unpaid',amount_total:attempt.amount_cents,currency:'usd',payment_intent:null,reconciled_without_session:true};
     }
     cursor=list.data.at(-1)?.id;if(!cursor)break;
    }
    throw Error('No matching checkout recovered; operator reconciliation required');
   }
   const {data:order,error:orderError}=await admin.from('dogehouse_orders').select('user_id').eq('id',attempt.order_id).single();
   if(orderError)throw orderError;
   const {data:customer,error:customerError}=await admin.auth.admin.getUserById(order.user_id);
   if(customerError||!customer.user?.email)throw Error('Customer email unavailable');
   const returnUrl=new URL(siteUrl);returnUrl.hash='orders';
   const successUrl=new URL(returnUrl);successUrl.searchParams.set('checkout','success');
   const cancelUrl=new URL(returnUrl);cancelUrl.searchParams.set('checkout','cancelled');
   const body=new URLSearchParams({
    mode:'payment','payment_method_types[0]':'card',
    'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(attempt.amount_cents),
    'line_items[0][price_data][product_data][name]':'DogeHouse approved order',
    'line_items[0][quantity]':'1',client_reference_id:attempt.order_id,
    'metadata[dogehouse_attempt_id]':attempt.id,'metadata[dogehouse_order_id]':attempt.order_id,
    'payment_intent_data[metadata][dogehouse_attempt_id]':attempt.id,
    'payment_intent_data[metadata][dogehouse_order_id]':attempt.order_id,
    customer_email:customer.user.email,success_url:successUrl.href,cancel_url:cancelUrl.href
   });
   return bind(attempt,await stripe('checkout/sessions',body,'dogehouse-'+attempt.id));
  },
  async expire(attempt){
   let session=await backend.checkout(attempt);
   if(session.reconciled_without_session)return true;
   if(session.payment_status!=='paid'&&session.status==='open'){
    try{session=validate(await stripe('checkout/sessions/'+encodeURIComponent(session.id)+'/expire',new URLSearchParams()),{...attempt,session_id:session.id});}
    catch{session=validate(await stripe('checkout/sessions/'+encodeURIComponent(session.id)),{...attempt,session_id:session.id});}
   }
   if(session.payment_status==='paid'){
    await backend.record(attempt.id,session.id,attempt.amount_cents,true,session.payment_intent);return false;
   }
   if(session.status!=='expired'||session.payment_status!=='unpaid')throw Error('Checkout is not safely expired');
   await backend.record(attempt.id,session.id,attempt.amount_cents,false,null);return true;
  },
  async record(attemptId,sessionId,amount,paid,intent){
   // An expiry event may be stale. Fetch current provider state before releasing
   // the pending slot so an old expiry cannot enable a second charge.
   if(!paid){
    const {data:attempt,error}=await admin.from('dogehouse_payment_attempts').select('*').eq('id',attemptId).single();if(error||!attempt)throw Error('Unknown payment');
    if(attempt.status==='paid')return; // SQL already has durable capture evidence.
    const session=validate(await stripe('checkout/sessions/'+encodeURIComponent(sessionId)),{...attempt,session_id:sessionId});
    if(session.payment_status==='paid'){paid=true;intent=session.payment_intent;}
    else if(session.status!=='expired'||session.payment_status!=='unpaid')throw Error('Expiry not confirmed by Stripe');
   }
   const {error}=await admin.rpc('record_dogehouse_payment',{p_attempt_id:attemptId,p_session_id:sessionId,p_amount_cents:amount,p_paid:paid,p_intent_id:intent});if(error)throw error;
   if(paid){
    const {data:attempt,error:readError}=await admin.from('dogehouse_payment_attempts').select('order_id').eq('id',attemptId).single();if(readError||!attempt)throw Error('Unknown payment');
    const {data:others,error:otherError}=await admin.from('dogehouse_payment_attempts').select('*').eq('order_id',attempt.order_id).eq('status','pending');if(otherError)throw otherError;
    // Persist capture first. Failed cleanup is retryable; replay runs cleanup too.
    for(const other of others)await backend.expire(other);
   }
  },
  async refund(intent,amount){
   const {data:known,error:readError}=await admin.from('dogehouse_payment_attempts').select('id').eq('payment_intent_id',intent).maybeSingle();if(readError)throw readError;
   if(!known){
    // Charge metadata is not guaranteed to contain PaymentIntent metadata.
    const payment=await stripe('payment_intents/'+encodeURIComponent(intent));
    if(payment.livemode!==live)throw Error('Payment mode mismatch');
    if(!payment.metadata?.dogehouse_attempt_id)return; // unrelated Stripe purchase
    const {data:attempt,error}=await admin.from('dogehouse_payment_attempts').select('id').eq('id',payment.metadata.dogehouse_attempt_id).maybeSingle();
    if(error)throw error;if(!attempt)return;
    throw Error('Payment not yet recorded'); // let Stripe retry after completion
   }
   const {error}=await admin.rpc('record_dogehouse_refund',{p_intent_id:intent,p_refunded_cents:amount});if(error)throw error;
  }
 };
 return {backend,live};
}
