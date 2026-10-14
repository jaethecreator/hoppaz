import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in to use an invite." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Make an account before joining the private community." }, { status: 401 });

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9_-]{10,40}$/.test(code)) return NextResponse.json({ error: "Enter a valid invite code." }, { status: 400 });

  const { admin } = clients;
  const { data: existing, error: memberError } = await admin
    .from("queer_memberships").select("status").eq("user_id", user.id).maybeSingle();
  if (memberError) return NextResponse.json({ error: "Private community access is not set up yet." }, { status: 503 });
  if (existing?.status === "active") return NextResponse.json({ ok: true, alreadyMember: true });

  const tokenHash = createHash("sha256").update(code).digest("hex");
  const { data: invite, error: inviteError } = await admin
    .from("queer_invites").select("token_hash, uses, max_uses")
    .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (inviteError || !invite || invite.uses >= invite.max_uses) {
    return NextResponse.json({ error: "That invite code is invalid, expired, or already used." }, { status: 404 });
  }

  // Conditional update makes the use limit safe when several people redeem at once.
  const { data: consumed, error: consumeError } = await admin.from("queer_invites")
    .update({ uses: invite.uses + 1 })
    .eq("token_hash", tokenHash).eq("uses", invite.uses)
    .gt("expires_at", new Date().toISOString()).lt("uses", invite.max_uses)
    .select("token_hash").maybeSingle();
  if (consumeError || !consumed) return NextResponse.json({ error: "That invite code is invalid, expired, or already used." }, { status: 404 });

  const { error: joinError } = await admin.from("queer_memberships").upsert({ user_id: user.id, role: "member", status: "active" });
  if (joinError) return NextResponse.json({ error: "Could not activate this invite. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
