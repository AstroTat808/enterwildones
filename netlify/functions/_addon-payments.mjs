import { blobStore } from './_blob-store.mjs';
import { requireEvent } from './_events.mjs';
import { getAddon } from './_addons.mjs';
import { loadTicket } from './_payments.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';

export async function entitlementFor(eventId,ticketId,addonType){return blobStore(STORES.entitlements).get(eventKey(eventId,`${ticketId}/${addonType}`),{type:'json'}).catch(()=>null);}

export async function finalizeAddonSession(session,{source='webhook'}={}){
  if(!session?.id||session.payment_status!=='paid')throw new Error('Add-on Checkout Session is not paid.');
  const eventId=String(session.metadata?.event_id||''),ticketId=String(session.metadata?.ticket_id||''),userId=String(session.metadata?.user_id||''),addonType=String(session.metadata?.addon_type||'');
  requireEvent(eventId);if(session.metadata?.purchase_type!=='addon')throw new Error('Unsupported purchase type.');
  const addon=getAddon(eventId,addonType);if(!addon?.enabled)throw new Error('Add-on is not configured for this event.');
  if(Number(session.amount_total)!==Number(addon.priceCents)||String(session.currency||'').toLowerCase()!=='usd'||Number(session.metadata?.expected_amount)!==Number(addon.priceCents)||String(session.metadata?.expected_currency||'').toLowerCase()!=='usd')throw new Error('Add-on amount or currency mismatch.');
  const ticket=await loadTicket(eventId,ticketId);if(!ticket||ticket.userId!==userId||!['paid','checked_in'].includes(ticket.status))throw new Error('Add-on ticket identity is invalid or inactive.');
  const entitlements=blobStore(STORES.entitlements),key=eventKey(eventId,`${ticketId}/${addonType}`),existing=await entitlements.get(key,{type:'json'}).catch(()=>null);
  if(existing?.status==='active'&&existing.paymentId===session.id)return existing;
  if(existing?.status==='active'&&existing.paymentId!==session.id)throw new Error('This add-on is already active on the ticket.');
  const now=new Date().toISOString();const record={entitlementId:`ent_${ticketId}_${addonType}`,eventId,ticketId,userId,addonType,status:'active',paymentId:session.id,priceCents:addon.priceCents,purchasedAt:now,updatedAt:now,...(addonType==='drink_package'?{creditsPurchased:addon.credits,creditsRedeemed:0,creditsRemaining:addon.credits,wristbandActivatedAt:null}:{departureTime:addon.departureTime})};
  await entitlements.setJSON(key,record);
  const payment={paymentId:session.id,eventId,ticketId,userId,purchaseType:'addon',addonType,status:'paid',stripePaymentIntentId:session.payment_intent||null,amountTotal:session.amount_total,currency:session.currency,paidAt:now,updatedAt:now};await blobStore(STORES.payments).setJSON(eventKey(eventId,session.id),payment);
  if(session.payment_intent)await blobStore(STORES.paymentIndexes).setJSON(`pi/${session.payment_intent}`,{eventId,paymentId:session.id,ticketId,purchaseType:'addon',addonType});
  await writeAudit({eventId,action:'addon.purchased',actor:'system',targetType:'ticket',targetId:ticketId,detail:{addonType,paymentId:session.id,source}});return record;
}

export async function markAddonPaymentInactiveByIntent(paymentIntentId,status,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(index?.purchaseType!=='addon'||!index.eventId||!index.ticketId||!index.addonType)return null;const store=blobStore(STORES.entitlements),key=eventKey(index.eventId,`${index.ticketId}/${index.addonType}`),entitlement=await store.get(key,{type:'json'}).catch(()=>null);if(!entitlement)return null;const now=new Date().toISOString(),updated={...entitlement,status,updatedAt:now,...(status==='refunded'?{refundedAt:now}:{}),...(status==='disputed'?{disputedAt:now}:{})};await store.setJSON(key,updated);const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,status,updatedAt:now,...detail});await writeAudit({eventId:index.eventId,action:`addon.${status}`,actor:'stripe',targetType:'ticket',targetId:index.ticketId,detail:{addonType:index.addonType,...detail}});return updated;}

export async function noteAddonPartialRefundByIntent(paymentIntentId,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(index?.purchaseType!=='addon'||!index.eventId)return null;const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,partialRefund:true,updatedAt:new Date().toISOString(),...detail});await writeAudit({eventId:index.eventId,action:'addon.partial_refund',actor:'stripe',targetType:'payment',targetId:index.paymentId,detail:{addonType:index.addonType,...detail}});return payment;}

export async function restoreAddonByIntent(paymentIntentId,detail={}){const index=await blobStore(STORES.paymentIndexes).get(`pi/${paymentIntentId}`,{type:'json'}).catch(()=>null);if(index?.purchaseType!=='addon'||!index.eventId||!index.ticketId||!index.addonType)return null;const store=blobStore(STORES.entitlements),key=eventKey(index.eventId,`${index.ticketId}/${index.addonType}`),entitlement=await store.get(key,{type:'json'}).catch(()=>null);if(!entitlement||entitlement.status!=='disputed')return entitlement;const payment=await blobStore(STORES.payments).get(eventKey(index.eventId,index.paymentId),{type:'json'}).catch(()=>null);if(payment?.status==='refunded')return entitlement;const now=new Date().toISOString(),updated={...entitlement,status:'active',disputeResolvedAt:now,updatedAt:now};await store.setJSON(key,updated);if(payment)await blobStore(STORES.payments).setJSON(eventKey(index.eventId,index.paymentId),{...payment,status:'paid',disputeResolvedAt:now,updatedAt:now,...detail});await writeAudit({eventId:index.eventId,action:'addon.dispute_won',actor:'stripe',targetType:'ticket',targetId:index.ticketId,detail:{addonType:index.addonType,...detail}});return updated;}
