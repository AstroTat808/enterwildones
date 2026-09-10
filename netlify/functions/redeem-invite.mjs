import { blobStore } from './_blob-store.mjs';
import { inviteAccessCookie, redeemInvitation } from './_invitations.mjs';
import { clientIp, json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES, sha256 } from './_stores.mjs';
import { toPublicEvent } from './_events.mjs';
import { writeAudit } from './_audit.mjs';
const WINDOW_MS = 3600000, MAX_ATTEMPTS = 12;
async function rate(req) { const store = blobStore(STORES.rateLimits); const key = `invite-redeem/ip/${sha256(clientIp(req))}`, now = Date.now(); const state = await store.get(key, { type: 'json' }).catch(() => null); const current = state && Number(state.windowStart) > now - WINDOW_MS ? state : { windowStart: now, count: 0 }; if (Number(current.count) >= MAX_ATTEMPTS) return false; await store.setJSON(key, { windowStart: Number(current.windowStart), count: Number(current.count) + 1, updatedAt: now }); return true; }
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  try { if (!await rate(req)) return json({ error: 'Too many invitation attempts. Try again later.' }, 429, { 'Retry-After': '3600' }); } catch { return json({ error: 'Invitation verification is temporarily unavailable.' }, 503); }
  let body; try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  try {
    const result = await redeemInvitation(body.code);
    await writeAudit({ eventId: result.event.eventId, action: 'invitation.redeemed', actor: 'guest', targetType: 'invitation', targetId: result.invitation.invitationId, detail: { applicationId: result.invitation.applicationId, userId: result.invitation.userId } });
    return json({ ok: true, accessGranted: true, event: toPublicEvent(result.event), invitationId: result.invitation.invitationId, nextUrl: result.event.ticketSalesOpen ? `/ticket-access?event=${encodeURIComponent(result.event.slug)}` : result.event.routes.event, ticketSalesOpen: result.event.ticketSalesOpen }, 200, { 'Set-Cookie': inviteAccessCookie(result.event.eventId, result.access.token, result.access.exp) });
  } catch (error) { const status = error.code === 'INVALID_CODE' ? 400 : ['USED', 'EXPIRED', 'REVOKED'].includes(error.code) ? 409 : 500; return json({ error: error.message || 'Invitation redemption failed.', code: error.code || 'redeem_failed' }, status); }
};
export const config = { path: '/api/redeem-invite' };
