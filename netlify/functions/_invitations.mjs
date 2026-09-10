import { env } from './_env.mjs';
import { blobStore } from './_blob-store.mjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { requireEvent } from './_events.mjs';
import { parseCookies } from './_security.mjs';
import { STORES, eventKey, inviteCodeIndexKey } from './_stores.mjs';

function normalizeCode(code = '') { return String(code).trim().toUpperCase().replace(/\s+/g, ''); }
function hashCode(code = '') { return createHash('sha256').update(normalizeCode(code)).digest('hex'); }
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function accessSecret() { return env('WILDONES_INVITE_ACCESS_SECRET'); }
function sign(payload) { return createHmac('sha256', accessSecret()).update(payload).digest('base64url'); }
function safeEqual(a = '', b = '') { const l = Buffer.from(String(a)); const r = Buffer.from(String(b)); return l.length === r.length && timingSafeEqual(l, r); }
function makeCode(prefix) { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes = randomBytes(12); let raw = ''; for (const byte of bytes) raw += chars[byte % chars.length]; return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`; }
function defaultExpiry(event) { return new Date(Math.min(Date.now() + 30 * 86400000, new Date(event.startsAt).getTime())).toISOString(); }
export function inviteAccessCookieName(eventId) { requireEvent(eventId); return `wildones_invite_${String(eventId).replace(/[^A-Za-z0-9_-]/g, '_')}`; }

export async function createInvitation({ eventId, applicationId = null, userId = null, email = null, label = 'Approved guest', expiresAt = null, maxTickets = 1 }) {
  const event = requireEvent(eventId);
  const expiry = expiresAt ? new Date(expiresAt) : new Date(defaultExpiry(event));
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('Invitation expiration must be in the future.');
  if (expiry.getTime() > new Date(event.startsAt).getTime()) throw new Error('Invitation cannot expire after the event begins.');
  const invitations = blobStore(STORES.invitations);
  const indexes = blobStore(STORES.invitationIndexes);
  const invitationId = randomUUID();
  const createdAt = new Date().toISOString();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(event.invitationPrefix); const codeHash = hashCode(code); const indexKey = inviteCodeIndexKey(codeHash);
    const existing = await indexes.get(indexKey, { type: 'json' }).catch(() => null); if (existing) continue;
    await indexes.setJSON(indexKey, { eventId, invitationId, codeHash, createdAt });
    const invitation = { invitationId, eventId, applicationId, userId, email: email ? String(email).trim().toLowerCase() : null, label: String(label || 'Approved guest').slice(0, 120), createdAt, expiresAt: expiry.toISOString(), maxTickets: Math.min(Math.max(Number(maxTickets) || 1, 1), 8), codeHash, status: 'active', redeemedAt: null, revokedAt: null, purchaseCount: 0 };
    try { await invitations.setJSON(eventKey(eventId, invitationId), invitation); return { invitation, code }; }
    catch (error) { await indexes.delete(indexKey).catch(() => {}); throw error; }
  }
  throw new Error('Could not generate a unique invitation code.');
}

export function createInvitationAccess(invitation, event = requireEvent(invitation?.eventId)) {
  if (!accessSecret()) throw new Error('Invite access secret is not configured.');
  if (!invitation?.eventId || !invitation?.invitationId || !invitation?.applicationId || !invitation?.userId) throw new Error('Invitation identity is incomplete.');
  const exp = Math.floor(Math.min(new Date(event.startsAt).getTime(), Date.now() + 30 * 86400000) / 1000);
  const payload = b64url(JSON.stringify({ typ: 'wildones-invite-access', eventId: invitation.eventId, invitationId: invitation.invitationId, applicationId: invitation.applicationId, userId: invitation.userId, exp }));
  return { token: `${payload}.${sign(payload)}`, exp };
}
export function inviteAccessCookie(eventId, token, exp) { const maxAge = Math.max(60, exp - Math.floor(Date.now() / 1000)); return `${inviteAccessCookieName(eventId)}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`; }
export function clearInviteAccessCookie(eventId) { return `${inviteAccessCookieName(eventId)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
export function verifyInviteAccessToken(token = '') { if (!accessSecret() || !token.includes('.')) return null; const [payload, supplied] = token.split('.', 2); if (!safeEqual(supplied, sign(payload))) return null; try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); if (data.typ !== 'wildones-invite-access' || Number(data.exp) <= Math.floor(Date.now() / 1000)) return null; requireEvent(data.eventId); return data; } catch { return null; } }
export function readInviteAccess(req, eventId) { const token = parseCookies(req)[inviteAccessCookieName(eventId)] || ''; const data = verifyInviteAccessToken(token); return data?.eventId === eventId ? data : null; }

export async function redeemInvitation(rawCode) {
  const code = normalizeCode(rawCode);
  if (!/^[A-Z]{3}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) { const error = new Error('Invitation code is invalid.'); error.code = 'INVALID_CODE'; throw error; }
  const codeHash = hashCode(code); const indexes = blobStore(STORES.invitationIndexes); const index = await indexes.get(inviteCodeIndexKey(codeHash), { type: 'json' }).catch(() => null);
  if (!index?.eventId || !index?.invitationId) { const error = new Error('Invitation code is invalid.'); error.code = 'INVALID_CODE'; throw error; }
  const event = requireEvent(index.eventId); const invitations = blobStore(STORES.invitations); const key = eventKey(index.eventId, index.invitationId); const invitation = await invitations.get(key, { type: 'json' }).catch(() => null);
  if (!invitation || invitation.codeHash !== codeHash) { const error = new Error('Invitation code is invalid.'); error.code = 'INVALID_CODE'; throw error; }
  if (invitation.status === 'revoked' || invitation.revokedAt) { const error = new Error('This invitation has been revoked.'); error.code = 'REVOKED'; throw error; }
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) { const error = new Error('This invitation has expired.'); error.code = 'EXPIRED'; throw error; }
  if (invitation.status === 'redeemed' || invitation.redeemedAt) { const error = new Error('This invitation has already been redeemed.'); error.code = 'USED'; throw error; }
  const redeemedAt = new Date().toISOString(); const redeemed = { ...invitation, status: 'redeemed', redeemedAt };
  await invitations.setJSON(key, redeemed); const latest = await invitations.get(key, { type: 'json' }).catch(() => null);
  if (!latest || latest.codeHash !== codeHash || latest.redeemedAt !== redeemedAt) { const error = new Error('This invitation was redeemed by another request.'); error.code = 'USED'; throw error; }
  const access = createInvitationAccess(latest, event); return { invitation: latest, event, access };
}
