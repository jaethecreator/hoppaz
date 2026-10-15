"use client";

import Link from "next/link";

/** A guest sees one line on the Chat tabs: what a sign-up unlocks, and the way there. */
export default function AccountNudge({ text }: { text: string }) {
  return (
    <Link href="/account?next=/chat" className="mb-3 flex min-h-[44px] flex-none items-center justify-between gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2">
      <span className="font-body text-[13px] leading-snug">{text}</span>
      <span className="flex-none font-mono text-[10px] font-medium tracking-[0.12em] text-orange">SIGN UP →</span>
    </Link>
  );
}
