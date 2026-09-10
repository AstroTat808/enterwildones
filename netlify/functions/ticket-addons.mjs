import { addonCatalog,publicAddon } from './_addons.mjs';
import { entitlementFor } from './_addon-payments.mjs';
import { getEvent,toPublicEvent } from './_events.mjs';
import { loadTicket } from './_payments.mjs';
import { verifyTicketToken } from './_ticket-token.mjs';
import { json } from './_response.mjs';

export default async(req)=>{if(req.method!=='GET')return json({error:'Method not allowed.'},405);const url=new URL(req.url),token=String(url.searchParams.get('token')||''),parsed=verifyTicketToken(token);if(!parsed)return json({error:'Invalid ticket.'},400);const ticket=await loadTicket(parsed.eventId,parsed.ticketId);if(!ticket||ticket.userId!==parsed.userId||!['paid','checked_in'].includes(ticket.status))return json({error:'This ticket is inactive.'},403);const event=getEvent(parsed.eventId),addons=[];for(const item of addonCatalog(parsed.eventId)){if(!item.enabled)continue;const entitlement=await entitlementFor(parsed.eventId,parsed.ticketId,item.addonType);addons.push({...publicAddon(item),purchased:entitlement?.status==='active',entitlement:entitlement?.status==='active'?{status:entitlement.status,creditsPurchased:entitlement.creditsPurchased||null,creditsRedeemed:entitlement.creditsRedeemed||0,creditsRemaining:entitlement.creditsRemaining??null,wristbandActivatedAt:entitlement.wristbandActivatedAt||null,departureTime:entitlement.departureTime||null}:null});}return json({event:toPublicEvent(event),ticketId:ticket.ticketId,addons});};
export const config={path:'/api/ticket/addons'};
