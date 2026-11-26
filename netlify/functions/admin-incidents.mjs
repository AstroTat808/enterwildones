import { randomUUID } from 'node:crypto';
import { isAdmin } from './_admin-auth.mjs';
import { sameOrigin } from './_security.mjs';
import { blobStore } from './_blob-store.mjs';
import { listEvents,getEvent } from './_events.mjs';
import { STORES,eventKey,sha256 } from './_stores.mjs';
import { archiveDigest } from './_waiver-evidence.mjs';
import { archiveLocked,lockedReceipt,restoreLocked,wormRequired } from './_worm-archive.mjs';
import { writeAudit } from './_audit.mjs';
import { json,readBody } from './_response.mjs';
const INCIDENTS='wildones-legal-incidents';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(v||''));
const ticketPattern=/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/;
const categorySet=new Set(['injury','medical_assistance','property_damage','safety_hazard','security','weather','other']);
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow,noarchive','X-Content-Type-Options':'nosniff'};
const style='body{background:#100d08;color:#fffaf0;font:16px/1.6 system-ui;margin:0}main{max-width:960px;margin:auto;padding:24px}a{color:#e8c78b}label{display:block;margin:14px 0}input,select,textarea,button{font:inherit;padding:10px;max-width:100%;box-sizing:border-box}textarea,input:not([type=hidden]){display:block;width:100%}textarea{min-height:100px}.card{padding:18px;border:1px solid #69563b;border-radius:10px;margin:18px 0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{cursor:pointer}.notice{border-left:3px solid #d9ad5b;padding:12px}';
function page(title,body){return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+esc(title)+'</title><style>'+style+'</style></head><body><main><nav><a href="/admin/overview">Master Admin</a> · <a href="/admin/waivers">Waivers</a> · <a href="/admin/incidents">Incidents</a></nav><h1>'+esc(title)+'</h1>'+body+'</main></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});}
const scope=(eventId,incidentId)=>'incidents/'+eventId+'/'+incidentId;
const baseKey=(eventId,incidentId)=>eventKey(eventId,incidentId);
const urlFor=(eventId,incidentId,format='')=>'/admin/incidents?'+new URLSearchParams({eventId,incidentId,...(format?{format}:{})});
function field(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('Invalid report field');return value.trim();}
async function storeReport(eventId,incidentId,key,fields){
  const store=blobStore(INCIDENTS);
  const proposed={...fields,eventId,incidentId,recordedAt:new Date().toISOString()};
  await store.setJSON(key,proposed,{onlyIfNew:true});
  const saved=await store.get(key,{type:'json'});
  if(!saved||saved.eventId!==eventId||saved.incidentId!==incidentId||Object.keys(fields).some(k=>saved[k]!==fields[k]))throw new Error('Incident identity or duplicate submission conflict');
  // Local record remains recoverable if a remote write fails; never label it locked.
  await archiveLocked(scope(eventId,incidentId),saved);
  return saved;
}
async function recordsFor(eventId,incidentId){
  const store=blobStore(INCIDENTS),key=baseKey(eventId,incidentId);
  const original=await store.get(key,{type:'json'});if(!original)return [];
  const listed=await store.list({prefix:key+'/followup/'});
  const entries=await Promise.all((listed.blobs||[]).map(x=>store.get(x.key,{type:'json'})));
  if(entries.some(x=>!x||x.eventId!==eventId||x.incidentId!==incidentId||x.kind!=='followup'))throw new Error('Incomplete incident history');
  return [original,...entries.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt))];
}
async function incidentEvidence(eventId,incidentId,records){
  const incidents=[];
  for(const record of records){
    const digest=archiveDigest(record);
    const copies=wormRequired()?await restoreLocked(scope(eventId,incidentId),digest):null;
    incidents.push({digest,record,independentCopies:copies});
  }
  const waivers=[];
  const ticketId=records[0].ticketId;
  if(ticketId){
    const prefix=eventKey(eventId,ticketId)+'/';
    const store=blobStore(STORES.waiverHistory),listed=await store.list({prefix});
    for(const {key} of listed.blobs||[]){
      const digest=key.slice(prefix.length),record=await store.get(key,{type:'json'});
      if(!record||record.eventId!==eventId||record.ticketId!==ticketId||archiveDigest(record)!==digest)throw new Error('Related waiver integrity failed');
      const copies=wormRequired()?await restoreLocked('waivers/'+eventId+'/'+ticketId,digest):null;
      waivers.push({digest,record,exactTextAvailable:typeof record.waiverText==='string'&&sha256(record.waiverText)===record.waiverTextHash,independentCopies:copies});
    }
    const currentStore=blobStore(STORES.waivers);
    for(const suffix of ['', '/late_stay']){
      const current=await currentStore.get(eventKey(eventId,ticketId+suffix),{type:'json'});
      if(current&&!waivers.some(w=>w.digest===archiveDigest(current)))throw new Error('Related current waiver has not been archived');
    }
  }
  const auditStore=blobStore(STORES.audit),list=await auditStore.list({prefix:eventId+'/'});
  const audit=[];
  for(const {key} of list.blobs||[]){
    const r=await auditStore.get(key,{type:'json'});
    if(!r||r.eventId!==eventId)throw new Error('Audit history incomplete');
    if((r.targetType==='incident'&&r.targetId===incidentId)||(ticketId&&r.targetType==='ticket'&&r.targetId===ticketId&&/^(waiver\.|ticket\.checked_in)/.test(r.action)))audit.push(r);
  }
  return {schema:'wildones-incident-evidence-v1',eventId,incidentId,exportedAt:new Date().toISOString(),incidents,waivers,audit,limitations:'Original JSON and record digests are the evidence. No claim is made that historical text was retained where it is absent. Audit entries are application records.'};
}
export default async req=>{
  if(!isAdmin(req))return json({error:'Unauthorized.'},401);
  if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed.'},405);
  const url=new URL(req.url);let body={};
  if(req.method==='POST'){if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}}
  const eventId=String(body.eventId||url.searchParams.get('eventId')||'aureva-2026'),event=getEvent(eventId),incidentId=String(body.incidentId||url.searchParams.get('incidentId')||'');
  if(!event||(incidentId&&!uuid(incidentId)))return json({error:'Invalid event or incident.'},400);
  try{
    if(req.method==='POST'){
      const action=body.action;
      if(!incidentId||!['create','followup','retry_archive'].includes(action))return json({error:'Invalid incident action.'},400);
      const key=baseKey(eventId,incidentId);
      let saved;
      if(action==='retry_archive'){
        const records=await recordsFor(eventId,incidentId);
        if(!records.length)return json({error:'Incident not found.'},404);
        for(const r of records)await archiveLocked(scope(eventId,incidentId),r);
        await writeAudit({eventId,action:'incident.archive_retried',actor:'admin',targetType:'incident',targetId:incidentId,strict:true});
      }else if(action==='create'){
        let fields;
        try{
          const category=field(body.category,32,true),ticketId=field(body.ticketId||'',80),occurredAt=field(body.occurredAt,40,true);
          if(!categorySet.has(category)||ticketId&&!ticketPattern.test(ticketId)||!Number.isFinite(Date.parse(occurredAt))||!/Z$|[+-]\d\d:\d\d$/.test(occurredAt))throw new Error('Invalid');
          if(ticketId){const t=await blobStore(STORES.tickets).get(eventKey(eventId,ticketId),{type:'json'});if(!t||t.eventId!==eventId)return json({error:'Ticket not found in this event.'},400);}
          fields={kind:'incident',category,ticketId:ticketId||null,occurredAt:new Date(occurredAt).toISOString(),location:field(body.location,240,true),reporter:field(body.reporter,120,true),facts:field(body.facts,8000,true),response:field(body.response,5000,true)};
        }catch{return json({error:'Complete all required fields; use ISO time with timezone and a valid ticket if known.'},400);}
        saved=await storeReport(eventId,incidentId,key,fields);
      }else{
        const existing=await blobStore(INCIDENTS).get(key,{type:'json'});
        if(!existing)return json({error:'Incident not found.'},404);
        const entryId=String(body.entryId||'');if(!uuid(entryId))return json({error:'Invalid follow-up identity.'},400);
        let fields;
        try{fields={kind:'followup',entryId,reporter:field(body.reporter,120,true),note:field(body.note,8000,true)};}catch{return json({error:'Reporter and follow-up are required.'},400);}
        saved=await storeReport(eventId,incidentId,key+'/followup/'+entryId,fields);
      }
      if(saved)await writeAudit({eventId,action:action==='create'?'incident.recorded':'incident.followup_recorded',actor:'admin',targetType:'incident',targetId:incidentId,detail:{digest:archiveDigest(saved)},strict:true});
      return new Response(null,{status:303,headers:{Location:urlFor(eventId,incidentId),...headers}});
    }
    if(incidentId){
      const records=await recordsFor(eventId,incidentId);
      if(!records.length)return json({error:'Incident not found.'},404);
      if(url.searchParams.get('format')==='json'){
        await writeAudit({eventId,action:'incident.evidence_export_requested',actor:'admin',targetType:'incident',targetId:incidentId,strict:true});
        const evidence=await incidentEvidence(eventId,incidentId,records);
        const digest=sha256(JSON.stringify(evidence));
        return new Response(JSON.stringify({manifestSha256:digest,evidence},null,2),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="incident-'+incidentId+'-evidence.json"'}});
      }
      await writeAudit({eventId,action:'incident.viewed',actor:'admin',targetType:'incident',targetId:incidentId,strict:true});
      const states=await Promise.all(records.map(async r=>({r,locked:wormRequired()&&await lockedReceipt(scope(eventId,incidentId),archiveDigest(r))})));
      return page('Incident '+incidentId,'<p>'+esc(event.name)+' · Confidential. Do not copy to public channels.</p>'+states.map(({r,locked})=>'<article class="card"><strong>'+esc(r.kind)+' · '+(locked?'Dual archive receipt recorded':'Independent archive not verified')+'</strong><p>Recorded UTC: '+esc(r.recordedAt)+'</p><pre>'+esc(JSON.stringify(r,null,2))+'</pre><p>SHA-256: '+esc(archiveDigest(r))+'</p></article>').join('')+'<p><a href="'+esc(urlFor(eventId,incidentId,'json'))+'">Export incident and linked waiver evidence (JSON)</a></p><form method="post"><input type="hidden" name="eventId" value="'+esc(eventId)+'"><input type="hidden" name="incidentId" value="'+incidentId+'"><input type="hidden" name="action" value="retry_archive"><button>Retry independent archive</button></form><form method="post" class="card"><h2>Append follow-up</h2><input type="hidden" name="eventId" value="'+esc(eventId)+'"><input type="hidden" name="incidentId" value="'+incidentId+'"><input type="hidden" name="entryId" value="'+randomUUID()+'"><input type="hidden" name="action" value="followup"><label>Reporter (self-reported name)<input name="reporter" maxlength="120" required></label><label>Additional facts or correction (original remains unchanged)<textarea name="note" maxlength="8000" required></textarea></label><button>Append and preserve</button></form>');
    }
    await writeAudit({eventId,action:'incident.register_accessed',actor:'admin',targetType:'event',targetId:eventId,strict:true});
    const store=blobStore(INCIDENTS),listed=await store.list({prefix:eventId+'/'});
    const keys=(listed.blobs||[]).map(x=>x.key).filter(k=>uuid(k.slice(eventId.length+1)));
    const rows=await Promise.all(keys.map(key=>store.get(key,{type:'json'})));
    if(rows.some(r=>!r||r.eventId!==eventId))throw new Error('Incident register incomplete');
    const options=listEvents({includeHidden:true}).map(e=>'<option value="'+esc(e.eventId)+'"'+(e.eventId===eventId?' selected':'')+'>'+esc(e.name)+'</option>').join('');
    return page('Legal incident register','<p class="notice">Confidential records only. Address emergencies first. Document observed facts and action taken, not speculation or unnecessary medical details. The existing shared admin login is role-level access; reporter identity is self-reported.</p><form method="get"><label>Event <select name="eventId">'+options+'</select></label><button>View event</button></form>'+rows.sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).map(r=>'<article class="card"><a href="'+esc(urlFor(eventId,r.incidentId))+'">'+esc(r.category)+' · '+esc(r.occurredAt)+'</a><p>'+esc(r.location)+' · '+esc(r.incidentId)+'</p></article>').join('')+'<form method="post" class="card"><h2>New incident report</h2><input type="hidden" name="eventId" value="'+esc(eventId)+'"><input type="hidden" name="incidentId" value="'+randomUUID()+'"><input type="hidden" name="action" value="create"><label>Category <select name="category">'+[...categorySet].map(c=>'<option>'+c+'</option>').join('')+'</select></label><label>Occurred at (ISO date/time including offset)<input name="occurredAt" placeholder="2027-01-23T21:00:00-10:00" required maxlength="40"></label><label>Location<input name="location" maxlength="240" required></label><label>Registered ticket ID (optional)<input name="ticketId" maxlength="80"></label><label>Reporter (self-reported name)<input name="reporter" maxlength="120" required></label><label>Observed facts<textarea name="facts" maxlength="8000" required></textarea></label><label>Response and immediate mitigation<textarea name="response" maxlength="5000" required></textarea></label><button>Preserve report</button></form>');
  }catch{console.error('Incident operation incomplete');return json({error:'Incident operation could not be verified. If submitting, the local record may be retained; review the incident register and retry archival rather than recreating it.'},503);}
};
export const config={path:'/admin/incidents'};
