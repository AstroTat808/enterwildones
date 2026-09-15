# Approved Four Portals homepage artwork

The approved landscape (1672 x 941) and square (1254 x 1254) compositions both have the bottom tagline and divider ornaments removed. Retain the upper slogan, main wordmark and complete portal scene. Do not use the discarded close-up portrait campaign.

Desktop above 700 CSS pixels uses the landscape; mobile at or below 700 CSS pixels uses the square. Native picture/source selection supplies six WebP variants and two JPEG fallbacks. The artwork is shown without cropping, stretching or overlays, with both action buttons below it. The header, realm sections, Passport section and corrected footer are unchanged. No backend, credentials, pricing, venue or payment changes.

## Current release gate

The initial implementation commit contains the source code and manifest, but the eight binary images have not yet been transferred into this branch. Do not merge or deploy it in this state. `npm run build` invokes `scripts/validate-campaign.mjs` through prepare-static and fails when any image is absent, has the wrong length, or does not match the approved SHA-256 hash.

Upload the eight unpacked files from `wildones-approved-images.zip` into `site/assets/images/campaign/` on `feature/four-portals-homepage`, not main. The manifest already exists; do not replace it or upload the ZIP itself. Source artwork and derivative checksums were validated in the local release package.

## Required verification

After asset transfer, run the full project build and inspect Chromium and WebKit at 320, 375, 390, 393, 430, 700, 701, 768, 1024, 1440 and 1920 CSS pixels. Confirm correct square/landscape selection, a fully visible composition, no header/image/action/footer overlap, working action links and no horizontal overflow or failing asset requests. Also verify the homepage without JavaScript.

Only merge to main after successful verification. Confirm Netlify production commit_ref matches the merge SHA and repeat live mobile/desktop checks. A successful build alone is not visual certification.
