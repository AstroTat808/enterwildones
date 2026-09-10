import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';
function prefix(eventId){requireEvent(eventId);return `WILDONES_${String(eventId).toUpperCase().replace(/[^A-Z0-9]/g,'_')}`;}
export function privateVenue(eventId){const p=prefix(eventId);return{name:env(`${p}_VENUE_NAME`),address:env(`${p}_VENUE_ADDRESS`),instructions:env(`${p}_VENUE_INSTRUCTIONS`)};}
export function privateVenueConfigured(eventId){const v=privateVenue(eventId);return Boolean(v.name&&v.address);}
export function privateVenueMapUrl(eventId){const v=privateVenue(eventId);return v.address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`:'';}
