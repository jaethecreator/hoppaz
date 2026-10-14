import { notFound } from "next/navigation";
import JoinCrew from "@/components/crew-room/JoinCrew";

/** A crew's invite link: /crew/join/<invite code>. */
export default async function JoinCrewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[0-9a-z]{4,32}$/i.test(code)) notFound();
  return <JoinCrew code={code} />;
}
