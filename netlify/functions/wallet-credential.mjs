import QRCode from 'qrcode';
import { blobStore } from './_blob-store.mjs';
import { STORES,eventKey } from './_stores.mjs';
import { getEvent } from './_events.mjs';
import { loadTicket } from './_payments.mjs';
import { readPassportSession } from './_passport-auth.mjs';
import { sameOrigin } from './_security.mjs';
import { json,readBody } from './_response.mjs';
import { waiverGate } from './_waiver-evidence.mjs';
import { makeScanToken,scanCredentialExpiresAt } from './_ticket-token.mjs';
import { googleWalletConfig,issueGoogleWallet } from './_google-wallet.mjs';
import { env } from './_env.mjs';

export default async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);
  const session=readPassportSession(req);
  if(!session)return json({error:'Sign in to your Passport first.'},401);
  let body;
  try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}
  const event=getEvent(body.eventId),ticketId=String(body.ticketId||'');
  if(!event||!/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(ticketId)||!['offline','google'].includes(body.action))return json({error:'Invalid request.'},400);
  const user=await blobStore(STORES.users).get(session.userId,{type:'json'}).catch(()=>null);
  if(!user||user.status!=='active'||user.email!==session.email)return json({error:'Sign in to your Passport first.'},401);
  const ticket=await loadTicket(event.eventId,ticketId);
  if(!ticket||ticket.userId!==session.userId||!['paid','checked_in'].includes(ticket.status))return json({error:'Ticket is not available.'},403);
  const waiverState=await waiverGate(ticket).catch(()=>null);
  if(!waiverState)return json({error:'Waiver verification unavailable. Try again.'},503);
  if(!waiverState.ready)return json({error:'Sign all required current agreements, including late checkout when applicable, before saving your QR ticket.'},403);
  const scanToken=makeScanToken(ticket),expiresAt=scanCredentialExpiresAt(event.eventId);
  if(!scanToken)return json({error:'This credential is no longer available.'},403);
  try{
    if(body.action==='google'){
      const config=googleWalletConfig(event.eventId);
      if(!config)return json({error:'Google Wallet is not available for this event yet.'},503);
      const url=await issueGoogleWallet(config,{event,ticket,scanToken,expiresAt},{origin:env('WILDONES_SITE_URL','https://enterwildones.com')});
      return json({url});
    }
    const qr=await QRCode.toDataURL(scanToken,{width:520,margin:4,errorCorrectionLevel:'M'});
    // No venue, full ticket URL, email, waiver text, or payment details in offline payload.
    return json({ticketId,eventId:event.eventId,eventName:event.name,realm:event.realm,startsAt:event.startsAt,timezone:event.timezone,expiresAt,qr,savedAt:new Date().toISOString()});
  }catch{return json({error:'Wallet credential could not be generated. Try again online.'},503);}
};
export const config={path:'/api/wallet/credential'};
