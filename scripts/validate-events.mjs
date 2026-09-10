import { EVENTS, listEvents } from '../netlify/functions/_events.mjs';

const errors = [];
const seenSlugs = new Set();
const seenOrders = new Set();
const allowedRealms = new Set(['light', 'balance', 'fire', 'night']);
const allowedAccessModes = new Set(['application', 'application_then_public', 'public', 'invite_only']);

for (const [key, event] of Object.entries(EVENTS)) {
  if (key !== event.eventId) errors.push(`${key}: object key must match eventId`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.eventId)) errors.push(`${key}: invalid eventId format`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug)) errors.push(`${key}: invalid slug format`);
  if (seenSlugs.has(event.slug)) errors.push(`${key}: duplicate slug ${event.slug}`);
  seenSlugs.add(event.slug);
  if (seenOrders.has(event.cycleOrder)) errors.push(`${key}: duplicate cycleOrder ${event.cycleOrder}`);
  seenOrders.add(event.cycleOrder);
  if (!allowedRealms.has(event.realm)) errors.push(`${key}: invalid realm ${event.realm}`);
  if (!allowedAccessModes.has(event.accessMode)) errors.push(`${key}: invalid accessMode ${event.accessMode}`);
  if (Number.isNaN(Date.parse(event.startsAt))) errors.push(`${key}: invalid startsAt`);
  if (Number.isNaN(Date.parse(event.endsAt))) errors.push(`${key}: invalid endsAt`);
  if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) errors.push(`${key}: endsAt must follow startsAt`);
  if (!event.copy?.tagline || !event.theme?.accent) errors.push(`${key}: missing public brand configuration`);
}

const ordered = listEvents();
if (ordered.length !== 4) errors.push(`Expected 4 active cycle events, found ${ordered.length}`);

if (errors.length) {
  console.error('Event registry validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated ${ordered.length} Wild Ones events with unique eventId, slug and cycle order.`);
