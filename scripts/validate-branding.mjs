import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {realmArtwork,realmLogo} from '../netlify/functions/_branding.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const names=['aureva','halora','sunveil','nocturne','enter-wild-ones'];
const manifest=JSON.parse(read('site/assets/images/realms/manifest.json'));
for(const name of names){
  const bytes=fs.readFileSync(`site/assets/images/realms/${name}.avif`);
  assert(bytes.includes(Buffer.from('avif')));assert(bytes.length>1000&&bytes.length<100000);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest[name].sha256);
  assert(read('site/index.html').includes(`/assets/images/realms/${name}.avif`));
}
for(const key of ['../secret','toString','<script>'])assert.equal(realmArtwork(key),'/assets/images/realms/enter-wild-ones.avif');
assert(realmLogo({realm:'night'}).includes('/nocturne.avif'));
for(const page of ['index','event','apply','passport','invite','ticket-access','ticket-addons','public-tickets','bar','check-in']){
  const html=read(`site/${page}.html`);assert(html.includes('/assets/css/branding.css'),page);assert(html.includes('viewport-fit=cover'),page);
  assert(html.includes('aria-label="Mobile navigation"'),page);
}
for(const field of ['eventId','website','fullName','preferredName','email','phone','location','instagram','referral','community','whyAttend','groupNames','conductAck','selectionAck','privacyAck','marketingOptIn'])assert(read('site/apply.html').includes(`name="${field}"`),field);
assert(read('site/assets/js/apply.js').includes('!e.applicationOpen'));
assert(read('netlify/functions/ticket-view.mjs').includes('signed&&active?privateVenue'));
assert(read('netlify/functions/ticket-view.mjs').includes('active&&signed?'));
assert(read('site/assets/css/branding.css').includes('prefers-reduced-motion'));
assert(read('site/assets/js/public-tickets.js').includes('location.pathname'));
console.log('Verified all five original asset hashes, responsive guest routes, form contract and preserved private ticket gates.');
