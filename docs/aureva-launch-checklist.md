# AUREVA 2026 — Launch certification and first-sales campaign

**Realm:** AUREVA · Realm I / Light  
**Event:** Saturday December 12, 2026, 3:00 PM HST to Sunday December 13, 3:00 AM HST  
**Decision:** NO-GO until every hard gate has been independently verified; never enable paid admission to bypass an incomplete gate.

## 1. Release ownership and invariants

- [ ] Appoint one release owner, one payment supervisor, one onsite operations lead, and one incident contact.
- [ ] Confirm the approved attendee-only capacity for AUREVA, separate from staff, performers, vendors and production crew. The broader Wild Ones venue target of 350 is **not** automatically AUREVA's authorized ticket capacity.
- [ ] Set `WILDONES_AUREVA_2026_TICKET_CAPACITY` to that approved integer in **Netlify production Functions**, not in source code.
- [ ] Apply `netlify/database/migrations/003_admission-capacity/migration.sql` on a disposable Neon branch first; test all constraints and transaction behavior, then apply it to production Neon, retaining a rollback/recovery plan.
- [ ] In the authenticated `/admin/launch` dashboard, enter the approved event capacity and run **Commission admission inventory**. This is an explicit, audited, one-time server-side operation; it atomically backfills matching paid, comp, disputed and pending-refund tickets. Sales must still be closed.
- [ ] Do not attempt to force `commissioned=true` manually: the commissioning endpoint rejects outstanding checkout holds, mismatched payment/guest IDs, duplicate active user records, and unreconciled previously issued seats.
- [ ] Reconcile all existing paid, comp, pending-refund and disputed tickets into the new inventory before opening admission. Launch Control must show **Issued = active + disputed + pending-refund ticket records**; investigate any divergence.
- [ ] Preserve `ticketSalesOpen:false` until all sections below pass and the formal GO decision is recorded.
- [ ] Keep HALORA, SUNVEIL and NOCTURNE admission gates closed.

### Admission and inventory acceptance criteria

- [ ] Capacity is **database enforced**, not a UI counter. Every checkout reserves a seat inside a Postgres transaction with an event row lock. The inventory starts uncommissioned and blocks every paid and comp reservation until an explicit historical ticket reconciliation succeeds.
- [ ] Paid checkouts, approval-only invitations and complimentary tickets all consume the same event capacity. Holding a place never itself issues a ticket.
- [ ] Concurrent requests for the last place produce exactly one reservation; the others receive SOLD_OUT or CHECKOUT_IN_PROGRESS.
- [ ] A valid pending Stripe session keeps its seat; time passing alone never releases a hold. Verified `checkout.session.expired`, definitive asynchronous payment failure, or a completed refund safely releases it.
- [ ] A payment and the associated issued ticket count against capacity; refunds invalidate credentials and return the seat exactly once.
- [ ] Retried webhooks, payment-return recovery, duplicate Checkout sessions and simultaneous comp requests do not create extra valid admissions.
- [ ] Staff use a documented **manual reconciliation** path for unresolved holds, missing ticket records, disputes or old entries; never lower capacity below current usage.
- [ ] No unauthorized request can retrieve identities, invitation codes, payment secrets or the private venue.

## 2. Finalize pricing and guest terms

- [ ] Verify **FIRST LIGHT RELEASE** at the owner-approved **$55** and the intended last moment to purchase. Template cutoff: **Oct 16, 2026 12:00 AM HST**, so the $55 phase lasts through Oct 15 at 11:59:59 PM.
- [ ] Verify **FULL RADIANCE** at the owner-approved **$70**, starting Oct 16 HST with no automatic final cutoff configured.
- [ ] Decide whether the unpriced optional **ZENITH** phase should remain disabled; do not publish it as an active ticket tier without a complete name, price and cutoff.
- [ ] Approve drink package **$75 / six credits**, and late checkout/car camping **$25/person until 10:00 AM**; verify cost, tax, and all applicable fees.
- [ ] If commissioning continues beyond October 15, change the First Light cutoff **before** promotional announcements; never sell tickets against an expired promotional date.
- [ ] Confirm waiver version, age policy (21+), alcohol controls, refunds, transfers, accessibility, parking and weather/cancellation copy.
- [ ] Verify Launch Control shows the **$55 / $70** current/next ticket tiers, precise HST transition, live capacity, held, issued and available, and owner approval.
- [ ] Verify production Netlify Function variables `WILDONES_AUREVA_2026_TICKET_PHASE1_PRICE_CENTS=5500` and `WILDONES_AUREVA_2026_TICKET_PHASE2_PRICE_CENTS=7000`; replacing documentation alone does not update production Checkout.

## 3. Production services (all mandatory)

### Netlify and Neon
- [ ] Confirm the canonical URL `https://enterwildones.com` serves the approved deployment and that TLS, security headers, redirects and noindex on private consoles are intact.
- [ ] Verify Node.js 24, Netlify Functions scope for every secret, and production `DATABASE_URL` targets the correct Neon branch; no database passwords or venue addresses appear in client assets.
- [ ] Confirm migrations 001, 002, **003**, tables and indexes on production, plus availability and backups/snapshot restoration.
- [ ] Test the capacity row initialization and an actual seat reservation on an isolated or controlled identity, then reconcile back to zero test holds.

### Stripe
- [ ] Verify that the intended Stripe account and its **live** secret key are installed in production.
- [ ] Verify the live webhook destination, signing secret, event selection, retry behavior and Stripe payment metadata.
- [ ] Use a single, allowlisted commissioning guest to complete one real, low-volume controlled paid checkout; confirm charge, webhook, idempotent fulfillment, receipt and correct admission balance.
- [ ] Confirm Stripe checkout actually charges **$55 (5500 cents)** for First Light and **$70 (7000 cents)** for Full Radiance, including exact HST phase transition; test successful/failed/cancelled/expired sessions, duplicate-ticket protection, refund/dispute behavior and capacity return.
- [ ] Test the checkout browser return when the webhook is delayed; verify recovery converges on one ticket.
- [ ] Remove temporary commissioning emails after certification and verify unauthorized users remain unable to purchase while sales are closed.
- [ ] Independently reconcile Netlify orders, Stripe payments/refunds and issued admission seats.

### Resend and email deliverability
- [ ] Verify the actual sending domain used by production. In the connected account inspected October 9, **enterwildones.com is not among the verified Resend domains**.
- [ ] Complete sending-domain verification; validate SPF, DKIM and DMARC for the chosen From domain.
- [ ] Verify `RESEND_API_KEY`, `WILDONES_EMAIL_FROM`, help address, notification recipients and bounce monitoring without printing credentials.
- [ ] Deliver real application, approval/invitation, ticket, payment, and reminder messages to Gmail, iCloud and Outlook test inboxes.
- [ ] Validate email links on iPhone, expirations, deduplication and delivery logs; make support and recovery work without revealing private invitation codes.

### Apple Wallet and gate
- [ ] Install Pass Type ID, Apple Team ID, the applicable WWDR/intermediate and pass-signing certificate/key, scoped to Functions.
- [ ] After payment and waiver, open the .pkpass on a physical iPhone; check artwork, event name/date, guest association, QR identity and offline accessibility.
- [ ] Attempt Wallet/QR access before the waiver and after a refund: both must remain blocked/invalid.
- [ ] Scan on a separate staffed gate device and prove duplicate scans and wrong-realm tickets are rejected.
- [ ] Rehearse camera failure, manual token entry, cellular outage and guest support recovery.

### Add-ons and staffed operations
- [ ] Complete a real drink-package add-on purchase, six-credit allocation, wristband assignment and last-credit redemption without underflow or duplicate charges.
- [ ] Complete late-stay add-on checkout and verify per-person entitlement and 10:00 AM departure instructions.
- [ ] Test staff admin access, RBAC/session expiry, lost-device credentials, refunds, cancellations and a physical event-day drill.
- [ ] Record each of the 14 rehearsal items as Passed in `/admin/rehearsal` with tester and evidence; require `/admin/launch` to show GO.

## 4. Quality certification / PR #71

- [ ] Diagnose GitHub Actions **startup failures** (jobs without runners/steps) separately from actual build, Lighthouse and visual test assertions. Check Actions enablement, organization usage/billing, hosted runner entitlement and concurrency limits.
- [ ] Resume the failed PR #71 workflows; validate the Master Cycle desktop card, unchanged mobile design, masthead at each supported width and Find Your Realm intro above the fold.
- [ ] Validate source audit, Node 24 build, ticket/security tests, Lighthouse/CWV, screenshots, Playwright in Chromium and WebKit, public/admin/transactional/staff routes.
- [ ] Do not merge PR #71 or this inventory hardening PR with missing or failed required checks. Report external runner blockers explicitly, never mark them green by hiding jobs.
- [ ] After merging, verify deployed production commit matches approved head and rerun complete live smoke, visual matrix and checkout commissioning test.
- [ ] Confirm controls and branding at 320, 390, 430, 440, 768, 1024, 1366, 1440 and 1920 pixels.

## 5. Public announcement and first-sale campaign

**Messaging:** AUREVA / REALM I: LIGHT — *Enter the Light. The first realm is opening.*  
**Public venue:** Undisclosed, Hawai‘i Island. Never publish the private street address, gate codes or staff links.

### Stage A — collect interest (before sales open)
- [ ] Verify application funnel and secure invitations.
- [ ] Publish a cinematic realm teaser (vertical reel, 1:1 feed, 16:9 website/social-share), event date and 21+ policy; do not imply that paid sales are live.
- [ ] Send opt-in RSVP/application announcement to the existing Wild Ones audience, prior-event participants who consented to marketing, and partner DJs.
- [ ] Establish unique tracking links and measurement for site visits, realm quiz, started/completed applications, approvals, invitations, checkout starts and completed paid admissions.

### Stage B — controlled First Light release (only after GO)
- [ ] Public CTA: **REQUEST PASSAGE** while approval is required; approved applicants are directed to their authenticated invitation checkout.
- [ ] Announce the **$55 First Light** price and explicit **Oct 15, 11:59 PM HST** deadline *only if sales actually open before then*.
- [ ] Publish launch-day email, Instagram/TikTok reel, artist reposts, countdown Story and pinned details/FAQ in coordinated branding.
- [ ] Monitor all purchases, inventory remaining, abandonment, bounced email, Stripe webhook failures, and support tickets during the first launch window.
- [ ] Pause promotions and preserve sales closed when any payment/seat invariant fails.

### Stage C — Full Radiance and ongoing promotion
- [ ] Automatically or deliberately transition to **$70 Full Radiance** at the verified price boundary; perform a controlled server-side price check immediately before/after.
- [ ] Announce the transition with accurate time-zone copy; do not advertise a false scarcity limit.
- [ ] Release lineup highlights, guest-experience visuals, venue-region logistics, policies, support, and relevant add-on information.
- [ ] Issue opt-in reminder sequence to incomplete applicants/approved invitees, without bulk unsolicited messaging.
- [ ] Weekly operational scorecard: applications → approvals → invites → checkouts → paid tickets, revenue, refunds, email failures, and occupancy/capacity.

### Copy starter (edit after pricing and GO)
> **AUREVA · REALM I / LIGHT**
> 
> The first realm begins December 12 on Hawai‘i Island. Twelve hours of sound, light and the Wild Ones universe. Ages 21+. Location disclosed to eligible ticket holders. Request passage at EnterWildOnes.com.
>
> **Approved invitations only.** First Light admission is $55 through October 15, 11:59 PM HST **if** certification is complete and sales are open; Full Radiance is $70 afterward.

## Final sign-off

| Hard gate | Owner/evidence | Status |
|---|---|---|
| AUREVA capacity approved and database reconciled | Ops + migration check | [ ] |
| Phased pricing, add-ons, terms | Owner + Launch Control | [ ] |
| Stripe live charge/webhook/refund | Payments + receipt | [ ] |
| Resend verified domain and message delivery | Email logs + inboxes | [ ] |
| Apple Wallet / QR / gate / bar devices | Physical test results | [ ] |
| Production rehearsals (14/14) | `/admin/rehearsal` | [ ] |
| PRs, CI and deploy QA green | GitHub Actions + Netlify | [ ] |
| Artist lineup, production, security and emergency plan | Event ops | [ ] |
| Marketing message, links and attribution | Marketing | [ ] |
| Owner records GO and flips only AUREVA sales | Launch Control | [ ] |
