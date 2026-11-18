// Static navigation contract for all shipped guest, ticketing, admin, and staff pages.
// Keeps real links keyboard-focusable and detects missing routes or dead controls
// before deployment. Browser QA separately covers runtime interactions.
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SITE=path.join(ROOT,'site');
const errors=[];
const pages=[];
const inventory={pages:0,links:0,buttons:0};
const exists=async p=>stat(p).then(x=>x.isFile()).catch(()=>false);
async function walk(dir){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())result.push(...await walk(full));
    else if(entry.isFile())result.push(full);
  }
  return result;
}
const files=await walk(SITE);
const htmlFiles=files.filter(p=>p.endsWith('.html'));
const siteFiles=new Set(files.map(p=>path.relative(SITE,p).replaceAll(path.sep,'/')));
const getAttr=(text,name)=>{
  const m=text.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|'+String.fromCharCode(39)+'([^'+String.fromCharCode(39)+']*)'+String.fromCharCode(39)+')','i'));
  return m?(m[1]??m[2]):null;
};
const labels=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
const matches=(s,rx)=>[...s.matchAll(rx)];
const toml=await readFile(path.join(ROOT,'netlify.toml'),'utf8');
const routes=matches(toml,/\[\[redirects\]\]([\s\S]*?)(?=\[\[redirects\]\]|\[\[headers\]\]|$)/g)
 .map(m=>({from:getAttr(m[1].replace(/from\s*=/g,'from='),'from'),to:getAttr(m[1].replace(/to\s*=/g,'to='),'to')}))
 .filter(r=>r.from?.startsWith('/')&&r.to?.startsWith('/'));
const escapeRe=s=>[...s].map(ch=>'.*+?^$()[]{}|\\'.includes(ch)?'\\'+ch:ch).join('');
function redirectTarget(urlPath){
  for(const rule of routes){
    const rx=new RegExp('^'+escapeRe(rule.from).replace(/:[a-zA-Z_]+/g,'[^/]+').replace(/\\\*/g,'.*')+'$');
    if(rx.test(urlPath))return rule.to.split('?')[0].replace(/^\/+/,'');
  }
  return null;
}
const handlers=new Set();
for(const p of await walk(path.join(ROOT,'netlify/functions'))){
  if(!p.endsWith('.mjs'))continue;
  const s=await readFile(p,'utf8');
  for(const m of matches(s,/\bpath\s*:\s*['"]([^'"]+)['"]/g))handlers.add(m[1]);
}
const home=await readFile(path.join(SITE,'index.html'),'utf8');
const homeIds=new Set(matches(home,/\bid=["']([^"']+)["']/g).map(m=>m[1]));
const allowedClickPlaceholders=new Map([
 ['admin.html',new Set(['logoutLink'])],
 ['admin-operations.html',new Set(['logoutLink','mobileLogout'])]
]);
function error(page,message){errors.push(path.relative(SITE,page)+': '+message);}
async function checkDestination(page,href,ownIds){
  if(/^(?:mailto:|tel:|sms:)/i.test(href))return;
  const base='https://enterwildones.com/'+path.relative(SITE,page).replaceAll(path.sep,'/');
  let url;
  try{url=new URL(href,base)}catch{error(page,'Malformed link '+href);return;}
  if(!['http:','https:'].includes(url.protocol)){error(page,'Unsafe link protocol '+href);return;}
  if(!['enterwildones.com','www.enterwildones.com'].includes(url.hostname))return;
  const p=decodeURIComponent(url.pathname).replace(/^\/+/,'');
  const pathname='/'+p;
  if(url.hash){
    const ids=pathname==='/'?homeIds:href.startsWith('#')?ownIds:null;
    if(ids&&!ids.has(decodeURIComponent(url.hash.slice(1))))error(page,'Missing fragment target '+href);
  }
  if(!p)return;
  if(siteFiles.has(p)||siteFiles.has(p+'.html'))return;
  const redirect=redirectTarget(pathname);
  if(redirect&&siteFiles.has(redirect))return;
  if(handlers.has(pathname))return;
  error(page,'Unresolved internal destination '+href);
}
for(const page of htmlFiles){
  const source=await readFile(page,'utf8');
  const ids=new Set(matches(source,/\bid=["']([^"']+)["']/g).map(m=>m[1]));
  const scriptRefs=matches(source,/<script\b([^>]*)>/gi).map(m=>getAttr(m[1],'src')).filter(x=>x&&x.startsWith('/'));
  let js=source;
  for(const src of scriptRefs){
    const file=path.join(SITE,src.slice(1));
    if(await exists(file))js+='\n'+await readFile(file,'utf8');
    else error(page,'Missing script '+src);
  }
  inventory.pages++;
  for(const match of matches(source,/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const attrs=match[1],href=getAttr(attrs,'href'),id=getAttr(attrs,'id'),label=labels(match[2]);
    inventory.links++;
    if(href===null||!href.trim()){error(page,'Link missing href: '+label);continue;}
    if(href==='#'){
      const allowed=allowedClickPlaceholders.get(path.basename(page));
      if(!id||!allowed?.has(id)||!js.includes(id)||!js.includes('addEventListener')){
        error(page,'Unbound placeholder link '+(id||label));
      }
      continue;
    }
    await checkDestination(page,href,ids);
  }
  for(const match of matches(source,/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi)){
    inventory.buttons++;
    const attrs=match[1],id=getAttr(attrs,'id'),type=getAttr(attrs,'type'),label=labels(match[2]);
    if(type==='submit')continue;
    if(id&&js.includes(id))continue;
    const dataAttrs=matches(attrs,/\bdata-[a-z0-9-]+/gi).map(x=>x[0]);
    if(dataAttrs.some(x=>js.includes(x)))continue;
    if(/\bonclick\s*=/.test(attrs))continue;
    error(page,'Button has no evidenced handler: '+(id||label));
  }
  pages.push(path.relative(SITE,page));
}
assert.equal(inventory.pages,24,'Expected all 24 current site pages in the audit; update inventory when adding routes');
if(errors.length){
  console.error('Navigation audit found '+errors.length+' issue(s) in '+inventory.pages+' pages:');
  for(const item of errors)console.error('- '+item);
  process.exit(1);
}
console.log('PASS: '+inventory.pages+' pages, '+inventory.links+' links, '+inventory.buttons+' buttons. All static destinations resolve and no unbound control was found.');
