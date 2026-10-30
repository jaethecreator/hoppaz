"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import TintShell from "@/components/host/TintShell";
import type { Look } from "@/lib/events-r1/looks";
import type { Tint } from "@/lib/tint";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
export type NavItem = { id: string; label: string; icon: Icon; badge?: string; /** A quiet word after the label on a wide screen ("Owner"). */ tag?: string };

/**
 * The frame of the host workspace (Personal and a room's admin). The same frame as the event dashboard (HostDashboard): the look's
 * tint over the whole page, a top bar, a 232px nav on a wide screen and a tab strip on a phone. The switcher sits at the top left.
 * (The app's global icon rail is still next to it on a wide screen; the owner has not decided about that.)
 */
export default function Frame({
  look, tint, switcher, actions, nav, tab, onTab, title, sub, footer, children, label,
}: {
  look: Look;
  tint?: Tint;
  switcher: ReactNode;
  actions?: ReactNode;
  nav: NavItem[];
  tab: string;
  onTab: (id: string) => void;
  title: string;
  sub?: string;
  /** Links under the nav on a wide screen (View room, ...). */
  footer?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);

  return (
    <div className="h-full overflow-y-auto" data-workspace>
      <TintShell look={look} tint={tint} className="min-h-full">
        <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 border-b border-t-line bg-t-bg px-3 lg:h-[72px] lg:px-5">
          <div className="min-w-0 flex-1">{switcher}</div>
          <div className="flex flex-none items-center gap-2">{actions}</div>
        </header>

        <div className="lg:grid lg:min-h-[calc(100dvh-72px)] lg:grid-cols-[232px_minmax(0,1fr)]">
          <nav aria-label={label} className="hidden border-r border-t-line lg:block">
            <div role="tablist" aria-orientation="vertical" className="sticky top-[72px] flex flex-col gap-1 p-4">
              {nav.map((t) => {
                const Icon = t.icon;
                const on = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`ws-tab-${t.id}`}
                    aria-selected={on}
                    aria-controls="ws-panel"
                    onClick={() => onTab(t.id)}
                    className={clsx("flex min-h-[44px] items-center gap-3 rounded-hz px-3 text-left font-body text-[15px] font-semibold", on ? "bg-t-soft text-t-text" : "text-t-muted hover:text-t-text")}
                  >
                    <Icon size={18} aria-hidden />
                    <span className="flex-1">{t.label}</span>
                    {t.badge && <span className="rounded-full bg-t-accent px-2 py-0.5 font-body text-[11px] font-extrabold text-t-on">{t.badge}</span>}
                    {t.tag && <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-t-muted">{t.tag}</span>}
                  </button>
                );
              })}
              {footer && <div className="my-2 h-px bg-t-line" />}
              {footer}
            </div>
          </nav>

          <main className="min-w-0 px-4 pb-28 lg:px-8 lg:pb-16">
            <div ref={strip} hidden={nav.length < 2} role="tablist" aria-label={label} className="sticky top-[64px] z-20 -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-t-line bg-t-bg px-4 py-2 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
              {nav.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`ws-mtab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="ws-panel"
                  onClick={() => onTab(t.id)}
                  className={clsx("flex min-h-[40px] flex-none items-center gap-1.5 rounded-hz px-3 font-body text-[14.5px] font-semibold", tab === t.id ? "bg-t-soft text-t-text" : "text-t-muted")}
                >
                  {t.label}
                  {t.badge && <span className="rounded-full bg-t-accent px-1.5 text-[10.5px] font-extrabold text-t-on">{t.badge}</span>}
                </button>
              ))}
            </div>

            <div className="t-adopt mx-auto w-full max-w-[860px] lg:mx-0 lg:pt-6">
              {title && <h2 className="t-title mb-1 text-[26px] font-extrabold leading-tight lg:text-[32px]">{title}</h2>}
              {sub && <p className="mb-4 font-body text-[14.5px] text-t-muted">{sub}</p>}
              <div role="tabpanel" id="ws-panel" aria-labelledby={`ws-tab-${tab}`} className={sub ? "" : "mt-4"}>
                {children}
              </div>
            </div>
          </main>
        </div>
      </TintShell>
    </div>
  );
}

/** A nav-style link at the foot of the wide nav (View room, View as visitor). */
export const FOOT_LINK = "flex min-h-[44px] items-center gap-3 rounded-hz px-3 font-body text-[15px] font-semibold text-t-muted hover:text-t-text";
