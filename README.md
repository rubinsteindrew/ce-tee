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

## Putting it live at ce-tee.com

GitHub Pages can't run this site (it only serves fixed pages, and this site has sign-in, an admin desk and
payments). Render runs it straight from your GitHub repo instead, and redeploys on every push.

1. **GitHub:** create a private repository and push this folder to it.
2. **Render** (render.com): sign in with GitHub, choose **New > Blueprint**, pick the repo. It reads
   `render.yaml` and creates the server with a 1 GB disk for accounts and trips (Starter plan, about $7/month
   plus a few cents for the disk). It generates `SESSION_SECRET` for you.
3. **Custom domain:** in the Render service, **Settings > Custom Domains**, add `ce-tee.com` and `www.ce-tee.com`.
   Render shows the exact DNS records to use.
4. **GoDaddy DNS** (My Products > ce-tee.com > DNS): add the records Render shows. Usually that is
   - an **A** record, name `@`, pointing to the IP Render gives you, replacing GoDaddy's default "Parked" A record, and
   - a **CNAME** record, name `www`, pointing to `your-service.onrender.com`.

   Leave your MX records alone so `@ce-tee.com` email keeps working. DNS can take a few minutes to a few hours;
   Render issues the HTTPS certificate on its own once it sees the records.
5. **Email (needed for admins):** create a free account at resend.com, add the domain `ce-tee.com`, and add the
   DNS records Resend shows to GoDaddy as well. Then put the API key in Render as `RESEND_API_KEY`.
6. **First admin:** sign up at `https://ce-tee.com/account` with your `@ce-tee.com` email, click the link in the
   confirmation email, and the Admin link appears.

After that, every `git push` updates the live site in about a minute.

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
