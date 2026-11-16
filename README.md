# ENTER WILD ONES

Multi-event festival platform for Wild Ones LLC, built by generalizing the proven NOCTURNE Netlify/GitHub architecture.

## Product direction

ENTERWILDONES.com is the shared identity, ticketing and operations layer for multiple festival brands. Each festival has a stable `eventId`; all event-scoped operational records carry that ID so application, invitation, ticket, package, waiver, check-in and payment state cannot cross event boundaries.

Current cycle registry:

- `aureva-2026` — Realm I / Light
- `halora-2027` — Realm II / Balance
- `sunveil-2027` — Realm III / Fire
- `nocturne-2027` — Realm IV / Night

The names and dates are configuration and can be changed without altering the platform model.

## Foundation implemented

- Four Realms / Wild Ones Cycle homepage
- Central server-side event registry
- Public event API that exposes an allowlisted event projection only
- Shared Netlify Blob store names and event-scoped key helpers
- Exact data model for users, applications, invitations, tickets, packages, entitlements, payments, waivers, check-ins, redemptions and Passport progress
- Netlify build/functions configuration and security headers
- Event-registry validation in CI/build

## Why this is not a blind NOCTURNE copy

The current NOCTURNE project is intentionally single-event. It hard-codes NOCTURNE store names, environment variables, hostnames and business copy in multiple functions. ENTER WILD ONES keeps the proven flows, but introduces an explicit event boundary before those functions are migrated.

The migration order is:

1. Foundation/event registry/data contracts
2. Application and review workflow
3. Invitation creation/redemption
4. Ticket tiers and Stripe checkout
5. Stripe webhook/payment transitions
6. Digital ticket, waiver and private venue reveal
7. Add-on/package manager
8. Check-in and bar redemption
9. Admin multi-event selector/reporting
10. Passport identity and historical NOCTURNE import
11. Apple Wallet event-specific branding
12. Backups, reminders, preflight and full regression suite

## Local validation

Use Node.js 24 (`nvm use`).

```bash
npm install
npm run build
```

## Database deployment

The drink ledger and Passport magic links use external Neon Postgres through
`@neondatabase/serverless`. Set `DATABASE_URL` to the Neon pooled connection
string in the Netlify project's production environment, scoped to Functions.
Keep the credential out of source control and the public `site/` directory.

The schema remains versioned in `netlify/database/migrations/`. For a new database,
apply `001_drink-credit-ledger/migration.sql`, then `002_passport-auth/migration.sql`
using a direct Neon connection. Validate schema changes on a Neon branch first.
These migrations are managed separately from Netlify builds; removing
`@netlify/database` prevents automatic Netlify Database provisioning and allows
this project to retain its existing Netlify plan.

## Security boundaries

- Do not put private venue details in `site/`, the public event API, Stripe product descriptions or QR payloads.
- Store raw invite codes nowhere after delivery; persist only hashes.
- Scope every admin and attendee mutation by a validated `eventId`.
- Treat Stripe webhook IDs as idempotency keys.
- Keep Wallet/QR validation server authoritative so refunds, disputes and revocations take effect immediately.

See `docs/data-model.md` for the canonical record model.
