"use client";

/* eslint-disable @next/next/no-img-element -- a room logo is a bucket link of unknown size */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { initials } from "@/components/events-r1/workspace/admin/ui";
import { useR1Api, useR1Auth, useR1Query } from "@/lib/events-r1/hooks";
import type { TransferPreview } from "@/lib/events-r1/types";
import DeadLink from "./DeadLink";
import type { DeadReason } from "./DeadLink";
import EventPreview from "./EventPreview";
import { mayMatchHint, reasonText, SUPPORT_EMAIL, whenLagos } from "./words";

type Ok = Extract<TransferPreview, { ok: true }>;

const SHOW_EVENTS = 5;

/** What they get. Honest about payouts: a Bachs setup comes first. */
const GETS = [
  "Run your room: members, announcements and your own page",
  "Set real tickets and sell them on Hoppaz",
  "Guest list and door check in",
  "Messages to your guests",
  "Payouts need a Bachs setup. You do it under Payouts in your room when you are ready to be paid",
];

function Section({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section className="card mt-4" aria-label={label ?? title}>
      <h2 className="font-display text-[16px] font-black">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * /claim/<token>. What an organiser sees when they open the link we sent: the room they are being handed, the events lined up,
 * what they get, how their page looks today, and one button. It knows only the TransferPreview (never the full email, never
 * anything private). A link that cannot be used gets a plain page with the reason and our email.
 */
export default function ClaimPage({ token }: { token: string }) {
  const api = useR1Api();
  const router = useRouter();
  const { user, ready, signOut } = useR1Auth();
  const me = user ?? api?.auth.current() ?? null;
  const preview = useR1Query((a) => a.claims.preview(token), [token]);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [went, setWent] = useState(false);
  const plain = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full min-w-0 max-w-xl">{children}</div>
    </div>
  );

  // Accepted: the link is used up now, so the preview would say so. Show the way on instead.
  if (went) return plain(<p className="hint pad-top">Done. Taking you to your room</p>);
  if (!ready || preview.loading) return plain(<p className="hint pad-top">Loading</p>);
  const p = preview.data;
  if (preview.error || !p) {
    return plain(
      <div className="pad-top">
        <h1 className="font-display text-[26px] font-black leading-tight">We could not open this link</h1>
        <p className="mt-2 font-body text-[15px] text-dim">Check your connection and try again.</p>
        <button type="button" className="btn mt-5 px-5 normal-case" onClick={() => void preview.reload()}>
          Try again
        </button>
        <p className="hint mt-6">
          Still stuck? Write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-cream underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }
  if (!p.ok) return plain(<DeadLink reason={p.reason as DeadReason} signedIn={!!me} />);

  return plain(
    <Card
      p={p}
      busy={busy}
      error={error}
      email={me?.email ?? null}
      asked={asked}
      onAsk={setAsked}
      onSignOut={async () => {
        setError("");
        await signOut();
        setAsked(true);
      }}
      onAccept={async () => {
        if (!api || busy || went) return;
        setBusy(true);
        setError("");
        try {
          const out = await api.claims.accept(token);
          setWent(true);
          const q = new URLSearchParams({ welcome: "1", moved: String(out.moved_events) });
          if (out.already_owned_other) q.set("also", "1");
          router.replace(`/rooms/${encodeURIComponent(out.slug)}/admin?${q.toString()}`);
        } catch (e) {
          setError(reasonText(e));
          // The link may have been used or cancelled while this page was open: show the real state.
          if (/already used|cancelled|expired|not valid/i.test(reasonText(e))) void preview.reload();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

function Card({
  p,
  busy,
  error,
  email,
  asked,
  onAsk,
  onSignOut,
  onAccept,
}: {
  p: Ok;
  busy: boolean;
  error: string;
  email: string | null;
  asked: boolean;
  onAsk: (v: boolean) => void;
  onSignOut: () => void;
  onAccept: () => void;
}) {
  const { room, events } = p;
  const claim = p.kind === "claim";
  const wrong = !!email && !mayMatchHint(email, p.email_hint);
  const more = events.length - SHOW_EVENTS;
  const first = events[0];

  return (
    <div className="pad-top" data-claim-ok>
      <p className="seclabel">{claim ? "Your room is ready" : "Room handover"}</p>
      <h1 className="mt-2 font-display text-[26px] font-black leading-tight">{claim ? `Take over ${room.name}` : `${room.name} is being handed to you`}</h1>
      <p className="mt-2 font-body text-[15px] text-dim">
        {claim
          ? "We listed your events on Hoppaz so people can find them. Take over the room to run them yourself."
          : "The owner wants you to run this room from now on. They stay as a member."}
      </p>

      <section className="card mt-5 flex items-start gap-3" aria-label="The room">
        {room.logo_url ? (
          <img src={room.logo_url} alt="" className="h-14 w-14 flex-none rounded-hz border border-line object-cover" />
        ) : (
          <span className="grid h-14 w-14 flex-none place-items-center rounded-hz bg-ink-3 font-display text-[20px] font-black text-dim" aria-hidden>
            {initials(room.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[18px] font-black leading-tight">{room.name}</p>
          {room.about.trim() && <p className="mt-1 line-clamp-4 font-body text-[14px] text-dim">{room.about}</p>}
        </div>
      </section>

      <Section title={events.length === 1 ? "The event lined up for you" : "The events lined up for you"} label="Events">
        {events.length === 0 ? (
          <p className="font-body text-[14px] text-dim">No events coming up right now. You can add your own once the room is yours.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {events.slice(0, SHOW_EVENTS).map((e) => (
              <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-body text-[15px] font-bold leading-snug">{e.title}</p>
                <p className="font-body text-[13px] text-dim">{whenLagos(e.starts_at)}</p>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && <p className="hint mt-2">and {more} more</p>}
      </Section>

      <section className="card mt-4" aria-label="Accept">
        <p className="mb-4 font-body text-[14.5px] leading-snug" data-claim-change>
          <b>What changes:</b>{" "}
          {claim
            ? `the page says Hosted by ${room.name} instead of Listed by Hoppaz. Get tickets keeps going to the same page until you switch on Hoppaz tickets.`
            : `you become the owner of ${room.name}. The person handing it over stays as a member.`}
        </p>
        <p className="font-body text-[14px] text-dim">
          This link is for <b className="text-cream">{p.email_hint}</b>
        </p>

        {!email && (
          <>
            <p className="mt-1 font-body text-[14px] text-dim">Sign in with that email to accept. No account yet? Signing in makes one.</p>
            <button type="button" className="btn mt-4 w-full normal-case" onClick={() => onAsk(true)}>
              Sign in to accept
            </button>
          </>
        )}

        {email && wrong && (
          <>
            <p className="mt-3 font-body text-[14.5px]" role="alert" data-claim-wrong>
              You are signed in as <b>{email}</b>, but this link is for {p.email_hint}.
            </p>
            <button type="button" className="btn mt-4 w-full normal-case" onClick={onSignOut}>
              Sign out and sign in again
            </button>
            <button type="button" className="btn btn-ghost mt-2 w-full normal-case" disabled>
              {claim ? "Accept and take over" : "Accept the room"}
            </button>
          </>
        )}

        {email && !wrong && (
          <>
            <p className="mt-1 font-body text-[14px] text-dim">You are signed in as {email}.</p>
            <button type="button" className="btn mt-4 w-full normal-case" onClick={onAccept} disabled={busy}>
              {busy ? "Taking over" : claim ? "Accept and take over" : "Accept the room"}
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 font-body text-[14px] text-fireant" data-claim-error>
            {error}
          </p>
        )}
        <p className="hint mt-3">The link works once and runs out on {new Date(p.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}.</p>
      </section>

      <Section title="What you get">
        <ul className="flex flex-col gap-2">
          {GETS.map((g) => (
            <li key={g} className="flex gap-2.5 font-body text-[14.5px] leading-snug">
              <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-orange" aria-hidden />
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={claim ? "Your event page today" : "What the page says"} label="Preview">
        <p className="hint">{claim ? "This is how people see it right now." : "Nothing on the page changes for guests."}</p>
        <EventPreview title={first?.title ?? room.name} startsAt={first?.starts_at ?? p.expires_at} roomName={room.name} kind={claim ? "claim" : "handover"} />
      </Section>

      <p className="hint mt-4">
        Not you, or something looks wrong? Write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Room link for ${room.name}`)}`} className="text-cream underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        . Or{" "}
        <Link href="/" className="text-cream underline underline-offset-4">
          go to Hoppaz
        </Link>
        .
      </p>

      <SignInSheet open={asked} reason={`Take over ${room.name}`} onClose={() => onAsk(false)} onSignedIn={() => onAsk(false)} />
    </div>
  );
}
