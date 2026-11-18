import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderInvitationEmail, renderTicketEmail, renderBrandedNoticeEmail, invitationRedemptionUrl, invitationExpiry, escapeEmailHtml } from '../netlify/functions/_mail-templates.mjs';
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
assert.match(message.html, /assets\/images\/brand\/enter-wild-ones-email\.png/);
const png = await readFile(new URL('../site/assets/images/brand/enter-wild-ones-email.png', import.meta.url));
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Email brand logo must be a real PNG for legacy mail clients');

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


const notice = renderBrandedNoticeEmail({
  event, name: 'Wild <One>',
  title: 'Your Digital Ticket Is Ready',
  subject: 'AUREVA: your digital ticket',
  preview: 'Private digital ticket.',
  introduction: 'The realm is waiting.',
  message: 'Use your secure credential below.',
  actionUrl: site + '/ticket?token=private-sample',
  actionLabel: 'Open Digital Ticket',
  details: [{ label: 'Status', value: '<paid & active>' }],
  note: 'Never forward your ticket.',
  support: 'help@enterwildones.com'
});
assert.match(notice.html, /assets\/images\/brand\/enter-wild-ones-email\.png/);
assert.match(notice.html, /aureva-1200\.webp/);
assert.match(notice.html, /@media screen and \(max-width:620px\)/);
assert.match(notice.html, /Open Digital Ticket/);
assert.ok(notice.html.includes('href="' + site + '/ticket?token=private-sample"'));
assert.match(notice.html, /Wild &lt;One&gt;/);
assert.match(notice.html, /&lt;paid &amp; active&gt;/);
assert.ok(!notice.html.includes('src="' + site + '/ticket?token='), 'Private tokens must never appear in remote asset URLs.');
assert.match(notice.text, /private-sample/);
assert.throws(() => renderBrandedNoticeEmail({ title: 'Unsafe', subject: 'Unsafe', actionUrl: 'javascript:alert(1)' }), /secure transactional action URL/);
const [scheduler, operations, applicationNotice, mailService, applyMarkup, inviteMarkup, addonsMarkup, passportConfirmation, addonsJs, successStyles] =
  await Promise.all([
    'netlify/functions/aureva-email-scheduler.mjs',
    'netlify/functions/admin-operations.mjs',
    'netlify/functions/apply.mjs',
    'netlify/functions/_email-service.mjs',
    'site/apply.html',
    'site/invite.html',
    'site/ticket-addons.html',
    'site/passport-check-email.html',
    'site/assets/js/ticket-addons.js',
    'site/assets/css/transactional-success.css'
  ].map(read));
for (const [name, contents] of [
  ['scheduled reminders', scheduler],
  ['admin operations', operations],
  ['application notifications', applicationNotice],
  ['delivery alerts', mailService]
]) {
  assert.match(contents, /renderBrandedNoticeEmail/, name + ' must use branded email.');
  assert.match(contents, /html:\s*mail\.html/, name + ' must include HTML delivery payload.');
  assert.match(contents, /text:\s*mail\.text/, name + ' must preserve text fallback.');
}
assert.match(operations, /renderInvitationEmail/, 'Reissued invitations must share the approved invitation template.');
assert.match(operations, /invitation_reissue/, 'Invite audit and idempotency kind must remain intact.');
assert.match(scheduler, /marketingOptIn === false/, 'Unpaid invitation reminder opt-in gate must remain.');
assert.match(scheduler, /if \(event\.ticketSalesOpen\)/, 'Unpaid invite reminders must respect sales state.');
assert.match(scheduler, /waiverMissing/, 'Waiver warning must be preserved.');
assert.match(mailService, /TERMINAL_FAILURES/, 'Delivery-alert suppression and escalation boundaries must remain.');
for (const [name, markup, id] of [
  ['access request', applyMarkup, 'success'],
  ['invite redemption', inviteMarkup, 'granted'],
  ['add-on return', addonsMarkup, 'addon-confirmation'],
  ['Passport email confirmation', passportConfirmation, 'confirmation-title']
]) {
  assert.ok(markup.includes('id="' + id + '"'), name + ' success panel missing.');
  assert.ok(markup.includes('/assets/css/transactional-success.css'), name + ' must load shared styles.');
  assert.ok(markup.includes('tx-success-panel'), name + ' must use shared success card.');
  assert.ok(markup.includes('tx-success-mark'), name + ' must display a confirmation mark.');
}
assert.match(addonsJs, /d\.addons\.some\(a=>a\.purchased\)/, 'Add-on confirmation must be gated on server-reported ownership.');
assert.match(addonsJs, /searchParams\.delete\('addon'\)/, 'Return marker must be cleared after loading.');
assert.match(successStyles, /@media\(max-width:600px\)/, 'Success cards must adapt to small phones.');
console.log('Branded guest, admin and reminder email plus shared success-state regression checks passed.');

console.log('Branded, privacy-preserving auto-fill invitations and bundled ticket receipt templates validated.');
