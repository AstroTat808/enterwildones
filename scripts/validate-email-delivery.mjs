import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import { validSignature } from '../netlify/functions/resend-webhook.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const webhook = read('netlify/functions/resend-webhook.mjs');
const service = read('netlify/functions/_email-service.mjs');
const scheduler = read('netlify/functions/aureva-email-scheduler.mjs');
const events = read('netlify/functions/_events.mjs');
const html = read('site/admin-email.html');
const admin = read('netlify/functions/admin-email-health.mjs');
const payments = read('netlify/functions/_payments.mjs');
const invitations = read('netlify/functions/admin-applications.mjs');
const operations = read('netlify/functions/admin-operations.mjs');
const netlify = read('netlify.toml');

assert.match(events, /ticketSalesOpen:false/);
assert.match(webhook, /req\.method !== 'POST'/);
assert.match(webhook, /validSignature\(raw, req\)/);
assert.match(webhook, /WILDONES_RESEND_WEBHOOK_SECRET/);
assert.match(webhook, /timingSafeEqual/);
assert.match(service, /Idempotency-Key/);
assert.match(service, /sendTicketReceipt/);
assert.match(service, /pendingReceiptRetries/);
assert.match(service, /sendTicketReceipt\(eventId, ticketId\)/);
assert.match(service, /status === 'api_failed'/);
assert.match(scheduler, /WILDONES_EMAIL_AUTOMATION_ENABLED/);
assert.match(scheduler, /schedule: '15 23 \* \* \*'/);
assert.match(scheduler, /if \(event\.ticketSalesOpen\)/);
assert.match(scheduler, /MAX_EMAILS_PER_RUN = 25/);
assert.match(scheduler, /if \(!\['paid', 'checked_in'\]\.includes\(ticket\.status\)\)/);
assert.match(scheduler, /pendingReceiptRetries/);
assert.match(invitations, /trackedEmail/);
assert.match(payments, /sendTicketReceipt/);
assert.match(operations, /trackedEmail/);
assert.match(admin, /isAdmin\(req\)/);
assert.match(html, /emailSummary/);
assert.match(netlify, /from = "\/admin\/email"/);

const secret = randomBytes(32);
process.env.WILDONES_RESEND_WEBHOOK_SECRET = 'whsec_' + secret.toString('base64');
const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'test-id1234567890' } });
const id = 'msg_test_1';
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', secret).update(id + '.' + timestamp + '.' + body).digest('base64');
const request = (time, sig) => ({ headers: new Headers({
  'svix-id': id, 'svix-timestamp': time, 'svix-signature': sig
}) });
assert.equal(validSignature(body, request(timestamp, 'v1,' + signature)), true, 'Valid Resend signature must pass');
assert.equal(validSignature(body + ' ', request(timestamp, 'v1,' + signature)), false, 'Tampered body must fail');
assert.equal(validSignature(body, request(timestamp, 'v1,' + randomBytes(32).toString('base64'))), false, 'Invalid signature must fail');
assert.equal(validSignature(body, request(String(Number(timestamp) - 600), 'v1,' + signature)), false, 'Old signatures must fail');
assert.equal(validSignature(body, request(timestamp, 'v2,' + signature)), false, 'Unknown signature versions must fail');
delete process.env.WILDONES_RESEND_WEBHOOK_SECRET;
assert.equal(validSignature(body, request(timestamp, 'v1,' + signature)), false, 'Missing secret must fail closed');

console.log('AUREVA mail workflow structure and Svix signature tests passed.');
