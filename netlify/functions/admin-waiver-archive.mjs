import { isAdmin } from './_admin-auth.mjs';
import { sameOrigin } from './_security.mjs';
import { blobStore } from './_blob-store.mjs';
import { getEvent } from './_events.mjs';
import { STORES,eventKey } from './_stores.mjs';
import { archiveDigest,archiveWaiver } from './_waiver-evidence.mjs';
import { lockedReceipt,restoreLocked,archiveHealth,wormRequired } from './_worm-archive.mjs';
import { writeAudit } from './_audit.mjs';
import { json,readBody } from './_response.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow,noarchive'};
const ticketPattern=/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/;
async function records(eventId,ticketId){
  const current=blobStore(STORES.waivers),history=blobStore(STORES.waiverHistory),prefix=eventKey(eventId,ticketId)+'/';
  const list=await history.list({prefix}),map=new Map();
  const check=r=>{
    if(!r||r.eventId!==eventId||r.ticketId!==ticketId||!r.signedAt)throw new Error('Waiver record identity invalid');
    map.set(archiveDigest(r),r);
  };
  for(const suffix of ['', '/late_stay']){const r=await current.get(eventKey(eventId,ticketId+suffix),{type:'json'});if(r)check(r);}
  for(const {key} of list.blobs||[]){
    const r=await history.get(key,{type:'json'});if(!r||archiveDigest(r)!==key.slice(prefix.length))throw new Error('Waiver history integrity invalid');
    check(r);
  }
  return map;
}
export default async req=>{
  if(!isAdmin(req))return json({error:'Unauthorized.'},401);
  if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed.'},405);
  let body={};const url=new URL(req.url);
  if(req.method==='POST'){if(!sameOrigin(req))return json({error:'Origin not allowed.'},403);try{body=await readBody(req);}catch{return json({error:'Invalid request.'},400);}}
  const eventId=String(body.eventId||url.searchParams.get('eventId')||'aureva-2026'),ticketId=String(body.ticketId||url.searchParams.get('ticketId')||'');
  if(!getEvent(eventId)||!ticketPattern.test(ticketId))return json({error:'A valid event and ticket ID are required.'},400);
  const scope='waivers/'+eventId+'/'+ticketId;
  try{
    const all=await records(eventId,ticketId),health=await archiveHealth();
    if(req.method==='POST'){
      const digest=String(body.digest||'');
      if(body.confirm!=='ARCHIVE'||!all.has(digest)||!wormRequired()||!health.configured)return json({error:'Archive configuration and explicit record confirmation required.'},403);
      await writeAudit({eventId,action:'waiver.backfill_requested',actor:'admin',targetType:'ticket',targetId:ticketId,detail:{digest},strict:true});
      await archiveWaiver(all.get(digest));
      const copies=await restoreLocked(scope,digest);
      await writeAudit({eventId,action:'waiver.backfill_verified',actor:'admin',targetType:'ticket',targetId:ticketId,detail:{digest},strict:true});
      return json({ok:true,digest,copies,note:'Original signature metadata preserved; no current waiver acceptance was created or changed.'});
    }
    await writeAudit({eventId,action:'waiver.backfill_reviewed',actor:'admin',targetType:'ticket',targetId:ticketId,strict:true});
    const rows=[];
    for(const [digest,record] of all){
      const locked=wormRequired()&&await lockedReceipt(scope,digest);
      rows.push('<article><h2>'+esc(record.kind||'participant')+' · '+esc(record.signedAt)+'</h2><p>Version '+esc(record.waiverVersion)+' · '+(record.waiverText?'Exact text snapshot present':'Historical metadata only')+'</p><p><code>'+digest+'</code></p><p>'+(locked?'Dual archive receipt recorded':'Independent archive pending')+'</p>'+(!locked&&health.configured&&wormRequired()?'<form method="post"><input type="hidden" name="eventId" value="'+esc(eventId)+'"><input type="hidden" name="ticketId" value="'+esc(ticketId)+'"><input type="hidden" name="digest" value="'+digest+'"><label>Type ARCHIVE <input name="confirm" required pattern="ARCHIVE"></label><button>Archive exact existing record</button></form>':'')+'</article>');
    }
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Archive reconciliation</title><style>body{background:#100d08;color:#fffaf0;font:16px/1.6 system-ui;margin:0}main{max-width:800px;margin:auto;padding:24px}a{color:#e8c78b}article{border:1px solid #69563b;padding:16px;margin:16px 0;overflow-wrap:anywhere}input,button{font:inherit;padding:8px;max-width:100%}</style></head><body><main><a href="/admin/waivers?'+esc(new URLSearchParams({eventId,ticketId}))+'">Return to waiver history</a><h1>Archive reconciliation</h1><p>Ticket '+esc(ticketId)+' · '+(health.configured?'Storage configured':'Storage not configured')+'</p><p>Preserve existing records exactly. Historical signatures remain historical; no signature is fabricated and outdated waivers remain invalid for entry.</p>'+rows.join('')+'</main></body></html>';
    return new Response(html,{headers});
  }catch{console.error('Waiver archive reconciliation failed');return json({error:'Archive reconciliation failed; no waiver acceptance was changed.'},503);}
};
export const config={path:'/admin/waiver-archive'};
