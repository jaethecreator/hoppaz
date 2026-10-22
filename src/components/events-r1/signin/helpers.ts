/** Small pure helpers for the Release 1 sign-in sheet. */

/** The same test the fake layer uses: something@something.tld. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const looksLikeEmail = (s: string): boolean => EMAIL.test(s.trim());

/** "ada.obi@gmail.com" -> "Ada Obi". Empty when there is nothing usable before the @. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[0-9]+/g, " ").replace(/[._-]+/g, " ").trim();
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 24);
}

/** Keep digits only, at most six: a pasted "123 456" or "123-456" becomes "123456". */
export const sixDigits = (s: string): string => s.replace(/\D/g, "").slice(0, 6);

/** 30 -> "0:30" */
export const clock = (secs: number): string => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
