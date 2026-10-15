"use client";

/**
 * How code outside a component goes to another page of the app without a reload. A component in the layout
 * (components/app/AppNavigator) hands over the Next router; a plain navigation is only the fallback for the moment before it
 * has (or a page that is not in the app), so a tab, the account gate and a hotspot link all move on the client and nothing
 * that lives in the layout (the first run, the music, the session) starts over.
 */
type Go = (href: string, replace: boolean) => void;

let go: Go | null = null;

export function setAppNavigator(fn: Go) {
  go = fn;
  return () => {
    if (go === fn) go = null;
  };
}

/** Go to a path of this app. `replace` swaps the current history entry (a redirect the back button must not return to). */
export function appNavigate(href: string, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  const replace = !!opts?.replace;
  if (go) return go(href, replace);
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}
