"use client";

/**
 * The question before REMOVE FROM CREW, for the Chat tab's friend sheet (CrewSheet) and the room card's profile sheet
 * (HopperMenu). Quiet on purpose: two plain buttons and nothing red. Removing takes back no name and no chat, so all it
 * has to say is that they can be asked again.
 */
export default function RemoveConfirm({
  name,
  busy,
  onRemove,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-hz border border-line bg-ink-3 p-3">
      <p className="font-display text-sm font-black">Remove {name} from your crew?</p>
      <p className="hint mt-0.5">You can say hi again later.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost" onClick={onRemove} disabled={busy}>
          REMOVE
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
