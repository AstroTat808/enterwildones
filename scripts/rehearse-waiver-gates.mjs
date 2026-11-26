// End-to-end handler rehearsal: no external services or production records.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const mock='export const getStore=name=>globalThis.__waiverStore(name); export const getDeployStore=getStore;';
registerHooks({resolve(specifier,context,next){if(specifier==='@netlify/blobs')return{url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true};return next(specifier,context);}});
const maps=new Map();
globalThis.__waiverStore=name=>{
  if(!maps.has(name))maps.set(name,new Map());
  const map=maps.get(name);
  return {
    async get(key){return map.has(key)?structuredClone(map.get(key)):null;},
    async setJSON(key,value,options={}){if(options.onlyIfNew&&map.has(key))return{modified:false};map.set(key,structuredClone(value));return{modified:true};},
    async list({prefix=''}={}){return{blobs:[...map.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};},
    async delete(key){map.delete(key);}
  };
};
globalThis.Netlify={context:{deploy:{context:'production'}}};
Object.assign(process.env,{WILDONES_SITE_URL:'https://waiver-qa.example.invalid',WILDONES_TICKET_ACCESS_SECRET:'qa-only-waiver-ticket-secret-32-characters',WILDONES_CHECKIN_SESSION_SECRET:'qa-only-checkin-session-secret-32-chars',WILDONES_ADMIN_KEY:'qa-only-admin-waiver-key',WILDONES_APPLE_PASS_TYPE_ID:'',WILDONES_APPLE_TEAM_ID:''});
globalThis.fetch=async()=>{throw new Error('External network disabled during waiver rehearsal');};
const {STORES,eventKey}=await import('../netlify/functions/_stores.mjs');
const {listEvents}=await import('../netlify/functions/_events.mjs');
const {makeTicketId,makeTicketToken}=await import('../netlify/functions/_ticket-token.mjs');
const {createCheckinSession}=await import('../netlify/functions/_checkin-auth.mjs');
const {WAIVER_VERSION,waiverHash}=await import('../netlify/functions/_waiver.mjs');
const {LATE_WAIVER_VERSION,lateWaiverHash,waiverGate,archiveDigest,archiveWaiver}=await import('../netlify/functions/_waiver-evidence.mjs');
const participant=(await import('../netlify/functions/ticket-waiver.mjs')).default;
const late=(await import('../netlify/functions/ticket-late-waiver.mjs')).default;
const qr=(await import('../netlify/functions/ticket-qr.mjs')).default;
const wallet=(await import('../netlify/functions/ticket-wallet.mjs')).default;
const checkin=(await import('../netlify/functions/check-in.mjs')).default;
const admin=(await import('../netlify/functions/admin-waivers.mjs')).default;
const preview=(await import('../netlify/functions/waiver-preview.mjs')).default;
const origin='https://waiver-qa.example.invalid';
const store=name=>globalThis.__waiverStore(name);
const get=(path,headers={})=>new Request(origin+path,{headers});
const post=(path,data,headers={})=>new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)});
for(const event of listEvents({includeHidden:true})){
  // Tokens are deliberately time-scoped; completed historical realms cannot be
  // re-issued by this rehearsal. Current/upcoming events are tested via handlers.
  if(Date.parse(event.endsAt)+7*86400000<=Date.now())continue;
  const eventId=event.eventId,ticketId=makeTicketId(event,'waiver-qa-invitation'),userId='waiver-qa-user',applicationId='waiver-qa-application';
  const ticket={eventId,ticketId,userId,applicationId,status:'paid',checkedInAt:null};
  const key=eventKey(eventId,ticketId);
  await store(STORES.tickets).setJSON(key,ticket);
  await store(STORES.applications).setJSON(eventKey(eventId,applicationId),{eventId,userId,applicationId,fullName:'Jane Waiver Test'});
  const token=makeTicketToken(ticket),query='?token='+encodeURIComponent(token),cookie='wildones_checkin='+encodeURIComponent(createCheckinSession(eventId));
  const scan=action=>checkin(post('/api/check-in',{action,token},{cookie}));
  const payload={token,signerName:'Jane Waiver Test',accept:true,waiverVersion:WAIVER_VERSION,waiverTextHash:waiverHash(eventId)};
  const latePayload={...payload,waiverVersion:LATE_WAIVER_VERSION,waiverTextHash:lateWaiverHash(eventId)};
  const qrCheck=()=>qr(get('/ticket/qr'+query));
  const walletCheck=()=>wallet(get('/ticket/wallet'+query));
  assert.equal((await qrCheck()).status,403);
  assert.equal((await walletCheck()).status,403);
  assert.equal((await scan('scan')).status,403);
  assert.equal((await participant(post('/ticket/waiver',{...payload,waiverTextHash:'stale'}))).status,409);
  assert.equal((await participant(post('/ticket/waiver',{...payload,signerName:'Other Person'}))).status,400);
  assert.equal((await participant(post('/ticket/waiver',{...payload,accept:false}))).status,400);
  assert.equal((await participant(post('/ticket/waiver',payload,{origin:'https://unrelated.invalid'}))).status,403);
  assert.equal((await late(post('/ticket/late-stay-waiver',latePayload))).status,403);
  const previewResult=await preview(get('/waiver-preview?eventId='+eventId+'&format=json'));
  assert.equal(previewResult.status,200);
  assert.equal((await previewResult.json()).waiverTextHash,waiverHash(eventId));
  assert.equal((await participant(post('/ticket/waiver',payload))).status,200);
  assert.equal((await waiverGate(ticket)).ready,true);
  assert.equal((await qrCheck()).status,200);
  assert.equal((await walletCheck()).status,503,'Wallet configuration not exercised; waiver gate was passed');
  const entitlementKey=eventKey(eventId,ticketId+'/late_stay');
  await store(STORES.entitlements).setJSON(entitlementKey,{eventId,ticketId,userId,addonType:'late_stay',status:'active'});
  assert.equal((await waiverGate(ticket)).ready,false);
  assert.equal((await qrCheck()).status,403);
  assert.equal((await walletCheck()).status,403);
  assert.equal((await scan('scan')).status,403);
  assert.equal((await late(post('/ticket/late-stay-waiver',{...latePayload,waiverVersion:'stale'}))).status,409);
  assert.equal((await late(post('/ticket/late-stay-waiver',latePayload))).status,200);
  assert.equal((await qrCheck()).status,200);
  assert.equal((await scan('late_stay')).status,403,'Late stay requires admission check-in');
  const signed=await store(STORES.waivers).get(key),digest=archiveDigest(signed);
  const archiveKey=eventKey(eventId,ticketId+'/'+digest);
  assert.deepEqual(await store(STORES.waiverHistory).get(archiveKey),signed);
  assert.equal(await archiveWaiver(signed),archiveKey);
  const path='/admin/waivers?eventId='+eventId+'&ticketId='+ticketId+'&digest='+digest+'&format=json';
  assert.equal((await admin(get(path))).status,401);
  const evidence=await admin(get(path,{authorization:'Bearer qa-only-admin-waiver-key'}));
  assert.equal(evidence.status,200);assert.equal((await evidence.json()).archiveDigest,digest);
  await store(STORES.waiverHistory).delete(archiveKey);
  assert.equal((await qrCheck()).status,403,'Missing archived signature must block entry');
  assert.equal((await scan('scan')).status,403);
  await archiveWaiver(signed);
  assert.equal((await scan('scan')).status,200);
  assert.equal((await scan('late_stay')).status,200);
  await store(STORES.entitlements).setJSON(entitlementKey,{eventId,ticketId,userId,addonType:'late_stay',status:'refunded'});
  assert.equal((await scan('late_stay')).status,403);
  const checked=await store(STORES.tickets).get(key);
  await store(STORES.tickets).setJSON(key,{...checked,status:'refunded'});
  assert.equal((await qrCheck()).status,403);
  assert.equal((await scan('scan')).status,403);
}
console.log('Waiver handler rehearsal passed: current signatures, archive verification, supplemental stay, QR/Wallet gate, staff check-in, refunds and authenticated evidence export.');
