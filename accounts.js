(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('accountDialog');
  const config = window.DOGEHOUSE_ACCOUNT_CONFIG || {};
  let client, user = null, busy = false, revision = 0, recovering = false, isOwner = false, libraryMode = "mine", libraryPage = 0;
  const pageSize=25;let authGeneration=0,dashboardVerified=false;
  const dashboardAllowed=()=>Boolean(user&&!recovering&&isOwner&&dashboardVerified&&user.email?.toLowerCase()==='salesandinfo@thedogehouse.com');
  const ownerLaunchers=[];
  function publishOwner(){ownerLaunchers.forEach(link=>link.hidden=!dashboardAllowed());window.dispatchEvent(new Event('dogehouse:owner-change'));}
  const launchers = [];
  const status = message => { $('accountStatus').textContent = message; };
  const redirectUrl = () => location.origin + location.pathname;
  function showUser(nextUser) {
    const changed=user?.id!==nextUser?.id;
    user = nextUser;authGeneration++;isOwner=false;dashboardVerified=false;$('accountCustomerDesigns').hidden=true;$('accountCustomerOrders').hidden=true;publishOwner();
    if(changed){isOwner=false;libraryMode='mine';libraryPage=0;$('accountCustomerDesigns').hidden=true;$('accountCustomerOrders').hidden=true;$('ownerSetupStatus').hidden=true;}
    revision++;window.dispatchEvent(new Event('dogehouse:account-change'));
    $('accountAuthForm').hidden = !client || Boolean(user) || recovering;
    $('accountResetForm').hidden = !recovering;
    $('accountBuildPanel').hidden = !user || recovering;
    $('accountIdentity').textContent = user ? `Signed in as ${user.email}` : '';
    $('accountIntro').textContent = recovering ? 'Choose a new password for your account.' : user ? 'Save a new copy of your current design, or reopen a saved build.' : 'Sign in to save your builds and pick them up on any device.';
    $('savedBuildList').replaceChildren();
    $('designPrevious').hidden=true;$('designNext').hidden=true;
    launchers.forEach(button => { button.textContent = user ? 'My builds' : 'Sign in / Save builds'; });
  }
  async function operation(work) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button:not(.account-close)').forEach(button => { button.disabled = true; });
    try { await work(); } catch (error) { status(error.message || 'Something went wrong. Please try again.'); }
    finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }
  async function checkOwner() {
    if(!user)return;
    const owner=user.id,generation=authGeneration;
    const {data,error}=await client.rpc('is_dogehouse_owner');
    if(!user||user.id!==owner||generation!==authGeneration)return;
    isOwner=!error&&data===true;dashboardVerified=false;
    if(isOwner&&user.email?.toLowerCase()==='salesandinfo@thedogehouse.com'){const verified=await client.auth.getUser();if(!user||user.id!==owner||generation!==authGeneration)return;dashboardVerified=!verified.error&&verified.data.user?.id===owner&&verified.data.user?.email?.toLowerCase()==='salesandinfo@thedogehouse.com';}
    $('accountCustomerDesigns').hidden=!isOwner;$('accountCustomerOrders').hidden=!isOwner;
    $('ownerSetupStatus').hidden=!error||user.email!=='salesandinfo@thedogehouse.com';
    $('ownerSetupStatus').textContent=error?'Customer designs are unavailable right now. Your own saved designs still work.':'';
    if(!isOwner&&libraryMode.startsWith('customer'))libraryMode='mine';publishOwner();
  }
  function validPreview(value){return typeof value==='string'&&value.length<=600000&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value);}
  function previewElement(preview,name){
    const strip=document.createElement('div');strip.className='design-previews';
    for(const [key,label] of [['backLeft','Back and left'],['frontRight','Front and right']]){
      if(!validPreview(preview?.[key]))continue;
      const image=document.createElement('img');image.src=preview[key];image.alt=label+' of '+name;image.loading='lazy';strip.append(image);
    }
    return strip;
  }
  async function refreshBuilds() {
    if (!user || recovering) return;
    const owner=user.id,currentRevision=revision,mode=libraryMode,page=libraryPage;
    let result;
    const orders=mode.endsWith('orders'),team=mode.startsWith('customer');
    if(team){
      if(!isOwner)throw Error('Owner access required.');
      result=await client.rpc(orders?'dogehouse_managed_customer_orders':'dogehouse_customer_designs',{p_offset:page*pageSize,p_limit:pageSize});
    }else result=await client.from(orders?'dogehouse_orders':'dogehouse_builds').select(orders?'id,request_id,name,build,total_cents,status,fulfillment_status,updated_at,email_status,email_attempts,created_at,approved_total_cents,payment_status':'id,name,build,created_at').eq('user_id',owner).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1);
    const {data,error}=result;if(error)throw error;
    if(!user||user.id!==owner||revision!==currentRevision||mode!==libraryMode||page!==libraryPage||recovering)return;
    $('designLibraryHeading').textContent={mine:'Saved builds',mine_orders:'Ordered builds',customers:'Customer saved builds',customer_orders:'Customer ordered builds'}[mode];
    $('accountOwnDesigns').setAttribute('aria-pressed',String(mode==='mine'));
    $('accountCustomerDesigns').setAttribute('aria-pressed',String(mode==='customers'));$('accountOwnOrders').setAttribute('aria-pressed',String(mode==='mine_orders'));$('accountCustomerOrders').setAttribute('aria-pressed',String(mode==='customer_orders'));
    $('designPrevious').hidden=page===0;$('designNext').hidden=data.length<pageSize;
    const list=$('savedBuildList');list.replaceChildren();
    if(!data.length){const item=document.createElement('li');item.textContent=orders?'No order requests on this page yet.':team?'No customer saved builds on this page yet.':'No saved builds yet. Name and save your current design above.';list.append(item);}
    data.forEach(row=>{
      const item=document.createElement('li');
      const title=document.createElement('strong');title.textContent=row.name;
      const details=document.createElement('small');
      let estimate='';try{estimate=' · $'+(orders?row.total_cents/100:window.DogeHouseStudioPricing(window.DogeHouseBuild.decode(row.build).studio).total);}catch{}
      details.textContent=new Date(row.created_at).toLocaleDateString()+estimate+(team?' · '+row.customer_email:'')+(orders?' · '+({requested:'Awaiting confirmation',confirmed:'Confirmed',cancelled:'Cancelled'}[row.status]||row.status)+(row.fulfillment_status?' · '+({not_started:'Not started',in_production:'In production',ready:'Ready',completed:'Completed'}[row.fulfillment_status]||'Progress unavailable'):'')+(row.email_status==='sent'?' · Email sent':' · Email pending'):'');
      const load=document.createElement('button');load.type='button';load.textContent='Open in 3D';load.setAttribute('aria-label','Open '+row.name);
      load.addEventListener('click',()=>{
        if(!window.confirm('Replace your current design with this saved design? Save your current design first if you want to keep it.'))return;
        try{window.DogeHouseBuild.load(row.build);$('savedBuildName').value=row.name;dialog.close();}catch(error){status(error.message);}
      });
      item.append(title,details,previewElement(row.build.preview,row.name),load);
      if(orders){
        const payment=document.createElement('small');
        const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
        payment.textContent=row.approved_total_cents==null?'Payment available after DogeHouse confirms the final quote.':'Final total: '+money(row.approved_total_cents)+' · '+({unpaid:'Unpaid',paid:'Paid',partially_refunded:'Partially refunded',refunded:'Refunded'}[row.payment_status]||'Unpaid');
        item.append(payment);
        if(mode==='customer_orders'&&row.approved_total_cents==null&&row.status!=='cancelled'){
          const form=document.createElement('form'),label=document.createElement('label'),amount=document.createElement('input'),approve=document.createElement('button');
          label.textContent='Final total in USD, including shipping and tax ';
          amount.type='text';amount.inputMode='decimal';amount.required=true;amount.maxLength=9;amount.placeholder='349.00';label.append(amount);
          approve.type='submit';approve.textContent='Approve final quote';form.append(label,approve);
          form.addEventListener('submit',event=>{event.preventDefault();operation(async()=>{
            const value=amount.value.trim();if(!/^\d{1,6}(\.\d{1,2})?$/.test(value))throw Error('Enter a dollar amount with at most two decimal places.');
            const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
            if(cents<50||cents>10000000)throw Error('The final total must be between $0.50 and $100,000.');
            if(!window.confirm('Approve '+money(cents)+' as the final total, including shipping and tax? This quote cannot be changed.'))return;
            const {error}=await client.rpc('approve_dogehouse_quote',{p_order_id:row.id,p_amount_cents:cents});if(error)throw error;
            await refreshBuilds();status('Quote approved. The customer can now pay from Ordered builds.');
          });});item.append(form);
        }
        if(mode==='mine_orders'&&row.status==='confirmed'&&row.approved_total_cents!=null&&row.payment_status==='unpaid'){
          const pay=document.createElement('button');pay.type='button';pay.textContent='Pay '+money(row.approved_total_cents);
          pay.addEventListener('click',()=>operation(async()=>{
            const {data,error}=await client.functions.invoke('pay-order',{body:{orderId:row.id}});
            if(error){let message='Checkout is unavailable. Please try again.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
            if(data?.paid){await refreshBuilds();status('Payment confirmed.');return;}
            let checkout;try{checkout=new URL(data?.url);}catch{throw Error('Checkout is unavailable.');}
            if(checkout.origin!=='https://checkout.stripe.com')throw Error('Checkout is unavailable.');
            window.location.assign(checkout.href);
          }));item.append(pay);
        }
      }
      if(orders&&mode==='mine_orders'&&row.email_status!=='sent'&&row.email_attempts<5){
        const retry=document.createElement('button');retry.type='button';retry.textContent='Retry email';
        retry.addEventListener('click',()=>operation(async()=>{const receipt=await window.DogeHouseOrders.submit({requestId:row.request_id,build:row.build});await refreshBuilds();status(receipt.emailStatus==='sent'?'Both design images were emailed to DogeHouse.':'Your request is saved; email delivery is still pending.');}));item.append(retry);
      }
      if(mode==='mine'){
        const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+row.name);
        remove.addEventListener('click',()=>{
          if(!window.confirm('Delete “'+row.name+'” from your saved designs?'))return;
          operation(async()=>{if(!user)throw Error('Please sign in again.');const {error}=await client.from('dogehouse_builds').delete().eq('id',row.id).eq('user_id',user.id);if(error)throw error;await refreshBuilds();status('Design deleted.');});
        });
        item.append(remove);
      }
      list.append(item);
    });
  }
  function openAccount(){
    if(!dialog.open)dialog.showModal();
    if(!client){showUser(null);status('Account saving is coming soon. You can still customize your house and download your build details.');return;}
    if(recovering){showUser(user);return;}
    status('Loading your account…');
    operation(async()=>{const {data,error}=await client.auth.getSession();if(error)throw error;showUser(data.session?.user||null);if(user){await checkOwner();if(location.hash==='#orders')libraryMode=isOwner?'customer_orders':'mine_orders';await refreshBuilds();}status('');});
  }
  document.querySelectorAll('.site-header').forEach(header => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account-launch'; button.textContent = 'Sign in / Save builds'; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', openAccount);
    header.append(button); launchers.push(button);
    const ownerLink=document.createElement('a');ownerLink.href='#dashboard';ownerLink.className='owner-launch';ownerLink.textContent='Dashboard';ownerLink.hidden=true;header.append(ownerLink);ownerLaunchers.push(ownerLink);
  });
  document.querySelectorAll('[data-account-open]').forEach(button=>button.addEventListener('click',openAccount));
  dialog.querySelector('.account-close').addEventListener('click', () => dialog.close());
  $('accountAuthForm').addEventListener('submit', event => {
    event.preventDefault();
    operation(async () => {
      const signup = event.submitter === $('accountSignup');
      const credentials = { email: $('accountEmail').value.trim(), password: $('accountPassword').value };
      if (signup) credentials.options = {emailRedirectTo:redirectUrl()};
      let result;
      try { result = signup ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials); }
      finally { $('accountPassword').value = ''; }
      const {data,error}=result; if(error)throw error;
      showUser(data.session?.user || null);
      if(user){await checkOwner();if(location.hash==='#orders')libraryMode=isOwner?'customer_orders':'mine_orders';await refreshBuilds();status('You’re signed in. Save your current design below.');}
      else status('Check your email to confirm your account, then return here to sign in.');
    });
  });
  $('accountForgot').addEventListener('click', () => {
    const email=$('accountEmail'); if(!email.reportValidity())return;
    operation(async () => {
      const {error}=await client.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:redirectUrl()});
      if(error)throw error;
      status('If an account exists for this email, you’ll receive a password-reset link.');
    });
  });
  $('accountResetForm').addEventListener('submit', event => {
    event.preventDefault();
    operation(async () => {
      const {error}=await client.auth.updateUser({password:$('accountNewPassword').value}); if(error)throw error;
      $('accountNewPassword').value='';
      const result=await client.auth.signOut({scope:'global'});
      if(result.error)throw result.error;
      recovering=false;showUser(null);status('Password updated. Sign in with your new password.');
    });
  });
  $('accountSaveForm').addEventListener('submit', event => {
    event.preventDefault();
    operation(async () => {
      if (!user) throw Error('Please sign in again to save your build.');
      const name = $('savedBuildName').value.trim(); if (!name) throw Error('Enter a name for your build.');
      const savingUser=user.id,build=window.DogeHouseBuild.read();let previews=true;
      try{build.preview=await window.DogeHouseStudioBridge.capture();}catch{previews=false;}
      if(!user||user.id!==savingUser)throw Error('Please sign in again to save your design.');
      const { error } = await client.from('dogehouse_builds').insert({user_id:user.id,name,build});
      if(error)throw error;
      libraryMode='mine';libraryPage=0;await refreshBuilds(); status(previews?'Design saved. You can reopen it later, and the DogeHouse team can review it.':'Design saved without previews. Reopen it later to view it in 3D.');
    });
  });
  $('accountOwnOrders').addEventListener('click',()=>operation(async()=>{libraryMode='mine_orders';libraryPage=0;await refreshBuilds();status('');}));
  $('accountCustomerOrders').addEventListener('click',()=>operation(async()=>{if(!isOwner)throw Error('Owner access required.');libraryMode='customer_orders';libraryPage=0;await refreshBuilds();status('');}));
  $('accountOwnDesigns').addEventListener('click',()=>operation(async()=>{libraryMode='mine';libraryPage=0;await refreshBuilds();status('');}));
  $('accountCustomerDesigns').addEventListener('click',()=>operation(async()=>{if(!isOwner)throw Error('Owner access required.');libraryMode='customers';libraryPage=0;await refreshBuilds();status('');}));
  $('designPrevious').addEventListener('click',()=>operation(async()=>{libraryPage=Math.max(0,libraryPage-1);await refreshBuilds();}));
  $('designNext').addEventListener('click',()=>operation(async()=>{libraryPage++;await refreshBuilds();}));
  $('accountRefresh').addEventListener('click', () => operation(async () => { await refreshBuilds(); status('Saved builds refreshed.'); }));
  $('accountSignout').addEventListener('click', () => operation(async () => {
    const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;
    recovering=false;showUser(null);$('accountPassword').value='';status('Signed out. Your current design stays in this browser session.');
  }));
  function publicConfigValid() {
    if(!config.supabaseUrl || !config.supabasePublishableKey)return false;
    const url=new URL(config.supabaseUrl);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname))return false;
    const key=config.supabasePublishableKey;
    if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return true;
    try{return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{return false;}
  }
  try {
    if(publicConfigValid()){
      client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);
      client.auth.onAuthStateChange((event,session) => {
        if(event==='PASSWORD_RECOVERY')recovering=true;
        if(event==='SIGNED_OUT')recovering=false;
        showUser(session?.user || null);
        // Defer SDK calls until the auth callback releases its lock.
        if(recovering){if(!dialog.open)dialog.showModal();status('Choose a new password below.');}
        else if(user)setTimeout(async()=>{try{await checkOwner();if(dialog.open&&user)await operation(refreshBuilds);}catch{isOwner=false;publishOwner();}},0);
      });
      client.auth.initialize().then(({error}) => {
        if(error){if(!dialog.open)dialog.showModal();status('This sign-in or password-reset link is invalid or expired. Please request a new link.');}
      });
      client.auth.getSession().then(async ({data,error}) => {
        if(error){status('Could not restore your account session. Please sign in again.');return;}
        showUser(data.session?.user || null);if(user&&!recovering)await checkOwner();
      }).catch(()=>status('Could not restore your account session. Please try again.'));
    }
  }catch{client=null;}
  window.DogeHouseOwner={
    userId:()=>user?.id||null,
    isAuthorized:dashboardAllowed,
    async manage(row,nextStatus,nextFulfillment){
      const generation=authGeneration,identity=user?.id;
      if(!client||!dashboardAllowed())throw Error('Owner access required.');
      await checkOwner();if(!dashboardAllowed()||generation!==authGeneration||user?.id!==identity)throw Error('Your account changed. Sign in again.');
      const {data,error}=await client.rpc('manage_dogehouse_order',{p_order_id:row.id,p_expected_version:row.status_version,p_status:nextStatus,p_fulfillment_status:nextFulfillment});
      if(generation!==authGeneration||user?.id!==identity||!dashboardAllowed())throw Error('Your account changed. Refresh before making another update.');
      if(error){const messages={P0001:'This order changed elsewhere. Refresh and try again.',P0002:'This order no longer exists. Refresh the dashboard.',42501:'Owner access required. Sign in again.'};throw Error(messages[error.code]||(error.code==='22023'?error.message:'Could not update the order. Refresh to check its status before retrying.'));}
      return Array.isArray(data)?data[0]:data;
    },
    async load(mode,page){
      const generation=authGeneration,identity=user?.id;
      if(!client||!dashboardAllowed())throw Error('Owner access required.');
      const verified=await client.auth.getUser();
      if(verified.error||verified.data.user?.id!==identity||verified.data.user?.email?.toLowerCase()!=='salesandinfo@thedogehouse.com'||generation!==authGeneration)throw Error('Please sign in again.');
      await checkOwner();if(!dashboardAllowed()||generation!==authGeneration)throw Error('Owner access required.');
      const results=await Promise.all([
        client.rpc(mode==='orders'?'dogehouse_managed_customer_orders':'dogehouse_customer_designs',{p_offset:page*pageSize,p_limit:pageSize}),
        client.from('dogehouse_builds').select('id',{head:true,count:'exact'}),
        client.from('dogehouse_orders').select('id',{head:true,count:'exact'}),
        client.from('dogehouse_orders').select('id',{head:true,count:'exact'}).eq('status','requested'),
        client.from('dogehouse_orders').select('id',{head:true,count:'exact'}).neq('email_status','sent')
      ]);
      if(generation!==authGeneration||user?.id!==identity||!dashboardAllowed())throw Error('Your account changed.');
      if(results.some(result=>result.error))throw Error('Dashboard data could not be loaded. Refresh to try again.');
      return {rows:results[0].data,counts:results.slice(1).map(result=>result.count),pageSize,total:results[mode==='orders'?2:1].count};
    }
  };
  window.DogeHouseOrders={
    userId:()=>user?.id||null,
    async requireUser(){
      if(!client)throw Error('Ordering is unavailable right now.');
      const {data,error}=await client.auth.getSession();if(error||!data.session?.user){openAccount();throw Error('Sign in, then submit your order request again.');}
      if(user?.id!==data.session.user.id)showUser(data.session.user);return data.session.user.id;
    },
    async submit(payload){
      await this.requireUser();const {data,error}=await client.functions.invoke('submit-order',{body:payload});
      if(error){let message='Ordering is temporarily unavailable. Your saved builds are still available.';try{const response=await error.context.json();if(typeof response.error==='string')message=response.error;}catch{}throw Error(message);}
      if(!data?.orderId)throw Error('The request could not be confirmed. Please retry the same request.');return data;
    }
  };
  window.addEventListener('hashchange',()=>{if(location.hash==='#orders')openAccount();});
  if(location.hash==='#orders')setTimeout(openAccount,0);
  // Email callbacks can arrive in an already open tab without a document load.
  // Restart SDK initialization only when a new callback fragment contains tokens.
  window.addEventListener('hashchange', () => {
    if(new URLSearchParams(location.hash.slice(1)).has('access_token'))location.reload();
  });
  showUser(null);
})();
