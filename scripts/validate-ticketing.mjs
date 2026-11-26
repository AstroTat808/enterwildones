import { lateWaiverText,lateWaiverHash,lateAcceptanceMatches,lateWaiverIsCurrent,LATE_WAIVER_VERSION } from '../netlify/functions/_waiver-evidence.mjs';
import { readFile } from 'node:fs/promises';
import { listEvents } from '../netlify/functions/_events.mjs';
import { ticketPriceEnvName } from '../netlify/functions/_payments.mjs';
import { inviteAccessCookieName } from '../netlify/functions/_invitations.mjs';
import { WAIVER_VERSION, waiverHash, waiverText, waiverAcceptanceMatches, waiverIsCurrent } from '../netlify/functions/_waiver.mjs';

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
  const hash=waiverHash(event.eventId), version=WAIVER_VERSION, current={eventId:event.eventId,waiverVersion:version,waiverTextHash:hash,signedAt:'2026-11-25T00:00:00Z'};
  for(const phrase of ["Wild Ones LLC and Koa's Events LLC",'§ 663-1.54','DISCLOSURE OF RISKS','LIMITS OF RELEASE','ordinary negligence','Each Released Party is an intended beneficiary']) if(!waiverText(event.eventId).includes(phrase)) fail(`Missing waiver protection: ${phrase}`);
  if(!waiverAcceptanceMatches(current,event.eventId)||!waiverIsCurrent(current,event.eventId)) fail('Current waiver rejected');
  for(const invalid of [{...current,waiverVersion:'2026-09-09.1'},{...current,waiverTextHash:'0'.repeat(64)},{},null]) if(waiverAcceptanceMatches(invalid,event.eventId)||waiverIsCurrent(invalid,event.eventId)) fail('Missing or stale waiver accepted');
  const ticket={eventId:event.eventId,ticketId:'test-ticket',userId:'test-user'};
  const late={...ticket,kind:'late_stay',waiverVersion:LATE_WAIVER_VERSION,waiverTextHash:lateWaiverHash(event.eventId),waiverText:lateWaiverText(event.eventId),signedAt:'2026-11-25T00:00:00Z',electronicConsent:true,affirmativeAcceptance:true};
  if(!lateWaiverIsCurrent(late,ticket)||!lateAcceptanceMatches(late,event.eventId)) fail('Valid late stay waiver rejected');
  for(const bad of [{...late,userId:'different'},{...late,ticketId:'different'},{...late,waiverText:'changed'},{...late,affirmativeAcceptance:false},{...late,waiverTextHash:hash},null]) if(lateWaiverIsCurrent(bad,ticket)) fail('Incorrect late waiver accepted');
  if(!lateWaiverText(event.eventId).includes("Wild Ones LLC and Koa's Events LLC"))fail('Both businesses must be released');
  const other=events.find(e=>e.eventId!==event.eventId);if(waiverAcceptanceMatches(current,other.eventId)||waiverIsCurrent(current,other.eventId)) fail('Cross-event waiver accepted');
}
const checks={
  'create-checkout.mjs':['event_id','invitation_id','purchase_type','expected_amount','sameOrigin','maxTickets'],
  'stripe-webhook.mjs':['verifyStripeSignature','finalizePaidSession','charge.refunded','charge.dispute.created'],
  'ticket-confirmed.mjs':['verifyCheckoutReturn','finalizePaidSession'],
  'ticket-view.mjs':['waiverGate','name="waiverVersion"','name="waiverTextHash"','Read the complete waiver','privateVenue','/ticket/qr','/ticket/wallet','ticket-credential','ticket-meta-grid','ticket-qr-panel','ticket-support-grid','activeTicketEntitlements','ticket-entitlement-badge','COLLECTED WITH THIS CREDENTIAL','creditsRemaining','departureTime'],
  'ticket-waiver.mjs':['waiverHash','sameOrigin','signerName','waiverAcceptanceMatches','waiverText:waiverText','archiveWaiver','affirmativeAcceptance:true'],
  'ticket-qr.mjs':['waiverGate','verifyTicketToken'],
  'check-in.mjs':['WRONG EVENT','waiverGate','sameOrigin'],
  'ticket-wallet.mjs':['waiverGate','appleWalletConfigured'],
  '_waiver-evidence.mjs':['waiverIsCurrent','lateWaiverIsCurrent','onlyIfNew:true','archiveDigest','lateEntitlement'],
  'ticket-late-waiver.mjs':['lateAcceptanceMatches','sameOrigin','archiveWaiver','lateEntitlement'],
  'admin-waivers.mjs':['isAdmin','archiveDigest','writeAudit','Cache-Control']
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
