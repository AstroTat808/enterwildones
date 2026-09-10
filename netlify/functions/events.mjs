import { getEvent, getEventBySlug, listEvents, toPublicEvent } from './_events.mjs';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300', 'Content-Type': 'application/json; charset=utf-8' } });
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(req.url);
  const eventId = url.searchParams.get('eventId');
  const slug = url.searchParams.get('slug');
  if (eventId || slug) {
    const event = eventId ? getEvent(eventId) : getEventBySlug(slug);
    if (!event || event.visibility !== 'public') return json({ error: 'Event not found.' }, 404);
    return json({ event: toPublicEvent(event) });
  }
  return json({ cycle: { name: 'The Wild Ones Cycle', statement: 'Four realms. One cycle.' }, events: listEvents().map(toPublicEvent) });
};
