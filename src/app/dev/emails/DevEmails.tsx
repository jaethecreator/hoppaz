"use client";

import { useEffect, useRef, useState } from "react";

type Sample = { label: string; kind: string; to: string; subject: string; html: string; text: string; headers: Record<string, string> };

const WIDTHS = [
  { id: "phone", label: "Phone", px: 375 },
  { id: "desktop", label: "Desktop", px: 680 },
] as const;

/** One email in a frame that grows to the email's own height, so the page scrolls and not each little window. The email has no scripts. */
function Frame({ title, html, px }: { title: string; html: string; px: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const f = ref.current;
    const h = f?.contentDocument?.documentElement.scrollHeight;
    if (f && h) f.style.height = `${h + 4}px`;
  };
  // The frame may finish loading before React has attached onLoad, so size it on mount too, and again when the width changes.
  useEffect(() => {
    fit();
    const t = window.setTimeout(fit, 400);
    return () => window.clearTimeout(t);
  }, [html, px]);
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={fit}
      style={{ width: px, maxWidth: "100%", height: 640, border: 0, background: "#0E0B0A", display: "block", marginTop: 12 }}
    />
  );
}

export default function DevEmails({ samples }: { samples: Sample[] }) {
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["id"]>("phone");
  const [view, setView] = useState<"html" | "text">("html");
  const px = WIDTHS.find((w) => w.id === width)?.px ?? 375;
  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 py-6 text-cream">
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        <h1 className="font-display text-[22px] font-black">Emails</h1>
        <p className="hint">
          Every guest and host email with sample data. Nothing is sent. The unsubscribe link on G10, G11, G12 and G15 uses a placeholder address here: the real
          helper returns none until the unsubscribe page exists.
        </p>
        <div className="flex flex-wrap gap-2" data-testid="controls">
          {WIDTHS.map((w) => (
            <button key={w.id} type="button" className={width === w.id ? "btn" : "btn btn-ghost"} aria-pressed={width === w.id} onClick={() => setWidth(w.id)}>
              {w.label} {w.px}
            </button>
          ))}
          <button type="button" className={view === "html" ? "btn" : "btn btn-ghost"} aria-pressed={view === "html"} onClick={() => setView("html")}>
            HTML
          </button>
          <button type="button" className={view === "text" ? "btn" : "btn btn-ghost"} aria-pressed={view === "text"} onClick={() => setView("text")}>
            Text
          </button>
        </div>
        <nav className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]" aria-label="Emails">
          {samples.map((s, i) => (
            <a key={i} href={`#email-${i}`} className="text-orange underline">
              {s.label.split(" ")[0]}
            </a>
          ))}
        </nav>
        {samples.map((s, i) => (
          <section key={i} id={`email-${i}`} className="rounded-hz border border-line p-3" data-kind={s.kind}>
            <h2 className="font-display text-[16px] font-black">{s.label}</h2>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px] text-cream/70">
              <dt>kind</dt>
              <dd>{s.kind}</dd>
              <dt>to</dt>
              <dd>{s.to}</dd>
              <dt>subject</dt>
              <dd className="text-cream" data-testid="subject">{s.subject}</dd>
              {Object.entries(s.headers).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {view === "html" ? (
              <Frame title={s.label} html={s.html} px={px} />
            ) : (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-hz bg-black/40 p-3 font-mono text-[12px] leading-relaxed" style={{ maxWidth: px }}>
                {s.text}
              </pre>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
