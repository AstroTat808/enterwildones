import { blobStore } from './_blob-store.mjs';
import { STORES } from './_stores.mjs';
import { getEvent } from './_events.mjs';
import { loadTicket } from './_payments.mjs';
import { readPassportSession } from './_passport-auth.mjs';
import { sameOrigin } from './_security.mjs';
import { json,readBody } from './_response.mjs';
import { waiverGate } from './_waiver-evidence.mjs';
import { recordWalletActivity,walletActivityExists } from './_wallet-activity.mjs';
export default async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);
  const session=readPassportSession(req);
  if(!session)return json({error:'Sign in required.'},401);
  const user=await blobStore(STORES.users).get(session.userId,{type:'json'}).catch(()=>null);
  if(!user||user.status!=='active'||user.email!==session.email)return json({error:'Sign in required.'},401);
  let body;try{body=await readBody(req)}catch{return json({error:'Invalid request.'},400)}
  if(body.kind==='standalone_observed'){
    // No device fingerprint or user-supplied device identifier. One observation per account.
    return json({recorded:await recordWalletActivity({kind:body.kind,userId:session.userId})});
  }
  if(body.kind!=='offline_saved'||!getEvent(body.eventId)||!/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(String(body.ticketId||'')))return json({error:'Invalid activity.'},400);
  try{
    const ticket=await loadTicket(body.eventId,body.ticketId);
    if(!ticket||ticket.userId!==session.userId||!['paid','checked_in'].includes(ticket.status))return json({error:'Ticket unavailable.'},403);
    if(!(await waiverGate(ticket)).ready)return json({error:'Current agreements required.'},403);
    const identity={eventId:body.eventId,ticketId:body.ticketId};
    if(!await walletActivityExists({...identity,kind:'offline_issued'}))return json({recorded:false});
    return json({recorded:await recordWalletActivity({...identity,kind:'offline_saved'})});
  }catch{return json({error:'Activity reporting unavailable.'},503)}
};
export const config={path:'/api/wallet/activity'};
