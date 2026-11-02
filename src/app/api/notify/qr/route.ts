import QRCode from "qrcode";

export const runtime = "nodejs";

/**
 * The QR picture a ticket email shows: GET /api/notify/qr?t=<ticket token> answers a PNG that encodes the token as it is (the same
 * picture the app draws on the ticket page). Mail apps do not reliably show data: images, so the email points at this address.
 *
 * The route only draws. It does not look anything up and does not check the signature (only the database holds the secret, and the door
 * scan is where a token is judged), so it can be asked about a made-up token and gives a picture of it, which nobody can get into an event
 * with. The token must look like one (two base64url parts joined by a dot, of sane length), so it is not a general QR maker.
 * The same token always gives the same picture, so it is cached for a year. No email address is ever in the address.
 */
const TOKEN = /^[A-Za-z0-9_-]{16,300}\.[A-Za-z0-9_-]{16,120}$/;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN.test(token)) return new Response("Not a ticket", { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const png = await QRCode.toBuffer(token, { type: "png", width: 480, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0E0B0A", light: "#FFFFFF" } });
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Could not draw it", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
