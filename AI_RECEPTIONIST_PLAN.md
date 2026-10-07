# AI receptionist – technical plan

Status: **Phase 1 (guided chat) and automatic submission built, switched off.** `assets/js/chat.js` + `assets/css/chat.css` are a step-by-step enquiry assistant that runs in the visitor's browser. It is off (`aiChat.enabled: false`) and loads nothing until it is turned on. The full AI back end below is **not built**. Nothing on the site claims an AI receptionist exists.

## Phase 1 – guided website chat (built, off)

No AI model, no server, no running cost. The assistant asks, in order:

1. Service: Electrical / Plumbing (non-gas reminder) / Property Maintenance / Other
2. Emergency / Urgent / Planned. Emergency shows a large **Call Now** + **WhatsApp** card and keeps a Call/WhatsApp strip pinned at the top of the chat; Urgent shows smaller Call/WhatsApp buttons. The summary and email subject are prefixed EMERGENCY or URGENT.
3. Postcode (UK format checked; districts outside `aiChat.coveredPostcodeAreas` get "we'll check and let you know", never a refusal)
4. Photos or short video (up to 6 files, 50 MB each, previews only; they stay on the device)
5. Description of the problem
6. Name and phone number (UK number checked)
7. When it is needed + optional preferred days/times
8. Summary card with a reference (e.g. `ABS-071026-4821`) and send buttons: **Send on WhatsApp** (pre-filled summary), **Send by email** (pre-filled), **Share photos to WhatsApp** (phones that support it), **Copy summary**. Emergency and urgent jobs also get **Call Now** first. Colours follow the site: charcoal, white and gold, with green only on WhatsApp buttons.

Fixed wording only, no free-form answers: it never quotes a price or confirms a booking (uses the owner-approved `pricing` text), never says 24/7, and never gives repair instructions. Keyword checks in the description trigger fixed safety messages: smell of gas / CO alarm → leave and call 0800 111 999; sparking/smoke/burning/shock/water near electrics → keep away, don't repair it yourself, 999 for fire/smoke/shock; boiler/gas → non-gas only; price questions → "assessed first" + pricing text. Progress survives a page change (sessionStorage); photos do not, and the customer is told to attach them.

**Turning it on:** after the homepage is approved, set `aiChat.enabled: true` and push. **Trying it first:** in Cloudflare Pages → Settings → Environment variables, add `AI_CHAT_PREVIEW = 1` to the **Preview** environment only; every branch preview then has the chat while the live site does not. Locally: `AI_CHAT_PREVIEW=1 node build.js --serve`.

On phones the "Get help" button appears together with the sticky Call/WhatsApp bar (after the hero buttons scroll away) so it never covers them. Any link or button with a `data-open-chat` attribute also opens the chat, if the owner later wants an entry point inside a page.

## Automatic submission (built, off)

When `aiChat.submitEndpoint` is `/api/enquiry` (the default), the last step of the chat is a **Submit** button instead of "send it yourself":

1. The customer checks their details, can add or change photos/video, and must tick a consent box (privacy wording + link) before Submit works.
2. Photos are resized in the browser (max 2000px JPEG, typically 3 MB → 300–450 KB) so uploads are quick on mobile data. Videos are sent as they are (max 60 MB each, 90 MB in total, 6 files).
3. `functions/api/enquiry.js` (Cloudflare Pages Function) checks the request (same site, hidden spam field, optional Turnstile, max 5 per hour per connection, every field, file types and sizes), then:
   - saves photos/video in a **private Cloudflare R2 bucket** under `enquiries/<reference>/`,
   - saves the enquiry in **Cloudflare D1** (`migrations/0001_enquiries.sql`), so it is kept even if an email fails,
   - emails the job summary to the business through **Resend** (photos attached up to 18 MB; every file also linked with a signed link that expires after 30 days, served by `functions/api/enquiry-file.js`),
   - optionally sends a **WhatsApp alert** to the business (WhatsApp Cloud API template: urgency, service, postcode, reference),
   - records whether the email and WhatsApp alert were sent, and deletes D1 rows older than 12 months.
4. The customer sees: "Thank you. Amiri Building Services has received your enquiry and will contact you shortly." with their reference. Emergencies also get Call Now and WhatsApp buttons again. If some files failed, they are asked to WhatsApp them with the reference. If sending fails completely, "Try again" plus "Send on WhatsApp instead" / "Send by email instead" appear, so the enquiry is never stuck.
5. After submitting, changing page shows the confirmation again (no double submission).

The endpoint answers **404 unless `ENQUIRY_API_ENABLED` is `true`**, so it is inert until the owner sets it up, even though the `functions/` folder deploys with the site.

The privacy notice switches automatically: while the chat is on, section 6 describes the enquiry assistant (Cloudflare storage, Resend email, optional WhatsApp alert, 12-month deletion) and Resend is listed as a processor. Review it before going live.

### Setup

> **Current setup (2026-10-07).** The site runs as the Cloudflare **Worker** `amiri-website` (Workers Builds from GitHub), not a Pages project. `wrangler.jsonc` holds the bindings and settings, and `worker/index.js` routes `/api/*` to the handlers in `functions/api/`. Production (`main`) keeps the endpoint off (`ENQUIRY_API_ENABLED=false`); Previews of other branches have it on and show the chat.
> - Done: D1 database `amiri-enquiries` (id `617c2a60-cc4f-48c9-af22-bdadb401d611`) with `0001_enquiries.sql` and `0002_settings.sql` applied.
> - `FILE_LINK_SECRET` is generated automatically on first use and kept in D1 (a Worker secret of the same name overrides it).
> - Files are deleted together with their enquiry after 12 months by the endpoint itself, so no R2 lifecycle rule is needed.
> - Still needed: R2 switched on for the account, then the private bucket `amiri-enquiries`; a Resend account with the domain verified; `RESEND_API_KEY` as a Worker secret (for production and for Previews).
>
> The Pages-based steps below and `scripts/cloudflare-setup.sh` are kept for reference if the site ever moves to Pages.


**Automated:** `scripts/cloudflare-setup.sh` does all the Cloudflare steps below (D1 database + table, private R2 bucket + 12-month deletion rule, Pages bindings and settings, a generated `FILE_LINK_SECRET`) and, given a Resend key, adds Resend's DNS records to the domain. It switches the endpoint on for **Preview deployments only**; the live site stays off until it is run with `--enable-production`. It needs `CLOUDFLARE_API_TOKEN` (permissions listed at the top of the script) and optionally `RESEND_API_KEY`, set as environment variables, never committed.

**Manual equivalent (owner, one time, about 30–45 minutes)**

**Cloudflare** (same account as the website):
1. **R2** → Create bucket `amiri-enquiries` (keep it private, no public access). Settings → Object lifecycle rules → add "Delete objects with prefix `enquiries/` after 365 days".
2. **D1** → Create database `amiri-enquiries`. Open its Console tab and paste/run the contents of `migrations/0001_enquiries.sql`.
3. **Pages project → Settings → Bindings**: add D1 binding `DB` → `amiri-enquiries`, and R2 binding `ENQUIRY_FILES` → `amiri-enquiries`. Do this for **Production and Preview**.
4. **Pages project → Settings → Variables and secrets** (Production and Preview):
   - `ENQUIRY_API_ENABLED` = `true`
   - `FILE_LINK_SECRET` = a long random string (type **Secret**; e.g. from a password manager, 40+ characters)
   - `EMAIL_TO` = `waris@amiribuildingservices.com` (comma-separate to add more)
   - `EMAIL_FROM` = `Amiri Website <enquiries@amiribuildingservices.com>`
   - `RESEND_API_KEY` (Secret) – see below
5. Optional spam check: **Turnstile** → add widget for the domain → put the **site key** in `aiChat.turnstileSiteKey` in `site.config.json`, and the **secret key** as `TURNSTILE_SECRET_KEY` (Secret).

**Resend** (email delivery, free tier 3,000 emails/month):
1. Sign up at resend.com → Domains → add `amiribuildingservices.com` → add the DNS records it shows (in Cloudflare DNS). This lets it send as `enquiries@amiribuildingservices.com` without landing in spam. It doesn't change your Google Workspace email.
2. API Keys → create a key with "Sending access" only → paste it into Cloudflare as `RESEND_API_KEY`.

**WhatsApp alert** (optional; email already arrives on your phone):
- Meta WhatsApp Cloud API needs a Meta Business account, a **separate phone number** for sending (it can't be the number already in the WhatsApp app), and an approved **utility template**, e.g. name `new_enquiry`, language English (UK), body: `New {{1}} website enquiry: {{2}} in {{3}}. Reference {{4}}. Full details and photos are in your email.` Business-initiated template messages are charged per message by Meta (a few pence each in the UK).
- Then set `WHATSAPP_TOKEN` (Secret, a permanent system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ALERT_TO` = `447438635942` (digits only), and optionally `WHATSAPP_TEMPLATE` / `WHATSAPP_TEMPLATE_LANG` if different from `new_enquiry` / `en_GB`.
- If these are not set, the alert is simply skipped (recorded as `not_configured`).

**Turning it on (after homepage approval):** set `aiChat.enabled: true` in `site.config.json`, push, then send one real test enquiry from your phone and check the email, the photos and the D1 row.

**Viewing stored enquiries:** Cloudflare → D1 → `amiri-enquiries` → Console: `SELECT reference, created_at, urgency, service, name, phone, postcode, email_status FROM enquiries ORDER BY id DESC LIMIT 20;`. Files are under R2 → `amiri-enquiries` → `enquiries/<reference>/`.

**Running costs:** Cloudflare Pages Functions, D1 and R2 free tiers cover a small business comfortably; Resend free tier covers 3,000 emails/month; WhatsApp alerts are the only per-message cost, and only if you turn them on.

### Testing locally

`npm test` runs the unit tests for `lib/enquiry.js` (validation, file checks, signed links, email). For an end-to-end run, use `wrangler pages dev` with local D1/R2 bindings and point `RESEND_API_URL` / `WHATSAPP_API_URL` at a mock server, so no real email or WhatsApp message is sent.

Phase 2 (below) swaps the fixed questions for the Claude-powered receptionist using the same chat UI and endpoint pattern.

---

# Phase 2 – full AI receptionist (not built)


Goal: one assistant that handles first contact on **website chat, WhatsApp Business, Gmail** and checks **Google Calendar**, with strict limits on what it may do on its own, a human approval step for anything that matters, and minimal fixed monthly cost.

---

## 1. Architecture

```
 Website chat (chat.js) ──┐
                          │  HTTPS POST /api/chat
 WhatsApp Business ───────┤  webhook  /api/whatsapp       ┌──────────────────────────────┐
 Cloud API (Meta)         │                               │  Cloudflare Worker /          │
                          ├──────────────────────────────►│  Pages Functions              │
 Gmail API ───────────────┤  push (Pub/Sub) or cron poll  │  "AI receptionist back end"   │
                          │                               │                              │
 Google Calendar API ◄────┘  free/busy + tentative holds  │  • channel adapters           │
                                                          │  • policy & approval engine   │
                                                          │  • Claude API (tool use)      │
                                                          │  • action log                 │
                                                          └───────┬──────────┬───────────┘
                                                                  │          │
                                                       Cloudflare D1   Cloudflare R2
                                                    (customers, jobs,   (job photos)
                                                     messages, log)
                                                                  │
                                                     Owner notifications: email/WhatsApp
                                                     to waris@ with job summary + approve/reject
```

**Golden rule: no API key ever reaches the browser.** The website only talks to our own `/api/*` endpoints. Every secret (Claude, Meta, Google) lives in Cloudflare encrypted secrets (`wrangler secret put …`), never in the repository or in `site.config.json`.

### Components

| Component | Choice | Why |
|---|---|---|
| Runtime | **Cloudflare Pages Functions** (a `functions/` folder in this repo) or a separate **Worker** | Same account, same domain (no CORS), free daily request allowance |
| AI model | **Claude API** via the official `@anthropic-ai/sdk` (TypeScript) | Tool use for structured job intake |
| Database | **Cloudflare D1** (SQLite) | Free tier is ample for a small business |
| Photo storage | **Cloudflare R2** | Free tier storage, no egress fees |
| Spam / abuse | **Cloudflare Turnstile** on website chat + rate limiting | Free |
| Scheduled jobs | **Cron Triggers** (Gmail polling, reminders, clean-up) | Free |

## 2. Data model (D1)

```sql
customers   (id, name, phone, email, whatsapp_id, created_at)
jobs        (id, customer_id, channel, category, service, postcode, urgency,
             description, status, -- new | awaiting_owner | quoted | booked | closed
             created_at, updated_at)
messages    (id, job_id, channel, direction, body, created_at)
photos      (id, job_id, r2_key, created_at)
bookings    (id, job_id, calendar_event_id, start, end, status) -- tentative | confirmed | cancelled
approvals   (id, job_id, type, proposed_action_json, status, decided_by, decided_at)
action_log  (id, job_id, actor, -- ai | owner | system
             action, input_json, result_json, created_at)
```

Retention follows the privacy notice: e.g. a nightly cron deletes enquiries that never became jobs after 12 months, and photos tied to them.

## 3. What the assistant may and may not do

The assistant does **not** act freely. It can only call the tools the back end gives it, and the back end (not the model) enforces the rules below.

### Automatic (no approval)
- Answer basic FAQs from an approved text (services, non-gas only, areas, how to send photos).
- Check whether a postcode is in the service area (lookup against the configured list; not the model's opinion).
- Basic job intake: name, postcode, phone, category, service, emergency vs planned, description.
- Ask for and receive photos.
- Answer basic availability questions from Calendar free/busy ("we have time Thursday afternoon"), clearly worded as *not yet booked*.
- Explain standard call-out policy **only** using owner-approved wording stored in the database. Until that wording exists, it says "Waris will confirm pricing".

### Needs human approval (creates an `approvals` row and notifies the owner)
- Any price or quote, unusual prices, large quotes.
- Refunds, compensation, discounts.
- Complaints, disputes, legal questions, contracts.
- Anything dangerous (it gives the fixed safety message and the owner is alerted immediately).
- Anything outside preset pricing rules or outside the service list.
- Confirming a booking (unless the owner later enables auto-confirm for specific slot types).

### Never
- Invent a quote, price, qualification, accreditation, insurance or guarantee.
- Say a booking is confirmed unless `create_booking` returned `confirmed` from the booking system.
- Give electrical or gas DIY instructions. Danger replies are fixed text: call 999 for fire/shock, National Gas Emergency Service 0800 111 999 for gas, make safe only if safe to do so.
- Pretend to be a human. Every conversation opens by saying it is an automated assistant.

### Enforcement
- **Tools are the only way to act**, and each tool checks permissions server-side. For example `create_booking` always writes `tentative` and raises an approval unless policy allows otherwise. There is no "send price" tool, only `request_owner_quote`.
- Pricing text the model may use comes from an owner-maintained table, injected into the prompt. The model is told to use only that text.
- Every tool call and model reply is written to `action_log` with input and output.
- Messages from customers are treated as data, not instructions (prompt-injection resistance): the system prompt says so, and tools can't be unlocked by anything a customer writes.

## 4. Claude API integration

Model: **`claude-opus-5-5`** (Claude Opus 5.5, current default; $4 per million input tokens / $20 per million output tokens at the time of writing). Cheaper options, if the owner chooses to trade some capability for cost after testing: `claude-sonnet-5-5` ($2 / $10) or `claude-haiku-4-5` ($1 / $5). Model choice is an owner decision; test on real conversations before switching. Prices change, so check anthropic.com/pricing.

Implementation notes (current API behaviour, verify against docs when building):

- Use the official TypeScript SDK `@anthropic-ai/sdk` in the Worker. Key in a Cloudflare secret `ANTHROPIC_API_KEY`.
- **Tool use** for actions: `check_service_area`, `save_job_details`, `request_photos`, `get_availability`, `create_booking` (tentative), `request_owner_quote`, `escalate_to_owner`. Set `strict: true` on tool definitions so arguments always match the schema. Use `tool_choice: auto`, because forced tool choice (`any` / `tool`) is rejected by current models. Steer tool use from the system prompt instead.
- **Thinking/effort:** Claude Opus 5.5 always uses adaptive thinking; control depth with `output_config: { effort: "low" | "medium" | … }` (default `medium`). Receptionist chat is simple, so test `low`, which is cheaper and faster.
- **Refusals:** check `stop_reason` (including `"refusal"`) before reading content. Enable the server-side `fallbacks` option so a declined request is retried on a fallback model, and fall back to a "please call us" message if nothing comes back.
- **Prompt caching:** keep the system prompt, FAQ text, policies and tool definitions **identical** on every request (no timestamps inside them) and mark them with `cache_control` so repeated conversations re-use the cached prefix. That substantially cuts input cost. Put the per-conversation data after the cached part.
- Cap `max_tokens` per reply, cap turns per conversation, and cap conversations per IP/phone per day.
- Keep conversation history append-only (don't edit earlier turns). Current models reject or ignore edited thinking history.

## 5. Channel adapters

### Website chat
- Set `aiChat.enabled: true` only when everything below is tested.
- `chat.js` POSTs `{ sessionId, message, page }` to `/api/chat` and expects `{ reply, handoff? }`.
- Add **Turnstile** before the first message; verify the token server-side.
- Validate input server-side (length, content type), rate limit per IP.

### WhatsApp Business Cloud API (Meta)
- Requires a Meta Business account, a verified business, and a phone number registered to the Cloud API. **A number moved to the Cloud API can no longer be used in the normal WhatsApp app at the same time.** Consider a separate number, or keep the current personal-style use until ready.
- Webhook: `/api/whatsapp`. Verify Meta's `X-Hub-Signature-256` with the app secret on every request; answer the verification challenge.
- Replies to a customer within **24 hours** of their last message are free-form. Messages outside that window need pre-approved **templates**, which Meta charges for per message (rates by country/category; check Meta's current pricing).
- Photos: download media via the Graph API → store in R2 → link to the job.

### Gmail (info@)
- Google Cloud project → enable Gmail API → OAuth consent (Internal, for your Workspace) → a service account with **domain-wide delegation** scoped only to `gmail.modify` for info@, or OAuth with a refresh token stored as a secret.
- New mail: Gmail **push notifications via Google Pub/Sub** to a Worker endpoint, or a **Cron Trigger** polling every few minutes (simpler).
- Start in **draft mode**: the assistant writes reply *drafts* in Gmail and the owner sends them. Allow auto-send later only for plain acknowledgements.

### Google Calendar
- Same Google project; scope `calendar.events` + `calendar.freebusy` on Waris's work calendar.
- `get_availability` uses free/busy within owner-defined working windows (configured, not invented).
- `create_booking` inserts a **tentative** event ("HOLD – awaiting confirmation") and raises an approval. Only after the owner approves (or an allowed rule passes) does it become confirmed and the customer get a confirmation. The assistant's wording comes from the booking status, never from the model's assumption.

## 6. Owner workflow

- New job / approval → message to waris@ (and optionally a WhatsApp template to the owner) with a **job summary**: name, phone, postcode, category, urgency, description, photo links, suggested slot.
- Approve / reject / edit via signed one-time links to `/api/approve?...` (HMAC-signed, expiring), later a small password-protected admin page behind **Cloudflare Access** (free for small teams).
- Daily digest email of open jobs and pending approvals.

## 7. Costs

| Item | Fixed monthly cost | Usage-based cost |
|---|---|---|
| Cloudflare Pages / Workers / D1 / R2 / Turnstile / Cron | £0 within free allowances | Only if allowances are exceeded (Workers Paid plan is about US$5/month if ever needed) |
| Claude API | £0 | **Yes**, per token. A typical short intake conversation uses a few thousand tokens. Set a monthly spend limit in the Anthropic Console. |
| WhatsApp Cloud API | £0 | **Yes** for template messages outside the 24-hour window; replies inside it are currently free |
| Gmail / Calendar API | £0 (included with Workspace; API quota free) | Google Pub/Sub free tier usually enough |
| Google Workspace | existing subscription | – |

Set billing alerts on every provider before going live.

## 8. Security checklist for the back end

- [ ] All secrets in Cloudflare secrets; none in git, `site.config.json` or front-end JS.
- [ ] Turnstile + per-IP and per-sender rate limits.
- [ ] Verify WhatsApp webhook signatures; verify Pub/Sub tokens.
- [ ] Server-side validation of every field; parameterised D1 queries only.
- [ ] Least-privilege Google scopes; Meta system-user token with only needed permissions.
- [ ] Approval links signed and expiring; admin behind Cloudflare Access.
- [ ] Action log retained; review regularly.
- [ ] Update privacy notice (section 6 is already prepared) **before** enabling.
- [ ] Update `static/_headers` CSP `connect-src` if the API is on a different domain.

## 9. Suggested build order

1. D1 schema + `/api/chat` with intake tools only (no calendar, no prices). Test internally on a preview deployment.
2. Owner notifications + approvals.
3. Turn on website chat (`aiChat.enabled: true`) on a preview, test with friends, then production.
4. WhatsApp Cloud API (separate number first).
5. Gmail drafts.
6. Calendar tentative holds → approved bookings.
