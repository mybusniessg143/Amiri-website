# Amiri Building Services – website

The website for **AMIRI BUILDING SERVICES LTD** (amiribuildingservices.com).

- Plain HTML, CSS and vanilla JavaScript. No framework, no website builder, no subscription.
- You own every file. It can be hosted anywhere that serves static files (Cloudflare Pages, Netlify, GitHub Pages, any web host).
- One small build script (`build.js`, no dependencies, needs only Node.js) puts the shared header, footer and business details into every page.

> **Before launch:** work through [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md). Several items (credentials, reviews, hours, prices, photos, legal wording) are deliberately left as labelled placeholders because they must come from you.

---

## 1. Project structure

```
amiri-website/
├── site.config.json        ← ALL business details (phone, email, areas, hours, socials, flags)
├── build.js                ← builds the site into dist/ (node build.js)
├── package.json            ← shortcuts: npm run build / npm run serve (no dependencies)
├── src/
│   ├── layout.html         ← page skeleton used by every page
│   ├── photos.json         ← list of work photos (empty = labelled placeholder)
│   ├── partials/           ← reusable blocks: header, footer, mobile bar, enquiry form, reviews…
│   └── pages/              ← one file per page – edit the TEXT here
│       ├── index.html                  → /
│       ├── electrical.html             → /electrical/
│       ├── emergency-electrician.html  → /emergency-electrician/
│       ├── plumbing.html               → /plumbing/
│       ├── emergency-plumbing.html     → /emergency-plumbing/
│       ├── property-maintenance.html   → /property-maintenance/
│       ├── landlords-commercial.html   → /landlords-commercial/
│       ├── areas.html                  → /areas/
│       ├── about.html                  → /about/
│       ├── contact.html                → /contact/
│       ├── privacy.html                → /privacy/
│       ├── terms.html                  → /terms/
│       └── 404.html                    → /404.html
├── assets/
│   ├── css/styles.css      ← all styling (colours at the top)
│   ├── js/main.js          ← mobile menu + WhatsApp/email enquiry form
│   ├── js/chat.js          ← future AI chat UI (only loaded when enabled)
│   ├── icons/sprite.svg    ← all icons
│   └── images/             ← logo, social share image, work/ photos
├── static/                 ← copied to the site root: favicons, _headers (security headers)
└── dist/                   ← GENERATED website. Don't edit – it is rebuilt every time.
```

Generated automatically into `dist/`: every page, `sitemap.xml`, `robots.txt`, `site.webmanifest`, JSON-LD structured data and `assets/js/config.js`.

## 2. Previewing on your computer

1. Install Node.js (LTS version) from nodejs.org.
2. In this folder run:
   ```
   node build.js --serve
   ```
3. Open http://localhost:8080. After editing, stop it (Ctrl+C) and run the command again.

## 3. Editing business details

Open `site.config.json`. Change the value, save, rebuild. It updates every page, the footer, the structured data and the sitemap at once.

| To change… | Edit in site.config.json |
|---|---|
| Phone number | `phone.display`, `phone.international`, `phone.tel` |
| WhatsApp number (e.g. a new WhatsApp Business number) | `whatsapp.number` (digits only, starting 44) |
| Public email | `email.public` |
| Areas | `areas.core`, `areas.secondary` |
| Emergency/availability wording | `availability.emergencyText`, `availability.generalText` |
| Opening hours | set `hours.confirmed` to `true`, fill `hours.displayText` and `hours.openingHoursSpecification` |
| Credentials (ECS card, insurance, qualifications…) | `credentials` – fill `value` and set `verified: true` **only when you can prove it** |
| Reviews | `reviews` – add genuine reviews only (format is in the file) |
| Google review link | `googleReviewUrl` |
| Google Business Profile link | `googleBusinessProfileUrl` |
| Instagram / Facebook / TikTok / YouTube | `social.*` |
| Hide all "owner to add" placeholder boxes | `showPlaceholders: false` |
| AI chat on/off | `aiChat.enabled` (keep `false` until the back end is live) |

**Never put passwords or API keys in this file** – it is public.

## 4. Editing page text

Open the page in `src/pages/` in any text editor (VS Code is free and good). Change the words between the tags, e.g.

```html
<p>Local, dependable help for homes, landlords…</p>
```

- The block at the very top (`<!--page { … } -->`) holds the page's **title**, **meta description** (what Google shows), breadcrumb name and FAQs. Keep it valid JSON: quotes around text, commas between items.
- Things in double curly brackets, like `{{phone.display}}`, are filled in from `site.config.json`. Leave them as they are.
- `{{> enquiry-form}}` inserts a shared block from `src/partials/`.
- Text between `{{#placeholders}}` and `{{/placeholders}}` only shows while `showPlaceholders` is `true`.

If you make a mistake, `node build.js` stops and tells you which file and token is wrong.

## 5. Adding real work photos

1. Resize the photo to about **1200 px wide** and save as **WebP** (free tools: squoosh.app). Aim for under 200 KB.
2. Put it in `assets/images/work/`, e.g. `consumer-unit-hayes.webp`.
3. In `src/photos.json`, find the matching entry and fill it in:
   ```json
   "consumer-unit": { "src": "/assets/images/work/consumer-unit-hayes.webp", "width": 1200, "height": 900,
                      "alt": "New consumer unit fitted in a house in Hayes", "label": "Consumer unit replacement" }
   ```
   `width`/`height` must be the real pixel size (prevents the page jumping while loading).
4. Rebuild. The placeholder is replaced everywhere that photo appears.

Only use photos of your own work. Avoid showing house numbers, faces or anything that identifies a customer without their permission.

### Website pictures (stock placeholders)

The large pictures on the homepage (hero, service cards, emergency, areas and so on) are **free Unsplash stock photos**, listed in `src/images.json` and credited in `IMAGE_CREDITS.md`. They are illustrative only and are never presented as our own jobs.

To change one, edit its `src` in `src/images.json`:
- **Another Unsplash photo:** open the photo on unsplash.com, right-click the image, choose "Copy image address", and paste the part up to the `?` (it starts `https://images.unsplash.com/photo-`). The build adds the right sizes automatically.
- **Your own photo:** put it in `assets/images/site/` (WebP, about 1600 px wide) and set `src` to e.g. `/assets/images/site/hero.webp`, with `width` and `height` set to its real size.

Then update `alt` (a short description of the picture) and rebuild. If every picture becomes a local file, you can remove `https://images.unsplash.com` from `img-src` in `static/_headers`.

## 6. Replacing the logo

Your logo is already on the site (header and footer). The files are in `assets/images/logo/`:

1. `amiri-logo-*.png` / `.webp`: the main horizontal logo for light backgrounds (header on every page).
   `amiri-icon-*`: the ABS monogram on its own, for small spaces (mobile menu, quote forms). `amiri-icon-on-dark-*` is the same for dark panels. `amiri-logo-on-dark-*`: the same logo with the black lettering lightened, used in the dark footer.
2. To replace it, save new files with the same names (320 and 640 pixels wide, transparent background) or change the paths in `site.config.json` under `logo`. If the shape changes, update `logo.width` and `logo.height`.
3. The original file you supplied, and the AB monogram on its own, are kept in the `brand/` folder (not published).
4. The icons in `static/` (favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-512-maskable.png) are already made from your AB monogram. To change them, replace these files (realfavicongenerator.net does this for free).
5. Replace `assets/images/og-image.png` (1200×630) – the picture shown when the site is shared on WhatsApp/Facebook.

## 7. Changing colours

Colours are at the top of `assets/css/styles.css` under `:root` (charcoal, warm off-white, gold, muted teal). Fonts (Plus Jakarta Sans and Inter) are self-hosted in `assets/fonts/`. Change them there and they update everywhere. Keep text contrast high (check with webaim.org/resources/contrastchecker).

## 8. Deploying

Full step-by-step instructions: **[CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md)**. In short:

1. Put this folder in a GitHub repository.
2. Cloudflare Pages → connect the repository → build command `node build.js`, output directory `dist`.
3. Add the custom domain. **Read [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) first – your Google Workspace email records must be preserved.**

## 9. Updating the site later

1. Edit files (config, page text, photos).
2. Run `node build.js --serve` and check it locally.
3. Commit and push to GitHub (GitHub Desktop is the easiest way). Cloudflare rebuilds and publishes automatically in about a minute.

You can also edit a file directly on github.com (pencil icon → Commit changes) – Cloudflare will rebuild the same way.

## 10. Rolling back a bad update

- **Fastest:** Cloudflare dashboard → Workers & Pages → your project → Deployments → find the last good deployment → **⋯ → Rollback to this deployment**. Live within seconds.
- **Permanently:** in GitHub, revert the bad commit (GitHub Desktop: History → right-click → Revert changes in commit) and push.

## 11. Moving to another host

Run `node build.js` and upload the contents of `dist/` to any static host. Everything is relative to the site root, no server code is needed. If the new host doesn't read Cloudflare's `_headers` file, set the security headers listed in it through that host's settings.

## 12. Security notes

- No secrets in any public file. The browser config (`assets/js/config.js`) is generated and contains only public details.
- Security headers (Content-Security-Policy, HSTS, Referrer-Policy, Permissions-Policy, X-Frame-Options, nosniff) are set in `static/_headers`. If you add an external service (e.g. a map, video, or a chat service on another domain) you must add it to the CSP there.
- There is no server-side form, so there is nothing for spammers to submit to. When a real back-end form or chat is added later, protect it with **Cloudflare Turnstile**, validate every field on the server, rate-limit it, and keep API keys in Cloudflare secrets (see AI_RECEPTIONIST_PLAN.md).
- No tracking cookies, Google Analytics or advertising pixels. Use Cloudflare Web Analytics (cookie-free). Anything that sets non-essential cookies needs a consent banner that blocks it until the visitor agrees.

## 13. Other documents

| Document | What it is for |
|---|---|
| [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md) | Hosting on Cloudflare Pages, custom domain, headers, analytics, rollbacks |
| [DNS_MIGRATION_CHECKLIST.md](DNS_MIGRATION_CHECKLIST.md) | Moving DNS without breaking Google Workspace email |
| [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) | Everything to verify before going live |
| [PRIVACY_REVIEW_CHECKLIST.md](PRIVACY_REVIEW_CHECKLIST.md) | Points to check in the privacy notice and terms |
| [AI_RECEPTIONIST_PLAN.md](AI_RECEPTIONIST_PLAN.md) | Technical plan for the future AI receptionist |
