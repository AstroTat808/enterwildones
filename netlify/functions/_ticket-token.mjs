import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';

function secret() { return env('WILDONES_TICKET_ACCESS_SECRET'); }
function equal(a = '', b = '') { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
function sign(payload) { return createHmac('sha256', secret()).update(payload).digest('base64url'); }
export function makeTicketId(event, invitationId) { const id = String(invitationId || '').trim(); if (!id) throw new Error('invitationId is required for ticket identity.'); const suffix = createHash('sha256').update(`${event.eventId}|${id}`).digest('hex').slice(0,16).toUpperCase(); return `WLD-${event.invitationPrefix}-TKT-${suffix}`; }
export function makeTicketToken({ eventId, ticketId, userId }) {
  if (!secret()) return null;
  const event = requireEvent(eventId);
  if (!/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(ticketId || ''))) return null;
  const exp = Math.floor(new Date(event.endsAt).getTime() / 1000) + 7 * 86400;
  const payload = Buffer.from(JSON.stringify({ v: 1, typ: 'wildones-ticket', eventId, ticketId, userId, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function verifyTicketToken(token = '') {
  if (!secret() || !String(token).includes('.')) return null;
  const [payload, signature] = String(token).split('.', 2);
  if (!equal(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.v !== 1 || data.typ !== 'wildones-ticket' || Number(data.exp) <= Math.floor(Date.now() / 1000)) return null;
    requireEvent(data.eventId);
    if (!/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(data.ticketId || ''))) return null;
    return data;
  } catch { return null; }
}

/** Scanner-only credential. Never accepted by guest ticket, waiver, or checkout APIs. */
export function scanCredentialExpiresAt(eventId) {
  return new Date(new Date(requireEvent(eventId).endsAt).getTime() + 8 * 3600000).toISOString();
}
export function makeScanToken({eventId,ticketId,userId}) {
  if (!secret() || !userId || !/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(ticketId))) return null;
  const exp = Math.floor(new Date(scanCredentialExpiresAt(eventId)).getTime()/1000);
  if (exp <= Math.floor(Date.now()/1000)) return null;
  const payload = Buffer.from(JSON.stringify({v:1,typ:'wildones-scan',eventId,ticketId,userId,exp})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function verifyScanToken(token='') {
  // Preserve all existing QR and native Apple passes.
  const legacy = verifyTicketToken(token);
  if (legacy) return legacy;
  if (!secret() || typeof token !== 'string' || token.length > 4096) return null;
  const parts=token.split('.');
  if(parts.length!==2 || !equal(parts[1],sign(parts[0]))) return null;
  try {
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(data.v!==1 || data.typ!=='wildones-scan' || !data.userId || !Number.isSafeInteger(data.exp) ||
       data.exp<=Math.floor(Date.now()/1000) || !/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(data.ticketId))) return null;
    if(data.exp!==Math.floor(new Date(scanCredentialExpiresAt(data.eventId)).getTime()/1000)) return null;
    return data;
  } catch { return null; }
}
