"use client";

import type { AuthUser } from "@/lib/events-r1/types";

/**
 * Release 1 sign in: email, six digit code, or Google. Asked only on Register or Create.
 * This is the contract other screens code against; the sign-in package fills in the body.
 */
export type SignInSheetProps = {
  open: boolean;
  /** One line that says why, e.g. "Register for Afro Soirée". */
  reason: string;
  onClose: () => void;
  onSignedIn: (user: AuthUser) => void;
};

export default function SignInSheet(_props: SignInSheetProps) {
  return null;
}
