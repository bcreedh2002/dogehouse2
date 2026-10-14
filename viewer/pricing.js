// Shared by the studio and parent site. Module prices are estimates pending confirmation.
globalThis.DogeHouseStudioPricing=input=>{const S=input&&typeof input==='object'?input:{};const a=[['Stock single-slope doghouse',349]],p=(l,n)=>a.push([l,n]);
S.door==='L'&&p('Large arch doorway',15);S.roofType==='shingle'&&p('Shingled roof',60);S.roofType==='metal'&&p('Metal roof',80);S.doorTrim&&p('Doorway trim',30);S.cornerTrim&&p('Corner trim',25);
S.win&&p('Window cutout',55);S.win&&S.awning&&p('Window awning',35);['decal','rug','fabric'].includes(S.floor)&&p('Floor '+S.floor,{decal:20,rug:35,fabric:28}[S.floor]);['left','right','back'].includes(S.grass)&&p('Faux grass ('+S.grass+')',45);
S.led&&p('LED strip',40);S.mailbox&&p('Mini mailbox',15);['left','right','back'].includes(S.board)&&p('Multiboard ('+S.board+')',30);
S.storageDrawer&&p('Storage drawer',45);S.swapPanels&&p('Swap panels',35);S.legExtensions&&p('Leg extensions',25);S.porchAwning&&p('Porch awning',45);S.weatherLiner&&p('Weather liner',55);S.ramp&&p('Ramp',40);S.bowlHolder&&p('Bowl holder',22);S.doorFlap&&p('Door flap',18);
(Array.isArray(S.gfx)?S.gfx:[]).filter(g=>g&&['e','n'].includes(g.k)).forEach(g=>p(g.k==='n'?'Neon "'+g.txt+'"':'Graphic '+g.txt,g.k==='n'?65:18));return {items:a,total:a.reduce((sum,item)=>sum+item[1],0)};};
