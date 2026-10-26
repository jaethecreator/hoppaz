"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { validCampaignUrl, type AwardEntry, type CampaignContent } from "@/lib/campaign/layout";
import css from "./Campaign.module.css";

function parseAwards(raw: string): AwardEntry[] {
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [year = "", title = "", detail = "", sourceUrl = ""] = line.split("|").map((part) => part.trim());
      if (!title || !year || (sourceUrl && !validCampaignUrl(sourceUrl))) throw new Error("Use Year | Award name | Short story | Optional web link for each award.");
      return { title, year, detail, ...(sourceUrl ? { sourceUrl: validCampaignUrl(sourceUrl)! } : {}) };
    })
    .slice(0, 12);
}

/**
 * The owner's room settings: banner, welcome line, room width, music and the stories the zones tell. It opens from the
 * HUD's settings button (owners only) and is the only editor for these words; the crew hub's MANAGE CREW holds the logo,
 * the header pictures, the template and the featured event.
 */
export default function CampaignSettings({
  crewName,
  content,
  width,
  onClose,
  onSave,
}: {
  crewName: string;
  content: CampaignContent;
  width: 30 | 36;
  onClose: () => void;
  onSave: (content: CampaignContent, width: 30 | 36) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<CampaignContent>(content);
  const [draftWidth, setDraftWidth] = useState<30 | 36>(width);
  const [awardDraft, setAwardDraft] = useState(() => content.awards.map((award) => [award.year, award.title, award.detail, award.sourceUrl ?? ""].join(" | ")).join("\n"));
  const [formError, setFormError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const controls = () => Array.from(el.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, select"));
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const nodes = controls();
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!draft.brand.trim()) {
      setFormError("Add a name for the brand banner.");
      return;
    }
    if ((draft.musicUrl && !validCampaignUrl(draft.musicUrl)) || (draft.audioUrl && !validCampaignUrl(draft.audioUrl))) {
      setFormError("Add a complete http or https link, or leave the link empty.");
      return;
    }
    let awards: AwardEntry[];
    try {
      awards = parseAwards(awardDraft);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Check the awards format.");
      return;
    }
    const next = { ...draft, brand: draft.brand.trim(), musicUrl: validCampaignUrl(draft.musicUrl) ?? "", audioUrl: validCampaignUrl(draft.audioUrl) ?? "", awards };
    setSaving(true);
    try {
      const problem = await onSave(next, draftWidth);
      if (problem) {
        setFormError(problem);
        return;
      }
      setSaveNote("Saved for everyone in this crew.");
    } catch {
      setFormError("Could not save. Your changes are still here; try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={css.overlay}>
      <div ref={dialog} className={css.panel} role="dialog" aria-modal="true" aria-labelledby="campaign-panel-title">
        <div className={css.panelHead}>
          <div>
            <p className={css.eyebrow}>Crew owner / Shared settings</p>
            <h2 id="campaign-panel-title">Make the room yours.</h2>
          </div>
          <button type="button" className={css.iconButton} onClick={onClose} aria-label="Close panel">
            <X size={20} aria-hidden />
          </button>
        </div>
        <form className={css.form} onSubmit={save}>
          <p>Your banner, music and artist stories will update for everyone in this crew.</p>
          <label>
            Brand banner
            <input value={draft.brand} maxLength={40} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} autoComplete="off" />
          </label>
          <label>
            Welcome line
            <input value={draft.strapline} maxLength={160} onChange={(event) => setDraft({ ...draft, strapline: event.target.value })} autoComplete="off" />
          </label>
          <fieldset>
            <legend className={css.eyebrow}>Room width</legend>
            <div className={css.mapSizes}>
              {([30, 36] as const).map((value) => (
                <button type="button" key={value} aria-pressed={draftWidth === value} onClick={() => setDraftWidth(value)}>
                  <strong>{value === 30 ? "Compact" : "Roomy"}</strong>
                  <small>{value} × 20 tiles</small>
                </button>
              ))}
            </div>
            <p style={{ marginTop: 8 }}>Roomy opens more space between the rooms.</p>
          </fieldset>
          <label>
            Playlist or release title
            <input value={draft.musicTitle} maxLength={120} onChange={(event) => setDraft({ ...draft, musicTitle: event.target.value })} autoComplete="off" />
          </label>
          <label>
            Music link
            <input type="url" value={draft.musicUrl} onChange={(event) => setDraft({ ...draft, musicUrl: event.target.value })} placeholder="https://…" autoComplete="off" />
          </label>
          <label>
            Room music loop{" "}
            <span className={css.note}>Optional. A YouTube link (a DJ mix or a playlist) that plays for everyone in the room, from the stage; people who walk in join the set where it is. Or a hosted audio file the room plays on a loop. Without one, the room plays the Hoppaz room theme.</span>
            <input type="url" value={draft.audioUrl} onChange={(event) => setDraft({ ...draft, audioUrl: event.target.value })} placeholder="https://youtu.be/… or https://…/track.mp3" autoComplete="off" />
          </label>
          <label>
            Featured artist or release
            <input value={draft.artistTitle} maxLength={120} onChange={(event) => setDraft({ ...draft, artistTitle: event.target.value })} autoComplete="off" />
          </label>
          <label>
            Artist story
            <textarea value={draft.artistNote} maxLength={1200} onChange={(event) => setDraft({ ...draft, artistNote: event.target.value })} />
          </label>
          <label>
            Event words{" "}
            <span className={css.note}>Optional. Words in the title or venue of this crew’s events, with commas between them. The Stage and the crew page show the next one. Empty, the crew name is used.</span>
            <input value={draft.eventKeywords ?? ""} maxLength={160} onChange={(event) => setDraft({ ...draft, eventKeywords: event.target.value })} placeholder={`${crewName}, the artist`} autoComplete="off" />
          </label>
          <label>
            Awards archive
            <span className={css.note}>One real award per line: Year | Award name | Short story | Optional web link</span>
            <textarea value={awardDraft} onChange={(event) => setAwardDraft(event.target.value)} placeholder="Add the brand’s verified award stories here." />
          </label>
          {formError && (
            <p className={css.error} role="alert">
              {formError}
            </p>
          )}
          {saveNote && (
            <p className={css.success} role="status">
              {saveNote}
            </p>
          )}
          <footer>
            <button className={css.action} type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save for crew"}
            </button>
            <button className={css.secondary} type="button" onClick={onClose}>
              Back to room
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
