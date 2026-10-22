"use client";

import Link from "next/link";
import { useState } from "react";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import Switch from "@/components/events-r1/host/pops/Switch";
import { memberWord } from "@/components/events-r1/rooms/words";
import { Row, Section, SectionHead } from "./parts";

/**
 * Release 1: the walkable 3D room switch for every room, from api.rooms.listForDesk(). Off means chat only (Announcements, General
 * and event chats) and Enter room goes away. The real layer calls /api/admin/event-rooms with the desk's token (service role); in
 * fake mode it needs the dev panel's "Hoppaz Staff" signed in, like Event reports.
 */
export default function RoomsThreeDSection() {
  const api = useR1Api();
  const list = useR1Query((a) => a.rooms.listForDesk(), []);
  const [busy, setBusy] = useState("");
  const [fail, setFail] = useState("");

  const flip = async (id: string, on: boolean) => {
    if (!api || busy) return;
    setBusy(id);
    setFail("");
    try {
      await api.rooms.setThreeDFromDesk(id, on);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy("");
    }
  };

  const signedOut = list.error && /Sign in first|Not allowed/.test(list.error.message);

  return (
    <>
      <SectionHead title="Roomz 3D" hint="Switch the walkable 3D room on or off for each room. Off means chat only: Announcements, General and event chats." />
      {signedOut ? (
        <Section title="Staff sign in">
          <p className="hint">{api?.mode === "fake" ? "Sign in as Hoppaz Staff in /dev/events-r1 to try this." : "The rooms show here once you are signed in as Hoppaz staff."}</p>
          {api?.mode === "fake" && (
            <Link href="/dev/events-r1" className="btn btn-ghost mt-3 px-4 normal-case">
              Open the dev panel
            </Link>
          )}
        </Section>
      ) : list.error ? (
        <p role="alert" className="hint text-fireant">
          {list.error.message}
        </p>
      ) : (
        <>
          {(list.data ?? []).length > 0 && (
            <Section title="Rooms">
              {(list.data ?? []).map((r) => (
                <Row key={r.id} title={r.name} sub={`${r.kind === "hq" ? "Home room" : r.kind === "brand" ? "Brand room" : "Room"} · ${memberWord(r.members)} · ${r.has_3d ? `3D room: ${r.three_d_on ? "On" : "Off"}` : "No 3D room yet"}`}>
                  <Switch on={r.three_d_on} onChange={(on) => void flip(r.id, on)} disabled={!r.has_3d || busy === r.id} label={`3D room for ${r.name}: ${r.three_d_on ? "On" : "Off"}`} />
                </Row>
              ))}
            </Section>
          )}
          {!(list.data ?? []).length && <p className="hint">{list.loading ? "Loading" : "No rooms yet."}</p>}
          {fail && (
            <p role="alert" className="hint text-fireant">
              {fail}
            </p>
          )}
        </>
      )}
    </>
  );
}
