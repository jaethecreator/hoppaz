"use client";

import dynamic from "next/dynamic";

// The room (the crew-room engine) reads the window: client only, in its own chunk.
const WelcomeFlow = dynamic(() => import("@/components/welcome/WelcomeFlow"), { ssr: false, loading: () => <div className="h-full bg-ink" /> });

/** The first run's room part (see src/lib/welcome.ts). The map tour that follows is on "/". */
export default function WelcomePage() {
  return <WelcomeFlow />;
}
