"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, CornerUpLeft, Flame, Footprints, Heart, Info, Laugh, PartyPopper, SendHorizontal, X } from "lucide-react";
import ChatFace from "@/components/chat/ChatFace";
import { chatTime } from "@/components/chat/Bubble";
import { buildRows } from "@/lib/crew-room/chatFeed";
import { useChatNames } from "@/lib/crew-room/chatNames";
import { useChatSender, useOutbox, useOutboxCleanup } from "@/lib/crew-room/chatOutbox";
import { REACTION_KINDS, type ReactionKind, type useReactions } from "@/lib/crew-room/chatReactions";
import { draftKey, useRoomDrafts, type Draft } from "@/lib/crew-room/drafts";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection } from "@/lib/crew-room/types";
import { roomTips, welcomeLine } from "./ChatWelcome";
import css from "./CrewRoomChat.module.css";

const NO_DRAFT: Draft = { text: "", circle: null };
/** Nothing to draw while the sheet is closed: the list stays mounted for its state and drafts, but its rows do not render. */
const NO_ROWS: ReturnType<typeof buildRows> = [];
/** A face is 70 nodes of SVG. The room updates about every 1.5 s, so a face is redrawn only when its look really changes. */
const Face = memo(function Face({ look }: { look: unknown }) {
  return <ChatFace look={look} size={28} />;
});
const REACT_ICON: Record<ReactionKind, typeof Heart> = { heart: Heart, fire: Flame, laugh: Laugh, party: PartyPopper };
const REACT_LABEL: Record<ReactionKind, string> = { heart: "Love it", fire: "Fire", laugh: "Funny", party: "Party" };
/** Within this many px of the bottom counts as "at the bottom": new messages keep the list pinned. */
const NEAR_BOTTOM = 80;

/** What the sheet lends the list so a pull on it can move the sheet (pull to close, pull up to open). */
export type PullHandlers = {
  /** A drag started at this y. Returns false when the sheet cannot be dragged (docked). */
  begin: (y: number) => boolean;
  move: (y: number) => void;
  end: () => void;
};

export type CrewRoomChatProps = {
  crewId: string;
  room: CrewRoomConnection;
  userId: string;
  /** Which conversation: General, or the area I am standing in. */
  tab: "general" | "area";
  area: { id: string; name: string } | null;
  /** The area session I am in now (a circle id), or null. */
  circle: string | null;
  /** The sheet is open and this conversation is the one on show. */
  active: boolean;
  reactions: ReturnType<typeof useReactions>;
  pull: PullHandlers;
  brand: string;
  onAtBottom: (atBottom: boolean) => void;
  /** The input took focus (the sheet lifts from peek to half). */
  onInputFocus: () => void;
  /** I asked to walk to someone from a message (the sheet drops to peek so the walk shows). */
  onWalked: () => void;
};

/**
 * One conversation inside the chat sheet: the messages (flat lines, newest at the bottom), the bar that opens when
 * you tap a message (react, reply, walk to), and the composer. The input always works: a message goes into the
 * outbox at once and the outbox keeps trying while the room reconnects. Unsent words live in the drafts store
 * (lib/crew-room/drafts.ts) so a rejoin or an expired session never loses them.
 */
export default function CrewRoomChat({ crewId, room, userId, tab, area, circle, active, reactions, pull, brand, onAtBottom, onInputFocus, onWalked }: CrewRoomChatProps) {
  const drafts = useRoomDrafts((s) => s.drafts);
  const setDraft = useRoomDrafts((s) => s.set);
  const sender = useChatSender(room, crewId);
  const outAll = useOutbox((s) => s.items);
  const walkTo = useRoomStore((s) => s.walkTo);
  const peersLive = useRoomStore((s) => s.peers);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ name: string } | null>(null);
  const [fresh, setFresh] = useState(0);

  const general = tab === "general";
  const key = general ? "general" : circle;
  const thread = key ? room.threads[key] : undefined;
  const messages = useMemo(() => thread?.items ?? [], [thread]);
  const outs = useMemo(() => outAll.filter((o) => o.crew === crewId && o.thread === (key ?? "general")), [outAll, crewId, key]);
  const peers = room.snapshot?.peers;
  const myLook = lookOf(room, userId);
  const nameOf = useChatNames(messages, peers ?? [], userId);
  useOutboxCleanup(key ?? "general", messages, userId);
  const rows = useMemo(() => buildRows(messages, outs, userId), [messages, outs, userId]);
  // A closed sheet draws no rows. With 60 people the room updates all the time, and this list was most of the main thread.
  const shownRows = active ? rows : NO_ROWS;
  const lastKey = rows[rows.length - 1]?.key;
  const firstKey = rows[0]?.key;

  const generalKey = draftKey(crewId, null);
  const areaKey = area ? draftKey(crewId, area.id) : null;
  const text = general ? (drafts[generalKey] ?? NO_DRAFT).text : areaKey ? (drafts[areaKey]?.text ?? "") : "";
  const areaDraft = areaKey ? (drafts[areaKey] ?? { text: "", circle }) : NO_DRAFT;
  // A draft started in an earlier session of this area needs one tap before it goes to the new one.
  const changed = !general && !!areaDraft.text && areaDraft.circle !== circle;
  const writeDraft = (value: string) => {
    if (general) setDraft(generalKey, { text: value, circle: null });
    else if (areaKey) setDraft(areaKey, { text: value, circle: areaDraft.text ? areaDraft.circle : circle });
  };

  // ---------------------------------------------------------------- scrolling --
  const toBottom = useCallback(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // An older page keeps the reader where they were; anything else new at the bottom keeps the list pinned.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    }
  }, [firstKey]);
  useLayoutEffect(() => {
    if (!active) return;
    if (stick.current) toBottom();
  }, [active, lastKey, toBottom]);
  // The first time this conversation is on show: straight to the newest line.
  useLayoutEffect(() => {
    if (active) {
      stick.current = true;
      toBottom();
      setFresh(0);
      onAtBottom(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  // The sheet's height or the keyboard changes the box: stay on the newest line if that is where I was.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [toBottom]);
  // New lines while I am reading older ones: count them.
  const seenLast = useRef(lastKey);
  useEffect(() => {
    if (lastKey === seenLast.current) return;
    seenLast.current = lastKey;
    const last = rows[rows.length - 1];
    if (!stick.current && last && !(last.kind === "out" || (last.kind === "msg" && last.own))) setFresh((n) => n + 1);
  }, [lastKey, rows]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (bottom !== stick.current) {
      stick.current = bottom;
      onAtBottom(bottom);
    }
    if (bottom) setFresh(0);
    if (picked) setPicked(null);
  };

  // A pull on the list moves the sheet: down from the top of the list closes it, up from the bottom opens it more.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    let y0 = 0;
    let armed = false;
    let dragging = false;
    const start = (e: TouchEvent) => {
      y0 = e.touches[0].clientY;
      armed = true;
      dragging = false;
    };
    const move = (e: TouchEvent) => {
      if (!armed) return;
      const y = e.touches[0].clientY;
      if (!dragging) {
        const dy = y - y0;
        const atTop = el.scrollTop <= 1;
        const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
        if ((dy > 8 && atTop) || (dy < -8 && atEnd)) {
          if (!pull.begin(y0)) {
            armed = false;
            return;
          }
          dragging = true;
        } else return;
      }
      if (e.cancelable) e.preventDefault();
      pull.move(y);
    };
    const end = () => {
      if (dragging) pull.end();
      dragging = false;
      armed = false;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [pull]);

  const earlier = () => {
    if (!key || !list.current) return;
    anchor.current = { height: list.current.scrollHeight, top: list.current.scrollTop };
    room.loadEarlier(key);
  };

  // --------------------------------------------------------------- sending ----
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || changed) {
      input.current?.focus();
      return;
    }
    const scope = general ? "general" : "nearby";
    const to = general ? null : (areaDraft.circle ?? circle);
    if (!general && !to) return;
    sender.send(scope, body, to);
    writeDraft("");
    setReplyTo(null);
    stick.current = true;
    setFresh(0);
    requestAnimationFrame(toBottom);
    // Keep the keyboard up so talking flows.
    input.current?.focus();
  };

  // ---------------------------------------------------- tap a message: the bar --
  const peerOf = (authorId: string) => peersLive.find((p) => p.id === authorId);
  const reply = (name: string) => {
    const mention = `@${name.split(/\s+/)[0]} `;
    setReplyTo({ name });
    setPicked(null);
    if (!text.startsWith(mention)) writeDraft(mention + text);
    requestAnimationFrame(() => input.current?.focus());
  };
  const walk = (authorId: string) => {
    const peer = peerOf(authorId);
    setPicked(null);
    if (peer && walkTo) {
      walkTo(peer.x, peer.y);
      onWalked();
    }
  };
  const react = (messageId: string, kind: ReactionKind) => {
    void reactions.toggle(messageId, kind);
  };

  const placeholder = general ? "Say something to everyone" : `Say something in ${area?.name.toUpperCase() ?? "this area"}`;
  const emptyText = general ? `Welcome to ${brand}'s community center. Say hi.` : "Only people in here get this chat.";

  return (
    <div className={css.panel}>
      <div className={css.listWrap}>
        <div
          className={css.list}
          ref={list}
          onScroll={onScroll}
          role="log"
          aria-label={general ? "General messages" : "Area messages"}
          aria-live="polite"
          aria-relevant="additions"
        >
          {general && <HowItWorks brand={brand} />}
          {thread?.more && thread.loaded && messages.length > 0 && (
            <button type="button" className={css.more} onClick={earlier} disabled={thread.loading}>
              {thread.loading ? "Loading" : "Earlier messages"}
            </button>
          )}
          {!thread?.loaded && !rows.length && <Skeleton />}
          {thread?.loaded && !rows.length && <p className={css.empty}>{emptyText}</p>}
          {shownRows.map((row) => {
            if (row.kind === "day") {
              return (
                <div key={row.key} className={css.day}>
                  {row.label}
                </div>
              );
            }
            if (row.kind === "out") {
              const { out } = row;
              const failed = out.status === "failed";
              return (
                <div
                  key={row.key}
                  className={`${css.row} ${css.own} ${row.grouped ? css.grouped : ""} ${failed ? css.failed : css.sending}`}
                  role={failed ? "button" : undefined}
                  tabIndex={failed ? 0 : undefined}
                  onClick={failed ? () => sender.retry(out.id) : undefined}
                  onKeyDown={failed ? (e) => (e.key === "Enter" || e.key === " ") && sender.retry(out.id) : undefined}
                >
                  {row.grouped ? <span className={css.faceGap} /> : <span className={css.face}><Face look={myLook} /></span>}
                  <div className={css.text}>
                    {!row.grouped && (
                      <div className={css.meta}>
                        <span className={css.name}>You</span>
                        <span className={css.time}>{failed ? null : <Clock size={12} aria-hidden />}{chatTime(new Date(out.at).toISOString())}</span>
                      </div>
                    )}
                    <p className={css.msg}>{out.body}</p>
                    {failed && <span className={css.retry}>Tap to retry</span>}
                  </div>
                </div>
              );
            }
            const m = row.message;
            const reacts = reactions.by.get(m.id);
            const open = picked === m.id;
            const inRoom = !row.own && !!peerOf(m.author_id);
            const name = nameOf(m);
            return (
              <Fragment key={row.key}>
                <div
                  className={`${css.row} ${row.own ? css.own : ""} ${row.grouped ? css.grouped : ""} ${open ? css.picked : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => setPicked(open ? null : m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPicked(open ? null : m.id);
                    }
                  }}
                >
                  {row.grouped ? (
                    <span className={css.faceGap} />
                  ) : (
                    <span className={css.face}>
                      <Face look={m.author_look} />
                    </span>
                  )}
                  <div className={css.text}>
                    {(!row.grouped || open) && (
                      <div className={css.meta}>
                        {!row.grouped && <span className={css.name}>{name}</span>}
                        <span className={css.time}>{chatTime(m.created_at)}</span>
                      </div>
                    )}
                    <p className={css.msg}>{m.body}</p>
                    {!!reacts?.length && (
                      <div className={css.reacts}>
                        {reacts.map((r) => {
                          const Icon = REACT_ICON[r.kind];
                          return (
                            <button
                              key={r.kind}
                              type="button"
                              className={css.react}
                              aria-pressed={r.mine}
                              aria-label={`${REACT_LABEL[r.kind]}, ${r.count}${r.mine ? ", you reacted" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                react(m.id, r.kind);
                              }}
                            >
                              <Icon size={12} aria-hidden />
                              {r.count}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {open && (
                      <div className={css.bar} role="group" aria-label="Message actions" onClick={(e) => e.stopPropagation()}>
                        {reactions.available &&
                          REACTION_KINDS.map((kind) => {
                            const Icon = REACT_ICON[kind];
                            const mine = !!reacts?.find((r) => r.kind === kind)?.mine;
                            return (
                              <button key={kind} type="button" className={css.barBtn} aria-pressed={mine} aria-label={REACT_LABEL[kind]} onClick={() => {
                                  react(m.id, kind);
                                  setPicked(null);
                                }}>
                                <Icon size={20} aria-hidden />
                              </button>
                            );
                          })}
                        {reactions.available && <span className={css.barSep} aria-hidden />}
                        {!row.own && (
                          <button type="button" className={css.barBtn} onClick={() => reply(name)}>
                            <CornerUpLeft size={16} aria-hidden />
                            Reply
                          </button>
                        )}
                        {inRoom && !room.watching && (
                          <button type="button" className={css.barBtn} onClick={() => walk(m.author_id)}>
                            <Footprints size={16} aria-hidden />
                            Walk to
                          </button>
                        )}
                        {row.own && !reactions.available && (
                          <button type="button" className={css.barBtn} onClick={() => setPicked(null)}>
                            Close
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
        {fresh > 0 && (
          <button
            type="button"
            className={css.newChip}
            onClick={() => {
              stick.current = true;
              setFresh(0);
              toBottom();
              onAtBottom(true);
            }}
          >
            {fresh > 9 ? "9+" : fresh} new
          </button>
        )}
      </div>
      <form className={css.composer} onSubmit={submit}>
        {changed && area && (
          <p className={css.notice}>
            <span>New chat started here. Your draft is kept.</span>
            <button type="button" onClick={() => areaKey && setDraft(areaKey, { ...areaDraft, circle })}>
              Use it here
            </button>
          </p>
        )}
        {!room.connected && (
          <p className={css.notice} role="status">
            Reconnecting. Your draft is kept.
          </p>
        )}
        {replyTo && (
          <div className={css.replying}>
            <span>Replying to {replyTo.name}</span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
        <div className={css.inputRow}>
          <label className="sr-only" htmlFor={`crew-room-message-${tab}`}>
            {general ? "Message everyone" : "Message this area"}
          </label>
          <input
            ref={input}
            id={`crew-room-message-${tab}`}
            className={css.input}
            value={text}
            maxLength={400}
            autoComplete="off"
            autoCorrect="on"
            enterKeyHint="send"
            placeholder={placeholder}
            onFocus={onInputFocus}
            onChange={(event) => writeDraft(event.target.value)}
          />
          <button
            type="submit"
            className={`btn ${css.send}`}
            aria-label="Send"
            disabled={!text.trim() || changed}
            // Pressing send must not take focus from the input, or the keyboard drops after every message.
            onPointerDown={(e) => e.preventDefault()}
          >
            <SendHorizontal size={18} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}

/** My own look, from the people list (the outbox has no look of its own). */
function lookOf(room: CrewRoomConnection, userId: string) {
  return room.snapshot?.peers.find((p) => p.id === userId)?.look ?? room.threads.general?.items.find((m) => m.author_id === userId)?.author_look ?? null;
}

/** The first-visit welcome, kept as a row at the very top of General: collapsed, one tap to read it again. */
function HowItWorks({ brand }: { brand: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={css.how}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Info size={14} aria-hidden />
        <span>How this works</span>
        <ChevronDown size={16} aria-hidden className={open ? css.flip : undefined} />
      </button>
      {open && (
        <div>
          <p>{welcomeLine(brand)}</p>
          <ol>
            {roomTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
            <li>Chat shows up over people&apos;s heads. Pull the sheet down to get back to the room.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${css.skeleton} animate-pulse2`}>
          <i />
          <div style={{ flex: 1 }}>
            <b style={{ width: `${30 + i * 8}%` }} />
            <b style={{ width: `${70 - i * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
