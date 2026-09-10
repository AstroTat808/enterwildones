import QRCode from 'qrcode';
import { env } from './_env.mjs';
import { verifyTicketToken } from './_ticket-token.mjs';
import { loadTicket } from './_payments.mjs';
import { blobStore } from './_blob-store.mjs';
import { STORES, eventKey } from './_stores.mjs';
import { waiverIsCurrent } from './_waiver.mjs';
export default async(req)=>{if(req.method!=='GET')return new Response('Method not allowed.',{status:405});const url=new URL(req.url);const token=String(url.searchParams.get('token')||'').trim();const parsed=verifyTicketToken(token);if(!parsed)return new Response('Invalid ticket.',{status:400});const ticket=await loadTicket(parsed.eventId,parsed.ticketId);if(!ticket||ticket.userId!==parsed.userId||!['paid','checked_in'].includes(ticket.status))return new Response('Inactive ticket.',{status:403});const waiver=await blobStore(STORES.waivers).get(eventKey(parsed.eventId,parsed.ticketId),{type:'json'}).catch(()=>null);if(!waiverIsCurrent(waiver,parsed.eventId))return new Response('Waiver required.',{status:403});const site=(env('WILDONES_SITE_URL')||url.origin).replace(/\/$/,'');const png=await QRCode.toBuffer(`${site}/ticket?token=${encodeURIComponent(token)}`,{type:'png',width:420,margin:2,errorCorrectionLevel:'M'});return new Response(png,{status:200,headers:{'Cache-Control':'no-store','Content-Type':'image/png','Content-Length':String(png.length),'X-Robots-Tag':'noindex, nofollow'}});};
export const config={path:'/ticket/qr'};
