// Version-bound transactional re-sign campaign. Preview is read-only; no bulk send.
import { isAdmin } from './_admin-auth.mjs';
import { sameOrigin } from './_security.mjs';
import { blobStore } from './_blob-store.mjs';
import { listEvents,getEvent } from './_events.mjs';
import { STORES,eventKey } from './_stores.mjs';
import { waiverGate,disclosureInfo } from './_waiver-evidence.mjs';
import { archiveHealth,wormRequired } from './_worm-archive.mjs';
import { trackedEmail,maskEmail } from './_email-service.mjs';
import { renderBrandedNoticeEmail } from './_mail-templates.mjs';
import { makeTicketToken } from './_ticket-token.mjs';
import { writeAudit } from './_audit.mjs';
import { env } from './_env.mjs';
import { json,readBody } from './_response.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const active=t=>t&&['paid','checked_in'].includes(t.status);
const ticketPattern=/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow,noarchive','X-Content-Type-Options':'nosniff'};
function page(title,body){return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+esc(title)+'</title><style>body{background:#100d08;color:#fffaf0;font:16px/1.6 system-ui;margin:0}main{max-width:960px;margin:auto;padding:24px}a{color:#e8c78b}article{padding:16px;border:1px solid #69563b;border-radius:10px;margin:12px 0;overflow-wrap:anywhere}input,select,button{font:inherit;max-width:100%;padding:8px;box-sizing:border-box}label{display:block;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><main><nav><a href="/admin/overview">Master Admin</a> · <a href="/admin/waivers">Waivers</a></nav><h1>'+esc(title)+'</h1>'+body+'</main></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});}
function campaignVersion(eventId){const d=disclosureInfo(eventId);return d.participant.waiverTextHash+'-'+d.late_stay.waiverTextHash;}
function enabled(eventId){return globalThis.Netlify?.context?.deploy?.context==='production'&&wormRequired()&&env('WILDONES_WAIVER_RESIGN_APPROVED_EVENT')===eventId&&env('WILDONES_WAIVER_RESIGN_APPROVED_VERSION')===campaignVersion(eventId);}
function render(event,app,ticket,state,site){
  const late=state.lateRequired&&!state.lateSigned;
  return renderBrandedNoticeEmail({
    event,name:app?.preferredName||app?.fullName||'Wild One',
    title:'Your Updated Waiver Awaits',
    subject:event.name+': action required — updated participant waiver',
    preview:'Your admission is still valid. Review and sign the updated required agreement before entry.',
    introduction:'One important update before your next realm.',
    message:'We have updated our participant agreement to identify both Wild Ones LLC and Koa’s Events LLC and clarify the applicable event risks and safety responsibilities. Your purchased admission and add-ons remain intact; you do not need to buy another ticket. '+(late?'Your late checkout / car camping add-on also requires a separate signed agreement. ':'')+'Please personally review and sign the current required agreement'+(late?'s':'')+' before entry.',
    actionUrl:site+(ticket?'/ticket?token='+encodeURIComponent(makeTicketToken(ticket)):'/passport'),
    actionLabel:'Review & Sign Required Waiver'+(late?'s':''),
    note:'Signing unlocks your admission QR after all required agreements are recorded. If you have questions or decline the updated terms, contact support before the event so we can review your options. Keep your private ticket link secure.',
    support:env('WILDONES_HELP_EMAIL','help@enterwildones.com')
  });
}
async function eligible(ticket,eventId){
  if(!active(ticket)||ticket.eventId!==eventId)return null;
  const state=await waiverGate(ticket);if(state.ready)return null;
  const app=await blobStore(STORES.applications).get(eventKey(eventId,ticket.applicationId),{type:'json'});
  if(!app||app.userId!==ticket.userId||!app.email||!makeTicketToken(ticket))return null;
  return {ticket,app,state};
}
export default async req=>{
  if(!isAdmin(req))return json({error:'Unauthorized.'},401);
  if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed.'},405);
  const url=new URL(req.url);let body={};
  if(req.method==='POST'){if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}}
  const eventId=String(body.eventId||url.searchParams.get('eventId')||'aureva-2026'),event=getEvent(eventId);
  if(!event)return json({error:'Unknown event.'},400);
  const store=blobStore(STORES.tickets),site=(env('WILDONES_SITE_URL')||'https://enterwildones.com').replace(/\/$/,'');
  try{
    if(req.method==='POST'){
      if(body.action!=='send_one'||!ticketPattern.test(body.ticketId||'')||body.confirm!=='SEND'||body.campaignVersion!==campaignVersion(eventId))return json({error:'Confirm the current campaign and specific ticket.'},400);
      if(!enabled(eventId)||!(await archiveHealth()).healthy||Date.now()>=Date.parse(event.startsAt))return json({error:'Campaign is not approved, recovery verification is stale, or the event has begun. No email sent.'},403);
      const ticket=await store.get(eventKey(eventId,body.ticketId),{type:'json'}),row=await eligible(ticket,eventId);
      if(!row)return json({error:'This ticket is no longer eligible; no email sent.'},409);
      const mail=render(event,row.app,ticket,row.state,site);
      const key='waiver-resign-'+eventId+'-'+ticket.ticketId+'-'+campaignVersion(eventId);
      await writeAudit({eventId,action:'waiver.resign_send_requested',actor:'admin',targetType:'ticket',targetId:ticket.ticketId,detail:{campaignVersion:campaignVersion(eventId)},strict:true});
      const result=await trackedEmail({eventId,kind:'waiver_resign',sourceId:ticket.ticketId,key,to:row.app.email,subject:mail.subject,text:mail.text,html:mail.html,retryable:true});
      await writeAudit({eventId,action:'waiver.resign_send_result',actor:'admin',targetType:'ticket',targetId:ticket.ticketId,detail:{sent:Boolean(result.sent),alreadyAccepted:Boolean(result.alreadyAccepted),providerId:result.id||null},strict:true});
      return json({sent:Boolean(result.sent),alreadyAccepted:Boolean(result.alreadyAccepted),providerStatus:result.status||result.reason||null});
    }
    await writeAudit({eventId,action:'waiver.resign_previewed',actor:'admin',targetType:'event',targetId:eventId,strict:true});
    const {blobs}=await store.list({prefix:eventId+'/'});
    const rows=[];let activeCount=0,missingContact=0,ready=0;
    for(let i=0;i<blobs.length;i+=10){
      const group=await Promise.all(blobs.slice(i,i+10).map(async ({key})=>{
        const t=await store.get(key,{type:'json'});if(!active(t)||t.eventId!==eventId)return null;
        activeCount++;
        const state=await waiverGate(t);if(state.ready){ready++;return null;}
        const app=await blobStore(STORES.applications).get(eventKey(eventId,t.applicationId),{type:'json'});
        if(!app||app.userId!==t.userId||!app.email||!makeTicketToken(t)){missingContact++;return null;}
        return {ticket:t,app,state};
      }));rows.push(...group.filter(Boolean));
    }
    const sample=render(event,null,null,{lateRequired:true,lateSigned:false},site);
    const canSend=enabled(eventId)&&(await archiveHealth()).healthy&&Date.now()<Date.parse(event.startsAt);
    const options=listEvents({includeHidden:true}).map(e=>'<option value="'+esc(e.eventId)+'"'+(e.eventId===eventId?' selected':'')+'>'+esc(e.name)+'</option>').join('');
    const cards=rows.map(({ticket,app,state})=>'<article><strong>'+esc(app.fullName||'Guest')+'</strong><p>'+esc(ticket.ticketId)+' · '+esc(maskEmail(app.email))+'</p><p>'+(!state.baseSigned?'Participant waiver outstanding. ':'')+(state.lateRequired&&!state.lateSigned?'Late-stay waiver outstanding.':'')+'</p>'+(canSend?'<form method="post"><input type="hidden" name="eventId" value="'+esc(eventId)+'"><input type="hidden" name="ticketId" value="'+esc(ticket.ticketId)+'"><input type="hidden" name="campaignVersion" value="'+esc(campaignVersion(eventId))+'"><input type="hidden" name="action" value="send_one"><label>Type SEND to approve this individual notification<input name="confirm" required pattern="SEND" autocomplete="off"></label><button>Send transactional notification</button></form>':'')+'</article>').join('');
    return page('Waiver re-sign campaign','<p><strong>'+(canSend?'Approved individual sending enabled':'PREVIEW ONLY — sending disabled')+'</strong></p><form method="get"><label>Event <select name="eventId">'+options+'</select></label><button>Review</button></form><p>Active tickets: '+activeCount+' · Already current: '+ready+' · Eligible notifications: '+rows.length+' · Missing contact/identity: '+missingContact+'</p><p>Approval version: <code style="overflow-wrap:anywhere">'+esc(campaignVersion(eventId))+'</code></p><article><h2>Message preview (includes optional late-stay wording)</h2><p><strong>'+esc(sample.subject)+'</strong></p><pre>'+esc(sample.text)+'</pre></article><h2>Candidate recipients</h2>'+cards+'<p>Sending requires approved event and exact agreement hashes, a verified independent archive drill, a current active ticket, and explicit confirmation. Resend acceptance is not delivery confirmation. Existing delivery reporting tracks provider results.</p>');
  }catch{console.error('Waiver re-sign campaign unavailable');return json({error:'Campaign operation unavailable; verify delivery status before retrying.'},503);}
};
export const config={path:'/admin/waiver-resign'};
