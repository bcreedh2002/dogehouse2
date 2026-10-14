// Tests the real Supabase SDK with mocked HTTPS service responses, not a live project.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const testUrl=process.env.DOGEHOUSE_TEST_URL || 'http://127.0.0.1:8000/dogehouse-launch.html';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DOGEHOUSE_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/account-config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.DOGEHOUSE_ACCOUNT_CONFIG={supabaseUrl:"",supabasePublishableKey:""};'}));
  await page.goto(testUrl);
  await page.locator('#page-home .account-launch').click();
  await page.locator('#accountStatus').filter({hasText:'Account saving is coming soon'}).waitFor();
  assert.equal(await page.locator('#accountAuthForm').isVisible(),false);
  await page.getByRole('button',{name:'Close account dialog'}).click();
  await page.locator('#page-home [data-page="customize"]').first().click();
  const studio=page.frameLocator('#studioFrame');await studio.locator('#v canvas').waitFor();await studio.locator('input[data-k="nameplate"]').fill('BUDDY');await studio.locator('input[data-k="body"]').fill('#123456');
  await studio.locator('details').filter({has:studio.locator('[data-k="roofShape"]')}).locator('summary').click();await studio.locator('[data-k="roofShape"][data-v="gable"]').click();
  const user={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated'}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.mock-signature';
  const session={access_token:jwt,refresh_token:'mock-refresh-token',expires_in:3600,token_type:'bearer',user};
  let trackingRequests=0;page.on('request',request=>{if(request.url().startsWith('https://tracking.invalid/'))trackingRequests++;});
  let orders=[],orderCalls=[],failOrder=true;
  let rows=[],failSave=false,recoverySent=false,passwordUpdated=false,configured=true,ownerAccess=false;
  await page.route('**/account-config.js',route=>route.fulfill({contentType:'application/javascript',body:`window.DOGEHOUSE_ACCOUNT_CONFIG={supabaseUrl:"https://mock.supabase.co",supabasePublishableKey:"${configured?'sb_publishable_mockkey':'sb_secret_invalid'}"};`}));
  await page.route('https://mock.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url());let body={},status=200;
   if(url.pathname.endsWith('/signup')){assert.equal(url.searchParams.get('redirect_to'),new URL(testUrl).origin+new URL(testUrl).pathname);body={user,session:null};}
   else if(url.pathname.endsWith('/token')){
    if(req.postDataJSON().password==='Wrong-password-123'){status=400;body={error_code:'invalid_credentials',msg:'Email or password is incorrect.'};}else body=session;
   }else if(url.pathname.endsWith('/logout')){status=204;}
   else if(url.pathname.endsWith('/recover')){assert.equal(req.postDataJSON().email,user.email);assert.equal(url.searchParams.get('redirect_to'),new URL(testUrl).origin+new URL(testUrl).pathname);recoverySent=true;}
   else if(url.pathname.endsWith('/user')){
    if(req.method()==='PUT'){assert.equal(req.postDataJSON().password,'Updated-password-123');passwordUpdated=true;}body=user;
   }else if(url.pathname.endsWith('/is_dogehouse_owner')){body=ownerAccess;}
   else if(url.pathname.endsWith('/dogehouse_customer_designs')){if(!ownerAccess){status=403;body={message:'Owner access required',code:'42501'};}else body=rows.map(row=>({...row,build:{...row.build,preview:{...row.build.preview,frontRight:'https://tracking.invalid/customer-image'}},customer_email:'customer@example.com'}));}
   else if(url.pathname.endsWith('/submit-order')){
    const input=req.postDataJSON();assert.equal(req.headers().authorization,'Bearer '+jwt);assert.ok(input.build.preview.backLeft.startsWith('data:image/jpeg;base64,'));assert.ok(input.build.preview.frontRight.startsWith('data:image/jpeg;base64,'));orderCalls.push(input);
    if(failOrder){status=503;body={error:'Please retry the same request.'};}else{if(!orders.length)orders.push({id:'44444444-4444-4444-8444-444444444444',request_id:input.requestId,name:'BUDDY order',build:input.build,total_cents:34900,status:'requested',email_status:'sent',email_attempts:1,created_at:new Date().toISOString()});orders[0].email_status='sent';body={orderId:orders[0].id,emailStatus:'sent',status:'requested',totalCents:34900};}
   }else if(url.pathname.endsWith('/dogehouse_orders')){assert.equal(req.method(),'GET');assert.equal(url.searchParams.get('user_id'),`eq.${user.id}`);body=orders;}
   else if(url.pathname.endsWith('/dogehouse_customer_orders')){assert.ok(ownerAccess);body=orders.map(row=>({...row,customer_email:'customer@example.com'}));}
   else if(url.pathname.endsWith('/dogehouse_builds')){
    if(req.method()==='POST'){
     if(failSave){status=403;body={message:'Save denied',code:'42501'};}
     else{const saved=req.postDataJSON();assert.equal(saved.user_id,user.id);assert.equal(saved.build.version,2);assert.equal(saved.build.studio.roofShape,'gable');assert.ok(saved.build.preview.backLeft.startsWith('data:image/jpeg;base64,'));assert.ok(saved.build.preview.frontRight.startsWith('data:image/jpeg;base64,'));rows.push({...saved,id:'22222222-2222-4222-8222-222222222222',created_at:new Date().toISOString()});status=201;body=null;}
    }else if(req.method()==='DELETE'){assert.equal(url.searchParams.get('user_id'),`eq.${user.id}`);rows=[];status=204;}
    else{assert.equal(url.searchParams.get('user_id'),`eq.${user.id}`);body=rows;}
   }else throw Error(`Unexpected service request ${req.method()} ${url.pathname}`);
   await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body)});
  });
  await page.reload();await page.locator('#page-builder > header .account-launch').click();
  await page.locator('#accountEmail').fill(user.email);await page.locator('#accountPassword').fill('Test-password-123');
  await page.getByRole('button',{name:'Create account',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Check your email'}).waitFor();
  await page.locator('#accountPassword').fill('Wrong-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'incorrect'}).waitFor();
  await page.locator('#accountPassword').fill('Test-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#accountIdentity').filter({hasText:user.email}).waitFor();
  await page.locator('#savedBuildName').fill('<b>Buddy</b>');await page.getByRole('button',{name:'Save current build',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Design saved.'}).waitFor();
  assert.equal(rows.length,1);assert.equal(rows[0].build.studio.nameplate,'BUDDY');assert.equal(await page.locator('#savedBuildList b').count(),0);
  await page.getByRole('button',{name:'Close account dialog'}).click();await studio.locator('input[data-k="nameplate"]').fill('CHANGED');
  await page.locator('#page-builder > header .account-launch').click();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Open <b>Buddy</b>',exact:true}).click();assert.equal(await studio.locator('input[data-k="nameplate"]').inputValue(),'CHANGED');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open <b>Buddy</b>',exact:true}).click();assert.equal(await studio.locator('input[data-k="nameplate"]').inputValue(),'BUDDY');assert.equal(await studio.locator('input[data-k="body"]').inputValue(),'#123456');
  await page.reload();await page.locator('#page-builder > header .account-launch').filter({hasText:'My builds'}).waitFor();await page.locator('#page-builder > header .account-launch').click();
  assert.equal(await page.locator('#accountCustomerDesigns').isVisible(),false);
  await page.locator('.design-previews img').first().waitFor({state:'visible'});assert.equal(await page.locator('.design-previews img').count(),2);
  ownerAccess=true;await page.getByRole('button',{name:'Close account dialog'}).click();await page.locator('#page-builder > header .account-launch').click();await page.locator('#accountCustomerDesigns').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Customer saved builds',exact:true}).click();await page.locator('#designLibraryHeading').filter({hasText:'Customer saved builds'}).waitFor();assert.ok((await page.locator('#savedBuildList').textContent()).includes('customer@example.com'));assert.equal(await page.locator('#savedBuildList').getByRole('button',{name:'Delete <b>Buddy</b>',exact:true}).count(),0);assert.equal(await page.locator('.design-previews img').count(),1);assert.equal(trackingRequests,0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open <b>Buddy</b>',exact:true}).click();assert.equal(await studio.locator('input[data-k="nameplate"]').inputValue(),'BUDDY');
  await page.locator('#page-builder > header .account-launch').click();await page.getByRole('button',{name:'Saved builds',exact:true}).click();await page.locator('#designLibraryHeading').filter({hasText:'Saved builds'}).waitFor();
  await page.getByRole('button',{name:'Close account dialog'}).click();await page.evaluate(()=>location.hash='review');
  await page.locator('#customerName').fill('Customer');await page.locator('#customerEmail').fill('contact@example.com');await page.locator('#submitOrder').click();await page.locator('#requestStatus').filter({hasText:'Please retry the same request.'}).waitFor();
  failOrder=false;await page.locator('#submitOrder').click();await page.locator('#requestStatus').filter({hasText:'Both design images were emailed'}).waitFor();assert.equal(orderCalls.length,2);assert.equal(orderCalls[0].requestId,orderCalls[1].requestId);assert.equal(orders.length,1);assert.equal(await page.locator('#submitOrder').isDisabled(),true);
  await page.locator('#page-review > header .account-launch').click();await page.getByRole('button',{name:'Ordered builds',exact:true}).click();await page.locator('#designLibraryHeading').filter({hasText:'Ordered builds'}).waitFor();assert.ok((await page.locator('#savedBuildList').textContent()).includes('BUDDY order'));assert.equal(await page.locator('#savedBuildList').getByRole('button',{name:/Delete/}).count(),0);assert.equal(await page.locator('.design-previews img').count(),2);
  orders[0].email_status='failed';await page.getByRole('button',{name:'Refresh builds',exact:true}).click();await page.getByRole('button',{name:'Retry email',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Both design images were emailed'}).waitFor();assert.equal(orderCalls.length,3);assert.equal(orderCalls[2].requestId,orders[0].request_id);assert.equal(orders.length,1);
  await page.getByRole('button',{name:'Customer ordered builds',exact:true}).click();await page.locator('#designLibraryHeading').filter({hasText:'Customer ordered builds'}).waitFor();assert.ok((await page.locator('#savedBuildList').textContent()).includes('customer@example.com'));
  await page.getByRole('button',{name:'Saved builds',exact:true}).click();await page.locator('#designLibraryHeading').filter({hasText:'Saved builds'}).waitFor();assert.ok((await page.locator('#savedBuildList').textContent()).includes('<b>Buddy</b>'));
  failSave=true;await page.locator('#savedBuildName').fill('Denied');await page.getByRole('button',{name:'Save current build',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Save denied'}).waitFor();assert.equal(rows.length,1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete <b>Buddy</b>',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Design deleted'}).waitFor();assert.equal(rows.length,0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Signed out'}).waitFor();assert.equal(await page.locator('#accountAuthForm').isVisible(),true);
  await page.locator('#accountEmail').fill(user.email);await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'password-reset link'}).waitFor();assert.ok(recoverySent);
  await page.goto(testUrl+`#access_token=${jwt}&refresh_token=mock-recovery-token&expires_in=3600&token_type=bearer&type=recovery`);
  await page.locator('#accountNewPassword').waitFor({state:'visible'});
  assert.equal(await page.locator('#accountBuildPanel').isVisible(),false);
  await page.locator('#accountNewPassword').fill('Updated-password-123');await page.getByRole('button',{name:'Update password',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Password updated'}).waitFor();assert.ok(passwordUpdated);
  assert.equal(await page.locator('#accountAuthForm').isVisible(),true);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.getElementById('accountDialog').getBoundingClientRect().width<=innerWidth));
  await page.screenshot({path:'/tmp/dogehouse-supabase-mobile.png'});
  configured=false;await page.reload();await page.locator('#page-home .account-launch').click();await page.locator('#accountStatus').filter({hasText:'Account saving is coming soon'}).waitFor();assert.equal(await page.locator('#accountAuthForm').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: fallback, rejected secret key, confirmation prompt, wrong password, sign-in, complete 3D save/load/delete, stored previews, customer privacy, owner list/reopening, safe names, session restoration, denied save, sign-out, recovery email and password update, mobile layout, order submission/retry, separate saved/ordered libraries and both owner views. Real SDK; service responses mocked.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
