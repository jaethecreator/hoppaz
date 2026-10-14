"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CalendarDays, Disc3, Headphones, Leaf, MapPin, Music2, Settings2, Trophy, X } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import type { SocialWorld } from "@/lib/crew-room/types";
import { dayLabel } from "@/lib/filters";
import { EMPTY_CAMPAIGN, clubhouseWidth, validCampaignUrl, type AwardEntry, type CampaignContent, type CampaignZone, type ZoneId } from "@/lib/campaign/layout";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";
import CampaignWorld from "./CampaignWorld";
import RoomMusic from "./RoomMusic";
import css from "./Campaign.module.css";

const STORAGE_KEY = "hoppaz:360-playlist:preview:v1";
const ICONS = { studio: Headphones, stage: Music2, awards: Trophy, courtyard: Leaf, records: Disc3, campaign: Music2 };
const COPY: Record<ZoneId, string> = {
  studio: "A tucked-away listening room. Put on your headphones and spend a little time with the music.",
  stage: "The centre of 360 Playlist. A place for music launches, listening sessions and the people behind the sound.",
  awards: "A home for the milestones, recognition and stories that shaped the brand. Explore each display as the archive grows.",
  courtyard: "Under the lights, around the record fountain. Find a quiet corner between the music and the conversation.",
  records: "Warm wood, well-loved records and a seat with your name on it. A slower way to discover something new.",
  campaign: "Get closer to the artists and releases at the heart of 360 Playlist. This corner changes with each campaign.",
};

function parseAwards(raw: string): AwardEntry[] {
  return raw.split("\n").filter((line) => line.trim()).map((line) => {
    const [year = "", title = "", detail = "", sourceUrl = ""] = line.split("|").map((part) => part.trim());
    if (!title || !year || (sourceUrl && !validCampaignUrl(sourceUrl))) throw new Error("Use Year | Award name | Short story | Optional web link for each award.");
    return { title, year, detail, ...(sourceUrl ? { sourceUrl: validCampaignUrl(sourceUrl)! } : {}) };
  }).slice(0, 12);
}

function safeStoredContent(value: unknown): CampaignContent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const content = { ...EMPTY_CAMPAIGN };
  for (const key of ["brand", "strapline", "musicTitle", "musicUrl", "audioUrl", "artistTitle", "artistNote", "eventKeywords"] as const) {
    if (typeof item[key] === "string") content[key] = item[key].slice(0, key === "artistNote" ? 1200 : 300);
  }
  if (!content.brand.trim()) content.brand = EMPTY_CAMPAIGN.brand;
  if (content.musicUrl && !validCampaignUrl(content.musicUrl)) content.musicUrl = "";
  if (content.audioUrl && !validCampaignUrl(content.audioUrl)) content.audioUrl = "";
  if (Array.isArray(item.awards)) content.awards = item.awards.filter((award): award is AwardEntry => !!award && typeof award === "object" && typeof award.title === "string" && typeof award.year === "string" && typeof award.detail === "string" && (!award.sourceUrl || !!validCampaignUrl(award.sourceUrl))).slice(0, 12);
  return content;
}

/** The crew's next event, for the Stage (lib/crew-room/crewEvents.ts). */
export type StageEvent = { id: string; title: string; starts_at: string; venue_name: string };

export type CrewCampaign = {
  id: string; name: string; verified: boolean; content: CampaignContent; width: 30 | 36; editable: boolean; connected: boolean;
  world: SocialWorld; caption: string; chatOpen: boolean; chatButton: React.ReactNode; chat: React.ReactNode;
  /** A line said once under the header (a tab that took over), or null. */
  notice?: React.ReactNode;
  nextEvent?: StageEvent | null;
  onSave: (content: CampaignContent, width: 30 | 36) => Promise<string | null>;
};
export default function CampaignExperience({ crew }: { crew?: CrewCampaign }) {
  const look = useHoppaz((state) => state.look);
  const { profile } = useSession();
  const [localContent, setContent] = useState(EMPTY_CAMPAIGN);
  const content = crew?.content ?? localContent;
  const [localWidth, setWidth] = useState<30 | 36>(30);
  const width = crew?.width ?? localWidth;
  const layout = useMemo(() => clubhouseWidth(width), [width]);
  const [selected, setSelected] = useState<ZoneId | null>(null);
  const zone = layout.zones.find((item) => item.id === selected) ?? null;
  const [touring, setTouring] = useState<ZoneId | null>(null);
  const [panel, setPanel] = useState<"settings" | null>(null);
  const [draft, setDraft] = useState(EMPTY_CAMPAIGN);
  const [draftWidth, setDraftWidth] = useState<30 | 36>(30);
  const [awardDraft, setAwardDraft] = useState("");
  const [formError, setFormError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const source = validCampaignUrl(content.musicUrl);
  const audio = validCampaignUrl(content.audioUrl);
  const closePanel = useCallback(() => setPanel(null), []);
  const selectZone = useCallback((item: CampaignZone) => setSelected(item.id), []);
  const tourHandled = useCallback(() => setTouring(null), []);

  useEffect(() => {
    if (crew) return;
    // Preview content stays on this device; this is never a brand or database write.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const next = safeStoredContent(saved.content);
      if (next) setContent(next);
      if (saved.width === 36) setWidth(36);
    } catch { /* A blocked or outdated local store leaves a clean, usable clubhouse. */ }
  }, [crew]);

  useEffect(() => {
    if (!panel || !dialog.current) return;
    const el = dialog.current;
    const trigger = settingsTrigger.current;
    const controls = () => Array.from(el.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, select"));
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePanel(); }
      if (event.key !== "Tab") return;
      const nodes = controls();
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    };
    el.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("keydown", onKey); trigger?.focus({ preventScroll: true }); };
  }, [panel, closePanel]);

  useEffect(() => {
    if (!selected || panel) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [selected, panel]);

  const openSettings = () => {
    setDraft(content); setDraftWidth(width); setAwardDraft(content.awards.map((award) => [award.year, award.title, award.detail, award.sourceUrl ?? ""].join(" | ")).join("\n")); setFormError(""); setSaveNote(""); setPanel("settings");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError("");
    if (!draft.brand.trim()) { setFormError("Add a name for the brand banner."); return; }
    if ((draft.musicUrl && !validCampaignUrl(draft.musicUrl)) || (draft.audioUrl && !validCampaignUrl(draft.audioUrl))) { setFormError("Add a complete http or https link, or leave the link empty."); return; }
    let awards: AwardEntry[];
    try { awards = parseAwards(awardDraft); } catch (error) { setFormError(error instanceof Error ? error.message : "Check the awards format."); return; }
    const next = { ...draft, brand: draft.brand.trim(), musicUrl: validCampaignUrl(draft.musicUrl) ?? "", audioUrl: validCampaignUrl(draft.audioUrl) ?? "", awards };
    if (crew) {
      setSaving(true);
      try {
        const problem = await crew.onSave(next,draftWidth);
        if (problem) { setFormError(problem); return; }
        setSaveNote("Saved for everyone in this crew."); setSelected(null);
      } catch { setFormError("Could not save. Your changes are still here; try again."); }
      finally { setSaving(false); }
      return;
    }
    setContent(next); setWidth(draftWidth); setSelected(null);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ content: next, width: draftWidth })); setSaveNote("Saved on this device. Your preview is ready."); }
    catch { setSaveNote("Preview updated for this visit. This browser couldn’t save it."); }
  };
  const reset = () => {
    setContent(EMPTY_CAMPAIGN); setDraft(EMPTY_CAMPAIGN); setWidth(30); setDraftWidth(30); setAwardDraft(""); setSelected(null); setFormError("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Reset still works for the current visit. */ }
    setSaveNote("The original 360 Playlist preview is restored.");
  };
  const travel = (id: ZoneId) => { setSelected(null); setTouring(id); };
  const Icon = zone ? ICONS[zone.id] : Music2;

  return <div className={css.experience}>
    <header className={css.header}>
      <Link href={crew ? `/crew/${crew.id}` : "/"} className={css.back} aria-label={crew ? "Back to the crew" : "Back to the main map"}><ArrowLeft size={20} aria-hidden /></Link>
      <div className={css.heading}><p>{crew?.caption ?? "A music home / Campaign preview"}</p><div className={css.title}><h1>{content.brand}</h1>{crew?.verified && <VerifiedBadge size={18} />}</div></div>
      <div className={css.headerActions}>{crew?.chatButton}<Link href="/crew" aria-label="Your crews"><MapPin size={17} aria-hidden /><span>Crews</span></Link>{(!crew || crew.editable) && <button ref={settingsTrigger} type="button" onClick={openSettings} aria-label={crew ? "Customise crew room" : "Customise this preview"}><Settings2 size={17} aria-hidden /><span>Customise</span></button>}</div>
    </header>
    {crew?.notice}
    <div className={css.body}>
      <div className={css.mapColumn}>
        <CampaignWorld key={width} layout={layout} look={profile?.avatar ?? look} brand={content.brand} selected={selected} onZone={selectZone} touring={touring} onTourHandled={tourHandled} social={crew?.world} />
        <nav className={css.tour} aria-label="Explore clubhouse rooms">{layout.zones.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => travel(item.id)}><b>{item.number}</b>{item.name}</button>)}</nav>
      </div>
      <aside className={`${css.detail} ${zone ? css.detailSelected : ""}`} aria-label={zone ? `${zone.name} details` : "About the clubhouse"} style={{ display:crew?.chatOpen ? "none" : undefined }}>
        <div className={css.detailTop}><div><p className={css.eyebrow}>{zone ? `Room ${zone.number} / Explore` : "Step into the sound"}</p><h2>{zone?.name ?? "Your music. Your people."}</h2></div>{zone && <button className={css.iconButton} type="button" aria-label="Close room details" onClick={() => setSelected(null)}><X size={17} aria-hidden /></button>}</div>
        <div className={css.detailIcon}><Icon aria-hidden /></div>
        <p className={css.description}>{zone ? COPY[zone.id] : content.strapline}</p>
        {!zone && <><div className={css.roomList}>{layout.zones.map((item) => <button type="button" key={item.id} onClick={() => travel(item.id)}><b>{item.number}</b><span>{item.name}</span><ArrowUpRight size={14} aria-hidden /></button>)}</div><p className={css.note}>Tap the floor to walk. Choose a room to explore. {crew ? "Marked conversation areas have their own chat. Walk inside to join. General crew chat stays available everywhere." : "Your avatar is the only visitor shown in this preview."}</p></>}
        {zone?.id === "studio" && <>
          {content.musicTitle && <div className={css.recordDisc}><i aria-hidden /><div><strong>{content.musicTitle}</strong><small>In the listening room</small></div></div>}
          {crew && <RoomMusic audio={audio} title={content.musicTitle} />}
          {source && <a className={css.action} href={source} target="_blank" rel="noopener noreferrer">Open the music<ArrowUpRight size={15} aria-hidden /></a>}
          {!audio && !source && <div className={css.empty}><p>The next listening session is being prepared.</p><p>There’s a seat waiting for you. Music will appear here when the campaign is ready.</p></div>}
        </>}
        {zone?.id === "stage" && <>
          {crew?.nextEvent
            ? <Link className={css.stageEvent} href={`/event/${crew.nextEvent.id}`}><span className={css.eyebrow}>Next on stage · {dayLabel(crew.nextEvent.starts_at)}</span><strong>{crew.nextEvent.title}</strong><small>{crew.nextEvent.venue_name}</small><span className={css.stageEventGo}>See the event<CalendarDays size={15} aria-hidden /></span></Link>
            : <div className={css.empty}><p>{content.brand}</p><p>{content.artistTitle ? `In focus: ${content.artistTitle}` : "The next session is taking shape. Take a look around the clubhouse while the stage gets ready."}</p></div>}
          <button className={crew?.nextEvent ? css.secondary : css.action} type="button" onClick={() => travel("studio")}>Go to the Listening Studio<Headphones size={15} aria-hidden /></button>
        </>}
        {zone?.id === "awards" && (content.awards.length ? <div className={css.awards}>{content.awards.map((award, index) => <article className={css.award} key={`${award.title}-${index}`}><p className={css.eyebrow}>{award.year}</p><strong>{award.title}</strong><p>{award.detail}</p>{award.sourceUrl && <a href={award.sourceUrl} target="_blank" rel="noopener noreferrer">Read the story<ArrowUpRight size={13} aria-hidden /></a>}</article>)}</div> : <div className={css.empty}><p>The archive is being curated.</p><p>These display cases are ready for the brand’s real awards and stories. The collection will appear here as it’s added.</p></div>)}
        {zone?.id === "courtyard" && <><div className={css.empty}><p>Pause between the rooms.</p><p>The courtyard connects every corner of the clubhouse. Follow a path and see where the music takes you.</p></div><button className={css.secondary} type="button" onClick={() => travel("records")}>Find a seat in the Record Lounge<ArrowUpRight size={15} aria-hidden /></button></>}
        {zone?.id === "records" && <>{source ? <a className={css.action} href={source} target="_blank" rel="noopener noreferrer">Browse the playlist<Disc3 size={15} aria-hidden /></a> : <div className={css.empty}><p>The next selection is on its way.</p><p>Discover the brand’s music here when the playlist is added.</p></div>}<button className={css.secondary} type="button" onClick={() => travel("campaign")}>Meet the Artist Corner<ArrowUpRight size={15} aria-hidden /></button></>}
        {zone?.id === "campaign" && <>{content.artistTitle ? <div className={css.empty}><p>{content.artistTitle}</p><p>{content.artistNote || "More about this artist will be added soon."}</p></div> : <div className={css.empty}><p>The next artist spotlight is coming.</p><p>A place for release artwork, artist stories and the campaign’s featured music.</p></div>}{source && <a className={css.action} href={source} target="_blank" rel="noopener noreferrer">Explore the release<ArrowUpRight size={15} aria-hidden /></a>}</>}
      </aside>
      {crew?.chat}
    </div>

    {panel && <div className={css.overlay}><div ref={dialog} className={css.panel} role="dialog" aria-modal="true" aria-labelledby="campaign-panel-title">
      <div className={css.panelHead}><div><p className={css.eyebrow}>{crew ? "Crew owner / Shared settings" : "Host preview / This device only"}</p><h2 id="campaign-panel-title">Make the room yours.</h2></div><button type="button" className={css.iconButton} onClick={closePanel} aria-label="Close panel"><X size={20} aria-hidden /></button></div>
      <form className={css.form} onSubmit={save}>
        <p>{crew ? "Your banner, music and artist stories will update for everyone in this crew." : "Try your brand, music and artist story in the room. Changes stay in this browser so you can explore the setup."}</p>
        <label>Brand banner<input value={draft.brand} maxLength={40} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} autoComplete="off" /></label>
        <label>Welcome line<input value={draft.strapline} maxLength={160} onChange={(event) => setDraft({ ...draft, strapline: event.target.value })} autoComplete="off" /></label>
        <fieldset><legend className={css.eyebrow}>Room width</legend><div className={css.mapSizes}>{([30, 36] as const).map((value) => <button type="button" key={value} aria-pressed={draftWidth === value} onClick={() => setDraftWidth(value)}><strong>{value === 30 ? "Compact" : "Roomy"}</strong><small>{value} × 20 tiles</small></button>)}</div><p style={{ marginTop: 8 }}>Roomy opens more space between the rooms.</p></fieldset>
        <label>Playlist or release title<input value={draft.musicTitle} maxLength={120} onChange={(event) => setDraft({ ...draft, musicTitle: event.target.value })} autoComplete="off" /></label>
        <label>Music link<input type="url" value={draft.musicUrl} onChange={(event) => setDraft({ ...draft, musicUrl: event.target.value })} placeholder="https://…" autoComplete="off" /></label>
        <label>Room music loop <span className={css.note}>Optional. A hosted audio file the room plays on a loop, from a visitor’s first tap. Its host has to allow playing it from other sites. Without one, the room plays the Hoppaz room theme.</span><input type="url" value={draft.audioUrl} onChange={(event) => setDraft({ ...draft, audioUrl: event.target.value })} placeholder="https://…/track.mp3" autoComplete="off" /></label>
        <label>Featured artist or release<input value={draft.artistTitle} maxLength={120} onChange={(event) => setDraft({ ...draft, artistTitle: event.target.value })} autoComplete="off" /></label>
        <label>Artist story<textarea value={draft.artistNote} maxLength={1200} onChange={(event) => setDraft({ ...draft, artistNote: event.target.value })} /></label>
        {crew && <label>Event words <span className={css.note}>Optional. Words in the title or venue of this crew’s events, with commas between them. The Stage and the crew page show the next one. Empty, the crew name is used.</span><input value={draft.eventKeywords ?? ""} maxLength={160} onChange={(event) => setDraft({ ...draft, eventKeywords: event.target.value })} placeholder={`${crew.name}, the artist`} autoComplete="off" /></label>}
        <label>Awards archive<span className={css.note}>One real award per line: Year | Award name | Short story | Optional web link</span><textarea value={awardDraft} onChange={(event) => setAwardDraft(event.target.value)} placeholder="Add the brand’s verified award stories here." /></label>
        {formError && <p className={css.error} role="alert">{formError}</p>}{saveNote && <p className={css.success} role="status">{saveNote}</p>}
        <footer><button className={css.action} type="submit" disabled={saving}>{saving ? "Saving…" : crew ? "Save for crew" : "Save preview"}</button>{!crew && <button className={css.secondary} type="button" onClick={reset}>Reset preview</button>}<button className={css.secondary} type="button" onClick={closePanel}>Back to room</button></footer>
      </form>
    </div></div>}
  </div>;
}
