# Reminders by email and WhatsApp: research

Written 29 Oct 2026 for Jae. Part 1 only: nothing is built yet. Prices were checked against the official pages on 29 Oct 2026 unless a line says otherwise.
Naira figures use about ₦1,400 to the dollar (the official rate was ₦1,344 and the parallel rate ₦1,404 on 20 Aug 2026; check the day you pay).

## The short answer

- **Email: Resend.** Free while we test, then Pro at $20 a month from the first real event. $35 a month covers Detty December.
- **WhatsApp: Meta's Cloud API directly, with no BSP.** Reminders are utility templates at $0.0067 each in Nigeria (about ₦9.40). That comes to about ₦28 per guest for a confirmation and two reminders.
- **Detty December (50 events, 10,000 guests), everyone on both channels:** about $236 a month (about ₦330,000). WhatsApp is $201 of that.
- **The long pole is Meta business verification, not code.** Until Hoppaz is verified, WhatsApp can reach only 250 people a day, which is less than one 300-guest event's reminder. Start this week. If it isn't done by 1 Dec, we launch with email and add WhatsApp when it lands.

## What exists today (checked in the code)

| Area | What I found |
|---|---|
| Sign-in codes | Supabase Auth `signInWithOtp` (`src/lib/events-r1/real/auth.ts:49`). The templates in `supabase/email-templates/` are pasted into the Supabase dashboard. There is no mail provider in the code. |
| Who sends the codes | It can't be checked from the repo. Supabase's built-in mailer sends only to the project's own team members, 2 an hour, so if strangers can sign in, production already has custom SMTP set in the dashboard. `docs/PLAY-MODE.md` and `docs/PLAY-BUILD-PLAN.md` planned Resend for it. **Ask Ola, or look in Supabase: Authentication, Emails, SMTP settings.** |
| Transactional email | None. There's no Resend, Postmark, SendGrid, Mailgun, Brevo, SES, nodemailer or SMTP in `src/`, `supabase/` or `package.json`, on this branch or on `origin/main`. The only sending package is `web-push`. |
| Pops worker | `ev_dispatch_due_pops()` (`supabase/events_r1_pops.sql:310`) makes the automatic Pops, then flips the due ones to `sent` and copies them to the room. **It delivers nothing.** The file doesn't schedule it: Ola runs `select cron.schedule('hoppaz-ev-pops', '* * * * *', ...)` himself (`supabase/EVENTS_R1_ORDER.md:125`). `src/app/api/cron/` has only `purge-rooms` (daily, `vercel.json`). Whether the Pops cron is on in production is unknown. **Ask Ola.** `ev_pop_recipient_ids(pop)` already returns who a Pop is for. |
| Web push | `src/app/api/push/send` takes a shared-secret POST that the database makes with pg_net (`supabase/push.sql`, `docs/PUSH.md`). It's used for spot alerts only. The same pattern works for the reminders runner. |
| Phone numbers | Only as an optional checkout question (`answers ->> 'phone'`, off by default, `events_r1_registrations.sql:225`). There's no phone on the account and no consent record. |
| Repo rules | `claude/CLAUDE-CODE-BUILD-PROMPT.md` and `claude/START-HERE-claude-code.md` aren't in the repo or the main checkout. I read `docs/hoppaz-handoff/START-HERE.md` and `specs/hoppaz-build-brief.md` (untracked, main checkout) instead. Brief section 7 already proposed "WhatsApp reminders later, with host-paid credits". |

## Email

### Options

| Provider | Free | 1,000 a month | 10,000 a month | 100,000 a month | Setup | Notes |
|---|---|---|---|---|---|---|
| **Resend** | 3,000 a month, **100 a day**, 3 domains | $0 if under 100 a day | $20 (Pro, 50k) | $35 (Pro, 100k) | Easy: one domain, DNS records, Node SDK | Pro overage $0.90 per 1,000. Batch API sends 100 per call. Already the planned auth SMTP. |
| Amazon SES | No standing free quota. New AWS accounts get up to $200 credits | $0.10 | $1 | $10 | Hardest: AWS account, leave the sandbox (a request), DNS, bounce handling yourself | $0.10 per 1,000 on the pay-as-you-go plan. Cheapest at volume. |
| Postmark | 100 a month | $15 | $15 | about $126 to $134 | Easy | Best known for inbox placement. Overage $1.20 to $1.80 per 1,000. |
| Mailgun | 100 a day | $0 | $15 (Basic) | about $100 (Foundation $35 for 50k plus overage) | Medium | Overage "from" $1.30 to $1.80. |
| Brevo | 300 a day (about 9,000 a month) with a "Sent with Brevo" footer, once Brevo approves the account | $0 | Starter $10.80 for 5,000 (the price Jae saw on 30 Oct), so 10,000 costs more | not confirmed, likely well above Resend | Medium | Works out to $2.16 per 1,000, about 5 times Resend Pro's $0.40. All plans include the transactional API and SMTP. |
| SendGrid (Twilio) | 60-day trial, 100 a day | $19.95 (Essentials, starting price) | $19.95 | not stated | Easy | Pro starts at $89.95. Tix Africa uses it. |
| ZeptoMail (Zoho) | First credit free (10,000 emails, lasts 6 months) | $0 | $0 | price not shown on the page I read | Medium | Transactional only, priced in prepaid credits of 10,000. Worth a look later if cost matters. |
| Supabase | No transactional email product | n/a | n/a | n/a | n/a | The built-in mailer is for testing: 2 an hour, team members only. Supabase says to set custom SMTP before production and names Resend, SES, Postmark, SendGrid, ZeptoMail and Brevo. |

Deliverability to Gmail: every one of these reaches Gmail inboxes when the domain has SPF, DKIM and DMARC and we send only what people asked for. The difference between them is small next to our own setup and content. Gmail's rules for bulk senders also want one-click unsubscribe on non-essential mail, so Pops and reminder emails get a `List-Unsubscribe` header.

### Recommendation: Resend

- It fits Next.js (Node SDK, React Email templates) and is already the plan for the sign-in codes, so one provider and one set of DNS records covers both.
- **The free plan won't carry a real event:** 100 a day breaks on the first 300-guest reminder. Use free in November while testing, then **switch on Pro ($20) before the first big event.**
- Monthly cost: **$0 at 1,000** (if no day goes over 100), **$20 at 10,000**, **$35 at 100,000**.
- **Move to SES if we pass about 300,000 a month.** At that point SES saves a few hundred dollars a month. Below that, the setup and bounce handling aren't worth it.
- Domain: send from a subdomain such as `mail.hoppaz.fun` (reminders) and keep codes on `hoppaz.fun` or another subdomain, so a bad day for one doesn't hurt the other. This follows Supabase's advice to keep auth mail apart. Records: SPF and DKIM (Resend gives them), a return-path MX on the subdomain, and DMARC starting at `p=none` with reports, tightened to `quarantine` after a few clean weeks.

### Should sign-in codes move to the same provider?

**Yes.** Supabase's built-in mailer can't send codes to the public at all (team members only, 2 an hour). Once custom SMTP is set, the email rate limit can be raised in Authentication, Rate limits. If production already uses Resend SMTP, nothing moves: we raise the limit and share the domain. If it uses something else, switch the SMTP settings to Resend (a 10-minute dashboard change, done by Ola or Jae). Keep the 60-second per-person wait.

## WhatsApp

### How Meta charges now (official, 29 Oct 2026)

- **Since 1 Jul 2025, Meta charges per delivered message**, by category and the recipient's country code. Messages people send us are free.
- Categories: **marketing**, **utility** and **authentication** are templates and can go at any time. **Service** messages are free-form replies inside the 24-hour customer service window, which opens when the person messages or calls us.
- **Changes on 1 Oct 2026 (four weeks ago):**
  - Service messages are now charged at the market's utility rate, after **1,000 free service messages a month per business phone number** (no roll-over).
  - Utility templates sent inside an open window were free from Jul 2025 and are now charged too.
  - Some BSP pages, Twilio's for one, still say utility in the window is free. That's out of date.
- **Free entry point:** a conversation started from a Click to WhatsApp ad or a Facebook Page call-to-action makes every message free for up to 7 days. It needs paid ads, so it isn't for us now.
- Rates can change only on 1 Jan, 1 Apr, 1 Jul and 1 Oct, with notice.

**Nigeria rate card (USD, effective 1 Oct 2026, from Meta's own rate card file):**

| Category | Per message | About |
|---|---|---|
| Marketing | $0.0516 | ₦72 |
| Utility | $0.0067 | ₦9.40 |
| Authentication | $0.0067 | ₦9.40 (international authentication $0.075) |
| Service (after 1,000 free a month per number) | $0.0067 | ₦9.40 |

Utility volume tiers: list rate up to 100,000 a month, then $0.0064 to 1M, $0.0060 to 4.5M, and lower above that.

### Cheapest compliant way to send event reminders

- **Reminders and confirmations to registered guests are utility.** Meta's rule: a utility template has to be non-promotional, and either specific to the person's order, booking or account or requested by them. A ticket confirmation and a "your event is tomorrow" reminder fit. Add a promo ("grab merch", "next week's party") and it's marketing at nearly 8 times the price. Meta also recategorises templates and restricts repeat offenders.
- **Host Pops are the risky part.** "Doors moved to 9pm" is utility. "Tickets for our next party are live" is marketing. Hosts write free text, and we can't police it per message. **Recommendation: at launch, Pops go by email, push and in-app only.** WhatsApp Pops come later, on host-paid credits, through a fixed "update about your event" template, with the host warned that promotional text costs more and can get the template moved to marketing.
- **Getting the guest to message first** ("Tap to get your ticket on WhatsApp", a `wa.me` link with prefilled text) opens a 24-hour window. Our ticket reply is then a free service message, inside 1,000 a month per number. Since 1 Oct the saving is small: at most 1,000 × $0.0067 = **$6.70 a month**, because service now costs the same as utility.
  - The real gain is consent and a proven number: the guest chose WhatsApp themselves.
  - That makes it good later, as a second way to opt in. It doesn't save money worth building for at launch.
- So the cheapest compliant setup is three short utility templates sent only to people who opted in, nothing promotional, and no Pops on WhatsApp yet.

### Direct Cloud API or a BSP

| Route | Monthly fee | Per message on top of Meta | At 30,000 utility a month |
|---|---|---|---|
| **Meta Cloud API, direct** | $0 | $0 | **$201** |
| Gupshup self-serve | none listed | $0.001 | $231 |
| Twilio | none | $0.005 (in or out), plus $0.001 per failed message | $351 |
| 360dialog | €49 per number (Regular plan) | none stated | about $201 + €49 |
| Termii | about $50 per account (a competitor's figure, not confirmed on Termii's site) | not found | about $251 |
| Infobip | sales quote only | not public | n/a |

**Direct is cheapest at every size, and our code calls one HTTPS endpoint.** A BSP is worth it only if Meta won't take our card. Meta bills in USD through Billing Hub, and some Nigerian naira cards fail on USD charges. If that happens, Gupshup is the cheapest fallback at $0.001 a message.

### What we need to start (Jae does these himself)

1. **A Meta business portfolio** for Hoppaz at business.facebook.com (the Instagram or Facebook one may already exist).
2. **Business verification.** This needs the legal name and address on an official document, for example a CAC certificate or a utility bill, plus a website on hoppaz.fun that shows the same name. Meta doesn't publish a time. It's usually a few days and can take two weeks or more. **Without it we're capped at 250 people a day** outside service windows, and at 2 phone numbers.
3. **A phone number not on WhatsApp.** A fresh SIM is simplest. A number already on WhatsApp has to be deleted from WhatsApp first. **Don't use the Hoppaz community number.** It must receive one SMS or voice code.
4. **Display name "Hoppaz".** It's reviewed against the website and branding, and it shows in chats once approved.
5. **A payment method in Meta's Billing Hub.** Since 1 Oct, without one, even service messages stop.
6. **A Meta developer app** with a permanent system-user token. Jae puts the token and IDs into Vercel himself. Never paste them in chat.
7. **Templates.** I draft them, Jae submits or approves them in WhatsApp Manager, and review takes up to 24 hours.

**Messaging limits for a new portfolio:**

| Stage | Limit | Unlocked by |
|---|---|---|
| Start | 250 different people a day outside service windows | n/a |
| Verified | 2,000 a day | Business verification, or 2,000 good messages in 30 days |
| Automatic steps | 10,000, then 100,000, then unlimited | Good quality, and using at least half the current limit over the last 7 days |

Limits count across the whole portfolio, not per number.

**Detty December needs the 10,000 step on its busiest nights.** That means verifying in early November and sending real reminders through November to climb.

**Opt-in rules:** Meta requires the opt-in to name Hoppaz and say that the person agrees to messages from us on WhatsApp, and to explain how to opt out. NDPA 2023 adds that the consent has to be clear, specific and freely given (no pre-ticked box), recorded, and easy to withdraw. Plan:
- an unticked "Send my ticket and reminders on WhatsApp" switch at checkout, next to the phone field, with the time of consent stored;
- "Reply STOP to stop" in every template;
- a switch in Account.

### Unofficial routes (whatsapp-web.js, Baileys and similar): no

- WhatsApp's terms ban bulk messaging, auto-messaging, non-personal use without authorisation, and access by automated means.
- These libraries drive a normal account through WhatsApp Web, so the number gets banned, often within days of bulk sends. Any community or groups on that number go with it.
- There's no delivery receipt we can trust, no template approval, and no way to show a regulator the consent and opt-out trail that NDPA expects.
- They're cheap only until the ban.

## Costs

**One event, 300 guests** (a confirmation and 2 reminders each):

| Channel | Messages | Cost |
|---|---|---|
| WhatsApp, everyone opted in | 900 utility | $6.03 (about ₦8,400) |
| WhatsApp, 60% opted in | 540 utility | $3.62 (about ₦5,100) |
| Email | 900, plus Pops | inside Resend Pro ($20 a month); about $0.09 on SES |

**Detty December: 50 events, about 10,000 guests:**

| Channel | Messages | Cost |
|---|---|---|
| WhatsApp, everyone opted in | 30,000 utility | **$201 (about ₦281,000)**. At 60% opt-in: $121 (about ₦169,000). |
| Email | about 60,000 (3 per guest, 2 Pops per guest, about 10,000 sign-in codes) | **$35** (Resend Pro 100k) |
| If Pops also went on WhatsApp (not at launch) | 2 Pops × 10,000 = 20,000 | $134 if utility, $1,032 if Meta counts them as marketing |

**Monthly cost at three sizes** (recommended setup, everyone on both channels; halve the WhatsApp column for 50% opt-in):

| Guests a month | Emails (about 6 a guest) | Email | WhatsApp (3 a guest) | Total |
|---|---|---|---|---|
| 1,000 | 6,000 | $20 (Resend Pro; the free plan's 100 a day won't hold) | $20 | **about $40 (₦56,000)** |
| 10,000 | 60,000 | $35 | $201 | **about $236 (₦330,000)** |
| 100,000 | 600,000 | $420 on Resend, or about $60 on SES | $1,950 (100k at $0.0067, then 200k at $0.0064) | **about $2,010 to $2,370** |

Web push and in-app cost nothing. WhatsApp comes to about ₦28 a guest, which is 0.3% of a ₦10,000 ticket. Hoppaz pays at launch. Host-paid credits come later.

## Recommended setup and the smallest launch version

**For 1 Dec:**

**Channels:**
- **Email (Resend):** confirmation with a link to the ticket stub and QR, "You're in" after approval, day before, about an hour before, and host Pops. Reminder and Pop emails have unsubscribe links; confirmations don't, because they're the receipt.
- **Web push:** Pops and the hour-before reminder, for people who already turned on push.
- **WhatsApp (Cloud API, direct), only if Meta verification is done:** confirmation, day before and hour before. These are three utility templates sent to people who opted in with a phone number, with STOP handling. The rest of the system ships without it.

**Plumbing:**
- `notify(user, kind, payload)` writes one row per channel to a send log. The new SQL goes in a new `supabase/events_r1_notify.sql` draft with tests.
- **Runner:** pg_cron runs `ev_dispatch_due_pops()` every minute, as already planned. A second minute job uses pg_net to POST to a secret-protected `/api/notify/run`, which sends what's due and logs it. This is the same pattern as `/api/push/send`. I'm not using a Vercel cron because the Hobby plan runs crons only once a day; check which plan Hoppaz is on.
- **Pops tab:** shows the channels each Pop went out on and how many people it reached.
- **Safety:** everything is behind a flag, with fake-mode stubs that log instead of sending.

**Later:**
- WhatsApp Pops on host-paid credits.
- "Tap to get your ticket on WhatsApp" as a second way to opt in.
- Per-room notification levels (Everything, Just for you, Nothing).
- SES if volume passes about 300,000 emails a month.
- An SMS fallback for people without WhatsApp.

## What Jae has to do, and how long it takes

| Step | Who | Time |
|---|---|---|
| Check which SMTP production uses for codes, and whether the `hoppaz-ev-pops` cron is scheduled | Ola or Jae (Supabase dashboard) | 10 minutes |
| Resend account, add `mail.hoppaz.fun`, add the DNS records at the registrar | Jae | 30 minutes, then DNS usually within the hour (up to 48 hours) |
| Resend Pro ($20 a month) before the first big event | Jae | 2 minutes |
| Meta business portfolio, start business verification (CAC or utility document, matching name on hoppaz.fun) | Jae | 30 minutes to submit, then days to 2+ weeks |
| New SIM for the WhatsApp number, display name "Hoppaz", payment card in Billing Hub | Jae | 1 day (the name review runs alongside) |
| Developer app and permanent token, put into Vercel env (never in chat) | Jae, with steps from me | 30 minutes |
| Approve the 3 to 4 templates I draft | Jae | up to 24 hours each |
| Send real reminders in November to climb the messaging limit | automatic once live | 2 to 3 weeks of use |

**Realistic WhatsApp go-live is 1 to 3 weeks from the day Jae starts, and business verification sets the pace.** Email can go live in a day once the code is built.

## What the competitors use (from their public DNS records, 29 Oct 2026)

A domain's SPF, DKIM and verification records name the services allowed to send mail for it.

| Platform | Event email | Other mail | WhatsApp |
|---|---|---|---|
| Luma | Amazon SES on `luma.com` (SPF includes `amazonses.com`). The old `lu.ma` domain still has SendGrid keys. | Google Workspace | Yes, outside the US and a few other countries. It sends from +1 (415) 212-6297, a US number, and the provider isn't public. Reminders go 1 day and 1 hour before. Reply STOP to stop. |
| Tix Africa | SendGrid (DKIM keys `s1` and `s2` on `tix.africa`) | Sender.net for newsletters (SPF `sendersrv.com`), Google Workspace | No public sign of WhatsApp messages |
| PartyVerse (`partyverse.com`) | Amazon SES, Ireland region (`_amazonses` verification, `email.partyverse.com` receives through AWS) | Zoho Mail. The site loads Firebase, likely for push. | No public sign |

DNS shows who sends the email. It can't show the WhatsApp provider. None of the three uses Resend, but all three run their own domains with SPF and DKIM, which is the part that matters for reaching inboxes.

## Jae's picks

1. Email: Resend (recommended), or another from the table?
2. WhatsApp: Cloud API direct (recommended), or a BSP?
3. WhatsApp at launch for confirmation and 2 reminders only, with Pops on email, push and in-app (recommended)? Or WhatsApp Pops too, at Hoppaz's cost?
4. WhatsApp opt-in: an unticked switch at checkout (recommended), "Tap to message us" later?
5. Who checks the production SMTP and the Pops cron: Ola or Jae?

## Sources (read 29 Oct 2026)

- Resend pricing: https://resend.com/pricing ; batch and broadcast: https://resend.com/docs/knowledge-base/what-sending-feature-to-use
- Postmark: https://postmarkapp.com/pricing
- Amazon SES: https://aws.amazon.com/ses/pricing/
- Mailgun: https://www.mailgun.com/pricing/
- Brevo (third party, official page did not load): https://costbench.com/software/marketing-automation/brevo , https://www.sender.net/reviews/brevo/pricing/free-plan
- ZeptoMail: https://www.zoho.com/zeptomail/pricing.html
- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp ; rate limits: https://supabase.com/docs/guides/auth/rate-limits
- WhatsApp pricing, rate cards and the 1 Oct 2026 changes: https://developers.facebook.com/docs/whatsapp/pricing ; https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Template categories: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization ; template review: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- Messaging limits: https://developers.facebook.com/docs/whatsapp/messaging-limits ; phone numbers: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers ; display names: https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
- Opt-in: https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- WhatsApp terms: https://www.whatsapp.com/legal/terms-of-service
- Twilio: https://www.twilio.com/en-us/whatsapp/pricing ; 360dialog: https://360dialog.com/pricing ; Gupshup: https://www.gupshup.ai/channels/self-serve/whatsapp/pricing
- Naira rate (20 Aug 2026): https://www.opinionnigeria.com/dollar-to-naira-exchange-rate-today-august-20-2026/
