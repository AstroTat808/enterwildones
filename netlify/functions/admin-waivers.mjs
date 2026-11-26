import { isAdmin } from './_admin-auth.mjs';
import { blobStore } from './_blob-store.mjs';
import { listEvents,getEvent } from './_events.mjs';
import { STORES,eventKey,sha256 } from './_stores.mjs';
import { archiveDigest,waiverGate } from './_waiver-evidence.mjs';
import { writeAudit } from './_audit.mjs';
import { json } from './_response.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const css='body{font:16px/1.55 system-ui,sans-serif;margin:0;background:#100d08;color:#fffaf0}main{max-width:1100px;margin:auto;padding:24px}a{color:#e8c78b}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #69563b;overflow-wrap:anywhere}th{font-weight:600}input,select,button{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}form{display:flex;flex-wrap:wrap;align-items:end;gap:12px}.table{overflow-x:auto}code{overflow-wrap:anywhere}.notice{border-left:3px solid #d9ad5b;padding:12px}article{max-width:780px}article p{white-space:pre-wrap}@media print{body{background:white;color:black}main{padding:0;max-width:none}nav,.no-print,form{display:none!important}p{break-inside:avoid}a{color:black}}';
function page(title,body){return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+esc(title)+'</title><style>'+css+'</style></head><body><main><nav class="no-print"><a href="/admin/overview">Master Admin</a> · <a href="/admin/waivers">Waiver Center</a></nav><h1>'+esc(title)+'</h1>'+body+'</main></body></html>',{headers});}
const validId=v=>/^[a-zA-Z0-9_-]{1,180}$/.test(v);
const link=(eventId,ticketId,digest,format='print')=>'/admin/waivers?'+new URLSearchParams({eventId,ticketId,digest,format});
async function readArchive(eventId,ticketId,digest){
  const record=await blobStore(STORES.waiverHistory).get(eventKey(eventId,ticketId+'/'+digest),{type:'json'});
  if(!record||record.eventId!==eventId||record.ticketId!==ticketId||archiveDigest(record)!==digest)return null;
  return record;
}
function integrity(record){return typeof record.waiverText==='string'&&sha256(record.waiverText)===record.waiverTextHash;}
async function historyFor(eventId,ticketId){
  const prefix=eventKey(eventId,ticketId)+'/';
  const {blobs}=await blobStore(STORES.waiverHistory).list({prefix});
  const history=await Promise.all(blobs.map(async ({key})=>{
    const digest=key.slice(prefix.length);
    if(!/^[a-f0-9]{64}$/.test(digest))return null;
    const record=await readArchive(eventId,ticketId,digest);
    return record?{digest,kind:record.kind||'participant',version:record.waiverVersion,signedAt:record.signedAt,name:record.signerName,verified:integrity(record)}:null;
  }));
  if(history.some(x=>!x))throw new Error('Archive integrity verification failed.');
  return history.sort((a,b)=>String(b.signedAt).localeCompare(String(a.signedAt)));
}
export default async req=>{
  if(req.method!=='GET')return json({error:'Method not allowed.'},405);
  if(!isAdmin(req))return json({error:'Unauthorized. Sign in through Master Admin.'},401);
  const url=new URL(req.url),eventId=url.searchParams.get('eventId')||'aureva-2026',ticketId=url.searchParams.get('ticketId')||'',digest=url.searchParams.get('digest')||'',format=url.searchParams.get('format')||'';
  const event=getEvent(eventId);
  if(!event||ticketId&&!validId(ticketId)||digest&&!/^[a-f0-9]{64}$/.test(digest))return json({error:'Invalid request.'},400);
  try{
    if(digest){
      if(!ticketId)return json({error:'Ticket required.'},400);
      const record=await readArchive(eventId,ticketId,digest);
      if(!record)return json({error:'Evidence missing or archive digest mismatch.'},404);
      if(typeof record.waiverText==='string'&&!integrity(record))return json({error:'Waiver text hash mismatch.'},409);
      await writeAudit({eventId,action:'waiver.evidence_accessed',actor:'admin',targetType:'ticket',targetId:ticketId,detail:{digest,format:format==='json'?'json':'print'}});
      if(format==='json')return new Response(JSON.stringify({archiveDigest:digest,record},null,2),{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="waiver-'+digest+'.json"'}});
      const text=integrity(record)?record.waiverText:'Historical record: the exact accepted text was not retained. Do not represent this as a complete signed agreement.';
      return page('Signed waiver evidence · '+event.name,'<article><p class="notice">'+(integrity(record)?'Text and archive digest verified. Electronic signature evidence, not a certificate-based PDF signature.':'Historical metadata only; exact text unavailable.')+'</p><p><strong>Signer:</strong> '+esc(record.signerName)+'<br><strong>Signed UTC:</strong> '+esc(record.signedAt)+'<br><strong>Ticket:</strong> '+esc(ticketId)+'<br><strong>Version:</strong> '+esc(record.waiverVersion)+'<br><strong>Agreement type:</strong> '+esc(record.kind||'participant')+'</p><p><strong>Text SHA-256:</strong> <code>'+esc(record.waiverTextHash)+'</code><br><strong>Record SHA-256:</strong> <code>'+esc(digest)+'</code></p><hr>'+text.split('\n\n').map(x=>'<p>'+esc(x)+'</p>').join('')+'<p class="no-print">Use your browser Print / Save as PDF. <a href="'+esc(link(eventId,ticketId,digest,'json'))+'">Download original evidence JSON</a></p></article>');
    }
    if(ticketId){
      const ticket=await blobStore(STORES.tickets).get(eventKey(eventId,ticketId),{type:'json'});
      const history=await historyFor(eventId,ticketId);
      if(!ticket&&!history.length)return json({error:'Ticket not found.'},404);
      const state=ticket?await waiverGate(ticket):null;
      const current=state?[state.base,state.late].filter(Boolean):[];
      const legacy=current.filter(r=>!history.some(h=>h.digest===archiveDigest(r)));
      return page('Waiver history · '+event.name,'<p>Ticket: <code>'+esc(ticketId)+'</code></p><p>Entry status: '+(state?.ready?'CURRENT AGREEMENTS RECORDED':'NOT READY / HISTORICAL')+'</p><p class="notice">Archive entries are conditionally create-only through the application; this is not independently immutable WORM storage. Legacy unarchived signatures: '+legacy.length+'.</p><div class="table"><table><thead><tr><th>Agreement</th><th>Signer</th><th>Signed UTC</th><th>Version</th><th>Integrity</th><th>Evidence</th></tr></thead><tbody>'+history.map(h=>'<tr><td>'+esc(h.kind)+'</td><td>'+esc(h.name)+'</td><td>'+esc(h.signedAt)+'</td><td>'+esc(h.version)+'</td><td>'+(h.verified?'Verified':'Metadata only')+'</td><td><a href="'+esc(link(eventId,ticketId,h.digest))+'">Printable copy</a> · <a href="'+esc(link(eventId,ticketId,h.digest,'json'))+'">JSON</a></td></tr>').join('')+'</tbody></table></div>');
    }
    const store=blobStore(STORES.tickets),{blobs}=await store.list({prefix:eventId+'/'});
    const search=String(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,120),filter=url.searchParams.get('status')||'all';
    const rows=[];
    for(let i=0;i<blobs.length;i+=20){
      const batch=await Promise.all(blobs.slice(i,i+20).map(async ({key})=>{
        const ticket=await store.get(key,{type:'json'});
        if(!ticket||ticket.eventId!==eventId||!validId(ticket.ticketId))return null;
        const app=ticket.applicationId?await blobStore(STORES.applications).get(eventKey(eventId,ticket.applicationId),{type:'json'}):null;
        const state=await waiverGate(ticket);
        return {ticket,name:app?.fullName||state.base?.signerName||'Unknown guest',state};
      }));
      rows.push(...batch.filter(Boolean));
    }
    const active=rows.filter(r=>['paid','checked_in'].includes(r.ticket.status));
    const ready=active.filter(r=>r.state.ready).length;
    const displayed=rows.filter(r=>(!search||(r.name+' '+r.ticket.ticketId).toLowerCase().includes(search))&&(filter==='all'||(filter==='ready'&&r.state.ready&&['paid','checked_in'].includes(r.ticket.status))||(filter==='pending'&&!r.state.ready&&['paid','checked_in'].includes(r.ticket.status))));
    const options=listEvents({includeHidden:true}).map(e=>'<option value="'+esc(e.eventId)+'"'+(e.eventId===eventId?' selected':'')+'>'+esc(e.name)+'</option>').join('');
    const body='<p class="notice">Active admissions: <strong>'+active.length+'</strong> · Waiver ready: <strong>'+ready+'</strong> · Outstanding: <strong>'+(active.length-ready)+'</strong> · Late-stay outstanding: <strong>'+active.filter(r=>r.state.lateRequired&&!r.state.lateSigned).length+'</strong></p><form method="get"><label>Realm <select name="eventId">'+options+'</select></label><label>Search <input name="q" value="'+esc(search)+'" placeholder="Guest or ticket ID"></label><label>Status <select name="status">'+['all','ready','pending'].map(s=>'<option value="'+s+'"'+(s===filter?' selected':'')+'>'+s+'</option>').join('')+'</select></label><button>Filter</button></form><p>Records shown: '+displayed.length+'</p><div class="table"><table><thead><tr><th>Guest / ticket</th><th>Admission</th><th>Participant</th><th>Late stay</th><th>Evidence</th></tr></thead><tbody>'+displayed.map(r=>'<tr><td>'+esc(r.name)+'<br><code>'+esc(r.ticket.ticketId)+'</code></td><td>'+esc(r.ticket.status)+'</td><td>'+(r.state.baseSigned?'Current':'Required')+'</td><td>'+(r.state.lateRequired?(r.state.lateSigned?'Current':'Required'):'Not applicable')+'</td><td><a href="/admin/waivers?'+esc(new URLSearchParams({eventId,ticketId:r.ticket.ticketId}))+'">History</a></td></tr>').join('')+'</tbody></table></div>';
    return page('Legal waiver center',body);
  }catch(error){console.error('Waiver reporting unavailable:',String(error.message||error).slice(0,120));return json({error:'Waiver evidence unavailable; do not assume signatures are valid.'},503);}
};
export const config={path:'/admin/waivers'};
