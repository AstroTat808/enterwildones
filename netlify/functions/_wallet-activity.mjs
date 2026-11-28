import { blobStore } from './_blob-store.mjs';
import { sha256 } from './_stores.mjs';
import { getEvent } from './_events.mjs';
export const WALLET_ACTIVITY_STORE='wildones-wallet-activity';
export const TICKET_ACTIVITY=Object.freeze(['offline_issued','offline_saved','google_issued','wallet_admission','wallet_late_stay']);
const validTicket=id=>/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(id||''));
export function walletActivityKey({kind,eventId,ticketId,userId}){
  if(kind==='standalone_observed'&&typeof userId==='string'&&userId)return 'platform/standalone_observed/'+sha256(userId);
  if(TICKET_ACTIVITY.includes(kind)&&getEvent(eventId)&&validTicket(ticketId))return eventId+'/'+kind+'/'+ticketId;
  throw Error('Invalid Wallet activity identity');
}
// A create-only first observation per ticket/action or account. Metrics are best
// effort and never authoritative for access, payment, waiver or redemption.
export async function recordWalletActivity(input){
  try{
    const key=walletActivityKey(input);
    const platform=input.kind==='standalone_observed';
    const record={kind:input.kind,eventId:platform?null:input.eventId,ticketId:platform?null:input.ticketId,firstObservedAt:new Date().toISOString()};
    const result=await blobStore(WALLET_ACTIVITY_STORE).setJSON(key,record,{onlyIfNew:true});
    return Boolean(result&&typeof result.modified==='boolean');
  }catch{return false;}
}
export async function walletActivityExists(input){
  return Boolean(await blobStore(WALLET_ACTIVITY_STORE).get(walletActivityKey(input),{type:'json'}));
}
export async function walletActivityKeys(prefix){
  const {blobs}=await blobStore(WALLET_ACTIVITY_STORE).list({prefix});
  return (blobs||[]).map(x=>x.key);
}
export async function walletActivityRows(eventId){
  if(!getEvent(eventId))throw Error('Unknown event');
  const keys=await walletActivityKeys(eventId+'/');
  const store=blobStore(WALLET_ACTIVITY_STORE),rows=[];
  for(let i=0;i<keys.length;i+=25){
    const batch=await Promise.all(keys.slice(i,i+25).map(key=>store.get(key,{type:'json'})));
    for(const row of batch){if(row?.eventId!==eventId||!TICKET_ACTIVITY.includes(row.kind)||!validTicket(row.ticketId)||!Number.isFinite(Date.parse(row.firstObservedAt)))throw Error('Invalid Wallet activity record');rows.push(row);}
  }
  return rows.sort((a,b)=>String(b.firstObservedAt).localeCompare(String(a.firstObservedAt)));
}
