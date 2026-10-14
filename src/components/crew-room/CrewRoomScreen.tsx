'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import RequireAccount from '@/components/app/RequireAccount';
import CampaignExperience from '@/components/campaign/CampaignExperience';
import { useCrewRoom } from '@/lib/crew-room/useCrewRoom';
import { useSession } from '@/lib/useSession';
import type { CrewRoomConnection } from '@/lib/crew-room/types';
import { clubhouseWidth, type PrivateArea } from '@/lib/campaign/layout';
import type { Tile } from '@/lib/campaign/geometry';
import CrewRoomChat from './CrewRoomChat';
import css from './CrewRoom.module.css';

export default function CrewRoomScreen({ crewId }: { crewId: string }) {
  return <RequireAccount title="Your crew has a place." caption="Sign in to enter your crew room, meet your people and join the conversation."><ConnectedRoom crewId={crewId} /></RequireAccount>;
}
function ConnectedRoom({ crewId }: { crewId: string }) {
  const { userId } = useSession();
  const room = useCrewRoom(crewId,userId);
  return <CrewRoomView crewId={crewId} userId={userId} room={room} />;
}
export function CrewRoomView({ crewId, userId, room }: { crewId: string; userId: string | null; room: CrewRoomConnection }) {
  const [chatOpen,setChatOpen] = useState(false);
  const [chatMode,setChatMode] = useState<'general' | 'nearby'>('general');
  const [destination,setDestination] = useState<Tile | null>(null);
  const destinationHandled = useCallback(() => setDestination(null),[]);
  const visitArea = useCallback((area: PrivateArea) => { setDestination(area.stop);setChatMode('nearby'); },[]);
  const chatTrigger = useRef<HTMLButtonElement>(null);
  const closeChat = useCallback(() => { setChatOpen(false);chatTrigger.current?.focus(); },[]);
  if (room.status!=='ready' || !room.snapshot || !room.world || !userId) return <div className={css.gate}>
    <h1>{room.status==='loading' ? 'Opening your crew room…' : 'This room could not open.'}</h1>
    <p role={room.status==='loading' ? 'status' : 'alert'}>{room.status==='loading' ? 'Finding your crew and its conversation.' : room.error}</p>
    <nav>{room.status==='error' && <button type="button" onClick={room.retry}>Try again</button>}<Link href="/crew">Back to your crews</Link></nav>
  </div>;
  const area = clubhouseWidth(room.snapshot.room.width).privateAreas.find((a) => a.id===room.world?.areaId);
  return <CampaignExperience crew={{
    id:crewId, name:room.snapshot.crew.name, content:room.snapshot.room.content, width:room.snapshot.room.width,
    editable:room.snapshot.crew.is_owner, connected:room.connected, world:{...room.world,destination,onDestinationHandled:destinationHandled,onConversation:() => {setChatMode('nearby');setChatOpen(true);}},
    caption:`Crew room · ${room.snapshot.peers.length} here`, chatOpen,
    chatButton:<button ref={chatTrigger} type="button" onClick={() => {setChatMode(area ? 'nearby' : 'general');setChatOpen((value) => !value);}} aria-label="Open crew chat" aria-expanded={chatOpen}><MessageCircle size={17} aria-hidden /><span>Chat</span></button>,
    chat:<CrewRoomChat room={room} userId={userId} open={chatOpen} onClose={closeChat} mode={chatMode} onMode={setChatMode} onVisit={visitArea} />,
    onSave:(content,width) => room.save(width,content),
  }} />;
}
