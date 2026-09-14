import { isAdmin } from './_admin-auth.mjs';
import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { getEvent, listEvents, toPublicEvent } from './_events.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES } from './_stores.mjs';
import { listDrinkLedgers } from './_drink-ledger.mjs';
import { writeAudit } from './_audit.mjs';

const REHEARSAL_STORE = 'wildones-rehearsal';
const ACTIVE = new Set(['paid', 'checked_in']);
const MANUAL_ITEMS = Object.freeze([
  ['invitation-approval', 'Invitation → approval → invite', 'Approve a controlled applicant and redeem the issued invitation.'],
  ['stripe-checkout', 'Stripe checkout', 'Complete a controlled Stripe sandbox checkout and confirm fulfillment.'],
  ['waiver-qr', 'Waiver → QR unlock', 'Sign the waiver and verify the QR becomes available only afterward.'],
  ['wallet-install', 'Apple Wallet', 'Install the resulting pass on a physical iPhone and open it successfully.'],
  ['gate-scan', 'Gate scan', 'Scan the ticket on a physical gate device and verify duplicate-scan handling.'],
  ['drink-package', 'Drink package purchase', 'Purchase a controlled drink package and verify the entitlement.'],
  ['bartender-redemption', 'Bartender redemption', 'Activate a wristband and redeem credits from the bartender console.'],
  ['refund', 'Admission + add-on refund', 'Refund controlled admission/add-ons and verify ticket and entitlement state.'],
  ['failed-payment', 'Failure drill', 'Exercise cancelled/failed payment behavior without issuing admission.'],
  ['offline-fallback', 'Event-day fallback', 'Verify manual token entry and the documented recovery path if camera/network access fails.']
]);

async function records(storeName, eventId) {
  const store = blobStore(storeName);
  const listed = await store.list({ prefix: `${eventId}/` });
  const out = [];
  for (const { key } of listed.blobs || []) {
    const record = await store.get(key, { type: 'json' }).catch(() => null);
    if (record?.eventId === eventId) out.push(record);
  }
  return out;
}

function configured(...keys) { return keys.every((key) => Boolean(env(key))); }
function eventPrefix(eventId) { return String(eventId || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toUpperCase(); }
function stripeMode() {
  const key = String(env('STRIPE_SECRET_KEY') || '');
  return key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : key ? 'configured' : 'missing';
}
function itemState(runbook, id) { return runbook.items.find((item) => item.id === id)?.status || 'pending'; }
function light(id, label, state, detail) { return { id, label, state, detail }; }
function runbookLight(runbook, id, label) {
  const status = itemState(runbook, id);
  return light(id, label, status === 'passed' ? 'green' : status === 'failed' ? 'red' : 'yellow', status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed — resolve before GO' : 'Pending physical verification');
}

async function rehearsal(eventId) {
  const stored = await blobStore(REHEARSAL_STORE).get(eventId, { type: 'json' }).catch(() => null);
  const saved = stored?.items && typeof stored.items === 'object' ? stored.items : {};
  const items = MANUAL_ITEMS.map(([id, label, detail]) => ({
    id, label, detail,
    status: ['passed', 'failed'].includes(saved[id]?.status) ? saved[id].status : 'pending',
    note: String(saved[id]?.note || ''),
    updatedAt: saved[id]?.updatedAt || null
  }));
  const passed = items.filter((item) => item.status === 'passed').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const pending = items.length - passed - failed;
  return { items, tester: String(stored?.tester || ''), updatedAt: stored?.updatedAt || null, passed, failed, pending, percent: items.length ? Math.round(passed / items.length * 100) : 0, ready: failed === 0 && pending === 0 };
}

async function snapshot(event) {
  const eventId = event.eventId;
  const [apps, invites, tickets, payments, entitlements, checkins, ledgers] = await Promise.all([
    records(STORES.applications, eventId), records(STORES.invitations, eventId), records(STORES.tickets, eventId), records(STORES.payments, eventId), records(STORES.entitlements, eventId), records(STORES.checkins, eventId), listDrinkLedgers(eventId).catch(() => [])
  ]);
  const appById = new Map(apps.map((app) => [app.applicationId, app]));
  const activeTickets = tickets.filter((ticket) => ACTIVE.has(ticket.status));
  const signed = activeTickets.filter((ticket) => ticket.waiverSignedAt).length;
  const checked = activeTickets.filter((ticket) => ticket.status === 'checked_in' || ticket.checkedInAt).length;
  const admissionRevenue = payments.filter((payment) => payment.status === 'paid' && payment.purchaseType !== 'addon').reduce((total, payment) => total + Number(payment.amountTotal || 0), 0);
  const addonRevenue = payments.filter((payment) => payment.status === 'paid' && payment.purchaseType === 'addon').reduce((total, payment) => total + Number(payment.amountTotal || 0), 0);
  const activeDrink = entitlements.filter((entitlement) => entitlement.addonType === 'drink_package' && entitlement.status === 'active');
  const recentCheckins = activeTickets.filter((ticket) => ticket.checkedInAt).sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt))).slice(0, 12).map((ticket) => ({ ticketId: ticket.ticketId, guestName: appById.get(ticket.applicationId)?.fullName || 'Guest', checkedInAt: ticket.checkedInAt }));
  const recentWristbands = ledgers.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 12);
  return {
    counts: {
      applications: apps.length,
      approved: apps.filter((app) => ['approved', 'public_sale'].includes(app.status) || ['approved', 'public_sale'].includes(app.decision)).length,
      invitations: invites.length,
      activeTickets: activeTickets.length,
      checkedIn: checked,
      unsignedWaivers: Math.max(0, activeTickets.length - signed),
      signedWaivers: signed,
      refundedTickets: tickets.filter((ticket) => ticket.status === 'refunded' || ticket.refundedAt).length,
      activeAddons: entitlements.filter((entitlement) => entitlement.status === 'active').length,
      activeDrinkPackages: activeDrink.length,
      activeWristbands: ledgers.filter((ledger) => ledger.wristbandActivatedAt).length,
      creditsRedeemed: ledgers.reduce((total, ledger) => total + Number(ledger.creditsRedeemed || 0), 0),
      creditsRemaining: ledgers.reduce((total, ledger) => total + Number(ledger.creditsRemaining || 0), 0),
      checkinRecords: checkins.length
    },
    revenue: { admissionCents: admissionRevenue, addonCents: addonRevenue, totalCents: admissionRevenue + addonRevenue },
    recentCheckins,
    recentWristbands
  };
}

function readiness(event) {
  const prefix = eventPrefix(event.eventId);
  const config = {
    database: configured('DATABASE_URL'),
    admin: configured('WILDONES_ADMIN_KEY', 'WILDONES_ADMIN_SESSION_SECRET'),
    stripe: configured('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'),
    stripeMode: stripeMode(),
    turnstile: configured('WILDONES_TURNSTILE_SITE_KEY', 'WILDONES_TURNSTILE_SECRET_KEY'),
    email: configured('RESEND_API_KEY', 'WILDONES_EMAIL_FROM'),
    ticketSigning: configured('WILDONES_TICKET_QR_SECRET', 'WILDONES_TICKET_ACCESS_SECRET'),
    gate: configured('WILDONES_CHECKIN_KEY', 'WILDONES_CHECKIN_SESSION_SECRET'),
    bar: configured('WILDONES_BAR_KEY', 'WILDONES_BAR_SESSION_SECRET'),
    passport: configured('WILDONES_PASSPORT_SESSION_SECRET'),
    venue: configured(`WILDONES_${prefix}_VENUE_NAME`, `WILDONES_${prefix}_VENUE_ADDRESS`),
    wallet: configured('WILDONES_APPLE_PASS_TYPE_ID', 'WILDONES_APPLE_TEAM_ID', 'WILDONES_APPLE_WWDR_CERT_BASE64', 'WILDONES_APPLE_PASS_CERT_BASE64', 'WILDONES_APPLE_PASS_KEY_BASE64')
  };
  const coreBlockers = [];
  for (const [key, label] of [['database', 'Database'], ['admin', 'Admin authentication'], ['stripe', 'Stripe'], ['turnstile', 'Turnstile'], ['email', 'Email'], ['ticketSigning', 'Ticket signing'], ['gate', 'Gate credentials'], ['bar', 'Bar credentials'], ['venue', 'Private venue']]) if (!config[key]) coreBlockers.push(label);
  const launchBlockers = [...coreBlockers];
  if (config.stripe && config.stripeMode !== 'live') launchBlockers.push('Stripe live mode');
  if (!config.wallet) launchBlockers.push('Apple Wallet signing');
  return { config, coreReady: coreBlockers.length === 0, coreBlockers, launchReady: launchBlockers.length === 0, launchBlockers, blockers: coreBlockers };
}

function operationalStatus(ready, live, runbook) {
  const { config } = ready;
  const unsigned = Number(live.counts?.unsignedWaivers || 0);
  const stripeState = !config.stripe ? 'red' : config.stripeMode === 'live' ? 'green' : 'yellow';
  const stripeDetail = !config.stripe ? 'Stripe configuration missing' : config.stripeMode === 'live' ? 'Live payments enabled' : `${String(config.stripeMode || 'configured').toUpperCase()} mode — rehearsal only`;
  const fallbackState = itemState(runbook, 'offline-fallback');
  const fallbackLight = light('fallback', 'Fallback drill', fallbackState === 'passed' ? 'green' : fallbackState === 'failed' ? 'red' : 'yellow', fallbackState === 'passed' ? 'Manual recovery path verified' : fallbackState === 'failed' ? 'Fallback drill failed' : 'Manual/offline recovery drill pending');
  const eventDayGo = ready.coreReady && config.stripeMode === 'live' && unsigned === 0 && fallbackState !== 'failed';
  const liveGo = ready.coreReady && config.stripeMode === 'live';
  const launchGo = ready.launchReady && runbook.ready;
  const rehearsalGo = runbook.ready;
  const physical = ['wallet-install', 'gate-scan', 'bartender-redemption', 'refund'];
  const physicalPending = physical.filter((id) => itemState(runbook, id) !== 'passed').length;
  return {
    decisions: {
      eventDay: { go: eventDayGo, label: eventDayGo ? 'GO' : 'NO-GO', summary: eventDayGo ? 'Critical event-day systems, payments and waiver gates are green.' : 'One or more event-day gates require action before doors open.' },
      live: { go: liveGo, label: liveGo ? 'GO' : 'NO-GO', summary: liveGo ? 'Core live operations are available.' : 'A critical live-operations dependency is not ready.' },
      launch: { go: launchGo, label: launchGo ? 'GO' : 'NO-GO', summary: launchGo ? 'Infrastructure and the complete rehearsal are certified for launch.' : 'Launch remains blocked until every red/yellow launch gate is cleared.' },
      rehearsal: { go: rehearsalGo, label: rehearsalGo ? 'GO' : 'NO-GO', summary: rehearsalGo ? 'All rehearsal checks are passed.' : `${runbook.failed} failed and ${runbook.pending} pending rehearsal checks remain.` }
    },
    indicators: {
      eventDay: [
        light('gate', 'Gate readiness', config.gate && config.ticketSigning ? 'green' : 'red', config.gate && config.ticketSigning ? 'Scanner credentials + ticket signatures ready' : 'Gate credentials or ticket signing missing'),
        light('waivers', 'Unsigned waivers', unsigned === 0 ? 'green' : 'yellow', unsigned === 0 ? 'All active tickets cleared' : `${unsigned} active ticket${unsigned === 1 ? '' : 's'} still need signatures`),
        light('bar', 'Bartender console', config.bar ? 'green' : 'red', config.bar ? 'Bar credentials configured' : 'Bar credentials missing'),
        light('stripe', 'Stripe', stripeState, stripeDetail),
        light('wallet', 'Apple Wallet', config.wallet ? 'green' : 'yellow', config.wallet ? 'Pass signing configured' : 'Wallet unavailable — QR fallback remains usable'),
        fallbackLight
      ],
      live: [
        light('gate', 'Gate', config.gate && config.ticketSigning ? 'green' : 'red', `${live.counts?.checkedIn || 0} checked in`),
        light('bar', 'Bar', config.bar ? 'green' : 'red', `${live.counts?.activeWristbands || 0} active wristbands`),
        light('stripe', 'Payments', stripeState, stripeDetail),
        light('waivers', 'Waiver queue', unsigned === 0 ? 'green' : 'yellow', unsigned === 0 ? 'No unsigned active admissions' : `${unsigned} unsigned active admissions`),
        light('credits', 'Drink credits', config.bar ? 'green' : 'red', `${live.counts?.creditsRedeemed || 0} redeemed · ${live.counts?.creditsRemaining || 0} remaining`),
        fallbackLight
      ],
      launch: [
        light('core', 'Core platform', ready.coreReady ? 'green' : 'red', ready.coreReady ? 'Core production dependencies configured' : `Missing: ${ready.coreBlockers.join(' · ')}`),
        light('stripe', 'Stripe live mode', config.stripeMode === 'live' ? 'green' : 'red', stripeDetail),
        light('wallet', 'Apple Wallet', config.wallet ? 'green' : 'red', config.wallet ? 'Pass signing configured' : 'Wallet signing credentials missing'),
        light('venue', 'Private venue', config.venue ? 'green' : 'red', config.venue ? 'Server-side venue configured' : 'Realm venue secrets missing'),
        light('rehearsal', 'Full rehearsal', runbook.ready ? 'green' : runbook.failed ? 'red' : 'yellow', `${runbook.passed} passed · ${runbook.failed} failed · ${runbook.pending} pending`),
        light('physical', 'Physical device certification', physicalPending === 0 ? 'green' : 'yellow', physicalPending === 0 ? 'Wallet, gate, bartender and refund verified' : `${physicalPending} physical certification check${physicalPending === 1 ? '' : 's'} remain`)
      ],
      rehearsal: [
        runbookLight(runbook, 'wallet-install', 'Apple Wallet'),
        runbookLight(runbook, 'gate-scan', 'Gate scan'),
        runbookLight(runbook, 'bartender-redemption', 'Bartender redemption'),
        runbookLight(runbook, 'refund', 'Refund test'),
        runbookLight(runbook, 'failed-payment', 'Payment failure drill'),
        runbookLight(runbook, 'offline-fallback', 'Fallback drill')
      ]
    }
  };
}

export default async (req) => {
  if (!isAdmin(req)) return json({ error: 'Unauthorized.' }, 401);
  const url = new URL(req.url);
  const eventId = String(url.searchParams.get('eventId') || listEvents({ includeHidden: true })[0]?.eventId || '');
  const event = getEvent(eventId);
  if (!event) return json({ error: 'Unknown event.' }, 400);
  if (req.method === 'GET') {
    const [live, runbook] = await Promise.all([snapshot(event), rehearsal(eventId)]);
    const ready = readiness(event);
    return json({ event: toPublicEvent(event), events: listEvents({ includeHidden: true }).map(toPublicEvent), ...ready, live, rehearsal: runbook, ...operationalStatus(ready, live, runbook), generatedAt: new Date().toISOString() });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (body.eventId !== eventId) return json({ error: 'Event scope mismatch.' }, 400);
  const store = blobStore(REHEARSAL_STORE);
  const current = await store.get(eventId, { type: 'json' }).catch(() => null) || { eventId, items: {} };
  const now = new Date().toISOString();
  if (body.action === 'set_rehearsal') {
    const id = String(body.itemId || '');
    const allowed = new Set(MANUAL_ITEMS.map((item) => item[0]));
    if (!allowed.has(id)) return json({ error: 'Unknown rehearsal item.' }, 400);
    const status = String(body.status || 'pending');
    if (!['pending', 'passed', 'failed'].includes(status)) return json({ error: 'Invalid status.' }, 400);
    current.items = { ...(current.items || {}), [id]: { status, note: String(body.note || '').slice(0, 500), updatedAt: now } };
    current.tester = String(body.tester || current.tester || '').slice(0, 80);
    current.updatedAt = now;
    await store.setJSON(eventId, current);
    await writeAudit({ eventId, action: 'rehearsal.item_updated', actor: 'admin', targetType: 'rehearsal', targetId: id, detail: { status } });
    return json({ ok: true, rehearsal: await rehearsal(eventId) });
  }
  if (body.action === 'save_tester') {
    current.tester = String(body.tester || '').slice(0, 80);
    current.updatedAt = now;
    await store.setJSON(eventId, current);
    await writeAudit({ eventId, action: 'rehearsal.tester_updated', actor: 'admin', targetType: 'rehearsal', targetId: eventId });
    return json({ ok: true, rehearsal: await rehearsal(eventId) });
  }
  if (body.action === 'reset_rehearsal') {
    await store.delete(eventId).catch(() => {});
    await writeAudit({ eventId, action: 'rehearsal.reset', actor: 'admin', targetType: 'rehearsal', targetId: eventId });
    return json({ ok: true, rehearsal: await rehearsal(eventId) });
  }
  return json({ error: 'Unknown action.' }, 400);
};

export const config = { path: '/api/admin/readiness' };
