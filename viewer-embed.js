(() => {
 const frame=document.getElementById('studioFrame');let state=null,api=null,applying=false;
 try{state=JSON.parse(sessionStorage.getItem('dogehouse-studio')||'null');}catch{}
 const field=id=>document.getElementById(id);
 function pricing(){return window.DogeHouseStudioPricing(api?api.get():state);}
 function showPrices(){const quote=pricing();document.querySelectorAll('.build-total').forEach(el=>el.textContent='$'+quote.total);const summary=document.getElementById('studioPriceSummary');if(summary)summary.textContent=quote.items.slice(1).map(([name,amount])=>name+' — $'+amount).join('; ')||'Stock build — no extras';}
 function remember(){showPrices();try{sessionStorage.setItem('dogehouse-studio',JSON.stringify(state));}catch{}}
 function fromParent(){
  if(!api||applying)return;
  applying=true;try{const next=api.get();next.nameplate=field('dogName').value||'DOGEHOUSE';next.body=field('bodyColor').value;next.trim=field('trimColor').value;next.win=field('addonWindow').checked;api.set(next);state=api.get();remember();}finally{applying=false;}
 }
 function restore(value){state=value;remember();if(api){applying=true;try{api.set(value||{});}finally{applying=false;}fromParent();}}
 window.DogeHouseStudioBridge={read:()=>state,restore,pricing};showPrices();
 frame.addEventListener('load',()=>{
  api=frame.contentWindow.DogeHouseStudio;
  if(!api){field('studioStatus').textContent='3D is unavailable in this browser. You can still customize and save your build below.';return;}
  restore(state);
  frame.contentWindow.addEventListener('studio-change',()=>{
   if(applying)return;state=api.get();remember();applying=true;
   try{field('dogName').value=state.nameplate==='DOGEHOUSE'?'':state.nameplate;field('dogName').dispatchEvent(new Event('input',{bubbles:true}));for(const [id,key] of [['bodyColor','body'],['trimColor','trim']]){field(id).value=state[key];field(id).dispatchEvent(new Event('input',{bubbles:true}));}field('addonWindow').checked=state.win;field('addonWindow').dispatchEvent(new Event('change',{bubbles:true}));}finally{applying=false;}
  });
 });
 for(const id of ['bodyColor','trimColor','bodyColorHex','trimColorHex','addonWindow','dogName','previewNameInput'])field(id).addEventListener('input',fromParent);
 field('addonWindow').addEventListener('change',fromParent);
 document.querySelectorAll('[name="palette-state"]').forEach(el=>el.addEventListener('change',fromParent));
})();
