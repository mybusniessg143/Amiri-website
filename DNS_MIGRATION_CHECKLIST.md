# DNS migration checklist – keep Google Workspace email working

> ## ⚠️ WARNING
> **amiribuildingservices.com is already used for Google Workspace email (info@ and waris@).**
> Moving the nameservers to Cloudflare replaces the place where ALL your DNS records live.
> If the **MX** and **TXT** records (and any mail CNAMEs) are not copied across exactly, **email can stop arriving, go to spam, or fail Google's checks**.
>
> This checklist does not guess your current values. You must copy them from your current DNS provider and check them line by line.

Tick every box in order. Do not change nameservers until sections A–C are complete.

---

## A. Before you start (a day or two ahead)

- [ ] Find out **where the domain is registered** (registrar) and **where DNS is currently hosted** (often the same company – e.g. Hostinger, GoDaddy, 123-reg, Namecheap, or Google). A WHOIS lookup (e.g. lookup.icann.org) shows the registrar and current nameservers.
- [ ] Make sure you can log in to: the registrar, the current DNS provider, Google Workspace Admin (admin.google.com), and Cloudflare.
- [ ] Choose a quiet time (evening or weekend) for the nameserver change.
- [ ] **Lower the TTL** on the existing records to 300 seconds (5 minutes) at the current DNS provider, if it allows. Do this at least 24 hours before the switch so changes take effect quickly if you need to undo.

## B. Record every existing DNS record

- [ ] At the current DNS provider, **export the zone file** (BIND format) if there's an export option, and save it somewhere safe.
- [ ] **Also take full screenshots** of the DNS records page (all pages if it paginates).
- [ ] Fill in this table from your current DNS. Copy values exactly, including dots and quotation marks:

| Type | Name / Host | Value / Points to | Priority | TTL | Purpose (if known) |
|---|---|---|---|---|---|
| MX | @ | | | | Google Workspace mail |
| MX | @ | | | | (there may be 1 or 5 MX records) |
| TXT | @ | `v=spf1 …` | – | | SPF |
| TXT | google._domainkey (or other selector) | `v=DKIM1; k=rsa; p=…` (long) | – | | DKIM |
| TXT | _dmarc | `v=DMARC1; …` | – | | DMARC |
| TXT | @ | `google-site-verification=…` | – | | Google verification |
| CNAME | | | – | | e.g. mail/calendar shortcuts, verification |
| A / AAAA | @ and www | | – | | current website (will be replaced) |
| other | | | | | |

- [ ] Cross-check what Google expects: Google Workspace Admin → **Account → Domains → Manage domains** (and **Apps → Google Workspace → Gmail → Authenticate email** for the DKIM value). Note any record Google shows as required.
- [ ] Note whether **DNSSEC** is turned on at the registrar.

## C. Add the domain to Cloudflare (nothing changes yet)

- [ ] Cloudflare dashboard → **Add a domain** → `amiribuildingservices.com` → Free plan.
- [ ] Cloudflare scans and imports records it can find. **Do not trust the scan alone.**
- [ ] Compare Cloudflare's DNS list against your table from section B, **line by line**:
  - [ ] Every **MX** record present, same mail server and **same priority**.
  - [ ] **SPF** TXT record present and identical. There must be **only one** SPF (`v=spf1`) record.
  - [ ] **DKIM** TXT record present with the **full** long value (scans sometimes truncate or split it). Name must match exactly (e.g. `google._domainkey`).
  - [ ] **DMARC** TXT record on `_dmarc` present and identical (if you had one).
  - [ ] **google-site-verification** TXT record(s) present.
  - [ ] Any other TXT/CNAME records present (Microsoft, Facebook domain verification, etc.).
- [ ] Add anything missing manually (**+ Add record**).
- [ ] Mail-related records must be **DNS only (grey cloud)**. MX records can't be proxied; set any CNAMEs used for email or verification to **DNS only**.
- [ ] Old website A/AAAA/CNAME records for `@` and `www`: leave them for now. They will be replaced when you connect Cloudflare Pages (CLOUDFLARE_DEPLOYMENT.md step 4).
- [ ] Do **not** enable Cloudflare **Email Routing**. It replaces your MX records.

## D. Switch the nameservers

- [ ] If **DNSSEC** is on at the registrar, **turn it off first** and wait for that to apply (can take up to 24–48 hours). Leaving it on during a nameserver change can make the whole domain, including email, stop resolving.
- [ ] Cloudflare shows two nameservers (e.g. `xxx.ns.cloudflare.com`). At the **registrar**, replace the existing nameservers with exactly these two.
- [ ] Wait for Cloudflare to show the domain as **Active** (often under an hour; can take up to 24 hours).

## E. Test email immediately after the switch

- [ ] Check MX: toolbox.googleapps.com/apps/checkmx/ → enter the domain → no errors for MX, SPF, DKIM, DMARC.
- [ ] Or from a terminal: `dig MX amiribuildingservices.com +short` and `dig TXT amiribuildingservices.com +short` – should match your table.
- [ ] **Send** an email from a personal account (e.g. a Gmail or Outlook address) **to info@** and **to waris@**. Confirm both arrive.
- [ ] **Reply/send** from info@ to an external address. Confirm it arrives and is not in spam.
- [ ] In the received message, "Show original": SPF **PASS**, DKIM **PASS**, DMARC **PASS**.
- [ ] Check again after a few hours and the next day.

## F. After email is confirmed working

- [ ] Connect the website: CLOUDFLARE_DEPLOYMENT.md step 4.
- [ ] Re-enable **DNSSEC** from Cloudflare (DNS → Settings → Enable DNSSEC), then add the DS record it gives you at the registrar.
- [ ] Add the Google Search Console TXT verification record (add, don't replace).
- [ ] If you had no DMARC record, consider adding one, starting in monitoring mode, e.g. `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:waris@amiribuildingservices.com`, and tightening later. Ask if unsure.
- [ ] Keep the exported zone file and screenshots.

## If something goes wrong

- **Email stopped arriving:** compare Cloudflare DNS with your saved table and fix the MX/TXT records in Cloudflare. Changes apply within minutes.
- **Can't fix it quickly:** at the registrar, change the nameservers back to the old ones. Your old DNS records are still there, so email resumes as the change spreads.
- Google Workspace support can confirm the exact records your domain needs (Admin console → Help).
