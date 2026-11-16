import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireEvent } from '../netlify/functions/_events.mjs';
import { addonCatalog } from '../netlify/functions/_addons.mjs';

const event=requireEvent('aureva-2026');
const start='2027-01-23T19:00:00-10:00';
const end='2027-01-24T03:00:00-10:00';
const checkout='2027-01-24T10:00:00-10:00';

assert.equal(event.year,2027,'Event public year must be 2027');
assert.equal(event.startsAt,start,'AUREVA begins Saturday January 23, 2027 at 7 PM HST');
assert.equal(event.endsAt,end,'AUREVA ends Sunday January 24, 2027 at 3 AM HST');
assert.equal(Date.parse(end)-Date.parse(start),8*60*60*1000,'AUREVA main event must run eight hours');
assert.equal(Date.parse(checkout)-Date.parse(end),7*60*60*1000,'Late checkout must add seven hours after 3 AM');
assert.equal(event.ticketSalesOpen,false,'Changing dates must not open ticket sales');
assert.equal(event.accessMode,'application','Applications and invitation access must remain intact');

const localDay=(value)=>new Intl.DateTimeFormat('en-US',{
  timeZone:'Pacific/Honolulu',weekday:'long',year:'numeric',month:'long',day:'numeric'
}).format(new Date(value));
assert.equal(localDay(start),'Saturday, January 23, 2027');
assert.equal(localDay(end),'Sunday, January 24, 2027');
assert.equal(localDay(checkout),'Sunday, January 24, 2027');

const prefix='WILDONES_AUREVA_2026_';
const priceKey=prefix+'LATE_STAY_PRICE_CENTS';
const timeKey=prefix+'LATE_STAY_DEPARTURE_TIME';
const previousPrice=process.env[priceKey],previousTime=process.env[timeKey];
try {
  process.env[priceKey]='2500';
  process.env[timeKey]='10:00 AM';
  const addon=addonCatalog(event.eventId).find((item)=>item.addonType==='late_stay');
  assert.equal(addon.enabled,true,'Approved late checkout must be enabled');
  assert.equal(addon.priceCents,2500,'Existing $25 late checkout price must remain unchanged');
  assert.equal(addon.departureTime,'10:00 AM');
  assert.match(addon.description,/Sunday, January 24, 2027/);
  assert.match(addon.description,/3:00 AM/);
  assert.match(addon.description,/10:00 AM HST/);
  process.env[timeKey]='9:00 AM';
  assert.equal(addonCatalog(event.eventId).find((item)=>item.addonType==='late_stay').enabled,false,
    'AUREVA must not sell late checkout with an unapproved departure time');
} finally {
  if(previousPrice===undefined)delete process.env[priceKey];else process.env[priceKey]=previousPrice;
  if(previousTime===undefined)delete process.env[timeKey];else process.env[timeKey]=previousTime;
}

const read=async(p)=>readFile(new URL('../'+p,import.meta.url),'utf8');
const [home,canonical,generic,ticket,hydration,template]=await Promise.all([
  'site/index.html','site/events/aureva.html','site/event.html',
  'netlify/functions/ticket-view.mjs','site/assets/js/event.js','.env.example'
].map(read));
assert.ok(home.includes('JAN 23 / 2027'),'Homepage date must use Jan 23');
assert.ok(!home.includes('DEC 19 / 2026'),'Prior event date must be removed from homepage');
assert.ok(canonical.includes('Saturday, January 23, 2027'),'Canonical event page must show the new day');
assert.ok(canonical.includes('7:00 PM–3:00 AM HST'),'Event times must appear without JS');
assert.ok(canonical.includes('Sunday, January 24, 2027'),'Late departure must include date');
assert.ok(generic.includes('10:00 AM HST on Sunday, January 24, 2027'),'Legacy realm page must show correct late checkout');
assert.ok(ticket.includes('SUNDAY JAN 24, 2027'),'Digital ticket badge must show exact departure day');
assert.ok(hydration.includes('data-time') && hydration.includes('fmtTime.format'),
  'The event heading must hydrate start/end times from the event record');
assert.ok(template.includes('WILDONES_AUREVA_2026_LATE_STAY_DEPARTURE_TIME=10:00 AM'),
  'Netlify environment template must preserve late checkout time');
console.log('AUREVA Jan 23, 2027 / 7 PM–3 AM, and Jan 24 10 AM late checkout: verified.');
