(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('accountDialog');
  const config = window.DOGEHOUSE_ACCOUNT_CONFIG || {};
  let client, user = null, busy = false, revision = 0, recovering = false;
  const launchers = [];
  const status = message => { $('accountStatus').textContent = message; };
  const redirectUrl = () => location.origin + location.pathname;
  function showUser(nextUser) {
    user = nextUser;
    revision++;
    $('accountAuthForm').hidden = !client || Boolean(user) || recovering;
    $('accountResetForm').hidden = !recovering;
    $('accountBuildPanel').hidden = !user || recovering;
    $('accountIdentity').textContent = user ? `Signed in as ${user.email}` : '';
    $('accountIntro').textContent = recovering ? 'Choose a new password for your account.' : user ? 'Save a new copy of your current design, or reopen a saved build.' : 'Sign in to save your builds and pick them up on any device.';
    $('savedBuildList').replaceChildren();
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
  async function refreshBuilds() {
    if (!user || recovering) return;
    const owner = user.id, currentRevision = revision;
    const { data, error } = await client.from('dogehouse_builds').select('id,name,build,created_at').eq('user_id', owner).order('created_at', { ascending: false });
    if (error) throw error;
    if (!user || user.id !== owner || revision !== currentRevision || recovering) return;
    const list = $('savedBuildList'); list.replaceChildren();
    if (!data.length) { const item = document.createElement('li'); item.textContent = 'No saved builds yet. Your current design is ready to save.'; list.append(item); }
    data.forEach(row => {
      const item = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = row.name;
      const date = document.createElement('small'); date.textContent = new Date(row.created_at).toLocaleDateString();
      const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Open build'; load.setAttribute('aria-label', `Open ${row.name}`);
      load.addEventListener('click', () => {
        if (!window.confirm('Replace your current design with this saved build? Save your current design first if you want to keep it.')) return;
        try { window.DogeHouseBuild.load(row.build); $('savedBuildName').value = row.name; dialog.close(); } catch (error) { status(error.message); }
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${row.name}`);
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete “${row.name}” from your saved builds?`)) return;
        operation(async () => {
          if (!user) throw Error('Please sign in again.');
          const { error } = await client.from('dogehouse_builds').delete().eq('id', row.id).eq('user_id', user.id);
          if (error) throw error;
          await refreshBuilds(); status('Build deleted.');
        });
      });
      item.append(title, date, document.createElement('br'), load, remove); list.append(item);
    });
  }
  document.querySelectorAll('.site-header').forEach(header => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account-launch'; button.textContent = 'Sign in / Save builds'; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      dialog.showModal();
      if (!client) { showUser(null); status('Account saving is coming soon. You can still customize your house and download your build details.'); return; }
      if (recovering) { showUser(user); return; }
      status('Loading your account…');
      operation(async () => {
        const {data,error}=await client.auth.getSession(); if(error)throw error;
        showUser(data.session?.user || null); if(user)await refreshBuilds(); status('');
      });
    });
    header.append(button); launchers.push(button);
  });
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
      if(user){await refreshBuilds();status('You’re signed in. Save your current design below.');}
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
      const { error } = await client.from('dogehouse_builds').insert({user_id:user.id,name,build:window.DogeHouseBuild.read()});
      if(error)throw error;
      await refreshBuilds(); status('Build saved to your account.');
    });
  });
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
        else if(dialog.open && user)setTimeout(()=>operation(refreshBuilds),0);
      });
      client.auth.initialize().then(({error}) => {
        if(error){if(!dialog.open)dialog.showModal();status('This sign-in or password-reset link is invalid or expired. Please request a new link.');}
      });
      client.auth.getSession().then(({data,error}) => {
        if(error){status('Could not restore your account session. Please sign in again.');return;}
        showUser(data.session?.user || null);
      }).catch(()=>status('Could not restore your account session. Please try again.'));
    }
  }catch{client=null;}
  // Email callbacks can arrive in an already open tab without a document load.
  // Restart SDK initialization only when a new callback fragment contains tokens.
  window.addEventListener('hashchange', () => {
    if(new URLSearchParams(location.hash.slice(1)).has('access_token'))location.reload();
  });
  showUser(null);
})();
