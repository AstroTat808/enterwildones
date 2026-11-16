/**
 * Enumerate every event-scoped Blob key, including all paginated result pages.
 * Reject incomplete, duplicated, or cross-event listings rather than silently
 * understating occupied seats. No writes are performed here.
 */
export async function historicalBlobKeys(store, eventId) {
  const prefix = String(eventId || '').trim() + '/';
  if (prefix === '/' || typeof store?.list !== 'function') throw new Error('Invalid Blob audit scope');
  const pages = store.list({ prefix, paginate: true });
  if (!pages || typeof pages[Symbol.asyncIterator] !== 'function') {
    throw new Error('Historical Blob listing did not provide a complete page iterator');
  }
  const seen = new Set();
  const keys = [];
  for await (const page of pages) {
    if (!Array.isArray(page?.blobs)) throw new Error('Historical Blob listing page was incomplete');
    for (const item of page.blobs) {
      const key = item?.key;
      if (typeof key !== 'string' || !key.startsWith(prefix) || seen.has(key)) {
        throw new Error('Historical Blob listing had an invalid or repeated key');
      }
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

const OCCUPY = new Set(['paid', 'checked_in', 'disputed', 'refund_pending']);
const HISTORIC_STATES = new Set([...OCCUPY, 'refunded', 'revoked', 'void']);
const PAID_EVIDENCE_STATES = new Set(['paid','disputed','refund_pending']);
const admission = (payment) => payment?.purchaseType !== 'addon';
const val = (v) => String(v ?? '').trim();
const safeTicket = (ticket, fallback) => val(ticket?.ticketId).slice(0,128) || 'record-' + fallback;

export function auditHistoricalAdmission({
  eventId, capacity, tickets = [], payments = [], invitations = [], inventory = null
}) {
  if (!eventId || !Number.isSafeInteger(capacity) || capacity <= 0 ||
      !Array.isArray(tickets) || !Array.isArray(payments) || !Array.isArray(invitations)) {
    throw new Error('Invalid historical admission audit inputs');
  }
  const errors = [];
  const warnings = [];
  const counts = { totalTickets: tickets.length, occupied: 0, paid: 0, comps: 0,
    checkedIn: 0, disputed: 0, refundPending: 0, refunded: 0, revoked: 0, void: 0,
    totalPayments: payments.length, totalInvitations: invitations.length };
  const ticketIds = new Set(), users = new Set(), inviteIds = new Set(), sessions = new Set();
  const invitationById = new Map(invitations.filter(x=>x?.eventId===eventId).map(x=>[val(x.invitationId), x]));
  const paymentById = new Map();
  const linkedAdmissionSessions = new Set();
  const issue = (code, ticket, n) => errors.push({code, ticketId: safeTicket(ticket,n)});
  for (const p of payments) {
    if (p?.eventId !== eventId || !admission(p)) continue;
    const id = val(p.paymentId);
    if (id && (!paymentById.has(id) || p.status === 'paid')) paymentById.set(id, p);
  }
  for (let index=0;index<tickets.length;index++) {
    const ticket=tickets[index] ?? {};
    const id=safeTicket(ticket,index), uid=val(ticket.userId);
    const invite=val(ticket.invitationId), session=val(ticket.paymentId);
    const status=val(ticket.status);
    const source=val(ticket.ticketSource);
    if (ticket.eventId!==eventId) issue('WRONG_EVENT',ticket,index);
    if (ticketIds.has(id)) issue('DUPLICATE_TICKET_ID',ticket,index);
    ticketIds.add(id);
    if (!HISTORIC_STATES.has(status)) issue('UNKNOWN_TICKET_STATUS',ticket,index);
    if (OCCUPY.has(status) && !['stripe','comp'].includes(source)) issue('UNKNOWN_ACTIVE_TICKET_SOURCE',ticket,index);
    if (status==='refunded') counts.refunded++;
    if (status==='revoked') counts.revoked++;
    if (status==='void') counts.void++;
    if (!OCCUPY.has(status)) continue;
    counts.occupied++;
    if (status==='checked_in') counts.checkedIn++;
    if (status==='disputed') counts.disputed++;
    if (status==='refund_pending') counts.refundPending++;
    if (!uid || !invite) issue('ACTIVE_TICKET_MISSING_IDENTITY',ticket,index);
    const invitationRecord=invitationById.get(invite);
    if (invite && !invitationRecord) issue('ACTIVE_TICKET_WITHOUT_INVITATION',ticket,index);
    if (invitationRecord?.userId && val(invitationRecord.userId)!==uid) issue('TICKET_INVITATION_USER_MISMATCH',ticket,index);
    if (uid && users.has(uid)) issue('DUPLICATE_ACTIVE_USER',ticket,index);
    if (invite && inviteIds.has(invite)) issue('DUPLICATE_ACTIVE_INVITATION',ticket,index);
    users.add(uid);inviteIds.add(invite);
    if (source==='comp') {
      counts.comps++;
      if (session) issue('COMP_TICKET_HAS_PAYMENT',ticket,index);
    } else {
      counts.paid++;
      if (!/^cs_[a-zA-Z0-9_]+$/.test(session)) issue('PAID_TICKET_MISSING_CHECKOUT_ID',ticket,index);
      if (session && sessions.has(session)) issue('DUPLICATE_ACTIVE_SESSION',ticket,index);
      if (session) {sessions.add(session);linkedAdmissionSessions.add(session);}
      const p=paymentById.get(session);
      if (!p) issue('PAID_TICKET_WITHOUT_PAYMENT_RECORD',ticket,index);
      else if (p.status && !PAID_EVIDENCE_STATES.has(p.status)) issue('PAID_TICKET_PAYMENT_NOT_ACTIVE',ticket,index);
    }
  }
  if (counts.occupied > capacity) errors.push({code:'CAPACITY_EXCEEDED',occupied:counts.occupied,capacity});
  const outstanding = [...paymentById.values()].filter(p=>p.status==='paid' &&
    !linkedAdmissionSessions.has(val(p.paymentId)));
  for (const p of outstanding) errors.push({code:'PAID_PAYMENT_WITHOUT_ACTIVE_TICKET',paymentId:val(p.paymentId).slice(0,128)});
  if (!inventory?.configured || !inventory?.initialized) errors.push({code:'DATABASE_INVENTORY_MISSING'});
  if (inventory?.capacity !== capacity) errors.push({code:'CAPACITY_MISMATCH'});
  if ((inventory?.held ?? 0)>0) errors.push({code:'UNRECONCILED_PENDING_HOLDS',held:inventory.held});
  if ((inventory?.issued ?? 0)>counts.occupied) errors.push({code:'RELATIONAL_ISSUED_EXCEEDS_HISTORY'});
  if (inventory?.commissioned && inventory?.issued !== counts.occupied) errors.push({code:'ALREADY_COMMISSIONED_COUNT_MISMATCH'});
  if (!counts.totalTickets) warnings.push('No historical ticket records found. Verify the production site-wide Blob store.');
  return {
    eventId,capacity,counts,availableAfterCommission: Math.max(0,capacity-counts.occupied),
    database:{configured:Boolean(inventory?.configured),initialized:Boolean(inventory?.initialized),
      commissioned:Boolean(inventory?.commissioned),held:inventory?.held??null,issued:inventory?.issued??null,
      capacity:inventory?.capacity??null},
    ready:errors.length===0,errorCount:errors.length,errors:errors.slice(0,100),
    truncatedErrors:Math.max(0,errors.length-100),warnings
  };
}
