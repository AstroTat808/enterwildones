// Isolated AUREVA email journey. All storage and network calls are mocked.
// Never makes a Stripe charge, issues real admission, or sends a real email.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const blobModule = [
  'export const getStore = (name) => globalThis.__aurevaQAStore(name);',
  'export const getDeployStore = (name) => globalThis.__aurevaQAStore(name);'
].join('\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@netlify/blobs') {
      return { url: 'data:text/javascript,' + encodeURIComponent(blobModule), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});

const databases = new Map();
globalThis.__aurevaQAStore = (name) => {
  if (!databases.has(name)) databases.set(name, new Map());
  const table = databases.get(name);
  return {
    async get(key) { return table.has(key) ? structuredClone(table.get(key)) : null; },
    async setJSON(key, value) { table.set(key, structuredClone(value)); },
    async delete(key) { return table.delete(key); },
    async list({ prefix = '' } = {}) {
      return { blobs: [...table.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    }
  };
};
globalThis.Netlify = { context: { deploy: { context: 'production' } } };
const variables = {
  WILDONES_SITE_URL: 'https://enterwildones.com',
  WILDONES_ADMIN_KEY: 'qa-only-admin-key-not-a-real-secret',
  WILDONES_INVITE_ACCESS_SECRET: 'qa-only-invite-secret-32-chars-min',
  WILDONES_TICKET_ACCESS_SECRET: 'qa-only-ticket-secret-32-chars-min',
  WILDONES_EMAIL_FROM: 'Wild Ones <access@mail.enterwildones.com>',
  WILDONES_EMAIL_ALERT_TO: 'qa-alerts@example.invalid',
  RESEND_API_KEY: 're_qa_mock_only_no_external_network'
};
for (const [key, value] of Object.entries(variables)) process.env[key] = value;

const mockMessages = [];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input?.url || input);
  assert.equal(url, 'https://api.resend.com/emails', 'All external requests must be intercepted');
  const body = JSON.parse(String(options.body || ''));
  const idempotencyKey = options.headers?.['Idempotency-Key'];
  assert.equal(typeof idempotencyKey, 'string', 'All sends require an idempotency key');
  assert.match(body.from, /access@mail\.enterwildones\.com/);
  const same = mockMessages.find((msg) => msg.key === idempotencyKey);
  if (same) return Response.json({ id: same.id });
  const id = 'qa-mock-message-' + String(mockMessages.length + 1).padStart(4, '0');
  mockMessages.push({ id, key: idempotencyKey, to: body.to, subject: body.subject, text: body.text, tags: body.tags });
  return Response.json({ id }, { status: 200 });
};

const { STORES, eventKey } = await import('../netlify/functions/_stores.mjs');
const { requireEvent } = await import('../netlify/functions/_events.mjs');
const { makeTicketId, verifyTicketToken } = await import('../netlify/functions/_ticket-token.mjs');
const { sendTicketReceipt, trackedEmail, updateDeliveryEvent, dispatchFailureAlert, emailHealth } =
  await import('../netlify/functions/_email-service.mjs');
const handleAdminApplication = (await import('../netlify/functions/admin-applications.mjs')).default;
const handleInviteRedeem = (await import('../netlify/functions/redeem-invite.mjs')).default;
const handleHealth = (await import('../netlify/functions/admin-email-health.mjs')).default;

const eventId = 'aureva-2026';
const event = requireEvent(eventId);
assert.equal(event.ticketSalesOpen, false, 'No public admission sales may be opened by QA');
assert.equal(event.applicationOpen, true, 'Application intake expected');
assert.equal(event.startsAt, '2027-01-23T19:00:00-10:00');
const applicationId = 'qa-application';
const userId = 'qa-user';
const guestEmail = 'qa-guest@example.invalid';
const app = { eventId, applicationId, userId, fullName: 'AUREVA Email Test Guest',
  preferredName: 'Email QA', email: guestEmail, status: 'pending', marketingOptIn: true };
await globalThis.__aurevaQAStore(STORES.applications).setJSON(eventKey(eventId, applicationId), app);
await globalThis.__aurevaQAStore(STORES.users).setJSON(userId, { userId, email: guestEmail, status: 'active' });

function request(path, data, authorized = false) {
  const headers = { origin: 'https://enterwildones.com', 'content-type': 'application/json' };
  if (authorized) headers.authorization = 'Bearer ' + variables.WILDONES_ADMIN_KEY;
  return new Request('https://enterwildones.com' + path, { method: 'POST', headers, body: JSON.stringify(data) });
}

// 1. Admin approval creates an event-scoped invitation and emails its real code.
const approval = await handleAdminApplication(request('/api/admin/applications', {
  eventId, applicationId, action: 'approve_and_invite', maxTickets: 1
}, true));
assert.equal(approval.status, 200, 'Test application approval');
const approved = await approval.json();
assert.equal(approved.email.sent, true);
assert.match(approved.invite.code, /^AUR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.equal(mockMessages.length, 1, 'Approval sent exactly one mocked invitation');
assert.match(mockMessages[0].text, new RegExp(approved.invite.code));
assert.match(mockMessages[0].text, /\/invite/);

// 2. Guest redeems code, but public checkout stays closed.
const redemption = await handleInviteRedeem(request('/api/redeem-invite', { code: approved.invite.code }));
assert.equal(redemption.status, 200, 'Invite redemption succeeded');
const redeemed = await redemption.json();
assert.equal(redeemed.accessGranted, true);
assert.equal(redeemed.ticketSalesOpen, false);
assert.equal(redeemed.purchaseAvailable, false);
assert.equal(mockMessages.length, 1);

// 3. Simulate a *pre-existing paid record* in in-memory stores only.
// This does NOT call Stripe, commission a seat, or issue any live ticket.
const invitationId = approved.invite.invitationId;
const ticketId = makeTicketId(event, invitationId);
const paymentId = 'cs_qa_simulated_not_live';
const ticket = { eventId, ticketId, userId, applicationId, invitationId,
  paymentId, ticketSource: 'stripe', ticketTierName: 'FIRST LIGHT RELEASE',
  ticketPriceCents: 5500, status: 'paid' };
await globalThis.__aurevaQAStore(STORES.tickets).setJSON(eventKey(eventId, ticketId), ticket);
await globalThis.__aurevaQAStore(STORES.payments).setJSON(eventKey(eventId, paymentId), {
  eventId, paymentId, amountTotal: 5500, status: 'paid', currency: 'usd'
});
const receipt = await sendTicketReceipt(eventId, ticketId);
assert.equal(receipt.sent, true, 'Receipt API submission succeeded');
assert.equal(mockMessages.length, 2, 'One ticket confirmation sent in mock');
const receiptText = mockMessages[1].text;
assert.match(receiptText, /FIRST LIGHT RELEASE/);
assert.match(receiptText, /USD 55\.00/);
assert.match(receiptText, /\/ticket\?token=/);
const token = decodeURIComponent(receiptText.match(/\/ticket\?token=([^\s]+)/)?.[1] || '');
const verifiedToken = verifyTicketToken(token);
assert.equal(verifiedToken?.ticketId, ticketId);
assert.equal(verifiedToken?.eventId, eventId);
assert.equal((await sendTicketReceipt(eventId, ticketId)).alreadyAccepted, true, 'Receipt retries must be idempotent');
assert.equal(mockMessages.length, 2, 'No duplicate receipt');

// 4. Webhook delivery status updates tracked records and the admin dashboard.
for (const message of mockMessages) {
  const result = await updateDeliveryEvent({ type: 'email.delivered',
    created_at: new Date().toISOString(), data: { email_id: message.id } });
  assert.equal(result.status, 'delivered');
}
const health = await emailHealth(eventId);
assert.equal(health.summary.delivered, 2);
assert.equal(health.summary.failed, 0);
const healthResponse = await handleHealth(new Request('https://enterwildones.com/api/admin/email-health?eventId=' + eventId, {
  headers: { authorization: 'Bearer ' + variables.WILDONES_ADMIN_KEY }
}));
assert.equal(healthResponse.status, 200);
assert.equal((await healthResponse.json()).summary.delivered, 2);
const unauthenticated = await handleHealth(new Request('https://enterwildones.com/api/admin/email-health'));
assert.equal(unauthenticated.status, 401);

// 5. Simulate a provider failure, verify alert generation and masked dashboard output.
const manual = await trackedEmail({ eventId, kind: 'waiver_reminder',
  sourceId: ticketId, to: guestEmail,
  key: 'qa-waiver-' + ticketId, subject: 'QA waiver reminder', text: 'Test only.' });
assert.equal(manual.sent, true);
const failure = await updateDeliveryEvent({ type: 'email.failed',
  created_at: new Date(Date.now() + 2000).toISOString(), data: { email_id: manual.id } });
assert.equal(failure.shouldAlert, true);
const alert = await dispatchFailureAlert({ type: 'email.failed', record: failure.record, providerId: manual.id });
assert.equal(alert.sent, true);
assert.equal(mockMessages.length, 4, 'One alert and no unexpected real network sends');
const final = await emailHealth(eventId);
assert.equal(final.summary.failed, 1);
assert.equal(final.summary.delivered, 2);
assert.equal(final.messages.some((row) => String(row.recipient).includes(guestEmail)), false, 'Recipient must remain masked');

console.log('PASS: Isolated AUREVA approval -> email invitation -> redemption with sales closed -> simulated paid record -> signed ticket receipt -> delivery tracking -> failure alert. No real network, admission, or charge.');
