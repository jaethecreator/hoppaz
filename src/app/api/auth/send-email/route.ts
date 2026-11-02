import { after } from "next/server";
import { handleSendEmailHook, supabaseSendLog } from "@/lib/notify/authhook";
import { supabaseNotifyDb } from "@/lib/notify/db";
import { serviceClient } from "@/lib/notify/http";
import { buildProviders } from "@/lib/notify/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Supabase Auth's Send Email Hook (Authentication > Auth Hooks > Send Email, type HTTPS). Supabase calls this instead of sending the
 * email itself; the call is signed (Standard Webhooks, SEND_EMAIL_HOOK_SECRET) and nothing else gets in. Codes go out through Mailtrap, then
 * Mailjet, straight away and not through the queue. Supabase gives the hook 5 seconds, so everything here has a deadline.
 * To turn it off at once: disable the hook in Supabase and its own mailer takes over. All of it is in src/lib/notify/authhook.ts, and the
 * setup steps are in docs/reminders-email-plan.md ("Sign-in hook").
 */
export async function POST(req: Request) {
  const sb = serviceClient();
  return handleSendEmailHook(req, {
    env: process.env,
    providers: () => buildProviders(),
    db: sb ? supabaseNotifyDb(sb) : null,
    sends: sb ? supabaseSendLog(sb) : null,
    log: { warn: (line) => console.warn(line), error: (line) => console.error(line) },
    // after() keeps the function alive for the send log and for handing back an allowance, without making the person wait for them.
    // Outside a request (a script calling POST directly) it throws, and the work then simply runs on its own.
    defer: (work) => {
      try {
        after(() => work);
      } catch {
        void work.catch(() => {});
      }
    },
  });
}
