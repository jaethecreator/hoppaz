"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { supabaseConfigured } from "@/lib/supabase/client";
import { goToAccount } from "@/lib/accountGate";
import { useSession } from "@/lib/useSession";

const SNOOZE = "hoppaz.save-progress-snooze";
const DAY = 24 * 3.6e6;
/** Screens where the banner would be in the way or says the same thing already. */
const HIDDEN = [/^\/account/, /^\/auth/, /^\/admin/, /^\/dev/, /^\/phone/, /^\/report\//, /^\/chat\/dm\//];

/**
 * A guest who has something worth keeping (XP) is told it only lives on this phone, and offered the account page.
 * A guest with nothing yet is left alone. "Not now" hides it for a day.
 */
export default function SaveProgressBanner() {
  const path = usePathname();
  const { hasAccount, profile, state } = useSession();
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    try {
      setSnoozed(Date.now() < Number(localStorage.getItem(SNOOZE) ?? 0));
    } catch {
      setSnoozed(false);
    }
  }, []);

  const show =
    supabaseConfigured() && state === "ready" && !hasAccount && (profile?.xp ?? 0) > 0 && !snoozed && !HIDDEN.some((re) => re.test(path));
  if (!show) return null;

  const later = () => {
    setSnoozed(true);
    try {
      localStorage.setItem(SNOOZE, String(Date.now() + DAY));
    } catch {
      /* private mode: it shows again next visit */
    }
  };

  return (
    <div
      role="region"
      aria-label="Save your progress"
      className="fixed inset-x-0 z-[60] mx-auto flex max-w-[420px] items-center gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2.5 text-cream shadow-sheet"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))", width: "calc(100% - 2rem)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="font-display text-[14px] font-black leading-tight">Save your {profile?.xp} XP</p>
        <p className="font-body text-[13px] text-dim">It only lives on this phone. Add your email and keep it.</p>
      </div>
      <button
        type="button"
        className="btn min-h-[40px] shrink-0 px-4 text-[13px]"
        onClick={() => goToAccount("save your progress", "create", "Add your email to keep your XP, crews and tickets. Nothing you have done is lost.")}
      >
        SAVE
      </button>
      <button type="button" onClick={later} aria-label="Not now" className="grid h-9 w-9 shrink-0 place-items-center text-dim">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
