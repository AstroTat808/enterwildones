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

The included waiver copy is an operational draft and should be finalized before a live event launch.

## Check-in

Staff sessions are bound to one `eventId`. A valid ticket for another Wild Ones event is rejected as `WRONG EVENT`. Check-in re-verifies ticket status and waiver state server-side; the QR image itself is never the source of truth.

## Apple Wallet

One Wild Ones Pass Type identity can serve all realms. Passes use event-specific grouping, branding, dates and private venue data. Wallet generation requires an active ticket, a current waiver, signing certificates, and configured private venue details.

## Public-sale events

The current admission implementation is invitation-authenticated. Events configured for direct public sale, such as a future public SUNVEIL release, need the dedicated public-buyer identity step before `ticketSalesOpen` is enabled. Do not bypass identity by removing the invitation checks from checkout.

## Capacity and concurrency controls

The server must reserve seats in Postgres before creating Stripe Checkout.
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
