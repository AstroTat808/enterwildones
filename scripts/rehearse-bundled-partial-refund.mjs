// In-memory end-to-end refund rehearsal; no Neon connection or Stripe charge.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const blobsMock = [
  'export const getStore = name => globalThis.__qaBundleStore(name);',
  'export const getDeployStore = name => globalThis.__qaBundleStore(name);'
].join('\n');
const sqlMock = [
  'export class Pool {',
  '  async connect(){return{async query(){return{rows:[]}},release(){}}}',
  '  async end(){}',
  '}',
  'export const neon = () => async () => [globalThis.__qaDrinkLedger];'
].join('\n');
registerHooks({
  resolve(specifier, context, next) {
    if(specifier==='@netlify/blobs')return{url:'data:text/javascript,'+encodeURIComponent(blobsMock),shortCircuit:true};
    if(specifier==='@neondatabase/serverless')return{url:'data:text/javascript,'+encodeURIComponent(sqlMock),shortCircuit:true};
    return next(specifier, context);
  }
});
const stores=new Map();
globalThis.__qaBundleStore = name => {
  if(!stores.has(name))stores.set(name,new Map());
  const map=stores.get(name);
  return {
    async get(key){return map.has(key)?structuredClone(map.get(key)):null},
    async setJSON(key,value){map.set(key,structuredClone(value))},
    async list({prefix=''}){return{blobs:[...map.keys()].filter(x=>x.startsWith(prefix)).map(key=>({key}))}}
  };
};
globalThis.Netlify={context:{deploy:{context:'production'}}};
process.env.DATABASE_URL='postgresql://qa.invalid/refund';
process.env.STRIPE_SECRET_KEY='sk_test_qa_mock_only';
const eventId='aureva-2026',ticketId='AUR-QA-TEST',paymentId='cs_test_qa_bundle',intentId='pi_test_qa_bundle';
globalThis.__qaDrinkLedger={event_id:eventId,ticket_id:ticketId,user_id:'qa-user',credits_purchased:6,credits_redeemed:0,credits_remaining:6,wristband_activated_at:null,wristband_code:null,updated_at:new Date()};
const { STORES,eventKey }=await import('../netlify/functions/_stores.mjs');
const { refundBundledAddon,reconcileBundledRefund }=await import('../netlify/functions/_bundle-refunds.mjs');
const tickets=globalThis.__qaBundleStore(STORES.tickets),payments=globalThis.__qaBundleStore(STORES.payments),ent=globalThis.__qaBundleStore(STORES.entitlements);
const ticket={eventId,ticketId,paymentId,userId:'qa-user',status:'paid',checkedInAt:null};
const selectedAddons=[
  {addonType:'drink_package',name:'Drink Package',priceCents:7500,credits:6},
  {addonType:'late_stay',name:'Late Checkout / Car Camping',priceCents:2500,departureTime:'10:00 AM'}
];
const payment={eventId,paymentId,status:'paid',purchaseType:'admission',stripePaymentIntentId:intentId,amountTotal:15500,admissionPriceCents:5500,addonSubtotalCents:10000,selectedAddons};
await tickets.setJSON(eventKey(eventId,ticketId),ticket);
await payments.setJSON(eventKey(eventId,paymentId),payment);
for(const item of selectedAddons)
  await ent.setJSON(eventKey(eventId,ticketId+'/'+item.addonType),{
    eventId,ticketId,paymentId,addonType:item.addonType,userId:'qa-user',purchaseSource:'admission_bundle',
    priceCents:item.priceCents,status:'active',
    ...(item.addonType==='drink_package'?{creditsPurchased:6,creditsRedeemed:0,creditsRemaining:6,wristbandActivatedAt:null}:{departureTime:'10:00 AM'})
  });

const refundObjects=[];
const calls=[];
globalThis.fetch=async(input,options={})=>{
  const target=String(input?.url||input),url=new URL(target),params=new URLSearchParams(String(options.body||''));
  assert.equal(url.origin,'https://api.stripe.com','No external network calls allowed');
  calls.push({method:options.method||'GET',path:url.pathname,params:Object.fromEntries(params)});
  if((options.method||'GET')==='GET'){
    assert.equal(url.pathname,'/v1/refunds');
    assert.equal(url.searchParams.get('payment_intent'),intentId);
    return Response.json({data:refundObjects,has_more:false});
  }
  assert.equal(url.pathname,'/v1/refunds');
  assert.equal(params.get('payment_intent'),intentId);
  assert.equal(params.get('reason'),'requested_by_customer');
  assert.equal(params.get('metadata[admin_action]'),'bundle_addon_partial_refund');
  assert.match(options.headers['Idempotency-Key'],/^wildones-bundle-addon-refund-/);
  const refund={
    id:'re_test_'+(refundObjects.length+1),
    status:'succeeded',
    amount:Number(params.get('amount')),
    payment_intent:intentId,
    metadata:{
      admin_action:params.get('metadata[admin_action]'),
      event_id:params.get('metadata[event_id]'),
      payment_id:params.get('metadata[payment_id]'),
      ticket_id:params.get('metadata[ticket_id]'),
      addon_type:params.get('metadata[addon_type]')
    }
  };
  refundObjects.push(refund);
  return Response.json(refund);
};

const basic={eventId,ticketId,ticket,payment,entitlement:null};
const first=await refundBundledAddon({...basic,addonType:'drink_package'});
assert.deepEqual({status:first.status,amountCents:first.amountCents,remaining:first.remainingAdmissionActive},
  {status:'succeeded',amountCents:7500,remaining:true});
assert.equal((await tickets.get(eventKey(eventId,ticketId))).status,'paid');
assert.equal((await ent.get(eventKey(eventId,ticketId+'/drink_package'))).status,'refunded');
assert.equal((await ent.get(eventKey(eventId,ticketId+'/late_stay'))).status,'active');
assert.equal((await payments.get(eventKey(eventId,paymentId))).partialRefunds.length,1);
assert.equal(calls.filter(x=>x.method==='POST').length,1);
await reconcileBundledRefund(refundObjects[0]);
assert.equal((await payments.get(eventKey(eventId,paymentId))).partialRefunds.length,1,'Duplicate webhook must not double-count the refund');
await assert.rejects(refundBundledAddon({...basic,addonType:'drink_package'}),e=>e.code==='ADDON_NOT_ACTIVE');
assert.equal(calls.filter(x=>x.method==='POST').length,1,'Duplicate refund should never create another payment reversal');

const second=await refundBundledAddon({...basic,addonType:'late_stay'});
assert.equal(second.amountCents,2500);
assert.equal((await ent.get(eventKey(eventId,ticketId+'/late_stay'))).status,'refunded');
assert.equal((await tickets.get(eventKey(eventId,ticketId))).status,'paid');
const result=await payments.get(eventKey(eventId,paymentId));
assert.equal(result.amountTotal,15500,'Original purchase amount must never be rewritten');
assert.equal(result.partialRefunds.length,2);
assert.equal(result.partialRefunds.reduce((n,x)=>n+x.amount,0),10000);
assert.equal(calls.filter(x=>x.method==='POST').length,2);
const audit=globalThis.__qaBundleStore(STORES.audit);
const list=await audit.list({prefix:eventId+'/'});
assert.ok(list.blobs.length>=2,'Refund settlements must leave audit evidence');
console.log('Mocked bundled refund flow: 75+25 exact Stripe partial refunds, paid ticket preserved, other add-on preserved, duplicate webhook and retry guarded.');
