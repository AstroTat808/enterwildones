import { resolveEvent } from './_events.mjs';
import { waiverText,WAIVER_VERSION,waiverHash } from './_waiver.mjs';
import { lateWaiverText,LATE_WAIVER_VERSION,lateWaiverHash } from './_waiver-evidence.mjs';
import { json } from './_response.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export default async req=>{
  if(req.method!=='GET')return json({error:'Method not allowed.'},405);
  const url=new URL(req.url),event=resolveEvent({eventId:url.searchParams.get('eventId'),slug:url.searchParams.get('event')});
  if(!event||event.visibility!=='public')return json({error:'Event not found.'},404);
  const kind=url.searchParams.get('kind')||'participant';
  if(!['participant','late_stay'].includes(kind))return json({error:'Invalid agreement.'},400);
  const late=kind==='late_stay',text=late?lateWaiverText(event.eventId):waiverText(event.eventId),version=late?LATE_WAIVER_VERSION:WAIVER_VERSION,hash=late?lateWaiverHash(event.eventId):waiverHash(event.eventId);
  if(url.searchParams.get('format')==='json')return json({kind,eventId:event.eventId,waiverVersion:version,waiverTextHash:hash,waiverText:text});
  const paragraphs=text.split('\n\n'),title=paragraphs.shift();
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+'</title><style>body{font:16px/1.65 system-ui,sans-serif;background:#100d08;color:#fffaf0;margin:0}main{max-width:760px;margin:auto;padding:24px}h1{font-size:clamp(24px,5vw,34px);line-height:1.2}p{overflow-wrap:anywhere}@media print{body{background:white;color:black}.notice{border:1px solid #777;padding:12px}}</style></head><body><main><p>ENTER WILD ONES · PRE-PURCHASE DISCLOSURE</p><h1>'+esc(title)+'</h1><p class="notice"><strong>Version '+esc(version)+'</strong> · Read this agreement before payment. This preview is not a signature. After purchase each named ticket holder must personally sign the applicable current agreement before admission. Use your browser to print or save a copy.</p>'+paragraphs.map(p=>'<p>'+esc(p)+'</p>').join('')+'</main></body></html>';
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow','Referrer-Policy':'no-referrer'}});
};
export const config={path:'/waiver-preview'};
