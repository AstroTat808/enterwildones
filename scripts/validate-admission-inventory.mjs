import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const envPrefix = 'WILDONES_AUREVA_2026_';
const envKey = envPrefix + 'TICKET_CAPACITY';
const priceKeys = [
  'TICKET_PHASE1_NAME', 'TICKET_PHASE1_PRICE_CENTS', 'TICKET_PHASE1_ENDS_AT',
  'TICKET_PHASE2_NAME', 'TICKET_PHASE2_PRICE_CENTS', 'TICKET_PHASE2_ENDS_AT',
  'TICKET_PHASE3_NAME', 'TICKET_PHASE3_PRICE_CENTS'
].map((key) => envPrefix + key);
const original = new Map([envKey, ...priceKeys].map((key) => [key, process.env[key]]));
function set(k,v) { if (v === null) delete process.env[k]; else process.env[k] = String(v); }
try {
  set(envKey,null);
  const { admissionCapacity } = await import('../netlify/functions/_admission-inventory.mjs');
  const eventId = 'aureva-2026';
  assert.equal(admissionCapacity(eventId),null,'Missing capacity must fail closed');
  for (const bad of ['0','-1','001','1.5','350xyz','Infinity','100001','9007199254740993','']) {
    set(envKey,bad);
    assert.equal(admissionCapacity(eventId),null,`Invalid capacity must fail closed: ${bad}`);
  }
  set(envKey,'350');
  assert.equal(admissionCapacity(eventId),350);
  set(envKey,'1');
  assert.equal(admissionCapacity(eventId),1);

  // Admission phases and Checkout use the same server-side pricing model.
  const {requireEvent}=await import('../netlify/functions/_events.mjs');
  assert.equal(requireEvent(eventId).startsAt,'2026-12-19T15:00:00-10:00');
  assert.equal(requireEvent(eventId).endsAt,'2026-12-20T03:00:00-10:00');
  const { ticketPricingSchedule, currentTicketOffer } = await import('../netlify/functions/_payments.mjs');
  const phase = {
    TICKET_PHASE1_NAME:'FIRST LIGHT RELEASE', TICKET_PHASE1_PRICE_CENTS:'5500',
    TICKET_PHASE1_ENDS_AT:'2026-10-16T00:00:00-10:00',
    TICKET_PHASE2_NAME:'FULL RADIANCE', TICKET_PHASE2_PRICE_CENTS:'7000',
    TICKET_PHASE2_ENDS_AT:'', TICKET_PHASE3_NAME:'', TICKET_PHASE3_PRICE_CENTS:''
  };
  for (const [key,value] of Object.entries(phase)) set(envPrefix + key,value);
  const schedule=ticketPricingSchedule(eventId);
  assert.equal(schedule.tiered,true);
  assert.equal(schedule.complete,true);
  assert.equal(currentTicketOffer(eventId,Date.parse('2026-10-15T23:59:59-10:00')).priceCents,5500);
  assert.equal(currentTicketOffer(eventId,Date.parse('2026-10-16T00:00:00-10:00')).priceCents,7000);
  assert.equal(currentTicketOffer(eventId,Date.parse('2026-10-15T12:00:00-10:00')).next.priceCents,7000);
  set(envPrefix+'TICKET_PHASE3_PRICE_CENTS','8000');
  assert.equal(ticketPricingSchedule(eventId).complete,false,'A partially configured ZENITH phase must fail validation');

  const root=new URL('../',import.meta.url);
  const contents=async(path)=>readFile(new URL(path,root),'utf8');
  const [migration,inventory,checkout,payments,webhook,operations,readiness,dashboard] = await Promise.all([
    'netlify/database/migrations/003_admission-capacity/migration.sql',
    'netlify/functions/_admission-inventory.mjs',
    'netlify/functions/create-checkout.mjs',
    'netlify/functions/_payments.mjs',
    'netlify/functions/stripe-webhook.mjs',
    'netlify/functions/admin-operations.mjs',
    'netlify/functions/admin-readiness.mjs',
    'site/assets/js/admin-command.js'
  ].map(contents));
  for (const token of ['CREATE TABLE IF NOT EXISTS wildones_event_capacity','wildones_admission_reservations','UNIQUE INDEX','status IN (\'held\',\'issued\')']) {
    assert.ok(migration.includes(token),`Missing relational safety contract: ${token}`);
  }
  for (const token of ['FOR UPDATE','reserveAdmission','issueAdmission','issueCompAdmission','releaseAdmission','commissionAdmissionInventory','INVENTORY_NOT_COMMISSIONED','CAPACITY_UNCONFIGURED','SOLD_OUT','DUPLICATE_ADMISSION']) {
    assert.ok(inventory.includes(token),`Missing inventory contract: ${token}`);
  }
  for (const token of ['reserveAdmission(','attachAdmissionSession(','releaseAdmission(']) {
    assert.ok(checkout.includes(token),`Checkout missing inventory step: ${token}`);
  }
  assert.ok(checkout.indexOf('await reserveAdmission(') < checkout.indexOf("stripePost('checkout/sessions'"),'Capacity must be reserved before Checkout session');
  assert.ok(payments.includes('await issueAdmission('),'Paid fulfillment must claim seat first');
  assert.ok(webhook.includes('checkout.session.expired')&&webhook.includes('checkout.session.async_payment_failed')&&webhook.includes('releaseAdmission('),'Stripe terminal events must release held inventory');
  assert.ok(operations.includes('await issueCompAdmission('),'Complimentary tickets must consume capacity');
  assert.ok(operations.includes('await releaseAdmission('),'Admin refunds must release capacity');
  assert.ok(readiness.includes('inventoryReconciled')&&readiness.includes('ticketPricingSchedule(eventId)'),'Launch must fail closed for capacity or incomplete tiers');
  assert.ok(dashboard.includes('Ticket capacity')&&dashboard.includes('Available seats')&&dashboard.includes('commission_inventory'),'Admin dashboard must present inventory and audited commissioning');
  assert.ok(readiness.includes('commissionAdmissionInventory')&&readiness.includes('commission_inventory')&&readiness.includes('COMMISSION '),'Admin commissioning requires explicit authorization and reconciliation');
  assert.ok(migration.includes('commissioned BOOLEAN NOT NULL DEFAULT FALSE'),'Inventory must be uncommissioned by default');
  assert.ok(checkout.includes('pricing_incomplete'),'Incomplete price phases must fail checkout closed');
  console.log('AUREVA admission/price contract checks passed. Requires Neon concurrency/integration certification before production GO.');
} finally {
  for (const [key,value] of original) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
}
