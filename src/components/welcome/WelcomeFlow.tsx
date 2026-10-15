"use client";

/* eslint-disable @next/next/no-img-element -- remote event flyers of unknown size, shown small */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { MapPin, Shuffle } from "lucide-react";
import AreaPicker from "@/components/AreaPicker";
import Avatar from "@/components/Avatar";
import Mascot from "@/components/Mascot";
import Wordmark from "@/components/Wordmark";
import { goToAccount } from "@/lib/accountGate";
import { SKINS, normalizeLook, randomLook, type Look } from "@/lib/avatar";
import { TAGLINE } from "@/lib/brand";
import { nearestArea, insideLagos } from "@/lib/geo";
import { hereLabel } from "@/lib/hotspots/geometry";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { useHoppaz, useToast } from "@/lib/store";
import { isTestHost } from "@/lib/testHost";
import { useEvents } from "@/lib/useEvents";
import { useSession } from "@/lib/useSession";
import { welcomeNeedsAccount, useWelcome } from "@/lib/welcome";
import RoomView, { roomSlugFor } from "./RoomView";

// The hotspot's own chat room (aliases, the 18+ question, the reports): the same one the map opens.
const HotspotRoom = dynamic(() => import("@/components/hotspots/HotspotRoom"), { ssr: false });

type View = "splash" | "place" | "peek" | "look" | "stepin" | "spawn";
const DOTS: ReadonlyArray<View> = ["place", "peek", "look", "stepin", "spawn"];

const kmAway = (m: number) => `${m < 10_000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)} km away`;

/**
 * The first run, the room part (docs/UI-UPGRADE.md section 2): where you are, a look into the nearest hotspot room, your
 * Hopper, STEP IN (the sign-up), then you are in the room and Paz points at the door to the map. The tour that follows is
 * on the map (WelcomeTour). Every step has Skip; Skip ends the welcome for good.
 */
export default function WelcomeFlow() {
  const router = useRouter();
  const { hasAccount, profile, state: sessionState, patchProfile } = useSession();
  const { fix, setFix, look: storedLook } = useHoppaz();
  const say = useToast((s) => s.say);
  const { step: saved, ready, hydrate, go, finish, restart } = useWelcome();

  const [view, setView] = useState<View | null>(null);
  const [picking, setPicking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => hydrate(), [hydrate]);

  const show = useCallback(
    (v: View) => {
      // Once you are in the room, the part that comes next is the map tour: that is where a reload or the door lands.
      go(v === "spawn" ? "tour" : v);
      setView(v);
    },
    [go]
  );
  const leave = useCallback(() => {
    finish();
    router.replace("/");
  }, [finish, router]);

  // Where to start: where they left off, the sign-up they came back from, or the splash.
  useEffect(() => {
    if (view || !ready || sessionState === "loading") return;
    if (isTestHost() && new URLSearchParams(window.location.search).has("welcome")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      restart();
      show("splash");
      return;
    }
    if (saved === "done") return void router.replace("/");
    if (saved === "tour") return setView("spawn");
    if (saved === "stepin") return show(hasAccount || !welcomeNeedsAccount() ? "spawn" : "stepin");
    if (saved === "place" || saved === "peek" || saved === "look") return setView(saved);
    show("splash");
  }, [view, ready, sessionState, saved, hasAccount, router, show, restart]);

  /* ---------------------------------------------------------------- the nearest room -- */
  const at = useMemo(() => (fix && insideLagos(fix.lat, fix.lng) ? { lat: fix.lat, lng: fix.lng } : null), [fix]);
  const hs = useHotspots({ active: view === "peek" || view === "stepin" || view === "spawn", at });
  const slug = roomSlugFor(at ? hs.yours?.slug : null);
  const data = hotspotRoomData(slug);
  const nearest = hs.bySlug(slug);

  /* -------------------------------------------------------------- the one-off effects -- */
  // A new account's Hopper: the look they made goes on their profile (never over one that is already there).
  const looked = useRef(false);
  useEffect(() => {
    if (looked.current || view !== "spawn" || !hasAccount || !storedLook || profile?.avatar) return;
    looked.current = true;
    void patchProfile({ avatar: storedLook });
  }, [view, hasAccount, storedLook, profile?.avatar, patchProfile]);

  // The location came in while they were on the ask: on to the room.
  const hadFix = useRef(!!fix);
  useEffect(() => {
    if (view === "place" && fix && !hadFix.current) show("peek");
    if (view !== "place") hadFix.current = !!fix;
  }, [view, fix, show]);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return setPicking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const near = nearestArea(lat, lng);
        setFix({ lat, lng, source: "gps", area: near.name });
      },
      () => {
        say("Could not find you. Pick your area instead.");
        setPicking(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 }
    );
  };

  const stepIn = (mode: "create" | "login") => {
    if (!welcomeNeedsAccount() || hasAccount) return show("spawn");
    // Back from the sign-up lands on /welcome again and carries on from here.
    go("stepin");
    goToAccount("step into the room", mode);
  };

  if (!view) return <div className="h-full bg-ink" />;

  const dot = DOTS.indexOf(view);
  return (
    <div className="absolute inset-0 flex flex-col bg-ink text-cream">
      {view !== "splash" && (
        <header className="pad-top flex flex-none items-center justify-between gap-3 px-4 pb-2">
          <div className="flex items-center gap-1.5" role="img" aria-label={`Step ${dot + 1} of ${DOTS.length}`}>
            {DOTS.map((d, i) => (
              <i key={d} aria-hidden className={clsx("h-1.5 rounded-full transition-all", i === dot ? "w-6 bg-orange" : i < dot ? "w-1.5 bg-orange/60" : "w-1.5 bg-line")} />
            ))}
          </div>
          {view !== "spawn" && (
            <button type="button" onClick={leave} className="min-h-[44px] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim">
              Skip
            </button>
          )}
        </header>
      )}

      {view === "splash" && <Splash onDone={() => show(fix ? "peek" : "place")} />}

      {view === "place" && <Place fix={fix} onLocate={useMyLocation} onPick={() => setPicking(true)} />}

      {view === "peek" && (
        <>
          <div className="flex-none px-4 pb-3 pt-1">
            <p className="seclabel">THE NEAREST ROOM</p>
            <h1 className="mt-1 font-display text-[30px] font-black uppercase leading-[1.05]">{data?.junction ?? "Your hotspot"}</h1>
            <p className="hint mt-1">
              {data?.welcome ?? "A room at a real Lagos junction."}
              {nearest && nearest.status === "open" ? ` ${hereLabel(nearest)}.` : ""}
            </p>
          </div>
          <div className="min-h-0 flex-1 border-y border-line">
            <RoomView slug={slug} lookOnly />
          </div>
          <Footer>
            <button type="button" className="btn w-full" onClick={() => show("look")}>
              MAKE YOUR HOPPER
            </button>
          </Footer>
        </>
      )}

      {view === "look" && <LookStep onDone={() => show(hasAccount || !welcomeNeedsAccount() ? "spawn" : "stepin")} />}

      {view === "stepin" && (
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-6">
          <div className="grid flex-1 place-items-center">
            <div className="text-center">
              <Mascot state="welcome" size={150} className="mx-auto" />
              <h1 className="mt-3 font-display text-[34px] font-black uppercase leading-[1.02]">Step into {data?.junction ?? "the room"}.</h1>
              <p className="hint mx-auto mt-2 max-w-[300px]">Make an account to walk in, meet people near you and see what is on tonight.</p>
            </div>
          </div>
          <button type="button" className="btn w-full" onClick={() => stepIn("create")}>
            STEP IN
          </button>
          <button type="button" className="mt-2 min-h-[44px] w-full font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim" onClick={() => stepIn("login")}>
            I already have an account
          </button>
        </div>
      )}

      {view === "spawn" && (
        <>
          <div className="relative min-h-0 flex-1">
            <RoomView slug={slug} />
            <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line bg-ink-2/95 px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] backdrop-blur">
              New Hopper in {data?.junction ?? "the room"}
            </p>
          </div>
          <div className="flex-none border-t border-line bg-ink-2 px-4 pb-4 pt-3">
            <div className="flex items-start gap-3">
              <Mascot state="point" size={64} className="flex-none" />
              <p className="min-w-0 flex-1 font-body text-[15px] leading-snug">
                {data?.paz ?? "Welcome in."} This is the spot closest to you. Chat with people near you, or head out to see what&apos;s on tonight.
              </p>
            </div>
            <button type="button" className="btn mt-3 w-full" onClick={() => router.push("/")}>
              SEE WHAT&apos;S ON TONIGHT
            </button>
            <button type="button" className="mt-1 min-h-[44px] w-full font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim" onClick={() => setChatOpen(true)}>
              Open the room chat
            </button>
          </div>
          {chatOpen && <HotspotRoom slug={slug} name={data?.junction} onLeave={() => setChatOpen(false)} />}
        </>
      )}

      <AreaPicker open={picking} onClose={() => setPicking(false)} onPicked={() => setPicking(false)} />
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex-none px-4 pb-5 pt-3">{children}</div>;
}

/** About 2 seconds of the city at night, no buttons. A tap goes on. */
function Splash({ onDone }: { onDone: () => void }) {
  // The timer runs once, whatever the parent re-renders.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), 2000);
    return () => clearTimeout(t);
  }, []);
  return (
    <button type="button" onClick={onDone} aria-label="Continue" className="grid flex-1 place-items-center px-6 text-center">
      <span className="block">
        <Wordmark size={46} tone="cream" />
        <span className="mt-4 block font-mono text-[11px] font-medium tracking-[0.18em] text-cream">{TAGLINE}</span>
        <Mascot state="welcome" size={150} className="mx-auto mt-6" />
      </span>
    </button>
  );
}

/** "Set your location to get started", with what is on near you. Real flyers; "2 km away" once we know where you are. */
function Place({ fix, onLocate, onPick }: { fix: { lat: number; lng: number; area: string | null } | null; onLocate: () => void; onPick: () => void }) {
  const { events, ready } = useEvents(fix, 8);
  const flyers = useMemo(
    () =>
      events
        .filter((e) => !!e.flyer_url && /^https?:\/\//i.test(e.flyer_url))
        .sort((a, b) => (fix ? a.distance_m - b.distance_m : b.heat - a.heat))
        .slice(0, 3),
    [events, fix]
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-6">
      <div className="min-h-0 flex-1 overflow-y-auto pt-2">
        <h1 className="font-display text-[34px] font-black uppercase leading-[1.02]">Set your location to get started.</h1>
        <p className="hint mt-2">So Lagos can show you what is on near you tonight.</p>
        <div className="mt-5 grid grid-cols-3 gap-2.5" aria-label="On near you">
          {flyers.length > 0
            ? flyers.map((e) => (
                <div key={e.id}>
                  <div className="relative aspect-[3/4] overflow-hidden rounded-hz border border-line bg-ink-3">
                    {/* The name sits under the flyer: it is what shows when the flyer does not load. */}
                    <span className="absolute inset-0 grid place-items-center p-2 text-center font-display text-[12px] font-black uppercase leading-tight text-cream/80">{e.title}</span>
                    <img src={e.flyer_url ?? ""} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={(ev) => (ev.currentTarget.style.display = "none")} />
                  </div>
                  <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-dim">{fix ? kmAway(e.distance_m) : e.area ?? "Lagos"}</p>
                </div>
              ))
            : [0, 1, 2].map((i) => (
                <div key={i} className={clsx("aspect-[3/4] rounded-hz border border-line bg-ink-3", !ready && "animate-pulse")} aria-hidden />
              ))}
        </div>
      </div>
      <button type="button" className="btn mt-4 w-full" onClick={onLocate}>
        <MapPin size={16} strokeWidth={2.6} aria-hidden /> USE MY LOCATION
      </button>
      <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onPick}>
        PICK MY AREA
      </button>
    </div>
  );
}

/** Your Hopper: shuffle and a skin tone here; the whole wardrobe is in Me. */
function LookStep({ onDone }: { onDone: () => void }) {
  const { hasAccount, profile, patchProfile } = useSession();
  const stored = useHoppaz((s) => s.look);
  const setLook = useHoppaz((s) => s.setLook);
  const [look, setDraft] = useState<Look>(() => normalizeLook(profile?.avatar ?? stored ?? randomLook()));
  const [saving, setSaving] = useState(false);
  const done = async () => {
    if (saving) return;
    setSaving(true);
    setLook(look);
    if (hasAccount) await patchProfile({ avatar: look });
    onDone();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-6">
      <div className="pt-1">
        <h1 className="font-display text-[34px] font-black uppercase leading-[1.02]">Make your Hopper.</h1>
        <p className="hint mt-1">Shuffle till it feels like you. You can dress it properly later, in Me.</p>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center py-3">
        <div className="h-full max-h-[300px] w-[200px] rounded-hz border border-line bg-ink-3 p-3">
          <Avatar look={look} label="Your Hopper" />
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5" role="radiogroup" aria-label="Skin tone">
        {SKINS.map((hex, i) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={look.skin === i}
            aria-label={`Skin tone ${i + 1}`}
            onClick={() => setDraft({ ...look, skin: i })}
            className={clsx("h-8 w-8 flex-none rounded-full border-2", look.skin === i ? "border-orange" : "border-line")}
            style={{ background: hex }}
          />
        ))}
      </div>
      <button type="button" className="btn btn-ghost mt-4 w-full" onClick={() => setDraft(randomLook())}>
        <Shuffle size={16} strokeWidth={2.4} aria-hidden /> SHUFFLE
      </button>
      <button type="button" className="btn mt-2 w-full" disabled={saving} onClick={done}>
        THIS IS ME
      </button>
    </div>
  );
}
