const assert=require('node:assert/strict');
(async()=>{
 const {createHandler,prepareOrder,orderEmail}=await import('../supabase/functions/submit-order/handler.ts');
 const user={id:'11111111-1111-4111-8111-111111111111',email:'verified@example.com'};
 const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,255,217]).toString('base64');
 const payload={requestId:'22222222-2222-4222-8222-222222222222',build:{version:2,studio:globalThis.DogeHouseStudioState({nameplate:'BUDDY',roofType:'metal',win:true}),customer:{customerName:'<script>test</script>',customerEmail:'contact@example.com',fulfillment:'Free shipping — assembly required',notes:'Hello & goodbye'},preview:{backLeft:jpeg,frontRight:jpeg},quote:{total:1}}};
 const prepared=prepareOrder(payload,user);assert.equal(prepared.totalCents,48400);assert.equal(prepared.userId,user.id);assert.equal(prepared.build.account.email,user.email);
 const allModules={storageDrawer:true,swapPanels:true,legExtensions:true,porchAwning:true,weatherLiner:true,ramp:true,bowlHolder:true,doorFlap:true};
 const moduleStudio=globalThis.DogeHouseStudioState(allModules),moduleQuote=globalThis.DogeHouseStudioPricing(moduleStudio);
 const modulePrices=[['Storage drawer',45],['Swap panels',35],['Leg extensions',25],['Porch awning',45],['Weather liner',55],['Ramp',40],['Bowl holder',22],['Door flap',18]];
 assert.equal(moduleQuote.total,634);for(const item of modulePrices)assert.ok(moduleQuote.items.some(([label,amount])=>label===item[0]&&amount===item[1]));
 const moduleBuild={...payload,build:{...payload.build,studio:moduleStudio,quote:{total:1}}},moduleOrder=prepareOrder(moduleBuild,user);
 assert.equal(moduleOrder.totalCents,63400);assert.equal(moduleOrder.build.quote.total,634);for(const key of Object.keys(allModules))assert.equal(moduleOrder.build.studio[key],true);
 const older=structuredClone(payload);delete older.build.studio.roofShape;assert.equal(prepareOrder(older,user).build.studio.roofShape,'single');
 const gable=structuredClone(payload);gable.build.studio.roofShape='gable';assert.equal(prepareOrder(gable,user).build.quote.items[0][0],'Stock double-slope doghouse');assert.equal(prepareOrder(gable,user).totalCents,48400);
 let sends=0,creates=0,fail=false,stored=null,mail=null;
 const backend={emailReady:true,from:'DogeHouse <orders@thedogehouse.com>',siteUrl:'https://bcreedh2002.github.io/dogehouse2/',allowedOrigins:['https://bcreedh2002.github.io'],authenticate:async token=>token==='valid'?user:null,
 create:async input=>{creates++;if(!stored)stored={id:'33333333-3333-4333-8333-333333333333',user_id:input.userId,name:input.name,build:input.build,total_cents:input.totalCents,status:'requested',email_status:'queued',email_attempts:0};return {...stored};},
 claim:async()=>{if(['sent','sending'].includes(stored.email_status))return null;stored.email_status='sending';stored.email_attempts++;return {...stored};},
 finish:async(order,sent)=>{stored.email_status=sent?'sent':'failed';},lookup:async()=>({...stored}),send:async(value,key)=>{sends++;mail=value;assert.equal(key,'dogehouse-order-'+stored.id);if(fail)throw Error('provider failure');return 'receipt';}};
 const handler=createHandler(backend);
 const request=(body=payload,token='valid',origin='https://bcreedh2002.github.io')=>new Request('https://project.supabase.co/functions/v1/submit-order',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',origin},body:JSON.stringify(body)});
 assert.equal((await handler(request(payload,'invalid'))).status,401);assert.equal(creates,0);
 assert.equal((await handler(request(payload,'valid','https://evil.invalid'))).status,403);
 assert.equal((await handler(request({...payload,build:{...payload.build,preview:{}}}))).status,400);
 assert.equal((await handler(request({...payload,build:{...payload.build,studio:{...payload.build.studio,roofType:'invalid'}}}))).status,400);
 assert.equal((await handler(request({...payload,build:{...payload.build,customer:{...payload.build.customer,fulfillment:'Delivery — additional fee',notes:''}}}))).status,400);
 assert.equal((await handler(request({padding:'x'.repeat(1500001)}))).status,413);
 fail=true;let result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).emailStatus,'failed');assert.equal(sends,1);
 fail=false;result=await handler(request());assert.equal((await result.json()).emailStatus,'sent');assert.equal(sends,2);
 assert.deepEqual(mail.to,['salesandinfo@thedogehouse.com']);assert.equal(mail.reply_to,user.email);assert.equal(mail.attachments.length,2);assert.deepEqual(mail.attachments.map(a=>a.content_id),['back-left','front-right']);assert.equal(mail.attachments[0].content,jpeg.split(',')[1]);assert.ok(mail.html.includes('cid:back-left'));assert.ok(mail.html.includes('cid:front-right'));assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('&lt;script&gt;'));assert.ok(mail.html.includes('#orders'));
 await handler(request());assert.equal(sends,2,'Already sent orders must not send again.');
 stored=null;sends=0;backend.emailReady=false;result=await handler(request());assert.equal((await result.json()).emailStatus,'queued');assert.equal(sends,0);
 stored=null;backend.emailReady=true;await Promise.all([handler(request()),handler(request())]);assert.equal(sends,1,'Concurrent retries share an atomic email claim.');
 console.log('PASS: server pricing, verified identity, validation, body limits, authentication/CORS, immutable email payload, both inline thumbnails, escaping, pending setup, retry and concurrent-send protection. No real emails sent.');
})().catch(error=>{console.error(error);process.exitCode=1;});
