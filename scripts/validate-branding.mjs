import assert from 'node:assert/strict';
import fs from 'node:fs';
import {realmArtwork,realmLogo} from '../netlify/functions/_branding.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const names=['aureva','halora','sunveil','nocturne','enter-wild-ones'];
for(const name of names){
  const path=`site/assets/images/realms/${name}.svg`;
  const svg=read(path);
  assert(svg.startsWith('<svg'),`${name} is SVG`);
  assert(svg.includes('data:image/avif;base64,'),`${name} embeds optimized transparent artwork`);
  assert(svg.length>5000&&svg.length<100000,`${name} optimized payload`);
}
const branding=read('site/assets/js/branding.js');
assert(branding.includes('/assets/images/realms/${realms[valid(realm)].slug}.svg'));
for(const key of ['../secret','toString','<script>'])assert.equal(realmArtwork(key),'/assets/images/realms/enter-wild-ones.svg');
assert(realmLogo({realm:'night'}).includes('/nocturne.svg'));
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
console.log('Verified all five supplied realm SVG lockups, responsive branding routes, form contract and preserved private ticket gates.');
