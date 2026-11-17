# CE & Tees

Golf trips with dental continuing education: tournament-style golf by day, CE courses at night.
One small Node server with no packages to install.

## Run it on your computer

```bash
node server.js
```

Open http://localhost:4173. Settings live in `.env` (never commit it).

| Page | Address |
|---|---|
| Home: short intro and upcoming classes | `/` |
| A sample day | `/day` |
| The CE and the course catalog | `/ce` |
| All trips, what's included, questions, reserving | `/trips` |
| Sign in, create account, my trips | `/account` |
| Admin desk | `/admin` |

## Accounts and admin

- Anyone can create an account at `/account`. Reserving a trip needs an account.
- Admin access is automatic for any account whose email ends in `@ce-tee.com` **and has been confirmed**
  through the emailed link. Nobody else can open `/admin`, even if they sign up with a made-up
  `@ce-tee.com` address, because they can't receive the confirmation email.
- In the admin desk you can add, edit, duplicate, archive and restore trips, and see reservations and members.
  Archived trips come off the website but are kept with their reservations. Only an archived trip with no
  reservations can be deleted.
- The domain is set by `ADMIN_DOMAIN` (default `ce-tee.com`).

Until `RESEND_API_KEY` is set, emails (confirmation links, password resets) are printed in the server log
instead of being sent. Locally that is your terminal; on Render it is the service's **Logs** tab.

## How ce-tee.com is hosted (GitHub Pages)

- Every push to `main` runs `.github/workflows/pages.yml`, which publishes `public/` to GitHub Pages in about a
  minute. Watch it under the repo's **Actions** tab.
- Trips on the live site come from `data/trips.sample.json`. To add, change or hide a trip, edit that file
  (`"status": "archived"` or `"draft"` hides one) and push.
- GitHub Pages only serves files, so the account pages, the admin desk and online booking are switched off there,
  and the Reserve button says "Online reservations open soon". They work when the site runs on a server
  (`node server.js` locally, or a host like Render using `render.yaml`), or once a hosted backend such as
  Supabase is connected.
- DNS at GoDaddy: four **A** records for `@` (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153)
  and a **CNAME** `www` pointing to `rubinsteindrew.github.io`. The Microsoft 365 email records (MX, autodiscover,
  SPF, DMARC, DKIM) are separate; leave them alone.
- HTTPS: once GitHub has issued the certificate, tick **Enforce HTTPS** in the repo's Settings > Pages.

## Running the full version on a server instead

`render.yaml` sets up Render (about $7/month) with accounts, the admin desk and booking. To switch, create the
service from the repo (**New > Blueprint**), add `ce-tee.com` as a custom domain there, and point the GoDaddy
records at Render instead of GitHub. Admin emails also need an email service (for example Resend, `RESEND_API_KEY`).

## Turning on Stripe deposits

1. Add `STRIPE_SECRET_KEY` in Render (use a test key `sk_test_…` first).
2. In Stripe, add a webhook to `https://ce-tee.com/api/stripe/webhook` for `checkout.session.completed`
   and put its signing secret in `STRIPE_WEBHOOK_SECRET`. This is what marks a spot as taken after payment.

Until a key is set the site runs in preview mode: reserving works end to end but no card is charged.

## Where things live

| What | Where |
|---|---|
| Pages | `public/*.html` |
| Look and feel | `public/styles.css` |
| Page behaviour and animation | `public/app.js`, `public/account.js` |
| Server, accounts, admin rules, payments | `server.js` |
| Trips, accounts, reservations (live data, not in git) | `data/` locally, the Render disk when live |
| Starting trips for a brand-new server | `data/trips.sample.json` |
| Photos (also offered in the admin photo picker) | `public/img/` |

Course photos come from dormienetwork.com. Get Dormie Network's permission before the site goes public.
