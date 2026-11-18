import { Pool } from '@neondatabase/serverless';
import { env } from './_env.mjs';
import { blobStore } from './_blob-store.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { stripeGet, stripePost } from './_stripe.mjs';
import { getDrinkLedger } from './_drink-ledger.mjs';
import { getEvent } from './_events.mjs';
import { writeAudit } from './_audit.mjs';
import { verifyBundleSnapshot } from './_bundled-addons.mjs';

function fail(code, message) {
  const error = new Error(message); error.code = code; error.status = 409; throw error;
}

// The exact same relational transaction lock must wrap *every* admin refund
// against this payment, including full-order and individual add-on refunds.
export async function withRefundPaymentLock(eventId, paymentId, operation) {
  const url = env('DATABASE_URL');
  if (!url) fail('REFUND_DATABASE_UNAVAILABLE', 'Refund coordination database is unavailable.');
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL lock_timeout = \'5000ms\'');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [eventId, paymentId]);
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

export function bundledRefundEligibility({ ticket, payment, ent, addonType, drinkLedger, now = Date.now() }) {
  if (!ticket || !['paid', 'checked_in'].includes(ticket.status))
    fail('TICKET_INACTIVE', 'An active admission is required for an add-on refund.');
  if (ticket.checkedInAt || ticket.status === 'checked_in')
    fail('REFUND_NEEDS_REVIEW', 'An already checked-in ticket requires manual review.');
  if (!ent || ent.addonType !== addonType || ent.status !== 'active' || ent.purchaseSource !== 'admission_bundle' ||
      ent.ticketId !== ticket.ticketId || ent.eventId !== ticket.eventId || ent.paymentId !== ticket.paymentId)
    fail('ADDON_NOT_ACTIVE', 'The bundled add-on is not eligible for refund.');
  if (!payment || payment.purchaseType !== 'admission' || payment.status !== 'paid' ||
      payment.paymentId !== ticket.paymentId || !payment.stripePaymentIntentId ||
      !String(payment.stripePaymentIntentId).startsWith('pi_'))
    fail('REFUND_PAYMENT_INACTIVE', 'An active, confirmed bundled payment is required.');
  const selected = payment.selectedAddons || [];
  try { verifyBundleSnapshot(selected, Number(payment.admissionPriceCents), Number(payment.amountTotal)); }
  catch { fail('REFUND_PRICE_MISMATCH', 'Original bundled item prices do not reconcile.'); }
  const item = selected.find(x => x.addonType === addonType);
  if (!item || Number(ent.priceCents) !== Number(item.priceCents))
    fail('REFUND_PRICE_MISMATCH', 'The original purchased add-on amount could not be confirmed.');
  if ((payment.partialRefunds || []).some(x => x.addonType === addonType && x.status !== 'failed'))
    fail('REFUND_ALREADY_STARTED', 'A partial refund already exists for this add-on.');
  if (addonType === 'drink_package') {
    if (!drinkLedger || drinkLedger.ticketId !== ticket.ticketId ||
        Number(drinkLedger.creditsPurchased) !== Number(item.credits) ||
        Number(drinkLedger.creditsRemaining) !== Number(item.credits) ||
        Number(drinkLedger.creditsRedeemed) !== 0 || drinkLedger.wristbandActivatedAt ||
        Number(ent.creditsRedeemed || 0) > 0 || ent.wristbandActivatedAt) {
      fail('DRINK_PACKAGE_USED', 'Activated or consumed drink credits require manual review.');
    }
  } else if (addonType === 'late_stay') {
    const event = getEvent(ticket.eventId);
    if (!event || now >= Date.parse(event.startsAt))
      fail('LATE_STAY_EVENT_STARTED', 'Late checkout requires manual review after the event has begun.');
  } else fail('UNKNOWN_BUNDLE_ADDON', 'The requested add-on is not refundable here.');
  return { item, amount: item.priceCents };
}

function refundMatches(r, eventId, ticketId, addonType, paymentId) {
  return r?.metadata?.admin_action === 'bundle_addon_partial_refund' &&
    r.metadata.event_id === eventId && r.metadata.ticket_id === ticketId &&
    r.metadata.addon_type === addonType && r.metadata.payment_id === paymentId;
}
export function verifyRefundAudit(refund, expected) {
  if (!refund || !/^re_/.test(String(refund.id)) ||
      !refundMatches(refund, expected.eventId, expected.ticketId, expected.addonType, expected.paymentId) ||
      Number(refund.amount) !== Number(expected.amount) ||
      !['succeeded', 'pending', 'requires_action'].includes(refund.status)) {
    fail('REFUND_RECONCILIATION_REQUIRED', 'Stripe refund details require manual reconciliation.');
  }
  return refund;
}

export async function listPaymentRefunds(paymentIntentId) {
  // Stripe supports filtering refunds by their original payment_intent.
  const out = await stripeGet('refunds?payment_intent=' + encodeURIComponent(paymentIntentId) + '&limit=100');
  if (out.has_more) fail('REFUND_HISTORY_TRUNCATED', 'Refund history is too long for automatic reconciliation.');
  return out.data || [];
}

async function annotateRefund({ eventId, ticketId, paymentId, addonType, refund }) {
  const store = blobStore(STORES.payments), key = eventKey(eventId, paymentId);
  const payment = await store.get(key, { type: 'json' });
  if (!payment) fail('REFUND_PAYMENT_MISSING', 'The refund payment record was not found.');
  const history = Array.isArray(payment.partialRefunds) ? payment.partialRefunds : [];
  const previous = history.find(x => x.refundId === refund.id);
  if (previous?.status === 'succeeded' && refund.status === 'succeeded') return payment;
  const settledStatus = previous?.status === 'succeeded' ? 'succeeded' : refund.status;
  const entry = { refundId: refund.id, addonType, amount: Number(refund.amount), status: settledStatus, updatedAt: new Date().toISOString() };
  const updated = { ...payment, partialRefund: true, partialRefunds: [...history.filter(x => x.refundId !== refund.id), entry],
    updatedAt: new Date().toISOString() };
  await store.setJSON(key, updated);
  const entStore = blobStore(STORES.entitlements), entKey = eventKey(eventId, ticketId + '/' + addonType);
  const ent = await entStore.get(entKey, { type: 'json' });
  if (ent?.paymentId === paymentId && !['refunded', 'disputed'].includes(ent.status)) {
    await entStore.setJSON(entKey, { ...ent, status: settledStatus === 'succeeded' ? 'refunded' : 'refund_pending',
      ...(settledStatus === 'succeeded' ? { refundedAt: new Date().toISOString() } : {}),
      refundId: refund.id, updatedAt: new Date().toISOString() });
  }
  await writeAudit({ eventId, action: 'addon.bundle_partial_refund_' + refund.status, actor: 'stripe',
    targetType: 'ticket', targetId: ticketId, detail: { addonType, paymentId, refundId: refund.id, amountCents: Number(refund.amount) } });
  return updated;
}

export async function refundBundledAddon({ eventId, ticketId, addonType, ticket, payment, entitlement }) {
  return withRefundPaymentLock(eventId, payment.paymentId, async () => {
    // Reload all Blob records *under the same lock*, never trust the initial
    // snapshot obtained by the admin request.
    const payStore = blobStore(STORES.payments);
    const currentPayment = await payStore.get(eventKey(eventId, payment.paymentId), { type: 'json' });
    const currentTicket = await blobStore(STORES.tickets).get(eventKey(eventId, ticketId), { type: 'json' });
    const currentEnt = await blobStore(STORES.entitlements).get(eventKey(eventId, ticketId + '/' + addonType), { type: 'json' });
    const ledger = addonType === 'drink_package' ? await getDrinkLedger(eventId, ticketId) : null;
    const { amount } = bundledRefundEligibility({
      ticket: currentTicket, payment: currentPayment, ent: currentEnt, addonType, drinkLedger: ledger
    });
    // Fail closed if ANY unexpected external refund already exists. A refund
    // performed outside this admin interface must be reconciled manually.
    const refunds = await listPaymentRefunds(currentPayment.stripePaymentIntentId);
    const selected = currentPayment.selectedAddons || [];
    for (const candidate of refunds) {
      const original = selected.find(x => refundMatches(candidate,eventId,ticketId,x.addonType,currentPayment.paymentId));
      if (!original || Number(candidate.amount) !== Number(original.priceCents) ||
          !['pending','succeeded','requires_action'].includes(candidate.status))
        fail('REFUND_EXISTING', 'Unexpected Stripe refunds require operator reconciliation.');
    }
    const matching = refunds.find(r => refundMatches(r,eventId,ticketId,addonType,currentPayment.paymentId));
    if (matching) {
      const expected = { eventId,ticketId,addonType,paymentId:currentPayment.paymentId,amount };
      const verified = verifyRefundAudit(matching,expected);
      await annotateRefund({ ...expected,refund:verified });
      return { ok:true,refunded:verified.status==='succeeded',status:verified.status,refundId:verified.id,amountCents:amount,duplicate:true };
    }
    const refund = await stripePost('refunds', {
      payment_intent: currentPayment.stripePaymentIntentId,
      amount: String(amount), reason: 'requested_by_customer',
      'metadata[admin_action]':'bundle_addon_partial_refund',
      'metadata[event_id]':eventId,'metadata[ticket_id]':ticketId,
      'metadata[payment_id]':currentPayment.paymentId,
      'metadata[addon_type]':addonType
    }, 'wildones-bundle-addon-refund-' + currentPayment.paymentId + '-' + addonType);
    const expected = { eventId, ticketId, addonType, paymentId:currentPayment.paymentId, amount };
    const verified = verifyRefundAudit(refund, expected);
    await annotateRefund({ ...expected, refund: verified });
    return { ok: true, refunded:verified.status === 'succeeded', status:verified.status, refundId:verified.id, amountCents:amount, remainingAdmissionActive:true };
  });
}

export async function reconcileBundledRefund(refund) {
  if (refund?.metadata?.admin_action !== 'bundle_addon_partial_refund') return { ignored:true };
  const { event_id:eventId, ticket_id:ticketId, payment_id:paymentId, addon_type:addonType } = refund.metadata;
  if (!getEvent(eventId) || !ticketId || !paymentId) fail('INVALID_REFUND', 'Unknown bundled refund metadata.');
  return withRefundPaymentLock(eventId,paymentId,async () => {
    const payment = await blobStore(STORES.payments).get(eventKey(eventId,paymentId), { type:'json' });
    const ticket = await blobStore(STORES.tickets).get(eventKey(eventId,ticketId), { type:'json' });
    if (!payment || !ticket || ticket.paymentId !== paymentId ||
        payment.stripePaymentIntentId !== refund.payment_intent) fail('REFUND_PAYMENT_MISMATCH', 'Refund identity does not match a ticket payment.');
    const item = (payment.selectedAddons || []).find(x => x.addonType === addonType);
    if (!item) fail('REFUND_ADDON_MISSING','Refund add-on not found on original order.');
    const expected = { eventId,ticketId,paymentId,addonType,amount:item.priceCents };
    if (refund.status === 'failed' || refund.status === 'canceled') {
      // Do not restore the benefit automatically: the refund may have failed
      // while the guest was expecting cancellation. Require operator review.
      await writeAudit({ eventId,action:'addon.bundle_partial_refund_failed',
        actor:'stripe',targetType:'ticket',targetId:ticketId,detail:{refundId:refund.id,addonType} });
      return { failed:true };
    }
    verifyRefundAudit(refund,expected);
    await annotateRefund({ ...expected,refund });
    return { status:refund.status };
  });
}
