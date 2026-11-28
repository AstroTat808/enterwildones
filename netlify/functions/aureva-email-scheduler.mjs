import { waiverGate } from './_waiver-evidence.mjs';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { renderBrandedNoticeEmail } from './_mail-templates.mjs';
import { getEvent } from './_events.mjs';
import { pendingReceiptRetries, sendTicketReceipt, trackedEmail } from './_email-service.mjs';
import { makeTicketToken } from './_ticket-token.mjs';
import { STORES, eventKey } from './_stores.mjs';

const EVENT_ID = 'aureva-2026';
const MAX_EMAILS_PER_RUN = 25;
const DAY = 24 * 60 * 60 * 1000;

async function listRecords(storeName) {
  const store = blobStore(storeName);
  const listed = await store.list({ prefix: EVENT_ID + '/' });
  const rows = [];
  for (const { key } of listed.blobs || []) {
    const row = await store.get(key, { type: 'json' }).catch(() => null);
    if (row?.eventId === EVENT_ID) rows.push(row);
  }
  return rows;
}

function validTime(start, now) {
  return Number.isFinite(start) && now < start && now >= start - 90 * DAY;
}
function isValidInvite(invite, now) {
  return Boolean(
    invite && ['active', 'redeemed'].includes(invite.status) &&
    !invite.revokedAt && Number(invite.purchaseCount || 0) === 0 &&
    (!invite.expiresAt || Date.parse(invite.expiresAt) > now)
  );
}
async function processReminders() {
  const event = getEvent(EVENT_ID);
  const now = Date.now();
  const start = Date.parse(event?.startsAt || '');
  if (!event || !validTime(start, now)) return { skipped: 'outside_event_window' };
  let sent = 0, failed = 0, skipped = 0;
  const [apps, invites, tickets] = await Promise.all([
    listRecords(STORES.applications), listRecords(STORES.invitations), listRecords(STORES.tickets)
  ]);
  const appMap = new Map(apps.map((a) => [a.applicationId, a]));
  const activeTickets = new Set(tickets.filter((t) => ['paid', 'checked_in'].includes(t.status)).flatMap((t) => [t.userId, t.invitationId].filter(Boolean)));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const site = (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '');

  // Payment CTAs are forbidden while ticket sales are closed.
  if (event.ticketSalesOpen) {
    for (const invite of invites) {
      if (sent + failed >= MAX_EMAILS_PER_RUN) break;
      if (!isValidInvite(invite, now) || activeTickets.has(invite.userId) || activeTickets.has(invite.invitationId)) continue;
      const app = appMap.get(invite.applicationId);
      if (!app?.email || app.marketingOptIn === false) { skipped++; continue; }
      // Reminder references an existing invitation, but never stores or reissues a raw code.
      const mail = renderBrandedNoticeEmail({
        event,
        name: app.preferredName || app.fullName || 'Wild One',
        title: 'Your Invitation Is Waiting',
        subject: 'AUREVA: your approved invitation is awaiting checkout',
        preview: 'Your private AUREVA invitation is approved. Complete admission checkout when you are ready.',
        introduction: 'Your place in the realm is waiting.',
        message: 'Your approved AUREVA invitation is still awaiting admission checkout. Use your existing private invitation code to continue.',
        actionUrl: site + '/invite',
        actionLabel: 'Redeem Your Invitation',
        details: [
          { label: 'First Light', value: '$55 until January 9, 2027 at 11:59 PM HST' },
          { label: 'Full Radiance', value: '$70 from January 10, 2027' }
        ],
        note: 'If you have already purchased, no action is needed. If your code has expired, contact support. We never reissue a private code in a reminder.',
        support: env('WILDONES_HELP_EMAIL', 'help@enterwildones.com')
      });
      const result = await trackedEmail({
        eventId: EVENT_ID, kind: 'unpaid_invitation_reminder', sourceId: invite.invitationId,
        key: 'wildones-unpaid-' + invite.invitationId + '-' + today,
        to: app.email, subject: mail.subject, text: mail.text, html: mail.html
      });
      if (result.sent && !result.alreadyAccepted) sent++;
      else if (!result.sent) failed++;
      else skipped++;
    }
  }

  // Pre-event reminders go to paid ticket holders only. Never reveal the venue publicly.
  const hoursBefore = (start - now) / 3600000;
  const reminderKind = hoursBefore > 24 && hoursBefore <= 72 ? '72h' :
    hoursBefore > 0 && hoursBefore <= 24 ? '24h' : null;
  if (reminderKind) {
    for (const ticket of tickets) {
      if (sent + failed >= MAX_EMAILS_PER_RUN) break;
      if (!['paid', 'checked_in'].includes(ticket.status)) continue;
      const app = appMap.get(ticket.applicationId);
      if (!app?.email) { skipped++; continue; }
      const token = makeTicketToken(ticket);
      if (!token) { skipped++; continue; }
      const url = site + '/ticket?token=' + encodeURIComponent(token);
      const waiverMissing = !(await waiverGate(ticket)).ready;
      const mail = renderBrandedNoticeEmail({
        event,
        name: app.preferredName || app.fullName || 'Wild One',
        title: reminderKind === '24h' ? 'Tomorrow Is Your Night' : 'The Realm Is Approaching',
        subject: 'AUREVA: ' + (reminderKind === '24h' ? 'tomorrow is your night' : 'your event is approaching'),
        preview: 'Your AUREVA admission reminder. Open your private digital ticket.',
        introduction: 'The countdown to AUREVA continues.',
        message: 'AUREVA runs Saturday, January 23, 2027 at 7 PM through Sunday, January 24 at 3 AM HST. Optional late checkout is until Sunday at 10 AM.',
        actionUrl: url,
        actionLabel: waiverMissing ? 'Open Ticket & Sign Waiver' : 'Open Your Digital Ticket',
        note: (waiverMissing ? 'IMPORTANT: Sign the required waiver to unlock your entry QR. ' : 'Have your digital ticket ready for check-in. ') +
          'Keep the ticket link private. Venue details are available only through authorized ticket access.',
        support: env('WILDONES_HELP_EMAIL', 'help@enterwildones.com')
      });
      const result = await trackedEmail({
        eventId: EVENT_ID, kind: 'event_reminder', sourceId: ticket.ticketId,
        key: 'wildones-event-' + EVENT_ID + '-' + ticket.ticketId + '-' + reminderKind,
        to: app.email, subject: mail.subject, text: mail.text, html: mail.html
      });
      if (result.sent && !result.alreadyAccepted) sent++;
      else if (!result.sent) failed++;
      else skipped++;
    }
  }

  // API-level receipt retries: never re-charge, reissue or duplicate tickets.
  for (const ticketId of await pendingReceiptRetries(EVENT_ID, Math.max(0, MAX_EMAILS_PER_RUN - sent - failed))) {
    if (sent + failed >= MAX_EMAILS_PER_RUN) break;
    const result = await sendTicketReceipt(EVENT_ID, ticketId);
    if (result.sent && !result.alreadyAccepted) sent++;
    else if (!result.sent) failed++;
    else skipped++;
  }
  return { sent, failed, skipped, eventId: EVENT_ID };
}

// Netlify invokes this on the scheduler's UTC cron, not via an unauthenticated public URL.
export default async () => {
  if (env('WILDONES_EMAIL_AUTOMATION_ENABLED') !== 'true')
    return new Response('AUREVA email automation is disabled', { status: 200 });
  try {
    const outcome = await processReminders();
    return new Response(JSON.stringify(outcome), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('AUREVA email scheduler failed:', String(error?.message || error).slice(0, 150));
    return new Response('Scheduler failed', { status: 503 });
  }
};
export const config = { schedule: '15 23 * * *' };
