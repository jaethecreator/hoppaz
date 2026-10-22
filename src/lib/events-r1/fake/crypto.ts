/**
 * Fake ticket signing. The token is <base64url payload>.<base64url HMAC-SHA256 signature> with the payload
 * {t: ticket id, e: event id, v: version}. The key is made here and held in memory and in the fake's saved layer.
 * It stands in for the real thing: real signing, and the offline list of valid tickets, are Ola's (08-ticketing-framework.md).
 */
import { persist, S } from "./store";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const unb64url = (text: string): Uint8Array<ArrayBuffer> => {
  const b = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

export type TokenPayload = { t: string; e: string; v: number };

let cache: { jwk: string; key: CryptoKey } | null = null;
let pending: Promise<CryptoKey> | null = null;

async function getKey(): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot sign tickets here");
  const saved = S().key;
  if (cache && saved && cache.jwk === JSON.stringify(saved)) return cache.key;
  if (pending) return pending;
  const algo = { name: "HMAC", hash: "SHA-256" };
  pending = (async () => {
    let key: CryptoKey | undefined;
    if (saved) {
      try {
        key = await subtle.importKey("jwk", saved, algo, true, ["sign", "verify"]);
      } catch {
        /* a broken saved key: make a new one */
      }
    }
    if (!key) {
      key = (await subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKey;
      S().key = await subtle.exportKey("jwk", key);
      persist();
    }
    cache = { jwk: JSON.stringify(S().key), key };
    return key;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function signToken(p: TokenPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = await crypto.subtle.sign("HMAC", await getKey(), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Null if the text is not a token or the signature does not match; else the payload. */
export async function readToken(token: string): Promise<{ payload: TokenPayload } | { error: "bad_signature" }> {
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: "bad_signature" };
  try {
    const ok = await crypto.subtle.verify("HMAC", await getKey(), unb64url(parts[1]), enc.encode(parts[0]));
    if (!ok) return { error: "bad_signature" };
    const payload = JSON.parse(dec.decode(unb64url(parts[0]))) as TokenPayload;
    if (typeof payload.t !== "string" || typeof payload.e !== "string" || typeof payload.v !== "number") return { error: "bad_signature" };
    return { payload };
  } catch {
    return { error: "bad_signature" };
  }
}
