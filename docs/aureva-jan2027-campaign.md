# AUREVA · Realm I — Light — January 23, 2027 campaign

**Prepared:** November 15, 2026 HST.  
**Status:** Copy and creative brief approved for production; sales announcements are **NOT** authorized until the release owner certifies live Stripe, email, ticket capacity, and Wallet integration.

## Verified event schedule

- **AUREVA:** Saturday **January 23, 2027**, **7:00 PM–3:00 AM HST** (ending Sunday, January 24).
- **Late Checkout / Car Camping:** Sunday **January 24, 3:00 AM–10:00 AM HST**, **$25 per person**, optional, separate from admission. Anyone remaining after 3 AM needs their own entitlement.
- **First Light Release:** **$55**; expires **Saturday, January 9, 2027 at 11:59:59 PM HST**.
- **Full Radiance Release:** **$70** starting **Sunday, January 10, 2027 at 12:00:00 AM HST**.
- **21+**, Hawaiʻi Island, venue location withheld from public listings and disclosed only to authorized ticket holders.
- **Admission requires an approved invitation.** Applications may open before purchases; an application does not guarantee a ticket.
- ZENITH remains unpriced; do not advertise a final tier or unapproved capacity.

**Canonical links:** https://enterwildones.com/events/aureva (event) and https://enterwildones.com/apply/aureva (request passage).

**Release guard:** Do not send purchase CTAs until `ticketSalesOpen` is deliberately enabled, real Stripe checkout charges the exact advertised amount, capacity is enforced and reconciled, and production QA is green.

## Creative direction

Use the **original AUREVA logo** (do not stretch or redraw), intense white-gold portal light, obsidian/black atmospheric background, refined warm gold foil-style typography, cinematic tropical mist. No other realm logos except a small original Enter Wild Ones lockup if desired. Avoid false ticket-availability badges. Portrait 1080×1350 for feed, vertical 1080×1920 for Story, and 1200×630 or 1920×1080 for Facebook landscape.

**Mandatory information hierarchy:** AUREVA / REALM I · LIGHT; JAN 23, 2027; 7 PM–3 AM HST; Hawaiʻi Island · 21+; First Light $55 through Jan 9; Full Radiance $70 from Jan 10; optional Late Checkout $25 / Jan 24 · 3–10 AM; REQUEST PASSAGE · ENTERWILDONES.COM.

## Pre-launch: application collection (safe while sales are closed)

### Instagram / Facebook feed

✨ **AUREVA · REALM I — LIGHT**

The first realm opens **Saturday, January 23, 2027**, on Hawaiʻi Island.

🌟 **7:00 PM – 3:00 AM HST**

**FIRST LIGHT — $55** through January 9, 11:59 PM HST.  
**FULL RADIANCE — $70** beginning January 10.

🌙 **STAY FOR THE AFTERGLOW:** Optional Late Checkout / Car Camping **$25 per person** lets you remain until **10:00 AM Sunday, January 24**.

**Applications are open; ticket checkout is not yet open.**

🔱 **REQUEST PASSAGE:** https://enterwildones.com/apply/aureva

21+ · Private location · Approved invitation required.

#AUREVA #EnterWildOnes #TheFourRealms #HawaiiIsland #ElectronicMusic

### 3-frame Instagram Story

**Story 1 — The portal:**  
AUREVA · REALM I / LIGHT  
SAT JAN 23, 2027  
7:00 PM – 3:00 AM HST  
HAWAIʻI ISLAND · 21+

**Story 2 — Admission phases:**  
FIRST LIGHT — **$55**  
ENDS JAN 9 · 11:59 PM HST  
FULL RADIANCE — **$70**  
BEGINS JAN 10 · 12:00 AM HST  
"Prices scheduled; paid checkout not yet open."

**Story 3 — The afterglow:**  
LATE CHECKOUT / CAR CAMPING  
**$25 PER PERSON**  
SUN JAN 24 · **3:00–10:00 AM HST**  
STAY UNTIL THE MORNING LIGHT  
REQUEST PASSAGE → ENTERWILDONES.COM

### Reels / TikTok teaser (20 seconds)

0–5s: White-gold portal doors expand out of shadow; AUREVA logo.  
5–10s: Silhouette approaches luminous gateway. Overlay: **SAT · JAN 23 · 7 PM–3 AM**.  
10–15s: Gold energy pulse. Overlay: **FIRST LIGHT $55 · UNTIL JAN 9 / FULL RADIANCE $70**.  
15–20s: Warm dawn reflection over portal stones. Overlay: **AFTERGLOW $25 · SUN JAN 24 · UNTIL 10 AM** and **REQUEST PASSAGE / ENTERWILDONES.COM**.

## Sale-live only (do not schedule until owner records GO)

### First Light release announcement

**AUREVA FIRST LIGHT IS OPEN — $55**

Approved invite holders can now complete admission checkout for **$55** through **January 9, 11:59 PM HST**. **Full Radiance becomes $70 on January 10**.

AUREVA begins **January 23 at 7 PM** and ends **January 24 at 3 AM**. Optional **$25 Late Checkout** extends your stay until **10 AM Sunday**.

Already approved? Redeem your personal invitation at https://enterwildones.com/invite. New guests: https://enterwildones.com/apply/aureva.

21+ · Hawaiʻi Island · Private venue.

### January 9 reminder (if First Light sales are actually open, approved guests only)

**FIRST LIGHT ENDS TONIGHT — JANUARY 9 at 11:59 PM HST.** $55 through the deadline; $70 Full Radiance begins at midnight. Do not send if sold out, not on sale, or the release has been cancelled.

### January 10 Full Radiance

**FULL RADIANCE — $70** has begun for approved guests. First Light is closed. January 23, 7 PM–3 AM HST. Afterglow $25 until Sunday January 24 at 10 AM. Request Passage: https://enterwildones.com/apply/aureva.

## Email draft for opted-in list, pre-launch (safe, verify Resend domain first)

**Subject:** AUREVA January 23 | Enter the Light  
**Preheader:** 7 PM–3 AM. $55 First Light / $70 Full Radiance. Stay until 10 AM with Afterglow.

AUREVA opens the first realm of Enter Wild Ones on **Saturday, January 23, 2027, from 7 PM to 3 AM HST** on Hawaiʻi Island.

Our planned admission releases are **First Light $55 through January 9** and **Full Radiance $70 beginning January 10**.

The optional **$25 Late Checkout / Car Camping** add-on extends your experience until **10 AM on Sunday, January 24**.

**Applications are open; paid checkout has not opened yet.** Approved guests receive personal invitation access.

**REQUEST PASSAGE:** https://enterwildones.com/apply/aureva

21+ · Location disclosed through authorized ticket access.

Add legally required sender address and functional unsubscribe footer before distribution.

## Operations checklist for publishing

- [ ] Production site and API both show **Jan 23, 2027, 7 PM–3 AM HST**; digital ticket and Apple Wallet use the same schedule.
- [ ] Netlify **production Functions** values for the approved phases equal **5500 / 7000 cents**, with phase1 cutoff **2027-01-10T00:00:00-10:00**. Compare Stripe actual amount before enabling sales.
- [ ] `ticketSalesOpen` remains false until admission capacity, inventory, Stripe, Resend, Wallet, gate and refund tests pass.
- [ ] Complete the approved event-site, Facebook feed, Instagram feed, Story and vertical media QA; retain original AUREVA logo proportions.
- [ ] Confirm ages 21+, opt-in email consent, no public venue reveal or unapproved artist lineup claims.
- [ ] Launch application campaign first, then sale-available copy only after GO. Pause time-sensitive messaging if sales do not open.
