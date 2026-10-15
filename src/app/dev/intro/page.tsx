import { notFound } from "next/navigation";
import { INTRO_ENABLED } from "@/lib/intro/flag";
import DevIntro from "./DevIntro";

/**
 * Development only: Paz's first-run tour over a fake app, with a button for
 * every event (http://localhost:3000/dev/intro). Production builds answer
 * 404, so players never see it.
 *
 * Query: ?step=box_far jumps to a step. ?theme=day|night. ?panel=1 opens the
 * controls. ?loc=denied|outside|granted. ?ios=1 pretends to be an iPhone that
 * has not been installed.
 */
export default function DevIntroPage() {
  if (process.env.NODE_ENV === "production") notFound();
  // The tour is switched off in the app (src/lib/intro/flag.ts), and this page runs the real tour code, so it waits too.
  if (!INTRO_ENABLED) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-ink px-6 text-center">
        <p className="font-mono text-[11px] leading-relaxed tracking-[0.12em] text-dim">
          THE INTRO IS SWITCHED OFF.
          <br />
          SET INTRO_ENABLED TO TRUE IN SRC/LIB/INTRO/FLAG.TS TO REVIEW IT HERE.
        </p>
      </div>
    );
  }
  return <DevIntro />;
}
