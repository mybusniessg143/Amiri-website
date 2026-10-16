# Deploying to Cloudflare (Workers static assets)

Target: **£0 fixed monthly hosting**. Cloudflare's free plan covers a static site like this one. Your only fixed cost is the domain renewal. Check cloudflare.com/plans for current limits.

> **Which Cloudflare product?** This repository is set up as a **Cloudflare Worker with static assets** called `amiri-website` (see `wrangler.jsonc`). It serves the built `dist/` folder and has no server code. Earlier versions of this guide described Cloudflare **Pages**; both work for a static site, but use **one**, not both. If you already have the `amiri-website` Worker connected to GitHub, keep it and do **not** create a separate Pages project, or you will have two copies of the site.

> ⚠️ **Read [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) before step 4.** The domain already runs Google Workspace email. A careless nameserver change can stop email arriving.

Cloudflare's dashboard labels change from time to time. If a menu name below differs slightly, look for the equivalent option.

---

## Step 1 – Put the code on GitHub

1. Create a free account at github.com (if you don't have one).
2. Create a new **private** repository, e.g. `amiri-website`. Don't add a README (we have one).
3. Upload this folder. Easiest: install **GitHub Desktop** → File → Add local repository → choose this folder → "Publish repository".
   `dist/` is ignored on purpose; Cloudflare builds it.

## Step 2 – Create (or check) the Cloudflare Worker

1. Create a free account at dash.cloudflare.com.
2. **Workers & Pages → Create → Import a repository** (Workers Builds). Authorise GitHub and pick `Amiri-website`. If the `amiri-website` Worker already exists, open it → **Settings → Build** and check the values below instead.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Project / Worker name | `amiri-website` (must match `name` in `wrangler.jsonc`) |
   | Production branch | `main` |
   | Build command | `node build.js` |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` (gives each branch a preview address) |
   | Root directory | *(leave blank)* |
   | Environment variable (optional) | `NODE_VERSION` = `22` |

4. **Save and Deploy.** You get a free address like `amiri-website.<your-subdomain>.workers.dev`. Test everything there first (see LAUNCH_CHECKLIST.md).

Every push to `main` deploys automatically. Pushes to other branches upload a **preview version** with its own address, a safe way to try changes. `wrangler.jsonc` sends unknown addresses to the site's own `404.html`.

## Step 3 – Security headers

`static/_headers` is copied to the site root and Cloudflare applies it automatically (Workers static assets and Pages both read `_headers`). It sets:

| Header | Purpose |
|---|---|
| Content-Security-Policy | Only allows scripts/styles/images from this site (+ Cloudflare Web Analytics). Blocks injected scripts. |
| Strict-Transport-Security | Browsers always use HTTPS. |
| X-Content-Type-Options: nosniff | Stops file-type guessing attacks. |
| X-Frame-Options: DENY / frame-ancestors 'none' | Stops the site being embedded in other sites (clickjacking). |
| Referrer-Policy: strict-origin-when-cross-origin | Doesn't leak full page addresses to other sites. |
| Permissions-Policy | Turns off camera, microphone, location etc. – the site doesn't need them. |

Check them after launch at securityheaders.com.

If you later add something from another domain (a map, YouTube video, a chat API on another domain), add that domain to the matching CSP directive in `static/_headers`, or it will be blocked.

## Step 4 – Connect the custom domain

A Worker custom domain needs the domain's DNS to be managed by Cloudflare. That means moving the nameservers to Cloudflare.

1. **Complete [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) sections A–D first.**
2. Once the domain shows **Active** in Cloudflare: Workers & Pages → `amiri-website` → **Settings → Domains & Routes → Add → Custom domain** → enter `amiribuildingservices.com` → Add. Cloudflare creates the record for the website only. It does **not** touch MX or TXT records.
3. Repeat for `www.amiribuildingservices.com`.
4. Make `www` redirect to the root domain (one canonical address, good for SEO): **your domain → Rules → Redirect Rules → Create rule** – *Wildcard pattern* / template "Redirect from WWW to root": request URL `https://www.amiribuildingservices.com/*` → target `https://amiribuildingservices.com/${1}`, status **301**, preserve query string.
5. **SSL/TLS → Overview:** mode **Full (strict)**. **SSL/TLS → Edge Certificates:** turn on **Always Use HTTPS**.
6. Wait for the certificate (usually minutes), then open https://amiribuildingservices.com.

**Important:** before step 2, if an old website exists (e.g. A records pointing to a previous host), Cloudflare will ask to replace that record. That is fine for the website record. Never delete MX, TXT (SPF/DKIM/DMARC/verification) or mail-related CNAME records.

## Step 5 – Cloudflare Web Analytics (cookie-free)

Once the custom domain works: **Analytics & Logs → Web Analytics → Add a site** → `amiribuildingservices.com`. If Cloudflare offers automatic setup for the proxied domain, use it; otherwise copy the site token into `analytics.cloudflareWebAnalyticsToken` in site.config.json and push. Use one method, not both. No cookies, no consent banner needed.

Do **not** add Google Analytics, Meta Pixel, TikTok Pixel or other trackers without a proper consent mechanism (see PRIVACY_REVIEW_CHECKLIST.md).

## Step 6 – Google Search Console

1. search.google.com/search-console → Add property → **Domain** → `amiribuildingservices.com`.
2. Google gives you a TXT record. Add it in Cloudflare DNS (**add** it, don't replace existing TXT records). If a Google verification TXT record already exists from Workspace, keep it too.
3. Verify, then **Sitemaps → submit** `https://amiribuildingservices.com/sitemap.xml`.
4. Use **URL Inspection** on the homepage and "Request indexing".

## Updating the site

Edit → commit → push. Cloudflare rebuilds and deploys in about a minute. Watch progress under Workers & Pages → `amiri-website` → Deployments. If a build fails, the previous version stays live and the build log shows the error (usually a typo in a page header or config file).

## Rolling back

1. Workers & Pages → `amiri-website` → **Deployments**.
2. Find the last good version → **⋯ → Rollback** (Pages: **Rollback to this deployment**).
3. Then fix or revert the bad commit in GitHub, otherwise the next push re-publishes it.

## Optional extras (still £0)

- **Cloudflare Turnstile** (free CAPTCHA alternative): for any future server-side form or chat endpoint.
- **Cloudflare Email Routing**: not needed – your email stays with Google Workspace. Don't enable it, as it would replace your MX records.
- **Worker code**: the free allowance covers the future AI receptionist's light traffic. See AI_RECEPTIONIST_PLAN.md.
