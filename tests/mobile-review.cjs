const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.DOGEHOUSE_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await require('./local-assets.cjs')(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/account-config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.DOGEHOUSE_ACCOUNT_CONFIG={supabaseUrl:"",supabasePublishableKey:""};'}));
 await page.goto('http://127.0.0.1:8000/dogehouse-launch.html#customize');const studio=page.frameLocator('#studioFrame');await studio.locator('#viewer-status').waitFor({state:'hidden'});
 await studio.locator('input[data-k="nameplate"]').fill('MOBILE TEST');await page.evaluate(()=>location.hash='review');
 await page.locator('#reviewPreviewStatus').filter({hasText:'Two views of your current 3D design.'}).waitFor();
 for(const id of ['reviewBackLeft','reviewFrontRight']){const source=await page.locator('#'+id).getAttribute('src');assert.ok(source.startsWith('data:image/jpeg;base64,'));assert.ok(source.length>1000);}
 assert.deepEqual(errors,[]);console.log('PASS: phone viewport generates both review images from the hidden studio under the configured CSP; real phone hardware remains unverified.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
