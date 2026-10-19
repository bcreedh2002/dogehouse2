# Vega review implementation and release checklist

## Review scope

Prepared 2026-10-19 on `fix/vega-ordering-review`, based on staging PR #16 and origin fix PR #15. No main-branch merge or production deployment has occurred. Draft planner export PR #14 remains separate.

| Finding | Implementation | Remaining verification |
|---|---|---|
| GitHub Pages fallback rejects Netlify | Existing PR #15 requires explicit SITE_URL and trusted origins, inherited here | Production Supabase environment and Auth redirects inaccessible through the current connection |
| Dashboard omits payment fields | Hardened managed RPC returns approved total, payment status, quote email state and review flag | Hosted authenticated owner UI |
| Confirm without approved amount | Removed button; SQL rejects confirmation without final quote | Staging end-to-end approval |
| Cancel/payment race | Order locks, pending/paid cancellation denial; Edge expires Stripe session before SQL cancellation; legacy late payment restored to confirmed and flagged | Real sandbox expiry/payment concurrency |
| Customer quote/receipt/return flow | Claim/lease/retry quote email; account email passed to Stripe; distinct success/cancel query values; browser never declares paid | Resend/SMTP delivery, Stripe receipt settings and hosted return navigation |
| Unequal approval authorization | Same confirmed salesandinfo identity plus owner membership | Owner MFA enrollment remains manual |
| Unlimited build saves | 1.5 MB cap, per-account advisory lock and private event ledger limiting 20 saves/hour; delete/backdate cannot bypass | Hosted malicious-client tests |
| Headers/build configuration | netlify.toml with allowlisted public build and CSP/nosniff/referrer headers; isolated preview builds | Phone viewport preview capture passed under CSP; hosted headers and real phone hardware remain unverified |
| Duplicate deployments/missing CI | Pages publisher replaced with nonpublishing notice; pinned npm dependencies and SQL/handler/browser CI checks | Existing Pages site must be explicitly unpublished; branch protection is separate |
| Large assets | Two inline brand images resized; compressed HTML 523,292 -> 265,142 bytes | Desktop/mobile logos inspected; further legacy CSS cleanup deferred |
| 33 vs 36 in fit assumption | Fit advisor starts at 33 in and labels this a working exterior width | Fabrication team must verify final dimensions; no cut-ready geometry claim |

## Database state

DogeHouseTest1 is the only project exposed by the current Supabase connection. A bootstrap migration was applied there. Verified: all five application tables have RLS, managed dashboard SQL includes payment fields, anonymous users cannot read orders or call the payment-write RPC. The hosted rollback-only acceptance script also passed quote-only confirmation, pending checkout cancellation denial, customer isolation and non-owner rejection. All synthetic users/orders were rolled back; no staging accounts remain. No production records or credentials were copied.

Security advisors report informational deny-all/no-policy notices on internal owner/payment/rate tables and warnings for intentional authenticated SECURITY DEFINER owner RPCs. Those RPCs have explicit owner guards, empty search paths and revoked anonymous execution. These warnings are reviewed design choices, not a claim of a clean automated security report. See https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable .

## Finish staging

1. Attach a separate Netlify site to this branch, command `python3 scripts/prepare-staging.py`, publish `_site`, with explicit STAGING_SUPABASE_URL/STAGING_SUPABASE_PUBLISHABLE_KEY/STAGING_SITE_URL. The separate site's production-context command must explicitly remain the staging command.
2. In DogeHouseTest1, configure Auth site/redirect URLs and SMTP. Create/confirm the owner account and two customer accounts using controlled inboxes. Reapply only the owner-membership INSERT from owner-access.sql after confirmation.
3. Configure staging-only SITE_URL, ALLOWED_ORIGINS, RESEND_API_KEY, ORDER_EMAIL_FROM, STRIPE_SECRET_KEY (`sk_test_...`), STRIPE_WEBHOOK_SECRET and STRIPE_LIVE_MODE=false. Do not paste secrets into PRs/chat. Supabase secrets management isn't exposed by the connected MCP tools.
4. Deploy submit-order, owner-order, pay-order and stripe-webhook to the staging reference, preserving config.toml's explicit handler authentication settings. Register sandbox checkout.session.completed, checkout.session.expired and charge.refunded events.
5. New account -> save with two previews -> submit -> owner approve -> customer receives email -> 4242 checkout -> verified Paid -> partial refund -> full refund -> cancellation. Verify both accounts' direct REST visibility and rejected mutations. Test expired checkout, duplicate callbacks, interrupted session creation, paid/cancel race, forged return URL, and unconfirmed/non-owner authorization.
6. Check a phone-sized viewport and real phone photo generation while the embedded viewer is hidden at Review. Verify all fonts/images/SDK/iframe requests under CSP, plus distinct checkout returns and receipt delivery.

## Production release

Only after the exact candidate passes staging: approve release; verify intended production project identity; back up schema; apply launch-hardening.sql after confirmed prior prerequisites; configure production SITE_URL/ALLOWED_ORIGINS/Auth redirects; deploy all four functions; deploy the frontend; explicitly unpublish old Pages; verify no stale public URLs remain. Enroll owner MFA and verify Stripe account, webhook events, receipt settings and mode before live payments. Never switch staging to live mode.

Do not roll back the frontend to a version offering price-free confirmation. Database guards intentionally reject that old action. Rollback requires reviewing compatibility and preserving all payment records; do not drop payment/rate tables to revert.
