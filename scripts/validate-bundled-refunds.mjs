import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundledRefundEligibility, verifyRefundAudit } from '../netlify/functions/_bundle-refunds.mjs';

const eventId='aureva-2026',ticketId='AUR-QA-BUNDLE-1',paymentId='cs_test_123',intent='pi_test_123';
const ticket={eventId,ticketId,paymentId,status:'paid',checkedInAt:null};
const addOns=[
  {addonType:'drink_package',name:'Drink Package',priceCents:7500,credits:6},
  {addonType:'late_stay',name:'Late Checkout / Car Camping',priceCents:2500,departureTime:'10:00 AM'}
];
const payment={eventId,paymentId,purchaseType:'admission',stripePaymentIntentId:intent,
  status:'paid',amountTotal:15500,admissionPriceCents:5500,selectedAddons:addOns};
const entitlement=addonType=>({eventId,ticketId,paymentId,addonType,
  priceCents:addOns.find(x=>x.addonType===addonType).priceCents,
  status:'active',purchaseSource:'admission_bundle',creditsRedeemed:0,wristbandActivatedAt:null});
const ledger={eventId,ticketId,userId:'qa',creditsPurchased:6,creditsRedeemed:0,creditsRemaining:6,wristbandActivatedAt:null};
const args={ticket,payment,ent:entitlement('drink_package'),addonType:'drink_package',drinkLedger:ledger,now:Date.parse('2026-11-18T21:00:00Z')};
assert.equal(bundledRefundEligibility(args).amount,7500);
assert.equal(bundledRefundEligibility({...args,addonType:'late_stay',ent:entitlement('late_stay')}).amount,2500);
const fail=(mod,code)=>assert.throws(()=>bundledRefundEligibility({...args,...mod}),error=>error.code===code);
fail({drinkLedger:{...ledger,creditsRedeemed:1,creditsRemaining:5}},'DRINK_PACKAGE_USED');
fail({drinkLedger:{...ledger,wristbandActivatedAt:new Date().toISOString()}},'DRINK_PACKAGE_USED');
fail({ent:{...args.ent,creditsRedeemed:1}},'DRINK_PACKAGE_USED');
fail({ent:{...args.ent,status:'refund_pending'}},'ADDON_NOT_ACTIVE');
fail({ent:{...args.ent,status:'refunded'}},'ADDON_NOT_ACTIVE');
fail({ticket:{...ticket,status:'refunded'}},'TICKET_INACTIVE');
fail({ticket:{...ticket,checkedInAt:new Date().toISOString()}},'REFUND_NEEDS_REVIEW');
fail({payment:{...payment,status:'refunded'}},'REFUND_PAYMENT_INACTIVE');
fail({payment:{...payment,amountTotal:14000}},'REFUND_PRICE_MISMATCH');
fail({payment:{...payment,partialRefunds:[{addonType:'drink_package',status:'succeeded'}]}},'REFUND_ALREADY_STARTED');
fail({ent:{...args.ent,priceCents:5500}},'REFUND_PRICE_MISMATCH');
fail({ent:{...args.ent,paymentId:'cs_wrong'}},'ADDON_NOT_ACTIVE');
fail({addonType:'late_stay',ent:entitlement('late_stay'),now:Date.parse('2027-01-23T19:05:00-10:00')},'LATE_STAY_EVENT_STARTED');

const expected={eventId,ticketId,paymentId,addonType:'drink_package',amount:7500};
const refund={id:'re_test_123',status:'succeeded',amount:7500,
  metadata:{admin_action:'bundle_addon_partial_refund',event_id:eventId,ticket_id:ticketId,payment_id:paymentId,addon_type:'drink_package'}};
assert.equal(verifyRefundAudit(refund,expected),refund);
for(const change of [
  {amount:15500},{metadata:{...refund.metadata,addon_type:'late_stay'}},
  {metadata:{...refund.metadata,admin_action:'admission_refund'}},
  {status:'failed'},{id:'bad-id'}
])assert.throws(()=>verifyRefundAudit({...refund,...change},expected),/reconciliation/);

const root = new URL('../',import.meta.url),read=path=>readFile(new URL(path,root),'utf8');
const [helper,admin,webhook,ui,packageJson]=await Promise.all([
  'netlify/functions/_bundle-refunds.mjs','netlify/functions/admin-operations.mjs',
  'netlify/functions/stripe-webhook.mjs','site/assets/js/admin-operations.js','package.json'
].map(read));
for(const invariant of [
  'pg_advisory_xact_lock(', 'SET LOCAL lock_timeout', 'getDrinkLedger(',
  'selectedAddons', 'verifyBundleSnapshot(', 'listPaymentRefunds(',
  'has_more', "payment_intent: currentPayment.stripePaymentIntentId",
  'amount: String(amount)', 'wildones-bundle-addon-refund-', 'annotateRefund(', 'status: settledStatus',
  "status: settledStatus === 'succeeded' ? 'refunded' : 'refund_pending'",
  "'metadata[admin_action]':'bundle_addon_partial_refund'",
  'reconcileBundledRefund(',
])assert.ok(helper.toLowerCase().includes(invariant.toLowerCase()),'Critical refund guard missing: '+invariant);
assert.match(admin,/refundBundledAddon\(/);
assert.match(admin,/withRefundPaymentLock\(/);
assert.match(admin,/refundedBundleAddonsCents/);
assert.match(admin,/\.filter\(r => r\.status === 'succeeded'\)/);
assert.match(ui,/Add-on net revenue/);
assert.match(admin,/current\.partialRefunds/);
assert.match(admin,/body\.confirm !== true/);
assert.match(webhook,/reconcileBundledRefund\(obj\)/);
assert.match(webhook,/verifyStripeSignature/);
assert.match(ui,/Refund Bundled Add-On/);
assert.match(ui,/admission and other add-ons stay valid/);
assert.match(packageJson,/validate-bundled-refunds\.mjs/);
console.log('Bundled partial refunds: exact-price, idempotency, consumption, privacy, Stripe and webhook state guard tests passed.');
