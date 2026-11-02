# Email and WhatsApp reminders: guide for Ola

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

**Two questions for Jae:** is the `hoppaz-ev-pops` timer scheduled on production, and does the Google sign-in screen say In production with the Hoppaz name?

## Part 2: merge this PR

The PR adds the sending code and routes, and SQL drafts that aren't run by merging. The "Vercel" check fails with "Git author jaethecreator must have access to the project". That's the known access rule, not a build error.

Checked on the merge result with `origin/main` at the time of writing: clean merge, typecheck clean, `next build --webpack` passes, and the five `scripts/notify-*-check.mts` scripts pass (26, 26, 30, 62, 37). The SQL tests passed before the merge, on PGlite with stubs for auth, storage and roles.

Not proved: any real provider or Meta call, Gmail rendering, the `pg_net` call from the timer, concurrent claims, and real Supabase grants.

`/account/notifications` and `/unsubscribe` exist after the merge but need Part 3's SQL. Nothing links to the settings page yet, and no email carries an unsubscribe link until mail is sending.

## Part 3: database and switches (hold until Jae's follow-up PR)

The follow-up PR adds Turnstile, Google-first sign-in, the Account link and the WhatsApp checkout switch. Turnstile must be live before the sign-in hook, because a bot could otherwise use up the day's codes.

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
