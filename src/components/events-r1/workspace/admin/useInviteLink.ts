"use client";

import { useR1Query } from "@/lib/events-r1/hooks";
import { siteOrigin } from "@/lib/events-r1/siteUrl";
import type { RoomSummary } from "@/lib/events-r1/types";

/** The invite link of a room: its address, with the invite code on it for an Invite only room (the code is the key there). */
export function useInviteLink(room: RoomSummary | null): { url: string; shown: string } {
  const code = useR1Query((a) => (room && room.join_mode === "invite" ? a.rooms.inviteCode(room.id) : Promise.resolve(null)), [room?.id, room?.join_mode]);
  if (!room) return { url: "", shown: "" };
  const base = `${siteOrigin()}/r/${room.slug}`;
  const url = room.join_mode === "invite" && code.data ? `${base}?invite=${encodeURIComponent(code.data)}` : base;
  return { url, shown: url.replace(/^https?:\/\//, "") };
}
