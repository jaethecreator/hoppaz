import { notFound } from "next/navigation";

/**
 * Development only: every event and hotspot room template as a still, and walkable with demo people
 * (http://localhost:3330/dev/room-templates?room=event-pool&mode=walk). Production builds answer 404.
 */
export default async function DevRoomTemplatesPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevRoomTemplates } = await import("./DevRoomTemplates");
    return <DevRoomTemplates />;
  }
}
