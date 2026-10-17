# Isolated DogeHouse staging

Status: setup code prepared and locally tested; hosted resources NOT created.
This branch depends on the explicit-origin fix in PR #15. Nothing here authorizes a production release.

## Isolation boundary

Use one NEW Supabase project named `DogeHouse Staging`, one separate Netlify site, and a Stripe sandbox with its own test keys and webhook destination. Use synthetic builds/orders only. Do not clone customer/auth records or copy production secrets. Verify account/project identity before every administrative action. Check project cost/quota in the service UI before accepting paid resources; no paid provisioning is authorized by this guide.

The suggested Netlify name is `dogehouse-staging`; availability is not verified. Substitute the actual assigned origin everywhere below. A separate Netlify site keeps its stable test origin and build configuration independent from the existing production site. Its Netlify “production” deploy context means only this test site's primary branch, not DogeHouse production.

## 1. Create the isolated database

In Supabase, create the NEW project in the intended organization. Save its reference and project URL. It must NOT be `lftpzfnzokjqgeteitul`. Store its database password privately, never in GitHub issues or chat.

In the new project's SQL editor only, run these repository files in order:

1. supabase/schema.sql
2. supabase/owner-access.sql
3. supabase/orders.sql
4. supabase/order-management.sql
5. supabase/payments.sql

These reproduce the current schema, including known payment visibility/confirmation/cancellation defects. They do not fix those defects. The full customer acceptance test must pass the follow-up corrections before a production release.

Create a NEW confirmed staging Auth user for salesandinfo@thedogehouse.com; the current application requires this exact owner identity. Use a distinct staging password. Add only that new project's user ID to dogehouse_owners after checking it in Auth Users. Never copy the production user's UUID. The safe lookup for a manually confirmed staging owner is:

```sql
insert into public.dogehouse_owners(user_id)
select id from auth.users
where lower(email)='salesandinfo@thedogehouse.com'
  and email_confirmed_at is not null
on conflict do nothing;
```

Create two test customer accounts using inboxes/aliases you control and synthetic names. Do not invent deliverable example.com inboxes. Keep email confirmation on so the tested auth path matches production. Without SMTP, confirm what Supabase's default email service permits before claiming sign-up email works. Manual user confirmation is acceptable for initial backend tests, but does not validate email delivery.

## 2. Create the separate test frontend

Create a NEW Netlify site attached to bcreedh2002/dogehouse2. Choose `setup/isolated-staging` as this site's branch. Keep the existing dogehouse.netlify.app site and its main branch untouched. Configure:

- Build command: python3 scripts/prepare-staging.py
- Publish directory: _site
- Builds environment variables on THIS NEW SITE:
  - STAGING_SUPABASE_URL = the new project's https://REF.supabase.co URL
  - STAGING_SUPABASE_PUBLISHABLE_KEY = the new project's public publishable key
  - STAGING_SITE_URL = the actual new HTTPS Netlify site origin, no path

Do not put Supabase service-role keys, Stripe secrets, webhook secrets, Resend secrets or management tokens into frontend build variables. The build guard requires explicit staging configuration and rejects the known production project/origins; the existing public-asset staging function rejects secret/service-role keys and only copies public assets. It cannot prove an opaque publishable key belongs to the supplied project; verify that pairing in Supabase.

Deploy only the new test site. Confirm the yellow test banner, noindex response header, account-config.js contains the new project URL, and browser network requests target the new project. noindex is not authentication; use synthetic records and consider Netlify access protection if available. Do not enter production account passwords on staging.

## 3. Align staging authentication and Edge secrets

On the NEW Supabase project's Auth URL configuration:

- Site URL: actual staging HTTPS origin + `/`
- Additional exact redirect URLs: origin + `/` and origin + `/dogehouse-launch.html`

accounts.js generates emailRedirectTo/redirectTo from location.origin + location.pathname, so both entry paths need coverage. Confirm sign-up and password recovery land back on staging. No production or wildcard preview redirects are needed.

On the NEW project's Edge Function secrets only:

| Setting | Staging value |
|---|---|
| SITE_URL | Actual staging origin + /dogehouse-launch.html |
| ALLOWED_ORIGINS | Actual staging HTTPS origin only |
| STRIPE_LIVE_MODE | false |
| STRIPE_SECRET_KEY | Sandbox's sk_test_ key, entered privately |
| STRIPE_WEBHOOK_SECRET | New staging destination's signing secret, entered privately |

Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to hosted functions; never replace them with production values. Initially leave RESEND_API_KEY and ORDER_EMAIL_FROM unset: orders can queue owner notification without sending real email. This initial setup does not validate notifications. Current owner notification recipient is hardcoded to salesandinfo@thedogehouse.com; use a separately reviewed email sink/recipient guard before enabling automated staging mail.

## 4. Configure sandbox payments and deploy test functions

In Stripe select/create a sandbox. Verify every key is a test key and all objects/events are sandbox objects. Add destination:

https://STAGING_PROJECT_REF.supabase.co/functions/v1/stripe-webhook

Subscribe to checkout.session.completed, checkout.session.expired, charge.refunded using snapshot events and API version 2024-06-20 as used by the adapter. Set its signing secret in the NEW Supabase project. Stripe dashboard capabilities/API-version choices should be verified at setup time.

Deploy submit-order, pay-order and stripe-webhook only to that NEW project. If using the CLI, supply its actual `--project-ref` explicitly on each command and check it is not the production ref above. Do not use the repository's existing deploy-order/deploy-payments workflows: they hardcode the PRODUCTION project. Do not run `supabase db push` against an existing linked project.

```sh
supabase functions deploy submit-order --project-ref STAGING_PROJECT_REF --no-verify-jwt --use-api
supabase functions deploy pay-order --project-ref STAGING_PROJECT_REF --no-verify-jwt --use-api
supabase functions deploy stripe-webhook --project-ref STAGING_PROJECT_REF --no-verify-jwt --use-api
```

STAGING_PROJECT_REF is a placeholder to replace with the observed new project reference. Edge handlers perform their own user-token or webhook-signature validation.

## 5. Acceptance evidence

Record commit, actual frontend origin, Supabase project reference and Stripe sandbox name (no keys). Then follow docs/ordering-review-2026-10-17.md release/test gates: both CORS preflights, sign-up/recovery, save and mobile previews, submit/retry, owner approval with amount, second-account isolation, test-card checkout, webhook persistence/retry, expiry/cancellation races, partial/full refunds, owner/customer payment display. Use 4242 4242 4242 4242 only with test keys, future expiry and synthetic details. Verify livemode=false on Stripe events. No real card or live charge is part of this setup.

Do not mark the setup complete simply because the site loads. Known P1 defects can be reproduced safely here, fixed on reviewed branches, and tested before Bryce decides on production release.

## References

- https://supabase.com/docs/guides/auth/redirect-urls
- https://docs.netlify.com/deploy/deploy-overview/
- https://docs.netlify.com/build/environment-variables/overview/
- https://docs.stripe.com/testing
