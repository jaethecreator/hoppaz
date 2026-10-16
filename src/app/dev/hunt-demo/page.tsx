import { notFound } from "next/navigation";

/**
 * Development only: the Game Time practice hunt in a room template, over a made-up Game Time, with no server call
 * (http://localhost:3378/dev/hunt-demo?room=clubhouse&status=upcoming). Production builds answer 404.
 */
export default async function DevHuntDemoPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevHuntDemo } = await import("./DevHuntDemo");
    return <DevHuntDemo />;
  }
}
