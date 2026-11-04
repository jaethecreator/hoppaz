import { handleHook, type ApplyCounts } from "@/lib/notify/hooks";
import { serviceClient } from "@/lib/notify/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the email providers tell us after a send: /api/notify/hook/brevo and /api/notify/hook/mailjet. Not for Hoppers: the caller must
 * present NOTIFY_HOOK_SECRET (bearer token, basic auth password, or ?key=). Hard bounces and complaints go on the suppression list, soft
 * bounces and deliveries go in the send log (notify_apply_events in supabase/events_r1_notify_prefs.sql). Replays are harmless.
 * Everything else is in src/lib/notify/hooks.ts.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const sb = serviceClient();
  return handleHook(req, provider, {
    apply: sb
      ? async (name, events) => {
          const { data, error } = await sb.rpc("notify_apply_events", { p_provider: name, p_events: events });
          if (error) throw new Error(`notify_apply_events: ${error.message}`);
          const d = (data ?? {}) as Partial<ApplyCounts>;
          return { applied: d.applied ?? 0, duplicate: d.duplicate ?? 0, unmatched: d.unmatched ?? 0, ignored: d.ignored ?? 0 };
        }
      : null,
  });
}
