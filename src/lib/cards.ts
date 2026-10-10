"use client";

import { getSupabase } from "./supabase/client";

/**
 * The card deck (supabase/cards.sql). A box that may pay cards gives one inside
 * its claim, so after a claim the app asks which cards it gave (my_drop_cards)
 * and shows them in the reveal. The album and a card's page read through
 * definer functions; nothing here sees another Hopper's cards.
 */

export type CardTier = "common" | "rare" | "epic" | "legendary";

/** A card a claim just gave you: the prize, then any starters a first card in a set brings. */
export type DropCard = {
  key: string;
  name: string;
  tier: CardTier;
  set_key: string;
  set_name: string;
  fact: string;
  /** "7 of 10": the capped tiers (Rare, Epic, Legendary) only. */
  copy_no: number | null;
  copies_total: number | null;
  starter: boolean;
  /** XP added on top when pity lifted the card a tier. */
  xp_bonus: number;
  /** Your first copy of it. */
  new: boolean;
};

export type AlbumSet = { key: string; name: string; title: string; kind: "council" | "city" | "campus"; needed: number; total: number; owned: number; completion_no: number | null };
export type AlbumCard = {
  key: string;
  name: string;
  tier: CardTier;
  set_key: string;
  copies: number;
  copy_nos: number[];
  copies_total: number | null;
  visited: boolean;
  new_art: boolean;
};
export type Album = { sets: AlbumSet[]; cards: AlbumCard[] };

export type CardPage = {
  id: string;
  card: {
    key: string;
    set_key: string;
    set_name: string;
    person: boolean;
    name: string;
    fact: string;
    fact_source: string;
    lore: string | null;
    known_for: string | null;
    question: string | null;
    visit_tip: string | null;
    tier: CardTier;
    tier_reason: string | null;
    founders_call: boolean;
    lat: number;
    lng: number;
    radius_m: number;
    copies_total: number | null;
    art_kind: string;
    art_credit: string | null;
  };
  mine: { copies: number; visited: boolean; new_art: boolean; copy_nos: number[] } | null;
};

export const TIER_LABEL: Record<CardTier, string> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

/** "S1 · 7 of 10" for a numbered copy, otherwise nothing. */
export function copyLabel(c: { copy_no: number | null; copies_total: number | null }) {
  return c.copy_no && c.copies_total ? `S1 · ${c.copy_no} of ${c.copies_total}` : null;
}

/** The cards a claim of this box gave you. Empty when it paid XP only, or with no database. */
export async function loadDropCards(dropId: string): Promise<DropCard[]> {
  const sb = getSupabase();
  if (!sb || dropId.startsWith("demo-")) return [];
  const { data, error } = await sb.rpc("my_drop_cards", { p_drop: dropId });
  if (error || !Array.isArray(data)) return [];
  return data as DropCard[];
}

export async function loadAlbum(): Promise<Album | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_album");
  if (error || !data) return null;
  return data as Album;
}

/** One card's page. `seen` clears its new-art dot. */
export async function loadCard(key: string, seen = false): Promise<CardPage | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_card", { p_key: key, p_seen: seen });
  const r = data as ({ ok: boolean } & CardPage) | null;
  if (error || !r?.ok) return null;
  return r;
}

const STAMP_REFUSALS: Record<string, string> = {
  no_session: "Still connecting. Try again in a moment.",
  location_required: "Turn on location to stamp it.",
  gone: "This card is not in the deck any more.",
  not_yours: "Get this card from a box first.",
  no_fix: "Couldn't get a fresh location. Try again.",
  too_fast: "That was too fast to be on foot. Give it a minute.",
};

/**
 * I'M HERE: refresh the fix the server checks (play_tick keeps it, under two
 * minutes old), then stamp. Returns a line for the toast and the XP it paid.
 */
export async function stampVisit(cardId: string, fix: { lat: number; lng: number; accuracy?: number | null }) {
  const sb = getSupabase();
  if (!sb) return { ok: false, line: "No signal. Try again in a bit.", xp: 0 };
  await sb.rpc("play_tick", { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy ?? null });
  const { data, error } = await sb.rpc("stamp_visit", { p_card: cardId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy ?? null });
  const r = data as { ok: boolean; reason?: string; xp?: number; already?: boolean; distance_m?: number } | null;
  if (error || !r) return { ok: false, line: "That didn't stamp. Try again in a bit.", xp: 0 };
  if (!r.ok) {
    const line = r.reason === "too_far" ? `About ${Math.max(1, Math.round(r.distance_m ?? 0))} m to go.` : (STAMP_REFUSALS[r.reason ?? ""] ?? "That didn't stamp. Try again in a bit.");
    return { ok: false, line, xp: 0 };
  }
  if (r.already) return { ok: true, line: "Already stamped Visited.", xp: 0 };
  return { ok: true, line: r.xp ? `Visited. +${r.xp} XP.` : "Visited.", xp: r.xp ?? 0 };
}
