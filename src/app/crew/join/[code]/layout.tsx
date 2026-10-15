import type { Metadata } from "next";
import { loadShareCrew, siteOrigin } from "@/app/api/og/_lib";

/**
 * What a shared crew invite looks like in WhatsApp, X and iMessage: the crew's name and its card. The page is a
 * client component, so the tags live here. A code that no longer works keeps the site's own card.
 */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const crew = await loadShareCrew(code);
  if (!crew) return { robots: { index: false } };
  const origin = await siteOrigin();
  const title = `Join ${crew.brand} on Hoppaz`;
  const description = `${crew.members} ${crew.members === 1 ? "member" : "members"}${crew.in_room ? `, ${crew.in_room} in the room now` : ""}. Walk into the crew room, chat and find the next night out.`;
  const url = `${origin}/crew/join/${encodeURIComponent(code)}`;
  const image = `${origin}/api/og/crew/${encodeURIComponent(code)}?v=${crew.members}-${crew.in_room}`;
  return {
    metadataBase: new URL(origin),
    title,
    description,
    // An invite is for the people it was sent to: not for search engines.
    robots: { index: false },
    openGraph: {
      type: "website",
      siteName: "Hoppaz",
      locale: "en_NG",
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: `${crew.brand} on Hoppaz` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
