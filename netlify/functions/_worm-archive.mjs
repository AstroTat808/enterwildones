// Independent Amazon S3 WORM integration. No credentials or personal data in logs.
import {createHash,createHmac} from 'node:crypto';
import {env} from './_env.mjs';
import {blobStore} from './_blob-store.mjs';
const RECEIPTS='wildones-worm-receipts';
const HEALTH='wildones-worm-health';
const hash=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
const production=()=>globalThis.Netlify?.context?.deploy?.context==='production';
export function wormRequired(){return production()||env('WILDONES_WORM_REQUIRED')==='true';}
function target(label){
  const p='WILDONES_WORM_'+label+'_';
  const config={label,bucket:env(p+'BUCKET'),region:env(p+'REGION'),owner:env(p+'ACCOUNT_ID'),access:env(p+'ACCESS_KEY_ID'),secret:env(p+'SECRET_ACCESS_KEY'),token:env(p+'SESSION_TOKEN')};
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)||!/^([a-z]{2}(-gov)?)-[a-z]+-\d$/.test(config.region)||!/^\d{12}$/.test(config.owner)||!config.access||!config.secret)throw new Error('WORM '+label+' configuration incomplete');
  return config;
}
function targets(){
  const a=target('PRIMARY'),b=target('BACKUP');
  if(a.bucket===b.bucket||a.owner===b.owner||a.access===b.access)throw new Error('WORM stores must use independent buckets, accounts and credentials');
  return [a,b];
}
function days(){
  const n=Number(env('WILDONES_WORM_RETENTION_DAYS'));
  if(!Number.isInteger(n)||n<1||n>36500)throw new Error('WORM retention policy not configured');
  return n;
}
export function wormConfigured(){try{targets();days();return true;}catch{return false;}}
function fingerprint(){return hash(JSON.stringify({targets:targets().map(t=>({label:t.label,bucket:t.bucket,region:t.region,owner:t.owner})),retentionDays:days()}));}
function keyFor(scope,digest){
  if(!/^[a-zA-Z0-9_/-]{1,250}$/.test(scope)||scope.split('/').some(x=>!x)||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Invalid archive identity');
  return 'evidence/v1/'+scope+'/'+digest+'.json';
}
async function request(t,method,key,{body='',version='',headers={}}={}){
  const host=t.bucket+'.s3.'+t.region+'.amazonaws.com';
  const path='/'+key.split('/').map(encode).join('/');
  const query=version?'versionId='+encode(version):'';
  const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),date=stamp.slice(0,8);
  const h={host,'x-amz-date':stamp,'x-amz-content-sha256':hash(body),'x-amz-expected-bucket-owner':t.owner,...headers};
  if(t.token)h['x-amz-security-token']=t.token;
  const names=Object.keys(h).sort();
  const canonical=names.map(n=>n+':'+String(h[n]).trim().replace(/\s+/g,' ')+'\n').join('');
  const signed=names.join(';'),scope=date+'/'+t.region+'/s3/aws4_request';
  const data=[method,path,query,canonical,signed,h['x-amz-content-sha256']].join('\n');
  const signingKey=hmac(hmac(hmac(hmac('AWS4'+t.secret,date),t.region),'s3'),'aws4_request');
  const signature=createHmac('sha256',signingKey).update(['AWS4-HMAC-SHA256',stamp,scope,hash(data)].join('\n')).digest('hex');
  const authorization='AWS4-HMAC-SHA256 Credential='+t.access+'/'+scope+', SignedHeaders='+signed+', Signature='+signature;
  return fetch('https://'+host+path+(query?'?'+query:''),{method,headers:{...h,authorization},...(method==='PUT'?{body}:{}),redirect:'error',signal:AbortSignal.timeout(12000)});
}
async function verify(t,key,version,digest,minimum){
  if(!version||version==='null')throw new Error('WORM version missing');
  const r=await request(t,'GET',key,{version});
  if(!r.ok)throw new Error('WORM restore failed: '+t.label+' HTTP '+r.status);
  const mode=r.headers.get('x-amz-object-lock-mode');
  const until=r.headers.get('x-amz-object-lock-retain-until-date');
  const encryption=r.headers.get('x-amz-server-side-encryption');
  if(r.headers.get('x-amz-version-id')!==version||mode!=='COMPLIANCE'||!Number.isFinite(Date.parse(until))||Date.parse(until)<minimum||!['AES256','aws:kms','aws:kms:dsse'].includes(encryption))throw new Error('WORM metadata verification failed: '+t.label);
  const bytes=Buffer.from(await r.arrayBuffer());
  if(hash(bytes)!==digest)throw new Error('WORM restore digest mismatch: '+t.label);
  return {label:t.label,bucket:t.bucket,owner:t.owner,version,retainUntil:until,encryption,legalHold:r.headers.get('x-amz-object-lock-legal-hold')||'UNKNOWN'};
}
async function put(t,key,body,digest,until){
  const r=await request(t,'PUT',key,{body,headers:{'content-type':'application/json','content-md5':createHash('md5').update(body).digest('base64'),'if-none-match':'*','x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':until,'x-amz-server-side-encryption':'AES256'}});
  let version=r.headers.get('x-amz-version-id');
  if(r.status===412){
    // Idempotent retry: discover current version, then verify exact pinned version.
    const head=await request(t,'HEAD',key);
    if(!head.ok)throw new Error('WORM existing object lookup failed: '+t.label);
    version=head.headers.get('x-amz-version-id');
  }else if(!r.ok)throw new Error('WORM write failed: '+t.label+' HTTP '+r.status);
  // Existing retries may have been written earlier; require at least the approved
  // retention horizon calculated from the original record's archive receipt.
  return verify(t,key,version,digest,Date.parse(until)-1000);
}
export async function archiveLocked(scope,record){
  if(!wormRequired())return null;
  const ts=targets(),retentionDays=days(),body=JSON.stringify(record),digest=hash(body),key=keyFor(scope,digest),receipts=blobStore(RECEIPTS);
  let receipt=await receipts.get(key,{type:'json'});
  if(receipt){
    if(!receiptMatches(receipt,scope,digest,ts))throw new Error('WORM receipt identity mismatch');
    return receipt;
  }
  // Persist the planned horizon before writing either target, so partial writes
  // can be retried without changing their minimum retention or creating versions.
  const planKey=key+'/plan';
  const planned={retainUntil:new Date(Math.ceil((Date.now()+retentionDays*86400000)/1000)*1000).toISOString(),digest};
  await receipts.setJSON(planKey,planned,{onlyIfNew:true});
  const plan=await receipts.get(planKey,{type:'json'});
  if(!plan||plan.digest!==digest||Date.parse(plan.retainUntil)<=Date.now())throw new Error('Invalid WORM retention plan');
  const copies=await Promise.all(ts.map(t=>put(t,key,body,digest,plan.retainUntil)));
  receipt={scope,key,digest,verifiedAt:new Date().toISOString(),retainUntil:plan.retainUntil,copies};
  await receipts.setJSON(key,receipt,{onlyIfNew:true});
  const saved=await receipts.get(key,{type:'json'});
  if(!receiptMatches(saved,scope,digest,ts))throw new Error('WORM receipt write failed');
  return saved;
}
function receiptMatches(r,scope,digest,ts){
  return Boolean(r&&r.scope===scope&&r.digest===digest&&r.key===keyFor(scope,digest)&&Date.parse(r.retainUntil)>Date.now()&&Array.isArray(r.copies)&&r.copies.length===2&&ts.every(t=>r.copies.some(c=>c.label===t.label&&c.owner===t.owner&&c.bucket===t.bucket&&c.version&&c.version!=='null'&&Date.parse(c.retainUntil)>=Date.parse(r.retainUntil)-1000)));
}
export async function lockedReceipt(scope,digest){
  if(!wormRequired())return true;
  if(!wormConfigured())return false;
  const ts=targets(),receipt=await blobStore(RECEIPTS).get(keyFor(scope,digest),{type:'json'});
  return receiptMatches(receipt,scope,digest,ts);
}
export async function restoreLocked(scope,digest){
  const ts=targets(),r=await blobStore(RECEIPTS).get(keyFor(scope,digest),{type:'json'});
  if(!receiptMatches(r,scope,digest,ts))throw new Error('WORM receipt missing or invalid');
  return Promise.all(ts.map(t=>verify(t,r.key,r.copies.find(c=>c.label===t.label).version,digest,Date.parse(r.retainUntil)-1000)));
}
export async function archiveHealth(){
  const r=await blobStore(HEALTH).get('latest',{type:'json'});
  return {configured:wormConfigured(),required:wormRequired(),healthy:Boolean(wormConfigured()&&r?.ok&&r.configFingerprint===fingerprint()&&Date.now()-Date.parse(r.checkedAt)>=0&&Date.now()-Date.parse(r.checkedAt)<36*3600000),checkedAt:r?.checkedAt||null};
}
export async function runArchiveDrill(){
  if(!wormRequired())return {skipped:true};
  const date=new Date().toISOString().slice(0,10);
  try{
    const configFingerprint=fingerprint(),scope='health/'+date+'/'+configFingerprint.slice(0,16),record={kind:'synthetic_restore_canary',date,nonPersonal:true,configFingerprint};
    const receipt=await archiveLocked(scope,record);
    await restoreLocked(scope,receipt.digest);
    // Verify a bounded rotating subset of real archive receipts in addition to the synthetic canary.
    const store=blobStore(RECEIPTS),previous=await blobStore(HEALTH).get('latest',{type:'json'});
    const listing=await store.list({prefix:'evidence/v1/'});
    const keys=(listing.blobs||[]).map(b=>b.key).filter(k=>!k.startsWith('evidence/v1/health/')&&k.endsWith('.json')).sort();
    const start=Math.max(0,keys.findIndex(k=>k>String(previous?.cursor||'')));
    const selected=keys.slice(start,start+3);
    for(const key of selected){const item=await store.get(key,{type:'json'});if(!item)throw new Error('Missing archive receipt');await restoreLocked(item.scope,item.digest);}
    const health={ok:true,checkedAt:new Date().toISOString(),digest:receipt.digest,configFingerprint,verifiedActual:selected.length,cursor:selected.at(-1)||''};
    await blobStore(HEALTH).setJSON('latest',health);
    return health;
  }catch{
    await blobStore(HEALTH).setJSON('latest',{ok:false,checkedAt:new Date().toISOString()});
    throw new Error('Independent archive recovery drill failed');
  }
}
