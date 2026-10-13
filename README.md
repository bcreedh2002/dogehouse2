# DogeHouse: GitHub Pages + Supabase

The site remains static. Supabase provides email/password authentication,
confirmation and password-reset emails, and private saved doghouse builds.
There is no custom application server or SQLite dependency.

## One-time launch setup

1. Create a Supabase project. In its SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
   It creates `dogehouse_builds`, enables row-level security, and permits users to
   read, save, and delete builds owned by their authenticated account. The optional
   owner migration below adds read-only access for the DogeHouse team.
2. Copy the Project URL and **publishable key** from the Supabase project settings
   (a legacy **anon** key also works). These are public browser settings.
   Never use a secret or service-role key; those bypass database access controls.
3. This checkout's `account-config.js` already contains the public settings you
   provided for `lftpzfnzokjqgeteitul.supabase.co`. Commit it with the site; no
   GitHub secret is needed. Optionally override them with repository Variables
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` under **Settings → Secrets and
   variables → Actions → Variables**.
4. In **Settings → Pages**, select **GitHub Actions** as the source. Push the
   prepared site files and workflow to `main`, or run **Publish DogeHouse site**
   manually from the Actions tab after the files are on GitHub.
5. The default project site will be `https://bcreedh2002.github.io/dogehouse2/`
   unless you use a custom domain. In Supabase **Authentication → URL Configuration**,
   set that address as **Site URL** and add both that address and
   `https://bcreedh2002.github.io/dogehouse2/dogehouse-launch.html` to **Redirect URLs**.
   If using a custom domain, configure its equivalent URLs instead.
6. Enable Email authentication and keep **Confirm email** enabled. Configure custom
   SMTP for public customer use; Supabase's default mail service has recipient and
   rate restrictions. Without a suitable mail provider, customer signup and
   password recovery cannot be treated as ready for launch.
7. Test confirmation, password recovery, and saved builds with two separate accounts.
   Verify each account can only list/delete its own builds, including direct REST
   requests. Also verify anonymous requests cannot read or insert builds. Do not
   advertise account saving as live before completing these checks.

The workflow publishes only explicitly staged public assets. It does not upload
`.data`, `.git`, tests, or repository files. Deployment fails when public Supabase
settings are missing or contain a secret/service-role key. Source changes and
GitHub Pages publication are separate; preparing the workflow does not publish it.

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

Install browser tooling outside the checkout and run:

```sh
npm install --prefix /tmp/dogehouse-test-tools --cache /tmp/dogehouse-npm-cache --no-audit --no-fund playwright@1.56.1
NODE_PATH=/tmp/dogehouse-test-tools/node_modules node tests/accounts.cjs
python3 tests/pages.py
python3 scripts/check-supabase.py
```

Browser tests default to `http://127.0.0.1:8000/dogehouse-launch.html`; override
`DOGEHOUSE_TEST_URL` and `DOGEHOUSE_CHROMIUM` as needed. They exercise the real
vendored Supabase SDK with mocked HTTPS service responses. They cover account
confirmation, sign-in, saving/opening/deleting builds, failed requests, session
restoration, password recovery, and mobile layout. **They do not prove live
Supabase configuration, email delivery, or database isolation.** The launch checks
above remain required. `scripts/check-supabase.py` performs read-only checks on
the configured project: Email/signup availability, confirmation settings, and
anonymous table access denial. It neither creates accounts nor sends mail.
The staging tests verify the deployment artifact excludes
private files and rejects unsuitable configuration.

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

Customize embeds a local copy of dogehouse1 in a full-width iframe. The embedded studio is the only customization interface; old parent color,
nameplate, schematic-preview, and add-on controls have been removed. Extra studio materials, graphics,
and placements are retained in browser-session drafts and Supabase saved builds.
Older builds without studio data reset it to defaults. The studio price list sets the $349 base and option prices throughout review and
downloads. viewer/pricing.js is the single shared source for those prices. Three.js loads locally. See viewer/README.md
for source provenance. Run `NODE_PATH=/tmp/dogehouse-test-tools/node_modules node
tests/viewer.cjs` for rendering, syncing, and saved-state checks.

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

**My designs** lists private saved copies with previews, total, and date. **Open in
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
3. Sign out and back in with that account. Under **My builds**, open **Customer
   designs** to see saved designs and verified customer account emails. Both
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
