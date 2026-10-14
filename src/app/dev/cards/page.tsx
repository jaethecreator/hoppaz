import { notFound } from "next/navigation";

/**
 * Development only: the deck cards (http://localhost:3000/dev/cards): every tier's
 * face, and the box reveal with its card step, over sample data. Production
 * builds answer 404, and the page is imported inside the development branch, so
 * a production build leaves it out.
 */
export default async function DevCardsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevCards } = await import("./DevCards");
    return <DevCards />;
  }
}
