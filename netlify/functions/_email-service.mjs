import { sha256, STORES, eventKey, normalizedEmail } from './_stores.mjs';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { getEvent, requireEvent } from './_events.mjs';
import { makeTicketToken } from './_ticket-token.mjs';
import { renderTicketEmail, renderBrandedNoticeEmail } from './_mail-templates.mjs';

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS = [300000, 1800000, 7200000, 21600000];
const TERMINAL_FAILURES = new Set(['bounced', 'failed', 'suppressed', 'complained']);

export function maskEmail(value = '') {
  const email = normalizedEmail(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return 'unavailable';
  return email.slice(0, Math.min(2, at)) + '***@' + email.slice(at + 1);
}
function validAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}
function storeKey(eventId, key) {
  return eventKey(eventId, 'send/' + sha256(key));
}
function retryTime(attempts) {
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(Date.now() + RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]).toISOString();
}
function stripError(error) {
  return String(error?.message || error || 'unknown_error').replace(/re_[A-Za-z0-9]+/g, '[redacted]').slice(0, 140);
}
export async function trackedEmail({ eventId, kind, to, subject, text, html = null, key, sourceId = null, retryable = false }) {
  requireEvent(eventId);
  if (!validAddress(to) || !key || !subject || !text) return { sent: false, reason: 'invalid_email_request' };
  const idempotencyKey = String(key).slice(0, 256);
  const store = blobStore(STORES.emailDeliveries);
  const recordKey = storeKey(eventId, idempotencyKey);
  const previous = await store.get(recordKey, { type: 'json' }).catch(() => null);
  if (previous?.providerId) return { sent: true, id: previous.providerId, status: previous.status, alreadyAccepted: true };
  if (previous?.status === 'api_failed' && (!previous.retryable || !previous.nextRetryAt || previous.attempts >= MAX_ATTEMPTS))
    return { sent: false, reason: previous.reason || 'retry_limit', exhausted: true };
  if (previous?.status === 'api_failed' && previous.nextRetryAt && Date.parse(previous.nextRetryAt) > Date.now())
    return { sent: false, reason: 'retry_not_due', nextRetryAt: previous.nextRetryAt };
  const keyPresent = Boolean(env('RESEND_API_KEY') && env('WILDONES_EMAIL_FROM'));
  if (!keyPresent) return { sent: false, reason: 'email_not_configured' };
  const attempts = Number(previous?.attempts || 0) + 1;
  const base = {
    eventId, kind, sourceId, recordKey, toMasked: maskEmail(to),
    recipientHash: sha256(normalizedEmail(to)), subject: String(subject).slice(0, 160),
    attempts, retryable: Boolean(retryable), updatedAt: new Date().toISOString()
  };
  let response, payload = {};
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env('RESEND_API_KEY'),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        from: env('WILDONES_EMAIL_FROM'), to: [to], subject, text,
        ...(html ? { html } : {}),
        tags: [{ name: 'event', value: eventId }, { name: 'workflow', value: kind }]
      }),
      signal: AbortSignal.timeout(9000)
    });
    payload = await response.json().catch(() => ({}));
  } catch (error) {
    const record = { ...base, status: 'api_failed', reason: 'transport_error',
      nextRetryAt: retryable ? retryTime(attempts) : null };
    await store.setJSON(recordKey, record);
    return { sent: false, reason: record.reason, attempts, detail: stripError(error) };
  }
  if (!response.ok || !payload.id) {
    const retryAllowed = retryable && (response.status === 408 || response.status === 429 || response.status >= 500);
    const record = { ...base, status: 'api_failed', reason: 'provider_' + response.status,
      nextRetryAt: retryAllowed ? retryTime(attempts) : null };
    await store.setJSON(recordKey, record);
    return { sent: false, reason: record.reason, attempts };
  }
  const providerId = String(payload.id);
  const record = { ...base, providerId, status: 'accepted', acceptedAt: new Date().toISOString(), nextRetryAt: null };
  let tracked = true;
  try {
    await store.setJSON('provider/' + providerId, { eventId, recordKey, kind });
    const incoming = await store.get(recordKey, { type: 'json' }).catch(() => null);
    const preserve = incoming?.providerId === providerId && incoming?.lastEventAt ? incoming : null;
    await store.setJSON(recordKey, preserve ? { ...record, status: preserve.status, lastEventAt: preserve.lastEventAt } : record);
  } catch {
    tracked = false;
  }
  return { sent: true, id: providerId, status: 'accepted', tracked };
}

export async function sendTicketReceipt(eventId, ticketId) {
  const event = requireEvent(eventId);
  const tickets = blobStore(STORES.tickets);
  const ticket = await tickets.get(eventKey(eventId, ticketId), { type: 'json' }).catch(() => null);
  if (!ticket || !['paid', 'checked_in'].includes(ticket.status) || ticket.eventId !== eventId)
    return { sent: false, reason: 'ticket_not_active' };
  const application = await blobStore(STORES.applications).get(eventKey(eventId, ticket.applicationId), { type: 'json' }).catch(() => null);
  if (!application || !validAddress(application.email)) return { sent: false, reason: 'recipient_not_found' };
  const payment = ticket.paymentId ? await blobStore(STORES.payments).get(eventKey(eventId, ticket.paymentId), { type: 'json' }).catch(() => null) : null;
  if (ticket.ticketSource !== 'comp' && (!payment || payment.status !== 'paid'))
    return { sent: false, reason: 'payment_not_confirmed' };
  const token = makeTicketToken(ticket);
  if (!token) return { sent: false, reason: 'ticket_token_unavailable' };
  const site = (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '');
  const amount = payment ? 'USD ' + (Number(payment.amountTotal || ticket.ticketPriceCents || 0) / 100).toFixed(2) : 'Complimentary';
  const bundle = Array.isArray(payment?.selectedAddons) ? payment.selectedAddons : [];
  const dollars = cents => 'USD ' + (Number(cents || 0) / 100).toFixed(2);
  const itemized = bundle.length ? [
    'Admission subtotal: ' + dollars(payment.admissionPriceCents ?? ticket.ticketPriceCents),
    '',
    'Selected add-ons:',
    ...bundle.map(item => '• ' + item.name + ': ' + dollars(item.priceCents) +
      (item.addonType === 'drink_package' ? ' (' + item.credits + ' credits)' : (item.departureTime ? ' (until ' + item.departureTime + ' HST)' : ''))),
    'Add-on subtotal: ' + dollars(payment.addonSubtotalCents),
    ''
  ] : [];
  const name = application.preferredName || application.fullName || 'Wild One';
  const ticketUrl = site + '/ticket?token=' + encodeURIComponent(token);
  const html = renderTicketEmail({
    event, name, ticket, payment, ticketUrl,
    support: env('WILDONES_HELP_EMAIL', 'help@enterwildones.com')
  });
  return trackedEmail({
    eventId, kind: 'ticket_receipt', sourceId: ticket.ticketId,
    key: 'wildones-ticket-' + (ticket.paymentId || ticket.ticketId),
    to: application.email, subject: 'Your ' + event.name + ' Ticket Is Confirmed',
    retryable: true, html,
    text: [name + ',', '', 'Your ' + event.name + ' ticket is confirmed.',
      'Admission: ' + (ticket.ticketTierName || 'General Admission'),
      'Ticket ID: ' + ticket.ticketId,
      ...itemized,
      'Total paid: ' + amount,
      'Open your digital ticket: ' + site + '/ticket?token=' + encodeURIComponent(token),
      '', 'Your QR code remains locked until you sign the required waiver. Keep this ticket link private.',
      'Support: ' + env('WILDONES_HELP_EMAIL', 'help@enterwildones.com')].join('\n')
  });
}

export async function updateDeliveryEvent(event) {
  const type = String(event?.type || '');
  if (!type.startsWith('email.')) return { ignored: true };
  const data = event?.data || {};
  const providerId = String(data.email_id || '');
  if (!/^[A-Za-z0-9-]{12,100}$/.test(providerId)) return { ignored: true };
  const store = blobStore(STORES.emailDeliveries);
  let index = await store.get('provider/' + providerId, { type: 'json' }).catch(() => null);
  if (!index) {
    const tags = data.tags || {};
    const taggedEvent = Array.isArray(tags)
      ? tags.find((t) => t.name === 'event')?.value
      : tags.event;
    // Account-initiated QA deliveries lack the application's provider index and
    // Resend does not guarantee tags in webhook payloads. Map only an explicit
    // AUREVA QA subject from the exact authorized sending address.
    const sender = String(data.from || '').trim().toLowerCase();
    const qa = /^\[aureva qa\]/i.test(String(data.subject || '')) &&
      (sender === 'access@mail.enterwildones.com' || sender.endsWith('<access@mail.enterwildones.com>'));
    const eventId = getEvent(taggedEvent) ? taggedEvent : qa ? 'aureva-2026' : null;
    if (!getEvent(eventId)) return { ignored: true, unmatched: true };
    index = { eventId, recordKey: eventKey(eventId, 'orphan/' + providerId),
      kind: qa ? 'delivery_qa' : (Array.isArray(tags) ? tags.find((t) => t.name === 'workflow')?.value : tags.workflow) || 'external' };
    await store.setJSON('provider/' + providerId, index);
  }
  const eventId = index.eventId;
  if (!getEvent(eventId)) return { ignored: true };
  const old = await store.get(index.recordKey, { type: 'json' }).catch(() => null);
  const incomingAt = String(event.created_at || new Date().toISOString());
  if (old?.lastEventAt && Date.parse(old.lastEventAt) > Date.parse(incomingAt))
    return { ignored: true, stale: true };
  const status = type.slice('email.'.length);
  const record = {
    ...(old || {}), eventId, kind: old?.kind || index.kind || 'unknown',
    recordKey: index.recordKey, providerId,
    toMasked: old?.toMasked || maskEmail(data.to?.[0] || ''),
    recipientHash: old?.recipientHash || sha256(normalizedEmail(data.to?.[0] || '')),
    subject: old?.subject || String(data.subject || '').slice(0, 160),
    status, lastEventAt: incomingAt, updatedAt: new Date().toISOString()
  };
  await store.setJSON(index.recordKey, record);
  return { status, record, shouldAlert: TERMINAL_FAILURES.has(status) || status === 'delivery_delayed' };
}
export async function dispatchFailureAlert({ type, record, providerId }) {
  if (!record || record.kind === 'delivery_alert' || !getEvent(record.eventId)) return { skipped: true };
  const to = env('WILDONES_EMAIL_ALERT_TO');
  if (!validAddress(to)) return { skipped: true, reason: 'alert_recipient_not_configured' };
  const mail = renderBrandedNoticeEmail({
    event: getEvent(record.eventId),
    name: 'Wild Ones Operations',
    title: 'Email Delivery Needs Review',
    subject: 'Wild Ones email delivery alert: ' + String(type).replace('email.', ''),
    preview: 'An email delivery event needs attention in the operations dashboard.',
    introduction: 'An email delivery event requires review.',
    message: 'Use the private admin dashboard to inspect the delivery record and resolve the issue.',
    details: [
      { label: 'Event', value: record.eventId },
      { label: 'Workflow', value: record.kind },
      { label: 'Recipient', value: record.toMasked },
      { label: 'Delivery state', value: record.status },
      { label: 'Provider ID', value: providerId }
    ],
    actionUrl: (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '') + '/admin/email',
    actionLabel: 'Review Email Health',
    note: 'This notification is intended for authorized event operators.',
    support: env('WILDONES_HELP_EMAIL', 'help@enterwildones.com')
  });
  return trackedEmail({
    eventId: record.eventId, kind: 'delivery_alert',
    to, key: 'wildones-email-alert-' + providerId + '-' + type,
    subject: mail.subject, text: mail.text, html: mail.html
  });
}
export async function emailHealth(eventId) {
  requireEvent(eventId);
  const store = blobStore(STORES.emailDeliveries);
  const result = await store.list({ prefix: eventId + '/' });
  const rows = [];
  for (const { key } of result.blobs || []) {
    const value = await store.get(key, { type: 'json' }).catch(() => null);
    if (value?.eventId === eventId && value.kind) rows.push(value);
  }
  const summary = { total: rows.length, accepted: 0, delivered: 0, delayed: 0, failed: 0,
    awaitingProvider: 0, retriesDue: 0 };
  const now = Date.now();
  for (const item of rows) {
    if (item.status === 'accepted' || item.status === 'sent') summary.accepted++;
    if (item.status === 'delivered') summary.delivered++;
    if (item.status === 'delivery_delayed') summary.delayed++;
    if (TERMINAL_FAILURES.has(item.status) || item.status === 'api_failed') summary.failed++;
    if (item.status === 'accepted') summary.awaitingProvider++;
    if (item.status === 'api_failed' && item.retryable && item.nextRetryAt && Date.parse(item.nextRetryAt) <= now) summary.retriesDue++;
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { eventId, summary, messages: rows.slice(0, 80).map((r) => ({
    kind: r.kind, sourceId: r.sourceId || null, recipient: r.toMasked,
    subject: r.subject, status: r.status, attempts: r.attempts || 0,
    error: r.reason || null, updatedAt: r.updatedAt, providerId: r.providerId || null,
    nextRetryAt: r.nextRetryAt || null
  })) };
}

export async function pendingReceiptRetries(eventId, max = 20) {
  requireEvent(eventId);
  const store = blobStore(STORES.emailDeliveries);
  const result = await store.list({ prefix: eventId + '/send/' });
  const due = [];
  for (const { key } of result.blobs || []) {
    const row = await store.get(key, { type: 'json' }).catch(() => null);
    if (row?.kind === 'ticket_receipt' && row.status === 'api_failed' && row.retryable &&
        row.nextRetryAt && Date.parse(row.nextRetryAt) <= Date.now() && row.attempts < MAX_ATTEMPTS && row.sourceId)
      due.push(row.sourceId);
    if (due.length >= max) break;
  }
  return due;
}
