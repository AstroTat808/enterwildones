import { resolveEvent, toPublicEvent } from './_events.mjs';
import { currentTicketOffer, ticketPricingSchedule } from './_payments.mjs';
import { addonCatalog, publicAddon } from './_addons.mjs';
import { json } from './_response.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(req.url);
  const event = resolveEvent({ eventId: url.searchParams.get('eventId'), slug: url.searchParams.get('event') || url.searchParams.get('slug') });
  if (!event || event.visibility !== 'public') return json({ error: 'Event not found.' }, 404);

  const schedule = ticketPricingSchedule(event.eventId);
  const offer = currentTicketOffer(event.eventId);
  const phases = schedule.tiered
    ? schedule.phases.filter((phase) => phase.name || phase.priceCents || phase.endsAt).map((phase) => ({
        phase: phase.phase,
        name: phase.name,
        priceCents: phase.priceCents,
        startsAt: phase.startsAt,
        endsAt: phase.endsAt
      }))
    : offer ? [{ phase: offer.phase, name: offer.name, priceCents: offer.priceCents, startsAt: offer.startsAt, endsAt: offer.endsAt }] : [];

  return new Response(JSON.stringify({
    event: toPublicEvent(event),
    currency: 'usd',
    timezone: event.timezone,
    salesOpen: Boolean(event.ticketSalesOpen),
    current: offer ? { phase: offer.phase, name: offer.name, priceCents: offer.priceCents, startsAt: offer.startsAt, endsAt: offer.endsAt } : null,
    next: offer?.next || null,
    phases,
    scheduleComplete: Boolean(offer?.scheduleComplete),
    addons: addonCatalog(event.eventId).filter((addon) => addon.enabled).map(publicAddon)
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
};

export const config = { path: '/api/public/pricing' };
