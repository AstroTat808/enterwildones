import { blobStore } from './_blob-store.mjs';
import { resolveEvent } from './_events.mjs';
import { createInvitationAccess, inviteAccessCookie } from './_invitations.mjs';
import { checkoutAllowed, findRedeemedInvitationForUser } from './_checkout-access.mjs';
import { readPassportSession } from './_passport-auth.mjs';
import { json, readBody } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES } from './_stores.mjs';

export default async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);
  const session=readPassportSession(req);
  if(!session)return json({error:'Passport sign-in is required.'},401);
  const user=await blobStore(STORES.users).get(session.userId,{type:'json'}).catch(()=>null);
  if(!user||user.status!=='active'||user.email!==session.email)return json({error:'Passport session is no longer valid.'},401);
  let body;try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}
  const event=resolveEvent({eventId:body.eventId,slug:body.event});
  if(!event)return json({error:'Event not found.'},404);
  const invitation=await findRedeemedInvitationForUser(event.eventId,user.userId,user.email);
  if(!invitation)return json({error:'Redeem your invitation before purchasing admission.',code:'invite_not_redeemed'},409);
  if(!checkoutAllowed(event,invitation,user.email))return json({error:`Ticket sales for ${event.name} are not open.`,code:'sales_closed'},403);
  if(invitation.status==='fulfilled'||Number(invitation.purchaseCount||0)>=1)return json({error:'This invitation has already been used for admission.',code:'invite_fulfilled'},409);
  if(Number(invitation.maxTickets||1)!==1)return json({error:'This invitation requires the group-ticket flow.',code:'group_ticket_required'},409);
  const access=createInvitationAccess(invitation,event);
  return json({ok:true,nextUrl:`/ticket-access?event=${encodeURIComponent(event.slug)}`},200,{'Set-Cookie':inviteAccessCookie(event.eventId,access.token,access.exp)});
};
export const config={path:'/api/passport/ticket-access'};
