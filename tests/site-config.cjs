const assert=require('node:assert/strict');
(async()=>{
 const {siteConfig}=await import('../supabase/functions/_shared/site-config.ts');
 const origin='https://dogehouse.netlify.app';
 assert.deepEqual(siteConfig(origin+'/dogehouse-launch.html'),{siteUrl:origin+'/dogehouse-launch.html',allowedOrigins:[origin]});
 assert.deepEqual(siteConfig(origin,origin+','+origin).allowedOrigins,[origin]);
 for(const value of [undefined,'','  ','http://dogehouse.netlify.app','https://user:pass@dogehouse.netlify.app','https://dogehouse.netlify.app/?redirect=evil','https://dogehouse.netlify.app/#orders','not a url'])assert.throws(()=>siteConfig(value));
 for(const value of ['', '*','https://bcreedh2002.github.io',origin+'/',origin+',',origin+',http://example.com',origin+',https://example.com/path',origin+',https://example.com?x=1'])assert.throws(()=>siteConfig(origin,value));
 const {payHandler}=await import('../supabase/functions/_shared/payments.ts');
 const {createHandler}=await import('../supabase/functions/submit-order/handler.ts');
 const config=siteConfig(origin);let calls=0;
 const backend={...config,authenticate:async()=>{calls++;return null;}};
 for(const handler of [payHandler(backend),createHandler(backend)]){
  for(const [source,status] of [[origin,204],['https://bcreedh2002.github.io',403],['https://dogehouse.netlify.app.evil.example',403]]){
   const result=await handler(new Request('https://example.com',{method:'OPTIONS',headers:{origin:source}}));
   assert.equal(result.status,status);if(status===204)assert.equal(result.headers.get('access-control-allow-origin'),origin);
  }
 }
 assert.equal(calls,0);console.log('PASS: explicit site config, fail-closed invalid config, Netlify preflight and foreign-origin rejection in both handlers');
})().catch(error=>{console.error(error);process.exitCode=1;});
