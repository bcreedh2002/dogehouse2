# Stripe payments

Customers request an order first. The confirmed owner approves a final USD total
in **Customer ordered builds**, including shipping and tax. The customer then
chooses **Pay** in **Ordered builds**. Stripe hosts card checkout and eligible
wallets; card details never reach this site. No payment is taken at submission.

## Activate in test mode

1. Run `supabase/payments.sql` in Supabase SQL Editor after the existing
   `schema.sql`, `owner-access.sql`, and `orders.sql` migrations.
2. In Supabase Edge Function Secrets, securely set `STRIPE_SECRET_KEY` to your
   Stripe **test** secret key and `STRIPE_LIVE_MODE` to `false`. Keep the existing
   `SITE_URL` set to the public site URL (its root or launch page both work).
   Deploy `pay-order` and `stripe-webhook` with:
   ```sh
   supabase functions deploy pay-order --project-ref lftpzfnzokjqgeteitul --no-verify-jwt --use-api
   supabase functions deploy stripe-webhook --project-ref lftpzfnzokjqgeteitul --no-verify-jwt --use-api
   ```
   Alternatively, use **Deploy DogeHouse payments** in GitHub Actions with the
   existing `SUPABASE_ACCESS_TOKEN` repository secret. Apply the SQL migration
   before publishing the updated site.
3. Create a Stripe **test-mode** webhook destination:
   `https://lftpzfnzokjqgeteitul.supabase.co/functions/v1/stripe-webhook`.
   Subscribe to `checkout.session.completed`, `checkout.session.expired`, and
   `charge.refunded`. Save its signing secret as `STRIPE_WEBHOOK_SECRET` in
   Supabase. Use the event payload snapshot format and API version
   `2024-06-20`, matching the integration.

Publish the site after backend setup. Submit a test request, approve its total,
pay with Stripe's test card `4242 4242 4242 4242` (future expiry and any CVC),
and verify **Paid** in both customer and owner lists after refreshing.
Test a partial and full refund from Stripe's test dashboard and confirm the
displayed status. Check webhook delivery logs for successful responses.
Test cancellation and another customer's inability to pay or read this order.
Do not enter real card details in test mode.

## Operating rules

- Approval is permanent for that request. If the quote changes, create a new order
  request. The estimated design price remains preserved alongside the final total.
  Customers should receive the full quote and applicable terms before paying.
- Final totals must include applicable tax and shipping. This integration does
  not calculate taxes, collect deposits, invoice, or automatically notify the
  customer when a quote is approved. Contact them with the site link.
- Only the customer's authenticated, confirmed account can start checkout.
  Checkout uses the approved database amount, never a browser-supplied amount.
- The payment attempt ID supplies provider idempotency. Duplicate clicks reuse a
  session; an expired session is recorded before another attempt can be created.
  Refund events are monotonic, and refunded orders cannot be paid again.
- The return page only opens Ordered builds. A return URL never marks an order
  paid. Signed webhooks or a server-side Stripe session lookup confirm payment.
  Refresh the list if webhook delivery has not finished.
- Refunds are issued in Stripe's dashboard. Payment data stays in Supabase; the
  private `dogehouse_payment_attempts` table stores provider references and totals.
  Order/quote logic is separate from the Stripe adapter in
  `supabase/functions/_shared/payment-backend.ts`.
- If Stripe created checkout but saving its ID failed, retries reuse the same
  idempotency key for 23 hours. After that the handler fails closed to avoid a
  duplicate charge. Reconcile by finding the session's
  `metadata.dogehouse_attempt_id` in Stripe, confirming its amount, and attaching
  the session ID to that attempt via trusted administration. Redeliver its
  signed completed/expired webhook if needed. Never delete an unresolved attempt.
- Keep webhook retries enabled. Failed database updates return HTTP 500 so
  Stripe retries. Resolve unsuccessful deliveries before fulfilling orders.

## Go live

After end-to-end test-mode checks, activate your Stripe business account, configure
its live webhook destination, replace the test key and webhook secret with their
live equivalents, and set `STRIPE_LIVE_MODE=true`. Test and live sessions must
not share a database: use a separate Supabase project for testing, or resolve and
archive test orders/attempts before switching. Do not switch keys while payments
are pending. Configure sales terms, cancellation/refund policy and taxes for your
business before accepting live payments.

Keys belong only in Supabase server-side secrets. No Stripe browser key is needed
for this hosted checkout. Nothing here deploys migrations, sends email or takes
payment automatically.

## Local validation

```sh
node tests/payments.cjs
NODE_PATH=/workspace/dogehouse-tools/node_modules node tests/payments-access.cjs
NODE_PATH=/workspace/dogehouse-tools/node_modules node tests/accounts.cjs
DENO_TLS_CA_STORE=system DENO_DIR=/workspace/dogehouse-deno-cache /workspace/dogehouse-tools/node_modules/.bin/deno check --no-lock supabase/functions/pay-order/index.ts supabase/functions/stripe-webhook/index.ts
```

The account test needs the documented Python server on port 8000. These tests
cover the real PostgreSQL migrations and browser UI, with mocked Stripe/Supabase
responses. They do not prove live Stripe configuration or move money.
