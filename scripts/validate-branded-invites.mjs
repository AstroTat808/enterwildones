import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderInvitationEmail, renderTicketEmail, invitationRedemptionUrl, invitationExpiry, escapeEmailHtml } from '../netlify/functions/_mail-templates.mjs';
import { walletAddonFields } from '../netlify/functions/_apple-wallet.mjs';

const event = {
  eventId: 'aureva-2026',
  name: 'AUREVA',
  slug: 'aureva',
  timezone: 'Pacific/Honolulu',
  copy: { eyebrow: 'Realm I · Light' }
};
const code = 'AUR-ABCD-EFGH-JKLM';
const site = 'https://enterwildones-staging.netlify.app';
const message = renderInvitationEmail({
  event, name: 'Guest <script>alert(1)</script>',
  code, expiresAt: '2026-12-18T09:37:48-10:00', site,
  support: 'help@enterwildones.com'
});

assert.equal(new URL(message.redeemUrl).origin, site);
assert.equal(new URL(message.redeemUrl).pathname, '/invite');
assert.equal(new URL(message.redeemUrl).searchParams.get('code'), code);
assert.match(message.html, /AUREVA/);
assert.match(message.html, /Realm I/);
assert.match(message.html, /assets\/images\/realms\/aureva-1200\.webp/);
assert.match(message.html, /background:#e7cb8e/);
assert.match(message.html, /Redeem Your Invitation/);
assert.match(message.html, /aria|role="presentation"/);
assert.match(message.html, /AUR-ABCD-EFGH-JKLM/);
assert.ok(message.html.includes('href="' + message.redeemUrl + '"'));
assert.match(message.text, /invite\?code=AUR-ABCD-EFGH-JKLM/);
assert.match(message.text, /HST/);
assert.match(message.subject, /AUREVA/);
assert.ok(!message.html.includes('<script>alert(1)</script>'), 'Untrusted guest name must be escaped');
assert.match(message.html, /Guest &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(escapeEmailHtml('"&<'), /&quot;&amp;&lt;/);
assert.equal(invitationRedemptionUrl(site + '/', code), site + '/invite?code=' + code);
assert.match(invitationExpiry('2026-12-18T09:37:48-10:00'), /December 18, 2026/);
assert.throws(() => invitationRedemptionUrl('http://attacker.example', code), /HTTPS/);

const textTicket = {
  ticketId: 'AUR-TEST-TICKET',
  ticketTierName: 'FIRST LIGHT RELEASE',
  ticketPriceCents: 5500
};
const payment = {
  amountTotal: 15500,
  admissionPriceCents: 5500,
  selectedAddons: [
    { addonType:'drink_package', name:'Drink Package', priceCents:7500, credits:6 },
    { addonType:'late_stay', name:'Late Checkout / Car Camping', priceCents:2500, departureTime:'10:00 AM' }
  ]
};
const htmlTicket = renderTicketEmail({
  event, name:'Chris & Shaun', ticket:textTicket, payment,
  ticketUrl:site + '/ticket?token=example-test-token', support:'help@enterwildones.com'
});
assert.match(htmlTicket, /FIRST LIGHT RELEASE/);
assert.match(htmlTicket, /Drink Package/);
assert.match(htmlTicket, /6 credits/);
assert.match(htmlTicket, /Late Checkout \/ Car Camping/);
assert.match(htmlTicket, /10:00 AM/);
for(const price of ['USD 55.00','USD 75.00','USD 25.00','USD 155.00'])
  assert.ok(htmlTicket.includes(price), 'Combined receipt missing '+ price);
assert.match(htmlTicket, /Open Your Digital Ticket/);
assert.match(htmlTicket, /https:\/\/enterwildones-staging.netlify.app\/ticket\?token=example-test-token/);

const walletItems = walletAddonFields([
  { addonType:'drink_package', status:'active', creditsPurchased:6, creditsRemaining:4 },
  { addonType:'late_stay', status:'active', departureTime:'10:00 AM' }
]);
assert.equal(walletItems.auxiliary.length, 2);
assert.deepEqual(walletItems.auxiliary.map(x=>x.key), ['drinkCredits','lateStay']);
assert.match(walletItems.auxiliary[0].value, /4 of 6/);
assert.match(walletItems.auxiliary[1].value, /10:00 AM HST/);
assert.equal(walletItems.back.length, 2);
assert.equal(walletAddonFields([{addonType:'drink_package',status:'refunded',creditsPurchased:6}]).auxiliary.length, 0);
assert.equal(walletAddonFields([{addonType:'late_stay',status:'disputed',departureTime:'10:00 AM'}]).auxiliary.length, 0);
assert.equal(walletAddonFields([{addonType:'drink_package',status:'active',creditsPurchased:6,creditsRemaining:7}]).auxiliary.length, 0);

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [admin, service, client, markup, headers, walletEndpoint] = await Promise.all([
  'netlify/functions/admin-applications.mjs',
  'netlify/functions/_email-service.mjs',
  'site/assets/js/invite.js',
  'site/invite.html',
  'netlify.toml',
  'netlify/functions/ticket-wallet.mjs'
].map(read));
assert.match(admin, /renderInvitationEmail/);
assert.match(admin, /html: message\.html/);
assert.match(service, /html = null/);
assert.match(service, /\.\.\.\(html \? \{ html \} : \{\}\)/);
assert.match(service, /renderTicketEmail/);
assert.match(client, /searchParams\.get\('code'\)/);
assert.match(client, /codeField\.value = normalized/);
assert.match(client, /history\.replaceState/);
assert.match(client, /form\.addEventListener\('submit'/);
assert.ok(client.indexOf("searchParams.get('code')") < client.indexOf("form.addEventListener('submit'"));
assert.ok(!/form\.requestSubmit\(/.test(client), 'Mail link scanners must never automatically redeem a code');
assert.match(markup, /meta name="referrer" content="no-referrer"/);
assert.match(headers, /for = "\/invite\*"/);
assert.match(headers, /Referrer-Policy = "no-referrer"/);
assert.match(walletEndpoint, /activeAddons/);
assert.match(walletEndpoint, /addOns:activeAddons/);
assert.match(walletEndpoint, /\['drink_package','late_stay'\]/);

console.log('Branded, privacy-preserving auto-fill invitations and bundled ticket receipt templates validated.');
