import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {realmArtwork,realmLogo} from '../netlify/functions/_branding.mjs';

const read=p=>fs.readFileSync(p,'utf8');
const names=['aureva','halora','sunveil','nocturne','enter-wild-ones'];
const pngSignature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function validateEmbeddedPng(name,svg){
  const match=svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  assert(match,`${name} embeds browser-safe transparent PNG artwork`);
  const png=Buffer.from(match[1],'base64');
  assert(png.length>1000,`${name} embedded PNG is non-empty`);
  assert(png.subarray(0,8).equals(pngSignature),`${name} embedded PNG has a valid signature`);

  let offset=8;
  let sawIHDR=false;
  let sawIEND=false;
  while(offset<png.length){
    assert(offset+12<=png.length,`${name} PNG chunk header is not truncated`);
    const length=png.readUInt32BE(offset);
    const type=png.subarray(offset+4,offset+8).toString('ascii');
    const next=offset+12+length;
    assert(next<=png.length,`${name} PNG ${type} chunk is not truncated`);
    if(type==='IHDR'){
      assert.equal(length,13,`${name} PNG IHDR length`);
      const width=png.readUInt32BE(offset+8);
      const height=png.readUInt32BE(offset+12);
      assert(width>=384&&height>=384,`${name} PNG has sufficient intrinsic resolution`);
      sawIHDR=true;
    }
    offset=next;
    if(type==='IEND'){
      assert.equal(length,0,`${name} PNG IEND length`);
      sawIEND=true;
      assert.equal(offset,png.length,`${name} PNG has no trailing bytes after IEND`);
      break;
    }
  }
  assert(sawIHDR,`${name} PNG includes IHDR`);
  assert(sawIEND,`${name} PNG includes IEND`);
}

for(const name of names){
  const file=`site/assets/images/realms/${name}.svg`;
  const svg=read(file);
  assert(svg.startsWith('<svg'),`${name} is SVG`);
  assert(svg.length>5000&&svg.length<250000,`${name} optimized payload`);
  validateEmbeddedPng(name,svg);
}

const branding=read('site/assets/js/branding.js');
assert(branding.includes('/assets/images/realms/${realms[valid(realm)].slug}.svg'));
for(const key of ['../secret','toString','<script>'])assert.equal(realmArtwork(key),'/assets/images/realms/enter-wild-ones.svg');
assert(realmLogo({realm:'night'}).includes('/nocturne.svg'));
for(const page of ['index','event','apply','passport','invite','ticket-access','ticket-addons','public-tickets','bar','check-in']){
  const html=read(`site/${page}.html`);assert(html.includes('/assets/css/branding.css'),page);assert(html.includes('viewport-fit=cover'),page);
  assert(html.includes('aria-label="Mobile navigation"'),page);
}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(dir,entry.name);
  return entry.isDirectory()?walk(file):[file];
});
for(const file of walk('site')){
  if(!/\.(?:html|css|js|json|svg)$/i.test(file))continue;
  assert(!read(file).includes('.avif'),`legacy AVIF reference remains in ${file}`);
}
const netlifyConfig=read('netlify.toml');
assert(!netlifyConfig.includes('/assets/images/realms/enter-wild-ones.avif'),'legacy master-logo rewrite removed');
assert(!netlifyConfig.includes('/assets/images/realms/aureva.avif'),'legacy AUREVA rewrite removed');
assert(!netlifyConfig.includes('/assets/images/realms/halora.avif'),'legacy HALORA rewrite removed');
assert(!netlifyConfig.includes('/assets/images/realms/sunveil.avif'),'legacy SUNVEIL rewrite removed');
assert(!netlifyConfig.includes('/assets/images/realms/nocturne.avif'),'legacy NOCTURNE rewrite removed');
for(const field of ['eventId','website','fullName','preferredName','email','phone','location','instagram','referral','community','whyAttend','groupNames','conductAck','selectionAck','privacyAck','marketingOptIn'])assert(read('site/apply.html').includes(`name="${field}"`),field);
assert(read('site/assets/js/apply.js').includes('!e.applicationOpen'));
assert(read('netlify/functions/ticket-view.mjs').includes('signed&&active?privateVenue'));
assert(read('netlify/functions/ticket-view.mjs').includes('active&&signed?'));
assert(read('site/assets/css/branding.css').includes('prefers-reduced-motion'));
assert(read('site/assets/js/public-tickets.js').includes('location.pathname'));
console.log('Verified all five realm SVG lockups, structurally complete embedded PNGs, no legacy AVIF references or rewrites, responsive branding routes, form contract and preserved private ticket gates.');
