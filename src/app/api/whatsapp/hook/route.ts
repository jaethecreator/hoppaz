import { after } from "next/server";
import { serviceClient } from "@/lib/notify/http";
import { handleVerify, handleWebhook, supabaseWaDb } from "@/lib/notify/wabot";
import { buildWhatsApp } from "@/lib/notify/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Meta's WhatsApp webhook: the callback URL is https://hoppaz.fun/api/whatsapp/hook (docs/reminders-whatsapp-plan.md, "Connecting WhatsApp").
 * Not for Hoppers. GET answers Meta's setup check with WHATSAPP_VERIFY_TOKEN. POST takes delivery statuses (into the send log, with the cost)
 * and the replies of guests (the keyword bot: STOP, START, TICKET, HELP); every POST is checked against X-Hub-Signature-256 with
 * WHATSAPP_APP_SECRET, and with that unset everything is refused. The answer is 200 as soon as the database has the message; any reply goes out
 * after it. Everything else is in src/lib/notify/wabot.ts.
 */
export async function GET(req: Request) {
  return handleVerify(req);
}

export async function POST(req: Request) {
  const sb = serviceClient();
  return handleWebhook(req, {
    db: sb ? supabaseWaDb(sb) : null,
    sender: buildWhatsApp(),
    schedule: (work) => {
      try {
        after(work);
      } catch {
        // not inside a request (a script calling the handler): run it without holding the answer
        void work();
      }
    },
  });
}
