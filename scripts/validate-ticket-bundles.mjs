import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const prefix = 'WILDONES_AUREVA_2026_';
const changes = {
  [prefix + 'DRINK_PACKAGE_PRICE_CENTS']: '5500',
  [prefix + 'DRINK_PACKAGE_CREDITS']: '6',
  [prefix + 'LATE_STAY_PRICE_CENTS']: '2000',
  [prefix + 'LATE_STAY_DEPARTURE_TIME']: '10:00 AM'
};
const previous = new Map(Object.keys(changes).map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, changes);
  const { selectBundledAddons, addonSubtotal, bundleTypes, verifyBundleSnapshot } =
    await import('../netlify/functions/_bundled-addons.mjs');
  const event = 'aureva-2026';
  const none = selectBundledAddons(event, []);
  const drink = selectBundledAddons(event, ['drink_package']);
  const late = selectBundledAddons(event, ['late_stay']);
  const both = selectBundledAddons(event, ['late_stay', 'drink_package']);

  assert.equal(none.length, 0);
  assert.equal(addonSubtotal(none), 0);
  assert.equal(drink.length, 1);
  assert.equal(drink[0].priceCents, 5500);
  assert.equal(drink[0].credits, 6);
  assert.equal(late[0].departureTime, '10:00 AM');
  assert.equal(late[0].priceCents, 2000);
  assert.deepEqual(both.map(x => x.addonType), ['drink_package', 'late_stay']);
  assert.equal(bundleTypes(both), 'drink_package,late_stay');
  assert.equal(addonSubtotal(both), 7500);
  assert.ok(verifyBundleSnapshot(none, 5500, 5500));
  assert.ok(verifyBundleSnapshot(drink, 5500, 11000));
  assert.ok(verifyBundleSnapshot(late, 5500, 7500));
  assert.ok(verifyBundleSnapshot(both, 5500, 13000));
  assert.ok(verifyBundleSnapshot(both, 7000, 14500));

  for (const invalid of [
    ['drink_package', 'drink_package'], ['drink_package', 'late_stay', 'another'],
    ['invalid'], [42], 'drink_package', [{ addonType:'drink_package', priceCents:0 }]
  ]) assert.throws(() => selectBundledAddons(event, invalid), /Select each/);
  process.env[prefix + 'DRINK_PACKAGE_PRICE_CENTS'] = '';
  assert.throws(() => selectBundledAddons(event, ['drink_package']), /unavailable/);
  process.env[prefix + 'DRINK_PACKAGE_PRICE_CENTS'] = '5500';

  assert.throws(() => verifyBundleSnapshot(both, 5500, 5500), /itemized/);
  assert.throws(() => verifyBundleSnapshot([both[0], both[0]], 5500, 16500), /itemized/);
  assert.throws(() => verifyBundleSnapshot([{...drink[0], credits:0}], 5500, 11000), /itemized/);
  assert.throws(() => verifyBundleSnapshot([{...late[0], departureTime:''}], 5500, 7500), /itemized/);

  const root = new URL('../', import.meta.url);
  const file = path => readFile(new URL(path, root), 'utf8');
  const [checkout, payments, access, admin, receipt, addonCheckout, guest, markup, css, inventory, webhook, bundle] =
    await Promise.all([
      'netlify/functions/create-checkout.mjs',
      'netlify/functions/_payments.mjs',
      'netlify/functions/ticket-access.mjs',
      'netlify/functions/admin-operations.mjs',
      'netlify/functions/_email-service.mjs',
      'netlify/functions/create-addon-checkout.mjs',
      'site/assets/js/ticket-access.js',
      'site/ticket-access.html',
      'site/assets/css/ticket-bundle.css',
      'netlify/functions/_admission-inventory.mjs',
      'netlify/functions/stripe-webhook.mjs',
      'netlify/functions/_bundled-addons.mjs'
    ].map(file));

  for (const term of [
    'selectBundledAddons(event.eventId, body.addons ?? [])', 'const orderTotal = price + addonTotal',
    "'metadata[expected_amount]': String(orderTotal)",
    "'metadata[bundle_addon_types]': bundleTypes(selectedAddons)",
    'params[`line_items[${index}][price_data][unit_amount]`] = String(item.priceCents)',
    'checkoutIdempotencyKey(', 'amountTotal: orderTotal',
    'admissionPriceCents: price', 'addonSubtotalCents: addonTotal', 'selectedAddons,',
    'purchaseType: \'admission\'', "'managed_payments[enabled]': 'false'",
    'CART_LOCKED', 'reserveAdmission(', 'attachAdmissionSession('
  ]) assert.ok(checkout.includes(term), 'Checkout must preserve bundled security invariant: ' + term);
  assert.ok(checkout.indexOf('const params = {') < checkout.indexOf('const idempotency = checkoutIdempotencyKey('));
  for (const term of [
    'verifyBundleSnapshot(', 'bundleTypes(bundledAddons)', 'ticketPriceCents:admissionPriceCents',
    'issueBundledAddons(', 'setBundledAddonStatus(', 'refundDuplicate('
  ]) assert.ok(payments.includes(term), 'Fulfillment missing: ' + term);
  const newFulfillment = payments.slice(payments.indexOf('await issueAdmission('));
  assert.ok(newFulfillment.indexOf('await issueAdmission(') < newFulfillment.indexOf('await issueBundledAddons('),
    'Admission must be issued before optional entitlements.');
  assert.ok(payments.indexOf('await issueBundledAddons(') < payments.indexOf('await sendReceipt(event,ticket,application,session,token)'),
    'The ticket receipt must not precede bundled entitlement issuance.');
  for (const term of ['addonCatalog(', 'publicAddon', 'addons:']) assert.ok(access.includes(term));
  for (const term of [
    'admissionPriceCents ?? x.amountTotal', 'addonSubtotalCents || 0',
    'setBundledAddonStatus(', 'BUNDLE_REFUND_REVIEW'
  ]) assert.ok(admin.includes(term), 'Admin reporting/refund invariant missing: ' + term);
  for (const term of ['Selected add-ons:', 'Admission subtotal:', 'Add-on subtotal:', 'Total paid:'])
    assert.ok(receipt.includes(term), 'Receipt line missing: ' + term);
  assert.ok(addonCheckout.includes("purchaseType:'addon'"), 'Later standalone add-on Checkout must remain available.');
  assert.ok(guest.includes('addons: [...chosen]'));
  for (const term of ['bundle-picker', 'addon-options', 'bundle-total-price']) assert.ok(markup.includes(term));
  assert.ok(css.includes('@media(max-width:480px)'));
  assert.ok(inventory.includes('FOR UPDATE'), 'Relational admission locks must remain enabled.');
  assert.ok(webhook.includes('finalizePaidSession(obj'), 'Signed webhook must retain admission finalization.');
  assert.ok(bundle.includes('ensureDrinkLedger('), 'Bundled drink credits require the transactional ledger.');
  assert.ok(bundle.includes('old.paymentId === paymentId'), 'Repeat notifications must never issue duplicate entitlements.');
  console.log('Combined AUREVA admission, optional add-ons, 1-payment pricing, fulfillment and refund guards validated.');
} finally {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
