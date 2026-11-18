// Transactional, mail-client-safe EWO / Four Realms templates.
// Keep invitation and ticket tokens private: never include them in image URLs,
// CSS URLs, analytics calls, or third-party tracking parameters.
const ART_BASE = 'https://enterwildones.com/assets/images/realms/';
const SAFE_REALMS = new Set(['aureva', 'halora', 'sunveil', 'nocturne']);
const GOLD = '#e8ca89';

export function escapeEmailHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function invitationRedemptionUrl(site, code) {
  const origin = new URL(String(site));
  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') {
    throw new Error('An HTTPS invitation origin is required.');
  }
  const url = new URL('/invite', origin);
  url.searchParams.set('code', String(code).trim().toUpperCase());
  return url.toString();
}

export function invitationExpiry(expiresAt, timezone = 'Pacific/Honolulu') {
  const when = new Date(expiresAt);
  if (!Number.isFinite(when.getTime())) throw new Error('Invalid invitation expiry.');
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).format(when);
  return formatted + (timezone === 'Pacific/Honolulu' ? ' HST' : '');
}

function layout({ event, preview, title, introduction, content, support }) {
  const slug = SAFE_REALMS.has(String(event?.slug)) ? event.slug : 'enter-wild-ones';
  const logo = ART_BASE + slug + '-1200.webp';
  const brand = escapeEmailHtml(event?.name || 'ENTER WILD ONES');
  const eyebrow = escapeEmailHtml(event?.copy?.eyebrow || 'THE FOUR REALMS');
  const help = escapeEmailHtml(support || 'help@enterwildones.com');
  const safeTitle = escapeEmailHtml(title);
  const safePreview = escapeEmailHtml(preview);
  const safeIntro = escapeEmailHtml(introduction);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${safeTitle}</title>
<style>
@media screen and (max-width:620px) {
  .mail-shell{width:100%!important}
  .mail-inner{padding:24px 20px!important}
  .mail-title{font-size:29px!important;line-height:1.17!important}
  .mail-cta{display:block!important;text-align:center!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:#07080b;color:#f5ead5;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${safePreview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#07080b;width:100%">
<tr><td align="center" style="padding:30px 12px">
<table class="mail-shell" role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:600px;background:#101115;border:1px solid #4b412c;border-radius:18px">
<tr><td align="center" class="mail-inner" style="padding:38px 38px 22px">
<div style="font-size:11px;font-weight:800;letter-spacing:4px;color:${GOLD};text-transform:uppercase">ENTER WILD ONES</div>
<div style="padding:8px 0 0"><img src="https://enterwildones.com/assets/images/brand/enter-wild-ones-email.png" width="180" alt="Enter Wild Ones" style="width:180px;max-width:100%;height:auto;border:0;display:block" /></div>
<div style="padding:15px 0 6px"><img src="${logo}" alt="${brand} event logo" width="300" style="display:block;max-width:100%;height:auto;width:300px;border:0" /></div>
<div style="font-size:11px;letter-spacing:3px;color:#d9c396;font-weight:700;text-transform:uppercase">${eyebrow}</div>
</td></tr>
<tr><td style="padding:0 30px"><div style="border-top:1px solid #5d5037;height:1px;font-size:1px">&nbsp;</div></td></tr>
<tr><td class="mail-inner" style="padding:28px 38px 40px">
<h1 class="mail-title" style="color:#f5dda4;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1.15;font-weight:400;letter-spacing:.2px;margin:0 0 19px">${safeTitle}</h1>
<p style="color:#e9e4d9;font-size:16px;line-height:1.7;margin:0 0 23px">${safeIntro}</p>
${content}
</td></tr>
<tr><td style="padding:0 38px"><div style="border-top:1px solid #4b412c;height:1px;font-size:1px">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:22px 25px 30px;color:#ada89c;font-size:12px;line-height:1.8">
WILD ONES LLC &nbsp;·&nbsp; THE FOUR REALMS<br />
Need assistance? <a href="mailto:${help}" style="color:${GOLD};text-decoration:underline">${help}</a>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function pill(label, value) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #5c4d2e;background:#171715;border-radius:12px;margin:0 0 20px">
  <tr><td style="padding:17px 21px">
  <div style="color:#c5b488;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${escapeEmailHtml(label)}</div>
  <div style="margin-top:8px;color:#ffe2a3;font-size:22px;font-family:Courier New,monospace;font-weight:700;letter-spacing:1px;word-break:break-all">${escapeEmailHtml(value)}</div>
  </td></tr></table>`;
}

function actionButton(href, text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px"><tr><td align="center" style="background:#e7cb8e;border-radius:30px">
<a class="mail-cta" href="${escapeEmailHtml(href)}" style="display:block;padding:18px 20px;border-radius:30px;color:#11100b;background:#e7cb8e;text-decoration:none;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase">${escapeEmailHtml(text)}</a>
</td></tr></table>`;
}

export function renderInvitationEmail({ event, name, code, expiresAt, site, support }) {
  const redeemUrl = invitationRedemptionUrl(site, code);
  const expiry = invitationExpiry(expiresAt, event?.timezone || 'Pacific/Honolulu');
  const safeName = escapeEmailHtml(name || 'Wild One');
  const title = 'Your Invitation Is Ready';
  const body = `
<p style="color:#e5dfd5;font-size:16px;line-height:1.7;margin:0 0 21px"><strong style="color:#f7e7bf">Aloha ${safeName},</strong><br />Your access request for <strong style="color:#f3d894">${escapeEmailHtml(event?.name || 'this realm')}</strong> has been approved. The gate is yours to open.</p>
${pill('YOUR PRIVATE INVITATION CODE', code)}
${actionButton(redeemUrl, 'Redeem Your Invitation')}
<p style="color:#d8d0c1;font-size:14px;line-height:1.7;margin:0 0 15px"><strong style="color:#e9cd90">Expires:</strong> ${escapeEmailHtml(expiry)}</p>
<p style="color:#bdb6ac;font-size:13px;line-height:1.75;margin:0">This one-time invitation is linked to your approved profile. The button automatically fills in your invitation code; you'll confirm redemption on the secure website. Keep your code and link private.</p>`;
  const html = layout({ event, title, preview: `${event.name} access approved. Redeem your private invitation.`, introduction: 'Your realm awaits. Your private access is ready.', content: body, support });
  const text = [
    `Aloha ${name || 'Wild One'},`, '',
    `Your access request for ${event.name} has been approved.`, '',
    `Your invitation code: ${code}`,
    `Redeem your invitation (code automatically filled in): ${redeemUrl}`,
    `Expires: ${expiry}`, '',
    'Your invitation is tied to your approved profile and can only be redeemed once. Keep this code and link private.',
    `Support: ${support || 'help@enterwildones.com'}`
  ].join('\n');
  return { html, text, redeemUrl, subject: `${event.name} · Your Invitation Is Ready` };
}

function money(cents) {
  return 'USD ' + (Number(cents || 0) / 100).toFixed(2);
}

export function renderTicketEmail({ event, name, ticket, payment, ticketUrl, support }) {
  const items = [
    { label: 'Admission · ' + (ticket.ticketTierName || 'General'), amount: Number(payment?.admissionPriceCents ?? ticket.ticketPriceCents ?? 0) },
    ...(Array.isArray(payment?.selectedAddons) ? payment.selectedAddons : []).map(x => ({
      label: x.name + (x.addonType === 'drink_package' ? ` · ${x.credits} credits` :
        x.departureTime ? ` · until ${x.departureTime} HST` : ''),
      amount: Number(x.priceCents || 0)
    }))
  ];
  const total = Number(payment?.amountTotal ?? ticket.ticketPriceCents ?? 0);
  const rows = items.map(item => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #39352d;color:#e4ded2;font-size:14px;line-height:1.5">${escapeEmailHtml(item.label)}</td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid #39352d;color:#f3da9d;white-space:nowrap;font-size:14px">${escapeEmailHtml(money(item.amount))}</td>
  </tr>`).join('');
  const content = `
<p style="margin:0 0 20px;color:#e2ddd4;font-size:16px;line-height:1.7"><strong style="color:#f7e3b4">Aloha ${escapeEmailHtml(name || 'Wild One')},</strong><br />Your ${escapeEmailHtml(event.name)} admission is confirmed. Your upgrades are part of the same credential.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-top:1px solid #75623f">${rows}
<tr><td style="padding:17px 0;color:#f1d7a0;font-weight:700;font-size:16px">TOTAL PAID</td><td align="right" style="padding:17px 0;color:#ffe6a8;font-weight:800;font-size:20px">${escapeEmailHtml(payment ? money(total) : 'COMPLIMENTARY')}</td></tr></table>
${pill('DIGITAL TICKET ID', ticket.ticketId)}
${actionButton(ticketUrl, 'Open Your Digital Ticket')}
<p style="color:#bdb6ac;font-size:13px;line-height:1.75;margin:0">Your ticket and selected add-ons are linked to one credential. Complete the participant waiver to unlock the entry QR code. This ticket link is private; do not forward it.</p>`;
  return layout({ event, title: 'Your Ticket Is Confirmed', preview: `${event.name} ticket confirmed. View your credential and included add-ons.`, introduction: 'Your place in the realm is secured.', content, support });
}
