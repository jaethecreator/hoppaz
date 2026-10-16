/**
 * Stage requests, one at a time, and the LATEST wish wins. PURE (no imports), so it is checked alone
 * (scripts/crew-room/check-stage-mix.mjs).
 *
 * Starting, the keep-alive and SPEAK TO ALL's retries all ask "on"; leaving the stage asks "off". If a request is already
 * on its way, a new one must not simply share its answer: an "off" that rode on an "on" would never reach the server and
 * the speaker would stay LIVE. So the sender remembers what is wanted NOW. When the request in flight comes back and the
 * wish has changed, it sends again, and only the answer to the last wish is settled (shown). Requests never overlap, so
 * the server sees them in the order they were wished.
 *
 * An "off" is retried when it could not reach the server at all (`failed`), a couple of times, and is settled either way:
 * a speaker who walked off the stage is not shown as live, and the server's own checks (the database's stage list, the
 * sweep) stop believing them whatever the network did.
 */
export type StageAnswer = { ok: boolean; full: boolean; /** The request never got a real answer (network error, bad status). */ failed?: boolean };

/** How many times a stop that did not reach the server is sent again, and how long to wait between tries (ms). */
export const STOP_RETRIES = 2;
export const STOP_RETRY_MS = 800;

export function createStageSender<A extends StageAnswer>(
  /** Sends one request and says what came back. Never throws (an error is `failed`). */
  send: (on: boolean) => Promise<A>,
  /** Shows the answer to the last wish. Called once per burst of requests. */
  settle: (on: boolean, answer: A) => void,
  opts: { retries?: number; retryMs?: number; pause?: (ms: number) => Promise<void> } = {},
): (on: boolean) => Promise<A> {
  const retries = opts.retries ?? STOP_RETRIES;
  const retryMs = opts.retryMs ?? STOP_RETRY_MS;
  const pause = opts.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let wanted = false;
  let running: Promise<A> | null = null;

  const run = async (): Promise<A> => {
    try {
      let sent = wanted;
      let answer = await send(sent);
      let failures = 0;
      for (;;) {
        if (wanted !== sent) {
          // The wish changed while that request was out: the newest one goes next, and the old answer is dropped.
          sent = wanted;
          failures = 0;
        } else if (!sent && answer.failed && failures < retries) {
          failures++;
          await pause(retryMs);
          sent = wanted; // it may have changed while waiting
        } else {
          break;
        }
        answer = await send(sent);
      }
      settle(sent, answer);
      return answer;
    } finally {
      running = null; // synchronous with the exit above, so no wish can arrive between "done" and "free"
    }
  };

  return (on) => {
    wanted = on;
    // Started from a microtask so `running` is set before the first line of `run` can clear it.
    running ??= Promise.resolve().then(run);
    return running;
  };
}
