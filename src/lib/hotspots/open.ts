"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { requireAccount } from "@/lib/accountGate";
import { appNavigate } from "@/lib/appNav";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";

/**
 * What is open of the hotspots on the map: a hotspot's sheet, the list of all of them, the room. One small store, so a
 * pin, a chip, a list row, a deep link or a tile in the crew hub all go in the same way (components/hotspots/MainHotspots
 * is the one place that draws it).
 */
type HotspotNav = {
  /** The slug whose sheet is open. */
  sheet: string | null;
  /** The list of open hotspots is open. */
  list: boolean;
  /** The slug whose room is open (the Hopper is in it). */
  room: string | null;
};

export const useHotspotNav = create<HotspotNav>(() => ({ sheet: null, list: false, room: null }));

const slugOf = (slug: string) => slug.trim().toLowerCase();

/** Look at a hotspot: its sheet (name, who is there, ENTER). Anyone can, signed in or not. */
export function peekHotspot(slug: string) {
  useHotspotNav.setState({ sheet: slugOf(slug), list: false });
}

/** The list of open hotspots. */
export function showHotspotList() {
  useHotspotNav.setState({ list: true, sheet: null });
}

/** Put the sheet and the list away (a tap on the bare map, a tap on an event, Escape). Leaves a room that is open alone. */
export function closeHotspots() {
  const s = useHotspotNav.getState();
  if (s.sheet || s.list) useHotspotNav.setState({ sheet: null, list: false });
}

/** The room pushed one history entry, so the phone's back button leaves the room and not the map. */
let pushed = false;

/** Leave the room. */
export function leaveHotspot() {
  if (!useHotspotNav.getState().room) return;
  useHotspotNav.setState({ room: null });
  if (pushed) {
    pushed = false;
    try {
      window.history.back();
    } catch {
      /* nothing to pop */
    }
  }
}

/** The map page went away with something open: drop it all without touching history. */
export function resetHotspots() {
  pushed = false;
  useHotspotNav.setState({ sheet: null, list: false, room: null });
}

/** Mount once: the phone's back button leaves a room instead of leaving the map. */
export function useHotspotBackButton() {
  useEffect(() => {
    const onPop = () => {
      if (!useHotspotNav.getState().room) return;
      pushed = false; // the browser already popped our entry
      useHotspotNav.setState({ room: null });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}

/**
 * The map still registers its router here (it is the same router the layout hands to lib/appNav); with none registered a
 * hotspot link goes through appNavigate, which is a move inside the app too, never a page load from another tab.
 */
let navigate: ((href: string) => void) | null = null;
export function setHotspotNavigator(fn: (href: string) => void) {
  navigate = fn;
  return () => {
    if (navigate === fn) navigate = null;
  };
}

/** Does this hotspot have a room drawn (the room-templates rooms at /room/<slug>)? */
export const hasHotspotRoom = (slug: string) => !!hotspotRoomData(slugOf(slug));

/**
 * THE way into a hotspot: a pin, the "Your home base" chip, a list row, the /?hotspot= link and the first run's home base
 * card all go through here, so there is one place to change where a hotspot leads.
 *
 * It opens the hotspot's own room, /room/<slug>, when one is drawn (all thirteen are). For a hotspot with no room yet it
 * falls back to the sheet, whose ENTER opens the crossroads chat screen (enterCrossroads below).
 */
export function openHotspot(slug: string): boolean {
  const s = slugOf(slug);
  if (hasHotspotRoom(s)) {
    const href = `/room/${s}`;
    if (navigate) navigate(href);
    else appNavigate(href);
    return true;
  }
  peekHotspot(s);
  return true;
}

/**
 * ENTER on a sheet (a hotspot with no room drawn): the crossroads chat screen over the map, the way hotspots worked before
 * the rooms (components/hotspots/HotspotRoom). Browsing is open to everyone; being in a room needs an account, so a guest
 * goes to the account page and comes back to this screen. The room asks the 18 and over question itself. Returns false
 * when the Hopper was sent to sign up.
 */
export function enterCrossroads(slug: string): boolean {
  if (!requireAccount("enter a hotspot")) return false;
  try {
    // Spread the current state so Next's own bookkeeping on the entry survives.
    window.history.pushState({ ...(window.history.state ?? {}), hzHotspot: true }, "");
    pushed = true;
  } catch {
    pushed = false;
  }
  useHotspotNav.setState({ room: slugOf(slug), sheet: null, list: false });
  return true;
}
