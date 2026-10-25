import type { Metadata, Viewport } from "next"
// Fonts are self-hosted on purpose: no Google round trip on a Lagos connection,
// and the build never depends on fonts.googleapis.com being reachable.
// Poppins: display and numbers only, never below 600. Archivo: everything you
// read. DM Mono: labels, dates, prices, codes.
import BottomNav from "@/components/BottomNav"
import AppNavigator from "@/components/app/AppNavigator"
import ThemeClock from "@/components/ThemeClock"
import Toaster from "@/components/Toaster"
import InstallSheet from "@/components/app/InstallSheet"
import MusicHost from "@/components/app/MusicHost"
import OfflineLine from "@/components/app/OfflineLine"
import PushAlert from "@/components/app/PushAlert"
import SaveProgressBanner from "@/components/app/SaveProgressBanner"
import SoundLane from "@/components/app/SoundLane"
import GameTimePing from "@/components/game-time/GameTimePing"
import FirstRun from "@/components/firstrun/FirstRun"
import OpeningCover from "@/components/opening/OpeningCover"
import OpeningHost from "@/components/opening/OpeningHost"
import SocialPing from "@/components/social/SocialPing"
import { ROOMS_SEAL } from "@/lib/events-r1/flags"
import { THEME_BOOT_SCRIPT } from "@/lib/theme"
import { BOOT_SCRIPT as OPENING_BOOT_SCRIPT } from "@/lib/opening/boot"
import { OPENING_ENABLED } from "@/lib/opening/flags"
import "@fontsource/archivo/400.css"
import "@fontsource/archivo/500.css"
import "@fontsource/archivo/600.css"
import "@fontsource/dm-mono/400.css"
import "@fontsource/dm-mono/500.css"
import "@fontsource/poppins/600.css"
import "@fontsource/poppins/900.css"
import "leaflet/dist/leaflet.css"
import "maplibre-gl/dist/maplibre-gl.css"
import "./globals.css"

const DESCRIPTION = "Come alone, leave with friends."

/** Absolute links in previews: the site's own address when it is set, otherwise Next works it out (Vercel's, or localhost). */
function siteBase() {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
      : undefined
  } catch {
    return undefined
  }
}

export const metadata: Metadata = {
  metadataBase: siteBase(),
  title: "Hoppaz",
  description: DESCRIPTION,
  // Shared links: a Hoppaz card (src/app/opengraph-image.tsx), not a bare text link. An event page has its own card.
  openGraph: {
    type: "website",
    siteName: "Hoppaz",
    locale: "en_NG",
    title: "Hoppaz",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Hoppaz",
    description: DESCRIPTION,
  },
  applicationName: "Hoppaz",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hoppaz" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: people can pinch-zoom text pages. The map handles its own pinch.
  viewportFit: "cover",
  themeColor: "#0E0B0A",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // data-theme is set before paint by the boot script, so the server and
    // client attribute differ on purpose.
    <html lang="en" data-theme="night" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* The short opening (src/lib/opening): on a cold start it is drawn from the first frame. Off with NEXT_PUBLIC_OPENING=off. */}
        {OPENING_ENABLED && <script dangerouslySetInnerHTML={{ __html: OPENING_BOOT_SCRIPT }} />}
        {/* The two biggest public reads start before React hydrates. Same path, no query and same-origin credentials as getJSON in src/lib/publicApi.ts, or the preload is wasted. */}
        <link rel="preload" href="/api/public/events" as="fetch" crossOrigin="anonymous" />
        {!ROOMS_SEAL && <link rel="preload" href="/api/public/hotspots" as="fetch" crossOrigin="anonymous" />}
      </head>
      <body className="overflow-hidden">
        {/* First, so its effect runs before any page's: a page that sends a guest to sign up has the router by then. */}
        <AppNavigator />
        <ThemeClock />
        <SoundLane />
        <MusicHost />
        <PushAlert />
        {/* A column with the tab bar under it; from 1024 px up a row, with the tabs as a rail on the left (BottomNav). */}
        <div className="fixed inset-0 flex flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <OfflineLine />
            <main className="relative flex-1 min-h-0">{children}</main>
          </div>
          <BottomNav />
        </div>
        <SaveProgressBanner />
        <GameTimePing />
        <SocialPing />
        <Toaster />
        <InstallSheet />
        <FirstRun />
        {OPENING_ENABLED && <OpeningCover />}
        {OPENING_ENABLED && <OpeningHost />}
      </body>
    </html>
  )
}
