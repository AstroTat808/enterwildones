# Enter Wild Ones GitHub Actions recovery and spending controls

## Incident: October 6–11, 2026

GitHub Actions in the **private** `AstroTat808/enterwildones` repository began terminating jobs before any step executed. Examples include PR #71 Build Check #404 with `startup_failure`, and PR #73 Build Check #431 with a job present but no GitHub runner assigned. The latter had `runner_id: 0`, empty `runner_name`, an empty `steps` array, and **0 ms of billable runner time**.

**Do not attribute these failures to application code, npm, Playwright, Lighthouse, or workflow YAML** when there is no runner. Netlify preview builds continued working, so separate those builds from the GitHub-hosted job allocator.

A minimal diagnostic on PR #74 (Runner Dispatch Diagnostic #1) independently requested `ubuntu-24.04` and `ubuntu-22.04`. Both **succeeded on October 11**, proving GitHub-hosted runner assignment recovered. The standard `ubuntu-latest` Build Check #435 passed immediately afterward without changing its runner label. The underlying temporary restriction was not independently confirmed. An exhausted private-repository Actions budget/spending cap is a plausible hypothesis **but has not been proven**; it should not be described as the established cause.

## Recovery procedure

1. Inspect a failed workflow's **job** record: name, label, runner ID/name, `steps` array and run attempt. If all steps are absent and runner ID is 0, the problem predates application execution.
2. On a fresh branch/commit or by dispatching the minimal diagnostic from Actions, require that both Ubuntu runner probes show `Prove GitHub assigned a runner and executed a step` = success. A successful Netlify preview is not equivalent.
3. If runner probes also fail with zero steps, inspect personal GitHub **Settings → Billing and licensing → Budgets and alerts**, private-repository Actions usage / payment method, and `Repository → Settings → Actions → General`. Restore quota/budget if exhausted or contact GitHub Support with failed run/job IDs.
4. When runner probes pass, rerun the actual PR's **Build Check**, **Launch Certification**, **Production visual QA** and **Release Certification**. Inspect real step logs and artifacts for application failures, and correct those failures as normal code bugs.
5. GitHub currently caps reruns of the same workflow run at **50 attempts**. When older PR runs have reached that limit, create a new legitimate commit on the PR branch so GitHub generates *new workflow run IDs*. Do not rerun the saturated run indefinitely.
6. For screenshot approval, inspect Chromium and WebKit screenshots, maintain intended responsive baseline changes, and retain independent Lighthouse, payment, launch and security gates. A Netlify deploy-preview pass is not a complete release certificate.
7. Merge only after every **required GitHub check** for the approved PR head genuinely concludes `success`. After merge, verify Netlify production deploy SHA and full post-merge production security/browser QA.

## Prevention changes

- `Build Check`, `Launch Certification`, and `Operations Build` now use `concurrency` scoped to the PR number or Git ref. A new commit cancels *superseded runs from the same PR only*, without cancelling another branch's checks.
- `Production visual QA` now runs when one of these workflow configurations or the runner diagnostic changes. This ensures Release Certification can find its required `Production QA Gate` on CI-only pull requests; previously Release Certification waited for a check that was never dispatched.
- No visual, Lighthouse, payment, launch, source, or security test has been removed. No check conclusion is overwritten or skipped to force a green result.
- The diagnostic workflow never requires secrets, a checkout, npm dependencies, or external network calls; it is reserved for independently testing runner allocation.

**Security:** Keep this repository private. Making it public to sidestep private Actions billing would expose project source and is **not** an acceptable CI repair.
