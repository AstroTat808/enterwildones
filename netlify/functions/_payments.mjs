import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';
import { makeTicketId, makeTicketToken } from './_ticket-token.mjs';
import { stripePost } from './_stripe.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

export function ticketPriceEnv(eventId){return `WILDONES_${String(eventId).toUpperCase().replace(/[^A-Z0-9]/g,'_')}_TICKET_PRICE_CENTS`;}
export const ticketPriceEnvName=ticketPriceEnv;
export function ticketPriceCents(eventId){const value=Number(env(ticketPriceEnv(eventId)));return Number.isInteger(value)&&value>=50?value:null;}
function ticketProductName(event){return `${event.name} Festival - General Admission`;}
export async function loadInvitation(eventId,invitationId){return blobStore(STORES.invitations).get(eventKey(eventId,invitationId),{type:'json'}).catch(()=>null);}
export async function loadTicket(eventId,ticketId){return blobStore(STORES.tickets).get(eventKey(eventId,ticketId),{type:'json'}).catch(()=>null);}
export async function loadApplication(eventId,applicationId){return blobStore(STORES.applications).get(eventKey(eventId,applicationId),{type:'json'}).catch(()=>null);}
export async function existingTicketForInvitation(eventId,invitationId){const indexes=blobStore(STORES.ticketIndexes);const ref=await indexes.get(eventKey(eventId,`invitation/${invitationId}`),{type:'json'}).catch(()=>null);if(!ref?.ticketId)return null;return loadTicket(eventId,ref.ticketId);}
async function sendReceipt(event,ticket,application,session,token){if(!env('RESEND_API_KEY')||!env('WILDONES_EMAIL_FROM')||!application?.email)return;const site=(env('WILDONES_SITE_URL')||'https://enterwildones.com').replace(/\/$/,'');const ticketUrl=`${site}/ticket?token=${encodeURIComponent(token)}`;const amount=(Number(session.amount_total||0)/100).toFixed(2);const currency=String(session.currency||'usd').toUpperCase();const text=[`${application.preferredName||application.fullName||'Guest'},`,'',`Your ${event.name} ticket is confirmed.`,`Ticket ID: ${ticket.ticketId}`,`Amount: ${currency} ${amount}`,`Open your digital ticket: ${ticketUrl}`,'','Your QR code remains locked until the required waiver is signed. Keep your ticket link private.',`Support: ${env('WILDONES_HELP_EMAIL','help@enterwildones.com')}`].join('\n');const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`wildones-ticket-${session.id}`.slice(0,256)},body:JSON.stringify({from:env('WILDONES_EMAIL_FROM'),to:[application.email],subject:`Your ${event.name} Ticket Is Confirmed`,text})});if(!response.ok)console.error('Ticket receipt failed',response.status);}
async function refundDuplicate(session,eventId,reason){if(!session.payment_intent)return null;return stripePost('refunds',{payment_intent:session.payment_intent,reason:'duplicate','metadata[event_id]':eventId,'metadata[automatic_reason]':reason},`wildones-duplicate-refund-${session.id}`);}

export async function finalizePaidSession(session,{source='webhook'}={}){
  if(!session?.id||session.payment_status!=='paid')throw new Error('Checkout Session is not paid.');
  const eventId=String(session.metadata?.event_id||''),invitationId=String(session.metadata?.invitation_id||''),applicationId=String(session.metadata?.application_id||''),userId=String(session.metadata?.user_id||'');
  const event=requireEvent(eventId);
  if(session.metadata?.purchase_type!=='admission')throw new Error('Unsupported purchase type.');
  const expected=ticketPriceCents(eventId),currency=String(session.currency||'').toLowerCase(),expectedCurrency=String(session.metadata?.expected_currency||'usd').toLowerCase();
  if(!expected||Number(session.amount_total)!==expected||Number(session.metadata?.expected_amount)!==expected||currency!==expectedCurrency||currency!=='usd')throw new Error('Checkout amount or currency does not match the configured event price.');
  if(!invitationId||!applicationId||!userId)throw new Error('Checkout identity metadata is incomplete.');

  const payments=blobStore(STORES.payments);
  const existingPayment=await payments.get(eventKey(eventId,session.id),{type:'json'}).catch(()=>null);
  if(existingPayment?.status==='paid'&&existingPayment.ticketId){const ticket=await loadTicket(eventId,existingPayment.ticketId);if(!ticket)throw new Error('Paid payment is missing its ticket.');return{ticket,payment:existingPayment,duplicate:false};}

  const invitation=await loadInvitation(eventId,invitationId);
  if(!invitation||invitation.eventId!==eventId||invitation.applicationId!==applicationId||invitation.userId!==userId||!['redeemed','fulfilled'].includes(invitation.status))throw new Error('Invitation does not match the paid checkout.');
  if(Number(invitation.maxTickets||1)!==1)throw new Error('Multi-ticket invitations cannot be finalized through single-person admission.');

  const duplicateTicket=await existingTicketForInvitation(eventId,invitationId);
  if(duplicateTicket&&['paid','checked_in'].includes(duplicateTicket.status)&&duplicateTicket.paymentId!==session.id){
    const refund=await refundDuplicate(session,eventId,'invitation_already_fulfilled');const now=new Date().toISOString();const payment={paymentId:session.id,eventId,invitationId,applicationId,userId,status:'duplicate_refunded',stripePaymentIntentId:session.payment_intent||null,amountTotal:session.amount_total,currency,refundId:refund?.id||null,updatedAt:now};await payments.setJSON(eventKey(eventId,session.id),payment);await writeAudit({eventId,action:'payment.duplicate_refunded',actor:'system',targetType:'payment',targetId:session.id,detail:{ticketId:duplicateTicket.ticketId,refundId:refund?.id||null}});return{ticket:duplicateTicket,payment,duplicate:true};
  }

  const ticketId=makeTicketId(event,invitationId),issuedAt=new Date().toISOString();
  const ticket={ticketId,eventId,userId,applicationId,invitationId,paymentId:session.id,status:'paid',ticketSource:'stripe',issuedAt,updatedAt:issuedAt,checkedInAt:null,waiverSignedAt:null,waiverVersion:null,waiverTextHash:null};
  await blobStore(STORES.tickets).setJSON(eventKey(eventId,ticketId),ticket);
  const authoritative=await loadTicket(eventId,ticketId);
  if(authoritative?.paymentId&&authoritative.paymentId!==session.id){
    const refund=await refundDuplicate(session,eventId,'concurrent_invitation_payment');const duplicatePayment={paymentId:session.id,eventId,invitationId,applicationId,userId,ticketId:authoritative.ticketId,status:'duplicate_refunded',stripePaymentIntentId:session.payment_intent||null,amountTotal:session.amount_total,currency,refundId:refund?.id||null,updatedAt:new Date().toISOString()};await payments.setJSON(eventKey(eventId,session.id),duplicatePayment);return{ticket:authoritative,payment:duplicatePayment,duplicate:true};
  }

  const ticketIndexes=blobStore(STORES.ticketIndexes);await Promise.all([ticketIndexes.setJSON(eventKey(eventId,`invitation/${invitationId}`),{ticketId,eventId,createdAt:issuedAt}),ticketIndexes.setJSON(eventKey(eventId,`payment/${session.id}`),{ticketId,eventId,createdAt:issuedAt})]);
  if(session.payment_intent)await blobStore(STORES.paymentIndexes).setJSON(`pi/${session.payment_intent}`,{eventId,paymentId:session.id,ticketId});
  const payment={paymentId:session.id,eventId,invitationId,applicationId,userId,ticketId,status:'paid',paymentStatus:session.payment_status,stripePaymentIntentId:session.payment_intent||null,amountTotal:session.amount_total,currency,paidAt:issuedAt,updatedAt:issuedAt};await payments.setJSON(eventKey(eventId,session.id),payment);
  await blobStore(STORES.invitations).setJSON(eventKey(eventId,invitationId),{...invitation,status:'fulfilled',purchaseCount:1,fulfilledAt:issuedAt,updatedAt:issuedAt});
  const token=makeTicketToken(ticket);if(!token)throw new Error('Ticket token could not be generated.');
  const application=await loadApplication(eventId,applicationId);await sendReceipt(event,ticket,application,session,token).catch(()=>{});
  await writeAudit({eventId,action:'ticket.issued',actor:'system',targetType:'ticket',targetId:ticketId,detail:{paymentId:session.id,source}});
  return{ticket,payment,token,duplicate:false};
}

export async function markPaymentInactiveByIntent(paymentIntentId,status,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(!index?.eventId||!index?.ticketId)return null;const ticket=await loadTicket(index.eventId,index.ticketId);if(!ticket)return null;const now=new Date().toISOString();const updated={...ticket,status,updatedAt:now,...(status==='refunded'?{refundedAt:now}:{}),...(status==='disputed'?{disputedAt:now}:{})};await blobStore(STORES.tickets).setJSON(eventKey(index.eventId,index.ticketId),updated);const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,status,updatedAt:now,...detail});await writeAudit({eventId:index.eventId,action:`payment.${status}`,actor:'stripe',targetType:'ticket',targetId:index.ticketId,detail});return updated;}

export async function notePartialRefundByIntent(paymentIntentId,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(!index?.eventId)return null;const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);const now=new Date().toISOString();if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,partialRefund:true,updatedAt:now,...detail});await writeAudit({eventId:index.eventId,action:'payment.partial_refund',actor:'stripe',targetType:'payment',targetId:index.paymentId,detail});return payment;}

export async function restorePaymentByIntent(paymentIntentId,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(!index?.eventId||!index?.ticketId)return null;const ticket=await loadTicket(index.eventId,index.ticketId);if(!ticket||ticket.status!=='disputed')return ticket;const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);if(payment?.status==='refunded')return ticket;const now=new Date().toISOString();const updated={...ticket,status:ticket.checkedInAt?'checked_in':'paid',disputeResolvedAt:now,updatedAt:now};await blobStore(STORES.tickets).setJSON(eventKey(index.eventId,index.ticketId),updated);if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,status:'paid',disputeResolvedAt:now,updatedAt:now,...detail});await writeAudit({eventId:index.eventId,action:'payment.dispute_won',actor:'stripe',targetType:'ticket',targetId:index.ticketId,detail});return updated;}
export { ticketProductName };
