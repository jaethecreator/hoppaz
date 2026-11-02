import { NextResponse } from "next/server";
import { noStore } from "@/lib/notify/http";
import { applyUnsub, prefStoreFor } from "@/lib/notify/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { ...noStore, "Referrer-Policy": "no-referrer" };

const pageUrl = (token: string, done?: "on" | "off") => `/unsubscribe${token ? `?t=${encodeURIComponent(token)}${done ? `&done=${done}` : ""}` : ""}`;

/**
 * Doing the unsubscribe. The link in the List-Unsubscribe header of G10, G11, G12 and G15 points here (src/lib/notify/templates/unsubscribe.ts).
 *
 * GET changes nothing: mail scanners and link checkers open every link in an email, so a GET only sends the browser on to the
 * /unsubscribe page, where a person presses the button.
 * POST does it, with no sign-in and no cookie. The token in the link (t) is the only proof: it is signed (NOTIFY_UNSUB_SECRET) and says
 * who and which setting. Two kinds of caller:
 *   the mail app (RFC 8058 one-click: Gmail, Apple Mail): body List-Unsubscribe=One-Click, token in the address. Answers 200.
 *   the page's own button: a form with t, do (off or on) and from=page. Answers by sending the browser back to the page to show the result.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  return new Response(null, { status: 303, headers: { ...headers, Location: pageUrl(token) } });
}

export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get("t") ?? "";
  let on = false;
  let fromPage = false;
  try {
    const form = await req.formData();
    token = token || String(form.get("t") ?? "");
    on = form.get("do") === "on";
    fromPage = form.get("from") === "page";
  } catch {
    // Not a form (an empty or odd body): the token in the address is all that is needed.
  }
  const res = await applyUnsub(token, on, prefStoreFor());
  if (fromPage) return new Response(null, { status: 303, headers: { ...headers, Location: pageUrl(token, res.ok ? (on ? "on" : "off") : undefined) } });
  if (res.ok) return NextResponse.json({ ok: true, setting: res.setting, on: res.on }, { headers });
  const status = res.reason === "bad_link" ? 400 : res.reason === "no_person" ? 404 : 503;
  return NextResponse.json({ ok: false, error: res.reason === "bad_link" ? "This link is not valid" : res.reason === "no_person" ? "No such account" : "Not available right now" }, { status, headers });
}
