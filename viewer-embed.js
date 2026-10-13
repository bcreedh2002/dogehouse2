(() => {
 const frame=document.getElementById('studioFrame');let api=null,applying=false;
 let cached=null,cachedKey=null;
 let state=window.DogeHouseStudioState();
 try{const stored=JSON.parse(sessionStorage.getItem('dogehouse-studio')||'null');if(stored)state=window.DogeHouseStudioState(stored);}catch{}
 const read=()=>window.DogeHouseStudioState(api?api.get():state);
 const pricing=()=>window.DogeHouseStudioPricing(read());
 function remember(){cached=null;cachedKey=null;try{sessionStorage.setItem('dogehouse-studio',JSON.stringify(state));}catch{}window.dispatchEvent(new Event('dogehouse:design-change'));}
 function restore(input){state=window.DogeHouseStudioState(input);if(api){applying=true;try{api.set(state);state=read();}finally{applying=false;}}remember();}
 async function capture(){
  if(!api){frame.loading='eager';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{frame.removeEventListener('load',loaded);reject(Error('3D previews are unavailable.'));},15000);function loaded(){clearTimeout(timer);api?resolve():reject(Error('3D previews are unavailable.'));}frame.addEventListener('load',loaded,{once:true});if(frame.contentWindow?.DogeHouseStudio){api=frame.contentWindow.DogeHouseStudio;clearTimeout(timer);frame.removeEventListener('load',loaded);resolve();}});}
  const key=JSON.stringify(read());if(!cached||cachedKey!==key){cached=api.capture();cachedKey=key;}return {...cached};
 }
 window.DogeHouseStudioBridge={read,restore,pricing,capture};
 frame.addEventListener('load',()=>{
  api=frame.contentWindow.DogeHouseStudio;
  if(!api){document.getElementById('studioStatus').textContent='3D is unavailable in this browser. Your saved design is still available in My builds.';return;}
  restore(state);
  frame.contentWindow.addEventListener('studio-change',()=>{if(applying)return;state=read();remember();});
 });
})();
