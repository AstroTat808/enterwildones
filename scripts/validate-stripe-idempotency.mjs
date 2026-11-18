import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutIdempotencyKey, stripePost } from '../netlify/functions/_stripe.mjs';

const scope = 'wildones-aureva-2026-example-invitation-1';
const params = {
  mode: 'payment',
  'managed_payments[enabled]': 'false',
  expires_at: '1795040000',
  'line_items[0][price_data][unit_amount]': '5500',
  success_url: 'https://enterwildones-staging.netlify.app/ticket-confirmed?return_token=test'
};

const key = checkoutIdempotencyKey(scope, params);
assert.match(key, /^[a-zA-Z0-9_-]+-[a-f0-9]{64}$/);
assert.ok(key.length <= 255, 'Stripe idempotency keys must not exceed 255 characters');
assert.equal(key, checkoutIdempotencyKey(scope, { ...params }), 'Identical requests must reuse the same key');
assert.equal(key, checkoutIdempotencyKey(scope, Object.fromEntries(Object.entries(params).reverse())), 'Parameter insertion order must not change the key');
assert.notEqual(key, checkoutIdempotencyKey(scope, { ...params, 'managed_payments[enabled]': 'true' }), 'Managed Payments changes must create a new key');
assert.notEqual(key, checkoutIdempotencyKey(scope, { ...params, expires_at: '1795040001' }), 'Expiry changes must create a new key');
assert.notEqual(key, checkoutIdempotencyKey(scope, { ...params, success_url: 'https://enterwildones-staging.netlify.app/ticket-confirmed?return_token=other' }), 'Signed return-token changes must create a new key');
assert.notEqual(key, checkoutIdempotencyKey(scope, { ...params, 'line_items[0][price_data][unit_amount]': '7000' }), 'Price changes must create a new key');
assert.notEqual(key, checkoutIdempotencyKey(scope + '-2', params), 'Different safe attempts must have different keys');
assert.ok(!key.includes('return_token'), 'Idempotency key must not leak signed Checkout URLs');

const savedFetch = globalThis.fetch;
const savedKey = process.env.STRIPE_SECRET_KEY;
try {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_unit_tests_only';
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'cs_test_checkout_unit_test', url: 'https://checkout.stripe.com/c/pay/cs_test_checkout_unit_test' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  const checkout = await stripePost('checkout/sessions', params, key);
  assert.equal(checkout.id, 'cs_test_checkout_unit_test');
  assert.equal(request.options.headers['Idempotency-Key'], key, 'Checkout must send the payload-derived key');
  assert.equal(new URLSearchParams(request.options.body).get('managed_payments[enabled]'), 'false');

  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: 'idempotency_error', message: 'Internal Stripe idempotency key must never be displayed publicly.' }
  }), { status: 400, headers: { 'content-type': 'application/json', 'request-id': 'req_safe_metadata_only' } });
  await assert.rejects(
    () => stripePost('checkout/sessions', params, key),
    (error) => error.stripeHttpStatus === 400 && error.stripeCode === 'idempotency_error' && error.stripeRequestId === 'req_safe_metadata_only',
    'Provider failure metadata should remain available for safe internal diagnosis'
  );
} finally {
  globalThis.fetch = savedFetch;
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedKey;
}

const admission = await readFile(new URL('../netlify/functions/create-checkout.mjs', import.meta.url), 'utf8');
assert.ok(admission.includes('checkoutIdempotencyKey(`wildones-${event.eventId}-${invitation.invitationId}-${attempt}`, params)'), 'Admission must use the payload-derived key');
assert.ok(admission.indexOf('const params = {') < admission.indexOf('const idempotency = checkoutIdempotencyKey('), 'Compute key only after all Stripe params have been finalized');
assert.ok(admission.includes('CHECKOUT_RECONCILIATION_REQUIRED'), 'Ambiguous checkout attempts must fail closed');
assert.ok(admission.includes('await releaseAdmission('), 'Definitively rejected Checkout requests must release the admission hold');
assert.ok(admission.includes("error?.stripeCode !== 'idempotency_error'"), 'Idempotency conflicts must preserve the seat hold for reconciliation');
assert.ok(admission.includes('stripeStatus !== 429'), 'Rate limits must preserve the seat hold for reconciliation');
assert.ok(admission.includes('retryAllowed = definitiveStripeRejection && holdReleased'), 'Only confirmed hold release may offer a retry');
const checkoutStripeHandler = admission.slice(admission.indexOf('const idempotency = checkoutIdempotencyKey('));
assert.ok(!/return json\(\{\s*error:\s*error\.message/.test(checkoutStripeHandler), 'Never leak raw Stripe API errors to ticket buyers');
const addOn = await readFile(new URL('../netlify/functions/create-addon-checkout.mjs', import.meta.url), 'utf8');
assert.ok(addOn.includes('ADDON_CHECKOUT_RECONCILIATION_REQUIRED'), 'Unknown add-on payment outcomes must not invite another charge');
assert.ok(!addOn.includes("return json({error:error.message"), 'Never leak raw Stripe errors in add-on Checkout');
console.log('Stripe Checkout payload-bound idempotency, safe guest errors, and inventory retry guards validated.');
