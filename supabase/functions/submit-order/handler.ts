import '../../../viewer/state.js';
import '../../../viewer/pricing.js';

type ObjectData = Record<string, any>;
export type Order = {id:string;user_id:string;name:string;build:ObjectData;total_cents:number;status:string;email_status:string;email_attempts:number};
export type Backend = {
 authenticate(token:string):Promise<{id:string;email:string}|null>;
 create(input:{userId:string;requestId:string;name:string;build:ObjectData;totalCents:number}):Promise<Order>;
 claim(id:string):Promise<Order|null>;
 finish(order:Order,sent:boolean,providerId?:string):Promise<void>;
 lookup(id:string):Promise<Order>;
 send(payload:ObjectData,idempotencyKey:string):Promise<string>;
 emailReady:boolean;from:string;siteUrl:string;allowedOrigins:string[];
};
const normalize=(globalThis as any).DogeHouseStudioState as (input:unknown)=>ObjectData;
const price=(globalThis as any).DogeHouseStudioPricing as (input:unknown)=>{items:[string,number][];total:number};
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class InputError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
async function jsonBody(request:Request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new InputError('JSON request required.',415);
 const reader=request.body?.getReader();if(!reader)throw new InputError('Request body required.');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();throw new InputError('Design previews are too large.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new InputError('Invalid request.');}
}
function preview(value:unknown){
 if(typeof value!=='string'||value.length>600000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value))throw new InputError('Both design previews must be generated before submitting.');
 const content=value.split(',')[1];let bytes:string;try{bytes=atob(content);}catch{throw new InputError('Invalid design preview.');}
 if(bytes.length<5||bytes.charCodeAt(0)!==255||bytes.charCodeAt(1)!==216||bytes.charCodeAt(2)!==255||bytes.charCodeAt(bytes.length-2)!==255||bytes.charCodeAt(bytes.length-1)!==217)throw new InputError('Invalid JPEG preview.');return content;
}
export function prepareOrder(input:ObjectData,user:{id:string;email:string}){
 if(!input||!uuid.test(input.requestId||''))throw new InputError('Invalid request identifier.');
 const build=input.build;if(build?.version!==2||!build.studio||Array.isArray(build.studio))throw new InputError('Save a current 3D design before submitting.');
 const studio=normalize(build.studio),defaults=normalize({});
 for(const [key,value] of Object.entries(studio))if(!(build.studio[key]===undefined&&JSON.stringify(value)===JSON.stringify(defaults[key]))&&JSON.stringify(build.studio[key])!==JSON.stringify(value))throw new InputError('Please review your design settings before submitting.');
 const customer=build.customer;if(!customer||typeof customer.customerName!=='string'||!customer.customerName.trim()||customer.customerName.length>120||typeof customer.customerEmail!=='string'||!email.test(customer.customerEmail)||customer.customerEmail.length>254)throw new InputError('Enter your name and a valid contact email.');
 if(!['Free shipping — assembly required','Personal pickup — arrange directly','Delivery — additional fee'].includes(customer.fulfillment)||typeof customer.notes!=='string'||customer.notes.length>10000||(customer.fulfillment.startsWith('Delivery')&&!customer.notes.trim()))throw new InputError('Enter your delivery location or choose another fulfillment option.');
 preview(build.preview?.backLeft);preview(build.preview?.frontRight);
 const quote=price(studio); // Never trust the browser's price, identity, or order status.
 return {userId:user.id,requestId:input.requestId,name:(studio.nameplate||'DOGEHOUSE')+' doghouse',build:{version:2,studio,customer:{customerName:customer.customerName.trim(),customerEmail:customer.customerEmail.trim(),fulfillment:customer.fulfillment,notes:customer.notes},quote,preview:{backLeft:build.preview.backLeft,frontRight:build.preview.frontRight},account:{email:user.email}},totalCents:Math.round(quote.total*100)};
}
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function orderEmail(order:Order,from:string,siteUrl:string){
 const {customer,studio,quote,preview:images,account}=order.build;
 const details=[`Order request ${order.id}`,`Account: ${account.email}`,`Customer: ${customer.customerName}`,`Contact email: ${customer.customerEmail}`,`Nameplate: ${studio.nameplate}`,`Body: ${studio.body}`,`Roof: ${studio.roof}`,`Trim: ${studio.trim}`,...quote.items.map(([label,amount]:[string,number])=>`${label} — $${amount}`),`Total: $${order.total_cents/100} (delivery extra if selected)`,`Fulfillment: ${customer.fulfillment}`,`Notes: ${customer.notes}`,'Awaiting DogeHouse confirmation; no payment collected.'];
 const target=new URL(siteUrl);if(target.protocol!=='https:')throw Error('HTTPS site URL required.');target.hash='orders';
 return {from,to:['salesandinfo@thedogehouse.com'],reply_to:account.email,subject:`DogeHouse order request ${order.id.slice(0,8)}`,text:details.join('\n'),html:`<h1>DogeHouse order request</h1><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(details.join('\n'))}</pre><h2>Back and left</h2><img src="cid:back-left" alt="Back and left of the customer design" width="320"><h2>Front and right</h2><img src="cid:front-right" alt="Front and right of the customer design" width="320"><p><a href="${escape(target.toString())}">View ordered builds</a></p>`,attachments:[{filename:'dogehouse-back-left.jpg',content:preview(images.backLeft),content_type:'image/jpeg',content_id:'back-left'},{filename:'dogehouse-front-right.jpg',content:preview(images.frontRight),content_type:'image/jpeg',content_id:'front-right'}]};
}
export function createHandler(backend:Backend){return async(request:Request)=>{
 const origin=request.headers.get('origin');const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&backend.allowedOrigins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!backend.allowedOrigins.includes(origin))return reply(403,{error:'Request origin rejected.'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply(405,{error:'Unsupported request.'});
 try{
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)return reply(401,{error:'Sign in to submit an order request.'});
  const user=await backend.authenticate(token);if(!user||!email.test(user.email))return reply(401,{error:'Sign in with a confirmed account.'});
  const input=prepareOrder(await jsonBody(request),user),order=await backend.create(input);
  if(order.email_status!=='sent'&&backend.emailReady){
   const claim=await backend.claim(order.id);
   if(claim){
    let providerId:string|undefined;
    try{providerId=await backend.send(orderEmail(claim,backend.from,backend.siteUrl),'dogehouse-order-'+claim.id);}catch{await backend.finish(claim,false);}
    if(providerId)await backend.finish(claim,true,providerId);
   }
  }
  const current=await backend.lookup(order.id);
  return reply(200,{orderId:current.id,emailStatus:current.email_status,status:current.status,totalCents:current.total_cents});
 }catch(error){
  if(error instanceof InputError)return reply(error.status,{error:error.message});
  if((error as any)?.code==='P0001')return reply(429,{error:'Too many order requests. Please try again later or contact DogeHouse.'});
  return reply(503,{error:'Ordering is temporarily unavailable. Your saved builds are still available. Retry the same request.'});
 }
};}
