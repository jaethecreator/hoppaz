import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { bearerFrom, getPermanentUser, getQueerServerClients } from "@/lib/queerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const clients = getQueerServerClients(bearerFrom(request));
  if (!clients) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const user = await getPermanentUser(clients.auth);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { admin } = clients;
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const body = await request.json().catch(() => null) as { uses?: unknown; days?: unknown } | null;
  const maxUses = Number.isInteger(body?.uses) ? Math.max(1, Math.min(20, body!.uses as number)) : 1;
  const days = Number.isInteger(body?.days) ? Math.max(1, Math.min(90, body!.days as number)) : 14;
  // 12 URL-safe characters; only the SHA-256 digest is stored in the database.
  const code = randomBytes(9).toString("base64url").toUpperCase();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await admin.from("queer_invites").insert({
    token_hash: createHash("sha256").update(code).digest("hex"),
    created_by: user.id,
    max_uses: maxUses,
    expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ error: "Could not create an invite. Apply the queer community database setup first." }, { status: 503 });
  return NextResponse.json({ code, expiresAt, maxUses });
}
