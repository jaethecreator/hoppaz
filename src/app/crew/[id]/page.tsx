import { notFound } from "next/navigation";
import CrewHub from "@/components/crew-room/CrewHub";

/** One crew as a hub: /crew/<crew id>. Its room is /crew/<crew id>/room. */
export default async function CrewHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <CrewHub crewId={id} />;
}
