# Deploying to Cloudflare Pages

Target: **£0 fixed monthly hosting**. Cloudflare Pages' free plan covers static sites like this one (unlimited static requests and bandwidth, a monthly build allowance far above what this site needs). Your only fixed cost is the domain renewal. Check cloudflare.com/plans for current limits.

> ⚠️ **Read [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) before step 4.** The domain already runs Google Workspace email. A careless nameserver change can stop email arriving.

Cloudflare's dashboard labels change from time to time. If a menu name below differs slightly, look for the equivalent option.

---

## Step 1 – Put the code on GitHub

1. Create a free account at github.com (if you don't have one).
2. Create a new **private** repository, e.g. `amiri-website`. Don't add a README (we have one).
3. Upload this folder. Easiest: install **GitHub Desktop** → File → Add local repository → choose this folder → "Publish repository".
   `dist/` is ignored on purpose; Cloudflare builds it.

## Step 2 – Create the Cloudflare Pages project

1. Create a free account at dash.cloudflare.com.
2. **Workers & Pages → Create → Pages → Connect to Git.** Authorise GitHub and pick the repository.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | `node build.js` |
   | Build output directory | `dist` |
   | Root directory | *(leave blank)* |
   | Environment variable (optional) | `NODE_VERSION` = `22` |

4. **Save and Deploy.** After about a minute you get a free address like `amiri-website.pages.dev`. Test everything there first (see LAUNCH_CHECKLIST.md).

Every push to `main` now deploys automatically. Pushes to other branches create **preview deployments** with their own URL, which is a safe way to try changes.

> Cloudflare is also promoting "Workers with static assets" as an alternative to Pages. Either works for this site; Pages is the simpler choice and is what this guide uses.

## Step 3 – Security headers

`static/_headers` is copied to the site root and Cloudflare Pages applies it automatically. It sets:

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

Cloudflare Pages can only attach the **root domain** (`amiribuildingservices.com`, without www) when the domain's DNS is managed by Cloudflare. That means moving the nameservers to Cloudflare.

1. **Complete [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) sections A–D first.**
2. Once the domain shows **Active** in Cloudflare: Workers & Pages → your project → **Custom domains → Set up a custom domain** → enter `amiribuildingservices.com` → Continue → Activate. Cloudflare creates the needed record for the website only. It does **not** touch MX or TXT records.
3. Repeat for `www.amiribuildingservices.com`.
4. Make `www` redirect to the root domain (one canonical address, good for SEO): **your domain → Rules → Redirect Rules → Create rule** – *Wildcard pattern* / template "Redirect from WWW to root": request URL `https://www.amiribuildingservices.com/*` → target `https://amiribuildingservices.com/${1}`, status **301**, preserve query string.
5. **SSL/TLS → Overview:** mode **Full (strict)**. **SSL/TLS → Edge Certificates:** turn on **Always Use HTTPS**.
6. Wait for the certificate (usually minutes), then open https://amiribuildingservices.com.

**Important:** before step 2, if an old website exists (e.g. A records pointing to a previous host), Cloudflare will ask to replace that record. That is fine for the website record. Never delete MX, TXT (SPF/DKIM/DMARC/verification) or mail-related CNAME records.

## Step 5 – Cloudflare Web Analytics (cookie-free)

Workers & Pages → your project → **Metrics → Web Analytics → Enable**. Cloudflare adds its small beacon automatically on the next deployment. No cookies, no consent banner needed. (Alternative: create a site under Analytics & Logs → Web Analytics and put the token in `analytics.cloudflareWebAnalyticsToken` in site.config.json. Use one method, not both.)

Do **not** add Google Analytics, Meta Pixel, TikTok Pixel or other trackers without a proper consent mechanism (see PRIVACY_REVIEW_CHECKLIST.md).

## Step 6 – Google Search Console

1. search.google.com/search-console → Add property → **Domain** → `amiribuildingservices.com`.
2. Google gives you a TXT record. Add it in Cloudflare DNS (**add** it, don't replace existing TXT records). If a Google verification TXT record already exists from Workspace, keep it too.
3. Verify, then **Sitemaps → submit** `https://amiribuildingservices.com/sitemap.xml`.
4. Use **URL Inspection** on the homepage and "Request indexing".

## Updating the site

Edit → commit → push. Cloudflare rebuilds and deploys in about a minute. Watch progress under Workers & Pages → project → Deployments. If a build fails, the previous version stays live and the build log shows the error (usually a typo in a page header or config file).

## Rolling back

1. Workers & Pages → project → **Deployments**.
2. Find the last good production deployment → **⋯ → Rollback to this deployment**.
3. Then fix or revert the bad commit in GitHub, otherwise the next push re-publishes it.

## Optional extras (still £0)

- **Cloudflare Turnstile** (free CAPTCHA alternative): for any future server-side form or chat endpoint.
- **Cloudflare Email Routing**: not needed – your email stays with Google Workspace. Don't enable it, as it would replace your MX records.
- **Pages Functions / Workers**: the free allowance covers the future AI receptionist's light traffic. See AI_RECEPTIONIST_PLAN.md.
