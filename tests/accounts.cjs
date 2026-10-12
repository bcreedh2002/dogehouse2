// Tests the real Supabase SDK with mocked HTTPS service responses, not a live project.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const testUrl=process.env.DOGEHOUSE_TEST_URL || 'http://127.0.0.1:8000/dogehouse-launch.html';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DOGEHOUSE_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/account-config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.DOGEHOUSE_ACCOUNT_CONFIG={supabaseUrl:"",supabasePublishableKey:""};'}));
  await page.goto(testUrl);
  await page.locator('#page-home .account-launch').click();
  await page.locator('#accountStatus').filter({hasText:'Account saving is coming soon'}).waitFor();
  assert.equal(await page.locator('#accountAuthForm').isVisible(),false);
  await page.getByRole('button',{name:'Close account dialog'}).click();
  await page.locator('#page-home [data-page="customize"]').first().click();
  await page.locator('#dogName').fill('BUDDY');await page.locator('#bodyColorHex').fill('#123456');
  const user={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated'}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.mock-signature';
  const session={access_token:jwt,refresh_token:'mock-refresh-token',expires_in:3600,token_type:'bearer',user};
  let rows=[],failSave=false,recoverySent=false,passwordUpdated=false,configured=true;
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
   }else if(url.pathname.endsWith('/dogehouse_builds')){
    if(req.method()==='POST'){
     if(failSave){status=403;body={message:'Save denied',code:'42501'};}
     else{const saved=req.postDataJSON();assert.equal(saved.user_id,user.id);rows.push({...saved,id:'22222222-2222-4222-8222-222222222222',created_at:new Date().toISOString()});status=201;body=null;}
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
  await page.locator('#savedBuildName').fill('<b>Buddy</b>');await page.getByRole('button',{name:'Save current build',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Build saved to your account'}).waitFor();
  assert.equal(rows.length,1);assert.equal(rows[0].build.values.dogName,'BUDDY');assert.equal(await page.locator('#savedBuildList b').count(),0);
  await page.getByRole('button',{name:'Close account dialog'}).click();await page.locator('#dogName').fill('CHANGED');
  await page.locator('#page-builder > header .account-launch').click();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Open <b>Buddy</b>',exact:true}).click();assert.equal(await page.locator('#dogName').inputValue(),'CHANGED');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open <b>Buddy</b>',exact:true}).click();assert.equal(await page.locator('#dogName').inputValue(),'BUDDY');assert.equal(await page.locator('#bodyColor').inputValue(),'#123456');
  await page.reload();await page.locator('#page-builder > header .account-launch').filter({hasText:'My builds'}).waitFor();await page.locator('#page-builder > header .account-launch').click();
  failSave=true;await page.locator('#savedBuildName').fill('Denied');await page.getByRole('button',{name:'Save current build',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Save denied'}).waitFor();assert.equal(rows.length,1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete <b>Buddy</b>',exact:true}).click();await page.locator('#accountStatus').filter({hasText:'Build deleted'}).waitFor();assert.equal(rows.length,0);
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
  console.log('PASS: fallback, rejected secret key, confirmation prompt, wrong password, sign-in, named save/load/delete, safe names, session restoration, denied save, sign-out, recovery email and password update, mobile layout. Real SDK; service responses mocked.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
