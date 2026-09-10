# ENTER WILD ONES data model

## Core rule
Every event-scoped record carries an immutable `eventId`. Cross-event identity uses `userId`. Nothing infers event scope from branding, URL, Stripe product names, or date.

## Stores

| Store | Key pattern | Purpose |
|---|---|---|
| `wildones-events` | `{eventId}` | Mutable operational event config |
| `wildones-event-secrets` | `{eventId}` | Private venue/access details |
| `wildones-users` | `{userId}` | Cross-event attendee identity |
| `wildones-user-indexes` | `email/{sha256}` / `phone/{sha256}` | Fast user lookup |
| `wildones-applications` | `{eventId}/{applicationId}` | Invite/access requests |
| `wildones-application-indexes` | `{eventId}/email/{sha256}` etc. | Per-event duplicate prevention |
| `wildones-invitations` | `{eventId}/{codeHash}` | Hashed single-use invite codes |
| `wildones-tickets` | `{eventId}/{ticketId}` | Admission source of truth |
| `wildones-ticket-indexes` | `token/{tokenHash}` / `stripe-session/{id}` | Secure ticket lookup |
| `wildones-package-definitions` | `{eventId}/{packageId}` | Sellable add-on definitions |
| `wildones-entitlements` | `{eventId}/{entitlementId}` | What a specific ticket owns |
| `wildones-payments` | `{eventId}/{paymentId}` | Payment ledger |
| `wildones-payment-indexes` | `stripe-event/{id}` / `stripe-session/{id}` | Webhook idempotency |
| `wildones-waivers` | `{eventId}/{waiverId}` | Signed waiver evidence |
| `wildones-checkins` | `{eventId}/{checkinId}` | Append-only gate events |
| `wildones-redemptions` | `{eventId}/{redemptionId}` | Drink/package usage |
| `wildones-passport` | `{userId}` | Cached attendance/progress projection |
| `wildones-audit` | `{eventId}/{timestamp}-{auditId}` | Admin/system audit log |

## Canonical records

### Event
Fields: `eventId`, `cycleId`, `cycleOrder`, `realm`, `name`, `slug`, `year`, `status`, `visibility`, `startsAt`, `endsAt`, `timezone`, `accessMode`, `minimumAge`, `capacity`, `applicationOpen`, `ticketSalesOpen`, `sales`, `branding`, timestamps.

Private location details live only in `wildones-event-secrets/{eventId}` with fields such as `venueName`, `streetAddress`, `arrivalInstructions`, `parkingInstructions`, and `revealPolicy`.

### User
Fields: `userId`, `fullName`, `preferredName`, `email`, `phone`, verification timestamps, `marketingOptIn`, timestamps.

### Application
Fields: `applicationId`, `eventId`, `userId`, `status`, `submittedAt`, contact snapshots, `location`, `instagram`, `referral`, `community`, `whyAttend`, `groupNames`, acknowledgements, and review object.

Status: `pending | approved | waitlisted | rejected | withdrawn`.

### Invitation
Fields: `invitationId`, `eventId`, `applicationId`, `userId`, `codeHash`, `label`, `ticketTierId`, `maxTickets`, `createdAt`, `expiresAt`, `redeemedAt`, `redeemedByUserId`, `status`.

Status: `active | redeemed | expired | revoked`.

### Ticket
Fields: `ticketId`, `eventId`, `userId`, `applicationId`, `invitationId`, `ticketTierId`, `orderId`, `status`, `source`, holder snapshot, `accessTokenHash`, `qrVersion`, issue/revoke/refund/dispute/check-in timestamps.

Status: `pending | active | refunded | disputed | revoked | void`.
Source: `paid | comp | imported`.

### Package definition
Fields: `packageId`, `eventId`, `name`, `type`, `status`, `priceCents`, `currency`, `credits`, `maxPerTicket`, `requiresAdmission`, `requiresAge`, sales windows, metadata.

Type: `credits | access | parking | camping | merchandise | other`.

### Entitlement
Fields: `entitlementId`, `eventId`, `ticketId`, `userId`, `packageId`, `paymentId`, `status`, `quantity`, credit totals, activation data, timestamps.

Status: `pending | active | consumed | refunded | disputed | revoked`.

### Payment
Fields: `paymentId`, `eventId`, `userId`, optional `ticketId`, `type`, `status`, `currency`, `amountCents`, `refundedCents`, Stripe IDs, line items, timestamps.

Type: `admission | addon | combined | manual`.
Status: `pending | paid | partially_refunded | refunded | disputed | failed | expired`.

Required Stripe metadata includes `event_id`, `order_type`, `payment_id`, and relevant `application_id`, `invitation_id`, `user_id`, `ticket_id`, and entitlement/package IDs.

### Waiver
Fields: `waiverId`, `eventId`, `ticketId`, `userId`, `waiverVersion`, `legalName`, `accepted`, `signedAt`, `ipHash`, `userAgentHash`, and `termsHash`. Signed waivers are append-only; a changed legal version creates a new record.

### Check-in
Fields: `checkinId`, `eventId`, `ticketId`, `userId`, `type`, `result`, `scannedAt`, `gateId`, `operatorId`, `waiverVerified`, `ageVerified`, `notes`. Check-ins are append-only.

### Redemption
Fields: `redemptionId`, `eventId`, `ticketId`, `entitlementId`, `packageId`, `creditsUsed`, `itemType`, `premiumUpgradeCollectedCents`, `redeemedAt`, `operatorId`, `wristbandId`.

### Passport
Keyed by `userId`. Holds per-cycle realm status plus lifetime `eventsAttended` and `cyclesCompleted`. Passport progress is a projection/cache only. An attended realm is derived from an admitted check-in, not from a purchase.

## Invariants

- Linked application, invite, ticket, entitlement, payment, waiver, check-in and redemption records must share the same `eventId`.
- An invitation can never issue a ticket for another event.
- An add-on can never attach to a ticket from another event.
- Gate readiness requires matching active ticket + event + waiver policy.
- Refunded, disputed, revoked, or void tickets remain invalid even if an old QR or Wallet pass still exists.
- Webhook processing is idempotent by Stripe event ID.
- Private venue fields never appear in public HTML, public event JSON, Stripe descriptions, or QR payloads.
- Passport attendance is derived from verified admitted check-ins.

## NOCTURNE 2026 migration
Historical records import under `eventId = nocturne-2026` and `source = imported`, preserving original IDs where safe and recording `legacySource = nocturnefestival.com`. Migration must be idempotent and must not re-charge, re-email, or re-issue access. Verified historical check-ins may seed Passport history without automatically making NOCTURNE 2026 part of the new four-realm cycle.
