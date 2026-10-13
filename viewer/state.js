// Shared, versioned design normalization. Only studio controls define a design.
globalThis.DogeHouseStudioState = input => {
 const clean={nameplate:'DOGEHOUSE',body:'#c9a27a',roof:'#3a3d44',trim:'#f2efe8',door:'M',doorTrim:false,cornerTrim:false,roofType:'plain',xray:false,win:false,awning:false,awningColor:'#b5392f',floor:'none',floorColor:'#b5392f',led:false,ledColor:'#4de3ff',grass:'none',mailbox:false,board:'none',gfx:[],sel:-1};
 if(!input||typeof input!=='object'||Array.isArray(input))return clean;
 if(typeof input.nameplate==='string')clean.nameplate=input.nameplate.slice(0,14);
 for(const k of ['body','roof','trim','awningColor','floorColor','ledColor'])if(/^#[0-9a-f]{6}$/i.test(input[k]))clean[k]=input[k].toLowerCase();
 const choices={door:['S','M','L'],roofType:['plain','shingle','metal'],floor:['none','decal','rug','fabric'],grass:['none','left','right','back'],board:['none','left','right','back']};
 for(const [k,options] of Object.entries(choices))if(options.includes(input[k]))clean[k]=input[k];
 for(const k of ['doorTrim','cornerTrim','xray','win','awning','led','mailbox'])clean[k]=input[k]===true;
 if(!clean.win)clean.awning=false;
 clean.gfx=(Array.isArray(input.gfx)?input.gfx:[]).slice(0,50).filter(g=>g&&['e','n'].includes(g.k)&&['front','back','left','right'].includes(g.w)&&typeof g.txt==='string').map(g=>{
  const size=Number.isFinite(g.s)?Math.max(.04,Math.min(.4,g.s)):.2;
  const halfWidth=size*(g.k==='n'?512/192:1)/2,halfHeight=size/2;
  const limit=Math.max(0,(['front','back'].includes(g.w)?1:1.12)/2-halfWidth-.01);
  return {k:g.k,w:g.w,txt:g.txt.slice(0,24),col:/^#[0-9a-f]{6}$/i.test(g.col)?g.col.toLowerCase():'#ff3df2',s:size,u:Math.max(-limit,Math.min(limit,Number.isFinite(g.u)?g.u:0)),v:Math.max(.06+halfHeight,Math.min((g.w==='front'?.9:.7)-.04-halfHeight,Number.isFinite(g.v)?g.v:.5))};
 });
 return clean;
};
