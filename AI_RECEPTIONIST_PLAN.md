# AI receptionist – technical plan

Status: **not built**. The website is ready for it: a chat UI exists (`assets/js/chat.js`) but is switched off with `aiChat.enabled: false` (`AI_CHAT_ENABLED`) in `site.config.json`, and no chat code loads while it is off. Nothing on the site claims an AI receptionist exists.

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
