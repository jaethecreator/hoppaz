"use client";

import RequireAccount from "@/components/app/RequireAccount";
import RoomzTab from "@/components/events-r1/rooms/RoomzTab";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import RoomsPage from "./RoomsPage";

/** ROOMZ, the middle tab. Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function CrewPage() {
  // Release 1: the new ROOMZ tab asks for an account only when it is needed (Join, chat), through its own sign in.
  if (EVENTS_R1) return <RoomzTab />;
  return (
    <RequireAccount title="Roomz." caption="Make an account to join roomz, plan moves together and keep your group chats.">
      <RoomsPage />
    </RequireAccount>
  );
}
