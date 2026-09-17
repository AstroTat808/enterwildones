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

export function commissioningCheckoutAllowed(event, invitation, ...trustedEmails) {
  if (!event?.eventId) return false;
  const allowed = commissioningEmails(event.eventId);
  if (!allowed.size) return false;
  const candidates = [invitation?.email, ...trustedEmails].map(normalizedEmail).filter(Boolean);
  return candidates.some(email => allowed.has(email));
}

export function checkoutAllowed(event, invitation, ...trustedEmails) {
  return Boolean(event?.ticketSalesOpen || commissioningCheckoutAllowed(event, invitation, ...trustedEmails));
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
    // Older invitations might not have copied the applicant email into the invitation
    // record. User identity remains authoritative, so only enforce this comparison when
    // the invitation actually contains an email.
    if (expectedEmail && invitation.email && normalizedEmail(invitation.email) !== expectedEmail) continue;
    matches.push(invitation);
  }
  matches.sort((a,b)=>String(b.redeemedAt || b.fulfilledAt || b.createdAt || '').localeCompare(String(a.redeemedAt || a.fulfilledAt || a.createdAt || '')));
  return matches[0] || null;
}
