import { isAdmin } from './_admin-auth.mjs';
import { createInvitation } from './_invitations.mjs';
import { requireEvent } from './_events.mjs';
import { clean, json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { writeAudit } from './_audit.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!isAdmin(req)) return json({ error: 'Unauthorized.' }, 401);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  let event;
  try { event = requireEvent(body.eventId); } catch { return json({ error: 'Unknown event.' }, 400); }
  const count = Math.min(Math.max(Number(body.count || 1), 1), 100);
  const created = [];
  try {
    for (let i = 0; i < count; i++) {
      const result = await createInvitation({ eventId: event.eventId, applicationId: body.applicationId || null, userId: body.userId || null, email: body.email || null, label: clean(body.label, 120) || 'Approved guest', expiresAt: body.expiresAt || null, maxTickets: body.maxTickets || 1 });
      created.push({ code: result.code, invitationId: result.invitation.invitationId, expiresAt: result.invitation.expiresAt, maxTickets: result.invitation.maxTickets });
    }
    await writeAudit({ eventId: event.eventId, action: 'invitation.batch_created', actor: 'admin', targetType: 'invitation', detail: { count: created.length, applicationId: body.applicationId || null } });
    return json({ created: created.length, eventId: event.eventId, invites: created, note: 'Raw codes are returned once. Only hashes are persisted.' }, 201);
  } catch (error) { return json({ error: error.message || 'Invitation creation failed.' }, 500); }
};
export const config = { path: '/api/admin/create-invites' };
