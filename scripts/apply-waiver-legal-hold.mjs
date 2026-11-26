// Separate legal-custodian operation. No website credentials. ON only, dry-run by default.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [file,primaryProfile,backupProfile,flag]=process.argv.slice(2);
if(!file||!primaryProfile||!backupProfile||primaryProfile===backupProfile||flag&&flag!=='--execute')throw new Error('Usage: node scripts/apply-waiver-legal-hold.mjs evidence.json primary-profile backup-profile [--execute]');
const exported=JSON.parse(await readFile(file,'utf8'));
const {record,archiveDigest:digest,independentCopies:copies}=exported;
const sha=x=>createHash('sha256').update(x).digest('hex');
if(!record||sha(JSON.stringify(record))!==digest||!Array.isArray(copies)||copies.length!==2||!/^WLD-[A-Z]{3}-TKT-[A-F0-9]{16}$/.test(record.ticketId)||!/^[a-z0-9-]+$/.test(record.eventId))throw new Error('Invalid authenticated evidence export');
const key='evidence/v1/waivers/'+record.eventId+'/'+record.ticketId+'/'+digest+'.json';
const targets=['PRIMARY','BACKUP'].map((label,i)=>({copy:copies.find(c=>c.label===label),profile:[primaryProfile,backupProfile][i]}));
if(targets.some(({copy})=>!copy||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(copy.bucket)||!/^\d{12}$/.test(copy.owner)||typeof copy.version!=='string'||!copy.version||copy.version==='null')||targets[0].copy.owner===targets[1].copy.owner)throw new Error('Independent version receipts required');
for(const {copy,profile} of targets){
  const args=['--profile',profile,'--no-cli-pager','--output','json'];
  const identity=JSON.parse(execFileSync('aws',[...args,'sts','get-caller-identity'],{encoding:'utf8',timeout:20000}));
  if(identity.Account!==copy.owner)throw new Error('AWS profile account does not match exported owner');
  const object=['--bucket',copy.bucket,'--key',key,'--version-id',copy.version,'--expected-bucket-owner',copy.owner];
  const head=JSON.parse(execFileSync('aws',[...args,'s3api','head-object',...object],{encoding:'utf8',timeout:20000}));
  if(head.VersionId!==copy.version||head.ObjectLockMode!=='COMPLIANCE')throw new Error('Unexpected S3 version or retention mode');
  // Read the exact bytes before applying the hold using a private, temporary file.
  const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'waiver-hold-'));
  try{
    const path=join(dir,'record.json');
    execFileSync('aws',[...args,'s3api','get-object',...object,path],{encoding:'utf8',timeout:20000});
    if(sha(readFileSync(path))!==digest)throw new Error('Remote record digest differs');
  }finally{rmSync(dir,{recursive:true,force:true});}
  if(flag==='--execute')execFileSync('aws',[...args,'s3api','put-object-legal-hold',...object,'--legal-hold','Status=ON'],{encoding:'utf8',timeout:20000});
  const observed=JSON.parse(execFileSync('aws',[...args,'s3api','get-object-legal-hold',...object],{encoding:'utf8',timeout:20000}));
  if(flag==='--execute'&&observed.LegalHold?.Status!=='ON')throw new Error('Legal hold did not verify');
  console.log(JSON.stringify({mode:flag==='--execute'?'EXECUTED':'DRY_RUN',label:copy.label,bucket:copy.bucket,version:copy.version,digest,observed:observed.LegalHold?.Status||'UNKNOWN'}));
}
