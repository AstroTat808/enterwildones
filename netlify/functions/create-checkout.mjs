import { disclosureMatches } from './_waiver-evidence.mjs';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { selectBundledAddons, addonSubtotal, bundleTypes } from './_bundled-addons.mjs';
import { resolveEvent } from './_events.mjs';
import { readInviteAccess } from './_invitations.mjs';
import { checkoutAllowed } from './_checkout-access.mjs';
import { makeCheckoutReturn } from './_checkout-return.mjs';
import { currentTicketOffer, ticketPricingSchedule, ticketPriceEnv, ticketProductName, loadInvitation, existingTicketForInvitation, existingTicketForUser, finalizePaidSession } from './_payments.mjs';
import { makeTicketToken } from './_ticket-token.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { checkoutIdempotencyKey, stripeGet, stripePost } from './_stripe.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';
import { reserveAdmission, attachAdmissionSession, releaseAdmission } from './_admission-inventory.mjs';

const CURRENCY = 'usd';
function validSessionId(value = '') { return /^cs_[A-Za-z0-9_]+$/.test(String(value)); }
function sessionMatches(session, eventId, invitationId) { return session?.metadata?.event_id === eventId && session?.metadata?.invitation_id === invitationId && session?.metadata?.purchase_type === 'admission'; }

async function inspectLatestCheckout(latest, event, invitation, requestedAddons = []) {
  if (!latest?.paymentId || !validSessionId(latest.paymentId)) return null;
  let session;
  try { session = await stripeGet(`checkout/sessions/${encodeURIComponent(latest.paymentId)}`); }
  catch { return { error: 'Your previous checkout could not be verified safely. Try again shortly.', status: 503 }; }
  if (!sessionMatches(session, event.eventId, invitation.invitationId)) return { error: 'The previous checkout does not match this invitation.', status: 409 };
  if (session.payment_status === 'paid' || session.status === 'complete') {
    try {
      const result = await finalizePaidSession(session, { source: 'checkout_recovery' });
      const token = result.token || makeTicketToken(result.ticket);
      if (!token) return { error: 'Your payment is confirmed, but the digital ticket could not be opened.', status: 503 };
      const site = (env('WILDONES_SITE_URL') || 'https://enterwildones.com').replace(/\/$/, '');
      return { checkoutUrl: `${site}/ticket?token=${encodeURIComponent(token)}`, reused: true, paid: true };
    } catch {
      return { error: 'Your prior payment may already be complete. Open your confirmation link or contact support before starting another checkout.', status: 409 };
    }
  }
  if (session.status === 'open' && session.url) {
    if (bundleTypes(latest.selectedAddons || []) !== bundleTypes(requestedAddons))
      return { error: 'A secure checkout is already open with a different add-on selection. Complete that checkout or wait until it expires before changing your order.', code: 'CART_LOCKED', status: 409 };
    return { checkoutUrl: session.url, reused: true, paid: false };
  }
  if (session.status && session.status !== 'expired') return { error: 'Your previous checkout is still being resolved. Try again shortly.', status: 409 };
  if (session.status === 'expired') {
    // A signed Stripe response is authoritative. Never release on an unverified timer alone.
    await releaseAdmission({ eventId: event.eventId, invitationId: invitation.invitationId, sessionId: session.id });
  }
  return null;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid checkout request.' }, 400); }

  const event = resolveEvent({ eventId: body.eventId, slug: body.event });
  if (!event || event.visibility !== 'public') return json({ error: 'Event not found.' }, 404);
  if (Date.now() >= new Date(event.endsAt).getTime()) return json({ error: `Ticket sales for ${event.name} have ended.`, code: 'sales_ended' }, 403);

  const schedule = ticketPricingSchedule(event.eventId);
  const hasPhaseSettings = schedule.phases.some((phase) => phase.name || phase.priceCents || phase.endsAt);
  if ((hasPhaseSettings && (!schedule.tiered || !schedule.complete))) {
    return json({error: 'This event pricing schedule is incomplete. Ticket sales are not available.', code: 'pricing_incomplete'}, 503);
  }
  const offer = currentTicketOffer(event.eventId);
  const price = offer?.priceCents || null;
  if (!price) return json({ error: `Ticket price is not configured for ${event.name}.`, code: 'price_not_configured', requiredEnv: ticketPriceEnv(event.eventId) }, 503);
  if (!env('STRIPE_SECRET_KEY') || !env('WILDONES_TICKET_ACCESS_SECRET')) return json({ error: 'Ticket checkout is not configured.' }, 503);

  const access = readInviteAccess(req, event.eventId);
  if (!access) return json({ error: 'Your event access is missing or expired. Re-enter through the event access flow.', code: 'event_access_required' }, 401);
  const invitation = await loadInvitation(event.eventId, access.invitationId);
  if (!invitation || invitation.userId !== access.userId || invitation.applicationId !== access.applicationId || !['redeemed', 'fulfilled'].includes(invitation.status)) return json({ error: 'This event access is not eligible for checkout.' }, 403);
  const user = await blobStore(STORES.users).get(access.userId, { type: 'json' }).catch(() => null);
  const trustedEmail = user?.status === 'active' ? user.email : null;
  if (!checkoutAllowed(event, invitation, trustedEmail)) return json({ error: `Ticket sales for ${event.name} are not open.`, code: 'sales_closed' }, 403);
  if (!invitation.userId || !invitation.applicationId) return json({ error: 'This admission requires a registered Wild Ones identity.', code: 'identity_required' }, 409);
  if (Number(invitation.maxTickets || 1) !== 1) return json({ error: 'Multi-ticket invitations require the group-ticket identity flow and cannot use single-person checkout.', code: 'group_ticket_required' }, 409);

  const existingUserTicket = await existingTicketForUser(event.eventId, invitation.userId);
  if (existingUserTicket && ['paid', 'checked_in'].includes(existingUserTicket.status)) return json({ error: 'This Wild Ones profile already has an active admission for this event.', ticketId: existingUserTicket.ticketId, code: 'user_already_ticketed' }, 409);
  if (invitation.status === 'fulfilled' || Number(invitation.purchaseCount || 0) >= 1) {
    const existing = await existingTicketForInvitation(event.eventId, invitation.invitationId);
    return json({ error: 'This event access has already been used for admission.', ticketId: existing?.ticketId || null }, 409);
  }

  // Never accept prices or quantities from the browser. Optional add-ons are
  // selected by identifier and repriced from the current protected catalog.
  let selectedAddons;
  try { selectedAddons = selectBundledAddons(event.eventId, body.addons ?? []); }
  catch { return json({ error: 'Select only the available add-ons, one of each.', code: 'INVALID_ADDONS' }, 400); }
  const needsLateDisclosure=bundleTypes(selectedAddons).includes('late_stay');
  if(!disclosureMatches(body.waiverDisclosure?.participant,event.eventId,'participant')||(needsLateDisclosure&&!disclosureMatches(body.waiverDisclosure?.late_stay,event.eventId,'late_stay')))return json({error:'Review and acknowledge the current required agreements before checkout.',code:'WAIVER_DISCLOSURE_REQUIRED'},409);
  const waiverDisclosure={participant:{waiverVersion:body.waiverDisclosure.participant.waiverVersion,waiverTextHash:body.waiverDisclosure.participant.waiverTextHash,acknowledged:true},...(needsLateDisclosure?{late_stay:{waiverVersion:body.waiverDisclosure.late_stay.waiverVersion,waiverTextHash:body.waiverDisclosure.late_stay.waiverTextHash,acknowledged:true}}:{}),acknowledgedAt:new Date().toISOString()};
  const addonTotal = addonSubtotal(selectedAddons);
  const orderTotal = price + addonTotal;

  const latestKey = eventKey(event.eventId, `checkout-latest/${invitation.invitationId}`);
  const payments = blobStore(STORES.payments);
  const latest = await payments.get(latestKey, { type: 'json' }).catch(() => null);
  const prior = await inspectLatestCheckout(latest, event, invitation, selectedAddons);
  if (prior) {
    if (prior.error) return json({ error: prior.error, code: prior.code || 'CHECKOUT_UNAVAILABLE' }, prior.status || 409);
    return json({ ok: true, checkoutUrl: prior.checkoutUrl, reused: true, paid: Boolean(prior.paid) });
  }

  const returnToken = makeCheckoutReturn({ eventId: event.eventId, invitationId: invitation.invitationId });
  if (!returnToken) return json({ error: 'Secure checkout return could not be initialized.' }, 503);
  const site = (env('WILDONES_SITE_URL') || new URL(req.url).origin).replace(/\/$/, '');
  const attempt = Number(latest?.attempt || 0) + 1;
  const stripeExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  try {
    await reserveAdmission({
      eventId: event.eventId,
      invitationId: invitation.invitationId,
      userId: invitation.userId,
      expiresAt: new Date(stripeExpiresAt * 1000).toISOString()
    });
  } catch (error) {
    return json({ error: error.message || 'Admission inventory unavailable.', code: error.code || 'INVENTORY_UNAVAILABLE' }, error.status || 503);
  }
  const tierName = offer.name || 'GENERAL ADMISSION';
  const tierPhase = Number.isInteger(offer.phase) ? offer.phase : 0;
  const tierCode = tierName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);

  const params = {
    mode: 'payment',
    // Event admission is an in-person service, not an eligible digital Managed Payments product.
    // Stripe may enable Managed Payments by default on new accounts; explicitly opt out.
    'managed_payments[enabled]': 'false',
    success_url: `${site}/ticket-confirmed?session_id={CHECKOUT_SESSION_ID}&return_token=${encodeURIComponent(returnToken)}`,
    cancel_url: `${site}/events/${event.slug}?checkout=cancelled`,
    client_reference_id: invitation.invitationId,
    expires_at: String(stripeExpiresAt),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': CURRENCY,
    'line_items[0][price_data][unit_amount]': String(price),
    'line_items[0][price_data][product_data][name]': ticketProductName(event, offer),
    'metadata[event_id]': event.eventId,
    'metadata[invitation_id]': invitation.invitationId,
    'metadata[application_id]': invitation.applicationId,
    'metadata[user_id]': invitation.userId,
    'metadata[purchase_type]': 'admission',
    'metadata[expected_amount]': String(orderTotal),
    'metadata[admission_amount]': String(price),
    'metadata[addon_amount]': String(addonTotal),
    'metadata[bundle_addon_types]': bundleTypes(selectedAddons),
    'metadata[expected_currency]': CURRENCY,
    'metadata[ticket_tier]': String(tierPhase),
    'metadata[ticket_tier_name]': tierName,
    'metadata[ticket_tier_code]': tierCode,
    'payment_intent_data[metadata][event_id]': event.eventId,
    'payment_intent_data[metadata][invitation_id]': invitation.invitationId,
    'payment_intent_data[metadata][application_id]': invitation.applicationId,
    'payment_intent_data[metadata][user_id]': invitation.userId,
    'payment_intent_data[metadata][purchase_type]': 'admission',
    'payment_intent_data[metadata][bundle_addon_types]': bundleTypes(selectedAddons),
    'payment_intent_data[metadata][ticket_tier]': String(tierPhase),
    'payment_intent_data[metadata][ticket_tier_name]': tierName
  };

  // One Stripe charge, itemized separately for admission and each selected extra.
  selectedAddons.forEach((item, offset) => {
    const index = offset + 1;
    params[`line_items[${index}][quantity]`] = '1';
    params[`line_items[${index}][price_data][currency]`] = CURRENCY;
    params[`line_items[${index}][price_data][unit_amount]`] = String(item.priceCents);
    params[`line_items[${index}][price_data][product_data][name]`] = item.name;
    params[`line_items[${index}][price_data][product_data][description]`] = item.description;
  });

  // An earlier failed attempt may have reused this attempt number with different
  // Stripe parameters. Hash the exact payload to avoid Stripe's idempotency conflict.
  const idempotency = checkoutIdempotencyKey(`wildones-${event.eventId}-${invitation.invitationId}-${attempt}`, params);
  try {
    const session = await stripePost('checkout/sessions', params, idempotency);
    if (!sessionMatches(session, event.eventId, invitation.invitationId) || String(session.currency || CURRENCY).toLowerCase() !== CURRENCY) throw new Error('Stripe returned a checkout identity mismatch.');
    await attachAdmissionSession({ eventId: event.eventId, invitationId: invitation.invitationId, userId: invitation.userId, sessionId: session.id });
    const now = new Date().toISOString();
    const record = {
      paymentId: session.id,
      eventId: event.eventId,
      invitationId: invitation.invitationId,
      applicationId: invitation.applicationId,
      userId: invitation.userId,
      status: 'checkout_created',
      attempt,
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : new Date(stripeExpiresAt * 1000).toISOString(),
      amountTotal: orderTotal,
      admissionPriceCents: price,
      addonSubtotalCents: addonTotal,
      selectedAddons,
      waiverDisclosure,
      purchaseType: 'admission',
      currency: CURRENCY,
      ticketTier: tierPhase,
      ticketTierName: tierName,
      ticketTierCode: tierCode,
      ticketTierEndsAt: offer.endsAt || null,
      createdAt: now,
      updatedAt: now
    };
    await Promise.all([payments.setJSON(eventKey(event.eventId, session.id), record), payments.setJSON(latestKey, record)]);
    await writeAudit({ eventId: event.eventId, action: 'checkout.created', actor: 'guest', targetType: 'payment', targetId: session.id, detail: { invitationId: invitation.invitationId, attempt, ticketTier: tierPhase, ticketTierName: tierName, admissionPriceCents: price, addonSubtotalCents: addonTotal, amountTotal: orderTotal, addonTypes: bundleTypes(selectedAddons), commissioning: !event.ticketSalesOpen } });
    return json({ ok: true, checkoutUrl: session.url, reused: false });
  } catch (error) {
    // Never expose Stripe's internal messages, API URLs or idempotency keys to guests.
    // Log safe diagnostics for operators without including the request body or secrets.
    const stripeStatus = Number(error?.stripeHttpStatus) || null;
    const definitiveStripeRejection = stripeStatus >= 400 && stripeStatus < 500
      && stripeStatus !== 429 && error?.stripeCode !== 'idempotency_error';
    console.error('Admission checkout failed', {
      eventId: event.eventId, attempt, stripeStatus,
      stripeCode: error?.stripeCode || null, stripeRequestId: error?.stripeRequestId || null
    });
    // Idempotency conflicts and rate limits do NOT prove that an earlier
    // Checkout session was never created. Retain the hold for reconciliation.
    // On a definitive rejection, permit a retry only after the database
    // confirms its corresponding held admission was actually released.
    let holdReleased = false;
    if (definitiveStripeRejection) {
      holdReleased = await releaseAdmission({ eventId: event.eventId, invitationId: invitation.invitationId }).catch(() => false);
    }
    const retryAllowed = definitiveStripeRejection && holdReleased;
    return json({
      error: retryAllowed
        ? 'Secure checkout could not be prepared. Please try again.'
        : 'We could not confirm your checkout status. Please contact support before trying another payment.',
      code: retryAllowed ? 'CHECKOUT_UNAVAILABLE' : 'CHECKOUT_RECONCILIATION_REQUIRED'
    }, retryAllowed ? 502 : 503);
  }
};

export const config = { path: '/api/ticket/checkout' };
