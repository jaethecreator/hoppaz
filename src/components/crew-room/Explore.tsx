"use client";

/**
 * Other crews (verified first, each opens /crew/<id>) and trending this week (each opens /?e=<id>) (design section
 * 10). Owned by PLACES. Rendered by the chat sheet's EXPLORE tab, so it sits inside the sheet: no fixed positioning.
 */
export type ExploreProps = { crewId: string };

export default function Explore(props: ExploreProps) {
  void props;
  return null;
}
