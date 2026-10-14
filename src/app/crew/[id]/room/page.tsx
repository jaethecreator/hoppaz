import { notFound } from 'next/navigation';
import CrewRoomScreen from '@/components/crew-room/CrewRoomScreen';
export default async function CrewRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <CrewRoomScreen crewId={id} />;
}
