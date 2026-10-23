"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera } from "lucide-react";

/** The longest side a frame is read at, as in QrScanner. Bigger frames only slow the phone down. */
const MAX_SIDE = 960;
/** Read at most this often: a door phone has to stay cool for a whole night. */
const EVERY_MS = 120;
/** The same code in view is not read again for this long. */
const REPEAT_MS = 4000;

type Phase = "idle" | "starting" | "live" | "blocked";

/**
 * The door's camera view. Like QrScanner (jsqr, the back camera, frames stay on the phone) but drawn in the page and
 * it keeps reading: QrScanner is a full-screen dialog that stops after one code. Starts by itself when the browser has
 * already allowed the camera, otherwise on a tap. When it cannot open it says so calmly; the typed code and the search
 * below it are always there.
 */
export default function DoorCamera({ onRead, paused }: { onRead: (value: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef(0);
  const last = useRef({ value: "", at: 0 });
  const read = useRef(onRead);
  const hold = useRef(paused);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    read.current = onRead;
    hold.current = paused;
  });

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("blocked");
      return;
    }
    setPhase("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = s;
      const el = video.current;
      if (!el) {
        stop();
        return;
      }
      el.srcObject = s;
      await el.play();
      setPhase("live");
      let lastRun = 0;
      const tick = (t: number) => {
        if (!stream.current) return;
        frame.current = requestAnimationFrame(tick);
        if (t - lastRun < EVERY_MS || hold.current) return;
        lastRun = t;
        const v = video.current;
        const c = canvas.current;
        if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
        const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const hit = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
        if (!hit?.data) return;
        const now = Date.now();
        if (hit.data === last.current.value && now - last.current.at < REPEAT_MS) return;
        last.current = { value: hit.data, at: now };
        read.current(hit.data);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      stop();
      setPhase("blocked");
    }
  }, [stop]);

  // Open by itself only when the browser already allowed the camera: no permission question the moment the page opens.
  useEffect(() => {
    let live = true;
    const ask = (navigator as Navigator & { permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> } }).permissions;
    ask
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (live && p.state === "granted") void start();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [start, stop]);

  return (
    <div className="relative overflow-hidden rounded-hz border border-line bg-ink-3">
      <video ref={video} playsInline muted className={phase === "live" ? "aspect-[4/3] max-h-[44vh] w-full object-cover lg:max-h-[360px]" : "hidden"} />
      <canvas ref={canvas} className="hidden" />
      {phase === "live" && (
        <span aria-hidden className="pointer-events-none absolute inset-[16%]">
          <i className="absolute left-0 top-0 h-7 w-7 rounded-tl-[4px] border-l-[3px] border-t-[3px] border-brand-cream" />
          <i className="absolute right-0 top-0 h-7 w-7 rounded-tr-[4px] border-r-[3px] border-t-[3px] border-brand-cream" />
          <i className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-[4px] border-b-[3px] border-l-[3px] border-brand-cream" />
          <i className="absolute bottom-0 right-0 h-7 w-7 rounded-br-[4px] border-b-[3px] border-r-[3px] border-brand-cream" />
        </span>
      )}
      {phase !== "live" && (
        <div className="grid min-h-[150px] place-items-center px-4 py-5 text-center">
          {phase === "blocked" ? (
            <div>
              <p className="font-body text-[14px] text-cream">The camera is not available.</p>
              <p className="hint mt-1">Type the code under the QR, or search for the guest below.</p>
              <button type="button" className="btn btn-ghost mt-3 px-4 normal-case" onClick={() => void start()}>
                Try the camera again
              </button>
            </div>
          ) : (
            <div>
              <p className="hint">The camera scans the ticket QR. Nothing leaves your phone.</p>
              <button type="button" className="btn mt-3 px-5 normal-case" disabled={phase === "starting"} onClick={() => void start()}>
                <Camera size={16} aria-hidden /> {phase === "starting" ? "Opening the camera" : "Start the camera"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
