import { splitTags } from "@/lib/mentions";

/**
 * A message body with its tags drawn: "@alias" in bold, and in plain orange when it is YOUR alias (`mine`). Anything without
 * a tag is the text, untouched.
 */
export default function TaggedText({ body, mine }: { body: string; mine?: string | null }) {
  const pieces = splitTags(body);
  if (pieces.length === 1 && !pieces[0].tag) return <>{body}</>;
  const me = mine?.trim().toLowerCase();
  return (
    <>
      {pieces.map((p, i) =>
        p.tag ? (
          <span key={i} className={me && p.text.trim().toLowerCase() === me ? "text-orange" : "font-semibold"}>
            @{p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}
