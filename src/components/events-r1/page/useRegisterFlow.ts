"use client";

import { useCallback, useState } from "react";
import { useR1Api, useR1Auth, useViewerState } from "@/lib/events-r1/hooks";
import type { R1Event, RegQuestion } from "@/lib/events-r1/types";
import { registerLabel } from "../labels";

export type Phase = "idle" | "signin" | "form" | "busy";

/** Who sent this link, from ?ref= (the inviter's own id, so the host sees who brought whom). */
const refFromUrl = (): string | null => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("ref"));

/**
 * The Register flow, inline: sign in if needed, the host's questions if there are any, then register. The result is not
 * returned: the store changes, the viewer state reloads, and every screen showing this event moves to the new state.
 */
export function useRegisterFlow(event: R1Event) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const { data: viewer } = useViewerState(event.id);
  const label = registerLabel(viewer, event);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<RegQuestion[]>([]);

  const submit = useCallback(
    async (answers: Record<string, string>, asked: boolean) => {
      if (!api) return;
      setPhase("busy");
      setError("");
      try {
        await api.registrations.register(event.id, { answers, referrerId: refFromUrl() });
        setPhase("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not work. Try again.");
        setPhase(asked ? "form" : "idle");
      }
    },
    [api, event.id]
  );

  /** Signed in: ask the questions the host switched on (Name and Email come from the account), or register at once. */
  const proceed = useCallback(async () => {
    if (!api) return;
    setPhase("busy");
    setError("");
    try {
      const s = await api.events.getRegistrationSettings(event.id);
      const ask = s.questions.filter((q) => q.enabled !== false && q.builtin !== "name" && q.builtin !== "email");
      if (ask.length) {
        setQuestions(ask);
        setPhase("form");
        return;
      }
    } catch {
      // No settings to read: there are no questions.
    }
    await submit({}, false);
  }, [api, event.id, submit]);

  const start = useCallback(() => {
    if (!api || !viewer || label.disabled || label.status || phase === "busy") return;
    if (!viewer.signedIn) setPhase("signin");
    else void proceed();
  }, [api, viewer, label.disabled, label.status, phase, proceed]);

  return {
    ready: !!api && !!viewer,
    viewer,
    label,
    user,
    phase,
    error,
    questions,
    start,
    proceed,
    submit,
    cancel: () => {
      setPhase("idle");
      setError("");
    },
  };
}
