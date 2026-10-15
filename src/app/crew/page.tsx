"use client";

import RequireAccount from "@/components/app/RequireAccount";
import RoomsPage from "./RoomsPage";

/** ROOMZ, the middle tab. Needs an account: anonymous Hoppers get the sign-up here instead. */
export default function CrewPage() {
  return (
    <RequireAccount title="Roomz." caption="Make an account to join roomz, plan moves together and keep your group chats.">
      <RoomsPage />
    </RequireAccount>
  );
}
