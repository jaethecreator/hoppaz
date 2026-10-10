"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import Sheet from "@/components/Sheet";
import { useToast } from "@/lib/store";
import { copyLabel, loadAlbum, loadCard, stampVisit, TIER_LABEL, type Album, type AlbumCard, type CardPage } from "@/lib/cards";
import CardFace from "./CardFace";

/**
 * The cards on your shelf: every live set with how far through it you are, then
 * the cards you hold, best first. Tap one for its page: the fact and where it
 * comes from, the question on the back, the tip for going there, and I'M HERE,
 * which stamps it Visited when you are standing at the place. Shows nothing
 * until the deck has a live set.
 */
/** `onCount` hears how many cards you hold once the album loads, so the page can count them as on the shelf. */
export default function CardAlbum({ userId, onCount }: { userId: string | null; onCount?: (n: number) => void }) {
  const [album, setAlbum] = useState<Album | null>(null);
  const [open, setOpen] = useState<AlbumCard | null>(null);

  const reload = useCallback(() => {
    if (!userId) return;
    void loadAlbum().then((a) => {
      setAlbum(a);
      onCount?.(a?.cards.length ?? 0);
    });
  }, [userId, onCount]);
  useEffect(reload, [reload]);

  if (!album || album.sets.length === 0) return null;
  const owned = album.cards.length;
  const total = album.sets.reduce((n, s) => n + s.total, 0);
  const sets = album.sets.filter((s) => s.owned > 0);

  return (
    <section aria-label="Cards" className="mb-7">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="seclabel">
          CARDS · {owned}/{total}
        </p>
        <span className="font-mono text-[10px] text-dim">LAGOS, ONE PLACE AT A TIME</span>
      </div>

      {owned === 0 ? (
        <p className="hint">Street boxes pay cards. Every card is a Lagos place: stand there and stamp it Visited.</p>
      ) : (
        <>
          {sets.length > 0 && (
            <ul className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sets.map((s) => (
                <li key={s.key} className="min-w-[150px] flex-none rounded-hz border border-line bg-ink-2 px-3 py-2.5">
                  <p className="truncate font-display text-[14px] font-black leading-tight">{s.name}</p>
                  <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
                    {s.completion_no ? `${s.title} · #${s.completion_no}` : `${Math.min(s.owned, s.needed)} of ${s.needed} to finish`}
                  </p>
                  <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-orange" style={{ width: `${s.needed ? Math.min(100, (s.owned / s.needed) * 100) : 0}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ul className="grid grid-cols-3 gap-2.5">
            {album.cards.map((c) => {
              const set = album.sets.find((s) => s.key === c.set_key);
              return (
                <li key={c.key} className="relative">
                  <button type="button" onClick={() => setOpen(c)} aria-label={`${c.name}, ${TIER_LABEL[c.tier]}`} className="block w-full">
                    <CardFace
                      name={c.name}
                      tier={c.tier}
                      setName={set?.name ?? ""}
                      cardKey={c.key}
                      copy={c.copy_nos.length ? copyLabel({ copy_no: c.copy_nos[0], copies_total: c.copies_total }) : null}
                      visited={c.visited}
                      size="sm"
                    />
                  </button>
                  {c.copies > 1 && (
                    <span className="pointer-events-none absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-orange px-1 font-mono text-[10px] font-medium text-brand-ink">
                      ×{c.copies}
                    </span>
                  )}
                  {c.new_art && <i aria-label="New art" className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-orange" />}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && (
        <CardSheet
          card={open}
          setName={album.sets.find((s) => s.key === open.set_key)?.name ?? ""}
          onClose={() => setOpen(null)}
          onChanged={reload}
        />
      )}
    </section>
  );
}

function CardSheet({ card, setName, onClose, onChanged }: { card: AlbumCard; setName: string; onClose: () => void; onChanged: () => void }) {
  const say = useToast((s) => s.say);
  const [page, setPage] = useState<CardPage | null>(null);
  const [stamping, setStamping] = useState(false);

  useEffect(() => {
    let live = true;
    void loadCard(card.key, true).then((p) => {
      if (!live) return;
      setPage(p);
      if (card.new_art) onChanged();
    });
    return () => {
      live = false;
    };
    // the page is read once per card; onChanged only refreshes the dots behind it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.key]);

  const visited = page?.mine?.visited ?? card.visited;

  const imHere = () => {
    if (!page || stamping) return;
    if (!navigator.geolocation) {
      say("This phone can't share its location.", "error");
      return;
    }
    setStamping(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r = await stampVisit(page.id, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setStamping(false);
        say(r.line, r.ok ? "ok" : "error");
        if (r.ok) {
          setPage((p) => (p && p.mine ? { ...p, mine: { ...p.mine, visited: true } } : p));
          onChanged();
        }
      },
      () => {
        setStamping(false);
        say("Turn on location to stamp it.", "error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const c = page?.card;
  return (
    <Sheet open onClose={onClose} label={card.name}>
      <div className="flex flex-col items-center pb-2">
        <CardFace
          name={card.name}
          tier={card.tier}
          setName={setName}
          cardKey={card.key}
          copy={card.copy_nos.length ? copyLabel({ copy_no: card.copy_nos[0], copies_total: card.copies_total }) : null}
          visited={visited}
          size="lg"
        />
        {card.copies > 1 && <p className="seclabel mt-2">{card.copies} COPIES</p>}
      </div>
      {!c ? (
        <p className="hint py-4 text-center">Turning the card over.</p>
      ) : (
        <div className="space-y-3 pb-2">
          <p className="font-body text-[15px] leading-snug">{c.fact}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">Source: {c.fact_source}</p>
          {c.known_for && (
            <p className="hint">
              <b className="text-cream">Known for:</b> {c.known_for}
            </p>
          )}
          {c.lore && <p className="hint italic">{c.lore}</p>}
          {c.question && (
            <div className="rounded-hz border border-line bg-ink-3 px-3 py-2.5">
              <p className="seclabel">ASK YOUR CREW</p>
              <p className="mt-1 font-body text-[14px]">{c.question}</p>
            </div>
          )}
          {c.tier_reason && (
            <p className="hint">
              {TIER_LABEL[c.tier]}: {c.tier_reason}
              {c.founders_call ? " (founder's call)" : ""}
            </p>
          )}
          {c.art_credit && <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">Art: {c.art_credit}</p>}

          <div className="border-t border-dashed border-line pt-3">
            {visited ? (
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[#2FD35C]">
                <MapPin size={14} aria-hidden /> You&apos;ve been here
              </p>
            ) : (
              <>
                {c.visit_tip && <p className="hint mb-2.5">{c.visit_tip}</p>}
                <button type="button" className="btn w-full" disabled={stamping} onClick={imHere}>
                  <MapPin size={15} aria-hidden /> {stamping ? "CHECKING WHERE YOU ARE…" : "I'M HERE"}
                </button>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex min-h-[40px] items-center justify-center font-body text-[13px] text-dim underline underline-offset-4"
                >
                  Show me where it is
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
