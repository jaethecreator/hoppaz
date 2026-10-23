import type { R1Event } from "@/lib/events-r1/types";

/** "About this event": the whole description, under the card. Nothing when the host wrote none. */
export default function AboutBlock({ event }: { event: R1Event }) {
  const text = event.description.trim();
  if (!text) return null;
  return (
    <section className="mt-6" aria-label="About this event">
      <h3 className="font-display text-[17px] font-black">About this event</h3>
      <p className="mt-2 whitespace-pre-line font-body text-[14.5px] leading-relaxed text-cream">{text}</p>
    </section>
  );
}
