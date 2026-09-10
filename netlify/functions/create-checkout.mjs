import { blobStore } from './_blob-store.mjs';
import { env } from './_env.mjs';
import { resolveEvent } from './_events.mjs';
import { readInviteAccess } from './_invitations.mjs';
import { makeCheckoutReturn } from './_checkout-return.mjs';
import { ticketPriceCents, ticketPriceEnv, ticketProductName, loadInvitation, existingTicketForInvitation, finalizePaidSession } from './_payments.mjs';
import { makeTicketToken } from './_ticket-token.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { stripeGet, stripePost } from './_stripe.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

const CURRENCY = 'usd';
function validSessionId(value=''){return /^cs_[A-Za-z0-9_]+$/.test(String(value));}
function sessionMatches(session,eventId,invitationId){return session?.metadata?.event_id===eventId&&session?.metadata?.invitation_id===invitationId&&session?.metadata?.purchase_type==='admission';}

async function inspectLatestCheckout(latest,event,invitation){
  if(!latest?.paymentId||!validSessionId(latest.paymentId))return null;
  let session;
  try{session=await stripeGet(`checkout/sessions/${encodeURIComponent(latest.paymentId)}`);}catch{return{error:'Your previous checkout could not be verified safely. Try again shortly.',status:503};}
  if(!sessionMatches(session,event.eventId,invitation.invitationId))return{error:'The previous checkout does not match this invitation.',status:409};
  if(session.payment_status==='paid'||session.status==='complete'){
    try{
      const result=await finalizePaidSession(session,{source:'checkout_recovery'});
      const token=result.token||makeTicketToken(result.ticket);
      if(!token)return{error:'Your payment is confirmed, but the digital ticket could not be opened.',status:503};
      const site=(env('WILDONES_SITE_URL')||'https://enterwildones.com').replace(/\/$/,'');
      return{checkoutUrl:`${site}/ticket?token=${encodeURIComponent(token)}`,reused:true,paid:true};
    }catch{return{error:'Your prior payment may already be complete. Open your confirmation link or contact support before starting another checkout.',status:409};}
  }
  if(session.status==='open'&&session.url)return{checkoutUrl:session.url,reused:true,paid:false};
  if(session.status&&session.status!=='expired')return{error:'Your previous checkout is still being resolved. Try again shortly.',status:409};
  return null;
}

export default async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);
  let body;try{body=await readBody(req);}catch{return json({error:'Invalid checkout request.'},400);}
  const event=resolveEvent({eventId:body.eventId,slug:body.event});
  if(!event||event.visibility!=='public')return json({error:'Event not found.'},404);
  if(!event.ticketSalesOpen)return json({error:`Ticket sales for ${event.name} are not open.`,code:'sales_closed'},403);
  const price=ticketPriceCents(event.eventId);
  if(!price)return json({error:`Ticket price is not configured for ${event.name}.`,code:'price_not_configured',requiredEnv:ticketPriceEnv(event.eventId)},503);
  if(!env('STRIPE_SECRET_KEY')||!env('WILDONES_TICKET_ACCESS_SECRET'))return json({error:'Ticket checkout is not configured.'},503);
  const access=readInviteAccess(req,event.eventId);
  if(!access)return json({error:'Your invitation access is missing or expired. Redeem your event invitation again.',code:'invite_access_required'},401);
  const invitation=await loadInvitation(event.eventId,access.invitationId);
  if(!invitation||invitation.userId!==access.userId||invitation.applicationId!==access.applicationId||!['redeemed','fulfilled'].includes(invitation.status))return json({error:'This invitation is not eligible for checkout.'},403);
  if(!invitation.userId||!invitation.applicationId)return json({error:'This admission requires a registered Wild Ones identity.',code:'identity_required'},409);
  if(Number(invitation.maxTickets||1)!==1)return json({error:'Multi-ticket invitations require the group-ticket identity flow and cannot use single-person checkout.',code:'group_ticket_required'},409);
  if(invitation.status==='fulfilled'||Number(invitation.purchaseCount||0)>=1){const existing=await existingTicketForInvitation(event.eventId,invitation.invitationId);return json({error:'This invitation has already been used for admission.',ticketId:existing?.ticketId||null},409);}

  const latestKey=eventKey(event.eventId,`checkout-latest/${invitation.invitationId}`);
  const payments=blobStore(STORES.payments);
  const latest=await payments.get(latestKey,{type:'json'}).catch(()=>null);
  const prior=await inspectLatestCheckout(latest,event,invitation);
  if(prior){if(prior.error)return json({error:prior.error},prior.status||409);return json({ok:true,checkoutUrl:prior.checkoutUrl,reused:true,paid:Boolean(prior.paid)});}

  const returnToken=makeCheckoutReturn({eventId:event.eventId,invitationId:invitation.invitationId});
  if(!returnToken)return json({error:'Secure checkout return could not be initialized.'},503);
  const site=(env('WILDONES_SITE_URL')||new URL(req.url).origin).replace(/\/$/,'');
  const attempt=Number(latest?.attempt||0)+1;
  const idempotency=`wildones-${event.eventId}-${invitation.invitationId}-${attempt}`.slice(0,255);
  const stripeExpiresAt=Math.floor(Date.now()/1000)+31*60;
  const params={mode:'payment',success_url:`${site}/ticket-confirmed?session_id={CHECKOUT_SESSION_ID}&return_token=${encodeURIComponent(returnToken)}`,cancel_url:`${site}/events/${event.slug}?checkout=cancelled`,client_reference_id:invitation.invitationId,expires_at:String(stripeExpiresAt),'line_items[0][quantity]':'1','line_items[0][price_data][currency]':CURRENCY,'line_items[0][price_data][unit_amount]':String(price),'line_items[0][price_data][product_data][name]':ticketProductName(event),'metadata[event_id]':event.eventId,'metadata[invitation_id]':invitation.invitationId,'metadata[application_id]':invitation.applicationId,'metadata[user_id]':invitation.userId,'metadata[purchase_type]':'admission','metadata[expected_amount]':String(price),'metadata[expected_currency]':CURRENCY,'payment_intent_data[metadata][event_id]':event.eventId,'payment_intent_data[metadata][invitation_id]':invitation.invitationId,'payment_intent_data[metadata][application_id]':invitation.applicationId,'payment_intent_data[metadata][user_id]':invitation.userId,'payment_intent_data[metadata][purchase_type]':'admission'};
  try{
    const session=await stripePost('checkout/sessions',params,idempotency);
    if(!sessionMatches(session,event.eventId,invitation.invitationId)||String(session.currency||CURRENCY).toLowerCase()!==CURRENCY)throw new Error('Stripe returned a checkout identity mismatch.');
    const now=new Date().toISOString();
    const record={paymentId:session.id,eventId:event.eventId,invitationId:invitation.invitationId,applicationId:invitation.applicationId,userId:invitation.userId,status:'checkout_created',attempt,checkoutUrl:session.url,expiresAt:session.expires_at?new Date(session.expires_at*1000).toISOString():new Date(stripeExpiresAt*1000).toISOString(),amountTotal:price,currency:CURRENCY,createdAt:now,updatedAt:now};
    await Promise.all([payments.setJSON(eventKey(event.eventId,session.id),record),payments.setJSON(latestKey,record)]);
    await writeAudit({eventId:event.eventId,action:'checkout.created',actor:'guest',targetType:'payment',targetId:session.id,detail:{invitationId:invitation.invitationId,attempt}});
    return json({ok:true,checkoutUrl:session.url,reused:false});
  }catch(error){return json({error:error.message||'Checkout could not be created.'},502);}
};
export const config={path:'/api/ticket/checkout'};
