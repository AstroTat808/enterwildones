import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { STORES } from './_stores.mjs';

function prefix(eventId='') {
  return `WILDONES_${String(eventId).toUpperCase().replace(/[^A-Z0-9]/g,'_')}`;
}

function normalizedEmail(value='') {
  return String(value || '').trim().toLowerCase();
}

function commissioningEmails(eventId) {
  return new Set(
    String(env(`${prefix(eventId)}_COMMISSIONING_CHECKOUT_EMAILS`) || '')
      .split(',')
      .map(normalizedEmail)
      .filter(Boolean)
  );
}

export function commissioningCheckoutAllowed(event, invitation) {
  if (!event?.eventId || !invitation?.email) return false;
  return commissioningEmails(event.eventId).has(normalizedEmail(invitation.email));
}

export function checkoutAllowed(event, invitation) {
  return Boolean(event?.ticketSalesOpen || commissioningCheckoutAllowed(event, invitation));
}

export async function findRedeemedInvitationForUser(eventId, userId, email='') {
  if (!eventId || !userId) return null;
  const store = blobStore(STORES.invitations);
  const listed = await store.list({ prefix: `${eventId}/` });
  const expectedEmail = normalizedEmail(email);
  const matches = [];
  for (const { key } of listed.blobs || []) {
    const invitation = await store.get(key, { type: 'json' }).catch(() => null);
    if (!invitation || invitation.eventId !== eventId || invitation.userId !== userId) continue;
    if (!['redeemed', 'fulfilled'].includes(invitation.status)) continue;
    if (expectedEmail && normalizedEmail(invitation.email) !== expectedEmail) continue;
    matches.push(invitation);
  }
  matches.sort((a,b)=>String(b.redeemedAt || b.fulfilledAt || b.createdAt || '').localeCompare(String(a.redeemedAt || a.fulfilledAt || a.createdAt || '')));
  return matches[0] || null;
}
