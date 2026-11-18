import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [client,styles,passport,access,checkout,inventory] = await Promise.all([
  'site/assets/js/passport.js',
  'site/assets/css/passport-card-polish.css',
  'netlify/functions/passport.mjs',
  'netlify/functions/passport-ticket-access.mjs',
  'netlify/functions/create-checkout.mjs',
  'netlify/functions/_admission-inventory.mjs'
].map(read));

const beginning=client.indexOf('  function credentialActions(x,link){');
const ending=client.indexOf("  function render(selected='cycle'){",beginning);
assert.ok(beginning>0&&ending>beginning,'The production card action renderer must be discoverable.');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const scope={esc:escapeHtml};
runInNewContext(client.slice(beginning,ending),scope);
const render=scope.credentialActions;
assert.equal(typeof render,'function');

const event={name:'AUREVA',slug:'aureva',routes:{event:'/events/aureva'}};
const invited={event,application:{status:'approved'},invitation:{status:'redeemed'},ticket:null};
const link='/events/aureva';
const open=render({...invited,purchaseAvailable:true},link);
assert.match(open, /data-purchase-event="aureva"/);
assert.match(open, /aria-label="Purchase AUREVA ticket"/);
assert.match(open, /Purchase Ticket/);
assert.match(open, /Explore the Realm/);
assert.match(open, /optional add-ons together/);
assert.doesNotMatch(open, /disabled aria-disabled=/);

const closed=render({...invited,purchaseAvailable:false},link);
assert.match(closed, /class="button passport-purchase-cta" disabled aria-disabled="true"/);
assert.match(closed, /aria-describedby="passport-purchase-help-aureva"/);
assert.match(closed, /Ticket sales have not opened yet/);
assert.match(closed, /redeemed invitation is saved/);
assert.match(closed, /Explore the Realm/);
assert.doesNotMatch(closed, /data-purchase-event=/,'Closed sales must never expose an active purchase action.');
assert.doesNotMatch(render({...invited,purchaseAvailable:'true'},link),/data-purchase-event=/,
  'Only the explicit authenticated boolean can unlock the purchase action.');

const purchased=render({...invited,purchaseAvailable:true,ticket:{status:'paid'}},'/ticket?token=signed-sample');
assert.match(purchased, /Open Digital Ticket/);
assert.match(purchased, /href="\/ticket\?token=signed-sample"/);
assert.match(purchased, /Explore the Realm/);
assert.doesNotMatch(purchased, /Purchase Ticket/);
const checkedIn=render({...invited,purchaseAvailable:false,ticket:{status:'checked_in'}},'/ticket?token=signed-sample');
assert.match(checkedIn, /Open Digital Ticket/);
const refunded=render({...invited,purchaseAvailable:true,ticket:{status:'refunded'}},link);
assert.doesNotMatch(refunded, /Purchase Ticket|Open Digital Ticket/,
  'A refunded ticket must not silently enable new admission.');
const notRedeemed=render({...invited,invitation:{status:'active'},purchaseAvailable:true},link);
assert.doesNotMatch(notRedeemed, /Purchase Ticket/,
  'An unredeemed invitation cannot unlock Checkout on the Passport.');

const malicious=render({
  ...invited,purchaseAvailable:true,
  event:{...event,slug:'aureva" onclick="alert(1)',name:'AUREVA <one>'}
},link);
assert.match(malicious, /aureva&amp;quot;|aureva&quot;/);
assert.doesNotMatch(malicious, /data-purchase-event="aureva" onclick=/);
assert.match(malicious, /AUREVA &lt;one&gt;/);

assert.match(client, /fetch\('\/api\/passport\/ticket-access'/);
assert.match(client, /credentials:'same-origin'/);
assert.match(client, /button\.disabled=true/);
assert.match(client, /\.querySelector\('\.passport-purchase-message'\)/);
assert.match(client, /role="status" aria-live="polite"/);
assert.ok(client.indexOf("if(x.invitation&&x.invitation.status==='redeemed')")
  < client.indexOf("if(x.application)return"),
  'Redeemed invitation must take precedence over merely approved application status.');

for(const invariant of [
  'readPassportSession','findRedeemedInvitationForUser','checkoutAllowed',
  'sameOrigin','createInvitationAccess','inviteAccessCookie','maxTickets','purchaseCount'
]) assert.ok(access.includes(invariant),'Auth-gated Passport checkout lost: '+invariant);
assert.match(passport, /purchaseAvailable=Boolean\(!ticket&&invitation/);
assert.match(passport, /checkoutAllowed\(event,invitation,user\.email,application\?\.email\)/);
assert.match(checkout, /if\s*\(!checkoutAllowed\(event,\s*invitation,\s*trustedEmail\)\)/);
assert.match(checkout, /await reserveAdmission\(/);
assert.match(inventory, /INVENTORY_NOT_COMMISSIONED/);
assert.match(styles, /passport-card-actions--purchase|passport-purchase-cta/);
assert.match(styles, /passport-purchase-cta:disabled/);
assert.match(styles, /@media \(max-width:560px\)/);
assert.match(styles, /prefers-reduced-motion/);
console.log('Passport purchase CTA: eligible, locked, paid, refunded, invalid invitation, accessibility and safety checks passed.');
