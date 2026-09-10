import { readFile } from 'node:fs/promises';
import { listEvents } from '../netlify/functions/_events.mjs';
import { ticketPriceEnvName } from '../netlify/functions/_payments.mjs';
import { inviteAccessCookieName } from '../netlify/functions/_invitations.mjs';
import { waiverHash } from '../netlify/functions/_waiver.mjs';

const fail=(m)=>{throw new Error(m)};
const events=listEvents({includeHidden:true});
if(events.length!==4) fail('Expected four events.');
const cookieNames=new Set();
for(const event of events){
  const priceKey=ticketPriceEnvName(event.eventId);
  if(!/^WILDONES_[A-Z0-9_]+_TICKET_PRICE_CENTS$/.test(priceKey)) fail(`Bad price key ${priceKey}`);
  const cookie=inviteAccessCookieName(event.eventId);
  if(cookieNames.has(cookie)) fail(`Duplicate invite cookie ${cookie}`);
  cookieNames.add(cookie);
  if(!/^[a-f0-9]{64}$/.test(waiverHash(event.eventId))) fail(`Bad waiver hash for ${event.eventId}`);
}
const checks={
  'create-checkout.mjs':['event_id','invitation_id','purchase_type','expected_amount','sameOrigin','maxTickets'],
  'stripe-webhook.mjs':['verifyStripeSignature','finalizePaidSession','charge.refunded','charge.dispute.created'],
  'ticket-confirmed.mjs':['verifyCheckoutReturn','finalizePaidSession'],
  'ticket-view.mjs':['waiverIsCurrent','privateVenue','/ticket/qr','/ticket/wallet'],
  'ticket-waiver.mjs':['waiverHash','sameOrigin','signerName'],
  'ticket-qr.mjs':['waiverIsCurrent','verifyTicketToken'],
  'check-in.mjs':['WRONG EVENT','waiverIsCurrent','sameOrigin'],
  'ticket-wallet.mjs':['waiverIsCurrent','appleWalletConfigured']
};
for(const [file,needles] of Object.entries(checks)){
  const src=await readFile(new URL(`../netlify/functions/${file}`,import.meta.url),'utf8');
  for(const needle of needles) if(!src.includes(needle)) fail(`${file} missing ${needle}`);
}
const netlify=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
for(const route of ['/ticket-access','/check-in']) if(!netlify.includes(`from = "${route}"`)) fail(`Missing redirect ${route}`);
for(const header of ['/ticket*','/check-in*']) if(!netlify.includes(`for = "${header}"`)) fail(`Missing headers ${header}`);
const env=await readFile(new URL('../.env.example',import.meta.url),'utf8');
for(const event of events){
  if(!env.includes(ticketPriceEnvName(event.eventId))) fail(`Missing ${ticketPriceEnvName(event.eventId)}`);
  const prefix=`WILDONES_${event.eventId.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}`;
  for(const suffix of ['_VENUE_NAME','_VENUE_ADDRESS','_VENUE_INSTRUCTIONS']) if(!env.includes(prefix+suffix)) fail(`Missing ${prefix+suffix}`);
}
console.log('Validated multi-event ticketing, payment, waiver, QR, wallet, venue, and gate boundaries.');
