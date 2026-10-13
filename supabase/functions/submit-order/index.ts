import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {createHandler,type Backend,type Order} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const key=Deno.env.get('RESEND_API_KEY')||'',from=Deno.env.get('ORDER_EMAIL_FROM')||'';
const siteUrl=Deno.env.get('SITE_URL')||'https://bcreedh2002.github.io/dogehouse2/';
const allowedOrigins=(Deno.env.get('ALLOWED_ORIGINS')||new URL(siteUrl).origin).split(',').map(value=>value.trim());
function row(data:any,error:any):Order{if(error)throw error;const result=Array.isArray(data)?data[0]:data;if(!result?.id)throw Error('Order data unavailable.');return result;}
const backend:Backend={
 emailReady:Boolean(key&&from),from,siteUrl,allowedOrigins,
 async authenticate(token){const {data,error}=await admin.auth.getUser(token);return !error&&data.user?.email_confirmed_at&&data.user.email?{id:data.user.id,email:data.user.email}:null;},
 async create(input){const {data,error}=await admin.rpc('create_dogehouse_order',{p_user_id:input.userId,p_request_id:input.requestId,p_name:input.name,p_build:input.build,p_total_cents:input.totalCents});return row(data,error);},
 async lookup(id){const {data,error}=await admin.from('dogehouse_orders').select('*').eq('id',id).single();return row(data,error);},
 async claim(id){const {data,error}=await admin.rpc('claim_dogehouse_order_email',{p_order_id:id});if(error)throw error;const result=Array.isArray(data)?data[0]:data;return result?.id?result:null;},
 async finish(order,sent,providerId){const {error}=await admin.from('dogehouse_orders').update({email_status:sent?'sent':'failed',email_provider_id:providerId||null,email_error:sent?null:'provider_error'}).eq('id',order.id).eq('email_status','sending').eq('email_attempts',order.email_attempts);if(error)throw error;},
 async send(payload,idempotencyKey){const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Email provider declined request.');const data=await response.json();if(typeof data.id!=='string')throw Error('Missing email receipt.');return data.id;}
};
Deno.serve(createHandler(backend));
