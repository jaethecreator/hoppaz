"use client";

import { create } from "zustand";

/**
 * The browser's own install prompt (Android Chrome fires "beforeinstallprompt"
 * once and lets us keep it). InstallSheet catches the event and parks it here,
 * and fires it from its own ADD APP ICON button. iPhone has no such prompt (two
 * taps in Safari instead).
 */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const useInstallPrompt = create<{ prompt: InstallPromptEvent | null }>(() => ({ prompt: null }));

export const holdInstallPrompt = (e: InstallPromptEvent) => useInstallPrompt.setState({ prompt: e });
export const dropInstallPrompt = () => useInstallPrompt.setState({ prompt: null });

/** The Hopper tapped "Add it". Call it straight from the tap. "none": the browser has nothing to offer here. */
export async function fireInstallPrompt(): Promise<"accepted" | "dismissed" | "none"> {
  const p = useInstallPrompt.getState().prompt;
  if (!p) return "none";
  dropInstallPrompt(); // the browser only lets a saved prompt fire once
  try {
    await p.prompt();
    return (await p.userChoice).outcome;
  } catch {
    return "dismissed"; // the browser refused; treat as not now
  }
}
