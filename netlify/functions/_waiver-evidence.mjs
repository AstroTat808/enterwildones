import { blobStore } from './_blob-store.mjs';
import { STORES, eventKey, sha256 } from './_stores.mjs';
import { waiverIsCurrent } from './_waiver.mjs';
import { requireEvent } from './_events.mjs';

export const LATE_WAIVER_VERSION='2026-11-25.1';
export function lateWaiverText(eventId){
  const event=requireEvent(eventId);
  return [
    "WILD ONES LLC & KOA'S EVENTS LLC — LATE CHECKOUT / CAR CAMPING — "+event.name,
    "IMPORTANT — READ BEFORE SIGNING. This supplemental agreement is required for each individual staying after the event. It supplements, and does not replace, the participant waiver. Late stay is limited to the authorized time and designated areas associated with your own active add-on.",
    "DISCLOSED RISKS. Staying overnight outdoors and in vehicles can involve reduced visibility, fatigue, extreme temperatures, rain, wind, uneven and slippery terrain, falling branches, insects, limited facilities, vehicle movement, exhaust and carbon monoxide, fire, theft, and delayed access to emergency assistance. These risks may cause illness, property loss, injury, permanent disability or death. Conditions may change; follow safety instructions and leave an unsafe area when directed.",
    "SAFE STAY RULES. Park only in designated areas; keep roads, emergency routes and access lanes clear. Do not idle an engine, use fuel-burning heaters, grills or generators in or near enclosed sleeping areas, or use open flames except where expressly authorized. Do not drive while impaired or dangerously fatigued; arrange a safe ride or request staff assistance. Follow staff instructions, observe the authorized departure time, report hazards promptly, and seek assistance if unwell. These duties do not eliminate the operators' duty of reasonable care.",
    "RELEASED PARTIES AND ASSUMPTION OF RISK. I knowingly and voluntarily assume the disclosed inherent risks of my authorized late stay and car camping. To the extent permitted by Hawaiʻi law I release Wild Ones LLC and Koa's Events LLC, each in its individual capacity, the premises owners, lessors, lessees, operators, managers, producers, contractors, vendors, volunteers and their respective members, officers, employees, agents and representatives from claims arising from those inherent risks. Each is an intended beneficiary and may independently enforce the applicable provisions.",
    "LIMITS. Ordinary negligence is released only where lawfully permitted. This agreement does not waive negligence where prohibited by HRS § 663-1.54 or other law, gross negligence, recklessness, willful or wanton misconduct, intentional wrongdoing, or other non-waivable liability. Nothing eliminates any legally required safety duty.",
    "EMERGENCY AND ELECTRONIC SIGNATURE. If I cannot consent in an emergency, I authorize staff to contact emergency services and permit reasonable assistance. I agree to conduct this transaction electronically and intend my typed full legal name and affirmative acceptance to constitute my signature on this specific agreement. I have read the disclosed risks, agree voluntarily, and may retain a copy. Hawaiʻi law applies to the extent permitted by law; unenforceable provisions are severable."
  ].join('\n\n');
}
export function lateWaiverHash(eventId){return sha256(lateWaiverText(eventId));}
export function lateAcceptanceMatches(body,eventId){return body?.waiverVersion===LATE_WAIVER_VERSION&&body?.waiverTextHash===lateWaiverHash(eventId);}
export function lateWaiverIsCurrent(record,ticket){return Boolean(record&&record.kind==='late_stay'&&record.eventId===ticket.eventId&&record.ticketId===ticket.ticketId&&record.userId===ticket.userId&&record.waiverVersion===LATE_WAIVER_VERSION&&record.waiverTextHash===lateWaiverHash(ticket.eventId)&&record.waiverText===lateWaiverText(ticket.eventId)&&record.electronicConsent===true&&record.affirmativeAcceptance===true&&record.signedAt);}
export async function lateEntitlement(ticket){
  const value=await blobStore(STORES.entitlements).get(eventKey(ticket.eventId,ticket.ticketId+'/late_stay'),{type:'json'});
  if(!value||value.status!=='active')return null;
  if(value.eventId!==ticket.eventId||value.ticketId!==ticket.ticketId||value.userId!==ticket.userId||value.addonType!=='late_stay')throw new Error('Late-stay entitlement identity mismatch');
  return value;
}
export async function waiverGate(ticket){
  const store=blobStore(STORES.waivers);
  const [base,late,entitlement]=await Promise.all([
    store.get(eventKey(ticket.eventId,ticket.ticketId),{type:'json'}),
    store.get(eventKey(ticket.eventId,ticket.ticketId+'/late_stay'),{type:'json'}),
    lateEntitlement(ticket)
  ]);
  const baseSigned=waiverIsCurrent(base,ticket.eventId)&&base.ticketId===ticket.ticketId&&base.userId===ticket.userId;
  const lateRequired=Boolean(entitlement);
  const lateSigned=lateRequired&&lateWaiverIsCurrent(late,ticket);
  return {base,late,baseSigned,lateRequired,lateSigned,ready:baseSigned&&(!lateRequired||lateSigned)};
}
export function archiveDigest(record){return sha256(JSON.stringify(record));}
export async function archiveWaiver(record){
  if(!record?.eventId||!record.ticketId||!record.signedAt)throw new Error('Invalid waiver archive record');
  const key=eventKey(record.eventId,record.ticketId+'/'+archiveDigest(record));
  const store=blobStore(STORES.waiverHistory);
  const write=await store.setJSON(key,record,{onlyIfNew:true});
  if(!write.modified){
    const previous=await store.get(key,{type:'json'});
    if(!previous||archiveDigest(previous)!==archiveDigest(record))throw new Error('Waiver archive conflict');
  }
  return key;
}
