const fs=require('node:fs'),path=require('node:path');
module.exports=async page=>{
 const root=path.resolve(__dirname,'..');
 await page.route('http://127.0.0.1:8000/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'dogehouse-launch.html',file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const contentType=name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html';
  const config=fs.readFileSync(path.join(root,'netlify.toml'),'utf8'),csp=config.match(/Content-Security-Policy = "([^"]+)"/)[1];
  return route.fulfill({contentType,headers:{'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'},body:fs.readFileSync(file)});
 });
};
