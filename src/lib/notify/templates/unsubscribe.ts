/**
 * Where the unsubscribe link of G10, G11, G12 and G15 points. The unsubscribe page is step 3, so this answers null for now: the templates
 * then draw no link and send no List-Unsubscribe header (a header that points nowhere is worse than none).
 * Step 3 replaces the body with a signed link built from the person and the kind. Nothing else needs to change.
 */
export type UnsubscribeInput = { kind: string; userId?: string; queueId?: string };

export function unsubscribeUrlFor(input: UnsubscribeInput): string | null {
  void input;
  return null;
}
