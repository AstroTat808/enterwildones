import { randomUUID } from 'node:crypto';
import { isAdmin } from './_admin-auth.mjs';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { getEvent, listEvents, toPublicEvent } from './_events.mjs';
import { createInvitation } from './_invitations.mjs';
import { existingTicketForUser, loadApplication, loadTicket } from './_payments.mjs';
import { makeTicketId, makeTicketToken } from './_ticket-token.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { stripePost } from './_stripe.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

const ACTIVE_TICKET = new Set(['paid', 'checked_in']);
const SAFE_INVITE = new Set(['active', 'redeemed', 'fulfilled', 'revoked']);

async function records(storeName, eventId) {
  const store = blobStore(storeName);
  const listed = await store.list({ prefix: `${eventId}/` });
  const out = [];
  for (const { key } of listed.blobs || []) {
    const value = await store.get(key, { type: 'json' }).catch(() => null);
    if (value?.eventId === eventId) out.push(value);
  }
  return out;
}
function invitationState(x) {
  if (x.revokedAt || x.status === 'revoked') return 'revoked';
  if (x.status === 'fulfilled' || Number(x.purchaseCount || 0) > 0) return 'fulfilled';
  if (x.redeemedAt || x.status === 'redeemed') return 'redeemed';
  if (x.expiresAt && new Date(x.expiresAt).getTime() <= Date.now()) return 'expired';
  return SAFE_INVITE.has(x.status) ? x.status : 'active';
}
function searchable(...parts) { return parts.filter(Boolean).join(' ').toLowerCase(); }
function csvCell(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function csvResponse(rows) {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="wild-ones-export.csv"', 'Cache-Control': 'no-store' } });
}
async function email({ to, subject, text, key }) {
  if (!env('RESEND_API_KEY') || !env('WILDONES_EMAIL_FROM') || !to) return { sent: false, reason: 'email_not_configured' };
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': String(key).slice(0, 256) }, body: JSON.stringify({ from: env('WILDONES_EMAIL_FROM'), to: [to], subject, text }) });
  if (!response.ok) return { sent: false, reason: `provider_${response.status}` };
  const data = await response.json().catch(() => ({}));
  return { sent: true, id: data.id || null };
}
async function sendInvite(event, application, code, invite) {
  const site = (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '');
  const name = application?.preferredName || application?.fullName || 'Wild Ones guest';
  return email({ to: application?.email || invite.email, subject: `${event.name}: your Wild Ones invitation`, key: `wildones-admin-invite-${invite.invitationId}`, text: [`${name},`, '', `Your ${event.name} invitation is ready.`, `Invitation code: ${code}`, `Redeem it here: ${site}/invite`, '', `This code expires ${invite.expiresAt}.`, 'Keep this invitation private.'].join('\n') });
}
async function sendTicketReminder(event, ticket, application, kind) {
  const token = makeTicketToken(ticket);
  if (!token) throw new Error('Ticket token could not be generated.');
  const site = (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '');
  const url = `${site}/ticket?token=${encodeURIComponent(token)}`;
  const name = application?.preferredName || application?.fullName || 'Wild Ones guest';
  const subject = kind === 'waiver' ? `${event.name}: sign your waiver before entry` : `${event.name}: your digital ticket`;
  const text = kind === 'waiver' ? [`${name},`, '', `Your ${event.name} admission is confirmed, but your QR remains locked until the required waiver is signed.`, `Open your ticket and sign now: ${url}`, '', 'Keep your ticket link private.'].join('\n') : [`${name},`, '', `Your ${event.name} digital ticket is ready.`, `Open it here: ${url}`, '', 'Keep your ticket link private.'].join('\n');
  return email({ to: application?.email, subject, text, key: `wildones-${kind}-${event.eventId}-${ticket.ticketId}-${new Date().toISOString().slice(0, 10)}` });
}
async function snapshot(eventId) {
  const [applications, invitations, tickets, payments, entitlements, checkins] = await Promise.all([
    records(STORES.applications, eventId), records(STORES.invitations, eventId), records(STORES.tickets, eventId), records(STORES.payments, eventId), records(STORES.entitlements, eventId), records(STORES.checkins, eventId)
  ]);
  const appById = new Map(applications.map((x) => [x.applicationId, x]));
  const paymentById = new Map(payments.filter((x) => x.paymentId).map((x) => [x.paymentId, x]));
  const hydratedInvitations = invitations.map((x) => { const app = appById.get(x.applicationId); return { invitationId: x.invitationId, applicationId: x.applicationId, userId: x.userId, email: x.email || app?.email || null, label: x.label, createdAt: x.createdAt, expiresAt: x.expiresAt, maxTickets: x.maxTickets, purchaseCount: x.purchaseCount || 0, redeemedAt: x.redeemedAt || null, fulfilledAt: x.fulfilledAt || null, revokedAt: x.revokedAt || null, status: invitationState(x), guestName: app?.fullName || x.label || 'Guest' }; });
  const hydratedTickets = tickets.map((x) => { const app = appById.get(x.applicationId); const payment = paymentById.get(x.paymentId); return { ticketId: x.ticketId, applicationId: x.applicationId, invitationId: x.invitationId, userId: x.userId, guestName: app?.fullName || 'Guest', email: app?.email || null, phone: app?.phone || null, status: x.status, ticketSource: x.ticketSource || (x.paymentId ? 'stripe' : 'comp'), paymentId: x.paymentId || null, amountTotal: Number(payment?.amountTotal || 0), currency: payment?.currency || 'usd', issuedAt: x.issuedAt || null, checkedInAt: x.checkedInAt || null, waiverSignedAt: x.waiverSignedAt || null, refundedAt: x.refundedAt || null }; });
  const stats = {
    applications: applications.length,
    pending: applications.filter((x) => x.status === 'pending').length,
    approved: applications.filter((x) => x.status === 'approved').length,
    invitationsActive: hydratedInvitations.filter((x) => x.status === 'active').length,
    invitationsRedeemed: hydratedInvitations.filter((x) => x.status === 'redeemed').length,
    invitationsFulfilled: hydratedInvitations.filter((x) => x.status === 'fulfilled').length,
    ticketsActive: hydratedTickets.filter((x) => ACTIVE_TICKET.has(x.status)).length,
    checkedIn: hydratedTickets.filter((x) => x.status === 'checked_in' || x.checkedInAt).length,
    comps: hydratedTickets.filter((x) => x.ticketSource === 'comp' && ACTIVE_TICKET.has(x.status)).length,
    refunded: hydratedTickets.filter((x) => x.status === 'refunded').length,
    admissionRevenueCents: payments.filter((x) => x.status === 'paid' && x.purchaseType !== 'addon').reduce((n, x) => n + Number(x.amountTotal || 0), 0),
    addonRevenueCents: payments.filter((x) => x.status === 'paid' && x.purchaseType === 'addon').reduce((n, x) => n + Number(x.amountTotal || 0), 0),
    activeAddons: entitlements.filter((x) => x.status === 'active').length,
    checkins: checkins.length
  };
  return { applications, invitations: hydratedInvitations, tickets: hydratedTickets, payments, entitlements, stats };
}
function filterRows(rows, q, status) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((x) => (!status || status === 'all' || x.status === status) && (!needle || searchable(x.guestName, x.email, x.phone, x.ticketId, x.invitationId, x.label).includes(needle)));
}

export default async (req) => {
  if (!isAdmin(req)) return json({ error: 'Unauthorized.' }, 401);
  const url = new URL(req.url);
  const eventId = String(url.searchParams.get('eventId') || listEvents({ includeHidden: true })[0]?.eventId || '');
  const event = getEvent(eventId);
  if (!event) return json({ error: 'Unknown event.' }, 400);
  if (req.method === 'GET') {
    const data = await snapshot(eventId);
    const q = url.searchParams.get('q') || '', status = url.searchParams.get('status') || 'all', kind = url.searchParams.get('kind') || 'snapshot';
    if (url.searchParams.get('format') === 'csv') {
      if (kind === 'applications') return csvResponse([['Name','Email','Phone','Status','Created'], ...filterRows(data.applications.map((x) => ({ ...x, guestName: x.fullName })), q, status).map((x) => [x.fullName, x.email, x.phone, x.status, x.createdAt])]);
      if (kind === 'invitations') return csvResponse([['Guest','Email','Status','Created','Expires','Redeemed','Fulfilled'], ...filterRows(data.invitations, q, status).map((x) => [x.guestName, x.email, x.status, x.createdAt, x.expiresAt, x.redeemedAt, x.fulfilledAt])]);
      if (kind === 'tickets') return csvResponse([['Ticket','Guest','Email','Status','Source','Amount Cents','Issued','Checked In','Waiver'], ...filterRows(data.tickets, q, status).map((x) => [x.ticketId, x.guestName, x.email, x.status, x.ticketSource, x.amountTotal, x.issuedAt, x.checkedInAt, x.waiverSignedAt])]);
      if (kind === 'entitlements') return csvResponse([['Ticket','Type','Status','Price Cents','Purchased','Credits Purchased','Credits Redeemed','Credits Remaining'], ...data.entitlements.map((x) => [x.ticketId, x.addonType, x.status, x.priceCents, x.purchasedAt, x.creditsPurchased, x.creditsRedeemed, x.creditsRemaining])]);
      return json({ error: 'Unknown export kind.' }, 400);
    }
    return json({ event: toPublicEvent(event), events: listEvents({ includeHidden: true }).map(toPublicEvent), stats: data.stats, invitations: filterRows(data.invitations, q, status), tickets: filterRows(data.tickets, q, status), entitlements: data.entitlements, generatedAt: new Date().toISOString() });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body; try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (body.eventId !== eventId) return json({ error: 'Event scope mismatch.' }, 400);
  const action = String(body.action || '');
  const now = new Date().toISOString();

  if (action === 'revoke_invitation') {
    const key = eventKey(eventId, String(body.invitationId || ''));
    const store = blobStore(STORES.invitations), invite = await store.get(key, { type: 'json' }).catch(() => null);
    if (!invite) return json({ error: 'Invitation not found.' }, 404);
    if (invitationState(invite) === 'fulfilled') return json({ error: 'A fulfilled invitation cannot be revoked; manage the ticket instead.' }, 409);
    const updated = { ...invite, status: 'revoked', revokedAt: now, updatedAt: now };
    await store.setJSON(key, updated);
    await writeAudit({ eventId, action: 'invitation.revoked', actor: 'admin', targetType: 'invitation', targetId: invite.invitationId });
    return json({ ok: true });
  }

  if (action === 'reissue_invitation') {
    const oldKey = eventKey(eventId, String(body.invitationId || ''));
    const store = blobStore(STORES.invitations), old = await store.get(oldKey, { type: 'json' }).catch(() => null);
    if (!old) return json({ error: 'Invitation not found.' }, 404);
    if (invitationState(old) === 'fulfilled') return json({ error: 'A fulfilled invitation cannot be reissued.' }, 409);
    const app = old.applicationId ? await loadApplication(eventId, old.applicationId) : null;
    if (!old.applicationId || !old.userId) return json({ error: 'Invitation identity is incomplete.' }, 409);
    const revoked = { ...old, status: 'revoked', revokedAt: now, updatedAt: now };
    await store.setJSON(oldKey, revoked);
    const created = await createInvitation({ eventId, applicationId: old.applicationId, userId: old.userId, email: old.email || app?.email, label: old.label, maxTickets: old.maxTickets || 1, expiresAt: null });
    if (app) await blobStore(STORES.applications).setJSON(eventKey(eventId, app.applicationId), { ...app, invitationId: created.invitation.invitationId, invitationCreatedAt: created.invitation.createdAt, updatedAt: now });
    const mail = body.sendEmail ? await sendInvite(event, app, created.code, created.invitation) : { sent: false, reason: 'not_requested' };
    await writeAudit({ eventId, action: 'invitation.reissued', actor: 'admin', targetType: 'invitation', targetId: created.invitation.invitationId, detail: { replaces: old.invitationId, emailSent: mail.sent } });
    return json({ ok: true, invitationId: created.invitation.invitationId, code: created.code, expiresAt: created.invitation.expiresAt, email: mail });
  }

  if (action === 'comp_ticket') {
    const applicationId = String(body.applicationId || '').trim();
    const app = await loadApplication(eventId, applicationId);
    if (!app || app.eventId !== eventId || !app.userId) return json({ error: 'Application with Wild Ones identity is required.' }, 404);
    const existing = await existingTicketForUser(eventId, app.userId);
    if (existing && ACTIVE_TICKET.has(existing.status)) return json({ error: 'This guest already has an active ticket.' }, 409);
    const invitationId = randomUUID(), ticketId = makeTicketId(event, invitationId), ticket = { ticketId, eventId, userId: app.userId, applicationId, invitationId, paymentId: null, status: 'paid', ticketSource: 'comp', issuedAt: now, updatedAt: now, checkedInAt: null, waiverSignedAt: null, waiverVersion: null, waiverTextHash: null };
    await blobStore(STORES.invitations).setJSON(eventKey(eventId, invitationId), { invitationId, eventId, applicationId, userId: app.userId, email: app.email, label: `Comp - ${app.fullName}`, createdAt: now, expiresAt: event.startsAt, maxTickets: 1, codeHash: null, status: 'fulfilled', redeemedAt: null, revokedAt: null, purchaseCount: 1, fulfilledAt: now, comp: true });
    await blobStore(STORES.tickets).setJSON(eventKey(eventId, ticketId), ticket);
    await Promise.all([blobStore(STORES.ticketIndexes).setJSON(eventKey(eventId, `invitation/${invitationId}`), { ticketId, eventId, createdAt: now }), blobStore(STORES.ticketIndexes).setJSON(eventKey(eventId, `user/${app.userId}`), { ticketId, eventId, userId: app.userId, createdAt: now })]);
    await blobStore(STORES.applications).setJSON(eventKey(eventId, applicationId), { ...app, status: 'approved', decision: app.decision || 'approved', compTicketId: ticketId, updatedAt: now });
    const mail = body.sendEmail ? await sendTicketReminder(event, ticket, app, 'ticket') : { sent: false, reason: 'not_requested' };
    await writeAudit({ eventId, action: 'ticket.comp_issued', actor: 'admin', targetType: 'ticket', targetId: ticketId, detail: { applicationId, emailSent: mail.sent } });
    return json({ ok: true, ticketId, email: mail });
  }

  if (action === 'refund_admission') {
    const ticket = await loadTicket(eventId, String(body.ticketId || ''));
    if (!ticket) return json({ error: 'Ticket not found.' }, 404);
    if (ticket.checkedInAt || ticket.status === 'checked_in') return json({ error: 'Checked-in admission requires manual review and cannot be refunded here.' }, 409);
    if (ticket.ticketSource === 'comp' || !ticket.paymentId) return json({ error: 'Comp tickets do not have a Stripe payment to refund.' }, 409);
    if (ticket.status === 'refunded') return json({ error: 'Admission is already refunded.' }, 409);
    const paymentKey = eventKey(eventId, ticket.paymentId), payments = blobStore(STORES.payments), payment = await payments.get(paymentKey, { type: 'json' }).catch(() => null);
    if (!payment?.stripePaymentIntentId || payment.status !== 'paid') return json({ error: 'A refundable paid Stripe payment was not found.' }, 409);
    const refund = await stripePost('refunds', { payment_intent: payment.stripePaymentIntentId, reason: 'requested_by_customer', 'metadata[event_id]': eventId, 'metadata[admin_action]': 'admission_refund' }, `wildones-admin-admission-refund-${payment.paymentId}`);
    await blobStore(STORES.tickets).setJSON(eventKey(eventId, ticket.ticketId), { ...ticket, status: 'refunded', refundedAt: now, refundId: refund.id, updatedAt: now });
    await payments.setJSON(paymentKey, { ...payment, status: 'refunded', refundedAt: now, refundId: refund.id, updatedAt: now });
    await writeAudit({ eventId, action: 'ticket.refunded', actor: 'admin', targetType: 'ticket', targetId: ticket.ticketId, detail: { paymentId: payment.paymentId, refundId: refund.id } });
    return json({ ok: true, refundId: refund.id });
  }

  if (action === 'refund_addon') {
    const ticketId = String(body.ticketId || ''), addonType = String(body.addonType || ''), entitlementKey = eventKey(eventId, `${ticketId}/${addonType}`), entStore = blobStore(STORES.entitlements), ent = await entStore.get(entitlementKey, { type: 'json' }).catch(() => null);
    if (!ent) return json({ error: 'Add-on entitlement not found.' }, 404);
    if (ent.status === 'refunded') return json({ error: 'Add-on is already refunded.' }, 409);
    if (ent.addonType === 'drink_package' && (Number(ent.creditsRedeemed || 0) > 0 || ent.wristbandActivatedAt)) return json({ error: 'A used or activated drink package requires manual review.' }, 409);
    const paymentKey = eventKey(eventId, ent.paymentId), payments = blobStore(STORES.payments), payment = await payments.get(paymentKey, { type: 'json' }).catch(() => null);
    if (!payment?.stripePaymentIntentId || payment.status !== 'paid') return json({ error: 'A refundable paid Stripe add-on payment was not found.' }, 409);
    const refund = await stripePost('refunds', { payment_intent: payment.stripePaymentIntentId, reason: 'requested_by_customer', 'metadata[event_id]': eventId, 'metadata[admin_action]': 'addon_refund', 'metadata[addon_type]': addonType }, `wildones-admin-addon-refund-${payment.paymentId}`);
    await entStore.setJSON(entitlementKey, { ...ent, status: 'refunded', refundedAt: now, refundId: refund.id, updatedAt: now });
    await payments.setJSON(paymentKey, { ...payment, status: 'refunded', refundedAt: now, refundId: refund.id, updatedAt: now });
    await writeAudit({ eventId, action: 'addon.refunded', actor: 'admin', targetType: 'ticket', targetId: ticketId, detail: { addonType, paymentId: payment.paymentId, refundId: refund.id } });
    return json({ ok: true, refundId: refund.id });
  }

  if (action === 'send_waiver_reminder' || action === 'send_ticket_email') {
    const ticket = await loadTicket(eventId, String(body.ticketId || ''));
    if (!ticket || !ACTIVE_TICKET.has(ticket.status)) return json({ error: 'Active ticket not found.' }, 404);
    const app = await loadApplication(eventId, ticket.applicationId);
    const mail = await sendTicketReminder(event, ticket, app, action === 'send_waiver_reminder' ? 'waiver' : 'ticket');
    if (!mail.sent) return json({ error: 'Email could not be sent.', detail: mail.reason }, 503);
    await writeAudit({ eventId, action: action === 'send_waiver_reminder' ? 'ticket.waiver_reminder_sent' : 'ticket.email_sent', actor: 'admin', targetType: 'ticket', targetId: ticket.ticketId, detail: { emailId: mail.id } });
    return json({ ok: true, email: mail });
  }

  return json({ error: 'Unknown action.' }, 400);
};

export const config = { path: '/api/admin/operations' };
