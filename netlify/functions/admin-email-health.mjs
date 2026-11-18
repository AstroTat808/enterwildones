import { isAdmin } from './_admin-auth.mjs';
import { emailHealth } from './_email-service.mjs';
import { getEvent } from './_events.mjs';
import { json } from './_response.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (!isAdmin(req)) return json({ error: 'Unauthorized.' }, 401);
  const eventId = new URL(req.url).searchParams.get('eventId') || 'aureva-2026';
  if (!getEvent(eventId)) return json({ error: 'Invalid event.' }, 400);
  try {
    return json(await emailHealth(eventId), 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Email reporting failed:', String(error.message || error).slice(0, 120));
    return json({ error: 'Email reporting temporarily unavailable.' }, 503);
  }
};
export const config = { path: '/api/admin/email-health' };
