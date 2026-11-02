import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/app/PageHeader";
import { prefStoreFor, readUnsub, type UnsubView } from "@/lib/notify/prefs";
import type { UnsubSetting } from "@/lib/notify/unsubToken";

export const dynamic = "force-dynamic";

// The address carries the token: keep it out of search results and out of the Referer of anything this page links to.
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where the unsubscribe link in a reminder, Pop or thank-you email lands (src/lib/notify/templates/unsubscribe.ts).
 * Opening it (GET) only SHOWS what would change, because mail scanners open every link: the change is made by the button, which POSTs
 * the signed token to /api/notify/unsubscribe. No sign-in. A bad or altered token gets a plain message and nothing happens.
 * Only reminder and Pop mail can be switched off here: tickets, receipts and event changes always arrive.
 */

const WORDS: Record<UnsubSetting, { name: string; stop: string; stopQ: string; stopped: string; on: string; what: string; back: string }> = {
  reminders: {
    name: "reminder emails",
    stop: "Stop reminder emails",
    stopQ: "Stop reminder emails?",
    stopped: "You won't get reminder emails from Hoppaz any more.",
    on: "You'll get the day-before and starting-soon reminders, and the thank-you the morning after, again.",
    what: "You'll stop getting the day-before and starting-soon reminders, and the thank-you the morning after an event.",
    back: "Keep my reminders",
  },
  pops: {
    name: "emails from hosts",
    stop: "Stop emails from hosts",
    stopQ: "Stop emails from hosts?",
    stopped: "You won't get emails from hosts any more. You still see their Pops in the app.",
    on: "You'll get the emails hosts send to the people going to their events again.",
    what: "You'll stop getting the emails hosts send to the people going to their events. You still see their Pops in the app.",
    back: "Keep getting them",
  },
};

const STAYS = "Your tickets, receipts, and any change or cancellation to an event you're going to still arrive. Those are about your own tickets.";

const lead = "font-display text-[22px] font-black leading-tight";
const btn = "btn w-full text-[15px] font-bold normal-case tracking-normal";
const ghost = "btn btn-ghost w-full text-[15px] font-bold normal-case tracking-normal";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Choice({ token, to, label, className }: { token: string; to: "on" | "off"; label: string; className: string }) {
  return (
    <form method="post" action="/api/notify/unsubscribe" className="mt-5">
      <input type="hidden" name="t" value={token} />
      <input type="hidden" name="do" value={to} />
      <input type="hidden" name="from" value="page" />
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}

function Body({ view, token, done }: { view: UnsubView; token: string; done: string | undefined }) {
  if (!view.ok) {
    const text =
      view.reason === "bad_link"
        ? { h: "This link doesn't work", p: "It may have been cut short when it was copied, or it isn't one of ours. Nothing was changed. Use the link in the latest email from Hoppaz, or sign in and change your email settings." }
        : view.reason === "no_person"
          ? { h: "We can't find this account", p: "Nothing was changed. If you deleted your account, you won't get emails from us." }
          : { h: "We can't do that right now", p: "Nothing was changed. Try again in a minute." };
    return (
      <>
        <p className={lead}>{text.h}</p>
        <p className="hint mt-2">{text.p}</p>
        {view.reason === "bad_link" && (
          <Link href="/account/notifications" className={`${ghost} mt-5`}>Email settings</Link>
        )}
      </>
    );
  }
  const w = WORDS[view.setting];
  if (view.on) {
    // Still on. If the page was just turned back on, say so; otherwise ask.
    if (done === "on") {
      return (
        <>
          <p className={lead}>Back on.</p>
          <p className="hint mt-2">{w.on}</p>
          <Choice token={token} to="off" label={w.stop} className={ghost} />
        </>
      );
    }
    return (
      <>
        <p className={lead}>{w.stopQ}</p>
        <p className="hint mt-2">{w.what}</p>
        <p className="hint mt-2">{STAYS}</p>
        <Choice token={token} to="off" label={w.stop} className={btn} />
        <Link href="/" className="mt-3 block min-h-[44px] text-center font-body text-[14px] leading-[44px] text-dim underline underline-offset-4">{w.back}</Link>
      </>
    );
  }
  return (
    <>
      <p className={lead}>{done === "off" ? "You're unsubscribed." : `Your ${w.name} are off.`}</p>
      <p className="hint mt-2">{w.stopped}</p>
      <p className="hint mt-2">{STAYS}</p>
      <Choice token={token} to="on" label={`Turn ${w.name} back on`} className={btn} />
    </>
  );
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = first(sp.t) ?? "";
  const done = first(sp.done);
  // Reads only. The change is the button's POST.
  const view = await readUnsub(token, prefStoreFor());
  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <div className="mx-auto w-full max-w-[480px]">
        <PageHeader title="Unsubscribe" caption="Hoppaz emails" />
        <div className="card">
          <Body view={view} token={token} done={done} />
        </div>
        <p className="hint mt-4">Questions? Reply to any email from Hoppaz.</p>
      </div>
    </div>
  );
}
