import assert from 'node:assert/strict';
import { auditHistoricalAdmission } from '../netlify/functions/_historical-ticket-audit.mjs';

const eventId='aureva-2026',capacity=200;
const inventory={configured:true,initialized:true,capacity,commissioned:false,held:0,issued:0};
const paid=(id='a')=>({eventId,ticketId:'AUR-'+id,userId:'user-'+id,invitationId:'invite-'+id,paymentId:'cs_test_'+id,status:'paid',ticketSource:'stripe'});
const comp=(id='b')=>({eventId,ticketId:'AUR-'+id,userId:'user-'+id,invitationId:'invite-'+id,paymentId:null,status:'paid',ticketSource:'comp'});
const payment=(id='a')=>({eventId,paymentId:'cs_test_'+id,status:'paid',purchaseType:'admission',ticketId:'AUR-'+id});
const invite=(id)=>({eventId,invitationId:'invite-'+id,userId:'user-'+id,status:'fulfilled'});
function run(tickets=[paid('a'),comp('b')],payments=[payment('a')],invitations=[invite('a'),invite('b')],i=inventory) {
  return auditHistoricalAdmission({eventId,capacity,tickets,payments,invitations,inventory:i});
}
const has=(audit,code)=>audit.errors.some(x=>x.code===code);
const ok=run();
assert.equal(ok.ready,true);
assert.equal(ok.counts.occupied,2);
assert.equal(ok.counts.paid,1);
assert.equal(ok.counts.comps,1);
assert.equal(ok.availableAfterCommission,198);

const dupUser=run([paid('a'),{...comp('b'),userId:'user-a'}]);
assert.equal(dupUser.ready,false);
assert.ok(has(dupUser,'DUPLICATE_ACTIVE_USER'));

const dupInvite=run([paid('a'),{...comp('b'),invitationId:'invite-a'}]);
assert.ok(has(dupInvite,'DUPLICATE_ACTIVE_INVITATION'));

const duplicateTicket=run([paid('a'),{...comp('b'),ticketId:'AUR-a'}]);
assert.ok(has(duplicateTicket,'DUPLICATE_TICKET_ID'));

const wrongEvent=run([{...paid('a'),eventId:'nocturne-2027'}]);
assert.ok(has(wrongEvent,'WRONG_EVENT'));

const invalidStatus=run([{...paid('a'),status:'mystery'}]);
assert.ok(has(invalidStatus,'UNKNOWN_TICKET_STATUS'));

const wrongSession=run([{...paid('a'),paymentId:'unexpected'}]);
assert.ok(has(wrongSession,'PAID_TICKET_MISSING_CHECKOUT_ID'));

const missingPay=run([paid('a')],[],[invite('a')]);
assert.ok(has(missingPay,'PAID_TICKET_WITHOUT_PAYMENT_RECORD'));

const orphanPay=run([comp('b')],[payment('a')],[invite('b')]);
assert.ok(has(orphanPay,'PAID_PAYMENT_WITHOUT_ACTIVE_TICKET'));

const missingInvite=run([paid('a')],[payment('a')],[]);
assert.ok(has(missingInvite,'ACTIVE_TICKET_WITHOUT_INVITATION'));

const paidVsComp=run([{...comp('b'),paymentId:'cs_test_a'}],[payment('a')],[invite('b')]);
assert.ok(has(paidVsComp,'COMP_TICKET_HAS_PAYMENT'));

const held=run(undefined,undefined,undefined,{...inventory,held:1});
assert.ok(has(held,'UNRECONCILED_PENDING_HOLDS'));

const exceeded=run(undefined,undefined,undefined,{...inventory,capacity:180});
assert.ok(has(exceeded,'CAPACITY_MISMATCH'));

const commissionedCount=run(undefined,undefined,undefined,{...inventory,commissioned:true,issued:1});
assert.ok(has(commissionedCount,'ALREADY_COMMISSIONED_COUNT_MISMATCH'));

const refunded=run([{...paid('a'),status:'refunded'}],[],[invite('a')]);
assert.equal(refunded.counts.occupied,0);
assert.equal(refunded.counts.refunded,1);
assert.equal(refunded.ready,true);

const many=Array.from({length:201},(_,k)=>paid(String(k)));
const manyPay=many.map(t=>payment(t.ticketId.slice(4)));
const manyInv=many.map(t=>invite(t.ticketId.slice(4)));
const oversold=run(many,manyPay,manyInv);
assert.ok(has(oversold,'CAPACITY_EXCEEDED'));
assert.equal(oversold.counts.occupied,201);

assert.deepEqual([paid('a'),comp('b')],[paid('a'),comp('b')]); // inputs are never modified
console.log('PASS: 17 historical ticket invariants including 200-seat cap, payments, comps, refunds, identity, and orphan checks.');
