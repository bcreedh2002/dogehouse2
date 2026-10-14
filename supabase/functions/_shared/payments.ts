export type Attempt={id:string;order_id:string;amount_cents:number;session_id:string|null};
export type PaymentBackend={
 siteUrl:string;allowedOrigins:string[];
 authenticate(token:string):Promise<string|null>;
 reserve(orderId:string,userId:string):Promise<Attempt>;
 checkout(attempt:Attempt):Promise<{id:string;url:string|null;status:string;payment_status:string;amount_total:number;currency:string;payment_intent:string|null}>;
 record(attemptId:string,sessionId:string,amount:number,paid:boolean,intent:string|null):Promise<void>;
 refund(intent:string,amount:number):Promise<void>;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function limitedBody(request:Request,limit:number){
 const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Body too large');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return new TextDecoder().decode(bytes);
}
export function payHandler(backend:PaymentBackend){
 return async(request:Request)=>{
  const origin=request.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(!backend.allowedOrigins.includes(origin))return new Response('Origin denied',{status:403});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({error:'POST required'},405);
  try{
   const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   const userId=token?await backend.authenticate(token):null;if(!userId)return reply({error:'Sign in to pay.'},401);
   let body;try{body=JSON.parse(await limitedBody(request,4096));}catch{return reply({error:'Invalid request.'},400);}
   if(!uuid.test(body?.orderId||''))return reply({error:'Invalid order.'},400);
   let attempt;try{attempt=await backend.reserve(body.orderId,userId);}catch{return reply({error:'This order is not ready for payment.'},409);}
   const session=await backend.checkout(attempt);
   if(session.amount_total!==attempt.amount_cents||session.currency!=='usd')throw Error('Checkout mismatch');
   if(session.status==='expired'){
    await backend.record(attempt.id,session.id,attempt.amount_cents,false,null);
    return reply({error:'This checkout expired. Click Pay again for a new checkout.'},409);
   }
   // A provider lookup may reconcile payment, but a browser redirect never does.
   if(session.payment_status==='paid'){
    await backend.record(attempt.id,session.id,attempt.amount_cents,true,session.payment_intent);
    return reply({paid:true});
   }
   if(session.status!=='open'||!session.url||new URL(session.url).origin!=='https://checkout.stripe.com')throw Error('Checkout unavailable');
   return reply({url:session.url});
  }catch{return reply({error:'Payment service unavailable. Please retry; your order is saved.'},503);}
 };
}
export async function verifyStripeSignature(raw:string,signature:string,secret:string,now=Math.floor(Date.now()/1000)){
 const fields=signature.split(',').map(value=>value.split('='));
 const timestamps=fields.filter(([key])=>key==='t');if(timestamps.length!==1)return false;
 const timestamp=timestamps[0][1];if(!/^\d+$/.test(timestamp)||Math.abs(now-Number(timestamp))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hash=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));
 const expected=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 return fields.filter(([key])=>key==='v1').some(([,value])=>{
  if(!/^[0-9a-f]{64}$/.test(value||''))return false;let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^value.charCodeAt(i);return difference===0;
 });
}
export function webhookHandler(backend:PaymentBackend,secret:string,live:boolean){
 return async(request:Request)=>{
  if(request.method!=='POST')return new Response('POST required',{status:405});
  if(!secret)return new Response('Webhook not configured',{status:503});
  let raw;try{raw=await limitedBody(request,262144);}catch{return new Response('Invalid body',{status:400});}
  if(!await verifyStripeSignature(raw,request.headers.get('stripe-signature')||'',secret))return new Response('Invalid signature',{status:400});
  let event;try{event=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
  if(event.livemode!==live)return new Response('Wrong payment mode',{status:400});
  try{
   const object=event.data?.object;
   if(['checkout.session.completed','checkout.session.expired'].includes(event.type)){
    if(!uuid.test(object?.metadata?.dogehouse_attempt_id||'')||object.mode!=='payment'||object.currency!=='usd'||!Number.isSafeInteger(object.amount_total))return new Response('Invalid checkout',{status:400});
    if(event.type==='checkout.session.completed'&&object.payment_status!=='paid')return new Response('Unpaid checkout',{status:400});
    await backend.record(object.metadata.dogehouse_attempt_id,object.id,object.amount_total,event.type==='checkout.session.completed',typeof object.payment_intent==='string'?object.payment_intent:null);
   }else if(event.type==='charge.refunded'){
    // Ignore unrelated Stripe purchases; this metadata is set on our PaymentIntent.
    if(object?.metadata?.dogehouse_attempt_id){
     if(object.currency!=='usd'||typeof object.payment_intent!=='string'||!Number.isSafeInteger(object.amount_refunded))return new Response('Invalid refund',{status:400});
     await backend.refund(object.payment_intent,object.amount_refunded);
    }
   }
   return new Response('ok');
  }catch{return new Response('Payment update pending; retry delivery',{status:500});}
 };
}
