import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireEvent } from '../netlify/functions/_events.mjs';
import { ticketPricingSchedule, currentTicketOffer } from '../netlify/functions/_payments.mjs';
import publicPricing from '../netlify/functions/public-pricing.mjs';

const eventId = 'aureva-2026';
const event = requireEvent(eventId);
assert.equal(event.year, 2027);
assert.equal(event.startsAt, '2027-01-23T19:00:00-10:00');
assert.equal(event.endsAt, '2027-01-24T03:00:00-10:00');
assert.equal(event.ticketSalesOpen, false, 'Pricing change must not open sales');

const prefix = 'WILDONES_AUREVA_2026_';
const names = [
 'TICKET_PHASE1_NAME','TICKET_PHASE1_PRICE_CENTS','TICKET_PHASE1_ENDS_AT',
 'TICKET_PHASE2_NAME','TICKET_PHASE2_PRICE_CENTS','TICKET_PHASE2_ENDS_AT',
 'TICKET_PHASE3_NAME','TICKET_PHASE3_PRICE_CENTS','TICKET_PRICE_CENTS'
].map(k=>prefix+k);
const old = new Map(names.map(k=>[k,process.env[k]]));
const set=(k,v)=>{if(v===null)delete process.env[prefix+k];else process.env[prefix+k]=v};
const offer=(iso)=>currentTicketOffer(eventId,Date.parse(iso));
const getPublic=async()=> {
  const r=await publicPricing(new Request('https://enterwildones.com/api/public/pricing?event=aureva'));
  assert.equal(r.status,200);
  return r.json();
};
try {
  set('TICKET_PHASE1_NAME','FIRST LIGHT RELEASE');
  set('TICKET_PHASE1_PRICE_CENTS','5500');
  set('TICKET_PHASE1_ENDS_AT','2027-01-10T00:00:00-10:00');
  set('TICKET_PHASE2_NAME','FULL RADIANCE');
  set('TICKET_PHASE2_PRICE_CENTS','7000');
  set('TICKET_PHASE2_ENDS_AT','');
  set('TICKET_PHASE3_NAME','');
  set('TICKET_PHASE3_PRICE_CENTS','');
  set('TICKET_PRICE_CENTS','');
  assert.equal(ticketPricingSchedule(eventId).complete,true);
  assert.equal(offer('2027-01-09T23:59:59-10:00')?.priceCents,5500,
    'Jan 9 11:59:59 PM HST must remain First Light $55');
  assert.equal(offer('2027-01-10T00:00:00-10:00')?.priceCents,7000,
    'Jan 10 midnight HST must begin Full Radiance $70');
  assert.equal(offer('2026-11-15T16:00:00-10:00')?.next?.priceCents,7000);
  const validPublic=await getPublic();
  assert.equal(validPublic.phases[0].priceCents,5500);
  assert.equal(validPublic.phases[1].priceCents,7000);
  assert.equal(validPublic.scheduleComplete,true);
  assert.equal(validPublic.salesOpen,false);
  set('TICKET_PHASE1_PRICE_CENTS','3500');
  assert.equal(ticketPricingSchedule(eventId).complete,false);
  assert.equal(offer('2026-12-01T00:00:00-10:00'),null,
    'Legacy First Light $35 configuration must block checkout');
  set('TICKET_PHASE1_PRICE_CENTS','5500');
  set('TICKET_PHASE2_PRICE_CENTS','5500');
  assert.equal(offer('2027-01-11T00:00:00-10:00'),null,
    'Legacy Full Radiance $55 configuration must block checkout');
  set('TICKET_PHASE2_PRICE_CENTS','7000');
  set('TICKET_PHASE1_ENDS_AT','2026-10-16T00:00:00-10:00');
  assert.equal(offer('2027-01-10T00:00:00-10:00'),null,
    'Obsolete October cutoff must block checkout');
  const invalidPublic=await getPublic();
  assert.equal(invalidPublic.phases.length,0,'Public response must never show stale prices');
  assert.equal(invalidPublic.current,null);
  assert.equal(invalidPublic.salesOpen,false);
  set('TICKET_PHASE1_ENDS_AT','2027-01-10T00:00:00-10:00');
  set('TICKET_PHASE3_PRICE_CENTS','8500');
  assert.equal(offer('2027-01-10T00:00:00-10:00'),null,'Unapproved ZENITH must block checkout');
  set('TICKET_PHASE3_PRICE_CENTS','');
  set('TICKET_PHASE1_NAME','');
  set('TICKET_PHASE1_PRICE_CENTS','');
  set('TICKET_PHASE2_NAME','');
  set('TICKET_PHASE2_PRICE_CENTS','');
  set('TICKET_PRICE_CENTS','7000');
  assert.equal(offer('2027-01-10T00:00:00-10:00'),null,
    'AUREVA must not fall back to an unphased general-admission price');
  const markup = await readFile(new URL('../site/events/aureva.html', import.meta.url), 'utf8');
  for(const item of ['<div class="release-price">$55</div>','<div class="release-price">$70</div>',
   'ENDS JAN 9 · 11:59 PM HST','BEGINS JAN 10 · 12:00 AM HST']){
    assert.ok(markup.includes(item), 'AUREVA release card missing '+item);
  }
  assert.ok(!markup.includes('ENDS OCT 15'), 'Old price cutoff must not remain');
  const client=await readFile(new URL('../site/assets/js/event.js',import.meta.url),'utf8');
  assert.ok(client.includes('phase1?.priceCents===5500')&&client.includes('phase2?.priceCents===7000'),
    'Client must prevent stale pricing override');
  console.log('AUREVA First Light $55 through Jan 9 and Full Radiance $70 Jan 10: PASS (checkout fails closed on stale pricing).');
}finally{
  for(const [k,v] of old){if(v===undefined)delete process.env[k];else process.env[k]=v}
}
