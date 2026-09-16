import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {realmArtwork,realmLogo} from '../netlify/functions/_branding.mjs';

const read=p=>fs.readFileSync(p,'utf8');
const names=['aureva','halora','sunveil','nocturne','enter-wild-ones'];
const expectedBytes={
  'aureva':163428,
  'halora':180504,
  'sunveil':261632,
  'nocturne':226092,
  'enter-wild-ones':284686
};

function validateWebp(name){
  const file=`site/assets/images/realms/${name}-1200.webp`;
  const bytes=fs.readFileSync(file);
  assert.equal(bytes.length,expectedBytes[name],`${name} WebP size`);
  assert.equal(bytes.subarray(0,4).toString('ascii'),'RIFF',`${name} WebP RIFF signature`);
  assert.equal(bytes.subarray(8,12).toString('ascii'),'WEBP',`${name} WebP container signature`);
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length,`${name} WebP RIFF length`);
}
for(const name of names)validateWebp(name);

const branding=read('site/assets/js/branding.js');
assert(branding.includes('/assets/images/realms/${realms[valid(realm)].slug}-1200.webp'));
for(const key of ['../secret','toString','<script>'])assert.equal(realmArtwork(key),'/assets/images/realms/enter-wild-ones-1200.webp');
assert(realmLogo({realm:'night'}).includes('/nocturne-1200.webp'));
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
console.log('Verified all five optimized realm WebP lockups, responsive branding routes, form contract and preserved private ticket gates.');
