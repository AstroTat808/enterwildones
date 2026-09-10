import { blobStore } from './_blob-store.mjs';
import { randomUUID } from 'node:crypto';
import { STORES, eventKey } from './_stores.mjs';
export async function writeAudit({eventId,action,actor='system',targetType=null,targetId=null,detail={}}){const at=new Date().toISOString();const auditId=`${at.replace(/[:.]/g,'-')}-${randomUUID()}`;const record={auditId,eventId,at,action,actor,targetType,targetId,detail};await blobStore(STORES.audit).setJSON(eventKey(eventId,auditId),record);return record;}
