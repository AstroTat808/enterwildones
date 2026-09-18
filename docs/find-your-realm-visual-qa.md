# Find Your Realm — Final Visual QA Checklist

Use this checklist on PR #59 before merge, then repeat the smoke subset against production after deployment.

## Release gate

- [ ] Build Check passes.
- [ ] Production visual QA passes.
- [ ] Release Certification passes.
- [ ] Launch Certification passes.
- [ ] No unexpected files are changed in PR #59.
- [ ] `find-your-realm.html`, `realm-quiz.css`, and `realm-quiz.js` load without console errors.

## Viewport matrix

Test the intro, one full quiz path, and one result at each viewport.

- [ ] 1366 × 768 desktop/laptop — critical above-the-fold target.
- [ ] 1440 × 900 desktop.
- [ ] 1920 × 1080 desktop.
- [ ] 1024 × 768 tablet landscape.
- [ ] 768 × 1024 tablet portrait.
- [ ] 430 × 932 large mobile.
- [ ] 390 × 844 common mobile.
- [ ] 360 × 800 compact mobile.
- [ ] 320 × 568 narrow fallback check.

## Intro screen

- [ ] Fixed navbar does not overlap the intro logo, kicker, headline, copy, CTA, or disclaimer.
- [ ] Main ENTER WILD ONES logo remains crisp and centered.
- [ ] “THE FOUR REALMS / PERSONALITY SIGNAL” remains legible and centered.
- [ ] “Which realm calls to you?” uses the same six-stop realm gradient as the Passport title.
- [ ] Gradient spans both headline lines cleanly with no clipped descenders or transparent fallback artifacts.
- [ ] Supporting paragraph uses the softer companion gradient and stays easy to read against the black background.
- [ ] On 1366 × 768, logo, kicker, full headline, supporting paragraph, Find My Realm button, and disclaimer are visible without scrolling.
- [ ] Find My Realm button is fully clickable and not obscured by the viewport edge.
- [ ] No horizontal overflow appears at any tested width.
- [ ] Orbit artwork remains subtle and never competes with the headline.

## CTA and interaction states

- [ ] Find My Realm hover treatment is visible but restrained.
- [ ] CTA focus state is clearly visible with keyboard navigation.
- [ ] CTA sheen does not flash excessively or repeat continuously.
- [ ] Tab order starts logically from navigation and proceeds into the quiz.
- [ ] Enter/Space activates the focused CTA.

## Question screens

- [ ] Question counter and Back control are aligned and readable.
- [ ] Progress bar advances correctly from question 1 through question 7.
- [ ] Question heading wraps naturally without orphaned words.
- [ ] Four answer cards are balanced on desktop and collapse to one column on mobile.
- [ ] Answer-card hover lifts only slightly and preserves readable contrast.
- [ ] Answer-card focus state is obvious when using the keyboard.
- [ ] Gradient hairline on hover/focus stays inside the card and does not bleed through rounded corners.
- [ ] Answer-card entrance motion feels quick and polished rather than distracting.
- [ ] Selecting an answer advances exactly once.
- [ ] Back returns to the previous question and preserves the expected selection flow.
- [ ] No layout jump pushes content under the navbar between questions.

## Result screens

Direct-result URLs can be used for fast visual inspection:

- [ ] `/find-your-realm?realm=aureva`
- [ ] `/find-your-realm?realm=halora`
- [ ] `/find-your-realm?realm=sunveil`
- [ ] `/find-your-realm?realm=nocturne`

For each realm:

- [ ] Correct realm logo appears and remains crisp.
- [ ] Correct realm accent/theme colors are applied.
- [ ] “YOUR REALM IS” label, realm name, headline, body, and trait chips all fit without clipping.
- [ ] Result logo and copy feel visually balanced on desktop.
- [ ] Result layout tightens cleanly on short laptop screens.
- [ ] Mobile result stacks logo above copy without excessive blank space.
- [ ] Explore This Realm CTA links to the correct realm page.
- [ ] Share Result provides a share sheet or copies the result URL as supported.
- [ ] Retake Quiz clears the result state and returns to the intro.
- [ ] Result reveal motion is subtle and does not cause visible content jumping.

## Accessibility and motion

- [ ] All interactive controls are reachable by keyboard.
- [ ] Focus indicators remain visible against every realm color.
- [ ] Text contrast remains readable in normal and hover states.
- [ ] At 200% browser zoom, the page remains usable with no clipped controls.
- [ ] With `prefers-reduced-motion: reduce`, panel/card entrance animations and CTA sheen are disabled.
- [ ] Screen-reader labels for navigation, Back, answer group, traits, and status regions remain intact.
- [ ] Hidden quiz sections are not focusable before they are revealed.

## Final pre-merge review

- [ ] Compare PR screenshots against the approved visual baseline.
- [ ] Confirm the Passport page itself is unchanged visually.
- [ ] Confirm no global `.button`, `.page-brand`, or typography styles outside Find Your Realm were altered.
- [ ] Confirm the 1366 × 768 intro requirement is met in an actual browser, not only responsive simulation.
- [ ] Confirm all required GitHub checks are green after the latest commit.
- [ ] Squash merge PR #59 only after the checklist above is complete.

## Production smoke after merge

- [ ] Production deployment completes successfully.
- [ ] Hard-refresh `/find-your-realm` and confirm the latest CSS is served.
- [ ] Recheck 1366 × 768 above-the-fold intro.
- [ ] Complete one live quiz from start to result.
- [ ] Open all four direct-result URLs.
- [ ] Test one mobile viewport.
- [ ] Confirm no console errors, broken images, or 404 asset requests.
