(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const customerFields=['customerName','customerEmail','fulfillment','notes'];
 const fulfillment=['Free shipping — assembly required','Personal pickup — arrange directly','Delivery — additional fee'];
 function customer(){return Object.fromEntries(customerFields.map(id=>[id,$(id).value]));}
 function saveCustomer(){try{sessionStorage.setItem('dogehouse-customer',JSON.stringify(customer()));}catch{}}
 function restoreCustomer(value){for(const id of customerFields){const text=value?.[id];if(typeof text==='string'&&text.length<=10000&&(id!=='fulfillment'||fulfillment.includes(text)))$(id).value=text;}updateFulfillment();saveCustomer();}
 function updateFulfillment(){const delivery=$('fulfillment').value.startsWith('Delivery');$('notes').required=delivery;$('notesOptional').textContent=delivery?'(required for a delivery quote)':'(optional)';saveCustomer();}
 function quote(){return window.DogeHouseStudioBridge.pricing();}
 function renderReview(){const studio=window.DogeHouseStudioBridge.read();$('reviewName').textContent=studio.nameplate||'DOGEHOUSE';$('reviewHouseColor').textContent=studio.body.toUpperCase();$('reviewTrimColor').textContent=studio.trim.toUpperCase();$('reviewHouseSwatch').style.setProperty('--review-color',studio.body);$('reviewTrimSwatch').style.setProperty('--review-color',studio.trim);const estimate=quote();$('studioPriceSummary').textContent=estimate.items.slice(1).map(([name,amount])=>`${name} — $${amount}`).join('; ')||'Stock build — no extras';$('reviewTotal').textContent='$'+estimate.total;}
 let previewRevision=0;
 async function renderPreviews(){const generation=++previewRevision;$('reviewPreviewStatus').textContent='Generating your design previews…';try{const preview=await window.DogeHouseStudioBridge.capture();if(generation!==previewRevision)return;for(const [id,key] of [['reviewBackLeft','backLeft'],['reviewFrontRight','frontRight']]){$(id).src=preview[key];$(id).hidden=false;}$('reviewPreviewStatus').textContent='Two views of your current 3D design.';}catch{if(generation===previewRevision){$('reviewBackLeft').hidden=true;$('reviewFrontRight').hidden=true;$('reviewPreviewStatus').textContent='Previews are unavailable in this browser. Your design settings and total are still available.';}}}
 const routes={home:'route-home',customize:'route-builder',modules:'route-modules',review:'route-review',dashboard:'route-owner'};
 function navigate(key,writeHash=true){if(['addons','palette','identity'].includes(key))key='customize';if(!routes[key]||(key==='dashboard'&&!window.DogeHouseOwner?.isAuthorized()))key='home';$(routes[key]).checked=true;document.querySelectorAll('.preview-page').forEach(page=>page.setAttribute('aria-hidden',String(page.id!=='page-'+routes[key].replace('route-','')&&!(key==='review'&&page.id==='page-builder'))));renderReview();if(key==='review')renderPreviews();if(writeHash&&location.hash!=='#'+key)history.pushState(null,'','#'+key);window.scrollTo(0,0);const title=document.querySelector('#page-'+routes[key].replace('route-','')+' h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}window.dispatchEvent(new Event('dogehouse:page-change'));}
 document.querySelectorAll('[data-page]').forEach(control=>{control.addEventListener('click',e=>{e.preventDefault();navigate(control.dataset.page);});if(control.tagName!=='BUTTON')control.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();control.click();}});});
 const route=()=>navigate(location.hash.slice(1)||'home',false);
 window.addEventListener('dogehouse:owner-change',()=>{if(location.hash==='#dashboard'&&window.DogeHouseOwner?.isAuthorized()&&!$('route-owner').checked)navigate('dashboard',false);else if($('route-owner').checked&&!window.DogeHouseOwner?.isAuthorized())navigate('home',false);});
 window.addEventListener('hashchange',route);window.addEventListener('popstate',route);window.addEventListener('dogehouse:design-change',()=>{renderReview();if($('route-review').checked)renderPreviews();});
 function decode(build){
  if(!build||typeof build!=='object')throw Error('This saved design has an unsupported format.');
  if(build.version===2&&build.studio&&typeof build.studio==='object'&&!Array.isArray(build.studio))return {studio:window.DogeHouseStudioState(build.studio),customer:build.customer||{}};
  if(build.version===1&&build.values&&build.addons){
   const values=build.values;let studio=build.studio;
   if(!studio){studio={body:values.bodyColor,trim:values.trimColor,nameplate:values.dogName||'DOGEHOUSE',win:build.addons.addonWindow};if(build.addons.addonNeon){studio.grass='left';studio.gfx=[{k:'n',txt:values.neonText||'GOOD BOY',col:'#ff3df2',w:'front',s:.11,u:0,v:.76}];}}
   const details={...values};if(build.addons.addonGraphic&&typeof values.graphicNotes==='string')details.notes=((values.notes||'')+'\nGraphic request from the older design: '+values.graphicNotes).slice(0,10000);return {studio:window.DogeHouseStudioState(studio),customer:details};
  }
  throw Error('This saved design has an unsupported format.');
 }
 window.DogeHouseBuild={
  review(){navigate('review');},
  read(){return {version:2,studio:window.DogeHouseStudioBridge.read(),customer:customer(),quote:quote()};},
  decode,
  load(build){const design=decode(build);window.DogeHouseStudioBridge.restore(design.studio);restoreCustomer(design.customer);navigate('customize');}
 };
 function spec(){const studio=window.DogeHouseStudioBridge.read(),details=customer(),estimate=quote();return ['DogeHouse — 3D studio design',...estimate.items.map(([label,price])=>`${label} — $${price}`),`Build total: $${estimate.total} (delivery extra if selected)`,'Customer: '+details.customerName,'Email: '+details.customerEmail,'Dog name: '+studio.nameplate,'Body: '+studio.body,'Roof: '+studio.roof,'Trim: '+studio.trim,'Fulfillment: '+details.fulfillment,'Location / questions: '+details.notes].join('\n');}
 async function copy(text,status){try{await navigator.clipboard.writeText(text);status.textContent='Copied. Paste the details into an email to salesandinfo@thedogehouse.com.';}catch{status.textContent='Copy is unavailable here. Download the details or email salesandinfo@thedogehouse.com.';}}
 $('copyBuild').addEventListener('click',()=>copy(spec(),$('requestStatus')));
 $('downloadBuild').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([spec()],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='dogehouse-build-request.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('requestStatus').textContent='Build details downloaded. Attach them to your email request.';});
 let submitting=false,requestCache=null;
 try{requestCache=JSON.parse(sessionStorage.getItem('dogehouse-order-request')||'null');}catch{}
 function fingerprint(userId){const build=window.DogeHouseBuild.read();return JSON.stringify({userId,studio:build.studio,customer:build.customer});}
 function saveRequest(){try{sessionStorage.setItem('dogehouse-order-request',JSON.stringify(requestCache));}catch{}}
 function refreshOrderButton(){const button=$('submitOrder');const same=requestCache?.submitted&&requestCache.fingerprint===fingerprint(window.DogeHouseOrders?.userId());button.disabled=submitting||same;button.textContent=submitting?'Submitting request…':same?'Order request submitted':'Submit order request';}
 window.addEventListener('dogehouse:design-change',refreshOrderButton);window.addEventListener('dogehouse:account-change',refreshOrderButton);
 for(const id of customerFields)$(id).addEventListener('input',refreshOrderButton);
 $('requestForm').addEventListener('submit',async event=>{
  event.preventDefault();if(submitting)return;submitting=true;refreshOrderButton();$('requestStatus').textContent='Preparing your request and both design images…';
  try{
   const userId=await window.DogeHouseOrders.requireUser();const signature=fingerprint(userId);
   if(!requestCache||requestCache.fingerprint!==signature)requestCache={fingerprint:signature,requestId:crypto.randomUUID(),submitted:false};saveRequest();
   const build=window.DogeHouseBuild.read();build.preview=await window.DogeHouseStudioBridge.capture();
   if(fingerprint(window.DogeHouseOrders.userId())!==signature)throw Error('Your design or account changed. Review it and submit again.');
   const receipt=await window.DogeHouseOrders.submit({requestId:requestCache.requestId,build});
   requestCache.submitted=true;requestCache.orderId=receipt.orderId;saveRequest();
   $('requestStatus').textContent=receipt.emailStatus==='sent'?'Order request received. Both design images were emailed to DogeHouse. View it in Ordered builds.':'Order request received and saved in Ordered builds. The email notification is pending; you can retry it there.';
  }catch(error){$('requestStatus').textContent=error.message||'Your request could not be submitted. Please try again.';}
  finally{submitting=false;refreshOrderButton();}
 });
 refreshOrderButton();
 $('moduleIdeaForm').addEventListener('submit',e=>{e.preventDefault();location.href='mailto:salesandinfo@thedogehouse.com?subject='+encodeURIComponent('DogeHouse module idea')+'&body='+encodeURIComponent($('moduleIdea').value.trim());$('ideaStatus').textContent='Your email app should open. Press Send there to share your idea.';});
 $('copyIdea').addEventListener('click',()=>{const idea=$('moduleIdea').value.trim();if(!idea){$('ideaStatus').textContent='Enter a module idea first.';return;}copy(idea,$('ideaStatus'));});
 for(const id of customerFields)$(id).addEventListener('input',saveCustomer);$('fulfillment').addEventListener('change',updateFulfillment);
 try{const stored=JSON.parse(sessionStorage.getItem('dogehouse-customer')||'null');if(stored)restoreCustomer(stored);else{const legacy=JSON.parse(sessionStorage.getItem('dogehouse-build')||'null');if(legacy){restoreCustomer(legacy.values);if(!sessionStorage.getItem('dogehouse-studio')){const converted=decode({...legacy,version:1});window.DogeHouseStudioBridge.restore(converted.studio);restoreCustomer(converted.customer);}}}}catch{}
 updateFulfillment();route();
})();
