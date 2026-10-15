"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import VerifiedBadge from "@/components/VerifiedBadge";
import css from "./HubHeader.module.css";

/** How long each picture stays before the next one slides in. */
export const AUTOPLAY_MS = 6000;

/** The room's own art, for a crew with no header pictures yet. */
const ROOM_ART = "/templates/clubhouse.jpg";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * The crew's round badge. The owner's logo when there is one (and it loads), otherwise the crew's first letter on the
 * app's card colour, so a crew with no logo still has a face.
 */
export function CrewLogo({ url, name, size = 64, className }: { url?: string | null; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = !!url && failed !== url;
  return (
    <span
      className={clsx("block flex-none overflow-hidden rounded-full border-[3px] border-ink bg-ink-3 shadow-sheet", className)}
      style={{ width: size, height: size }}
      data-crew-logo={show ? "image" : "letter"}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- the crew's own upload or a /brands/ path, already sized for a badge
        <img src={url} alt={`${name} logo`} width={size} height={size} className="h-full w-full object-cover" onError={() => setFailed(url ?? null)} draggable={false} />
      ) : (
        <span className="grid h-full w-full place-items-center font-display font-black leading-none text-cream" style={{ fontSize: Math.round(size * 0.42) }} aria-hidden>
          {name.trim().charAt(0).toUpperCase() || "H"}
        </span>
      )}
    </span>
  );
}

/**
 * Swipes between up to five pictures. Autoplays every 6 s, holds still while a finger is on it (and for one more turn
 * after), when the page is hidden or scrolled away, and always with reduced motion. One picture is a still: no dots,
 * no timer. A picture that will not load is swapped for the room's art, so the header is never a hole.
 */
function Carousel({ images, label }: { images: string[]; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const at = useRef(0);
  const touching = useRef(false);
  const hovering = useRef(false);
  const seen = useRef(true);
  const holdUntil = useRef(0);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<string[]>([]);

  const art = images.length === 0;
  const slides = art ? [ROOM_ART] : images;
  const many = slides.length > 1;

  const goTo = useCallback(
    (n: number) => {
      const el = track.current;
      if (!el) return;
      el.scrollTo({ left: n * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced]
  );

  // Which picture is showing: read from the scroll, so a swipe, a dot tap and the timer all agree.
  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const n = Math.round(el.scrollLeft / el.clientWidth);
    if (n !== at.current) {
      at.current = n;
      setIndex(n);
    }
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (seen.current = e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!many || reduced) return;
    const t = setInterval(() => {
      if (touching.current || hovering.current || document.hidden || !seen.current || Date.now() < holdUntil.current) return;
      goTo((at.current + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [many, reduced, slides.length, goTo]);

  // Keep the same picture in view when the width changes (a phone turned over).
  useEffect(() => {
    const onResize = () => {
      const el = track.current;
      if (el) el.scrollLeft = at.current * el.clientWidth;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const hold = () => {
    holdUntil.current = Date.now() + AUTOPLAY_MS;
  };

  return (
    <div
      ref={stage}
      className={css.stage}
      role="group"
      aria-roledescription="carousel"
      aria-label={`${label} pictures`}
      data-carousel-index={index}
      data-carousel-count={many ? slides.length : 0}
      data-carousel-art={art ? "1" : undefined}
    >
      <div
        ref={track}
        className={css.track}
        onScroll={onScroll}
        onTouchStart={() => {
          touching.current = true;
        }}
        onTouchEnd={() => {
          touching.current = false;
          hold();
        }}
        onTouchCancel={() => {
          touching.current = false;
          hold();
        }}
        onMouseEnter={() => {
          hovering.current = true;
        }}
        onMouseLeave={() => {
          hovering.current = false;
          hold();
        }}
      >
        {slides.map((src, i) => (
          <div key={`${src}-${i}`} className={clsx(css.slide, art && css.art)} aria-hidden={i !== index} data-slide={i}>
            {/* eslint-disable-next-line @next/next/no-img-element -- crew uploads live in Supabase storage, already shrunk to 1600 px */}
            <img
              src={broken.includes(src) ? ROOM_ART : src}
              alt=""
              width={1600}
              height={900}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onError={() => setBroken((b) => (b.includes(src) ? b : [...b, src]))}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className={css.scrim} />
      {many && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center" role="tablist" aria-label="Pictures">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Picture ${i + 1} of ${slides.length}`}
              onClick={() => {
                hold();
                goTo(i);
              }}
              className="grid h-11 w-11 place-items-center"
            >
              <span className={clsx(css.dot, i === index && css.dotOn)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The top of a crew's hub and of its invite page: the carousel, the back button over it, then the name row with the
 * verified tick and the round logo at the right end (it overlaps the picture by half, the way a profile does).
 */
export default function HubHeader({
  images,
  title,
  verified,
  logoUrl,
  kicker,
  meta,
  back,
}: {
  images: string[];
  title: string;
  verified: boolean;
  logoUrl: string | null;
  kicker: string;
  meta?: ReactNode;
  /** The chevron's fallback link when there is nothing to go back to. */
  back?: string;
}) {
  const router = useRouter();
  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const canGoBack = nav ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) router.back();
    else router.replace(back ?? "/crew");
  };

  return (
    <header className="relative md:pt-4">
      <Carousel images={images} label={title} />
      {back && (
        <Link
          href={back}
          onClick={goBack}
          aria-label="Back"
          className="absolute left-2 grid h-11 w-11 place-items-center rounded-full bg-ink/60 text-cream backdrop-blur-sm md:left-3 md:top-7"
          style={{ top: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
        >
          <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
        </Link>
      )}
      <div className="relative flex items-start gap-3 px-4">
        <div className="min-w-0 flex-1 pt-3">
          <p className="seclabel">{kicker}</p>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <h1 className="line-clamp-2 min-w-0 break-words font-display text-[28px] font-black leading-[1.05]" data-hub-title>
              {title}
            </h1>
            {verified && <VerifiedBadge size={22} />}
          </div>
          {meta}
        </div>
        <CrewLogo url={logoUrl} name={title} size={64} className="-mt-8" />
      </div>
    </header>
  );
}
