(() => {
 const frame=document.getElementById('studioFrame');let api=null,applying=false;
 let cached=null,cachedKey=null;
 let state=window.DogeHouseStudioState();
 try{const stored=JSON.parse(sessionStorage.getItem('dogehouse-studio')||'null');if(stored)state=window.DogeHouseStudioState(stored);}catch{}
 const read=()=>window.DogeHouseStudioState(api?api.get():state);
 const pricing=()=>window.DogeHouseStudioPricing(read());
 function remember(){cached=null;cachedKey=null;try{sessionStorage.setItem('dogehouse-studio',JSON.stringify(state));}catch{}window.dispatchEvent(new Event('dogehouse:design-change'));}
 function restore(input){state=window.DogeHouseStudioState(input);if(api){applying=true;try{api.set(state);state=read();}finally{applying=false;}}remember();}
 function connect(){
  const next=frame.contentWindow?.DogeHouseStudio;
  if(!next||next===api)return;
  api=next;restore(state);document.getElementById('studioStatus').textContent='Customize your design in the 3D studio below.';
  frame.contentWindow.addEventListener('studio-change',()=>{if(applying)return;state=read();remember();});
 }
 async function capture(){
  connect();
  if(!api){frame.loading='eager';await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error('3D previews are unavailable.'));},15000);
   function cleanup(){clearTimeout(timer);window.removeEventListener('dogehouse:studio-ready',ready);frame.removeEventListener('load',ready);}
   function ready(){connect();if(api){cleanup();resolve();}}
   window.addEventListener('dogehouse:studio-ready',ready);frame.addEventListener('load',ready);ready();
  });}
  const key=JSON.stringify(read());if(!cached||cachedKey!==key){cached=api.capture();cachedKey=key;}return {...cached};
 }
 window.DogeHouseStudioBridge={read,restore,pricing,capture};
 window.addEventListener('dogehouse:studio-ready',connect);
 frame.addEventListener('load',connect);
})();
