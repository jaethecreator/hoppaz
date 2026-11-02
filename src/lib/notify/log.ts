import { randomUUID } from "node:crypto";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider";

/** a***@example.com: enough to see who it was for in a log, not enough to read an address out of it. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

/**
 * The provider for fake mode and local runs: sends nothing, writes one line, and answers with a made-up id and no cost.
 * Its cap in notify_caps is effectively unlimited. It is never used in production unless the fake switch is on (providers.ts).
 */
export function createLogProvider(write: (line: string) => void = (line) => console.log(line)): EmailProvider {
  return {
    name: "log",
    kinds: ["code", "guest"],
    async send(msg: OutgoingEmail): Promise<SendResult> {
      write(`[hoppaz] notify (log provider, nothing sent): ${msg.kind} to ${maskAddress(msg.to)}, priority ${msg.priority}, row ${msg.queueId}`);
      return { ok: true, messageId: `log_${randomUUID()}`, costUsd: 0 };
    },
  };
}
