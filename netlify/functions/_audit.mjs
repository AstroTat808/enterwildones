import { randomUUID } from 'node:crypto';
import { blobStore } from './_blob-store.mjs';
import { STORES, eventKey } from './_stores.mjs';

export async function writeAudit({ eventId = null, action, actor = 'system', targetType = null, targetId = null, detail = {}, strict = false }) {
  const auditId = randomUUID();
  const scope = eventId ? eventKey(eventId, auditId) : `platform/${auditId}`;
  const record = {
    auditId,
    eventId: eventId || null,
    action,
    actor,
    targetType,
    targetId,
    detail,
    createdAt: new Date().toISOString()
  };
  if(strict){const result=await blobStore(STORES.audit).setJSON(scope,record,{onlyIfNew:true});if(!result?.modified)throw new Error('Audit record was not created');}
  else await blobStore(STORES.audit).setJSON(scope, record).catch(() => {});
  return record;
}
