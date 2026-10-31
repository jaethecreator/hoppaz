import { headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * Development only: every guest and host email with sample data (http://localhost:3000/dev/emails), as the HTML a mail app gets and as the
 * plain text, at phone or desktop width. Nothing is sent. Production builds answer 404, and the page is imported inside the development
 * branch, so a production build leaves it (and the sample data) out.
 */
export default async function DevEmailsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const [{ default: DevEmails }, { renderSamples, SAMPLE_USER }, { unsubSecret }] = await Promise.all([
      import("./DevEmails"),
      import("@/lib/notify/templates/samples"),
      import("@/lib/notify/unsubToken"),
    ]);
    // Images in the emails (the wordmark, the QR) are loaded from this very server, so what you see here is what the routes really draw.
    const host = (await headers()).get("host");
    const site = host ? `http://${host}` : undefined;
    // With NOTIFY_UNSUB_SECRET set the unsubscribe links of G10, G11, G12 and G15 are the real signed ones (for a made-up person); without it,
    // a clearly fake address so the link can still be seen.
    const samples = unsubSecret()
      ? renderSamples({ site, userId: SAMPLE_USER })
      : renderSamples({ site, unsubscribeUrl: `${site ?? "http://localhost"}/unsubscribe/preview-only` });
    return <DevEmails samples={samples.map((s) => ({ label: s.label, kind: s.kind, to: s.to, ...s.email }))} />;
  }
}
