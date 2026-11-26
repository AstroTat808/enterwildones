import { brandStyles,ticketHeader } from './_branding.mjs';
import { blobStore } from './_blob-store.mjs';
import { getEvent } from './_events.mjs';
import { verifyTicketToken } from './_ticket-token.mjs';
import { loadTicket,loadApplication } from './_payments.mjs';
import { json,readBody,clientIp } from './_response.mjs';
import { sameOrigin } from './_security.mjs';
import { STORES,eventKey,sha256 } from './_stores.mjs';
import { writeAudit } from './_audit.mjs';
import { LATE_WAIVER_VERSION,lateWaiverText,lateWaiverHash,lateAcceptanceMatches,lateWaiverIsCurrent,lateEntitlement,archiveWaiver,archivedWaiverExists } from './_waiver-evidence.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const normalize=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
export default async req=>{
  if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed.'},405);
  const url=new URL(req.url);
  let body={};
  if(req.method==='POST'){
    if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);
    try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}
  }
  const token=String(body.token||url.searchParams.get('token')||'');
  const parsed=verifyTicketToken(token);
  if(!parsed)return json({error:'Invalid ticket.'},400);
  const ticket=await loadTicket(parsed.eventId,parsed.ticketId);
  if(!ticket||ticket.userId!==parsed.userId||!['paid','checked_in'].includes(ticket.status))return json({error:'Inactive ticket.'},403);
  if(!await lateEntitlement(ticket))return json({error:'An active late checkout add-on is required.'},403);
  const key=eventKey(parsed.eventId,parsed.ticketId+'/late_stay'),store=blobStore(STORES.waivers);
  const existing=await store.get(key,{type:'json'});
  const signed=lateWaiverIsCurrent(existing,ticket)&&await archivedWaiverExists(existing);
  const text=lateWaiverText(parsed.eventId),hash=lateWaiverHash(parsed.eventId),event=getEvent(parsed.eventId);
  if(req.method==='GET'){
    if(!(req.headers.get('accept')||'').includes('text/html'))return json({waiverVersion:LATE_WAIVER_VERSION,waiverTextHash:hash,waiverText:text,signed,signedAt:signed?existing.signedAt:null});
    const sections=text.split('\n\n');
    const form=signed?'<p><strong>Signed by '+esc(existing.signerName)+'</strong> · '+esc(existing.signedAt)+'</p>':'<form method="post"><input type="hidden" name="token" value="'+esc(token)+'"><input type="hidden" name="waiverVersion" value="'+LATE_WAIVER_VERSION+'"><input type="hidden" name="waiverTextHash" value="'+hash+'"><label>Full legal name <input name="signerName" maxlength="120" autocomplete="name" required></label><label class="check"><input type="checkbox" name="accept" value="yes" required> I have read the agreement and disclosed risks, voluntarily accept its terms, and intend to sign electronically.</label><button type="submit">Sign late-stay agreement</button></form>';
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Late stay waiver · '+esc(event.name)+'</title>'+brandStyles+'<style>body{background:#100d08;color:#fffaf0}main{max-width:760px;margin:auto;padding:24px;line-height:1.65}form,label{display:block;margin:20px 0}input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box}a{color:inherit;text-decoration:underline}@media print{body{background:white!important;color:black!important}form,nav,.ticket-brand-header{display:none!important}}</style></head><body class="ticket-page tx-page waiver-page"><main>'+ticketHeader+'<h1>'+esc(sections.shift())+'</h1><p>Version '+LATE_WAIVER_VERSION+'</p>'+sections.map(s=>'<p>'+esc(s)+'</p>').join('')+form+'<p>Print or save a PDF using your browser.</p><a href="/ticket?token='+encodeURIComponent(token)+'">Return to ticket</a></main></body></html>';
    return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'}});
  }
  if(!lateAcceptanceMatches(body,parsed.eventId))return json({error:'The late-stay agreement has changed. Review it again.'},409);
  const app=await loadApplication(parsed.eventId,ticket.applicationId);
  const name=typeof body.signerName==='string'?body.signerName.trim():'';
  if(!name||name.length>120||!app?.fullName||normalize(name)!==normalize(app.fullName))return json({error:'Use the registered full legal name.'},400);
  if(!(body.accept===true||body.accept==='yes'))return json({error:'Affirmative acceptance required.'},400);
  if(!signed){
    const record={kind:'late_stay',waiverId:'late_waiver_'+ticket.ticketId,eventId:ticket.eventId,ticketId:ticket.ticketId,userId:ticket.userId,applicationId:ticket.applicationId,waiverVersion:LATE_WAIVER_VERSION,waiverTextHash:hash,waiverText:text,signerName:name,signedAt:new Date().toISOString(),electronicConsent:true,affirmativeAcceptance:true,userAgent:String(req.headers.get('user-agent')||'').slice(0,500),clientIpHash:sha256(clientIp(req))};
    if(existing)await archiveWaiver(existing);
    await archiveWaiver(record);
    await store.setJSON(key,record);
    await writeAudit({eventId:ticket.eventId,action:'waiver.late_stay_signed',actor:'guest',targetType:'ticket',targetId:ticket.ticketId,detail:{waiverVersion:LATE_WAIVER_VERSION,waiverTextHash:hash}});
  }
  if((req.headers.get('accept')||'').includes('text/html'))return new Response(null,{status:303,headers:{Location:'/ticket?token='+encodeURIComponent(token),'Cache-Control':'no-store'}});
  return json({ok:true,signed:true});
};
export const config={path:'/ticket/late-stay-waiver'};
