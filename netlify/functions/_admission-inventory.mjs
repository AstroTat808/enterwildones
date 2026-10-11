import { Pool } from '@neondatabase/serverless';
import { env } from './_env.mjs';
import { requireEvent } from './_events.mjs';

// A relational row lock serializes every seat mutation for the same realm.
// Netlify Blobs and read-then-write counters cannot guarantee no overselling.
const MAX_CAPACITY = 100000;

export class AdmissionInventoryError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'AdmissionInventoryError';
    this.code = code;
    this.status = status;
  }
}

export function admissionCapacity(eventId) {
  requireEvent(eventId);
  const key = 'WILDONES_' + eventId.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_TICKET_CAPACITY';
  const raw = String(env(key) || '').trim();
  const value = Number(raw);
  return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(value) && value <= MAX_CAPACITY ? value : null;
}

function connection() {
  const url = env('DATABASE_URL');
  if (!url) throw new AdmissionInventoryError('INVENTORY_DATABASE_MISSING', 'Admission inventory database is not configured.', 503);
  return new Pool({ connectionString: url, connectionTimeoutMillis: 10000 });
}

async function withLockedEvent(eventId, requireCapacity, operation) {
  requireEvent(eventId);
  const configured = admissionCapacity(eventId);
  if (requireCapacity && !configured) {
    throw new AdmissionInventoryError('CAPACITY_UNCONFIGURED', 'Admission capacity has not been approved for this realm.', 503);
  }
  const pool = connection();
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (requireCapacity) {
      await client.query(
        'INSERT INTO wildones_event_capacity(event_id, capacity) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING',
        [eventId, configured]
      );
    }
    const result = await client.query('SELECT capacity, commissioned FROM wildones_event_capacity WHERE event_id=$1 FOR UPDATE', [eventId]);
    if (!result.rows[0]) {
      throw new AdmissionInventoryError('INVENTORY_NOT_INITIALIZED', 'Admission inventory has not been initialized.', 503);
    }
    const usage = await client.query(
      "SELECT COUNT(*)::integer AS used FROM wildones_admission_reservations WHERE event_id=$1 AND status IN ('held','issued')",
      [eventId]
    );
    const used = Number(usage.rows[0].used);
    let capacity = Number(result.rows[0].capacity);
    if (requireCapacity && configured !== capacity) {
      if (configured < used) throw new AdmissionInventoryError('CAPACITY_BELOW_OCCUPANCY', 'Configured capacity is below reserved and issued admission.', 503);
      await client.query('UPDATE wildones_event_capacity SET capacity=$2, updated_at=NOW() WHERE event_id=$1', [eventId, configured]);
      capacity = configured;
    }
    const value = await operation(client, { capacity, used, commissioned: result.rows[0].commissioned === true });
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      throw new AdmissionInventoryError('DUPLICATE_ADMISSION', 'This guest already has an active admission or reservation.');
    }
    if (error instanceof AdmissionInventoryError) throw error;
    console.error('Admission inventory transaction failed:', error);
    throw new AdmissionInventoryError('INVENTORY_UNAVAILABLE', 'Admission inventory cannot be verified safely.', 503);
  } finally {
    client?.release();
    await pool.end();
  }
}

export async function reserveAdmission({ eventId, invitationId, userId, expiresAt }) {
  if (!invitationId || !userId || !Number.isFinite(Date.parse(expiresAt))) {
    throw new AdmissionInventoryError('INVALID_RESERVATION', 'Invalid admission reservation.', 400);
  }
  return withLockedEvent(eventId, true, async (client, {capacity, used, commissioned}) => {
    if (!commissioned) throw new AdmissionInventoryError('INVENTORY_NOT_COMMISSIONED', 'Existing admission must be reconciled and inventory explicitly commissioned before sales.', 503);
    const existing = await client.query(
      'SELECT status, user_id, session_id FROM wildones_admission_reservations WHERE event_id=$1 AND invitation_id=$2 FOR UPDATE',
      [eventId, invitationId]
    );
    const row = existing.rows[0];
    if (row && row.user_id !== userId) throw new AdmissionInventoryError('RESERVATION_IDENTITY_MISMATCH', 'Reservation identity does not match.');
    if (row?.status === 'issued') throw new AdmissionInventoryError('ADMISSION_ALREADY_ISSUED', 'This invitation already has admission.');
    if (row?.status === 'held') {
      throw new AdmissionInventoryError('CHECKOUT_IN_PROGRESS', 'An earlier checkout must be verified or expire before trying again.');
    }
    if (used >= capacity) throw new AdmissionInventoryError('SOLD_OUT', 'All admission places are reserved or sold.');
    if (row) {
      await client.query(
        "UPDATE wildones_admission_reservations SET user_id=$3, session_id=NULL, status='held', expires_at=$4, updated_at=NOW() WHERE event_id=$1 AND invitation_id=$2",
        [eventId, invitationId, userId, expiresAt]
      );
    } else {
      await client.query(
        "INSERT INTO wildones_admission_reservations(event_id,invitation_id,user_id,status,expires_at) VALUES ($1,$2,$3,'held',$4)",
        [eventId, invitationId, userId, expiresAt]
      );
    }
    return { reused: false, capacity, available: capacity - used - 1 };
  });
}

// Once Stripe gives us the session, attach it to the durable reservation.
// A reservation is NEVER released merely because our HTTP request failed after
// Stripe created a session: Stripe may already be processing payment.
export async function attachAdmissionSession({ eventId, invitationId, userId, sessionId }) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId || '')) throw new AdmissionInventoryError('INVALID_SESSION', 'Invalid Stripe session.', 400);
  return withLockedEvent(eventId, false, async (client) => {
    const rows = await client.query(
      "UPDATE wildones_admission_reservations SET session_id=$4, updated_at=NOW() WHERE event_id=$1 AND invitation_id=$2 AND user_id=$3 AND (status='held' OR (status='issued' AND session_id=$4)) AND (session_id IS NULL OR session_id=$4) RETURNING invitation_id",
      [eventId, invitationId, userId, sessionId]
    );
    if (!rows.rowCount) throw new AdmissionInventoryError('RESERVATION_MISSING', 'Reservation no longer matches checkout.');
    return true;
  });
}

// Claim the seat before issuing a paid ticket. Retries for the same session
// are idempotent, and the event lock prevents racing another checkout.
export async function issueAdmission({ eventId, invitationId, userId, sessionId }) {
  if (!sessionId) throw new AdmissionInventoryError('INVALID_SESSION', 'Admission session is required.', 400);
  return withLockedEvent(eventId, false, async (client) => {
    const rows = await client.query(
      'SELECT status,user_id,session_id FROM wildones_admission_reservations WHERE event_id=$1 AND invitation_id=$2 FOR UPDATE',
      [eventId, invitationId]
    );
    const row = rows.rows[0];
    if (!row || row.user_id !== userId || row.status === 'released' || (row.session_id && row.session_id !== sessionId)) {
      throw new AdmissionInventoryError('RESERVATION_MISSING', 'Paid checkout has no matching active admission reservation.');
    }
    if (row.status === 'issued') {
      if (row.session_id !== sessionId) throw new AdmissionInventoryError('ADMISSION_ALREADY_ISSUED', 'This admission belongs to another checkout.');
      return { alreadyIssued: true };
    }
    await client.query(
      "UPDATE wildones_admission_reservations SET status='issued',session_id=$3,updated_at=NOW() WHERE event_id=$1 AND invitation_id=$2",
      [eventId, invitationId, sessionId]
    );
    return { alreadyIssued: false };
  });
}

// Session expiry/failure releases *only* an unissued hold. Refunded paid
// admission releases *only* an issued seat; charge disputes retain the seat.
export async function releaseAdmission({ eventId, invitationId, sessionId = null, issued = false }) {
  if (!invitationId) return false;
  return withLockedEvent(eventId, false, async (client) => {
    const state = issued ? 'issued' : 'held';
    const rows = await client.query(
      "UPDATE wildones_admission_reservations SET status='released',updated_at=NOW() WHERE event_id=$1 AND invitation_id=$2 AND status=$3 AND (($4::text IS NULL AND session_id IS NULL) OR session_id=$4) RETURNING invitation_id",
      [eventId, invitationId, state, sessionId]
    );
    return rows.rowCount > 0;
  });
}


/** Allocate a complementary admission in the same inventory as paid checkout. */
export async function issueCompAdmission({ eventId, invitationId, userId, expiresAt }) {
  if (!invitationId || !userId || !Number.isFinite(Date.parse(expiresAt))) {
    throw new AdmissionInventoryError('INVALID_COMP', 'Invalid comp admission identity.', 400);
  }
  return withLockedEvent(eventId, true, async (client, { capacity, used, commissioned }) => {
    if (!commissioned) throw new AdmissionInventoryError('INVENTORY_NOT_COMMISSIONED', 'Complimentary admission requires commissioned capacity.', 503);
    const found = await client.query(
      'SELECT status,user_id FROM wildones_admission_reservations WHERE event_id=$1 AND invitation_id=$2 FOR UPDATE',
      [eventId, invitationId]
    );
    const row = found.rows[0];
    if (row?.user_id !== undefined && row.user_id !== userId) {
      throw new AdmissionInventoryError('RESERVATION_IDENTITY_MISMATCH', 'The comp identity does not match.');
    }
    if (row?.status === 'issued') return { alreadyIssued: true };
    if (row?.status === 'held') {
      throw new AdmissionInventoryError('CHECKOUT_IN_PROGRESS', 'A paid reservation must finish before granting a comp.');
    }
    if (used >= capacity) throw new AdmissionInventoryError('SOLD_OUT', 'No admissions remain, including complimentary admission.');
    if (row) {
      await client.query(
        "UPDATE wildones_admission_reservations SET status='issued',session_id=NULL,user_id=$3,expires_at=$4,updated_at=NOW() WHERE event_id=$1 AND invitation_id=$2",
        [eventId, invitationId, userId, expiresAt]
      );
    } else {
      await client.query(
        "INSERT INTO wildones_admission_reservations(event_id,invitation_id,user_id,status,expires_at) VALUES ($1,$2,$3,'issued',$4)",
        [eventId, invitationId, userId, expiresAt]
      );
    }
    return { alreadyIssued: false };
  });
}

export async function getAdmissionInventory(eventId) {
  requireEvent(eventId);
  const configuredCapacity = admissionCapacity(eventId);
  const empty = {
    configured: Boolean(configuredCapacity), initialized: false, commissioned: false,
    capacity: configuredCapacity, held: 0, issued: 0, remaining: null,
    ready: false, error: null
  };
  if (!configuredCapacity) return { ...empty, error: 'Ticket capacity has not been approved.' };
  let pool;
  try {
    // Initialize the capacity row only after migration 003 is installed.
    // This does not issue a ticket or open sales.
    await withLockedEvent(eventId, true, async () => true);
    pool = connection();
    const r = await pool.query(
      "SELECT c.capacity, c.commissioned, COUNT(r.invitation_id) FILTER (WHERE r.status='held')::integer AS held, COUNT(r.invitation_id) FILTER (WHERE r.status='issued')::integer AS issued FROM wildones_event_capacity c LEFT JOIN wildones_admission_reservations r ON r.event_id=c.event_id WHERE c.event_id=$1 GROUP BY c.event_id,c.capacity,c.commissioned",
      [eventId]
    );
    if (!r.rows[0]) return { ...empty, error: 'Admission inventory migration/initialization is pending.' };
    const row = r.rows[0], held = Number(row.held), issued = Number(row.issued);
    const matching = Number(row.capacity) === configuredCapacity;
    return {
      configured: true, initialized: true, commissioned: row.commissioned === true, capacity: Number(row.capacity), held, issued,
      remaining: Math.max(0, Number(row.capacity) - held - issued),
      ready: matching && row.commissioned === true && held + issued <= Number(row.capacity),
      error: !matching ? 'Database and environment ticket capacity differ.' : row.commissioned !== true ? 'Inventory has not been reconciled and commissioned.' : null
    };
  } catch (error) {
    console.error('Admission inventory read failed:', error);
    return { ...empty, error: 'Admission inventory database/table is unavailable.' };
  } finally {
    await pool?.end();
  }
}
