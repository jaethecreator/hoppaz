# Reminders by email: draft plan

Written 30 Oct 2026 for Jae, after his picks. The research and prices are in `docs/reminders-research.md`. Nothing here is built yet. The WhatsApp side is in `docs/reminders-whatsapp-plan.md`.

## Update, 31 Oct (replaces anything below that disagrees)

- **Timing:** day-before and hour-before go exactly 24 hours and 1 hour before, as Luma's do. The every-minute database timer calls our site only when something is due. Action emails go instantly.
- **Sending names:** guest mail from `mail.hoppaz.fun`, codes from `auth.hoppaz.fun`, instead of `hoppaz.fun`. Add `hello@hoppaz.fun` as a real inbox for replies and DMARC reports.
- **Required before any real send:** unsubscribe, bounce and complaint handling move ahead of go-live, and sign-in gets Turnstile, because a bot could otherwise burn the daily codes.
- **Also added:** check that Google's sign-in screen is in production, a hosted image for the QR code, a 2-week ramp-up, and a `/privacy` update.
- **Build order:** sending system, guest emails, unsubscribe and bounces, sign-in, WhatsApp, SES.

## Jae's picks

| What | Primary | Backup |
|---|---|---|
| Guest emails (tickets, reminders, Pops) | Brevo free: 300 a day, with the "Sent with Brevo" footer | Mailjet free |
| Sign-in codes | Mailtrap free: 150 a day | Mailjet free |
| Later, for volume | Amazon SES (set up in parallel) | n/a |

Mailjet's 200 a day is split so one kind can't starve the other: **100 for codes, 100 for guest emails.**

Free capacity a day:
- Sign-in codes: 150 + 100 = **250**
- Guest emails: 300 + 100 = **400**

That carries November and the first events. Detty December needs about 2,000 emails a day, so SES (about $6 a month) or a paid plan must be live before 1 Dec. The send log shows when we're getting close.

## 1. Fewer code emails: the balance with Google

150 codes a day is small for a ticketing app: one big event can use it up. So we make each code count and push people toward the free routes.

1. **Google first.** Today the sign-in sheet leads with email, and Google is a quiet button underneath. Swap them: a big "Continue with Google" on top, then "or use your email". Google sign-in costs us no email at all.
2. **The ticket email works without signing in.** Each ticket already has its own token (`ev_my_tickets`). The confirmation email links to a ticket page that opens with a long-lived signed link, so a guest can show the QR at the door without a code.
3. **New guests get one email, not two (to check).**
   - Today `ev_register` needs a signed-in account, so a new guest first gets a code email and then a confirmation email.
   - Instead, a guest who isn't signed in types name and email, and the server creates the account and registers them.
   - The server makes the sign-in link itself, without sending anything (Supabase's admin `generateLink`). That link goes inside the confirmation email, so "View your ticket" also signs them in.
   - Luma works the same way.
   - The catch: anyone can register someone else's email for a free event, as on Luma. Paid tickets are fine, because the payment proves the buyer.
   - **This needs a change to how registration works. Jae decides.**
4. **Stay signed in.** Supabase sessions keep refreshing, so people don't sign in again on the same phone. We make sure nothing signs them out early.
5. **Link Google after a code sign-in.** Once signed in, show "Next time, sign in with Google" (Supabase identity linking).
6. **When codes run low,** past 80% of the day's 250, the sheet hides the email field behind "Use email instead" and shows Google alone.
7. **A code on WhatsApp later.** For people who linked WhatsApp, an authentication template costs $0.0067. That's a cheap overflow if email codes ever run out.

## 2. Every email we send (modelled on Luma)

Priority decides what goes first when a day's allowance runs low: 1 always goes, 5 is the first to be dropped or moved to the next day.

**Account emails** (Mailtrap, then Mailjet):

| # | Email | When | Priority | Launch? |
|---|---|---|---|---|
| A1 | Sign-in code | asked on sign-in | 1 | yes |
| A2 | Email change code | changing email | 1 | yes |
| A3 | New sign-in on your account | a sign-in from a new phone or browser, **not** after a code sign-in (that code email already told them) | 3 | later: it doubles sign-in mail, so only for new devices |

**Guest emails** (Brevo, then Mailjet):

| # | Email | When | Priority | Launch? |
|---|---|---|---|---|
| G1 | You're going (ticket) | free registration confirmed | 1 | yes |
| G2 | Receipt and ticket | paid order settled | 1 | yes |
| G3 | Request sent | registered for an approval event | 2 | yes |
| G4 | You're in (ticket) | host approved | 1 | yes |
| G5 | Not this time | host declined | 3 | yes (short) |
| G6 | You're on the waitlist | joined the waitlist | 3 | yes |
| G7 | A spot opened (ticket) | moved off the waitlist | 1 | yes |
| G8 | Event changed | host changed the time or place | 1 | yes |
| G9 | Event cancelled (and refund, if paid) | host cancelled | 1 | yes |
| G10 | Tomorrow | 24 hours before | 2 | yes |
| G11 | Starting soon | about 1 hour before. Dropped first on a busy day: push, in-app and WhatsApp still cover it. | 4 | yes |
| G12 | Host Pop | a Pop is sent | 3 | yes |
| G13 | You cancelled | the guest cancels | 3 | yes |
| G14 | Refund sent | a refund is settled | 2 | yes |
| G15 | Thanks for coming | the morning after, to checked-in guests only. Room link and "see what's next", no hard sell. | 5 | yes (can move to the next day) |

**Host emails:**

| # | Email | When | Priority | Launch? |
|---|---|---|---|---|
| H1 | Your event is live (share link) | published | 3 | yes |
| H2 | Daily summary: new guests, approvals waiting | once a day, only if something happened. **Never one email per registration.** | 4 | later (in-app covers it) |
| H3 | Payout sent | payout settled | 2 | later |

Not sent on purpose: a welcome email (G1 does that job), and per-registration emails to hosts (too many).

Every guest email has a plain line of event facts (name, date, time, venue or "online"), one button, and a text version. G10, G11, G12 and G15 carry an unsubscribe link and the `List-Unsubscribe` header. Tickets, receipts, changes and cancellations don't, because they're the guest's own records.

## 3. The plumbing

```
something happens                         every minute (pg_cron)
(register, approve, Pop, edit, cancel)    ev_dispatch_due_pops()      already exists
        |                                 notify_enqueue_due()        reminders and thank yous due now
        v                                         |
  notify_queue   <--------------------------------+
  one row per person per message, unique key so nothing goes twice
        |
        |  pg_net POST with a secret (same pattern as /api/push/send),
        |  every minute, and straight away after a register or payment
        v
  /api/notify/run   claims up to 500 rows, renders them, sends by channel
        |
        +-- email: router picks the provider with room left today
        |          Brevo (cap 300) -> Mailjet (cap 100)
        |          a provider error or limit: try the next one
        +-- WhatsApp: Meta Cloud API (WhatsApp draft)
        +-- push: the existing web push
        +-- in-app: already the Pops and the event page
        v
  notify_sends   one row per attempt: channel, provider, status, provider id, cost

sign-in code:  Supabase Auth -> Send Email Hook -> /api/auth/send-email
               Mailtrap (cap 150) -> Mailjet (cap 100), logged in notify_sends too
```

**Why a Send Email Hook for codes:** Supabase's SMTP setting takes one provider only, so there'd be no backup when Mailtrap runs out. With the hook, Supabase hands every auth email to our route, which picks Mailtrap or Mailjet and uses our own template.

**New tables** (a new draft, `supabase/events_r1_notify.sql`, with tests):
- `notify_queue`: user, kind, event, payload, priority, due time, status, unique `dedupe_key`.
- `notify_sends`: queue row, channel, provider, status (`sent`, `failed`, `skipped`, `bounced`, `complained`, `delivered`, `read`), provider message id, cost in USD, error, time.
- `notify_prefs`: per person. Email reminders on or off, email Pops on or off, WhatsApp on, the WhatsApp number, when they agreed, and how.
- `notify_suppressed`: addresses that bounced hard or complained. We never send to them again, which protects our standing with every provider.
- `notify_caps`: each provider's daily cap and Mailjet's split. Changed with one SQL line, no deploy.

**Reminders reuse the automatic Pops.** `ev_pops` already makes `day_before` and `hour_before` for each event, and hosts can switch them off. When one of them goes, the queue gets one G10 or G11 per guest with that guest's own ticket link. One switch controls both.

**Rules that save money:**
- Nothing to people who cancelled, nothing to the checked-in for G10 and G11, no G10 to anyone who registered in the last 12 hours.
- Suppressed addresses are skipped.
- When a day's allowance runs low, priority decides: 4 and 5 are dropped or moved to the next day first, and 1 always goes. A note is logged so we can see what was dropped.
- **At 80% of any provider's daily cap, a warning goes to the admin.** That's the signal to pay for a step up or switch on SES.

**Providers' webhooks** (`/api/notify/hook/[provider]`): bounces and complaints go into `notify_suppressed`; delivered and opened update `notify_sends`.

**Safety:**
- Behind the flags `notify_email` and `notify_whatsapp` in `ev_settings`.
- In fake mode (`NEXT_PUBLIC_EVENTS_R1_FAKE=1`), a `log` provider writes to the console and `notify_sends`, and nothing real goes out.
- Keys only in Vercel.

## 4. Build order

1. Tables and the sending layer with the `log` provider (fake mode): queue, router, caps, priority, send log, tests.
2. Brevo and Mailjet for guest emails: G1 to G14 first, then G15 and H1.
3. Send Email Hook with Mailtrap and Mailjet for codes, plus the Google-first sign-in sheet.
4. Unsubscribe page, Account notification settings, provider webhooks.
5. The Pops tab shows the channels each Pop went out on and how many people it reached.
6. SES as a provider, when AWS approves.

WhatsApp plugs into the same queue and send log (see the WhatsApp draft).

## Sign-in hook (for Ola)

The route is `/api/auth/send-email` (code in `src/lib/notify/authhook.ts`). Supabase calls it for every auth email, and it sends the code at once through Mailtrap, then Mailjet. It never uses the queue. It is the one route where a failure stops people signing in, so do the steps in this order and do not skip the checks.

**Set up, in order**

1. **Mail accounts.** In Mailtrap, add and verify the sending domain `auth.hoppaz.fun` (its DNS records go in Hostinger). In Mailjet, validate the sender `codes@auth.hoppaz.fun` the same way. Both need to be sending before the hook is on.
2. **Vercel env vars** (Production). Keys only in Vercel, never in chat:
   - `MAILTRAP_API_KEY`
   - `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` (already there if guest mail is set up)
   - `NOTIFY_PROVIDERS` = `brevo,mailtrap,mailjet`. Codes always try Mailtrap first and Mailjet second, whatever the order. Brevo is only for guest mail.
   - `NOTIFY_FROM_CODE` only if you want a sender other than `Hoppaz <codes@auth.hoppaz.fun>`.
   - `SEND_EMAIL_HOOK_SECRET` comes from step 4.
3. **Deploy** this branch, so `https://hoppaz.fun/api/auth/send-email` exists. Check it from a terminal: a plain POST must answer 500 (secret not set yet) or 401 (secret set, no signature), never 200. Then do step 4.
4. **Supabase, Authentication, Auth Hooks, Send Email.** Choose HTTPS, set the URL to `https://hoppaz.fun/api/auth/send-email`, and generate the secret. It looks like `v1,whsec_...`. Copy the whole thing into Vercel as `SEND_EMAIL_HOOK_SECRET` and redeploy **before** the hook is on. With the hook on and the secret missing in Vercel, the route refuses every call and nobody can sign in. (I could not see the dashboard screen. If it switches the hook on when you save, get the Vercel page ready first and be quick.)
5. **Switch the hook on, then try it yourself** with your own email: ask for a code on the live site, and check that it arrives and works. Then look at the log:
   `select created_at, provider, status, error from notify_sends where error like 'auth:%' order by created_at desc limit 10;`
   The `error` column starts with `auth:` and the Supabase email type (`auth:magiclink`, `auth:signup`, `auth:email_change`). A good send reads `auth:magiclink`. A failed one adds the reason.
6. **Settings that must be right**, because the emails and the app depend on them:
   - Authentication, Providers, Email: enabled, **Email OTP Length 6**, **Email OTP Expiration 3600** (the emails say "one hour").
   - Keep the Supabase auth notifications (password changed, email changed, identity linked and so on) **off**. The route can send them, but each one spends a code from the day's 250.
   - Secure email change: either way works. With it on, a signed-in person with an email gets two codes and the app only takes one, so leave it off unless you change the app.

**If it breaks, turn it off at once.** Supabase, Authentication, Auth Hooks, Send Email: switch it off (disable the hook). Supabase goes straight back to its own mailer with the templates in `supabase/email-templates/`, with no deploy. That only helps if the project has a working SMTP setting: the built-in mailer sends to team members only. So before go-live, put Mailjet's SMTP into Supabase as the spare, and keep the dashboard templates matching the files. To find out why it broke, search the Vercel logs for `SIGN-IN EMAIL NOT SENT`.

**Check afterwards: `rate_limit_email_sent`.** In Authentication, Rate Limits, the number of emails Supabase will send per hour is for the whole project, and the default is low (30 an hour as far as I know). I could not tell whether it also counts mail sent through a hook. If it does, a busy hour stops codes before our own allowance of 250 a day does. Raise it above the busiest hour you expect, and watch that people are not seeing "wait a minute" when the allowance is not used up.

**What it does not do yet:** Turnstile on the sign-in sheet (still required before real sends, because a bot could use up the day's codes); Mailtrap bounce reports (the bounce route only knows Brevo and Mailjet); Mailtrap's free plan also stops at 4,000 a month, so at 150 a day it fills up near the end of the month and Mailjet's 100 a day covers the rest.

## What Jae does (today, for email)

1. Create Brevo, Mailtrap and Mailjet accounts. Brevo and Mailjet approve new senders by hand, usually within a day.
2. In each one, add `hoppaz.fun` as a sending domain. Put the records it gives into Hostinger DNS, plus one DMARC line: `_dmarc.hoppaz.fun` TXT `v=DMARC1; p=none; rua=mailto:<an inbox you read>`. There are no mail records today, so nothing clashes.
3. Put the three API keys into Vercel yourself. Never in chat.
4. Check how production sends sign-in codes today. `hoppaz.fun` has no mail records, so it's either Supabase's team-only mailer or another domain.
