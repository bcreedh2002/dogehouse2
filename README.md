# DogeHouse: Netlify + Supabase

Stripe checkout after owner quote approval is available; see
[PAYMENTS.md](PAYMENTS.md) for test-mode activation and operating instructions.

The site remains static. Supabase provides email/password authentication,
confirmation and password-reset emails, and private saved doghouse builds.
Order requests use a small Supabase Edge Function; there is no self-hosted server or SQLite dependency.

## Hosting and launch setup

Canonical public site: https://dogehouse.netlify.app/. GitHub holds source and pull requests; Netlify builds `python3 scripts/prepare-pages.py` and publishes `_site`. `netlify.toml` defines the build and security headers. The legacy Pages workflow no longer publishes. Unpublish the existing GitHub Pages site separately in repository Settings > Pages.

Follow [the release checklist](docs/vega-release.md) and [isolated staging guide](docs/staging-setup.md). For a fresh database run `schema.sql`, `owner-access.sql`, `orders.sql`, `order-management.sql`, `payments.sql`, then `launch-hardening.sql`, in that order. For an existing deployment with the first five already applied, apply only `launch-hardening.sql`; do not rerun older scripts after it.

Set public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the production Netlify site (the public committed configuration is a fallback). Private keys belong only in Supabase Edge secrets. Never put a secret/service-role key in a frontend variable. Configure Supabase Auth Site URL as `https://dogehouse.netlify.app/`, with root and `/dogehouse-launch.html` redirects. Keep email confirmation enabled, configure SMTP, and verify signup/recovery delivery with two accounts.

Preview/branch builds require isolated `STAGING_*` variables and use `prepare-staging.py`; they must never share the production database. On the separate staging Netlify site, explicitly set its production-context build command to `python3 scripts/prepare-staging.py` so it cannot use the committed production account settings.

## Local development

Edit the public settings in `account-config.js` to use your project, then run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Request `/dogehouse-launch.html`. Add the exact local URL
`http://127.0.0.1:8000/dogehouse-launch.html` to Supabase's redirect allowlist for
email confirmation and password recovery during development. Empty settings keep
accounts disabled with a clear message; customization and build-details downloads
still work. Authentication sessions are stored/refreshed by the Supabase SDK in
browser local storage. Sign-out retains the current browser-session design.

For local testing of the Pages artifact, run
`python3 scripts/prepare-pages.py --allow-unconfigured` and serve `_site`.
Staging reads the committed public `account-config.js` settings by default.
Environment variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` override them
when supplied together. No private production credential is needed. All asset URLs are relative
and work at the repository subpath. Password recovery returns to the current page
path, opens the reset dialog, and signs out after updating the password.

## Validation

```sh
npm ci --ignore-scripts
npm test
npx playwright install chromium
node tests/accounts.cjs
node tests/owner-dashboard.cjs
python3 scripts/check-supabase.py
```

The first suite uses real PostgreSQL in PGlite plus mocked Auth, Stripe, and Resend handlers. Browser tests use the real vendored SDK and mocked service responses; local asset routes avoid requiring a separate test server. They do not prove hosted authentication, actual card payments/refunds, or email delivery. The staging acceptance checklist remains required. `DOGEHOUSE_CHROMIUM` selects a browser executable when needed.

## Data and maintenance

Each save creates a named copy; reopening asks before replacing the current design.
Saved designs contain customization, add-ons, and entered customer/fulfillment
information. Row-level database policies enforce customer isolation and confirmed owner
read access independently of the browser. Account deletion and MFA are outside this change. The confirmed owner account
can review customer designs through the Customer designs tab after the owner
migration is applied.
Manage retention and backups in Supabase; availability and limits depend on the
plan you choose. The old empty local SQLite database is ignored and not deployed;
prior Node/SQLite source was archived outside the checkout during this migration.

`vendor/supabase.js` is the npm UMD distribution of
`@supabase/supabase-js@2.117.3`, installed with npm integrity verification.
The SDK loads locally without a CDN. See `vendor/README.md` and
`vendor/THIRD-PARTY-NOTICES.txt` for the checksum and licenses.

## Embedded 3D studio

Customize embeds the local 3D studio in a full-width iframe. The embedded studio is the only customization interface; old parent color,
nameplate, schematic-preview, and add-on controls have been removed. Extra studio materials, graphics,
and placements are retained in browser-session drafts and Supabase saved builds.
The Add-ons section includes storage drawer, swap panels, leg extensions, porch
awning, weather liner, ramp, bowl holder, and door flap, each with a 3D model part.
Enabled modules can be focused and highlighted from the option list. Add-on colors
are independently customizable and saved with the design. Older builds receive safe
default colors and load with all eight modules turned off. Displayed module prices
are estimates pending maker confirmation.
Older builds without studio data reset it to defaults. The studio price list sets the $349 base and option prices throughout review and
downloads. viewer/pricing.js is the single shared source for those prices. Three.js loads locally. See viewer/README.md
for source provenance. Run `NODE_PATH=/tmp/dogehouse-test-tools/node_modules node
tests/viewer.cjs` for rendering, syncing, add-on color changes, pricing, save/load, and legacy-state checks.

## Saved designs, previews, and owner review

Customers choose **Save design**, sign in, name their design, and save it. The
saved record contains version-2 studio state (colors, door/roof/floor choices,
wall graphics with exact positions/sizes, and all add-ons), contact/delivery
fields, the quoted item breakdown, and two JPEG previews generated from the
actual model. Review shows **Back and left** and **Front and right** at 640×480.
The capture uses fixed camera angles and an opaque roof, and preserves the live
camera, selection, and see-through setting. Previews are stored privately in the
existing JSON record, not in a public image bucket. Save can still succeed without
previews if WebGL is unavailable; that limitation is stated in the result.

**Saved builds** lists private saved copies with previews, total, and date. **Open in
3D** restores the full studio state and contact details. Existing version-1 designs
are supported; legacy combined neon/grass choices migrate to studio equivalents
and use current studio pricing. Old graphic-request notes are retained in the review questions rather than
inventing a new graphic. All new customization
happens in the studio.

Enable owner review:

1. Create and confirm `salesandinfo@thedogehouse.com` on the site (configure SMTP if
   delivery to this account is restricted by the default Supabase mail service).
2. Run [`supabase/owner-access.sql`](supabase/owner-access.sql) in Supabase SQL Editor.
   Its final query must return `salesandinfo@thedogehouse.com`. Zero rows means the
   account does not exist or is not confirmed; confirm it and rerun the script.
3. Sign out and back in with that account. Under **My builds**, open **Customer saved
   builds** to see saved designs and verified customer account emails. Both
   previews are shown; **Open in 3D** restores the design for inspection.

The owner flag comes from a private database table and a protected RPC, never
from browser config or editable user metadata. The owner can read customer
designs but cannot modify or delete their records. Other customers cannot list
one another's designs or grant themselves owner access. The UI tells customers
that saving makes their design available to the DogeHouse team for review.
Owner listing is paginated; it does not expose a public share link. Without the
migration, private customer saving still works, but the owner tab remains hidden.

Verification:

```sh
npm install --prefix /tmp/dogehouse-db-tests --cache /tmp/dogehouse-npm-cache --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.9
NODE_PATH=/tmp/dogehouse-db-tests/node_modules node tests/owner-access.cjs
```

This executes the actual schema and migration in PostgreSQL (PGlite) with auth
subject fixtures. It verifies confirmed-owner membership, repeatability, private
customer reads/deletes, owner read-only access, anonymous denial, denied privilege
escalation, and pagination. It does not replace real Supabase authentication or
testing the deployed owner account. Browser tests exercise the real SDK with
mocked service responses and verify thumbnail capture, saved previews, customer
and owner library UI, opening saved 3D designs, and mobile review layout.

## Ordered builds and order emails

**Saved builds** remain editable design copies. Submitting from Review now creates
an immutable **order request** with the studio settings, customer information,
server-calculated price, and both JPEG previews. No payment is collected; the
request awaits DogeHouse confirmation. Customers have separate **Saved builds**
and **Ordered builds** tabs. The confirmed owner has separate **Customer saved
builds** and **Customer ordered builds** tabs. Ordered designs can be reopened in
3D; deleting a saved design does not delete its order.

Enable ordering before publishing the updated site:

1. Run [`supabase/orders.sql`](supabase/orders.sql) in Supabase SQL Editor, after
   the existing schema and owner-access migrations. It can safely be rerun.
2. Create a [Resend account](https://resend.com), add `thedogehouse.com` under
   Domains, and add the DNS records Resend supplies at your domain's DNS provider.
   Wait for verification. Create an API key with sending access to this domain.
3. In Supabase **Edge Functions → Secrets**, enter these values securely:
   - `RESEND_API_KEY`: the Resend sending key.
   - `ORDER_EMAIL_FROM`: `DogeHouse <orders@thedogehouse.com>`.
   - `SITE_URL`: `https://dogehouse.netlify.app/` (or the actual custom-domain site).
   Do not paste API keys in chat or add them to browser configuration. Supabase
   automatically supplies the server-only database credentials to the function.
4. Deploy `submit-order` from this checkout:
   ```sh
   supabase login
   supabase functions deploy submit-order --project-ref lftpzfnzokjqgeteitul --no-verify-jwt --use-api
   ```
   Alternatively, after merging this change, create a Supabase personal access
   token in your account settings, save it as the GitHub repository Actions secret
   `SUPABASE_ACCESS_TOKEN`, and run **Deploy DogeHouse ordering** from Actions.
   Resend credentials stay in Supabase, not in the frontend. The deployment
   workflow is manual; ordinary site pushes do not redeploy this backend.
5. Publish the site and submit one test order yourself. Verify its two images in
   the business inbox, the customer's Ordered builds tab, and the owner's
   Customer ordered builds tab. Verify another customer cannot read it. Browser
   and local database tests do not prove live delivery.

Emails go to `salesandinfo@thedogehouse.com`, with both images as inline JPEG
attachments and a link to the ordered-build view. Reply-To uses the authenticated,
confirmed account email. The entered contact email is also included in the
message. Some mail clients block inline images until the recipient allows them;
the images remain attached. `sent` means Resend accepted the message, not proof
that it reached the inbox. This order-email integration does not configure
Supabase's separate authentication SMTP service.

The handler verifies every bearer token through Supabase Auth even though gateway
`verify_jwt` is disabled to support current signing keys. It recalculates pricing
from the same studio price file used by the viewer and limits payload size.
Direct order-table access is read-only for browser users; only the server can
insert orders. The protected owner management RPC can update status and progress
metadata without changing an order’s design or price. The default allowed browser origin is the origin of `SITE_URL`;
set `ALLOWED_ORIGINS` to a comma-separated list of exact origins if needed.

An order is saved before sending email. Missing email settings leave it queued;
provider failures leave it pending with **Retry email** available in the customer's
Ordered builds. Retries reuse the original order and previews. Atomic claims,
stable provider idempotency keys, five email attempts, and five new requests per
account per hour limit duplicate submissions and abuse. There is no automatic
background email queue or payment collection. Owner confirmation and fulfillment
controls are described below. Review pending
email statuses in the owner view and contact customers directly as needed.
Resend's idempotency window is finite; an ambiguous provider response followed by
an unusually delayed retry can still result in a duplicate notification.

Additional validation (Node 24 and Deno):

```sh
node tests/orders.cjs
NODE_PATH=/tmp/dogehouse-db-tests/node_modules node tests/orders-access.cjs
deno check supabase/functions/submit-order/index.ts
```

These exercise authenticated ordering, authoritative pricing, inline attachment
contents, input limits, safe HTML, provider failure/retry, concurrent email claims,
actual PostgreSQL policies, rate limiting and migration repeatability. Browser
checks also exercise submission retries using the same request ID and the separate
customer/owner views. No test sends a real email or places a live order.

## Latest studio port

The embedded studio follows dogehouse1 commit `395756d`: single/gable roofs,
undo/redo, editable/duplicated neon, fit estimation, improved mobile controls and
render recovery. **Save to account** opens the existing account library; **Review
and order** opens the existing two-thumbnail order flow. **Browser backups**
provide optional on-device saves, updates, automatic draft recovery and JSON
transfer. These backups stay on that device and are separate from cloud saved
builds and order records. Imported dogehouse1 backups can be loaded in the viewer,
then saved to an account. Fit measurements are planning advice and do not change
the model’s dimensions or quoted price.

Old saved builds default to single-slope roofs. The shared normalization clamps
graphics to each roof shape and server pricing matches the viewer. Deploy the
updated ordering function along with the site so gable designs are validated
correctly. No SQL migration or new credential is needed for this port.

Run `NODE_PATH=/tmp/dogehouse-test-tools/node_modules node tests/studio-updates.cjs`
for the new rendering, history, neon, fit, browser backup, account shortcut and
mobile-resize checks.

## Owner dashboard

Sign in as the confirmed `salesandinfo@thedogehouse.com` owner and choose
**Dashboard** in the header. `#dashboard` opens the dedicated page after verified
owner access is restored. Other users and signed-out visitors do not see the
page or its navigation and cannot request customer dashboard data.

The dashboard opens with order requests and includes a separate saved-build tab,
both design previews, verified account/contact details, fulfillment notes, order
and email status, and read-only actions to open a design in 3D or download its
JSON details. Totals are exact RLS-protected counts, not the current page length:
saved builds, order requests, awaiting confirmation, and emails needing attention.
Saved-build prices use current studio estimates; order prices use immutable stored
totals. Email sent means provider acceptance, not confirmed inbox delivery.

Access requires the existing protected owner RPC and a server-verified account
email. Auth changes immediately clear dashboard data and navigation; stale reads
are ignored using a session generation guard. Existing paginated owner RPCs and
row-level policies enforce the underlying customer data access. Run `supabase/order-management.sql` after the owner and order migrations to
enable the current dashboard controls. No new secret or Edge Function deployment
is required. The dashboard does not collect payments, delete customer records
or resend customer emails on the owner's behalf.

Run `NODE_PATH=/tmp/dogehouse-test-tools/node_modules node tests/owner-dashboard.cjs`
for real-SDK mocked browser checks of access denial, session restoration, exact
counts, paging/tabs and browser navigation, previews, escaped customer text,
opening/downloading designs, mobile layout, same-owner session re-verification,
failed server identity/count/record queries, recovery and sign-out while a
response is pending. The existing owner SQL
tests cover the actual underlying read-only policies.

## Quote approval, payment and fulfillment

`launch-hardening.sql` supersedes the original management/payment RPCs. **Approve final quote** is the only confirmation path. The owner enters the immutable final total including tax/shipping; `owner-order` authorizes the confirmed salesandinfo account and database membership, approves via the caller JWT, then sends a customer quote notification to the account email. Failed/unconfigured delivery is visible and can be retried. The dashboard returns approved total and payment state from the actual SQL function.

Customers pay from **Ordered builds**. Stripe receives the account email and distinct success/cancel return URLs. A redirect never marks payment paid; server reconciliation and signed webhooks do. Enable Stripe customer receipt emails in the correct test/live account settings and verify actual receipt delivery separately.

Owner cancellation expires known open Stripe sessions first; SQL blocks cancellation of paid/partially refunded orders or any remaining pending attempts. Refund in Stripe and wait for the verified full-refund update before cancelling. Missing/interrupted checkout sessions require reconciliation instead of blind cancellation. A late legacy payment on a cancelled order is recorded, restores confirmed status, and raises a dashboard review flag. Completed orders cannot be cancelled through this flow.

Fulfillment stages remain **Not started**, **In production**, **Ready**, **Completed**. All changes check versions; quote/payment updates invalidate stale dashboard tabs. Customer designs and original quotes remain immutable. General fulfillment changes do not currently send customer email.
