/**
 * The Hoppaz template covers (build brief section 11): the create page never opens empty, it loads with one of these at
 * random and the page tints itself from it. Files live in public/templates/covers (1080 x 1350, 4:5). These are drawn
 * placeholders from the approved mock-up; designed images replace them at the same paths, nothing else changes.
 */
export type CoverTemplate = { id: string; name: string; src: string };

export const COVERS: CoverTemplate[] = [
  { id: "detty", name: "Detty December", src: "/templates/covers/detty.jpg" },
  { id: "afro", name: "Afro Nights", src: "/templates/covers/afro.jpg" },
  { id: "owambe", name: "Owambe", src: "/templates/covers/owambe.jpg" },
  { id: "brunch", name: "Brunch and mimosas", src: "/templates/covers/brunch.jpg" },
  { id: "run", name: "Run Club", src: "/templates/covers/run.jpg" },
  { id: "tech", name: "Build Night", src: "/templates/covers/tech.jpg" },
  { id: "art", name: "Art walk", src: "/templates/covers/art.jpg" },
  { id: "comedy", name: "Comedy Night", src: "/templates/covers/comedy.jpg" },
  { id: "pool", name: "Pool Party", src: "/templates/covers/pool.jpg" },
  { id: "sunday", name: "Sunday Service", src: "/templates/covers/sunday.jpg" },
];

export const isTemplateCover = (src: string | null | undefined) => !!src && COVERS.some((c) => c.src === src);

/** A random template, never the one passed in (Shuffle). */
export function randomCover(not?: string | null): CoverTemplate {
  const pool = COVERS.filter((c) => c.src !== not);
  return pool[Math.floor(Math.random() * pool.length)];
}
