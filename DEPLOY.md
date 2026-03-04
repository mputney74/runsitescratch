# RunSiteScratch — Deployment Guide

## Prerequisites
- GitHub account
- Vercel account (vercel.com — free tier is fine)
- Railway server already running at `runsitescratch-server-production.up.railway.app`
- `runsitescratch.com` domain secured

---

## Step 1 — Push to GitHub

```bash
cd runsitescratch-deploy
git init
git add .
git commit -m "Initial deploy — Session 13"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/runsitescratch.git
git push -u origin main
```

---

## Step 2 — Deploy to Vercel

1. Go to **vercel.com** → New Project
2. Import your `runsitescratch` GitHub repo
3. Vercel auto-detects Vite — confirm these settings:
   - **Framework:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
4. Click **Deploy**

First deploy takes ~60 seconds.

---

## Step 3 — Connect runsitescratch.com domain

1. In Vercel project → **Settings → Domains**
2. Add `runsitescratch.com` and `www.runsitescratch.com`
3. Vercel gives you DNS records — add them at your registrar:
   - `A` record: `@` → Vercel IP (shown in dashboard)
   - `CNAME` record: `www` → `cname.vercel-dns.com`
4. SSL is automatic — Vercel provisions it within minutes

---

## Step 4 — Update Railway environment variables

In Railway dashboard → your server service → Variables:

```
CLIENT_URL=https://runsitescratch.com
CORS_ORIGIN=https://runsitescratch.com,https://www.runsitescratch.com
```

**This is the most important step.** This fixes the Stripe redirect so it lands
on `https://runsitescratch.com/report/:orderId?paid=true` — a real URL.

Railway will auto-redeploy when you save env vars.

---

## Step 5 — Update Stripe webhook (if needed)

In Stripe Dashboard → Developers → Webhooks:
- Confirm webhook endpoint is `https://runsitescratch-server-production.up.railway.app/api/webhook/stripe`
- This does NOT need to change — webhooks go to Railway, not Vercel

For production payments:
- Switch from `sk_test_...` to `sk_live_...` in Railway
- Update `STRIPE_WEBHOOK_SECRET` to the live webhook secret

---

## Step 6 — Verify end-to-end

1. Visit `https://runsitescratch.com`
2. Complete a test order
3. Pay with Stripe test card `4242 4242 4242 4242`
4. Confirm redirect lands on `runsitescratch.com/report/...`
5. Confirm report generates and displays

---

## Local Development

```bash
npm install
npm run dev
```

Runs on `http://localhost:3000`. API calls proxy to Railway automatically
via `vite.config.js` — no CORS issues in dev.

To test without Stripe (local pipeline mode):
In `src/RunSiteScratch_Platform.jsx`, set `USE_SERVER = false`

---

## File Structure

```
runsitescratch-deploy/
├── public/
│   ├── favicon.svg        # Site favicon
│   └── robots.txt         # SEO — blocks /report/ from indexing
├── src/
│   ├── main.jsx           # React entry point
│   └── RunSiteScratch_Platform.jsx   # Full app (all-in-one)
├── index.html             # HTML shell with meta tags
├── vite.config.js         # Build config + dev proxy
├── vercel.json            # SPA routing + security headers
├── package.json           # Dependencies
└── .gitignore
```

---

## Session 13 Railway Env Vars (current)

| Variable | Current Value | After Deploy |
|----------|--------------|--------------|
| `CLIENT_URL` | `http://localhost:3000` | `https://runsitescratch.com` |
| `CORS_ORIGIN` | `*` | `https://runsitescratch.com,https://www.runsitescratch.com` |
| `ANTHROPIC_API_KEY` | ✅ set | no change |
| `STRIPE_SECRET_KEY` | ✅ set (test) | switch to live for production |
| `STRIPE_WEBHOOK_SECRET` | ✅ set | no change (or update for live) |
| `DB_PATH` | `/app/data/orders.db` | no change |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | no change |
