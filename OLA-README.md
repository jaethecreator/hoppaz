# Reminders and sign-in: start here, Ola

Ola: to work through this with Claude, open this repo and say "read OLA-README.md and walk me through it, one step at a time".

## For Claude, helping Ola

- Work in order and do one step at a time. Stop for Ola's yes before anything that changes production.
- Ola does these personally, in the dashboards: Supabase settings, Vercel values and running SQL on production. Tell Ola exactly what to click or paste.
- Never ask for keys in chat, and never print them. The main checkout's `.env.local` may point at production, so don't run the app or scripts against it.
- If something here doesn't match what you see on production, stop and tell Ola. Don't guess.

## What's in this PR

| Change | What guests see | Needs setup? |
|---|---|---|
| Waitlist card and pill removed | No more early access popup on the map | No, works once deployed |
| Sign-in sheet: Google on top, Send code under it | Google is the main button | Check the Google screen in Part 1 |
| Email, WhatsApp and sign-in sending system | Nothing until it's switched on | Yes, Part 3 |

Jae has no Supabase access, so these steps are yours. Part 1 doesn't depend on this PR and fixes a live sign-in problem. Part 2 is safe to merge, because nothing sends until Part 3.

## Part 1: fix sign-in today (dashboard only)

**The problem.** A new visitor is an anonymous guest, so `src/lib/events-r1/real/auth.ts` calls `updateUser({ email })` when they enter their email. Supabase sends its "Change email address" email for that. Jae's test got the default email with a confirm button, while the app waits for a 6-digit code. The email came from Supabase, so production looks to be on the built-in mailer, which only delivers to team addresses.

1. **Change email address template.** Authentication, Emails, Change email address. Subject: `Your Hoppaz code is {{ .Token }}`. Body: `supabase/email-templates/email-change-code.html`.
2. **Check the other two.** Magic link should match `magic-link-code.html`, and Confirm sign up should match `confirm-signup.html`. Both must print `{{ .Token }}`, not a link.
3. **Check the code settings.** Authentication, Providers, Email: Email OTP Length 6, Email OTP Expiration 3600.
4. **Custom SMTP, once Jae says Mailjet shows `auth.hoppaz.fun` as valid.** Before changing it, note the current SMTP settings so you can restore them, and tell Jae if SMTP was already on. Jae gives you the Mailjet keys privately.

| Field | Value |
|---|---|
| Sender email | `codes@auth.hoppaz.fun` |
| Sender name | `Hoppaz` |
| Host | `in-v3.mailjet.com` |
| Port | `587` |
| Username | Mailjet API key |
| Password | Mailjet secret key |

5. **Raise the limit.** Authentication, Rate Limits, emails sent per hour: `100`. Custom SMTP starts at 30.
6. **Test.** In a private window on the live site, use a Gmail and a Yahoo address that aren't on the team. Each should get a 6-digit code in the inbox, and the code should sign in.

**Known limit: Mailjet adds its own unsubscribe option to sign-in emails.** A real test on 2 Nov showed its `List-Unsubscribe` header on the code email, and it is still there with tracking off. The docs don't say what using it does, so it may stop that address getting later Mailjet mail. If someone stops getting codes, check their address in Mailjet's contacts and blocked lists. The sign-in hook in Part 3 sends codes through Mailtrap first, which reduces this.

Saving SMTP changes live sign-in at once, so pick a quiet time. To undo it, restore what you noted in step 4.

7. **Check the Google sign-in screen.** Google Cloud Console, OAuth consent screen: it should say In production and show the Hoppaz name. Google is now the main sign-in button, and while that screen is in testing only listed test users can use it.
8. **Tell Jae** whether the `hoppaz-ev-pops` timer is scheduled on production.

## Part 2: merge this PR

The PR makes the two sign-in and popup changes above, and adds the sending code and routes, and SQL drafts that aren't run by merging. The "Vercel" check fails with "Git author jaethecreator must have access to the project". That's the known access rule, not a build error.

Checked on the merge result with `origin/main` at the time of writing: clean merge, typecheck clean, and `next build --webpack` passes. On the branch, the six `scripts/notify-*-check.mts` scripts pass (26, 26, 30, 62, 37, 15). The SQL tests passed before the merge, on PGlite with stubs for auth, storage and roles.

Sent for real on 2 Nov, to Gmail only, from a laptop script: Brevo and Mailjet emails reached the inbox, with SPF, DKIM and DMARC passing on the two we opened (a Brevo reminder and a Mailjet sign-in code). Sign-in sheet order and fake sign-in were checked in fake mode.

Not proved: real Google sign-in from the new sheet, Yahoo and Outlook, Mailtrap, Meta, the `pg_net` call from the timer, concurrent claims, and real Supabase grants.

**After merging:** delete `src/components/app/WaitlistPrompt.tsx`. Nothing uses it now. It was left in place only because `main` had edited it, so deleting it in this PR would have caused a merge conflict.

`/account/notifications` and `/unsubscribe` exist after the merge but need Part 3's SQL. Nothing links to the settings page yet, and no email carries an unsubscribe link until mail is sending.

## Part 3: database and switches (hold until Jae's follow-up PR)

The follow-up PR adds Turnstile, the Account link and the WhatsApp checkout switch. Turnstile must be live before the sign-in hook, because a bot could otherwise use up the day's codes.

1. **Vercel env (Production).** Values never go in git or chat. Jae gives you the provider keys privately.
   - Provider keys: `BREVO_API_KEY`, `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILTRAP_API_KEY`
   - Set: `NOTIFY_PROVIDERS` = `brevo,mailtrap,mailjet`, `NEXT_PUBLIC_SITE_URL` = `https://hoppaz.fun`, `NOTIFY_REPLY_TO` = `heyhoppaz@gmail.com`
   - Generate with `openssl rand -hex 32`: `NOTIFY_RUN_SECRET`, `NOTIFY_UNSUB_SECRET` (never change it after launch), `NOTIFY_HOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN`
   - WhatsApp, from Jae: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`
   - From Supabase in step 4: `SEND_EMAIL_HOOK_SECRET`
2. **Run the SQL, in this order,** after the Release 1 files: `events_r1_notify.sql`, `events_r1_notify_emails.sql`, `events_r1_notify_prefs.sql`, `events_r1_notify_whatsapp.sql`. All are safe to re-run. Tests are in `supabase/tests/events_r1_notify*`, and both flags start `off`.
3. **Connect the timer.** Run these, with `NOTIFY_RUN_SECRET`'s value in place of the placeholder:

```sql
select public.set_notify_config('run_url', 'https://hoppaz.fun/api/notify/run');
select public.set_notify_config('run_secret', '<NOTIFY_RUN_SECRET>');
select cron.schedule('hoppaz-notify', '* * * * *', 'select public.notify_tick()');
```

4. **Sign-in hook.** Follow "Sign-in hook (for Ola)" in `docs/reminders-email-plan.md`. Put the secret in Vercel and redeploy **before** switching the hook on, or nobody can sign in.
5. **Switch on email, with Jae, on one small event.** `select public.notify_set_flag('notify_email', 'on');`
6. **WhatsApp comes last.** See "Connecting WhatsApp" in `docs/reminders-whatsapp-plan.md`. Budget: `whatsapp_monthly_budget_usd`, $50 to start.

**To turn it off:** `select public.notify_set_flag('notify_email', 'off');`, the same for `notify_whatsapp`, and disable the Send Email hook in Supabase. Sign-in then falls back to the Part 1 settings.
