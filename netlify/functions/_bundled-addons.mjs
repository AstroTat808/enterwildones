import { addonCatalog } from './_addons.mjs';
import { blobStore } from './_blob-store.mjs';
import { ensureDrinkLedger } from './_drink-ledger.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

// Every option is priced and described by the server. The browser submits only
// identifiers; quantities are strictly one per registered guest.
export const BUNDLED_TYPES = Object.freeze(['drink_package', 'late_stay']);

export function selectBundledAddons(eventId, requested = []) {
  if (!Array.isArray(requested) || requested.length > BUNDLED_TYPES.length ||
      requested.some(type => typeof type !== 'string' || !BUNDLED_TYPES.includes(type)) ||
      new Set(requested).size !== requested.length) {
    throw new Error('Select each available add-on at most once.');
  }
  const catalog = addonCatalog(eventId);
  return catalog.filter(item => requested.includes(item.addonType)).map(item => {
    if (!item.enabled || !Number.isSafeInteger(item.priceCents) || item.priceCents < 50)
      throw new Error('One of the selected add-ons is unavailable.');
    return {
      addonType: item.addonType,
      name: item.name,
      priceCents: item.priceCents,
      description: item.description,
      ...(item.addonType === 'drink_package' ? { credits: item.credits } : { departureTime: item.departureTime })
    };
  });
}

export function addonSubtotal(selected = []) {
  return selected.reduce((sum, item) => sum + Number(item.priceCents || 0), 0);
}

export function bundleTypes(selected = []) {
  return selected.map(x => x.addonType).sort().join(',');
}

// Validate the saved, checkout-time authoritative snapshot; do NOT reprice
// already-paid orders when the admin updates the catalog later.
export function verifyBundleSnapshot(selected = [], admissionPriceCents, totalCents) {
  if (!Array.isArray(selected) || selected.length > BUNDLED_TYPES.length ||
      new Set(selected.map(x => x.addonType)).size !== selected.length ||
      selected.some(item => !item || !BUNDLED_TYPES.includes(item.addonType) ||
        !Number.isSafeInteger(item.priceCents) || item.priceCents < 50 ||
        (item.addonType === 'drink_package' && (!Number.isInteger(item.credits) || item.credits < 1 || item.credits > 24)) ||
        (item.addonType === 'late_stay' && !String(item.departureTime || '').trim())) ||
      !Number.isSafeInteger(admissionPriceCents) || admissionPriceCents < 50 ||
      !Number.isSafeInteger(totalCents) || totalCents !== admissionPriceCents + addonSubtotal(selected)) {
    throw new Error('The original checkout itemized amount is invalid.');
  }
  return true;
}

export async function issueBundledAddons({ eventId, ticketId, userId, paymentId, selected = [] }) {
  const store = blobStore(STORES.entitlements);
  for (const item of selected) {
    // A retry must never overwrite another purchase, revive a refunded item,
    // or grant twice the drink credits.
    const key = eventKey(eventId, `${ticketId}/${item.addonType}`);
    const old = await store.get(key, { type: 'json' }).catch(() => null);
    if (old) {
      if (old.paymentId === paymentId && old.status === 'active') continue;
      throw new Error('The bundled add-on has a conflicting existing entitlement.');
    }
    if (item.addonType === 'drink_package') {
      await ensureDrinkLedger({ eventId, ticketId, userId, creditsPurchased: item.credits });
    }
    const now = new Date().toISOString();
    const entitlement = {
      entitlementId: `ent_${ticketId}_${item.addonType}`,
      eventId, ticketId, userId, addonType: item.addonType,
      paymentId, status: 'active', priceCents: item.priceCents,
      purchasedAt: now, updatedAt: now, purchaseSource: 'admission_bundle',
      ...(item.addonType === 'drink_package'
        ? { creditsPurchased: item.credits, creditsRedeemed: 0, creditsRemaining: item.credits, wristbandActivatedAt: null }
        : { departureTime: item.departureTime })
    };
    await store.setJSON(key, entitlement);
    await writeAudit({ eventId, action: 'addon.bundled_issued', actor: 'stripe', targetType: 'ticket',
      targetId: ticketId, detail: { addonType: item.addonType, paymentId, amountCents: item.priceCents } });
  }
}

// Whole-order refunds and disputes affect the admission AND its add-ons.
// Standalone later add-ons retain their independent payment lifecycle.
export async function setBundledAddonStatus({ eventId, ticketId, paymentId, selected = [], status }) {
  if (!['refunded', 'disputed', 'active'].includes(status)) throw new Error('Invalid bundled entitlement transition.');
  const store = blobStore(STORES.entitlements);
  for (const item of selected) {
    const key = eventKey(eventId, `${ticketId}/${item.addonType}`);
    const old = await store.get(key, { type: 'json' }).catch(() => null);
    if (!old || old.paymentId !== paymentId || old.status === 'refunded') continue;
    if (status === 'active' && old.status !== 'disputed') continue;
    if (old.status === status) continue;
    const now = new Date().toISOString();
    await store.setJSON(key, { ...old, status, updatedAt: now,
      ...(status === 'refunded' ? { refundedAt: now } : {}),
      ...(status === 'disputed' ? { disputedAt: now } : {}),
      ...(status === 'active' ? { disputeResolvedAt: now } : {}) });
    await writeAudit({ eventId, action: `addon.bundled_${status}`, actor: 'stripe',
      targetType: 'ticket', targetId: ticketId, detail: { addonType: item.addonType, paymentId } });
  }
}
