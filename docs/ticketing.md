# Multi-event ticketing security model

## Invariants

Every admission path is scoped by `eventId`. The event identity must agree across the invitation or access grant, Stripe Checkout metadata, payment record, ticket record, signed ticket token, waiver, Apple Wallet pass, private venue lookup, and staff check-in session.

Ticket prices are never hard-coded. Each event requires a valid single-price configuration (`WILDONES_<EVENT_ID>_TICKET_PRICE_CENTS`) or a complete phased-price schedule (`TICKET_PHASE1_*`, `TICKET_PHASE2_*`, optional `TICKET_PHASE3_*`). Ordinary public checkout requires `ticketSalesOpen=true` (only explicitly allowlisted commissioning identities may transact while closed). All paid **and complimentary** admissions require an approved positive `WILDONES_<EVENT_ID>_TICKET_CAPACITY` and deployed admission-inventory database migration.

The current invitation flow intentionally supports one named ticket per invitation. Invitations with `maxTickets > 1` fail closed until a separate group-attendee identity flow is implemented, because every admitted participant needs an independently attributable ticket and waiver.

## Payment lifecycle

1. A redeemed event invitation creates an event-scoped signed access cookie.
2. `/ticket-access` verifies the cookie against the persisted invitation.
3. `/api/ticket/checkout` re-verifies event, invitation, user, application, sales state and configured price before creating Stripe Checkout.
4. Stripe receives `event_id`, `invitation_id`, `application_id`, `user_id`, `purchase_type`, and expected amount metadata.
5. `/api/stripe/webhook` verifies Stripe signatures and finalizes paid sessions.
6. `/ticket-confirmed` independently retrieves the Checkout Session and can finalize a paid ticket when the webhook is delayed.
7. Ticket identity is deterministic from the event + invitation so webhook and browser recovery converge on one ticket.
8. Duplicate paid sessions for an already-fulfilled invitation are automatically submitted for duplicate refund.
9. Refund and dispute events deactivate the server-side ticket. A won dispute can restore a disputed ticket; refunds remain inactive.

## Digital admission

The signed ticket token contains `eventId`, `ticketId`, `userId`, and expiration. Its signature is checked on every ticket, waiver, QR, Wallet and check-in request.

The QR remains locked until the current event waiver is signed. Private venue name, address, instructions and map link are also withheld until the ticket is active and the waiver is current.

## Waiver

The waiver text is versioned and hashed. The signed record captures the event, ticket, user, signer name, timestamp, user agent and a hash of the client IP. Changing the waiver text/version makes older waiver records non-current and re-locks gate readiness until re-signed.

The proposed waiver revision names Wild Ones LLC and Koa's Events LLC separately, discloses foreseeable festival and optional late-stay risks, and preserves non-waivable rights, including negligence claims under HRS § 663-1.54 where applicable. The signature POST requires the exact current version and event-specific text hash shown by the ticket form; missing or stale fields return 409 without recording consent. New records capture the complete accepted text and affirmative consent; the dedicated `wildones-waiver-history` store retains prior records and each new acceptance before the current record is overwritten. Historical v1 records contain a hash, not a text snapshot; retain the source revision as evidence. History is access-controlled but is not a WORM or independently timestamped evidence system.

Before production release: review event-specific hazards and entity names, verify a full pre-purchase waiver preview and conspicuous notice, review legal scope and insurer requirements, provide an accessible retained copy, certify stale-form rejection and QR/Wallet/check-in re-locking using isolated fixtures, and document site safety instructions, ability-to-participate measures, and incident procedures. Existing signers of the previous version will need to review and sign the new version; never backdate or migrate signatures. Do not roll this change out during admission without an operational plan.

## Check-in

Staff sessions are bound to one `eventId`. A valid ticket for another Wild Ones event is rejected as `WRONG EVENT`. Check-in re-verifies ticket status and waiver state server-side; the QR image itself is never the source of truth.

## Apple Wallet

One Wild Ones Pass Type identity can serve all realms. Passes use event-specific grouping, branding, dates and private venue data. Wallet generation requires an active ticket, a current waiver, signing certificates, and configured private venue details.

## Public-sale events

The current admission implementation is invitation-authenticated. Events configured for direct public sale, such as a future public SUNVEIL release, need the dedicated public-buyer identity step before `ticketSalesOpen` is enabled. Do not bypass identity by removing the invitation checks from checkout.

## Capacity and concurrency controls

The server must reserve seats in Postgres before creating Stripe Checkout. New inventory starts `commissioned=false`: a protected, explicitly confirmed admin operation must reconcile historical paid, complimentary, disputed and pending-refund tickets before admitting any paid or comp request.
The transaction locks one event-capacity row using `FOR UPDATE`. It counts
both `held` and `issued` reservations and rejects SOLD_OUT and duplicate
user/invitation activity. This is independent of front-end counts and applies
also to complimentary tickets. Issuance is idempotent for the same session.

An unresolved Checkout session continues occupying inventory; elapsed time
alone cannot release inventory because an asynchronous charge might succeed.
Only Stripe-confirmed expiry/failure and full refunds release inventory.
Manual reconciliation is required for orphaned or historical checkouts.
Disputed admissions retain their capacity until the payment outcome is settled.
Launch Control must reconcile the count of issued reservations against active
and disputed tickets before enabling admission sales.

**Migration:** `netlify/database/migrations/003_admission-capacity/migration.sql`.
Testing must include a 1-seat two-buyer race, comp admission races, webhook
replay, refund/rebuy, Stripe expiry, and reconciliation of any legacy tickets.

## Waiver evidence center and late-stay policy

The authenticated `/admin/waivers` page lists event-specific waiver readiness, outstanding supplemental waivers, historical evidence and hash verification. Its print view is designed for browser Save as PDF; JSON is the original evidence export. No direct PDF generator or certificate-based PDF signature is implied. Legacy signatures without exact text snapshots are explicitly labeled incomplete. Admin evidence access requires a successful conditional create-only audit write; the signed records themselves are archived before unlocking admission.

The independent late-stay waiver is required for every active `late_stay` entitlement, whether bundled or bought later. QR, ticket venue details, Wallet issuance and admission scan share `waiverGate`. A separate check-in mode verifies current entitlement and both agreements after admission; staff must verify matching government-issued photo ID and use this mode before assigning late-stay credentials and during the transition to overnight access. There is no offline bypass. Refunded or disputed add-ons do not confer late access. Current venue and safety rules must be communicated in person.

Archive writes are content-addressed and use Netlify Blobs conditional create-only writes. This is application-level append-only, not provider-enforced WORM. Before claiming immutability, configure independent retention-locked object storage under a separate administrative account, a least-privilege writer with no delete/retention-change permissions, encryption, retention and legal-hold policies approved by counsel, verifiable replication, and a documented restore test. Never expose signature archives or ticket tokens in a public bucket. The archive is not a substitute for legal review or evidence of actual risk instruction.

## Pre-purchase disclosure and event-day operational release

Admission checkout requires affirmative acknowledgement of the exact current participant waiver preview; selecting a bundled late-stay add-on requires a second, independently versioned acknowledgement. Standalone late-stay purchases enforce the same disclosure. The server validates both version and hash before creating Stripe checkout; checkout records retain acknowledgement metadata. These are disclosures, not electronic signatures. The authenticated ticket holder must separately sign after purchase. Previously opened Stripe sessions and existing paid tickets remain subject to actual signature enforcement at the gate.

The release checklist now includes explicit legal approval, insurance, physical inspection, guest safety instructions, overnight verification and independent archive recovery. None may be marked passed without documented evidence. Event-day readiness remains NO-GO until these items pass. A system status is not a guarantee of coverage or legal enforceability.

### On-site operating checklist

- Confirm the exact entities and event-specific hazards with Hawaiʻi counsel and insurers; confirm whether policy endorsements list both LLCs and any other required parties. Record policy/endorsement references securely, not in public source or guest-visible notes.
- Inspect walking and parking surfaces, lighting, drainage, electrical systems, cables, stage barriers, emergency routes, weather exposure and designated sleeping areas before opening. Log time, inspector, issues, remediation and reinspection. Stop or relocate activities if hazards remain uncontrolled.
- Post the actual risk disclosures and safety rules; brief staff on assistance, guest ability to participate, signs of medical distress or dangerous intoxication, evacuation, emergency contacts and escalation. Do not treat a self-certification as a medical assessment.
- At admission, verify the name and age on photo ID and server-validated credential. No screenshot-only, manual override or offline admission when waiver status is unverifiable. Provide an accessible way to review and sign without coercion; arrange an approved refund or other remedy where required for guests who decline new terms. Do not force guests to drive impaired.
- At overnight transition, use the separate late-stay scan mode; check ID, active entitlement and both current signatures; verify marked sleeping/parking areas and communicate no-idling, fire, exhaust, emergency access, and checkout procedures. Provide safe transportation options and emergency assistance.
- Preserve incident reports, inspection records, staff briefings and evidence exports under a restricted access and counsel-approved retention/hold plan. Treat them as sensitive personal records. Never store actual guest evidence in GitHub.
