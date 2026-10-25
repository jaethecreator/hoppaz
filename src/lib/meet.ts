"use client";

import { getSupabase } from "./supabase/client";

/**
 * Speed Meet, the client half (supabase/speed_meet.sql). Every call is one RPC. A missing function (the SQL not run yet)
 * or no database answers "unavailable" so the screen can say so instead of failing.
 */

/** The same list as _meet_tag_ok in the SQL. The first eleven are the event vibes, so an interest can suggest an event. */
export const INTERESTS = [
  "afro", "amapiano", "rave", "techno", "live band", "comedy", "beach", "rooftop", "food", "culture", "tech",
  "games", "fitness", "art", "travel", "solo", "new in town",
] as const;
export const MAX_INTERESTS = 8;

export type MeetSession = {
  id: string;
  room: string;
  seconds_left: number;
  shared: string[];
  peer_name: string;
  my_choice: boolean | null;
};
export type MeetState =
  | { status: "waiting" | "idle" | "no_session" | "need_account" | "unavailable" }
  | { status: "matched"; session: MeetSession };

export type MeetEvent = { id: string; title: string; venue: string; starts_at: string; vibe: string };
export type Tonight = { waiting: number; live_meets: number; like_you: number; events: MeetEvent[] };

const rpc = async <T,>(name: string, args?: Record<string, unknown>): Promise<T | "unavailable"> => {
  const sb = getSupabase();
  if (!sb) return "unavailable";
  const { data, error } = await sb.rpc(name, args);
  return error ? "unavailable" : (data as T);
};

export const getInterests = async () => {
  const r = await rpc<string[]>("meet_my_interests");
  return r === "unavailable" ? null : r;
};
export const saveInterests = async (tags: string[]) => (await rpc<string>("meet_set_interests", { p_tags: tags })) === "ok";
export const joinQueue = async (): Promise<MeetState> => {
  const r = await rpc<MeetState>("meet_join");
  return r === "unavailable" ? { status: "unavailable" } : r;
};
export const pollQueue = async (): Promise<MeetState> => {
  const r = await rpc<MeetState>("meet_poll");
  return r === "unavailable" ? { status: "unavailable" } : r;
};
export const leaveQueue = async () => void (await rpc("meet_leave"));
export const choose = async (id: string, connect: boolean) => {
  const r = await rpc<string>("meet_choose", { p_id: id, p_connect: connect });
  return r === "unavailable" ? "unavailable" : r;
};
export const blockPeer = async (id: string) => (await rpc<boolean>("meet_block", { p_id: id })) === true;
export const reportPeer = async (id: string, reason: string) => (await rpc<boolean>("meet_report", { p_id: id, p_reason: reason })) === true;
export const suggestEvents = async (id: string) => {
  const r = await rpc<MeetEvent[]>("meet_suggest_events", { p_id: id });
  return r === "unavailable" ? [] : r;
};
export const getSession = async (id: string) =>
  rpc<MeetSession & { ended: boolean; dm_id: string | null; peer_choice: boolean | null }>("meet_session", { p_id: id });
export const getTonight = async () => {
  const r = await rpc<Tonight | null>("meet_tonight");
  return r === "unavailable" ? null : r;
};
