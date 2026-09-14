import { randomUUID } from 'node:crypto';
import { blobStore } from './_blob-store.mjs';
import { STORES, eventKey } from './_stores.mjs';

export async function writeAudit({ eventId = null, action, actor = 'system', targetType = null, targetId = null, detail = {} }) {
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
  await blobStore(STORES.audit).setJSON(scope, record).catch(() => {});
  return record;
}
