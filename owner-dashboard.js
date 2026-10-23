(() => {
 'use strict';const $=id=>document.getElementById(id),section=$('page-owner');let mode='orders',page=0,generation=0,busy=false,allowed=false,identity=null;
 const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
 const active=()=>$('route-owner').checked;
 const permitted=()=>window.DogeHouseOwner?.isAuthorized()===true;
 const stages={not_started:'Not started',in_production:'In production',ready:'Ready',completed:'Completed'};
 const metricIds=['ownerSavedCount','ownerOrderCount','ownerRequestedCount','ownerEmailCount'];
 function clear(){generation++;busy=false;$('ownerRecords').replaceChildren();metricIds.forEach(id=>$(id).textContent='—');$('ownerStatus').textContent='';$('ownerPage').textContent='';$('ownerPrevious').hidden=true;$('ownerNext').hidden=true;section.hidden=true;section.removeAttribute('aria-busy');}
 function controls(){for(const id of ['ownerRefresh','ownerOrdersTab','ownerSavedTab','ownerPrevious','ownerNext'])$(id).disabled=busy;section.querySelectorAll('[data-owner-management]').forEach(control=>control.disabled=busy||control.dataset.managementDisabled==='true');section.setAttribute('aria-busy',String(busy));}
 function text(tag,value,className){const element=document.createElement(tag);element.textContent=value;if(className)element.className=className;return element;}
 function previews(build,name){const strip=document.createElement('div');strip.className='owner-previews';for(const [key,label] of [['backLeft','Back and left'],['frontRight','Front and right']]){const value=build?.preview?.[key];if(typeof value!=='string'||value.length>600000||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value))continue;const figure=document.createElement('figure'),image=document.createElement('img');image.src=value;image.loading='lazy';image.alt=label+' of '+name;figure.append(image,text('figcaption',label));strip.append(figure);}if(!strip.children.length)strip.append(text('p','No preview available. Open the design in 3D.'));return strip;}
 function record(row,recordMode){
  const article=document.createElement('article');article.className='owner-record';const build=row.build||{},customer=build.customer||{};
  const heading=document.createElement('div');heading.className='owner-record-heading';heading.append(text('h3',row.name||'Untitled build'));
  let total;try{total=recordMode==='orders'?row.total_cents/100:window.DogeHouseStudioPricing(window.DogeHouseBuild.decode(build).studio).total;}catch{}
  if(Number.isFinite(total))heading.append(text('strong',money(total)));article.append(heading);
  article.append(text('p',new Date(row.created_at).toLocaleString()+' · '+(recordMode==='orders'?'Order '+row.id:'Saved build'), 'owner-record-date'));
  if(recordMode==='orders'){const statuses={requested:'Awaiting confirmation',confirmed:'Confirmed',cancelled:'Cancelled'},emails={queued:'Email queued',sending:'Email sending',failed:'Email needs attention',sent:'Email sent'};const tags=document.createElement('div');tags.className='owner-badges';tags.append(text('span',statuses[row.status]||'Unknown order status'),text('span',emails[row.email_status]||'Email status unavailable',row.email_status==='failed'?'owner-alert':''));tags.append(text('span',stages[row.fulfillment_status]||'Not started'));if(row.approved_total_cents!=null)tags.append(text('span','Quote '+(emails[row.quote_email_status]||'email status unavailable').toLowerCase(),row.quote_email_status==='failed'?'owner-alert':''));article.append(tags);}
  article.append(previews(build,row.name));const details=document.createElement('dl');details.className='owner-details';
  for(const [label,value] of [['Account email',row.customer_email],['Account email at submission',build.account?.email],['Contact name',customer.customerName],['Contact email',customer.customerEmail],['Fulfillment',customer.fulfillment],['Notes',customer.notes],['Last updated',row.updated_at?new Date(row.updated_at).toLocaleString():null]]){if(value){details.append(text('dt',label),text('dd',String(value)));}}article.append(details);
  if(recordMode==='orders'){article.append(text('p',row.approved_total_cents==null?'Final quote awaiting approval':'Final total: '+money(row.approved_total_cents/100)+' · '+({unpaid:'Unpaid',paid:'Paid',partially_refunded:'Partially refunded',refunded:'Refunded'}[row.payment_status]||'Unknown payment status')));if(['paid','partially_refunded'].includes(row.payment_status))article.append(text('p','Refund in Stripe before cancelling.'));if(row.payment_review_required)article.append(text('p','Payment needs review after cancellation or a competing checkout. Review before fulfillment.','owner-alert'));article.append(management(row));}
  const actions=document.createElement('div');actions.className='owner-record-actions';const open=text('button','Open in 3D','button account-secondary');open.type='button';open.addEventListener('click',()=>{if(!permitted())return;if(!confirm('Replace your current design with this customer design? Save your current design first if you want to keep it.'))return;try{window.DogeHouseBuild.load(build);}catch{$('ownerStatus').textContent='This design could not be opened.';}});
  const download=text('button','Download details','button account-secondary');download.type='button';download.addEventListener('click',()=>{if(!permitted())return;const {preview,...design}=build;const output={id:row.id,name:row.name,submittedAt:row.created_at,accountEmail:row.customer_email,...(recordMode==='orders'?{totalCents:row.total_cents,status:row.status,fulfillmentStatus:row.fulfillment_status,updatedAt:row.updated_at,emailStatus:row.email_status}:{}),design};const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dogehouse-'+row.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});actions.append(open,download);article.append(actions);return article;
 }
 function management(row){
  const group=document.createElement('div');group.className='owner-management';group.append(text('strong','Manage order'));
  const buttons=document.createElement('div');buttons.className='owner-record-actions';
  function button(label,action,disabled=false){const element=text('button',label,'button account-secondary');element.type='button';element.dataset.ownerManagement='true';element.dataset.managementDisabled=String(disabled);element.disabled=disabled;element.addEventListener('click',action);return element;}
  if(row.status!=='cancelled'&&row.approved_total_cents==null){
   const label=text('label','Final total in USD, including shipping and tax '),amount=document.createElement('input');amount.type='text';amount.inputMode='decimal';amount.placeholder='300.00';amount.setAttribute('aria-label','Final quote total');amount.dataset.ownerManagement='true';label.append(amount);group.append(label);
   buttons.append(button('Approve final quote',()=>{const value=amount.value.trim();if(!/^\d{1,6}(\.\d{1,2})?$/.test(value)){amount.setCustomValidity('Enter a dollar amount with at most two decimal places.');amount.reportValidity();return;}amount.setCustomValidity('');const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(cents<50||cents>10000000){amount.setCustomValidity('Enter $0.50 to $100,000.');amount.reportValidity();return;}if(confirm('Approve '+money(cents/100)+' including shipping and tax? This quote cannot be changed.'))approve(row,cents);}));
  }
  if(row.status==='confirmed'&&row.approved_total_cents!=null&&row.quote_email_status!=='sent'){if(row.quote_email_attempts>=5)group.append(text('p','Quote email retry limit reached (5 attempts). Contact the customer directly.','owner-alert'));else buttons.append(button('Retry quote email',()=>approve(row,null)));}
  if(row.status!=='cancelled'&&row.fulfillment_status!=='completed'&&!['paid','partially_refunded'].includes(row.payment_status))buttons.append(button('Cancel order',()=>{if(confirm('Cancel this order? The design and price will be kept, and fulfillment tracking will stop.'))change(row,'cancelled',row.fulfillment_status);}));
  if(row.status==='confirmed'){
   const label=text('label','Fulfillment stage'),select=document.createElement('select');select.setAttribute('aria-label','Fulfillment stage for '+row.name);select.dataset.ownerManagement='true';
   for(const [value,title] of Object.entries(stages)){const option=text('option',title);option.value=value;select.append(option);}select.value=row.fulfillment_status;
   const save=button('Save fulfillment',()=>change(row,'confirmed',select.value),true);
   select.addEventListener('change',()=>{save.dataset.managementDisabled=String(select.value===row.fulfillment_status);save.disabled=busy||select.value===row.fulfillment_status;});label.append(select);group.append(label);buttons.append(save);
  }else group.append(text('p',row.status==='cancelled'?'Cancelled orders keep their original design and progress.':'Confirm this request before tracking fulfillment.','owner-note'));
  group.append(buttons);return group;
 }
 async function approve(row,cents){
  if(busy||!permitted()||!active())return;const request=++generation;busy=true;controls();$('ownerStatus').textContent='Updating quote…';
  try{const result=cents==null?await window.DogeHouseOwner.action({action:'notify',orderId:row.id}):await window.DogeHouseOwner.approve(row,cents);if(request!==generation||!permitted()||!active())return;await load();if(permitted()&&active())$('ownerStatus').textContent=result.emailStatus==='sent'?'Quote email sent.':'Quote saved. Email status: '+result.emailStatus+'.';}
  catch(error){if(request===generation)$('ownerStatus').textContent=error.message||'Refresh before retrying.';}
  finally{if(request===generation){busy=false;controls();}}
 }
 async function change(row,nextStatus,nextFulfillment){
  if(busy||!permitted()||!active())return;const request=++generation;busy=true;controls();$('ownerStatus').textContent='Updating order…';
  try{await window.DogeHouseOwner.manage(row,nextStatus,nextFulfillment);if(request!==generation||!permitted()||!active())return;const refresh=generation+1;await load();if(generation===refresh&&permitted()&&active()&&!busy&&!$('ownerStatus').textContent)$('ownerStatus').textContent='Order updated.';}
  catch(error){if(request===generation&&permitted()&&active())$('ownerStatus').textContent=error.message||'Could not update the order. Refresh before retrying.';}
  finally{if(request===generation){busy=false;controls();}}
 }
 async function load(){
  if(!permitted()||!active())return;const request=++generation,selectedMode=mode,selectedPage=page;busy=true;controls();$('ownerRecords').replaceChildren();$('ownerStatus').textContent='Loading customer records…';$('ownerPrevious').hidden=true;$('ownerNext').hidden=true;
  $('ownerLibraryTitle').textContent=mode==='orders'?'Order requests':'Saved builds';$('ownerOrdersTab').setAttribute('aria-pressed',String(mode==='orders'));$('ownerSavedTab').setAttribute('aria-pressed',String(mode==='saved'));
  try{const result=await window.DogeHouseOwner.load(selectedMode,selectedPage);if(request!==generation||!permitted()||!active()||mode!==selectedMode||page!==selectedPage)return;
   result.counts.forEach((count,i)=>$(metricIds[i]).textContent=Number.isInteger(count)?count.toLocaleString():'—');
   if(page>0&&!result.rows.length){page--;return load();}
   $('ownerRecords').replaceChildren(...result.rows.map(row=>record(row,selectedMode)));$('ownerStatus').textContent=result.rows.length?'':mode==='orders'?'No order requests yet.':'No saved customer builds yet.';
   $('ownerPage').textContent='Page '+(page+1);$('ownerPrevious').hidden=page===0;$('ownerNext').hidden=result.total!==null?(page+1)*result.pageSize>=result.total:result.rows.length<result.pageSize;
  }catch{if(request===generation&&permitted()&&active()){$('ownerStatus').textContent='Dashboard data could not be loaded. Refresh to try again.';metricIds.forEach(id=>$(id).textContent='—');}}
  finally{if(request===generation){busy=false;controls();}}
 }
 $('ownerRefresh').addEventListener('click',load);$('ownerOrdersTab').addEventListener('click',()=>{mode='orders';page=0;load();});$('ownerSavedTab').addEventListener('click',()=>{mode='saved';page=0;load();});$('ownerPrevious').addEventListener('click',()=>{page=Math.max(0,page-1);load();});$('ownerNext').addEventListener('click',()=>{page++;load();});
 window.addEventListener('dogehouse:owner-change',()=>{const next=permitted(),currentIdentity=window.DogeHouseOwner?.userId()||null;if(currentIdentity!==identity){identity=currentIdentity;mode='orders';page=0;}if(!next){allowed=false;clear();return;}section.hidden=false;if(!allowed){allowed=true;if(active()&&!busy)load();}});
 window.addEventListener('dogehouse:page-change',()=>{if(active()&&permitted()){section.hidden=false;load();}else{generation++;busy=false;controls();}});
 clear();
})();
