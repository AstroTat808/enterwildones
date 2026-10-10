import { blobStore } from './_blob-store.mjs';
import { randomUUID } from 'node:crypto';
import { finalizePaidSession, markPaymentInactiveByIntent, notePartialRefundByIntent, restorePaymentByIntent } from './_payments.mjs';
import { finalizeAddonSession, markAddonPaymentInactiveByIntent, noteAddonPartialRefundByIntent, restoreAddonByIntent } from './_addon-payments.mjs';
import { verifyStripeSignature } from './_stripe.mjs';
import { getEvent } from './_events.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { releaseAdmission } from './_admission-inventory.mjs';
import { stripeGet } from './_stripe.mjs';

async function claim(event){const store=blobStore(STORES.stripeEvents);const key=String(event.id||'');if(!/^evt_[A-Za-z0-9_]+$/.test(key))throw new Error('Invalid Stripe event ID.');const existing=await store.get(key,{type:'json'}).catch(()=>null);if(existing?.status==='processed')return{duplicate:true};const nonce=randomUUID();const now=new Date().toISOString();await store.setJSON(key,{stripeEventId:key,type:event.type,status:'processing',nonce,startedAt:now,updatedAt:now});const latest=await store.get(key,{type:'json'}).catch(()=>null);return latest?.nonce===nonce?{duplicate:false,store,key,nonce,type:event.type}:{duplicate:true};}
async function complete(c,status,error=null){if(!c?.store)return;await c.store.setJSON(c.key,{stripeEventId:c.key,status,type:c.type||null,nonce:c.nonce,completedAt:new Date().toISOString(),error:error?String(error).slice(0,500):null,updatedAt:new Date().toISOString()});}
async function markExpired(session){const eventId=String(session.metadata?.event_id||'');if(!getEvent(eventId)||!session.id)return;const store=blobStore(STORES.payments);const key=eventKey(eventId,session.id);const existing=await store.get(key,{type:'json'}).catch(()=>null);if(existing?.status==='paid')return;await store.setJSON(key,{...(existing||{}),paymentId:session.id,eventId,status:'expired',updatedAt:new Date().toISOString()});if(session.metadata?.purchase_type==='admission'&&session.metadata?.invitation_id)await releaseAdmission({eventId,invitationId:session.metadata.invitation_id,sessionId:session.id});}
async function paymentIndex(pi){return blobStore(STORES.paymentIndexes).get(`pi/${pi}`,{type:'json'}).catch(()=>null);}
// Charge refunded can be emitted before a refund has actually settled.
// Count only refunds with Stripe status "succeeded" before releasing seats.
async function refundSettledInFull(charge){
  if(!charge?.id||!Number(charge.amount))return false;
  const response=await stripeGet(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`);
  const succeeded=(response.data||[]).filter(r=>r.status==='succeeded').reduce((n,r)=>n+Number(r.amount||0),0);
  return succeeded>=Number(charge.amount);
}
async function refundTransition(obj,full){
  const pi=String(obj.payment_intent||'');if(!pi)return;
  const confirmed=Boolean(full)&&await refundSettledInFull(obj);
  const index=await paymentIndex(pi),detail={chargeId:obj.id,amountRefunded:Number(obj.amount_refunded||0),chargeAmount:Number(obj.amount||0)};
  if(index?.purchaseType==='addon'){
    if(confirmed)await markAddonPaymentInactiveByIntent(pi,'refunded',detail);
    else await noteAddonPartialRefundByIntent(pi,detail);
  }else if(confirmed)await markPaymentInactiveByIntent(pi,'refunded',detail);
  else await notePartialRefundByIntent(pi,detail);
}
async function disputeTransition(obj,status){const pi=String(obj.payment_intent||'');if(!pi)return;const index=await paymentIndex(pi),detail={disputeId:obj.id,chargeId:obj.charge||null};if(status==='won'){if(index?.purchaseType==='addon')await restoreAddonByIntent(pi,detail);else await restorePaymentByIntent(pi,detail);}else if(index?.purchaseType==='addon')await markAddonPaymentInactiveByIntent(pi,'disputed',detail);else await markPaymentInactiveByIntent(pi,'disputed',detail);}
export default async(req)=>{if(req.method!=='POST')return new Response('Method not allowed.',{status:405});const raw=await req.text();if(!verifyStripeSignature(raw,req.headers.get('stripe-signature')))return new Response('Invalid signature.',{status:400});let event;try{event=JSON.parse(raw);}catch{return new Response('Invalid payload.',{status:400});}let c;try{c=await claim(event);if(c.duplicate)return new Response('ok',{status:200});const obj=event.data?.object||{};switch(event.type){case'checkout.session.completed':case'checkout.session.async_payment_succeeded':if(obj.payment_status==='paid'){if(obj.metadata?.purchase_type==='addon')await finalizeAddonSession(obj,{source:'webhook'});else await finalizePaidSession(obj,{source:'webhook'});}break;case'checkout.session.expired':case'checkout.session.async_payment_failed':await markExpired(obj);break;case'charge.refunded':await refundTransition(obj,Boolean(obj.refunded)||Number(obj.amount_refunded||0)>=Number(obj.amount||0));break;case'refund.created':case'refund.updated':if(obj.status==='succeeded'&&obj.charge){const charge=await stripeGet(`charges/${encodeURIComponent(obj.charge)}`);await refundTransition(charge,Boolean(charge.refunded)||Number(charge.amount_refunded||0)>=Number(charge.amount||0));}break;case'charge.dispute.created':await disputeTransition(obj,'created');break;case'charge.dispute.closed':if(obj.status==='won')await disputeTransition(obj,'won');break;default:break;}await complete(c,'processed');return new Response('ok',{status:200});}catch(error){await complete(c,'failed',error).catch(()=>{});console.error('Wild Ones Stripe webhook failed:',error);return new Response('Webhook processing failed.',{status:500});}};
export const config={path:'/api/stripe/webhook'};
