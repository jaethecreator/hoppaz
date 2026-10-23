"use client";

import { useId, useState } from "react";
import type { RegQuestion } from "@/lib/events-r1/types";

/** The host's own questions, inline under the button. Name and Email are known from the account, so they are not asked. */
export default function QuestionsForm({
  questions,
  who,
  busy,
  submitText,
  onSubmit,
  onCancel,
}: {
  questions: RegQuestion[];
  who: string | null;
  busy: boolean;
  submitText: string;
  onSubmit: (answers: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [vals, setVals] = useState<Record<string, string>>({});

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(vals);
      }}
    >
      <div>
        <p className="font-display text-[16px] font-black">A few questions</p>
        {who && <p className="hint mt-0.5">Registering as {who}</p>}
      </div>
      {questions.map((q) => (
        <div key={q.id}>
          <label htmlFor={`${uid}-${q.id}`} className="mb-1.5 block font-body text-[13px] text-dim">
            {q.label}
            {!q.required && " (optional)"}
          </label>
          <input
            id={`${uid}-${q.id}`}
            type={q.builtin === "phone" ? "tel" : "text"}
            inputMode={q.builtin === "phone" ? "tel" : undefined}
            required={q.required}
            value={vals[q.id] ?? ""}
            onChange={(e) => setVals((v) => ({ ...v, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} aria-busy={busy} className="btn flex-1 normal-case">
          {submitText}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost normal-case">
          Cancel
        </button>
      </div>
    </form>
  );
}
