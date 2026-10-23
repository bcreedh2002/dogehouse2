# October 22 review: verification and candidate status

Updated October 23, 2026. Branch: `fix/vega-ordering-review`; PR #17, stacked on #16 and #15. The full Tim/Vega review was read before edits and compared with all three PR heads. The starting #17 head was `3d2bdc4863c5c4d798a6d0c401e2f55c0d7eca0a`, matching the review. No finding below establishes a live customer incident. No production changes, real Stripe requests, credentials, account membership changes, or security setting changes were made during this work.

## Reproduction and fix

`node tests/payment-race.cjs` failed on the starting code with `Unexpected payment state` / P0001: reserve an approved order's attempt, record expiry, cancel through the owner SQL RPC, then deliver matching captured-payment evidence. That is an isolated PostgreSQL reproduction, not a real Stripe charge. After the fix the same sequence restores confirmed/paid, stores the intent, raises the review flag, and permits idempotent replay.

The candidate:

- Accepts matching paid evidence for expired attempts; validates session, amount and intent, including repeated paid deliveries. Replay does not increment the version or undo refunds.
- Fences new reservations under the order lock before cancellation contacts Stripe. Stale unpaid versions fail before provider side effects. A failed provider operation leaves the fence intact so cancellation can safely retry. A pre-payment form arriving after capture raises the review flag; a current paid version is denied without changing payment state.
- Reconciles a paid provider lookup during cancellation immediately and refuses cancellation. Capture is persisted before competing pending sessions are expired; failed cleanup returns retryable failure, and repeated completion retries cleanup.
- Looks up current Stripe state before releasing a pending attempt for an expiry event. Paid evidence wins over stale expiry. Repeated Pay calls share an attempt and Stripe idempotency key. A final reservation check prevents returning an open checkout URL after cancellation or capture wins. Paid retries return the existing captured attempt, never a new one.
- Recovers interrupted session binding using the existing Stripe idempotency key inside 23 hours. Outside that window it searches existing sessions only. A complete search with no match can expire the old unbound row through a service-only RPC. An incomplete search, provider failure or changed row fails closed. Search is bounded to 1,000 sessions per request; larger histories require operator reconciliation. Age alone never releases an attempt.
- Resolves refunds using PaymentIntent identity even without Charge metadata. Known-but-unrecorded payments return retryable failure; unrelated payments are ignored. Refund totals remain monotonic across captured intents.
- Makes `payments.sql` reject execution after hardening before it can replace hardened RPCs. Hardening remains repeatable. Adds quote email state and an exhausted-retry message to the owner dashboard. Deployment workflows require the explicit matching DogeHouseTest1 reference and an acknowledgement of SQL/configuration prerequisites; production is blocked on this branch.

Stripe documents that a successfully expired Checkout Session cannot subsequently complete. Therefore the reported SQL interleaving demonstrates a reconciliation defect, while whether an actual provider race produces it requires CASE 9. The candidate checks current provider state before considering an attempt expired. Reference: https://docs.stripe.com/api/checkout/sessions/expire

## Triage

| Review claim | Verified status and disposition |
|---|---|
| Late capture after expiry/cancellation rejected | Reproduced in real local SQL; regression now passes. Hosted Stripe race remains unrun. |
| Expire failure followed by paid lookup returns without recording | Confirmed by code; actual backend test now injects payment between failed expire and lookup and verifies persistence. Fixed in candidate. |
| Session-less attempts block Pay/Cancel | Confirmed local fail-closed path. Added recover-or-reconcile flow, age/identity guards and tests. Provider errors or a search over the bounded limit remain explicit reconciliation blocks. |
| Refund missing Charge metadata ignored | Conditional defect reproduced with a synthetic signed event lacking metadata; fixed and tested. Actual Stripe omission was not observed. |
| Older payment bootstrap silently overwrites hardening | Confirmed in original code; executable guard now rejects it. Full hardened schema and repeatability tested. |
| Staging commands omit owner-order; workflows target production | Confirmed in source; commands and workflow target guards corrected. No workflow was dispatched. |
| Quote badge/retry exhaustion misleading | Confirmed in source; separate quote badge and five-attempt exhaustion message verified in browser tests. Shop notification badge retained. |
| Netlify origin fallback | Already fixed in the PR stack; local CORS tests pass. Review's production HTTP observations were not independently repeated. |
| Payment fields, quote-only confirmation, stricter mutation identity | Already fixed in stack; combined-schema local tests pass. Existing staging schema has these fields. Hosted owner session still unavailable. |
| Auth email in Checkout and distinct return URLs | Already fixed; backend tests pass. Real receipt delivery and hosted navigation remain unverified. |
| Save cap/rate, build isolation, CI, asset reduction | Existing fixes retained; regression suites pass. No production release inferred. |
| CSP script-src unsafe-inline | Confirmed source configuration. Deferred under the instruction not to change security settings. No CSP change made. |
| Extra owner-table member can read all records | Confirmed in combined-schema local test. Read authorization remains wider than mutation authorization. No policies or memberships changed; authorization policy decision remains open. |
| Medium model dimensions / 33 vs 36 inches | Not measured or reproduced; fabrication confirmation remains external. |
| Existing live origin/headers/Pages availability | Review claims only for this task; no production queries or changes made. |

## Checks actually run

- `npm ci` completed. `npm test` passed all 11 Node/SQL suites and three Python build suites, including the new payment race regression. The payment access suite now loads the full hardened schema rather than asserting rejection of late capture as expected behavior.
- `npm run test:browser` passed all three suites (accounts, owner dashboard, mobile review) with the real browser/SDK and mocked service responses. Standard Chromium was blocked by the host's process-singleton socket restriction; rerun succeeded using `DOGEHOUSE_CHROMIUM=/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell`. Quote email failure/exhaustion and the review banner are covered. These are not hosted payment tests or real-phone hardware tests.
- `git diff --check` and JavaScript syntax check passed.
- Read DogeHouseTest1 project identity, function list, order columns, counts, logs and advisors. At inspection: zero Auth users, orders and attempts; only submit-order and owner-order deployed. Existing intentional definer-RPC warnings and internal deny-all tables remain; no security settings changed. Advisor references: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .
- Attempted staging migration `vega_oct22_payment_reconciliation` twice. Both calls failed with `McpServerError: Invalid or expired requestState`. A read after the first attempt confirmed `payment_cancellation_requested` was absent. No candidate function deployment proceeded because the SQL prerequisite is missing. Connector reads work; the mutation request cannot currently complete. This is a connector error, not a passed migration.
- `tests/staging-acceptance.sql` now includes rollback-only synthetic database race assertions, but the updated hosted script has NOT run. It is explicitly not CASE 9 and creates no Stripe evidence.

## Hosted acceptance ledger

All cases below are **blocked / not run against the candidate**. Local tests are supporting regression coverage only.

| Case | Required hosted evidence still pending |
|---|---|
| 1 success | Test-mode Checkout, amount 30000, actual intent, confirmed/paid, webhook 200 |
| 2 decline | Test decline, unchanged unpaid row and reused session |
| 3 abandon/back | Both paths, same pending session and distinct return UI |
| 4 expiry | Verified Stripe expiry, HTTP 200 and one new attempt on retry |
| 5 two tabs | Shared session/idempotency, exactly one successful intent, paid retry |
| 6 cancel before Pay | HTTP 200, cancelled/unpaid, no attempts; later Pay 409 |
| 7 cancel open checkout | Stripe expiry precedes SQL cancellation; later expiry delivery 200 |
| 8 cancel after paid | Denied; payment and attempt preserved |
| **9 RELEASE GATE** | Three distinct simultaneous Pay/Cancel runs; after-success-before-return; stale owner form. Every capture: confirmed/paid, actual intent, review flag for racing cancel, owner banner and customer Paid, exactly one successful intent, eventual webhook 200 |
| 10 replay/reorder/mode | Actual endpoint resend/reordering, no duplicate version changes, early refund retries, live-mode event rejection |
| 11 refunds | Test partial 5000 and full 30000, smaller replay, no new Pay, allowed cancellation only after refund |
| 12 quote email | Controlled recipient delivery/retry/idempotency and exhausted retry handling; no failure injection by changing security settings |
| 13 access | Two controlled customer accounts and owner, cross-account read/pay denial; no extra owner membership created |
| 14 forged return | checkout=success alone never changes payment state |

## Smallest next steps

1. Restore the Supabase connector's ability to complete the already-authorized staging migration (or have the operator apply the reviewed `launch-hardening.sql` to DogeHouseTest1, last, without rerunning `payments.sql`). Confirm the cancellation-fence column/RPCs exist. Then run the rollback-only SQL script and deploy all four candidate functions to staging. Do not deploy the new owner-order handler ahead of its SQL.
2. Provide access to existing controlled staging accounts, or have the operator establish the confirmed owner and two customer accounts. The current staging project has zero Auth users; no account credentials were created here.
3. Verify existing staging-only configuration in the service dashboards: SITE_URL/ALLOWED_ORIGINS, STRIPE_LIVE_MODE=false, an existing sk_test key and endpoint signing secret, test webhook subscriptions for completed/expired/refunded, and existing Resend sender/key. These secret values were not readable through the connector and were not verified this turn. Do not create keys or paste them into chat. The candidate additionally refuses live mode on DogeHouseTest1.
4. Deploy the same frontend candidate to the isolated staging site and confirm its commit, banner and public project config. The prior staging frontend must not be treated as the updated candidate. Run all 14 cases and attach order/attempt snapshots plus test event IDs and HTTP results. CASE 9 remains a release gate regardless of local or CI success.

PR #17 stays draft. No merge or production release is authorized by these results.
