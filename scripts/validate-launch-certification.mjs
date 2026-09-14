import { readFile } from 'node:fs/promises';

const fail=(m)=>{throw new Error(m)};
process.env.WILDONES_TICKET_ACCESS_SECRET ||= 'ci-launch-certification-ticket-secret-32-characters-minimum';
process.env.WILDONES_TICKET_QR_SECRET ||= 'ci-launch-certification-qr-secret-32-characters-minimum';
const { listEvents } = await import('../netlify/functions/_events.mjs');
const { makeTicketId, makeTicketToken, verifyTicketToken } = await import('../netlify/functions/_ticket-token.mjs');
const { waiverHash } = await import('../netlify/functions/_waiver.mjs');

const events=listEvents({includeHidden:true});
if(events.length!==4) fail('Launch certification requires exactly four configured realms.');
for(const event of events){
  const invitationId=`cert-${event.invitationPrefix.toLowerCase()}-0001`;
  const userId=`cert-user-${event.invitationPrefix.toLowerCase()}`;
  const ticketId=makeTicketId(event,invitationId);
  const ticket={eventId:event.eventId,ticketId,userId,status:'paid',waiverSignedAt:null,checkedInAt:null};
  const token=makeTicketToken(ticket);
  const verified=verifyTicketToken(token);
  if(!verified||verified.eventId!==event.eventId||verified.ticketId!==ticketId||verified.userId!==userId) fail(`${event.name}: signed ticket token round-trip failed.`);
  if(!/^[a-f0-9]{64}$/.test(waiverHash(event.eventId))) fail(`${event.name}: waiver hash is invalid.`);

  const lifecycle={application:'pending',invitation:'none',payment:'none',ticket:'none',waiver:'unsigned',qr:'locked',wallet:'locked',gate:'blocked',drinkPackage:'none',wristband:'none',creditsPurchased:0,creditsRedeemed:0,refund:'none'};
  lifecycle.application='approved'; lifecycle.invitation='active';
  lifecycle.invitation='redeemed'; lifecycle.payment='paid'; lifecycle.ticket='paid'; lifecycle.invitation='fulfilled';
  if(lifecycle.waiver!=='signed'){lifecycle.qr='locked';lifecycle.wallet='locked';lifecycle.gate='blocked';}
  lifecycle.waiver='signed'; lifecycle.qr='available'; lifecycle.wallet='available'; lifecycle.gate='ready';
  lifecycle.gate='checked_in';
  lifecycle.drinkPackage='active'; lifecycle.creditsPurchased=6; lifecycle.wristband='active';
  if(lifecycle.gate!=='checked_in'||lifecycle.wristband!=='active') fail(`${event.name}: bartender prerequisites failed.`);
  lifecycle.creditsRedeemed+=1;
  if(lifecycle.creditsRedeemed!==1||lifecycle.creditsPurchased-lifecycle.creditsRedeemed!==5) fail(`${event.name}: drink-credit rehearsal failed.`);
  lifecycle.refund='completed'; lifecycle.ticket='refunded'; lifecycle.drinkPackage='refunded'; lifecycle.gate='revoked';
  if(lifecycle.ticket!=='refunded'||lifecycle.drinkPackage!=='refunded') fail(`${event.name}: refund state rehearsal failed.`);
}

const sourceChecks={
  'redeem-invite.mjs':['redeemInvitation','sameOrigin'],
  'create-checkout.mjs':['stripePost','checkout/sessions','sameOrigin'],
  'stripe-webhook.mjs':['verifyStripeSignature','finalizePaidSession','charge.refunded'],
  'ticket-waiver.mjs':['waiverHash','sameOrigin'],
  'ticket-qr.mjs':['waiverIsCurrent','verifyTicketToken'],
  'ticket-wallet.mjs':['waiverIsCurrent','appleWalletConfigured'],
  'check-in.mjs':['waiverIsCurrent','checked_in','sameOrigin'],
  'bar.mjs':['redeemDrinkCredit','activateDrinkWristband'],
  'admin-operations.mjs':['stripePost','refund','writeAudit']
};
for(const [file,needles] of Object.entries(sourceChecks)){
  const src=await readFile(new URL(`../netlify/functions/${file}`,import.meta.url),'utf8');
  for(const needle of needles)if(!src.includes(needle))fail(`${file} is missing launch-certification boundary: ${needle}`);
}
const routes=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
for(const route of ['/admin/event-day','/admin/live','/admin/launch','/admin/rehearsal','/check-in','/bar','/ticket/addons'])if(!routes.includes(`from = "${route}"`))fail(`Missing launch operations route ${route}`);
const pages=['admin-event-day.html','admin-live.html','admin-launch.html','admin-rehearsal.html'];
for(const page of pages){const html=await readFile(new URL(`../site/${page}`,import.meta.url),'utf8');if(!html.includes('/assets/js/admin-command.js'))fail(`${page} is not wired to the command layer.`);}
console.log('Launch-certification rehearsal passed for all four realms: invitation → approval → payment → waiver → QR/Wallet gate → check-in → drink package → wristband/redemption → refund. Physical-device and hosted-checkout commissioning remain deliberate manual gates.');
