import { BadgeCheck } from "lucide-react";
import clsx from "clsx";

/**
 * A brand crew Hoppaz has checked (crews.verified, which only staff can set). A small lagoon tick beside the crew's
 * name on its card and in its room header: lagoon is the state colour, so it reads as a fact, not a button.
 */
export default function VerifiedBadge({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span role="img" aria-label="Verified by Hoppaz" title="Verified by Hoppaz" className={clsx("inline-flex flex-none text-lagoon", className)}>
      <BadgeCheck size={size} aria-hidden />
    </span>
  );
}
