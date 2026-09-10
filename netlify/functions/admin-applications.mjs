import { blobStore } from './_blob-store.mjs';
import { isAdmin } from './_admin-auth.mjs';
import { createInvitation } from './_invitations.mjs';
import { getEvent, listEvents, toPublicEvent } from './_events.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

async function load(eventId) {
  const store = blobStore(STORES.applications);
  const result = await store.list({ prefix: `${eventId}/` });
  const apps = await Promise.all((result.blobs || []).map(({ key }) => store.get(key, { type: 'json' }).catch(() => null)));
  return apps.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export default async (req) => {
  if (!isAdmin(req)) return json({ error: 'Unauthorized.' }, 401);
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const eventId = url.searchParams.get('eventId') || listEvents()[0]?.eventId;
    const event = getEvent(eventId);
    if (!event) return json({ error: 'Unknown event.' }, 400);
    try {
      const applications = await load(eventId);
      const counts = applications.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
      return json({ event: toPublicEvent(event), events: listEvents().map(toPublicEvent), counts, applications });
    } catch { return json({ error: 'Could not load applications.' }, 500); }
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed.' }, 403);
  let body;
  try { body = await readBody(req); } catch { return json({ error: 'Invalid request.' }, 400); }
  const event = getEvent(body.eventId);
  if (!event) return json({ error: 'Unknown event.' }, 400);
  const applicationId = String(body.applicationId || '').trim();
  if (!applicationId) return json({ error: 'applicationId is required.' }, 400);
  const store = blobStore(STORES.applications);
  const key = eventKey(event.eventId, applicationId);
  const application = await store.get(key, { type: 'json' }).catch(() => null);
  if (!application || application.eventId !== event.eventId) return json({ error: 'Application not found.' }, 404);
  const action = String(body.action || '').trim();
  const now = new Date().toISOString();
  if (action === 'reject') {
    if (application.invitationId) return json({ error: 'An application with an invitation cannot be rejected here.' }, 409);
    const updated = { ...application, status: 'rejected', decision: 'rejected', decidedAt: now, decidedBy: 'admin', updatedAt: now };
    await store.setJSON(key, updated);
    await writeAudit({ eventId: event.eventId, action: 'application.rejected', actor: 'admin', targetType: 'application', targetId: applicationId });
    return json({ ok: true, application: updated });
  }
  if (action !== 'approve_and_invite') return json({ error: 'Unknown action.' }, 400);
  if (application.invitationId) return json({ error: 'This application already has an invitation.' }, 409);
  if (application.status === 'rejected') return json({ error: 'Rejected applications must be reopened before approval.' }, 409);
  const approved = { ...application, status: 'approved', decision: 'approved', decidedAt: now, decidedBy: 'admin', updatedAt: now };
  await store.setJSON(key, approved);
  try {
    const invite = await createInvitation({ eventId: event.eventId, applicationId, userId: application.userId, email: application.email, label: `${event.name} - ${application.fullName}`, maxTickets: body.maxTickets || 1, expiresAt: body.expiresAt || null });
    const updated = { ...approved, invitationId: invite.invitation.invitationId, invitationCreatedAt: invite.invitation.createdAt, updatedAt: new Date().toISOString() };
    await store.setJSON(key, updated);
    await writeAudit({ eventId: event.eventId, action: 'application.approved_and_invited', actor: 'admin', targetType: 'application', targetId: applicationId, detail: { invitationId: invite.invitation.invitationId } });
    return json({ ok: true, application: updated, invite: { code: invite.code, invitationId: invite.invitation.invitationId, expiresAt: invite.invitation.expiresAt, maxTickets: invite.invitation.maxTickets }, warning: 'This is the only response that contains the raw invitation code.' });
  } catch (error) {
    await writeAudit({ eventId: event.eventId, action: 'application.approved_invite_failed', actor: 'admin', targetType: 'application', targetId: applicationId, detail: { error: String(error.message || error) } }).catch(() => {});
    return json({ error: 'Application was approved, but the invitation could not be created. Retry approval to create it.', code: 'invite_creation_failed' }, 500);
  }
};
export const config = { path: '/api/admin/applications' };
